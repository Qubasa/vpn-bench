# Overview

Mycelium is an IPv6 overlay mesh VPN written in Rust by ThreeFold Tech. Each node that joins the network receives an overlay IP address in the 400::/7 range, cryptographically derived from its public key, and owns the /64 that contains this address. The architecture is fully decentralized with no central controller required.

## Key Architecture Components

- **Router**: Core routing logic using a modified Babel protocol (RFC 8966) for distributed route discovery and convergence
- **PeerManager**: Manages peer connections, discovery (static config, link-local multicast, inbound), and connection lifecycle
- **DataPlane**: Handles end-to-end packet encryption/decryption (static-static X25519 + AES-256-GCM) and forwarding between the TUN interface and the router
- **MessageStack**: Optional reliable message bus built on top of the encrypted tunnel, with topic-based filtering
- **Connection Layer**: Abstracts transport protocols (plain TCP, QUIC, and TLS 1.3-PSK over TCP for private networks) behind a common connection trait
- **Optional extras**: SOCKS5 proxy discovery/forwarding over the overlay, a DNS forwarder (binds UDP port 53 and forwards to the system resolvers), and a CDN cache module

The design is locality-aware, automatically routing traffic over the shortest path with automatic failover if links go down.

# Protocol

Mycelium uses a modified implementation of the Babel routing protocol (RFC 8966 version 3) for control plane communication. The implementation deviates from the standard to fit specific use cases and only implements a subset of TLVs: Hello (Type 4), IHU/I Heard You (Type 5), Update (Type 8), RouteRequest (Type 9), and SeqNoRequest (Type 10).

**Control Plane**: Babel packets are exchanged between peers over the same transport connections (TCP, TLS or QUIC) used for data packets; on QUIC links they use a reliable bidirectional stream. The protocol uses well-defined intervals:
- HELLO every 20 seconds per peer for link cost calculation (RTT-based)
- IHU (I Heard You) sent in reply to every HELLO; the IHU carries a 60-second interval value
- Own (static) routes re-announced every 300 seconds; other routes propagate through triggered updates on significant changes and through on-demand route requests (a full table dump only answers a wildcard route request), with feasibility-based loop prevention
- Dead peer threshold at 43 seconds (two missed HELLOs + 3 s)

**Data Plane**: IPv6 packets are read from the TUN interface (non-IPv6 packets are dropped), encrypted end-to-end with AES-256-GCM using the static shared key of the destination node, and sent to the next hop chosen by the routing table. Intermediate nodes forward the packet based on a cleartext header (hop limit, source and destination overlay IP) without being able to decrypt it. Per-packet overhead is 72 bytes (4-byte packet header, 36-byte data header, 4-byte inner header, 16-byte tag, 12-byte nonce) on top of the transport framing.

**Supported Transports** (peer URIs `tcp://`, `quic://`, `tls://`; default port 9651 for both TCP and QUIC):
- **TCP**: Default transport over IPv4 or IPv6, with Nagle disabled. The hop-by-hop link is not encrypted, so Babel control traffic and data packet headers are visible on the wire. Peers found by link-local discovery are always connected over TCP.
- **QUIC**: quinn over UDP with TLS 1.3 (rustls), path MTU discovery enabled, 20-second keep-alive to maintain NAT mappings, 60-second idle timeout. Server certificates are self-signed and not verified. QUIC is disabled in private network mode.
- **TLS**: Private network mode (separate `mycelium-private` binary, marked experimental) replaces plain TCP with TLS 1.3-PSK over TCP via OpenSSL (supports at least TLS_AES_128_GCM_SHA256 and TLS_CHACHA20_POLY1305_SHA256)

Since v0.7.0, data packets are sent as unreliable QUIC datagrams when using QUIC transport, while control packets stay on the reliable stream. A full-size packet from the 1400-byte TUN MTU becomes a 1472-byte datagram. This is larger than quinn's maximum datagram size, which is 1462 bytes at the configured initial MTU of 1500 and smaller after black-hole fallback or on paths with a lower MTU. In that case `send_datagram` fails with `TooLarge`, and the peer task treats the error as fatal and closes the link. Bulk transfers over QUIC links are therefore likely to break on full-size packets (code analysis; not reproduced).

## Protocol Features Checklist

### Transport
- [ ] **UDP transport** - QUIC runs over UDP, but no raw UDP mode
- [x] **TCP fallback** - Plain TCP is the default transport and also works when UDP is blocked
- [x] **QUIC support** - quinn-based; data as QUIC datagrams, control on a stream; not available in private network mode
- [ ] **WebSocket support** - Not implemented

### IP Support
- [ ] **IPv4 support** - IPv6 overlay only (400::/7)
- [x] **IPv6 support** - Native IPv6 tunneling
- [ ] **Dual-stack** - Overlay is IPv6-only; underlay can use IPv4 or IPv6

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing via TUN interface
- [ ] **Layer 2 (Ethernet) mode** - No Ethernet frame support
- [ ] **Bridging support** - Cannot bridge non-VPN devices

### Advanced
- [ ] **Multipath/bonding** - A node can hold several links (e.g. TCP and QUIC) to the same neighbour, but each destination uses one selected route; other routes are failover only
- [ ] **QoS/traffic shaping** - No priority queues or traffic classes
- [ ] **Multicast support** - No virtual multicast/broadcast for data plane

# Encryption

Mycelium encrypts all data packets end-to-end. Hop-by-hop link encryption depends on the transport: plain TCP links (the default) are unencrypted, QUIC links use TLS 1.3 with unverified self-signed certificates, and private network mode wraps TCP in TLS 1.3-PSK.

**Key Exchange**: There is no handshake. Each node has a long-term static X25519 key pair. The 32-byte public key is part of the node's RouterId (40 bytes: public key, 2-byte zone, 6 random bytes), which is carried in Babel route updates. When a route is installed, the node computes the static-static X25519 shared secret with the destination's public key and caches it in the routing table. The raw 32-byte X25519 output is used directly as the AES-256 key, without a KDF. The IPv6 overlay address is derived from a BLAKE3 hash of the public key, with the first byte forced to 0x04 or 0x05 so that it falls in 400::/7.

**Data Encryption**: All data packets are encrypted with AES-256-GCM (RustCrypto `aes-gcm`). Each packet uses a fresh random 12-byte nonce from the OS RNG and carries a 16-byte tag; nonce and tag are appended to the ciphertext. The key never changes for a given node pair, and a new `Aes256Gcm` instance (AES key schedule) is created for every packet.

**Private Network Mode**: Experimental and only available in the separate `mycelium-private` binary. Connections are wrapped in TLS 1.3 with pre-shared key (PSK) authentication via OpenSSL. The network name (2-64 bytes) is sent in cleartext as the TLS PSK identity, and both parties must share a 32-byte PSK. QUIC is disabled in this mode. This provides network-level isolation and hop-by-hop encryption of control traffic.

**Identity Binding**: The RouterIdOwnsSubnet filter accepts a route update only if the announced subnet contains the address derived from the RouterId in that update. Updates are not signed, so a node can re-announce another node's subnet together with that node's real RouterId. Because data is encrypted to that RouterId's public key, this can attract or blackhole traffic but cannot decrypt it.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - X25519 ECDH
- [ ] **Perfect Forward Secrecy** - End-to-end keys are static-static X25519; leaking a node key decrypts all past and future traffic to and from it. Only the QUIC/TLS hop links use ephemeral keys
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [ ] **Key rotation** - No automatic periodic key refresh

### Symmetric Encryption
- [x] **Authenticated encryption** - AES-256-GCM (not ChaCha20-Poly1305)
- [x] **Hardware-accelerated crypto** - Partial: the `aes` crate detects AES-NI at runtime on x86/x86_64; aarch64 builds (Apple Silicon, ARM Linux, mobile) fall back to software AES because the `aes_armv8` cfg flag is not set
- [x] **Constant-time operations** - RustCrypto `aes-gcm` (constant-time software fallback) and `x25519-dalek`

### Protocol Security
- [ ] **Replay protection** - Random nonces, no counter or replay window; captured packets can be replayed exactly
- [ ] **Noise Protocol or equivalent** - Custom protocol, not Noise-based
- [ ] **No cleartext metadata** - On default TCP links, Babel updates (RouterId = public key) and every data packet header (source/destination overlay IP) are in cleartext; link-local discovery beacons broadcast the RouterId; the private-network name is sent in cleartext

# Performance

Mycelium uses an async architecture built on the Tokio multi-threaded runtime. The Router spawns concurrent tasks for different responsibilities: periodic hello sender, incoming control packet dispatcher (with one processor task per TLV type), incoming data packet handler, static route propagation, dead peer detection, and expired key/route cleanup.

**Threading**: The data path is a pipeline of single tasks. On Linux, macOS, Android and iOS, one task does all TUN reads and writes (single queue). One DataPlane task parses, routes and encrypts every outgoing packet, and one task decrypts every incoming packet. One router task forwards all packets received from peers. Each neighbour connection has its own task for framing and socket I/O. Encryption and decryption therefore use at most one core per direction, regardless of the number of peers. Windows uses two blocking threads for Wintun RX/TX. A configurable worker pool (`--update-workers`, default 1) processes Babel route updates in parallel using spawn_blocking, with updates hashed by subnet to distribute load.

**Concurrency Primitives**: The routing table is a `left_right` structure (lock-free reads, writes serialized by a Mutex); peer and source tables use `RwLock`. The PeerManager and the SOCKS proxy keep the Router behind a Mutex, but the data path does not use it. Inter-task channels are mixed: the router's data channel and the TUN sink are bounded (1000), while per-peer data/control queues, the TUN read stream and most control channels are unbounded Tokio mpsc channels.

**Bottlenecks**:
- A single encrypt task and a single decrypt task cap crypto throughput at one core per direction, and a new AES-256 key schedule is computed for every packet
- Route and key lookups for unknown destinations block the worker thread (block_in_place with 100 ms sleeps, up to 50 iterations = 5 seconds max), stalling the whole send or receive pipeline behind that packet
- No buffer pooling: a fresh ~1432-byte PacketBuffer per TUN read (reused only when no packet was read), a 1500-byte BytesMut per QUIC datagram, and a fresh Vec per decoded packet
- QUIC datagrams cannot carry full-size 1400-byte inner packets (see Protocol)

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Partial: Tokio multi-threaded runtime and per-peer I/O tasks, but all encryption runs in one task and all decryption in another
- [ ] **Per-peer packet queues** - Each neighbour has its own unbounded send queue and I/O task, but encryption and decryption are centralized, not per peer

### Packet I/O
- [x] **Batch UDP receives** - Partial: QUIC links only; quinn-udp uses recvmmsg (32 messages per call) on Linux. TCP links and TUN reads are per packet
- [ ] **Batch UDP sends** - No sendmmsg; quinn-udp sends with sendmsg plus UDP GSO on Linux
- [ ] **Large batch sizes** - quinn caps GSO at 10 segments per transmit and recvmmsg at 32 messages; per-peer coalescing feeds up to 50 packets into the framed writer before one flush (application-level, not syscall batching)

### UDP Offload
- [x] **UDP GSO (Generic Segmentation Offload)** - Partial: QUIC links only; quinn enables segmentation offload by default on the shared endpoint (client and server side), up to 10 segments per send
- [x] **UDP GRO (Generic Receive Offload)** - Partial: QUIC links only; quinn-udp enables UDP_GRO on the socket

### Buffer Management
- [ ] **Buffer pool reuse** - No buffer pool; per-packet allocation
- [ ] **Large UDP socket buffers** - SO_RCVBUF/SO_SNDBUF are not set (kernel defaults); the 16 MiB QUIC datagram buffers are quinn-internal queues, not socket buffers

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - None; kernel TCP for TCP links and the host stack for tunneled traffic
- [ ] **Large TCP RX/TX buffers** - Kernel defaults (~128KB)
- [ ] **Tuned congestion control** - TCP links use the kernel default; QUIC uses quinn's default Cubic (a 4 MiB initial-window Cubic config is built in the code but never applied); server-side QUIC send window 80 MiB and stream receive window 10 MiB
- [ ] **Reordering tolerance** - Kernel TCP handling

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - Only UDP GRO on QUIC links; no coalescing of tunneled packets
- [ ] **RX checksum offload** - Relies on kernel/NIC defaults

### MTU Handling
- [x] **Conservative MTU** - 1400-byte TUN MTU on all platforms
- [x] **Path MTU discovery** - Partial: QUIC DPLPMTUD via quinn (initial MTU 1500, upper bound 1452); it only sizes QUIC packets, the TUN MTU stays fixed at 1400

### Peer Management
- [ ] **Lazy peer removal** - Dead peer threshold is 43 seconds; not explicitly lazy
- [ ] **Endpoint caching** - No endpoint caching; static peers are retried every 5 seconds, link-local peers are forgotten after 3 failed attempts
- [x] **Efficient keepalive timers** - 20-second QUIC keep-alive; protocol timers for Hello/IHU

### Packet Processing
- [ ] **Zero-allocation parsing** - Decoding copies each packet into a new Vec; no pooling
- [ ] **Zero-copy filtering** - No explicit zero-copy techniques

### State Synchronization
- [x] **Delta updates** - Triggered updates for changed routes and on-demand route requests; only the node's own route is re-announced periodically (300 s)
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression
- [ ] **Configurable compression level** - Not applicable

# Security

No severe publicly disclosed security vulnerabilities (CVEs) were found in documentation or source code comments.

**Identified Security Concerns**:

1. **QUIC Certificate Verification Skipped**: QUIC clients use SkipServerVerification and accept ANY certificate. Nodes present an rcgen self-signed certificate with the RouterId as subject alternative name, not signed by the node key. Link-level QUIC therefore has no peer authentication, and an on-path attacker can MITM the hop link and read or alter Babel control traffic; end-to-end encrypted payloads remain protected. Plain TCP links, the default, have no link encryption at all.

2. **No Replay Protection**: Random nonces prevent identical ciphertext for the same plaintext, but captured (nonce, ciphertext) pairs can be replayed exactly. The receiver has no sequence number tracking to detect replayed packets. Attackers could re-execute commands, poison routing tables temporarily, or cause DoS via replay flooding.

3. **Unbounded Channels**: Several unbounded mpsc channels exist that could lead to memory exhaustion under attack scenarios.

4. **Limited Rate Limiting**: Inbound QUIC handshakes are capped at 10 concurrent with a 10-second timeout, Update and SeqNo-request queues are bounded and drop excess TLVs, and duplicate route requests are suppressed by a cache. Hello, IHU and route-request queues and the per-peer queues are unbounded, and there are no per-source limits, so the system can still be stressed by flooding.

5. **Route Table Poisoning Risk**: Route updates are not signed. RouterIdOwnsSubnet only checks that the announced subnet contains the address derived from the RouterId in the same update, and retractions (infinite metric) are exempt. A malicious node can therefore retract routes it does not own, or re-announce a victim's /64 with the victim's real RouterId at a low metric to attract and drop its traffic (it cannot decrypt it).

6. **PSK Handling**: The 32-byte PSK is stored in memory without explicit secure wiping on drop; network name is sent in cleartext during TLS-PSK handshake.

7. **Blocking in Async Context**: Route queries use block_in_place with thread sleeps, which can cause performance degradation under load.

8. **Static Key with Random Nonces**: The AES-256-GCM key for a node pair is the raw X25519 output and never changes, and nonces are random 96-bit values. NIST SP 800-38D limits random-nonce GCM to 2^32 messages per key, which is reached after about 14 hours of a 1 Gbit/s flow of full-size packets. A nonce collision leaks the XOR of the two plaintexts and enables tag forgery for that pair.

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - Partial: inbound QUIC handshake cap (10 concurrent, 10 s timeout), bounded Update/SeqNo queues with drops, route-request cache; no per-source limits
- [ ] **Stateful packet filter** - No connection tracking for ACLs
- [ ] **Fine-grained ACLs** - Only a per-topic source-subnet allow list for the message subsystem; no L3/L4 ACLs
- [ ] **Capability-based access** - Simple allow/deny via route filters

### Identity & Authentication
- [x] **Identity validation** - RouterIdOwnsSubnet filter validates route ownership via cryptographic binding
- [ ] **Signed configuration updates** - Route updates are unsigned; only the subnet/RouterId consistency check
- [ ] **Certificate pinning** - No control-plane server; QUIC peer certificates are not verified at all

### Implementation
- [x] **Memory-safe language** - Written in Rust
- [ ] **Privilege separation** - Runs as root (or with CAP_NET_ADMIN) for its whole lifetime; no privilege drop after TUN creation
- [x] **Sandboxing** - Partial: only the shipped systemd unit (ProtectSystem, ProtectHome, CapabilityBoundingSet=CAP_NET_ADMIN); no in-process sandbox
- [x] **Audit logging** - Partial: the default level is INFO, but decryption failures, ACL drops, filter-denied route updates and failed private-network TLS handshakes are logged only at debug; only failed ICMP body decryption warns (`myceliumd/src/main.rs:486-497`, `mycelium/src/data.rs:344,441`, `mycelium/src/message.rs:400-401`)

# NAT Traversal

Mycelium has LIMITED NAT traversal capabilities. According to the README, "we are working on holepunching for Quic which means P2P traffic without middlemen for NATted networks" - indicating this is future work.

**Current Behavior**:
- Nodes behind single NAT can connect OUTBOUND to public nodes successfully
- Once connected, QUIC keep-alive (20 seconds) maintains NAT mappings
- Double NAT scenarios require traffic to relay through public nodes
- No coordinated hole punching mechanism exists
- Nodes only connect to configured peers, inbound peers and link-local discovered peers; there is no mechanism to open a direct connection to an arbitrary overlay destination, so traffic follows the peer graph (often via public nodes)

**What's Missing**:
- No STUN client for public IP/port discovery
- No ICE (Interactive Connectivity Establishment)
- No TCP simultaneous open or UDP hole punching coordination
- No signaling mechanism for coordinating punch attempts between peers

The architecture relies on having some publicly accessible nodes (10 hosted public nodes are provided) that act as relays for NATted peers. The Babel routing protocol automatically routes traffic through these relays when direct connections aren't possible.

## NAT Traversal Checklist

### Discovery
- [x] **No own public node needed** - Partial: ThreeFold's hosted public nodes connect NATed nodes, but `--peers` is empty by default and the README asks the user to add them by hand (`myceliumd/src/main.rs:283-285`, `README.md:95-122`)
- [ ] **STUN support** - No STUN client implementation
- [ ] **Multiple STUN servers** - Not applicable
- [ ] **NAT type detection** - No NAT behavior detection

### Port Mapping
- [ ] **UPnP port mapping** - Not implemented
- [ ] **NAT-PMP support** - Not implemented
- [ ] **PCP support** - Not implemented

### Hole Punching
- [ ] **UDP hole punching** - Not implemented (planned for QUIC)
- [ ] **Symmetric NAT handling** - Not implemented
- [ ] **Rendezvous coordination** - No coordination server/protocol

### Fallback
- [x] **Relay fallback** - Automatic relay through public/reachable nodes via Babel routing
- [x] **Multiple relay regions** - 10 public nodes across multiple geographic regions (DE, BE, FI, US-EAST, US-WEST, SG, IND)
- [x] **Automatic relay selection** - Babel routing automatically selects lowest-cost path
- [x] **TCP relay support** - Relays work over both TCP and QUIC transports

# Local Routing

Mycelium supports local peer discovery and direct local routing without relaying through external nodes.

**LAN Discovery**: Nodes perform IPv6 link-local multicast discovery on ff02::cafe (UDP port 9650 by default) on every interface that is up, multicast-capable, not loopback or tunnel, and has a fe80:: address. Every 60 seconds, nodes send a 50-byte beacon containing the magic bytes "mycelium" (8), their TCP listen port (2) and their RouterId (40). Beacons are accepted only from fe80::/64 sources. The sender is added with PeerType::LinkLocalDiscovery, connected over TCP (TLS in private mode), and forgotten after 3 failed connection attempts.

**Direct Routing**: When a local peer is discovered, it's added to the Babel routing table like any other peer. The route_packet() function performs routing table lookups and selects the best route based on metrics. If the best route is the local peer, packets are sent directly without relay.

**Metric Calculation**: Link costs are calculated from Hello/IHU RTT measurements using EWMA smoothing (factor 9/10). The default link cost starts at 1000ms. QUIC connections have lower base processing cost (7ms for IPv6, 12ms for IPv4) compared to TCP (10ms for IPv6, 15ms for IPv4), so QUIC is preferred when both are available.

Local routes have the same encryption as remote routes - there's no "trusted path mode" to skip encryption on LANs.

## Local Routing Checklist

### LAN Discovery
- [x] **Broadcast/multicast discovery** - IPv6 multicast on ff02::cafe every 60 seconds
- [x] **Direct path advertisement** - Partial: nodes advertise their own TCP port only through the link-local beacon; Babel updates carry overlay routes, not underlay endpoints
- [x] **Same-subnet detection** - Discovery is limited to the same link (fe80::/64 sources on the receiving interface)

### LAN Optimization
- [x] **Automatic LAN preference** - Lower RTT on local links results in better metrics, automatic preference
- [ ] **Trusted path mode** - No option to skip encryption on LANs
- [x] **LAN-only mode** - Partial: no explicit switch; running without `--peers` leaves only link-local discovered peers

### Routing Features
- [x] **Subnet routes** - Partial: each node announces only its key-derived /64 (announcements must contain the RouterId's address and be /64 or smaller), so hosts or VMs can use addresses from that /64; arbitrary LAN prefixes or IPv4 subnets cannot be routed
- [x] **Full tunnel mode** - Partial: only 400::/7 is routed via the TUN; the closest feature is SOCKS5 proxy support (auto-discovery of open SOCKS5 proxies on overlay nodes and forwarding of local SOCKS connections to one), which is application-level
- [ ] **Split tunneling** - Overlay is separate; no split tunneling of regular internet traffic
- [ ] **Route priorities** - Only the owner of a /64 can announce it, so there is no HA between routers for the same subnet; Babel does fail over between alternative paths to the same node

# Central Point of Failure

Mycelium has NO central point of failure - the architecture is fully decentralized and peer-to-peer.

**Decentralized Architecture**:
- No central controller or coordination server required
- Babel routing protocol runs distributedly on all nodes
- Each node maintains its own routing table and makes independent forwarding decisions
- Route information propagates peer-to-peer via Update TLVs

**Public Nodes Are Optional**: ThreeFold provides 10 public nodes (in DE, BE, FI, US-EAST, US-WEST, SG, IND) for bootstrapping convenience, but these are NOT required. Users can:
1. Run entirely on static peer configuration
2. Use only link-local multicast discovery for LAN-only networks
3. Self-host public relay nodes

**Controller Down Scenarios**: Since there is no controller, this is not applicable. If a relay node fails:
- Babel reroutes once the dead peer is detected (43 s threshold): routes through the dead peer are retracted with triggered updates, and alternative routes are selected from fallback routes already in the table or via route requests
- Existing peer connections to other nodes remain unaffected
- Local routing table persists in memory only (no disk persistence)

**Operational Continuity**: Existing tunnel connections survive network partitions. As long as peers maintain connectivity, data continues flowing. There's no authentication server to check, no license server, no policy controller.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Tunnels stay up without any controller (none exists)
- [ ] **Local state caching** - Routing table and runtime-added peers are in memory only; nothing is persisted except the key file and static config
- [ ] **Cached credentials** - Identity is the keypair on disk; no credential caching needed
- [x] **Graceful degradation** - Babel routing handles partition/connectivity loss automatically

### Redundancy
- [ ] **Self-hosted controller** - Not applicable: no controller exists; nodes and public relay nodes can all be self-hosted
- [ ] **Controller redundancy** - Not applicable (no controller)
- [x] **Relay redundancy** - Multiple relay nodes supported; automatic failover via routing
- [x] **No single root of trust** - Fully distributed trust model; identity from keypairs

### Efficiency
- [x] **Delta/incremental updates** - Triggered updates on route changes and on-demand route requests; only the node's own route is re-announced every 300 seconds
- [ ] **Long polling / push updates** - Not applicable (no controller)
- [ ] **Configurable sync interval** - Protocol timers are hardcoded constants

# Authentication

Mycelium uses cryptographic identity-based authentication rather than traditional credentials. There is no separate enrollment or authentication process - identity IS the keypair.

**Node Identity**: Each node generates or loads an x25519 keypair. The 32-byte public key forms the RouterId, which is the node's identity. The IPv6 overlay address (in 400::/7) is derived from BLAKE3(public_key) with bit mangling to ensure correct range. This cryptographic binding prevents IP spoofing.

**Joining the Network**:
1. Node generates/loads private key from disk (default: `priv_key.bin` in the platform data directory, e.g. `~/.local/share/mycelium/priv_key.bin` on Linux; override with `-k`)
2. Derives public key and overlay IP address
3. Connects to peers via static configuration, link-local discovery, or inbound connections
4. No enrollment, approval, or authentication step - connection is immediate

**Private Network Mode** (experimental, `mycelium-private` binary): When enabled, adds TLS-PSK authentication:
- Network name (2-64 characters) sent as TLS identity
- 32-byte pre-shared key required by both sides
- TLS 1.3 handshake must succeed before peer is added
- Provides network-level isolation - only nodes with correct name+PSK can connect

**Route Authentication**: The RouterIdOwnsSubnet filter checks that route announcements contain the IP derived from the RouterId carried in the same update. Updates are unsigned, so this prevents announcing foreign address space under one's own identity, but not re-announcing another node's subnet with that node's RouterId.

**No Traditional Auth**: No usernames, passwords, OAuth, SSO, or admin approval workflows exist.

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Partial: only the private-network PSK (experimental, `mycelium-private`) gates joining; the public network has no enrollment
- [ ] **Certificate-based enrollment** - No certificates or CA
- [ ] **OAuth/OIDC** - Not supported
- [ ] **Interactive login** - No login process
- [ ] **CLI authentication** - No auth flow

### Authorization
- [ ] **Admin approval workflow** - No approval required; automatic join
- [ ] **Automated enrollment rules** - Any node with correct PSK (if private network) can join
- [ ] **Ephemeral nodes** - No automatic cleanup; peers removed when dead (43s threshold)
- [ ] **Node expiry** - No time-limited authorization

### Identity
- [x] **Stable device identity** - Keypair persists on disk across restarts
- [x] **Identity portability** - Can copy priv_key.bin to move identity between devices
- [ ] **Multi-user support** - One identity per node; no user concept

# Platform Support

Mycelium supports desktop, server, and mobile platforms with userspace TUN interface implementations.

**Desktop/Server**: Linux, macOS and Windows. The TUN interface is created with tokio-tun on Linux, a fork of the `tun` crate (LeeSmet/rust-tun) on macOS, Android and iOS, and Wintun on Windows. All platforms use a single TUN queue. Nodes can optionally run in no-TUN mode for message-only operation (no L3 traffic); on other operating systems this is the only mode.

**Mobile**: Android and iOS are supported through the in-repo `mobile` FFI crate, which is called from Flutter, Kotlin or Swift (the app itself lives outside this repo). TUN creation must happen in native code, and the TUN file descriptor is passed to Mycelium via the tun_fd config option (the `mactunfd` feature does the same for the macOS app).

**Implementation Details**:
- Userspace implementation in Rust (no kernel module)
- TUN interface for Layer 3 packet injection/capture
- Default MTU: 1400 bytes (all platforms)
- Integrates with system routing tables (adds routes for 400::/7 via TUN)
- Firewall mark support on Linux for policy routing

**Container Support**: The repo ships a Dockerfile and compose.yml (host networking, /dev/net/tun, CAP_NET_ADMIN), and a CI workflow publishes linux/amd64 and linux/arm64 images to GHCR.

**Cross-Compilation**: Release binaries are built for x86_64/aarch64 Linux (musl) and macOS, plus a Windows MSI installer; the `vendored-openssl` feature statically links OpenSSL for the private-network binary.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support
- [x] **macOS** - Full support
- [x] **Windows** - Wintun-based; MSI installer available
- [ ] **FreeBSD/OpenBSD** - No TUN support; other platforms can only run with --no-tun

### Mobile
- [x] **iOS** - Via the in-repo `mobile` FFI crate; TUN FD passed from Swift
- [x] **Android** - Via the in-repo `mobile` FFI crate; TUN FD passed from Kotlin

### Implementation
- [ ] **Kernel-mode datapath** - Not using WireGuard kernel module
- [x] **Userspace implementation** - Fully userspace Rust implementation
- [x] **Container support** - Dockerfile, compose.yml and GHCR images (amd64/arm64)
