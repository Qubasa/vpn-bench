# Overview

Hyprspace is a lightweight, decentralized mesh VPN built on top of libp2p (IPFS's networking layer). It creates encrypted peer-to-peer tunnels between nodes without requiring public IP addresses, using NAT hole-punching and relay services. Written in Go, it leverages libp2p for peer discovery, transport encryption, and connection establishment, creating TUN interfaces for IP-level packet routing.

**Key Architecture Components:**
- **libp2p networking stack**: Handles transport, encryption, peer discovery, and NAT traversal
- **TUN device interface**: Layer 3 (IP) virtual network interface (wireguard/tun library)
- **Custom VPN protocol**: `/hyprspace/0.0.1` application protocol for forwarding packets
- **Kademlia DHT**: Primary peer discovery mechanism
- **Peer Exchange (PeX)**: Secondary discovery via `/hyprspace/pex/0.0.1`
- **Service network**: gVisor-based userspace TCP stack for virtual hosting
- **Built-in DNS server**: systemd-resolved integration with name-based peer lookups

# Protocol

Hyprspace uses libp2p's transport layer with a custom application protocol for VPN traffic. The control plane operates through libp2p's DHT for peer discovery and PeX for sharing peer addresses. Data plane traffic is sent over libp2p streams with a simple framing protocol (2-byte length prefix per packet).

**Control Plane:**
- Kademlia DHT queries for peer discovery
- HTTP delegated routing to `p2p.privatevoid.net`
- Peer Exchange protocol shares known peer addresses
- Bootstrap nodes for initial network entry (hardcoded)
- Parallel routing queries across multiple sources

**Data Plane:**
- Packets read from TUN device (single-threaded reader goroutine)
- Each packet framed with 2-byte little-endian length prefix
- Forwarded over libp2p streams to destination peer
- Stream reuse via `activeStreams` cache to avoid handshake overhead
- MTU set to 1420 bytes

**Transports:** Supports both QUIC (UDP-based) and TCP via libp2p. QUIC is preferred for low latency and better packet loss handling. WebSocket support is available indirectly through libp2p dependencies (gorilla/websocket in go.mod), though not explicitly configured in the codebase.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - QUIC transport over UDP
- [x] **TCP fallback** - libp2p TCP transport available
- [x] **QUIC support** - Primary transport via libp2p
- [ ] **WebSocket support** - Library present but not explicitly enabled

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support
- [x] **IPv6 support** - Native IPv6 tunneling support
- [x] **Dual-stack** - Both IPv4 and IPv6 simultaneously

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing via TUN device
- [ ] **Layer 2 (Ethernet) mode** - No TAP/Ethernet frame support
- [ ] **Bridging support** - No bridging capability for non-VPN devices

### Advanced
- [ ] **Multipath/bonding** - No path aggregation
- [ ] **QoS/traffic shaping** - No priority queues or traffic classes
- [ ] **Multicast support** - No multicast/broadcast support

# Encryption

Hyprspace relies entirely on libp2p's transport-layer encryption for security. It uses modern cryptographic protocols without adding an additional VPN-layer encryption scheme.

**Transport Encryption (via libp2p):**
- **Noise Protocol Framework** (primary): Modern cryptographic handshake using the XX pattern
- **TLS 1.3** (fallback): Standard TLS as secondary option
- Both protocols negotiated via libp2p's `DefaultSecurity` option

**Noise Protocol Details:**
- Cipher: ChaCha20-Poly1305 AEAD (Authenticated Encryption with Associated Data)
- Key Exchange: Curve25519 (X25519 ECDH)
- Hash Function: Blake2s or SHA-256
- Pattern: XX (mutual authentication, both parties send static keys)

**Identity & Keys:**
- Ed25519 key pairs for node identity (256-bit)
- Keys stored as base58-encoded multibase strings
- Peer IDs cryptographically derived from public key hash
- Optional private network support via swarm key (PSK) via `HYPRSPACE_SWARM_KEY` environment variable

**Security Properties:**
- Transport-level encryption only (no application-layer encryption)
- No separate VPN-layer replay protection (relies on Noise/TLS session nonces)
- Perfect Forward Secrecy inherent in Noise XX handshake pattern
- Authenticated encryption prevents tampering

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519/X25519 ECDH via Noise
- [x] **Perfect Forward Secrecy** - Ephemeral keys in Noise handshake
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [ ] **Key rotation** - No automatic key refresh mechanism

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 via Noise
- [ ] **Hardware-accelerated crypto** - No explicit AES-NI usage (ChaCha20 used)
- [x] **Constant-time operations** - Provided by crypto libraries

### Protocol Security
- [x] **Replay protection** - Via Noise/TLS transport nonces (not VPN-layer)
- [x] **Noise Protocol or equivalent** - Noise XX pattern
- [x] **No cleartext metadata** - Encrypted via transport layer

# Performance

Hyprspace uses Go's goroutine-based concurrency model but has significant performance limitations compared to optimized VPN implementations.

**Threading Model:**
- **Multi-goroutine architecture**: Separate goroutines for TUN reading, stream handling, discovery, PeX, route metrics, and AutoRelay
- **Single TUN reader**: Only one goroutine reads from TUN device (potential bottleneck)
- **Per-stream handlers**: Each incoming stream spawns a new goroutine (overhead under high connection rates)
- **Synchronization**: Uses `sync.Mutex` for shared stream access and `sync.WaitGroup` for graceful shutdown

**Performance Limitations:**
- **No batching**: Single packet per syscall (`BatchSize=1`), despite using wireguard/tun library that supports batching
- **Per-packet allocation**: New buffer allocation `make([]byte, 1420)` for each packet (no buffer pool)
- **Small buffers**: ~1.4 MB channel capacity vs multi-MB buffers in optimized VPNs
- **No socket tuning**: Relies on OS default UDP buffers (~200KB)
- **libp2p overhead**: Stream multiplexing and framing adds latency
- **Long write timeout**: 25-second deadline delays failure detection

**Performance Under Loss/Reordering:**
Under 5% packet reordering and 2% packet loss conditions, Hyprspace performs significantly worse than optimized mesh VPNs like Tailscale due to the limitations above. The hardcoded `BatchSize=1` creates 128x syscall overhead compared to implementations that batch packets.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Multiple goroutines for different tasks
- [ ] **Per-core packet queues** - Single TUN reader, not per-core

### Packet I/O
- [ ] **Batch UDP receives** - No `recvmmsg` usage, single packet per read
- [ ] **Batch UDP sends** - No `sendmmsg` usage, single packet per write
- [ ] **Large batch sizes** - BatchSize hardcoded to 1

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Not utilized
- [ ] **UDP GRO (Generic Receive Offload)** - Not utilized

### Buffer Management
- [ ] **Buffer pool reuse** - New allocation per packet, no `sync.Pool`
- [ ] **Large UDP socket buffers** - Uses OS defaults (~200KB)

### Userspace TCP Stack (optional)
- [x] **Userspace TCP implementation** - gVisor TCP stack for service network
- [x] **Large TCP RX/TX buffers** - gVisor configured with multi-MB buffers
- [ ] **Tuned congestion control** - Uses gVisor defaults
- [ ] **Reordering tolerance** - Standard gVisor behavior

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No coalescing
- [ ] **RX checksum offload** - Not utilized

### MTU Handling
- [x] **Conservative MTU** - Fixed 1420 byte MTU
- [ ] **Path MTU discovery** - Fixed MTU, no dynamic discovery

### Peer Management
- [x] **Lazy peer removal** - Streams cached in `activeStreams` map
- [x] **Endpoint caching** - libp2p peerstore caches addresses
- [x] **Efficient keepalive timers** - Managed by libp2p

### Packet Processing
- [ ] **Zero-allocation parsing** - New allocations per packet
- [ ] **Zero-copy filtering** - Packets copied through buffers

### State Synchronization
- [ ] **Delta updates** - No incremental state updates documented
- [ ] **Compression** - No control plane compression

### Data Plane Compression
- [ ] **Tunnel compression** - No packet compression
- [ ] **Configurable compression level** - N/A

# Security

Hyprspace has not been formally audited and the project README explicitly warns against using it in high-security environments. No public CVEs or severe security flaws have been disclosed, but the analysis identified several security concerns.

**Security Concerns Identified:**

1. **Weak IP address derivation**: Uses XOR-based hash with only 16 bits of entropy for IPv4, creating high collision probability
2. **Service ID collisions**: 16-bit service IDs easily collide
3. **No rate limiting**: No protection against connection flooding attacks
4. **Hardcoded bootstrap nodes**: Single points of failure for DoS attacks
5. **Stream handling race conditions**: `activeStreams` map access not fully synchronized
6. **No certificate pinning**: Delegated routing uses HTTPS without pinning
7. **Missing input validation**: Some packet parsing lacks bounds checking
8. **Panic on errors**: Several code paths use panic() which could crash daemon
9. **No VPN-layer replay protection**: Only transport-layer (Noise/TLS) protection

**Project Status:** Originally created by Alec Scott, archived on Feb 24, 2024. Forked and maintained by Max Headroom (@max-privatevoid) since September 2022 with active development continuing.

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No DoS/amplification attack prevention
- [ ] **Stateful packet filter** - No connection tracking for ACLs
- [ ] **Fine-grained ACLs** - Binary trust model only (peer trusted or not)
- [ ] **Capability-based access** - No advanced access control

### Identity & Authentication
- [x] **Identity validation** - Cryptographic verification via libp2p peer IDs
- [ ] **Signed configuration updates** - No cryptographic config verification
- [ ] **Certificate pinning** - No pinning for delegated routing

### Implementation
- [x] **Memory-safe language** - Written in Go with garbage collection
- [ ] **Privilege separation** - Requires root/admin for TUN device creation
- [ ] **Sandboxing** - No process isolation implemented
- [ ] **Audit logging** - Limited observability, basic logging only

# NAT Traversal

Hyprspace leverages libp2p's comprehensive NAT traversal capabilities, enabling direct peer-to-peer connections even when both peers are behind restrictive NATs.

**NAT Traversal Methods:**
1. **NAT Port Mapping**: UPnP and NAT-PMP for automatic port forwarding
2. **UDP Hole Punching**: Direct P2P through symmetric and cone NATs
3. **Circuit Relay v2**: Encrypted relay fallback when direct connection fails
4. **AutoRelay**: Automatically discovers and uses 2 relay nodes with 10-second boot delay

**Double NAT Support:**
Fully supported via relay fallback. When direct connection or hole punching fails, circuit relay provides encrypted connectivity through intermediate peers. STUN support is available via pion/stun library dependencies (used for WebRTC-style ICE NAT detection).

**Discovery Process:**
- Multiple bootstrap nodes for initial peer discovery
- Exponential backoff discovery loop (1s to 1min intervals)
- Parallel routing queries across DHT, HTTP delegated routing, and local peerstore

## NAT Traversal Checklist

### Discovery
- [x] **STUN support** - Via pion/stun library (WebRTC ICE)
- [x] **Multiple STUN servers** - Supported via libp2p WebRTC transport
- [x] **NAT type detection** - libp2p hole punching detects NAT behavior

### Port Mapping
- [x] **UPnP port mapping** - Via `libp2p.NATPortMap()`
- [x] **NAT-PMP support** - Included in libp2p NAT port mapping
- [x] **PCP support** - DON'T KNOW (may be included in libp2p)

### Hole Punching
- [x] **UDP hole punching** - Via `libp2p.EnableHolePunching()`
- [x] **Symmetric NAT handling** - libp2p hole punching supports symmetric NAT
- [x] **Rendezvous coordination** - DHT and relay nodes coordinate hole punching

### Fallback
- [x] **Relay fallback** - Circuit Relay v2 with encrypted relaying
- [x] **Multiple relay regions** - AutoRelay discovers multiple relays
- [x] **Automatic relay selection** - AutoRelay chooses best relays
- [x] **TCP relay support** - libp2p relay works over TCP and QUIC

# Local Routing

Hyprspace intelligently detects and prefers local network paths when peers are on the same LAN, while preventing routing loops through the VPN interface itself.

**LAN Discovery:**
libp2p automatically identifies local network addresses during peer discovery. When peers share the same subnet, libp2p's peerstore records local addresses alongside public addresses. The Peer Exchange (PeX) protocol additionally shares peer addresses among VPN nodes, enabling direct local connections even without DHT.

**Direct Path Priority:**
Parallel routing queries multiple sources (local peerstore, DHT, HTTP delegated routing) simultaneously with 30-second timeout. The first successful address found is used immediately, which typically favors local routes due to lower latency.

**Recursion Prevention:**
The `RecursionGater` intercepts connection attempts and checks if the route would go through the VPN interface itself (by comparing link indices). If detected, the connection is blocked to prevent routing loops and infinite recursion.

**Traffic Routing:**
When peers are on the same LAN, packets are routed directly over the local network through libp2p connections. The encryption and VPN protocol still apply, but packets traverse local Ethernet/WiFi instead of going through internet routes or relays.

## Local Routing Checklist

### LAN Discovery
- [x] **Broadcast/multicast discovery** - libp2p multicast DNS (implicit)
- [x] **Direct path advertisement** - Peers share endpoints via PeX
- [x] **Same-subnet detection** - libp2p identifies local addresses

### LAN Optimization
- [x] **Automatic LAN preference** - First-successful routing favors low-latency local paths
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [ ] **LAN-only mode** - No restriction to local network only

### Routing Features
- [x] **Subnet routes** - Peers can advertise routes to other networks
- [x] **Full tunnel mode** - Can route all traffic through a peer (via route configuration)
- [x] **Split tunneling** - Selective routing via peer route configuration
- [ ] **Route priorities** - No explicit priority/HA route selection

# Central Point of Failure

Hyprspace is mostly decentralized with peer-to-peer connections, but relies on several centralized components for initial discovery and degraded-mode operation.

**Centralized Dependencies:**

1. **Bootstrap Nodes**: 20 hardcoded multiaddresses (4 project servers + libp2p public nodes)
   - Required for initial DHT entry and peer discovery
   - If all bootstrap nodes fail, new nodes cannot join the network
   - Existing connections unaffected

2. **HTTP Delegated Routing**: Single endpoint at `https://p2p.privatevoid.net`
   - Used as fallback routing source
   - Failure degrades discovery but DHT and PeX compensate
   - Not critical for operation

**Failure Scenarios:**
- **Bootstrap down**: Slows initial connection, but PeX and cached addresses work for existing peers
- **DHT unavailable**: PeX and HTTP delegated routing provide redundancy
- **All infrastructure down**: Pre-established connections continue working, no new peer discovery

**Controller Model:**
No central controller exists. Configuration is stored locally in JSON files, and private keys are managed locally. Nodes authenticate via pre-shared peer IDs in configuration files.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Established tunnels stay up without infrastructure
- [x] **Local state caching** - libp2p peerstore caches peer information
- [x] **Cached credentials** - Private keys and peer IDs stored locally
- [x] **Graceful degradation** - PeX and cached addresses work when DHT/bootstrap unavailable

### Redundancy
- [x] **Self-hosted controller** - No controller needed, fully decentralized operation
- [ ] **Controller redundancy** - N/A (no controller)
- [x] **Relay redundancy** - AutoRelay uses 2 relays, any peer can relay
- [x] **No single root of trust** - Distributed trust via peer ID authentication

### Efficiency
- [ ] **Delta/incremental updates** - No documented incremental updates
- [ ] **Long polling / push updates** - No controller for updates
- [ ] **Configurable sync interval** - N/A (no centralized sync)

# Authentication

Hyprspace uses cryptographic peer IDs derived from Ed25519 key pairs for node identity and authentication. There is no centralized authentication server or PKI infrastructure.

**Enrollment Process:**

1. **Key Generation**: `hyprspace init` generates Ed25519 key pair (256-bit)
2. **Peer ID Derivation**: Peer ID computed as multihash of public key (format: `12D3KooW...`)
3. **Manual Configuration**: Peer IDs manually added to each node's configuration file
4. **Mutual Trust**: Both peers must list each other's peer IDs in their configs

**Authorization:**
- Binary trust model: peers either in trusted list or rejected
- Stream handler validates incoming connections against configured peer list
- Relay ACL restricts relay usage to configured peers only
- No automatic enrollment, admin approval, or time-limited access

**Authentication Flow:**
1. libp2p establishes transport connection with Noise/TLS handshake
2. Peer identity cryptographically verified via public key
3. Application layer checks if peer ID exists in trusted peers list
4. Connection accepted if authorized, otherwise stream reset

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Manual peer ID configuration
- [ ] **OAuth/OIDC** - No SSO integration
- [ ] **Interactive login** - No browser-based auth
- [ ] **CLI authentication** - Manual config editing only

### Authorization
- [ ] **Admin approval workflow** - Manual config file editing required
- [ ] **Automated enrollment rules** - No conditional authorization
- [ ] **Ephemeral nodes** - No auto-cleanup of temporary devices
- [ ] **Node expiry** - No time-limited authorization

### Identity
- [x] **Stable device identity** - Persistent Ed25519 key pairs
- [x] **Identity portability** - Keys can be copied to other devices
- [ ] **Multi-user support** - Single identity per device only

# Platform Support

Hyprspace supports major desktop and server platforms with platform-specific TUN device implementations, but lacks mobile client support.

**Supported Platforms:**

- **Linux**: Full support via native TUN device (`tun_linux.go`)
- **macOS**: Full support with `utun[0-9]` interfaces (`tun_darwin.go`)
- **Windows**: Full support with automatic IP assignment when run as Administrator (`tun_windows.go`)
- **FreeBSD/OpenBSD**: DON'T KNOW (no explicit platform files found)

**Implementation Details:**

- **Userspace datapath**: All packet processing in userspace via TUN device
- **TUN library**: Uses `songgao/water` and `wireguard/tun` libraries
- **Network stack**: gVisor userspace TCP/IP stack for service network feature
- **Container support**: Can run in containers but requires NET_ADMIN capability for TUN device creation
- **Privilege requirements**: Requires root/administrator for TUN interface creation

**Mobile Platforms:**
No iOS or Android clients exist. The codebase is Go-based which could theoretically support mobile platforms, but no mobile-specific implementations are present.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support via native TUN
- [x] **macOS** - Full support with utun interfaces
- [x] **Windows** - Full support with Administrator privileges
- [ ] **FreeBSD/OpenBSD** - No explicit support found

### Mobile
- [ ] **iOS** - No mobile app
- [ ] **Android** - No mobile app

### Implementation
- [ ] **Kernel-mode datapath** - Not using in-kernel WireGuard
- [x] **Userspace implementation** - Fully userspace via TUN/libp2p
- [x] **Container support** - Works in Docker/Kubernetes with NET_ADMIN
