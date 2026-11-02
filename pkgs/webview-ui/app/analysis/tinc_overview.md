# Overview

Tinc is a mature mesh VPN implementation initially developed in 1998, creating a secure private network between multiple hosts using tunneling and encryption. The core architecture is based on a decentralized mesh topology where each node maintains connections to other nodes and can route traffic through the network.

**Key Architecture Components:**

- **tincd**: Main daemon process that handles all VPN operations
- **Meta Protocol**: TCP-based control protocol for node authentication and network topology exchange
- **Packet Protocol**: UDP-based data protocol for VPN packet transmission
- **SPTPS**: Simple Peer-to-Peer Security protocol providing modern authenticated encryption
- **Graph Algorithms**: Kruskal's MST for broadcast routing and a breadth-first single-source shortest-path search (fewest hops, edge weight as tie-breaker) for unicast routing
- **Event Loop**: Single-threaded event-driven architecture using epoll (Linux), kqueue (BSD), select (macOS, Solaris) or WSAWaitForMultipleEvents (Windows) for I/O multiplexing

# Protocol

Tinc uses a dual-protocol architecture separating control plane from data plane:

**Control Plane (Meta Protocol)**: Uses ASCII text-based messages over TCP connections for authentication, topology synchronization, and key exchange. With the 1.1 protocol the meta connection is itself protected by an SPTPS stream session; only the initial ID message (node name and protocol version) is sent in cleartext. Messages include ID (identity exchange), ADD_EDGE/DEL_EDGE (topology updates), ADD_SUBNET/DEL_SUBNET (subnet announcements), REQ_KEY/ANS_KEY (session key requests, also used to carry SPTPS handshakes and relayed packets), KEY_CHANGED, UDP_INFO/MTU_INFO (address and MTU hints), and PING/PONG (keepalive, default every 60 s).

**Data Plane (Packet Protocol)**: VPN packets are transmitted over UDP. In SPTPS mode the datagram format is `| dst node ID (6) | src node ID (6) | seqno (4) | encrypted type + payload | Poly1305 tag (16) |`; node IDs are the first 6 bytes of SHA-512(node name), and the destination ID is zeroed for direct packets. In router mode the 14-byte Ethernet header is stripped before encryption, so the per-packet overhead is 33 bytes plus UDP/IP. The legacy format is `| seqno (4 bytes) | encrypted data | truncated HMAC |`. In both modes the sequence number drives replay protection.

Tinc supports both modern SPTPS (ephemeral X25519 ECDH authenticated with Ed25519 signatures), which is used automatically when the node has an Ed25519 key (`ExperimentalProtocol`, on by default in 1.1), and the legacy RSA-based handshake for backward compatibility with tinc 1.0 nodes. The meta protocol's reliance on TCP means control plane messages can experience head-of-line blocking under packet loss conditions, potentially delaying route updates and key exchanges.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary transport protocol for VPN data packets
- [x] **TCP fallback** - Packets automatically go over the TCP meta connection (or are relayed over other nodes' meta connections) until UDP is confirmed, when they exceed the discovered path MTU, or always with `TCPOnly`; outgoing meta connections can also traverse SOCKS4/4a/5, HTTP CONNECT or exec proxies
- [ ] **QUIC support** - No QUIC implementation
- [ ] **WebSocket support** - No WebSocket tunneling support

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support
- [x] **IPv6 support** - Native IPv6 tunneling with NDP proxying
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6 operation

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - Router mode provides IP packet routing with ARP/NDP proxy
- [x] **Layer 2 (Ethernet) mode** - Switch mode provides full Ethernet frame tunneling
- [x] **Bridging support** - Switch and Hub modes allow bridging non-VPN devices onto network

### Advanced
- [ ] **Multipath/bonding** - No support for aggregating multiple network paths
- [ ] **QoS/traffic shaping** - Only opt-in `PriorityInheritance` (copies inner TOS/DSCP to the outer UDP header, legacy UDP path only); no queues, classes or rate limits
- [x] **Multicast support** - Broadcast and multicast (default broadcast subnets ff:ff:ff:ff:ff:ff, 255.255.255.255, 224.0.0.0/4, ff00::/8) are flooded along the MST (default) or to direct neighbours only (`Broadcast = direct`)

# Encryption

Tinc provides two encryption protocols: modern SPTPS and legacy RSA-based encryption.

**Modern SPTPS Protocol**: Uses ephemeral ECDH on Curve25519 (ephemeral Ed25519-format keys converted to X25519 for the exchange) to establish shared secrets; there is no NIST P-256 support. Authentication is performed using Ed25519 signatures over both KEX messages, the initiator flag and a session label. Data encryption uses ChaCha20-Poly1305 AEAD in the original 64-bit-nonce construction (as in OpenSSH's chacha20-poly1305), with the record sequence number as nonce. Session keys are derived using HMAC-SHA512 as a PRF (Pseudorandom Function). The handshake provides perfect forward secrecy through ephemeral ECDH keys.

**Legacy Protocol**: Optional backward-compatible mode using RSA (1024-8192 bits; 2048+ recommended) for key exchange and any OpenSSL/libgcrypt cipher selected by name (`Cipher`, default `aes-256-cbc`; `none` is allowed). Packets are authenticated with a truncated HMAC (`Digest`, default SHA-256; `MACLength`, default 4 bytes). The RSA key exchange uses raw RSA without any padding (no OAEP or PKCS#1), and the legacy mode has no forward secrecy.

The SPTPS primitives (Ed25519, X25519, ChaCha20-Poly1305, SHA-512) are always tinc's own bundled portable-C implementations. OpenSSL (default) or libgcrypt is only needed for the legacy protocol; a `nolegacy` build drops it entirely. Key regeneration is triggered by the `KeyExpire` timer (default 3600 s plus jitter), which re-keys legacy sessions and forces a fresh SPTPS key exchange with every reachable node; the legacy receive path additionally re-keys after 2^30 packets. The timer is compiled only in builds with legacy support, so `nolegacy` builds (as used for Android) never re-key SPTPS sessions automatically.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519 (X25519) ECDH in SPTPS; no other curves
- [x] **Perfect Forward Secrecy** - Ephemeral ECDH session keys in SPTPS
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange support
- [x] **Key rotation** - `KeyExpire` (default 3600 s) forces SPTPS re-KEX and legacy re-keying; legacy also re-keys after 2^30 packets (not in `nolegacy` builds)

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 AEAD in SPTPS protocol
- [ ] **Hardware-accelerated crypto** - SPTPS uses bundled portable C ChaCha20-Poly1305 (no SIMD, no AES-NI); only legacy ciphers go through OpenSSL/libgcrypt and may use AES-NI
- [x] **Constant-time operations** - Ed25519/X25519 (ref10-derived), ChaCha20 and poly1305-donna are constant-time designs

### Protocol Security
- [x] **Replay protection** - Sliding bitmap window; default 16 bytes (128 packets) for SPTPS and 32 bytes (256 packets) for legacy, both set via `ReplayWindow` (in bytes)
- [ ] **Noise Protocol or equivalent** - SPTPS is a custom protocol, not a Noise Protocol pattern
- [ ] **No cleartext metadata** - The meta connection starts with a cleartext ID message containing the node name, and every SPTPS UDP packet carries cleartext 6-byte source/destination node IDs derived from node names

# Performance

Tinc uses a fundamentally **single-threaded event-driven architecture**. The main event loop in `main_loop()` keeps I/O events and timeouts in splay trees, with I/O multiplexing via epoll (Linux, up to 32 events per wakeup), kqueue (BSD), select (macOS, Solaris) or WSAWaitForMultipleEvents (Windows).

**Threading Exception**: The only multi-threaded component is the optional UPnP-IGD client which runs in a separate pthread to periodically refresh port mappings without blocking the main event loop.

**Performance Implication**: The single-threaded design means tinc cannot utilize multiple CPU cores for encryption/decryption or packet processing. All cryptographic operations, packet routing, and I/O handling occur in the main thread. High-throughput scenarios are limited by single-core performance, and one slow packet can stall the entire pipeline.

**Packet I/O Details**: On Linux, UDP reception uses `recvmmsg()` with a static batch of 64 packets. Everything else is per-packet: each TUN/TAP read returns one packet (no IFF_VNET_HDR, no multi-queue), each packet is routed, encrypted and sent with its own `sendto()`, and SPTPS packets are copied twice on the send path (record buffer, then node-ID-prefixed datagram buffer). Listening UDP sockets get 1 MiB send and receive buffers by default (`UDPSndBuf`/`UDPRcvBuf`) and the DF bit (`IP_PMTUDISC_DO`) when PMTU discovery is on. The internal frame limit is 1518 bytes (1500 + Ethernet + VLAN header), or 9018 bytes in builds with the `jumbograms` option.

## Performance Optimizations Checklist

### Threading
- [ ] **Multi-threaded processing** - Single-threaded event loop (except UPnP thread)
- [ ] **Per-core packet queues** - N/A due to single-threaded design

### Packet I/O
- [x] **Batch UDP receives** - Uses `recvmmsg` on Linux for receiving multiple packets per syscall
- [ ] **Batch UDP sends** - Uses individual `sendto()` per packet, no `sendmmsg` support
- [x] **Large batch sizes** - Receives up to 64 packets per `recvmmsg` call (UDP receive only; TUN reads and UDP sends are one packet per syscall)

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - No GSO support
- [ ] **UDP GRO (Generic Receive Offload)** - No GRO support

### Buffer Management
- [x] **Buffer pool reuse** - Partial: no pool allocator; the 64-entry `recvmmsg` array is static and reused, other packet buffers live on the stack
- [x] **Large UDP socket buffers** - 1MB default for both send and receive (vs ~200KB kernel default)

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - No userspace TCP/IP stack; tunneled traffic goes through the kernel stack via tun/tap
- [ ] **Large TCP RX/TX buffers** - N/A (no userspace TCP stack)
- [ ] **Tuned congestion control** - N/A (no userspace TCP stack)
- [ ] **Reordering tolerance** - N/A (no userspace TCP stack)

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No explicit coalescing
- [ ] **RX checksum offload** - Depends on NIC/kernel, not controlled by tinc

### MTU Handling
- [ ] **Conservative MTU** - Tinc does not set the interface MTU; it stays at the OS default (1500 on Linux tun/tap) unless set in `tinc-up`. Oversized packets are answered with ICMP Fragmentation Needed / Packet Too Big, fragmented (IPv4 without DF), or sent over TCP, and TCP MSS is clamped (`ClampMSS`, default on)
- [x] **Path MTU discovery** - Active per-node PMTU discovery with UDP probes (exponential probe sizing, 20 probe rounds, then periodic re-probing of maxmtu/maxmtu+1); on by default unless `TCPOnly`

### Peer Management
- [x] **Lazy peer removal** - Unreachable nodes and their subnets stay known until an explicit `tinc purge`; AutoConnect keeps about 3 meta connections
- [x] **Endpoint caching** - Address cache maintains recently seen addresses
- [x] **Efficient keepalive timers** - UDP probes are only sent while traffic is flowing (2 s discovery, 10 s keepalive, 30 s timeout); meta connections ping every 60 s

### Packet Processing
- [x] **Zero-allocation parsing** - No heap allocation on the per-packet path; packet buffers are stack or static (`alloca()` for temporary SPTPS buffers)
- [ ] **Zero-copy filtering** - Packets copied into buffers with offset mechanism

### State Synchronization
- [x] **Delta updates** - ADD_EDGE/DEL_EDGE sends incremental topology changes
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [x] **Tunnel compression** - Optional per-node compression for both SPTPS and legacy: zlib levels 1-9, LZO fast (10) / best (11), LZ4 (12); off by default
- [x] **Configurable compression level** - Each node declares via `Compression` the level it wants to receive; peers compress accordingly

# Security

Tinc has had several security vulnerabilities discovered and patched over its history:

**CVE-2018-16737 & CVE-2018-16738** (2018): Oracle attacks against the legacy protocol's broken authentication (CWE-287) let an attacker get past authentication and inject traffic. This was an integrity flaw; it did not let the attacker decrypt traffic. Fixed in the 1.1 branch with 1.1pre17.

**CVE-2018-16758** (2018): Man-in-the-middle attack could force a NULL cipher for UDP traffic in the legacy protocol, completely removing encryption. This demonstrated the dangers of cipher negotiation without proper authentication.

**CVE-2013-1428** (2013): A stack-based buffer overflow in `receive_tcppacket()`: packets forwarded via TCP were not checked against the buffer size, so an authenticated peer could crash the daemon or potentially execute code. Oversized TCP-forwarded packets are now dropped.

**Security Concerns**:
- Legacy protocol still supported with known weaknesses (raw RSA without padding, CBC with a 4-byte truncated HMAC by default, no forward secrecy, `Cipher = none` allowed)
- Bypass security mode (`--bypass-security` flag) disables meta protocol authentication and uses null ciphers (meant for debugging only); dangerous if accidentally enabled
- If a node's Ed25519 public key is not in its host file, tinc requests it over the meta network (REQ_PUBKEY/ANS_PUBKEY) and stores the answer: trust on first use relayed through intermediate nodes
- Any authenticated node can announce edges and subnets for the whole mesh; only `StrictSubnets`/`TunnelServer` restrict this
- SPTPS uses 32-bit record sequence numbers as ChaCha20 nonces, and `nolegacy` builds have no time-based re-keying, so very long-lived sessions there rely on reconnects for fresh keys
- C codebase with manual memory management presents ongoing memory safety risks
- Replay window defaults (128 packets for SPTPS, 256 for legacy) may drop legitimately reordered packets on high-rate links unless `ReplayWindow` is raised

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - Incoming meta connections are tarpitted above `MaxConnectionBurst` (default 10) per host and overall; SPTPS restarts after decode errors are limited to one per 10 s
- [ ] **Stateful packet filter** - No connection tracking for ACLs
- [ ] **Fine-grained ACLs** - No per-port/protocol access control
- [ ] **Capability-based access** - Simple subnet-based routing only

### Identity & Authentication
- [x] **Identity validation** - Node names are bound to Ed25519 (or RSA) public keys pinned in host files; handshakes verify signatures (but see the TOFU caveat above)
- [ ] **Signed configuration updates** - Config files exchanged but not cryptographically signed
- [x] **Certificate pinning** - No CA/WebPKI; raw public keys of meta peers are pinned in `hosts/` files (invitations pin the inviter's key via a hash in the URL)

### Implementation
- [ ] **Memory-safe language** - Written in C with manual memory management
- [x] **Privilege separation** - Opt-in `--user` (setuid/setgid) and `--chroot` after setup; no separate privileged helper
- [x] **Sandboxing** - `--chroot` is a documented tincd option on every non-Windows platform; OpenBSD adds pledge(2)/unveil(2) (`Sandbox = normal` by default there, `high` optional); no seccomp or Capsicum (`src/tincd.c:152,399-402`)
- [ ] **Audit logging** - Authentication and connection events go to the normal syslog/logfile; no dedicated security audit log

# NAT Traversal

Tinc has **limited NAT traversal capabilities** compared to modern mesh VPNs. It relies on peer-assisted UDP hole punching, where intermediate nodes report the reflexive addresses they observe, plus optional UPnP port forwarding.

**UPnP-IGD Support**: Optional automatic port forwarding using the miniupnpc library (disabled in the default build, enabled at runtime with `UPnP = yes|udponly`). A dedicated pthread refreshes the mappings every `UPnPRefreshPeriod` (default 60 s, lease 2× that). Supports both TCP and UDP port mappings.

**Reflexive Address Discovery**: When an intermediate node forwards an ANS_KEY message, it appends the reflexive UDP address/port it observed for the sender. UDP_INFO messages propagate observed addresses along the path in the same way. Nodes do not learn their own public endpoint; they learn their peers' endpoints from third nodes.

**UDP Probing**: Active UDP probing tries to establish and keep direct paths, with configurable discovery interval (2 s), keepalive interval (10 s) and timeout (30 s). With `LocalDiscovery` (on by default), tinc also probes the peer's advertised local address while UDP is unconfirmed.

**Major Limitations**: No STUN/TURN protocol support and no ICE. No port prediction, so symmetric NATs cannot be traversed directly. In that case traffic is relayed automatically through other mesh nodes, over UDP or over their TCP meta connections. There are no dedicated relay servers.

## NAT Traversal Checklist

### Discovery
- [ ] **No own public node needed** - Meta connections need a peer with an `Address` or one learned through the mesh; hole punching is coordinated by a node both peers are connected to (`src/address_cache.c:124-158`, `src/protocol_key.c:463`)
- [ ] **STUN support** - No STUN; peers' reflexive UDP addresses are reported by intermediate nodes (ANS_KEY, UDP_INFO), not a node's own endpoint
- [ ] **Multiple STUN servers** - No discovery servers at all; intermediate nodes only pass on observed addresses
- [ ] **NAT type detection** - No formal NAT type detection

### Port Mapping
- [x] **UPnP port mapping** - Via miniupnpc (build option, off by default; runtime `UPnP = yes|udponly`)
- [ ] **NAT-PMP support** - No NAT-PMP implementation
- [ ] **PCP support** - No Port Control Protocol support

### Hole Punching
- [x] **UDP hole punching** - Basic hole punching via reflexive address sharing
- [ ] **Symmetric NAT handling** - Cannot handle symmetric NAT reliably
- [x] **Rendezvous coordination** - Meta protocol coordinates address sharing between peers

### Fallback
- [x] **Relay fallback** - Automatic: until direct UDP is confirmed (or permanently, e.g. behind symmetric NAT or with `IndirectData`), packets go via the next hop on the mesh graph, over UDP or TCP
- [ ] **Multiple relay regions** - N/A (no relay infrastructure; any node can relay)
- [x] **Automatic relay selection** - Partial: next hop chosen by fewest hops, then lowest edge weight (meta-connection RTT estimate in ms, overridable with `Weight`)
- [x] **TCP relay support** - Packets can be carried over the TCP meta connections of intermediate nodes; SPTPS payloads stay end-to-end encrypted

# Local Routing

Tinc supports three routing modes providing different levels of network transparency:

**Router Mode (RMODE_ROUTER)**: Routes based on IP addresses with ARP/NDP proxying, IPv4 fragmentation support, and optional TTL decrementing. This mode operates at Layer 3 and is suitable for connecting IP subnets.

**Switch Mode (RMODE_SWITCH)**: Routes based on MAC addresses, learning MAC addresses dynamically like a physical Ethernet switch. Maintains a MAC expiry table with 600-second timeout. Operates at Layer 2 for full Ethernet transparency.

**Hub Mode (RMODE_HUB)**: Broadcasts all packets to all nodes. Simplest but least efficient mode, suitable for small networks or special requirements.

**Local Traffic Optimization**: With `LocalDiscovery` (on by default), each edge carries the local socket address of its meta connection. While UDP to a peer is not yet confirmed, tinc sends an extra probe to the local address of a randomly chosen edge of that peer. If the peer answers there first, the LAN path is used. There is no broadcast/multicast LAN discovery and no explicit same-subnet check.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No LAN broadcast/multicast discovery; local discovery uses unicast probes to advertised local addresses
- [x] **Direct path advertisement** - ADD_EDGE carries each meta connection's local address
- [ ] **Same-subnet detection** - No subnet comparison; local addresses are simply probed

### LAN Optimization
- [x] **Automatic LAN preference** - Partial: local-address probes are sent in parallel with WAN probes only while UDP is unconfirmed; no explicit LAN-over-WAN preference afterwards
- [ ] **Trusted path mode** - No LAN-aware bypass; only the legacy protocol allows `Cipher = none`/`Digest = none` globally
- [ ] **LAN-only mode** - No restriction to local network only

### Routing Features
- [x] **Subnet routes** - ADD_SUBNET messages advertise subnet routing through peers
- [x] **Full tunnel mode** - A node can advertise `Subnet = 0.0.0.0/0` / `::/0`; default routes must be set up by the user in `tinc-up`/`subnet-up` scripts
- [x] **Split tunneling** - Subnet-based routing provides selective VPN routing
- [x] **Route priorities** - Subnet weights (`Subnet = 10.0.0.0/24#5`): the reachable owner with the lowest weight wins, with automatic failover when it becomes unreachable

# Central Point of Failure

**Tinc has NO central point of failure** - it is a true peer-to-peer mesh network.

**Decentralized Topology**: Each node maintains a full network graph with all edge and subnet information. Nodes share topology updates via ADD_EDGE/DEL_EDGE and ADD_SUBNET/DEL_SUBNET messages over the meta protocol. Routing is recalculated automatically when nodes join or leave the network, using Kruskal's MST for broadcast routing and a breadth-first shortest-path search (hop count, then edge weight) for unicast routing.

**AutoConnect Feature**: Automatic connection management maintains mesh connectivity by maintaining approximately 3 connections per node, automatically connecting to unreachable nodes, and dropping superfluous connections when the mesh is well-connected.

**Optional Tunnel Server Mode**: For hub-and-spoke topologies, the `tunnelserver` option can be enabled to prevent nodes from learning the full graph, creating a centralized architecture where the tunnel server becomes the central point.

**Controller Failure Behavior**: Since there is no controller in the default mesh architecture, existing connections continue to function even if some nodes go offline. The mesh automatically routes around failed nodes. New nodes joining the network only need to connect to any existing node to learn the full topology.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Mesh continues functioning without any central controller
- [x] **Local state caching** - Full network graph cached locally at each node
- [x] **Cached credentials** - Host configuration files persist public keys locally
- [x] **Graceful degradation** - Mesh routes around failed nodes automatically

### Redundancy
- [x] **Self-hosted controller** - Fully decentralized, each node is a "controller"
- [x] **Controller redundancy** - N/A in mesh mode; every node has full topology
- [x] **Relay redundancy** - Can relay through any intermediate node in the mesh
- [x] **No single root of trust** - Distributed trust model with per-node key pairs

### Efficiency
- [x] **Delta/incremental updates** - ADD_EDGE/DEL_EDGE sends only topology changes
- [x] **Long polling / push updates** - TCP meta connections push updates immediately
- [ ] **Configurable sync interval** - Updates pushed immediately, no configurable interval

# Authentication

Tinc provides both modern and legacy authentication methods for nodes joining the network.

**Modern Authentication (SPTPS)**: Nodes authenticate using Ed25519 public key cryptography. The SPTPS handshake includes signature verification over both KEX messages (containing nonces and ECDH public keys), the initiator flag, and an application label. This provides strong cryptographic proof of identity and prevents man-in-the-middle attacks.

**Legacy Authentication**: RSA public key authentication with challenge-response protocol. The handshake involves RSA-encrypted symmetric key exchange followed by a random challenge that must be hashed with the agreed digest algorithm and returned for verification.

**Key Storage**: Public keys are stored in host configuration files in `/etc/tinc/<netname>/hosts/` containing the node name, Ed25519PublicKey or RSAPublicKey, and optional Address/Port information. Private keys are stored separately in `ed25519_key.priv` and `rsa_key.priv` files.

**Invitation System**: Tinc includes a built-in invitation mechanism for bootstrapping new nodes. An existing node generates an invitation URL which a new node uses to join. During the invitation finalization process, the new node's Ed25519 public key is automatically added to the inviting node's host configuration file, establishing trust.

**Static Configuration**: The primary method remains static host configuration files that must be manually distributed or exchanged via the invitation system. There is no cloud-based key distribution or dynamic discovery mechanism.

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Single-use invitation URLs (`tinc invite`, valid 1 week by default via `InvitationExpire`) or manual exchange of host files
- [ ] **OAuth/OIDC** - No SSO integration
- [ ] **Interactive login** - No interactive/browser login; invitations are pre-shared URLs
- [x] **CLI authentication** - `tinc join` command for command-line enrollment

### Authorization
- [ ] **Admin approval workflow** - No manual device authorization by admin
- [ ] **Automated enrollment rules** - Invitations are one-time use but no conditional rules
- [ ] **Ephemeral nodes** - No auto-cleanup of temporary devices
- [ ] **Node expiry** - No time-limited authorization (invitation expiry only)

### Identity
- [x] **Stable device identity** - Ed25519/RSA key pairs provide persistent identity
- [x] **Identity portability** - Private keys can be moved between devices
- [ ] **Multi-user support** - One identity per tinc daemon instance, not per-user

# Platform Support

Tinc provides broad cross-platform support with implementations for most major operating systems.

**Platform Implementations**: Linux uses native tun/tap devices (no netlink; routes and addresses are set by user scripts such as `tinc-up`). The BSD family (FreeBSD, OpenBSD, NetBSD, DragonFlyBSD) uses tun/tap devices. macOS uses utun, tap or the tunemu fallback. Windows uses the TAP-Windows adapter. Solaris has dedicated device support. Additional device types include raw_socket, multicast, UML, VDE and dummy. Android is supported by building tincd with the NDK and passing the VpnService tun fd over a Unix socket (`DeviceType = fd`); there is no Android app in the repository.

**Implementation Details**: Tinc runs entirely in userspace, with the main daemon process handling all packet encryption, decryption, and routing. Packets are read from the tun/tap device, encrypted, and sent over UDP (or TCP). Received encrypted packets are decrypted and written to the tun/tap device for the kernel to route.

**Security Features**: Sandboxing exists only on OpenBSD (pledge/unveil). On Unix platforms, tincd can drop privileges via `--chroot` and `--user` after initialization. Optional memory locking (`--mlock`, mlockall) prevents swapping of sensitive key material.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support with tun/tap, recvmmsg, systemd units and watchdog
- [x] **macOS** - Full support with utun/tunemu
- [x] **Windows** - Full support with TAP-Windows adapter
- [x] **FreeBSD/OpenBSD** - Full BSD family support (kqueue); pledge/unveil sandbox on OpenBSD

### Mobile
- [ ] **iOS** - No iOS app or NetworkExtension integration (INSTALL.md only notes that cross-compiling should work)
- [x] **Android** - Partial: NDK build target plus `DeviceType = fd` for a tun fd supplied by a third-party VpnService app; no official app

### Implementation
- [ ] **Kernel-mode datapath** - No in-kernel packet processing
- [x] **Userspace implementation** - Runs entirely in userspace with tun/tap devices
- [ ] **Container support** - No official container image or Kubernetes integration; runs in containers given /dev/net/tun access
