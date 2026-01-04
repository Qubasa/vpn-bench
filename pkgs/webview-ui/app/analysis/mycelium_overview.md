# Overview

Mycelium is an IPv6 overlay mesh VPN written in Rust by ThreeFold Tech. Each node that joins the network receives an overlay IP address in the 400::/7 range, cryptographically derived from its public key. The architecture is fully decentralized with no central controller required.

## Key Architecture Components

- **Router**: Core routing logic using a modified Babel protocol (RFC 8966) for distributed route discovery and convergence
- **PeerManager**: Manages peer connections, discovery (static config, link-local multicast, inbound), and connection lifecycle
- **DataPlane**: Handles packet encryption/decryption (X25519 + AES-256-GCM) and forwarding between TUN interface and peers
- **MessageStack**: Optional reliable message bus built on top of the encrypted tunnel, with topic-based filtering
- **Connection Layer**: Abstracts transport protocols (TCP, QUIC) with pluggable connection types

The design is locality-aware, automatically routing traffic over the shortest path with automatic failover if links go down.

# Protocol

Mycelium uses a modified implementation of the Babel routing protocol (RFC 8966 version 3) for control plane communication. The implementation deviates from the standard to fit specific use cases and only implements a subset of TLVs: Hello (Type 4), IHU/I Heard You (Type 5), Update (Type 8), RouteRequest (Type 9), and SeqNoRequest (Type 10).

**Control Plane**: Babel packets are exchanged between peers over the same transport connections (TCP or QUIC) used for data packets. The protocol uses well-defined intervals:
- HELLO every 20 seconds for link cost calculation (RTT-based)
- IHU (I Heard You) every 60 seconds
- Route Updates every 300 seconds with feasibility-based loop prevention
- Dead peer threshold at 43 seconds

**Data Plane**: IPv6 packets are read from the TUN interface, encrypted with per-packet AES-256-GCM, and sent to the appropriate peer based on routing table lookups. Traffic can be routed through intermediate nodes transparently.

**Supported Transports**:
- **TCP**: Primary transport over both IPv4 and IPv6
- **QUIC**: UDP-based with MTU discovery enabled, 20-second keep-alive to maintain NAT mappings
- **TLS**: Optional TLS-PSK wrapper for private network mode (supports TLS_AES_128_GCM_SHA256 and TLS_CHACHA20_POLY1305_SHA256)

Data packets are sent as QUIC datagrams when using QUIC transport, providing lower latency than stream mode.

## Protocol Features Checklist

### Transport
- [ ] **UDP transport** - QUIC runs over UDP, but no raw UDP mode
- [x] **TCP fallback** - Primary transport; works through restrictive firewalls
- [x] **QUIC support** - Modern multiplexed transport with MTU discovery
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
- [ ] **Multipath/bonding** - Single connection per peer, no aggregation
- [ ] **QoS/traffic shaping** - No priority queues or traffic classes
- [ ] **Multicast support** - No virtual multicast/broadcast for data plane

# Encryption

Mycelium uses a two-layer encryption approach: an optional TLS wrapper for private networks, and mandatory end-to-end encryption for all data packets.

**Key Exchange**: X25519 Elliptic Curve Diffie-Hellman is used to derive shared secrets between nodes. The public key (32 bytes) forms the node's identity (RouterId), and the IPv6 overlay address is cryptographically derived from a BLAKE3 hash of this public key with bit mangling to ensure it falls in the 400::/7 range.

**Data Encryption**: All data packets are encrypted with AES-256-GCM authenticated encryption. Each packet uses a random 12-byte nonce and includes a 16-byte authentication tag. The encryption happens per-packet with new random nonces.

**Private Network Mode**: When enabled, connections are wrapped in TLS 1.3 with Pre-Shared Key (PSK) authentication. The network name is sent as the TLS identity, and both parties must share a 32-byte PSK to establish connections. This provides network-level isolation.

**Identity Binding**: The system prevents IP spoofing through a RouterIdOwnsSubnet filter that validates announced subnets contain the IP address derived from the announcing router's public key.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - X25519 ECDH
- [ ] **Perfect Forward Secrecy** - Static keys, no ephemeral session keys or key rotation
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [ ] **Key rotation** - No automatic periodic key refresh

### Symmetric Encryption
- [x] **Authenticated encryption** - AES-256-GCM (not ChaCha20-Poly1305)
- [x] **Hardware-accelerated crypto** - AES-GCM benefits from AES-NI
- [x] **Constant-time operations** - Uses constant-time crypto libraries

### Protocol Security
- [ ] **Replay protection** - Random nonces but no sequence number tracking; vulnerable to exact packet replay
- [ ] **Noise Protocol or equivalent** - Custom protocol, not Noise-based
- [ ] **No cleartext metadata** - Data is encrypted but QUIC/TLS certificates are self-signed; network name sent in cleartext for TLS-PSK

# Performance

Mycelium uses an async/multi-threaded architecture built on Tokio. The Router spawns multiple concurrent tasks for different responsibilities: periodic hello sender, incoming control packet handler, incoming data packet handler, static route propagation, dead peer detection, and expired key/route cleanup.

**Threading**: The system uses async tasks rather than OS threads, allowing efficient concurrency. A configurable worker pool (update_workers setting) processes Babel route updates in parallel using spawn_blocking for CPU-bound work, with updates hashed by subnet to distribute load.

**Concurrency Primitives**: The routing table uses Arc<RwLock<>> for concurrent reads, the router itself is wrapped in a Mutex, and inter-task communication happens via unbounded Tokio mpsc channels.

**Bottlenecks**:
- Router mutex creates potential contention under high packet rates
- Route queries use blocking operations (block_in_place with 100ms sleep iterations, up to 50 iterations = 5 seconds max)
- No buffer pooling; PacketBuffer structs allocate ~1400 bytes per packet
- Frequent write-locking of routing table despite RwLock

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Async tasks with configurable worker pool for route updates
- [ ] **Per-core packet queues** - Shared queues, no per-core isolation

### Packet I/O
- [ ] **Batch UDP receives** - No recvmmsg usage
- [ ] **Batch UDP sends** - No sendmmsg usage for QUIC
- [ ] **Large batch sizes** - Application-layer coalescing of up to 50 packets per peer, but not true syscall batching

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Only enabled on QUIC server endpoints, not client-side
- [ ] **UDP GRO (Generic Receive Offload)** - Not implemented

### Buffer Management
- [ ] **Buffer pool reuse** - No visible buffer pooling; per-packet allocation
- [ ] **Large UDP socket buffers** - Uses Tokio/quinn defaults (~200KB); no explicit tuning to MB-sized buffers

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - Relies on kernel TCP
- [ ] **Large TCP RX/TX buffers** - Kernel defaults (~128KB)
- [ ] **Tuned congestion control** - Uses kernel CUBIC
- [ ] **Reordering tolerance** - Kernel TCP handling

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No explicit coalescing before processing
- [ ] **RX checksum offload** - Relies on kernel/NIC defaults

### MTU Handling
- [x] **Conservative MTU** - Uses 1400 byte MTU to avoid fragmentation
- [x] **Path MTU discovery** - Enabled for QUIC connections

### Peer Management
- [ ] **Lazy peer removal** - Dead peer threshold is 43 seconds; not explicitly lazy
- [ ] **Endpoint caching** - No explicit endpoint caching
- [x] **Efficient keepalive timers** - 20-second QUIC keep-alive; protocol timers for Hello/IHU

### Packet Processing
- [ ] **Zero-allocation parsing** - PacketBuffer pre-allocates, no pooling
- [ ] **Zero-copy filtering** - No explicit zero-copy techniques

### State Synchronization
- [ ] **Delta updates** - Full route updates sent periodically
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression
- [ ] **Configurable compression level** - Not applicable

# Security

No severe publicly disclosed security vulnerabilities (CVEs) were found in documentation or source code comments.

**Identified Security Concerns**:

1. **QUIC Certificate Verification Skipped**: The code uses SkipServerVerification for QUIC connections, accepting ANY certificate. Self-signed certificates are used with RouterID in the CN field, providing no cryptographic authentication of peer identity. This allows potential MITM attacks on QUIC connections.

2. **No Replay Protection**: Random nonces prevent identical ciphertext for the same plaintext, but captured (nonce, ciphertext) pairs can be replayed exactly. The receiver has no sequence number tracking to detect replayed packets. Attackers could re-execute commands, poison routing tables temporarily, or cause DoS via replay flooding.

3. **Unbounded Channels**: Several unbounded mpsc channels exist that could lead to memory exhaustion under attack scenarios.

4. **No Rate Limiting**: Control packet processing has no rate limits. While seqno requests are cached and route requests have a generation limit (max 16 hops), the system can still be stressed by flooding.

5. **Route Table Poisoning Risk**: The RouterIdOwnsSubnet filter protects against unauthorized route announcements, but retractions (infinite metric) are exempt from this check. Malicious nodes could retract routes they don't own.

6. **PSK Handling**: The 32-byte PSK is stored in memory without explicit secure wiping on drop; network name is sent in cleartext during TLS-PSK handshake.

7. **Blocking in Async Context**: Route queries use block_in_place with thread sleeps, which can cause performance degradation under load.

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No rate limiting on control or data plane
- [ ] **Stateful packet filter** - No connection tracking for ACLs
- [ ] **Fine-grained ACLs** - Only topic-based filtering for message subsystem; no L3 ACLs
- [ ] **Capability-based access** - Simple allow/deny via route filters

### Identity & Authentication
- [x] **Identity validation** - RouterIdOwnsSubnet filter validates route ownership via cryptographic binding
- [ ] **Signed configuration updates** - No cryptographic verification of route updates beyond identity binding
- [ ] **Certificate pinning** - QUIC uses self-signed certs without verification

### Implementation
- [x] **Memory-safe language** - Written in Rust
- [ ] **Privilege separation** - Runs with privileges needed for TUN interface creation
- [ ] **Sandboxing** - No explicit process isolation/sandboxing
- [ ] **Audit logging** - No security event logging; basic metrics only

# NAT Traversal

Mycelium has LIMITED NAT traversal capabilities. According to the README, "we are working on holepunching for Quic which means P2P traffic without middlemen for NATted networks" - indicating this is future work.

**Current Behavior**:
- Nodes behind single NAT can connect OUTBOUND to public nodes successfully
- Once connected, QUIC keep-alive (20 seconds) maintains NAT mappings
- Double NAT scenarios require traffic to relay through public nodes
- No coordinated hole punching mechanism exists

**What's Missing**:
- No STUN client for public IP/port discovery
- No ICE (Interactive Connectivity Establishment)
- No TCP simultaneous open or UDP hole punching coordination
- No signaling mechanism for coordinating punch attempts between peers

The architecture relies on having some publicly accessible nodes (10 hosted public nodes are provided) that act as relays for NATted peers. The Babel routing protocol automatically routes traffic through these relays when direct connections aren't possible.

## NAT Traversal Checklist

### Discovery
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

**LAN Discovery**: Nodes perform IPv6 multicast discovery on ff02::cafe. Every 60 seconds, nodes send a 50-byte beacon containing magic bytes (8), port (2), and RouterId (40). Discovered peers are validated to have fe80::/64 link-local addresses and automatically added with PeerType::LinkLocalDiscovery.

**Direct Routing**: When a local peer is discovered, it's added to the Babel routing table like any other peer. The route_packet() function performs routing table lookups and selects the best route based on metrics. If the best route is the local peer, packets are sent directly without relay.

**Metric Calculation**: Link costs are calculated from Hello/IHU RTT measurements using EWMA smoothing (factor 9/10). The default link cost starts at 1000ms. QUIC connections have lower base processing cost (7ms for IPv6, 12ms for IPv4) compared to TCP (10ms for IPv6, 15ms for IPv4), so QUIC is preferred when both are available.

Local routes have the same encryption as remote routes - there's no "trusted path mode" to skip encryption on LANs.

## Local Routing Checklist

### LAN Discovery
- [x] **Broadcast/multicast discovery** - IPv6 multicast on ff02::cafe every 60 seconds
- [x] **Direct path advertisement** - Peers share routes via Babel Updates
- [x] **Same-subnet detection** - Validates fe80::/64 link-local addresses for discovery

### LAN Optimization
- [x] **Automatic LAN preference** - Lower RTT on local links results in better metrics, automatic preference
- [ ] **Trusted path mode** - No option to skip encryption on LANs
- [ ] **LAN-only mode** - Can run without connecting to external peers, but no explicit LAN-only restriction

### Routing Features
- [x] **Subnet routes** - Route updates advertise subnets; traffic forwarded through peers
- [ ] **Full tunnel mode** - No option to route all traffic through a specific peer
- [ ] **Split tunneling** - Overlay is separate; no split tunneling of regular internet traffic
- [x] **Route priorities** - Metric-based route selection provides automatic failover

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
- Babel automatically converges to alternate routes within minutes (Update interval: 300s, but dead peer detection: 43s)
- Existing peer connections to other nodes remain unaffected
- Local routing table persists in memory (no disk persistence mentioned)

**Operational Continuity**: Existing tunnel connections survive network partitions. As long as peers maintain connectivity, data continues flowing. There's no authentication server to check, no license server, no policy controller.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Tunnels stay up without any controller (none exists)
- [x] **Local state caching** - Routing table maintained in memory per-node
- [ ] **Cached credentials** - Identity is the keypair on disk; no credential caching needed
- [x] **Graceful degradation** - Babel routing handles partition/connectivity loss automatically

### Redundancy
- [x] **Self-hosted controller** - No controller; can self-host relay nodes
- [ ] **Controller redundancy** - Not applicable (no controller)
- [x] **Relay redundancy** - Multiple relay nodes supported; automatic failover via routing
- [x] **No single root of trust** - Fully distributed trust model; identity from keypairs

### Efficiency
- [ ] **Delta/incremental updates** - Full route updates sent every 300 seconds
- [ ] **Long polling / push updates** - Not applicable (no controller)
- [x] **Configurable sync interval** - Protocol timers are hardcoded but could be modified in code

# Authentication

Mycelium uses cryptographic identity-based authentication rather than traditional credentials. There is no separate enrollment or authentication process - identity IS the keypair.

**Node Identity**: Each node generates or loads an x25519 keypair. The 32-byte public key forms the RouterId, which is the node's identity. The IPv6 overlay address (in 400::/7) is derived from BLAKE3(public_key) with bit mangling to ensure correct range. This cryptographic binding prevents IP spoofing.

**Joining the Network**:
1. Node generates/loads private key from disk (default: priv_key.bin)
2. Derives public key and overlay IP address
3. Connects to peers via static configuration, link-local discovery, or inbound connections
4. No enrollment, approval, or authentication step - connection is immediate

**Private Network Mode**: When enabled, adds TLS-PSK authentication:
- Network name (2-64 characters) sent as TLS identity
- 32-byte pre-shared key required by both sides
- TLS 1.3 handshake must succeed before peer is added
- Provides network-level isolation - only nodes with correct name+PSK can connect

**Route Authentication**: The RouterIdOwnsSubnet filter validates that route announcements contain the IP derived from the announcing router's public key, preventing unauthorized route advertisements.

**No Traditional Auth**: No usernames, passwords, OAuth, SSO, or admin approval workflows exist.

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Private key on disk enables automatic join
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

**Desktop/Server**: Full support for Linux, macOS, and Windows. The TUN interface is created using platform-specific libraries (tokio-tun for Linux, tun2 for macOS/Windows). Nodes can optionally run in no-TUN mode for message-only operation (no L3 traffic).

**Mobile**: Android and iOS are supported, but TUN creation must be done in native code (Kotlin for Android, Swift for iOS) due to platform restrictions. The TUN file descriptor is passed to Mycelium via the tun_fd config option.

**Implementation Details**:
- Userspace implementation in Rust (no kernel module)
- TUN interface for Layer 3 packet injection/capture
- Default MTU: 1400 bytes
- Integrates with system routing tables (adds routes for 400::/7 via TUN)
- Firewall mark support on Linux for policy routing

**Container Support**: No explicit Docker/Kubernetes integration documented, but standard binary can run in containers with CAP_NET_ADMIN for TUN creation.

**Cross-Compilation**: Uses the cross project for cross-platform builds; vendored-openssl feature for static linking.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support
- [x] **macOS** - Full support
- [x] **Windows** - Full support (MSI installer available)
- [ ] **FreeBSD/OpenBSD** - Not mentioned in documentation

### Mobile
- [x] **iOS** - Mobile app support (TUN FD passed from Swift)
- [x] **Android** - Mobile app support (TUN FD passed from Kotlin)

### Implementation
- [ ] **Kernel-mode datapath** - Not using WireGuard kernel module
- [x] **Userspace implementation** - Fully userspace Rust implementation
- [ ] **Container support** - No explicit Docker/Kubernetes integration; can run in containers with privileges
