# Overview

EasyTier is a decentralized, open-source mesh VPN solution written in Rust using the Tokio async runtime. It provides a peer-to-peer virtual private network without requiring a central server. The architecture is built around several key components:

**Key Architecture Components:**

- **PeerManager**: Central component managing peer connections and coordinating between different subsystems
- **OSPF-Based Routing (PeerRoute)**: Handles routing between peers using a simplified OSPF (Open Shortest Path First) link-state routing protocol with Dijkstra's algorithm
- **Tunnel System**: Modular transport layer supporting multiple protocols (TCP, UDP, WebSocket, QUIC, WireGuard)
- **ForeignNetworkManager**: Handles packet forwarding between different networks and manages multi-network routing
- **VirtualNIC**: TUN interface management for packet injection/extraction to/from the OS network stack
- **Connector System**: Manages NAT traversal, hole punching, and automatic peer connection establishment

The design is fully decentralized with no mandatory central server - nodes are equal and communicate peer-to-peer. Optional public shared nodes can be used as bootstrap/relay points for easier deployment.

# Protocol

EasyTier uses a **custom protocol by default**, not WireGuard. The custom protocol includes:

**Control Plane:**
- Custom handshake with magic number validation (0xd1e1a5e1), peer ID exchange, and network secret digest verification (SHA-256 hash)
- OSPF-like route propagation where each peer shares routing tables with directly connected peers
- Periodic route updates every 3600 seconds (1 hour)
- RPC-based coordination for features like UDP/TCP hole punching and peer information exchange

**Data Plane:**
- Custom packet format with PeerManagerHeader containing packet type, source/destination peer IDs, encryption flags, and forward counter
- Packets are encapsulated with protocol-specific headers (TCP length prefix, UDP connection ID, etc.)
- Optional compression using configurable algorithms (LZ4, LZO, Zlib)

**Transport Support:**
- **TCP** is the default transport protocol (tcp://)
- UDP transport (udp://)
- WebSocket (ws://) and WebSocket SSL (wss://) for HTTP-compatible tunneling through restrictive firewalls
- QUIC support for modern multiplexed transport with BBR congestion control
- WireGuard protocol only when explicitly configured with wg:// URLs or VpnPortal feature

The protocol allows direct peer-to-peer communication with automatic fallback to relay when direct connection fails.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary transport protocol supported
- [x] **TCP fallback** - TCP is actually the default, not just fallback
- [x] **QUIC support** - Modern multiplexed transport with BBR congestion control
- [x] **WebSocket support** - HTTP-compatible tunneling via ws:// and wss://

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic
- [x] **IPv6 support** - Native IPv6 tunneling with enable_ipv6 flag
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6 supported

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing (default mode using TUN devices)
- [ ] **Layer 2 (Ethernet) mode** - Full Ethernet frame tunneling not supported
- [ ] **Bridging support** - Bridge non-VPN devices onto network not available

### Advanced
- [ ] **Multipath/bonding** - Aggregate multiple network paths not implemented
- [x] **QoS/traffic shaping** - L4 stream rate limiting via ACL-based rules
- [x] **Multicast support** - Virtual multicast/broadcast supported via packet routing

# Encryption

EasyTier's encryption layer is based on the network secret and provides multiple encryption algorithm options.

**Key Derivation:**
- Encryption keys are derived from the network secret using a hash-based approach
- Uses DefaultHasher (SipHash) which is NOT cryptographically secure - this is a significant weakness
- 128-bit and 256-bit keys derived by hashing the network secret multiple times
- Network secret digest (SHA-256 hash of network_name + network_secret) is transmitted in plaintext during handshake for authentication

**Default Algorithm:** AES-128-GCM

**Encryption Process:**
- Each packet can be individually encrypted based on flags in PeerManagerHeader
- AEAD (Authenticated Encryption with Associated Data) ciphers provide both confidentiality and integrity
- 16-byte authentication tag added per encrypted packet
- No forward secrecy - same static key used for all sessions

**Critical Security Issues:**
- Weak key derivation using SipHash instead of proper KDF (HKDF, Argon2, scrypt)
- No perfect forward secrecy
- Network secret digest sent in plaintext enables offline dictionary attacks
- XOR cipher option is cryptographically broken and should not be offered

## Encryption Checklist

### Key Exchange
- [ ] **Modern key exchange** - No Curve25519/X25519 ECDH, uses static pre-shared key
- [ ] **Perfect Forward Secrecy** - No ephemeral session keys, same static key used
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [ ] **Key rotation** - No automatic periodic key refresh

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 and AES-GCM supported
- [x] **Hardware-accelerated crypto** - AES-GCM can use AES-NI, ring library provides optimizations
- [ ] **Constant-time operations** - Not verified; weak key derivation suggests limited focus on timing attacks

### Protocol Security
- [ ] **Replay protection** - No packet counter/nonce verification visible in protocol
- [ ] **Noise Protocol or equivalent** - Custom handshake, not Noise Protocol framework
- [ ] **No cleartext metadata** - Network secret digest transmitted in cleartext during handshake

# Performance

EasyTier supports both single-threaded and multi-threaded operation via runtime configuration.

**Threading Model:**
- Multi-threaded mode enabled by default using Tokio's multi-threaded runtime
- Default: 2 worker threads, configurable via multi_thread_count parameter
- Single-threaded mode available for resource-constrained devices
- Async I/O throughout using Tokio primitives

**Packet Processing:**
- Packets processed individually, one at a time - **no batching**
- Single syscall per packet (no recvmmsg/sendmmsg)
- No packet copying within userspace - copies only occur during kernel ↔ userspace communication
- No packet sorting before sending to kernel
- TUN interface read in single task, no multi-queue parallelism

**Concurrency Primitives:**
- tokio::sync::Mutex and RwLock for async-aware locking
- DashMap for concurrent hash maps
- JoinSet for managing task groups
- broadcast channels for event distribution
- ArcSwap for lock-free ACL hot-reload

**Performance vs Tailscale:**
EasyTier underperforms Tailscale under adverse network conditions (5% reordering, 2% loss). While Tailscale achieves 41 Mbps, EasyTier performs worse due to:
- More syscalls (no recvmmsg/sendmmsg batching)
- Smaller socket buffers
- No tuned congestion control in the userspace TCP stack
- No GSO/GRO offloading

Note: EasyTier does have a userspace TCP implementation (smoltcp) and buffer reuse for UDP/TCP/TUN packet receiving, though with different optimization trade-offs than Tailscale.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Parallel packet handling across CPU cores (configurable)
- [ ] **Per-core packet queues** - No evidence of per-core queues to avoid lock contention

### Packet I/O
- [ ] **Batch UDP receives** - No recvmmsg usage, single packet per syscall
- [ ] **Batch UDP sends** - No sendmmsg usage, single packet per syscall
- [ ] **Large batch sizes** - N/A, no batching implemented

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Kernel segmentation not used
- [ ] **UDP GRO (Generic Receive Offload)** - Kernel coalescing not used (QUIC explicitly disables it)

### Buffer Management
- [x] **Buffer pool reuse** - For UDP/TCP and TUN packet receiving, allocates large buffer to receive multiple packets and continues allocating new buffers only when consumed
- [ ] **Large UDP socket buffers** - Uses Tokio defaults (~200KB), not MB-sized

### Userspace TCP Stack (optional)
- [x] **Userspace TCP implementation** - Uses smoltcp as userspace TCP stack; can proxy overlay TCP streams via QUIC or KCP
- [ ] **Large TCP RX/TX buffers** - Uses Tokio defaults (~8KB), not multi-MB
- [ ] **Tuned congestion control** - Kernel TCP with default CUBIC, not optimized
- [ ] **Reordering tolerance** - Kernel TCP default behavior

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No evidence of merging small segments
- [ ] **RX checksum offload** - Likely handled by NIC/kernel, not explicitly managed

### MTU Handling
- [x] **Conservative MTU** - Default 1380 bytes to avoid fragmentation
- [ ] **Path MTU discovery** - No evidence of dynamic MTU discovery

### Peer Management
- [ ] **Lazy peer removal** - Peers removed after timeout (REMOVE_DEAD_PEER_INFO_AFTER)
- [ ] **Endpoint caching** - Connection selection based on latency tracking
- [x] **Efficient keepalive timers** - QUIC uses 5-second keepalive intervals

### Packet Processing
- [ ] **Zero-allocation parsing** - Packets still allocated to BytesMut buffers
- [x] **Zero-copy filtering** - No packet copying within userspace; copies only at kernel ↔ userspace boundary

### State Synchronization
- [x] **Delta updates** - OSPF-style incremental route updates
- [ ] **Compression** - Control plane compression not visible

### Data Plane Compression
- [x] **Tunnel compression** - LZ4, LZO, Zlib supported via data_compress_algo flag
- [x] **Configurable compression level** - Can select compression algorithm or disable

# Security

**Known Security Issues:**

1. **Weak Key Derivation (Critical)**: Uses DefaultHasher (SipHash) for deriving encryption keys from network secret instead of cryptographic KDF like HKDF, Argon2, or scrypt
2. **XOR Cipher Option (Critical)**: Offers XOR encryption which is trivially breakable and provides no real security
3. **No Forward Secrecy (High)**: Same static encryption key used for all sessions; compromise of network secret compromises all past traffic
4. **Cleartext Digest Transmission (Medium)**: Network secret digest sent in plaintext during handshake enables offline dictionary/brute-force attacks
5. **Peer ID Collision Panic (Medium)**: System panics on peer ID collision, potential DoS vector
6. **No Replay Protection (Medium)**: No visible packet counter/nonce verification for replay attack prevention

No public CVEs found for EasyTier at this time.

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - Token bucket rate limiting for foreign network relay (foreign_relay_bps_limit)
- [ ] **Stateful packet filter** - Basic filtering but no full connection tracking
- [x] **Fine-grained ACLs** - Per-port/protocol access control with hot-reload
- [ ] **Capability-based access** - Simple allow/deny rules only

### Identity & Authentication
- [ ] **Identity validation** - No proof-of-work, simple digest comparison only
- [ ] **Signed configuration updates** - No cryptographic verification of config updates
- [ ] **Certificate pinning** - No PKI/certificate infrastructure

### Implementation
- [x] **Memory-safe language** - Written in Rust, memory-safe by design
- [ ] **Privilege separation** - Runs with full privileges for TUN interface access
- [ ] **Sandboxing** - No process isolation visible
- [ ] **Audit logging** - Basic event logging but limited security event tracking

# NAT Traversal

EasyTier has comprehensive NAT traversal support handling various NAT scenarios.

**Discovery Mechanism:**
- Uses STUN protocol for NAT type detection (Full Cone, Restricted Cone, Port Restricted, Symmetric)
- Discovers public IP/port mappings via STUN servers
- Supports both IPv4 and IPv6 STUN servers

**Hole Punching Strategies:**

1. **Cone-to-Cone**: Both peers behind cone NAT - high success rate, standard hole punching where each peer sends to other's public address
2. **Symmetric-to-Cone**: One symmetric NAT, one cone NAT - medium success rate using multiple packet attempts
3. **EasySymToEasySym**: Both symmetric NATs with predictable port allocation - lower success rate using "birthday attack" port prediction

**TCP Hole Punching:**
- Uses TCP simultaneous open technique where both peers connect simultaneously
- Provides fallback when UDP is blocked

**Relay Fallback:**
- Automatically falls back to relay through public shared nodes when direct P2P fails
- Public shared nodes like tcp://public.easytier.cn:11010 act as relay points

## NAT Traversal Checklist

### Discovery
- [x] **STUN support** - Discovers public IP/port via STUN servers
- [x] **Multiple STUN servers** - Configurable STUN server lists for redundancy
- [x] **NAT type detection** - Identifies Full Cone, Restricted Cone, Port Restricted, Symmetric NAT

### Port Mapping
- [ ] **UPnP port mapping** - No automatic router port forwarding via UPnP
- [ ] **NAT-PMP support** - No Apple port mapping protocol
- [ ] **PCP support** - No Port Control Protocol (RFC 6887)

### Hole Punching
- [x] **UDP hole punching** - Direct peer-to-peer through NAT via multiple strategies
- [x] **Symmetric NAT handling** - Works with per-destination port randomization via birthday attack
- [x] **Rendezvous coordination** - RPC-based server-assisted hole punching coordination

### Fallback
- [x] **Relay fallback** - Encrypted relay through public shared nodes when direct fails
- [x] **Multiple relay regions** - Can connect to multiple shared nodes simultaneously
- [x] **Automatic relay selection** - Routing algorithm selects best relay path
- [x] **TCP relay support** - Relay over TCP when UDP blocked

# Local Routing

**LAN Discovery:**
- Peers discover each other through manual configuration (-p parameter) or shared public nodes
- OSPF-like route propagation spreads peer information throughout the mesh
- Direct connectivity detected through successful peer connections

**Local Optimization:**
- Direct connections always preferred over relay via routing policy (LeastHop policy)
- Route cost assigned with direct P2P connections having lowest cost
- AVOID_RELAY_COST (i32::MAX) ensures relay only used when necessary

**Routing Mechanism:**
- Link-state database maintained by each node with complete network topology
- Dijkstra's algorithm computes shortest paths
- Two routing policies:
  - **LeastHop**: Prefer direct connections (minimizes hops)
  - **LeastCost**: Prefer lowest latency paths (minimizes latency)

**Subnet Routing:**
- Nodes can share accessible subnets via -n parameter
- Subnet proxy information automatically synced to all peers
- Each node auto-configures routes for proxied subnets
- Supports exit node mode for routing all traffic through specific peer

If two peers are on the same LAN and connect to the mesh, they will establish direct connection and route traffic locally without going through public relay nodes.

## Local Routing Checklist

### LAN Discovery
- [x] **Broadcast/multicast discovery** - Routes propagated via OSPF-like flooding
- [x] **Direct path advertisement** - Peers share reachable endpoints and connectivity
- [x] **Same-subnet detection** - Direct connections preferred when available

### LAN Optimization
- [x] **Automatic LAN preference** - Direct P2P connections prioritized over relay (AVOID_RELAY_COST)
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [ ] **LAN-only mode** - No option to restrict to local network only

### Routing Features
- [x] **Subnet routes** - Route traffic for other networks through peer via -n parameter
- [x] **Full tunnel mode** - Exit node support routes all traffic through a peer
- [x] **Split tunneling** - Selective routing through VPN via subnet configuration
- [x] **Route priorities** - LeastHop vs LeastCost routing policies for HA/failover

# Central Point of Failure

**No mandatory central point of failure** - EasyTier is fundamentally decentralized.

**Peer Center (Optional Optimization):**
- Optional "peer center" node elected based on smallest peer ID
- Used for aggregating peer information for efficiency
- NOT required for operation - failure only affects info aggregation efficiency
- Route information still propagated peer-to-peer via OSPF-like protocol
- Can dynamically change when peers enter/leave network

**Public Shared Nodes:**
- tcp://public.easytier.cn:11010 and similar nodes are optional bootstrap/relay points
- NOT required between peers with direct connectivity
- Can be self-hosted for higher availability
- Multiple shared nodes can be used simultaneously for redundancy

**What Happens When Controller/Shared Node Down:**
- Existing P2P connections continue functioning (connections survive)
- OSPF routing continues working between connected peers
- Only affects new peers trying to bootstrap into network
- Relay-dependent connections would fail, but direct P2P remains

**Resilience Model:**
- Fully meshed peer-to-peer architecture
- Each peer maintains complete routing table (link-state database)
- Route updates propagated peer-to-peer, not through central controller
- Local state caching via persistent peer information

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - P2P tunnels stay up without controller/shared node
- [x] **Local state caching** - Persists peer/config information via routing tables
- [ ] **Cached credentials** - Network secret stored locally but no credential caching mechanism
- [x] **Graceful degradation** - Clear behavior: existing connections work, new connections require bootstrap

### Redundancy
- [x] **Self-hosted controller** - Can run own shared nodes for bootstrap/relay
- [x] **Controller redundancy** - Multiple shared nodes can be configured
- [x] **Relay redundancy** - Multiple relay servers supported
- [x] **No single root of trust** - Distributed trust model, any peer can relay

### Efficiency
- [x] **Delta/incremental updates** - OSPF-style incremental route updates
- [ ] **Long polling / push updates** - Not applicable, P2P route flooding
- [x] **Configurable sync interval** - Route update period configurable (default 3600s)

# Authentication

**Pre-Shared Key Model:**
EasyTier uses a simple pre-shared key authentication model with no PKI infrastructure.

**Network Identity:**
- **network_name**: String identifier for the virtual network
- **network_secret**: Optional pre-shared secret for authentication and encryption key derivation
- **network_secret_digest**: SHA-256 hash of (network_name + network_secret)

**Enrollment Process:**
1. Node configured with network name and secret via command line (-n, -s parameters)
2. During handshake, node sends network_secret_digest to verify membership
3. Both peers compare digest - connection accepted if match
4. Encryption keys derived from network_secret for tunnel encryption

**Security Properties:**
- All nodes sharing same network_name and network_secret can join
- No per-node identity or node-specific credentials
- No revocation mechanism - must change network_secret for all nodes to revoke access
- No admin approval workflow
- No ephemeral/time-limited access

**Limitations:**
- No SSO/OAuth integration
- No PKI or certificate-based authentication
- Network secret must be distributed out-of-band securely

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Network secret for headless/automated enrollment
- [ ] **OAuth/OIDC** - No SSO integration
- [ ] **Interactive login** - No browser-based authentication
- [x] **CLI authentication** - Command-line auth via network_name and network_secret

### Authorization
- [ ] **Admin approval workflow** - No manual device authorization, automatic if secret matches
- [ ] **Automated enrollment rules** - No conditional automatic authorization
- [ ] **Ephemeral nodes** - No auto-cleanup of temporary devices
- [ ] **Node expiry** - No time-limited authorization

### Identity
- [x] **Stable device identity** - Peer ID persistent across restarts (stored in config)
- [ ] **Identity portability** - Cannot move identity between devices easily
- [x] **Multi-user support** - A node can act as a shared node and relay packets for other users

# Platform Support

**Supported Platforms:**
- **Linux** - Full support (x86, ARM, MIPS architectures)
- **macOS** - Full support
- **Windows** - Full support
- **FreeBSD** - Full support
- **Android** - Mobile app support
- **iOS** - Via WireGuard client integration (VpnPortal mode)

**Implementation Details:**

**TUN Interface:**
- Userspace implementation using tun crate
- Layer 3 (IP) mode only, TUN devices not TAP
- Reads/writes IP packets from virtual network interface
- Platform-specific interface configuration via ifcfg module

**Container Support:**
- Docker support mentioned in documentation
- Requires privileged mode for TUN interface access
- Network namespace support via --netns parameter

**Architecture Support:**
- x86/x86_64
- ARM/ARM64
- MIPS

**Key Platform-Specific Features:**
- Linux: BPF-based packet filtering for fake TCP
- macOS: BPF-based packet filtering
- Windows: WinDivert for packet filtering, registry-based interface configuration
- Android: VpnService integration via tauri-plugin-vpnservice

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support with BPF
- [x] **macOS** - Full support with BPF
- [x] **Windows** - Full support with WinDivert
- [x] **FreeBSD/OpenBSD** - FreeBSD supported

### Mobile
- [x] **iOS** - Via WireGuard client (VpnPortal mode)
- [x] **Android** - Native mobile app

### Implementation
- [ ] **Kernel-mode datapath** - No in-kernel packet processing
- [x] **Userspace implementation** - Runs entirely in userspace with TUN interface
- [x] **Container support** - Docker/Kubernetes integration supported
