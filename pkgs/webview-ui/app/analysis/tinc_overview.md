# Overview

Tinc is a mature mesh VPN implementation initially developed in 1998, creating a secure private network between multiple hosts using tunneling and encryption. The core architecture is based on a decentralized mesh topology where each node maintains connections to other nodes and can route traffic through the network.

**Key Architecture Components:**

- **tincd**: Main daemon process that handles all VPN operations
- **Meta Protocol**: TCP-based control protocol for node authentication and network topology exchange
- **Packet Protocol**: UDP-based data protocol for VPN packet transmission
- **SPTPS**: Simple Peer-to-Peer Security protocol providing modern authenticated encryption
- **Graph Algorithms**: Dijkstra's SSSP and Kruskal's MST algorithms for mesh routing decisions
- **Event Loop**: Single-threaded event-driven architecture using select/poll/epoll/kqueue for I/O multiplexing

# Protocol

Tinc uses a dual-protocol architecture separating control plane from data plane:

**Control Plane (Meta Protocol)**: Uses ASCII text-based messages over TCP connections for authentication, topology synchronization, and key exchange. Messages include ID (identity exchange), ADD_EDGE/DEL_EDGE (topology updates), ADD_SUBNET/DEL_SUBNET (subnet announcements), REQ_KEY/ANS_KEY (session key requests), and PING/PONG (keepalive).

**Data Plane (Packet Protocol)**: Encrypted VPN packets are transmitted over UDP with the format: `| seqno (4 bytes) | encrypted data | MAC |`. The sequence number provides replay protection while the MAC authenticates the packet.

Tinc supports both modern SPTPS handshake (ECDH key exchange with Ed25519 signatures) and legacy RSA-based handshake for backward compatibility with older nodes. The meta protocol's reliance on TCP means control plane messages can experience head-of-line blocking under packet loss conditions, potentially delaying route updates and key exchanges.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary transport protocol for VPN data packets
- [x] **TCP fallback** - Meta protocol uses TCP; can tunnel all traffic over TCP with TCPOnly mode
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
- [ ] **QoS/traffic shaping** - Priority inheritance (TOS/DSCP preservation) only, no queues or classes
- [x] **Multicast support** - Virtual broadcast using MST-based routing or direct mode

# Encryption

Tinc provides two encryption protocols: modern SPTPS and legacy RSA-based encryption.

**Modern SPTPS Protocol**: Uses ECDH key exchange with Curve25519 or NIST P-256 curves for establishing shared secrets. Authentication is performed using Ed25519 or ECDSA signatures over the handshake messages. Data encryption uses ChaCha20-Poly1305 AEAD (Authenticated Encryption with Associated Data), providing both confidentiality and authenticity. Session keys are derived using HMAC-SHA512 as a PRF (Pseudorandom Function). The handshake provides perfect forward secrecy through ephemeral ECDH keys.

**Legacy Protocol**: Optional backward-compatible mode using RSA (1024-8192 bits) for key exchange and various symmetric ciphers (AES-128/192/256-CFB, Blowfish, etc.) via OpenSSL. MACs use SHA256, SHA1, or MD5. Notably, the RSA implementation explicitly avoids OAEP padding, which is a security concern.

Tinc can use either OpenSSL or libgcrypt for cryptographic operations, with standalone Ed25519/ChaCha20 implementations available for builds without these libraries. Key regeneration is triggered automatically after 2^30 packets to prevent sequence number rollover issues.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519 ECDH (or NIST P-256 as fallback)
- [x] **Perfect Forward Secrecy** - Ephemeral ECDH session keys in SPTPS
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange support
- [x] **Key rotation** - Automatic regeneration after 2^30 packets to prevent rollover

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 AEAD in SPTPS protocol
- [ ] **Hardware-accelerated crypto** - No explicit AES-NI or ARM NEON support (depends on OpenSSL)
- [x] **Constant-time operations** - Ed25519 implementation uses constant-time operations

### Protocol Security
- [x] **Replay protection** - Sliding window verification (configurable size: 16-32 packets)
- [ ] **Noise Protocol or equivalent** - SPTPS is custom but well-designed, not Noise Protocol
- [x] **No cleartext metadata** - SPTPS encrypts all data after handshake; legacy protocol encrypts payloads

# Performance

Tinc uses a fundamentally **single-threaded event-driven architecture**. The main event loop in `main_loop()` uses an event system based on splay trees for I/O events and timeouts, with I/O multiplexing via select/poll/kqueue/epoll depending on the platform.

**Threading Exception**: The only multi-threaded component is the optional UPnP-IGD client which runs in a separate pthread to periodically refresh port mappings without blocking the main event loop.

**Performance Implication**: The single-threaded design means tinc cannot utilize multiple CPU cores for encryption/decryption or packet processing. All cryptographic operations, packet routing, and I/O handling occur in the main thread. High-throughput scenarios are limited by single-core performance, and one slow packet can stall the entire pipeline.

## Performance Optimizations Checklist

### Threading
- [ ] **Multi-threaded processing** - Single-threaded event loop (except UPnP thread)
- [ ] **Per-core packet queues** - N/A due to single-threaded design

### Packet I/O
- [x] **Batch UDP receives** - Uses `recvmmsg` on Linux for receiving multiple packets per syscall
- [ ] **Batch UDP sends** - Uses individual `sendto()` per packet, no `sendmmsg` support
- [x] **Large batch sizes** - Receives 64 packets per `recvmmsg` batch

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - No GSO support
- [ ] **UDP GRO (Generic Receive Offload)** - No GRO support

### Buffer Management
- [x] **Buffer pool reuse** - Limited: uses two-buffer swap pattern for compression/encryption; static array of 64 `vpn_packet_t` structures for batch receive
- [x] **Large UDP socket buffers** - 1MB default for both send and receive (vs ~200KB kernel default)

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - Relies on kernel TCP entirely
- [ ] **Large TCP RX/TX buffers** - Uses kernel default buffers (~128KB)
- [ ] **Tuned congestion control** - Uses kernel TCP congestion control (typically CUBIC)
- [ ] **Reordering tolerance** - Subject to kernel TCP reordering behavior

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No explicit coalescing
- [ ] **RX checksum offload** - Depends on NIC/kernel, not controlled by tinc

### MTU Handling
- [x] **Conservative MTU** - Discovers and uses appropriate MTU per path
- [x] **Path MTU discovery** - Active PMTU discovery with UDP probes

### Peer Management
- [x] **Lazy peer removal** - AutoConnect feature manages connections intelligently
- [x] **Endpoint caching** - Address cache maintains recently seen addresses
- [x] **Efficient keepalive timers** - Configurable UDP discovery keepalive intervals

### Packet Processing
- [ ] **Zero-allocation parsing** - Uses `alloca()` and `malloc()` in packet path
- [ ] **Zero-copy filtering** - Packets copied into buffers with offset mechanism

### State Synchronization
- [x] **Delta updates** - ADD_EDGE/DEL_EDGE sends incremental topology changes
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [x] **Tunnel compression** - Supports LZ4, LZO (low/high), and Zlib (levels 1-9)
- [x] **Configurable compression level** - Multiple compression algorithms and levels available

# Security

Tinc has had several security vulnerabilities discovered and patched over its history:

**CVE-2018-16737 & CVE-2018-16738** (2018): Oracle attacks in the legacy protocol allowed attackers to decrypt traffic by observing error messages. These were preventable padding oracle vulnerabilities in the legacy RSA-based encryption mode.

**CVE-2018-16758** (2018): Man-in-the-middle attack could force a NULL cipher for UDP traffic in the legacy protocol, completely removing encryption. This demonstrated the dangers of cipher negotiation without proper authentication.

**CVE-2013-1428** (2013): Large packets forwarded via TCP were not properly validated, leading to potential buffer overflows. Packets exceeding MTU when forwarded over TCP connections could cause crashes or potentially code execution.

**Security Concerns**:
- Legacy protocol still supported with known weaknesses (RSA without OAEP padding, CFB mode instead of AEAD)
- Bypass security mode (`--bypass-security` flag) completely disables authentication - dangerous if accidentally enabled
- C codebase with manual memory management presents ongoing memory safety risks
- Replay window is static (16-32 packets) which may be insufficient for high-latency networks

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No built-in rate limiting for DoS prevention
- [ ] **Stateful packet filter** - No connection tracking for ACLs
- [ ] **Fine-grained ACLs** - No per-port/protocol access control
- [ ] **Capability-based access** - Simple subnet-based routing only

### Identity & Authentication
- [x] **Identity validation** - Ed25519 public key cryptographic verification in SPTPS
- [ ] **Signed configuration updates** - Config files exchanged but not cryptographically signed
- [ ] **Certificate pinning** - Uses public key verification, not certificate-based

### Implementation
- [ ] **Memory-safe language** - Written in C with manual memory management
- [x] **Privilege separation** - Supports chroot and setuid for privilege dropping
- [x] **Sandboxing** - seccomp (Linux), Capsicum (FreeBSD), pledge (OpenBSD) support
- [ ] **Audit logging** - Basic logging but no dedicated security event logging

# NAT Traversal

Tinc has **limited NAT traversal capabilities** compared to modern mesh VPNs. It relies primarily on UPnP port forwarding and basic UDP hole punching through the meta protocol's reflexive address discovery.

**UPnP-IGD Support**: Optional automatic port forwarding using the miniupnpc library. A dedicated pthread periodically refreshes port mappings with configurable intervals. Supports both TCP and UDP port mappings.

**Reflexive Address Discovery**: During key exchange, ANS_KEY messages include the reflexive UDP address/port discovered from the source of incoming packets. Nodes share these discovered addresses via the meta protocol, allowing peers to attempt direct connections.

**UDP Probing**: Active UDP probing attempts to discover working paths between nodes with configurable discovery intervals, keepalive intervals, and timeout values. Local discovery attempts to find direct paths on the same LAN.

**Major Limitations**: No STUN/TURN protocol support means inability to traverse symmetric NAT. No ICE (Interactive Connectivity Establishment) protocol implementation. No relay fallback system for working through double NAT without manual port forwarding. UDP hole punching is rudimentary compared to modern coordination mechanisms.

## NAT Traversal Checklist

### Discovery
- [ ] **STUN support** - No STUN protocol implementation
- [ ] **Multiple STUN servers** - N/A
- [ ] **NAT type detection** - No formal NAT type detection

### Port Mapping
- [x] **UPnP port mapping** - Via miniupnpc library with configurable refresh periods
- [ ] **NAT-PMP support** - No NAT-PMP implementation
- [ ] **PCP support** - No Port Control Protocol support

### Hole Punching
- [x] **UDP hole punching** - Basic hole punching via reflexive address sharing
- [ ] **Symmetric NAT handling** - Cannot handle symmetric NAT reliably
- [x] **Rendezvous coordination** - Meta protocol coordinates address sharing between peers

### Fallback
- [ ] **Relay fallback** - No automatic relay when direct connection fails
- [ ] **Multiple relay regions** - N/A
- [ ] **Automatic relay selection** - N/A
- [x] **TCP relay support** - Can relay through intermediate nodes but not dedicated relay servers

# Local Routing

Tinc supports three routing modes providing different levels of network transparency:

**Router Mode (RMODE_ROUTER)**: Routes based on IP addresses with ARP/NDP proxying, IPv4 fragmentation support, and optional TTL decrementing. This mode operates at Layer 3 and is suitable for connecting IP subnets.

**Switch Mode (RMODE_SWITCH)**: Routes based on MAC addresses, learning MAC addresses dynamically like a physical Ethernet switch. Maintains a MAC expiry table with 600-second timeout. Operates at Layer 2 for full Ethernet transparency.

**Hub Mode (RMODE_HUB)**: Broadcasts all packets to all nodes. Simplest but least efficient mode, suitable for small networks or special requirements.

**Local Traffic Optimization**: The local discovery feature attempts to find direct paths on the same LAN by having peers share their local addresses. When nodes are on the same subnet, tinc prefers the direct LAN path over routing through the internet. Local addresses are randomly selected from available edges to distribute load.

## Local Routing Checklist

### LAN Discovery
- [x] **Broadcast/multicast discovery** - Local discovery tries direct LAN paths
- [x] **Direct path advertisement** - Peers share reachable endpoints via meta protocol
- [x] **Same-subnet detection** - Identifies and prefers peers on same network

### LAN Optimization
- [x] **Automatic LAN preference** - Prefers local over WAN paths when available
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [ ] **LAN-only mode** - No restriction to local network only

### Routing Features
- [x] **Subnet routes** - ADD_SUBNET messages advertise subnet routing through peers
- [x] **Full tunnel mode** - Can route all traffic through a peer (router mode)
- [x] **Split tunneling** - Subnet-based routing provides selective VPN routing
- [ ] **Route priorities** - No explicit HA/failover route selection (uses graph algorithms)

# Central Point of Failure

**Tinc has NO central point of failure** - it is a true peer-to-peer mesh network.

**Decentralized Topology**: Each node maintains a full network graph with all edge and subnet information. Nodes share topology updates via ADD_EDGE/DEL_EDGE and ADD_SUBNET/DEL_SUBNET messages over the meta protocol. Routing is recalculated automatically when nodes join or leave the network using Kruskal's MST for broadcast routing and Dijkstra's SSSP for unicast routing.

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
- [x] **Pre-authentication keys** - Host config files allow headless/automated enrollment
- [ ] **OAuth/OIDC** - No SSO integration
- [x] **Interactive login** - Invitation system provides URL-based enrollment
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

**Platform Implementations**: Linux support uses native tun/tap devices with netlink for route management. BSD family (FreeBSD, OpenBSD, NetBSD, DragonFlyBSD) uses tun/tap with auto-clone devices. macOS uses utun devices or the tunemu fallback implementation. Windows uses the TAP-Windows adapter. Solaris has dedicated device support. Android is supported via fd (file descriptor) passing for non-root operation.

**Implementation Details**: Tinc runs entirely in userspace, with the main daemon process handling all packet encryption, decryption, and routing. Packets are read from the tun/tap device, encrypted, and sent over UDP (or TCP). Received encrypted packets are decrypted and written to the tun/tap device for the kernel to route.

**Security Features**: Platform-specific sandboxing includes seccomp on Linux, Capsicum on FreeBSD, and pledge on OpenBSD. All platforms support privilege dropping via chroot and setuid after initialization. Optional memory locking (mlockall) prevents swapping of sensitive key material.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support with tun/tap, netlink, seccomp
- [x] **macOS** - Full support with utun/tunemu
- [x] **Windows** - Full support with TAP-Windows adapter
- [x] **FreeBSD/OpenBSD** - Full BSD family support with Capsicum/pledge

### Mobile
- [ ] **iOS** - No official iOS app
- [x] **Android** - Supported via fd passing (DeviceType = fd) for non-root operation

### Implementation
- [ ] **Kernel-mode datapath** - No in-kernel packet processing
- [x] **Userspace implementation** - Runs entirely in userspace with tun/tap devices
- [x] **Container support** - Works in containers with appropriate tun/tap device access
