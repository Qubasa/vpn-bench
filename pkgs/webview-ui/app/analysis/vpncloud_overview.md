# Overview

VpnCloud is a high-performance peer-to-peer mesh VPN written in Rust that operates over UDP. It creates virtual network interfaces (TUN or TAP devices) and forwards all received data via UDP to destination peers. The system features strong end-to-end encryption based on elliptic curve keys (Curve25519) and authenticated encryption (AES-GCM or ChaCha20-Poly1305).

## Key Architecture Components

**Single-Threaded Event Loop**: VpnCloud uses a single-threaded architecture with epoll-based event multiplexing. The main loop processes one event at a time (maxevents=1 in epoll_wait), handling socket events, device events, and periodic housekeeping tasks sequentially.

**Modular Design**: The codebase is organized into separate components:
- Crypto layer (init.rs, core.rs, rotate.rs) handles key exchange, encryption, and key rotation
- Network layer (net.rs) manages UDP socket operations
- Device layer (device.rs) interfaces with TUN/TAP devices
- Peer management (cloud.rs) maintains routing tables and peer state
- Optional components for NAT traversal (port_forwarding.rs), WebSocket proxy (wsproxy.rs), and beacon-based discovery (beacon.rs)

**Supported Modes**:
- **TUN mode**: IP packet tunneling (Layer 3)
- **TAP mode**: Ethernet frame tunneling (Layer 2)
- **Router mode**: Forward based on preconfigured subnet claims
- **Switch mode**: Learn addresses dynamically like a network switch
- **Hub mode**: Broadcast all data to all peers

**No Dependencies**: VpnCloud is a single binary with no external dependencies or kernel modules required. It's written in 100% Rust and uses the standard Linux TUN/TAP interface.

# Protocol

VpnCloud uses a custom UDP-based protocol with four message types:
- DATA (0x00): Encrypted payload packets
- NODE_INFO (0x01): Peer and subnet claim announcements
- KEEPALIVE (0x02): Connection heartbeat
- CLOSE (0xFF): Graceful connection termination

## Control Plane Communication

**3-Way Handshake (Ping-Pong-Peng)**:

1. **PING**: Initiator sends salted node ID hash, ephemeral X25519 ECDH public key, supported encryption algorithms with benchmark speeds, and Ed25519 signature
2. **PONG**: Responder sends own salted node ID hash, ECDH public key, algorithms, and encrypted payload using negotiated session key
3. **PENG**: Initiator confirms with encrypted payload

The handshake includes automatic role negotiation for concurrent connections (higher node_id wins) and algorithm selection based on performance benchmarks from both peers.

**Peer Discovery**: Peers exchange NODE_INFO messages every 5 minutes containing:
- Their own addresses (learned from peers and local configuration)
- List of known peers
- Claimed subnet ranges
- Peer timeout settings

## Data Plane

**Packet Flow**:
1. Application writes packet to virtual TUN/TAP interface
2. VpnCloud reads packet via read() syscall
3. Destination address looked up in routing table
4. Packet encrypted with session key (in-place, no buffer copy)
5. Sent via UDP send_to() to destination peer
6. Receiving peer decrypts and writes to virtual interface

**Transport Protocol**: UDP only. VpnCloud does not support TCP for tunnel transport. However, it includes an optional WebSocket proxy mode for restrictive network environments where UDP is blocked.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary and only transport protocol for peer-to-peer communication
- [ ] **TCP fallback** - No native TCP transport support
- [ ] **QUIC support** - Not implemented
- [x] **WebSocket support** - WebSocket proxy mode for restrictive firewalls (tunnels UDP over WebSocket/TCP)

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support
- [x] **IPv6 support** - Native IPv6 tunneling support
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6 (socket listens on all IPs)

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - TUN device for IP packet routing
- [x] **Layer 2 (Ethernet) mode** - TAP device for Ethernet frame tunneling
- [x] **Bridging support** - TAP mode allows bridging non-VPN devices onto virtual network

### Advanced
- [ ] **Multipath/bonding** - No support for aggregating multiple network paths
- [ ] **QoS/traffic shaping** - No priority queues or traffic classes
- [x] **Multicast support** - Virtual multicast/broadcast supported in hub and switch modes

# Encryption

VpnCloud implements strong end-to-end encryption using modern cryptographic primitives from the `ring` library.

## Encryption Layer

**Key Exchange**:
- Ed25519 keypairs for node identity and digital signatures
- X25519 Elliptic Curve Diffie-Hellman (ECDH) for ephemeral session key agreement
- PBKDF2-HMAC-SHA256 with 4096 iterations for deriving keypairs from passwords (note: this iteration count is below modern recommendations of 100,000+)

**Session Encryption**:
- Negotiated per-peer based on performance benchmarks
- AES-128-GCM, AES-256-GCM, or ChaCha20-Poly1305
- All are authenticated encryption with associated data (AEAD) modes
- In-place encryption (no data copying during encrypt/decrypt operations)

**Nonce Management**:
- 12-byte nonce (192 bits total)
- Only 7 bytes transmitted (5 bytes saved per packet)
- Most significant byte differs between peers (0x00 vs 0x80) to prevent self-decryption
- Nonce pinning rejects old nonces after ~1 second to prevent replay attacks

**Key Rotation**:
- Automatic rotation every 120 seconds
- Turn-based rotation where peers alternately propose new ECDH keys
- Crypto core maintains 4 key slots for seamless rotation without packet loss
- Provides forward secrecy by limiting exposure window

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - X25519 ECDH for session keys
- [x] **Perfect Forward Secrecy** - Ephemeral session keys rotated every 120 seconds
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [x] **Key rotation** - Automatic rotation every 120 seconds

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 and AES-GCM (both AEAD)
- [x] **Hardware-accelerated crypto** - AES-GCM can use AES-NI when available
- [x] **Constant-time operations** - Uses `ring` library which implements constant-time crypto

### Protocol Security
- [x] **Replay protection** - Nonce counter verification and nonce pinning
- [ ] **Noise Protocol or equivalent** - Custom protocol, not Noise framework
- [x] **No cleartext metadata** - Node identities transmitted as salted hashes, payloads fully encrypted

# Performance

VpnCloud uses a **single-threaded architecture** which significantly limits its performance compared to modern multi-threaded VPN solutions like Tailscale.

## Threading Model

The main event loop uses epoll with `maxevents=1`, processing exactly one event per iteration:
- One packet at a time from UDP socket OR device
- No parallel processing of encryption/decryption
- Cannot utilize multiple CPU cores
- Only beacon command execution spawns separate threads (not for core packet processing)

The event loop handles:
1. Socket events (incoming UDP packets from peers)
2. Device events (outgoing packets from local TUN/TAP interface)
3. Periodic housekeeping (every 1 second) - peer timeouts, key rotation, statistics

## Performance Optimizations Checklist

### Threading
- [ ] **Multi-threaded processing** - Single-threaded event loop only
- [ ] **Per-core packet queues** - No multi-core support

### Packet I/O
- [ ] **Batch UDP receives** - Uses single recv_from(), not recvmmsg
- [ ] **Batch UDP sends** - Uses single send_to(), not sendmmsg
- [ ] **Large batch sizes** - Processes 1 packet per epoll iteration (major bottleneck)

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Not implemented
- [ ] **UDP GRO (Generic Receive Offload)** - Not implemented

### Buffer Management
- [x] **Buffer pool reuse** - Single reusable MsgBuffer (65KB fixed buffer) allocated at loop start
- [ ] **Large UDP socket buffers** - Uses Linux kernel defaults (~200KB), no socket buffer tuning

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - Relies on kernel TCP when used via WebSocket proxy
- [ ] **Large TCP RX/TX buffers** - Kernel defaults
- [ ] **Tuned congestion control** - Kernel defaults
- [ ] **Reordering tolerance** - Kernel TCP behavior

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No coalescing implemented
- [ ] **RX checksum offload** - Relies on kernel defaults

### MTU Handling
- [x] **Conservative MTU** - Automatically sets optimal MTU on interface
- [ ] **Path MTU discovery** - Not explicitly implemented

### Peer Management
- [x] **Lazy peer removal** - Peers time out after 5 minutes of inactivity
- [x] **Endpoint caching** - Routing table with LRU cache for fast lookups
- [x] **Efficient keepalive timers** - Configurable per-endpoint keepalive with 1-second granularity

### Packet Processing
- [ ] **Zero-allocation parsing** - Fixed 65KB buffer allocated, packets copied into buffer
- [ ] **Zero-copy filtering** - Packets copied from socket to buffer to device

### State Synchronization
- [x] **Delta updates** - Peers exchange incremental updates via NODE_INFO messages
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression (LZ4, LZO, Zlib)
- [ ] **Configurable compression level** - Not available

## Performance Impact

The single-packet-per-iteration model with epoll maxevents=1 is the most critical performance bottleneck:
- Forces one syscall per packet
- Under packet loss/reordering conditions, throughput degrades significantly
- VpnCloud performs substantially worse than Tailscale under 5% reordering + 2% loss conditions (Tailscale: 41 Mbps, WireGuard: 9 Mbps, VpnCloud likely similar to or worse than WireGuard)

Architectural advantages:
- FNV hasher for fast internal hash maps
- SmallVec for stack allocation of small collections
- Algorithm benchmarking and automatic selection of fastest crypto per peer
- Low memory footprint (CryptoCore is 2384 bytes)

# Security

VpnCloud implements strong cryptographic primitives using the `ring` library, but has some notable security considerations.

## Known Security Issues

**CVE-2019-14899 (Linux rp_filter vulnerability)**: VpnCloud warns users about insecure rp_filter settings that could allow traffic injection attacks on Linux systems. The vulnerability is in the Linux kernel, not VpnCloud itself. VpnCloud provides a `--fix-rp-filter` option to automatically set rp_filter=1 to mitigate this.

## Security Concerns

1. **Weak Password Derivation**: PBKDF2 with only 4096 iterations is below modern recommendations (100,000+ iterations), making password-derived keys vulnerable to brute-force attacks

2. **Static Salt**: Uses hardcoded salt "vpncloudVPNCLOUDvpncl0udVpnCloud" for key derivation, reducing security

3. **Beacon Encryption Weakness**: Beacon files use 1-byte seed for protection, insufficient against malicious tampering (only protects against random changes)

4. **Public Key Privacy**: Node identities use 4-byte salted hashes which could be vulnerable to brute-force matching attacks to identify peers

5. **Shell Command Injection Risk**: Hook scripts and beacon commands execute via shell without sanitization

6. **No Rate Limiting**: No protection against connection flood or amplification attacks

## Security Strengths

- Strong cryptographic primitives (Curve25519, AES-GCM, ChaCha20-Poly1305)
- Perfect forward secrecy through ephemeral key exchange and regular rotation
- Replay protection via nonce pinning
- Authenticated encryption prevents tampering
- Memory-safe Rust implementation
- Privilege dropping support (run as non-root user/group after setup)

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No protection against amplification/DoS attacks
- [ ] **Stateful packet filter** - No built-in ACL or connection tracking
- [ ] **Fine-grained ACLs** - No per-port/protocol access control
- [ ] **Capability-based access** - Simple allow/deny based on trusted keys only

### Identity & Authentication
- [x] **Identity validation** - Ed25519 signature verification and trusted key validation
- [ ] **Signed configuration updates** - No cryptographic config verification
- [ ] **Certificate pinning** - Uses trusted public keys, similar concept

### Implementation
- [x] **Memory-safe language** - Written in Rust (100% safe Rust, no C code)
- [x] **Privilege separation** - Supports dropping privileges to specified user/group
- [ ] **Sandboxing** - No process isolation/sandboxing
- [x] **Audit logging** - Security events logged (untrusted peers, signature failures, etc.)

# NAT Traversal

VpnCloud implements NAT traversal through UDP hole-punching and automatic port forwarding, but lacks advanced features like STUN/TURN.

## How It Works

**UDP Hole-Punching**: Peers exchange complete address lists in NODE_INFO messages. Each peer attempts connections to all known addresses of other peers from both sides. When a peer behind NAT sends a packet, it opens a temporary hole in the NAT allowing return traffic.

**Address Learning**: Peers learn their own public addresses from other peers during handshake and communication. This discovered address is shared with other peers to facilitate hole-punching.

**UPnP Port Forwarding**: VpnCloud can automatically configure port forwarding on compatible routers using the Internet Gateway Device (IGD) protocol. This creates a permanent mapping without requiring manual router configuration.

**WebSocket Proxy Fallback**: For restrictive networks where UDP is completely blocked, VpnCloud can use a WebSocket proxy server to tunnel UDP over TCP. The proxy forwards UDP packets between peers that cannot communicate directly.

## Double NAT Handling

VpnCloud does **not explicitly handle double NAT** (NAT behind NAT scenarios). It relies on:
- Cross-connection attempts through extensive peer address sharing
- WebSocket proxy as a fallback when direct connections fail
- No intelligent symmetric NAT detection or specialized hole-punching techniques

## NAT Traversal Checklist

### Discovery
- [ ] **STUN support** - No STUN protocol implementation
- [ ] **Multiple STUN servers** - Not applicable
- [ ] **NAT type detection** - No explicit NAT type detection

### Port Mapping
- [x] **UPnP port mapping** - Automatic router port forwarding via IGD protocol
- [ ] **NAT-PMP support** - Not implemented
- [ ] **PCP support** - Not implemented (RFC 6887)

### Hole Punching
- [x] **UDP hole punching** - Direct peer-to-peer through NAT via address exchange
- [ ] **Symmetric NAT handling** - No specific handling for per-destination port randomization
- [x] **Rendezvous coordination** - Peer exchange and beacon system for hole-punching coordination

### Fallback
- [x] **Relay fallback** - WebSocket proxy as encrypted relay when direct UDP fails
- [ ] **Multiple relay regions** - No geographic redundancy for relays (user-deployed)
- [ ] **Automatic relay selection** - Manual configuration only
- [x] **TCP relay support** - WebSocket proxy uses TCP transport

# Local Routing

VpnCloud supports **direct peer-to-peer local routing** without requiring traffic to traverse external relays.

## LAN Discovery

VpnCloud does not have automatic broadcast/multicast-based LAN discovery. Peer discovery relies on:

1. **Static peer configuration**: Manually specify peer addresses via `--peer` option or config file
2. **Peer exchange**: Connected peers share their known peer lists, allowing transitive discovery
3. **Beacon system**: Optional shared beacon files/commands that peers can read to discover each other

Peers on the same LAN must either be manually configured to connect to each other, or discover each other through peer exchange from a common peer.

## LAN Optimization

**Direct local routing**: Once peers discover each other (via any method), they establish direct connections. Traffic between peers on the same LAN flows directly between them over the local network, not through any remote peer or relay.

**No LAN-specific optimizations**: VpnCloud treats all peers identically regardless of whether they're on the same LAN or across the Internet. There is no:
- Automatic preference for LAN paths over WAN
- Special "trusted LAN" mode to skip encryption
- Same-subnet detection

## Routing Features

VpnCloud supports subnet-based routing through its "claims" system:

**Subnet routes**: Peers announce which IP ranges/subnets they can reach via `--claim` option. Other peers route traffic for those subnets to the claiming peer. This enables:
- Routing traffic for other networks through a peer
- Full tunnel mode (claim 0.0.0.0/0 to route all traffic through a peer)
- Site-to-site VPN (peers claim their local network ranges)

**VLAN Support**: TAP mode supports IEEE 802.1q VLAN tags, allowing segmentation of Layer 2 traffic.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No LAN announcements or mDNS
- [x] **Direct path advertisement** - Peers share all known addresses in NODE_INFO messages
- [ ] **Same-subnet detection** - No detection of local vs remote peers

### LAN Optimization
- [ ] **Automatic LAN preference** - All peer connections treated equally
- [ ] **Trusted path mode** - No option to skip encryption on LANs
- [ ] **LAN-only mode** - No restriction to local network only

### Routing Features
- [x] **Subnet routes** - Full support via claims system (announce reachable subnets)
- [x] **Full tunnel mode** - Route all traffic through peer via 0.0.0.0/0 claim
- [ ] **Split tunneling** - No granular per-application routing control
- [ ] **Route priorities** - No HA/failover route selection (first match wins)

# Central Point of Failure

VpnCloud is a **fully peer-to-peer mesh VPN with no mandatory central controller**. There is no single point of failure in the core architecture.

## Decentralized Operation

**No central server required**: All peers communicate directly with each other. Any peer can be used as an initial bootstrap peer to join the network.

**Automatic peer discovery**: Once connected to any peer, nodes learn about other peers through periodic peer exchange messages (every 5 minutes). The network self-organizes without central coordination.

**Reconnection handling**: If a peer connection is lost, VpnCloud automatically retries with exponential backoff for up to 120 seconds. Peers maintain routing tables and automatically update them as peers join/leave.

## Optional Centralized Components

These are optional and not required for operation:

1. **Beacon storage**: Optional shared beacon files (filesystem, database, message broker) for peer discovery without fixed IP addresses. If beacon storage is unavailable, peers can still use static peer addresses or peer exchange.

2. **WebSocket proxy**: Optional relay for restrictive networks. Only needed when direct UDP is blocked. Multiple proxies can be deployed for redundancy.

## What Happens If Components Fail

**If initial bootstrap peer is down**: Cannot join network initially, but once any peer address is reachable, the node joins and discovers others.

**If beacon storage fails**: Peers with static addresses or already-connected peers continue working normally. Only affects new peer discovery via beacons.

**If WebSocket proxy fails**: Only affects peers behind restrictive firewalls that require the proxy. Peers using direct UDP connections are unaffected.

**Network partition**: If the network splits, each partition continues operating independently. When connectivity is restored, peers automatically reconnect and merge.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Peer-to-peer tunnels continue working without any controller
- [x] **Local state caching** - Routing tables persist in memory, peer information maintained locally
- [ ] **Cached credentials** - No persistent credential storage (ephemeral session keys only)
- [x] **Graceful degradation** - Peers continue forwarding packets even if peer exchange fails

### Redundancy
- [x] **Self-hosted controller** - No controller needed; fully peer-to-peer architecture
- [ ] **Controller redundancy** - Not applicable (no controller)
- [x] **Relay redundancy** - Multiple WebSocket proxies can be deployed (manual configuration)
- [x] **No single root of trust** - Distributed trust via peer key exchange, no central CA

### Efficiency
- [x] **Delta/incremental updates** - NODE_INFO messages contain only current peer/claim state
- [ ] **Long polling / push updates** - Timer-based periodic exchange (5 minute intervals)
- [x] **Configurable sync interval** - Peer timeout and keepalive intervals are configurable

# Authentication

VpnCloud uses public key cryptography for node authentication with support for password-based key derivation for easier setup.

## Authentication Methods

**Ed25519 Public Key Authentication**: Each node has an Ed25519 keypair that serves as its identity. During the initial handshake:
1. Node sends salted hash of its public key (4 bytes for privacy)
2. Sends full ECDH ephemeral public key and supported algorithms
3. Signs entire init message with Ed25519 private key
4. Peer validates signature against trusted public keys

**Trusted Keys List**: Each node maintains a list of trusted Ed25519 public keys. Only peers with trusted keys can join the network. If no trusted keys are configured, only the node's own public key is trusted (creating isolated peer-to-peer pairs).

**Password-Derived Keys**: For simpler setup, VpnCloud can derive Ed25519 keypairs from passwords using PBKDF2-HMAC-SHA256 (4096 iterations). All nodes using the same password derive the same keypair and can authenticate each other. Note: This is less secure than using randomly-generated keys.

## Joining Process

1. **Initial connection**: Node connects to bootstrap peer address (manually configured)
2. **Handshake**: 3-way handshake (PING-PONG-PENG) establishes encrypted session
3. **Key validation**: Bootstrap peer validates signature against trusted keys, rejects if untrusted
4. **Peer exchange**: Upon successful auth, peers exchange NODE_INFO with other known peers
5. **Mesh expansion**: Node connects to discovered peers, repeating handshake process

## Security Considerations

- **Privacy**: Node identities transmitted as salted hashes (not full public keys) during initial handshake
- **No enrollment workflow**: No manual approval process; authentication is purely cryptographic
- **Replay prevention**: Nonce pinning and signatures prevent replay of handshake messages
- **Concurrent connection handling**: When two peers simultaneously initiate, higher node_id wins to prevent duplicate connections

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Ed25519 public keys for headless/automated enrollment
- [ ] **OAuth/OIDC** - No SSO integration
- [ ] **Interactive login** - No browser-based authentication
- [x] **CLI authentication** - Command-line key generation via `vpncloud genkey`

### Authorization
- [ ] **Admin approval workflow** - Automatic authorization based on trusted keys only
- [ ] **Automated enrollment rules** - Simple allow/deny based on key trust
- [ ] **Ephemeral nodes** - No automatic cleanup (manual peer timeout only)
- [ ] **Node expiry** - No time-limited authorization

### Identity
- [x] **Stable device identity** - Ed25519 keypair persists across restarts (if saved)
- [x] **Identity portability** - Keys can be copied between devices (same identity)
- [ ] **Multi-user support** - One identity per VpnCloud instance (not per-user)

# Platform Support

VpnCloud primarily targets Linux with varying levels of support for other platforms.

## Supported Platforms

**Linux**: Full support with all features. Uses standard Linux TUN/TAP interfaces via /dev/net/tun. VpnCloud is packaged for Debian/Ubuntu (DEB) and RedHat/CentOS (RPM) distributions.

**macOS**: Partial support mentioned in README ("help needed"). Rust code compiles, but TUN/TAP interface handling may require platform-specific adjustments. Community contributions welcome.

**Windows**: Partial support mentioned in README ("help needed"). Requires Windows TUN/TAP driver (e.g., TAP-Windows). Community contributions for full Windows support welcome.

**FreeBSD/OpenBSD**: Limited/unknown support. Code uses some Linux-specific features (epoll, /proc/sys) that would need BSD equivalents.

**Mobile (iOS/Android)**: No support. No mobile apps available.

## Implementation Details

**Userspace implementation**: VpnCloud runs entirely in userspace. It does not use any kernel modules or require kernel modifications.

**TUN/TAP interface**: Uses standard operating system TUN (Layer 3) and TAP (Layer 2) virtual network interfaces. On Linux, this is the standard /dev/net/tun device.

**Single binary**: Statically-linked binary with no external dependencies. Entire VPN runs as a single process.

**Privilege requirements**: Requires root/administrator privileges to create TUN/TAP interfaces. After interface creation, can drop privileges to specified user/group for security.

**Container support**: Works in Docker/containers but requires NET_ADMIN capability to create TUN/TAP devices. Can run as systemd service with restrictions.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support with all features
- [ ] **macOS** - Partial/experimental support (help needed)
- [ ] **Windows** - Partial/experimental support (help needed)
- [ ] **FreeBSD/OpenBSD** - No official BSD support

### Mobile
- [ ] **iOS** - No mobile app
- [ ] **Android** - No mobile app

### Implementation
- [ ] **Kernel-mode datapath** - No kernel module (not WireGuard-based)
- [x] **Userspace implementation** - Runs entirely in userspace via TUN/TAP devices
- [x] **Container support** - Docker/Kubernetes with NET_ADMIN capability
