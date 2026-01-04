# Overview

ZeroTier is a software-defined networking solution that creates virtual Ethernet networks (Layer 2) spanning the global internet. It functions as a "planetary scale virtual switch" allowing devices anywhere to communicate as if on a local LAN.

**Key Architecture Components:**

- **Node** - Core implementation handling virtual network frame processing, encryption, and packet routing
- **Switch** - Packet switching and routing logic with active queue management (CoDel algorithm)
- **Topology** - Network topology management tracking peers, root servers (planets), and optional user-defined root servers (moons)
- **Network** - Virtual LAN abstraction providing Ethernet emulation with multicast/broadcast support
- **PacketMultiplexer** - Optional multi-threaded packet processing (Linux only)

The architecture follows a VL1 (virtual layer 1 - point-to-point encryption) and VL2 (virtual layer 2 - Ethernet emulation) model, where each peer-to-peer connection is independently encrypted before being used to tunnel Layer 2 Ethernet frames.

# Protocol

ZeroTier uses a custom UDP-based protocol (currently version 13, supporting backward compatibility to version 4). The protocol is designed for NAT traversal with root server coordination.

**Control Plane Communication:**

The control plane uses a verb-based protocol with commands like HELLO (handshake), WHOIS (address lookup), RENDEZVOUS (NAT traversal coordination), NETWORK_CONFIG_REQUEST/NETWORK_CONFIG (configuration distribution), and various multicast coordination verbs.

Root servers (called "planets") facilitate peer discovery and NAT hole-punching. When two peers need to connect:
1. Each peer maintains connections to root servers
2. Peers request configuration and peer information from network controllers (embedded in network ID)
3. Root servers coordinate rendezvous for NAT traversal via VERB_RENDEZVOUS
4. Peers exchange HELLO packets to establish direct encrypted connections
5. Once established, peers exchange PUSH_DIRECT_PATHS to advertise additional endpoints

**Data Plane Communication:**

Data packets are sent using VERB_FRAME (compressed MAC addresses) or VERB_EXT_FRAME (full MAC addresses) verbs. Each packet includes a 64-bit packet ID (used as crypto IV), source/destination ZeroTier addresses (5 bytes each), flags/cipher/hops byte, and a 64-bit MAC for authentication.

Packets can be fragmented if they exceed the path MTU. The default MTU is 2800 bytes, with a conservative approach to avoid fragmentation issues.

**Transport Protocol Support:**

ZeroTier primarily uses UDP for all communication. When UDP is blocked or direct peer-to-peer connections fail, it falls back to TCP relay servers. There is no QUIC or WebSocket support.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary transport protocol
- [x] **TCP fallback** - Works through restrictive firewalls via relay servers (default: 204.80.128.1:443)
- [ ] **QUIC support** - Modern multiplexed transport
- [ ] **WebSocket support** - HTTP-compatible tunneling

### IP Support
- [x] **IPv4 support** - IPv4 tunnel traffic
- [x] **IPv6 support** - Native IPv6 tunneling
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6

### Network Layer Mode
- [ ] **Layer 3 (IP) mode** - IP packet routing only
- [x] **Layer 2 (Ethernet) mode** - Full Ethernet frame tunneling
- [x] **Bridging support** - Bridge non-VPN devices onto network

### Advanced
- [x] **Multipath/bonding** - Aggregate multiple network paths (6 policies: NONE, ACTIVE_BACKUP, BROADCAST, BALANCE_RR, BALANCE_XOR, BALANCE_AWARE)
- [x] **QoS/traffic shaping** - 9 priority queues with CoDel-based AQM
- [x] **Multicast support** - Virtual multicast/broadcast via MULTICAST_LIKE/GATHER/FRAME verbs

# Encryption

ZeroTier uses modern elliptic curve cryptography with multiple cipher suites for different use cases.

**Key Exchange:**

The protocol uses Curve25519 for ECDH key agreement and Ed25519 for signatures. Each node has a 64-byte public key (32-byte Curve25519 + 32-byte Ed25519) and 64-byte private key. The symmetric session keys are 48 bytes derived from the ECDH shared secret.

**Cipher Suites:**

1. **C25519_POLY1305_NONE** - MAC-only for HELLO packets
2. **C25519_POLY1305_SALSA2012** - Legacy encryption with Poly1305 MAC + Salsa20/12 stream cipher
3. **NO_CRYPTO_TRUSTED_PATH** - No encryption for trusted LANs (data center use)
4. **AES_GMAC_SIV** - Modern authenticated encryption using AES-256 with GMAC-SIV, hardware accelerated on x86 (AES-NI) and ARM (NEON Crypto)

**Extended Armor (Protocol v13+):**

Adds ephemeral keying with a second encryption pass for HELLO packets. This includes an ephemeral public key in the packet and uses AES-CTR with an ephemeral shared secret to hide HELLO packets from non-root observers.

**Notable Security Design:**

- HELLO packets are sent in cleartext (or with extended armor) to bootstrap the encrypted connection
- Static ECDH keys are reused until identity changes (no perfect forward secrecy by default)
- Memory-hard hashcash identity validation prevents identity grinding attacks (2MB, SHA-512 + Salsa20)
- Replay protection via packet counter/nonce

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519/X25519 ECDH
- [ ] **Perfect Forward Secrecy** - Static ECDH keys reused (ephemeral keys only for HELLO extended armor)
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [ ] **Key rotation** - Keys are static per identity, no automatic periodic rotation

### Symmetric Encryption
- [x] **Authenticated encryption** - AES-256-GMAC-SIV (modern) and Poly1305 (legacy)
- [x] **Hardware-accelerated crypto** - AES-NI on x86, ARM NEON Crypto
- [x] **Constant-time operations** - Timing attack resistant implementations

### Protocol Security
- [x] **Replay protection** - 64-bit packet counter/nonce verification
- [ ] **Noise Protocol or equivalent** - Custom handshake protocol (not Noise)
- [ ] **No cleartext metadata** - HELLO packets contain public identities in cleartext (or extended armor)

# Performance

ZeroTier supports multi-threaded packet processing on Linux but remains single-threaded on other platforms.

**Threading Model:**

The codebase uses a PacketMultiplexer that distributes packets to worker threads based on flow ID (flow hashing to specific threads). However, this is disabled on macOS, OpenBSD, NetBSD, and Windows due to platform-specific limitations. The concurrency level is configurable on Linux, with flow-based packet distribution to avoid reordering.

Throughout the codebase, extensive mutex protection is used (network state, peer tables, path tables, bond state), indicating the design is primarily single-threaded with optional multi-core packet processing on Linux.

**Packet Processing:**

Packets are copied at multiple stages: TAP devices read into 16KB stack buffers, then copied to packet structures. Packets inherit from Buffer<ZT_PROTO_MAX_PACKET_LENGTH> with static allocation. The RX queue uses a ring buffer to reuse slots.

**I/O Optimizations:**

On Linux, receive batching uses recvmmsg with 128 packets per call. However, sending uses individual sendto() calls per packet (no sendmmsg batching). An outer loop can process up to 1024 receive batches before returning. Non-Linux platforms fall back to recvfrom() in a tight loop.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Parallel packet handling across CPU cores (Linux only)
- [ ] **Per-core packet queues** - Flow-based distribution, not per-core queues

### Packet I/O
- [x] **Batch UDP receives** - Uses recvmmsg with 128 packets per batch on Linux
- [ ] **Batch UDP sends** - Uses individual sendto() per packet (no sendmmsg)
- [x] **Large batch sizes** - 128 packets per recvmmsg batch

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Not implemented
- [ ] **UDP GRO (Generic Receive Offload)** - Not implemented

### Buffer Management
- [x] **Buffer pool reuse** - Fixed static allocation with ring buffer reuse for RX queue
- [ ] **Large UDP socket buffers** - Socket buffer configuration exists but passes 0 (unused), defaults to ~200KB

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - Relies on kernel TCP
- [ ] **Large TCP RX/TX buffers** - Uses kernel defaults (~128KB)
- [ ] **Tuned congestion control** - Uses kernel TCP congestion control
- [ ] **Reordering tolerance** - Kernel TCP handling

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No coalescing
- [ ] **RX checksum offload** - Standard kernel handling

### MTU Handling
- [x] **Conservative MTU** - Default 2800 bytes to avoid fragmentation
- [ ] **Path MTU discovery** - Fixed MTU, no dynamic discovery

### Peer Management
- [x] **Lazy peer removal** - Peers expire after 243+ seconds
- [x] **Endpoint caching** - Caches paths and best endpoints
- [x] **Efficient keepalive timers** - 60-second ping interval

### Packet Processing
- [x] **Zero-allocation parsing** - Static buffer allocation on hot paths
- [ ] **Zero-copy filtering** - Multiple buffer copies (TAP to packet structure)

### State Synchronization
- [x] **Delta updates** - Network configuration supports delta updates
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression (LZ4, LZO, Zlib)
- [ ] **Configurable compression level** - Not supported

# Security

ZeroTier has a relatively good security track record with a few documented issues.

**Known Security Issues:**

1. **CVE-2023-XXXX (Windows File Permissions, v1.10.4, March 2023)** - File permission problem on Windows allowed non-privileged local users to read privileged files in the ZeroTier service's working directory, enabling unprivileged local Windows users to administrate the local ZeroTier instance. Not remotely exploitable.

2. **Local Privilege Escalation (Windows Installer, v1.8.8, April 2022)** - Bug in Windows installer allowed local privilege escalation.

3. **Authentication Failure Bug (v1.8.9, April 2022)** - Long-standing bug causing sporadic "phantom" packet authentication failures. Not a security vulnerability but could cause link failures.

**Security Strengths:**

- Memory-hard hashcash identity validation prevents address collision attacks
- Modern cryptography (Curve25519, AES-256-GCM-SIV, Poly1305)
- Extensive rate limiting throughout the codebase
- Signed world/root updates prevent silent replacement
- Optional HELLO packet encryption (extended armor)

**Potential Concerns:**

- No perfect forward secrecy by default (static ECDH keys)
- HELLO packets reveal identity in cleartext (unless extended armor enabled)
- Trusted path mode disables all security (for data centers)
- Controller compromise = network compromise (single point of trust)
- 64-bit MAC may be weaker than 128-bit standards (though still computationally infeasible to forge)

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - Prevents amplification/DoS attacks throughout codebase
- [x] **Stateful packet filter** - Flow rules engine with connection tracking
- [x] **Fine-grained ACLs** - Per-port/protocol access control via flow rules (up to 1024 rules)
- [x] **Capability-based access** - Capabilities, tags, certificates of ownership

### Identity & Authentication
- [x] **Identity validation** - Memory-hard hashcash with 2MB buffer prevents grinding
- [x] **Signed configuration updates** - Network configs and certificates signed by controller
- [ ] **Certificate pinning** - No pinning for root servers, trust based on embedded planet.world file

### Implementation
- [ ] **Memory-safe language** - C++ (not memory-safe, though uses modern practices)
- [ ] **Privilege separation** - Runs as root/admin for network interface management
- [ ] **Sandboxing** - No process isolation
- [x] **Audit logging** - Remote tracing capability for debugging

# NAT Traversal

ZeroTier uses root server coordination for NAT hole-punching with support for various NAT types.

**NAT Traversal Mechanism:**

Root servers facilitate UDP hole-punching via VERB_RENDEZVOUS. When peers need to connect through NAT:
1. Root server sends RENDEZVOUS to both peers with each other's public IP:port
2. Each peer sends a low-TTL "junk" packet to open NAT mapping
3. Peers then attempt direct HELLO to establish encrypted connection
4. Self-awareness system tracks external IP addresses reported by trusted peers (10-minute timeout)
5. Paths reset when external address changes (NAT rebinding detection)

**Port Mapping:**

UPnP/NAT-PMP support is available via miniupnpc and libnatpmp libraries. Port mapping can be enabled in local.conf with "portMappingEnabled": true.

**Symmetric NAT:**

The rendezvous mechanism works for most NAT scenarios including symmetric NAT where both parties can receive the hole-punch. For truly symmetric NAT with per-destination port randomization, TCP relay fallback is available.

## NAT Traversal Checklist

### Discovery
- [ ] **STUN support** - No STUN, uses root server reporting instead
- [x] **Multiple STUN servers** - Multiple root servers provide redundancy
- [x] **NAT type detection** - Self-awareness tracking of external addresses

### Port Mapping
- [x] **UPnP port mapping** - Automatic router port forwarding via miniupnpc
- [x] **NAT-PMP support** - Apple/open port mapping protocol via libnatpmp
- [ ] **PCP support** - No Port Control Protocol (RFC 6887) support

### Hole Punching
- [x] **UDP hole punching** - Direct peer-to-peer through NAT via rendezvous
- [x] **Symmetric NAT handling** - Rendezvous works for most symmetric NAT cases
- [x] **Rendezvous coordination** - Root server-assisted hole punching

### Fallback
- [x] **Relay fallback** - TCP relay when direct fails (default: 204.80.128.1:443)
- [x] **Multiple relay regions** - Can configure custom relay servers
- [x] **Automatic relay selection** - Falls back after detecting UDP blockage
- [x] **TCP relay support** - Relay over TCP when UDP blocked

# Local Routing

ZeroTier does not use broadcast/multicast for LAN discovery but supports optimizations for local networks.

**LAN Discovery:**

ZeroTier removed LAN announcement parsing in Protocol v13. All peer discovery happens through:
1. Root servers (primary discovery mechanism)
2. Moon servers (optional user-defined roots)
3. PUSH_DIRECT_PATHS from known peers advertising their endpoints

There is no multicast/broadcast-based local discovery - all discovery is coordinated through the root infrastructure.

**Trusted Paths:**

For LANs where encryption overhead is unnecessary (e.g., SDN data centers), trusted path mode can be configured in local.conf:

```javascript
"physical": {
    "10.10.10.0/24": {
        "trustedPathId": 101010024
    }
}
```

This disables encryption and authentication for packets from the specified subnet (all devices must use same trusted path ID). The MAC field becomes a trusted path ID instead of authentication tag.

**Direct Path Advertisement:**

Peers advertise their reachable addresses via VERB_PUSH_DIRECT_PATHS, including multiple potential endpoints. This is rate-limited to prevent DoS amplification. Once peers know each other's local addresses (via root coordination), they can establish direct connections even on the same LAN.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - Removed in v13, no LAN announcements
- [x] **Direct path advertisement** - PUSH_DIRECT_PATHS shares reachable endpoints
- [ ] **Same-subnet detection** - No automatic detection, relies on root coordination

### LAN Optimization
- [ ] **Automatic LAN preference** - No automatic preference, uses path quality metrics
- [x] **Trusted path mode** - Skip encryption on configured trusted LANs
- [ ] **LAN-only mode** - No LAN-only restriction option

### Routing Features
- [x] **Subnet routes** - Route traffic for other networks through peer (up to 128 routes per network)
- [x] **Full tunnel mode** - Route all traffic through a peer
- [x] **Split tunneling** - Selective routing via flow rules
- [ ] **Route priorities** - Route selection based on metrics, not explicit priorities

# Central Point of Failure

ZeroTier has both root servers (planets/moons) and network controllers as potential points of failure, though with significant resilience.

**Root Servers (Planets):**

The default "Earth" planet has up to 4 root servers with up to 32 stable endpoints each. If all root servers fail:
- Existing direct peer-to-peer connections continue working
- New connections cannot be established (no rendezvous coordination)
- Cannot receive network configuration updates
- Cannot validate new peer identities via WHOIS

**Network Controllers:**

Every network ID embeds the controller address (first 40 bits of network ID = controller ZeroTier address). If the controller fails:
- Existing authorized members continue communicating
- New members cannot join
- Configuration changes cannot propagate
- Certificate renewals fail (60-second heartbeat default)

**Mitigations:**

1. **Moons** - User-operated root servers (though deprecated in favor of network-specific relays)
2. **Self-hosted controllers** - Run your own EmbeddedNetworkController
3. **Root redundancy** - Multiple roots can be defined per planet/moon
4. **Cached state** - Nodes cache peer information and configuration locally

**Offline Operation:**

Nodes cache peer information, paths, and network configuration locally. Existing connections remain functional when the controller is unreachable, but new connections and configuration changes require controller availability.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Direct peer connections continue without controller
- [x] **Local state caching** - Persists peer/config information to disk
- [ ] **Cached credentials** - Credentials must be renewed periodically (60s heartbeat)
- [x] **Graceful degradation** - Existing tunnels work, new connections fail without roots

### Redundancy
- [x] **Self-hosted controller** - Can run own EmbeddedNetworkController
- [x] **Controller redundancy** - Can use moons or network-specific relays
- [x] **Relay redundancy** - Multiple relay servers, custom relays configurable
- [ ] **No single root of trust** - Controller holds signing keys for network (single point of trust)

### Efficiency
- [x] **Delta/incremental updates** - Network config supports delta updates
- [ ] **Long polling / push updates** - Periodic polling, not push-based
- [x] **Configurable sync interval** - 60-second default heartbeat, configurable

# Authentication

ZeroTier uses cryptographic identity validation and certificate-based network membership.

**Identity Generation and Validation:**

Nodes generate identities using memory-hard hashcash to prevent identity grinding:
1. Generate Curve25519/Ed25519 keypair
2. Run memory-hard hash (SHA-512 + Salsa20 with 2MB buffer)
3. Repeat until first byte of digest < 17
4. Last 5 bytes of digest become ZeroTier address (40-bit address space)

This makes generating specific addresses computationally expensive and resistant to collision attacks.

**Network Membership:**

Networks use **Certificates of Membership (COM)** signed by the network controller. These contain:
- Timestamp
- Network ID
- Issued-to ZeroTier address
- Qualifiers defining agreement bounds
- Must be periodically renewed (60-second default)

**Network Types:**

- **Private Networks** - Require COMs signed by controller (default)
- **Public Networks** - No access control, anyone can join

**Additional Credentials:**

- **Capabilities** - Fine-grained access control permissions
- **Tags** - Arbitrary key-value metadata for flow rule matching
- **Revocations** - Credential revocation lists
- **Certificates of Ownership** - IP/MAC ownership proofs

**SSO/OIDC Support:**

ZeroTier supports OAuth/OIDC integration for enterprise authentication, available when compiled with ZT_SSO_ENABLED flag.

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Headless/automated enrollment via controller API
- [x] **OAuth/OIDC** - SSO integration (optional compile-time feature)
- [x] **Interactive login** - Browser-based authentication for SSO
- [x] **CLI authentication** - Command-line auth flow via zerotier-cli

### Authorization
- [x] **Admin approval workflow** - Manual device authorization by network admin
- [x] **Automated enrollment rules** - Conditional automatic authorization via controller
- [ ] **Ephemeral nodes** - No automatic cleanup (manual deauthorization required)
- [ ] **Node expiry** - No time-limited authorization (COMs expire but nodes don't)

### Identity
- [x] **Stable device identity** - Persistent cryptographic identity across restarts
- [ ] **Identity portability** - Identity tied to private key file (can copy, but not designed for portability)
- [ ] **Multi-user support** - One identity per node, not per-user

# Platform Support

ZeroTier supports a wide range of platforms with varying implementation details.

**Supported Platforms:**

ZeroTier runs on Linux, macOS, Windows, FreeBSD, OpenBSD, NetBSD, iOS, and Android. The core is written in C++ with platform-specific code in the osdep/ directory.

**Implementation Details:**

- **Linux**: Full-featured with multi-threaded packet processing, uses TAP devices
- **macOS**: Single-threaded, uses utun interfaces, full tunnel mode support
- **Windows**: Single-threaded, uses custom TAP driver (TapDriver6), experimental ARM64 support (v1.12.0+)
- **BSD**: Single-threaded, limited compared to Linux/macOS
- **iOS/Android**: Mobile apps available in app stores with userspace implementations

**Multi-threading Limitations:**

PacketMultiplexer (multi-threaded packet processing) is explicitly disabled on macOS, OpenBSD, NetBSD, and Windows. Only Linux gets multi-core packet processing.

**Data Path:**

- **Kernel-mode**: Windows uses kernel TAP driver
- **Userspace**: Most platforms use userspace TAP/TUN with kernel interfaces
- No kernel WireGuard-style implementation

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support with multi-threading
- [x] **macOS** - Full support (single-threaded)
- [x] **Windows** - Full support (single-threaded, ARM64 experimental)
- [x] **FreeBSD/OpenBSD** - BSD support (limited, single-threaded)

### Mobile
- [x] **iOS** - Mobile app in App Store
- [x] **Android** - Mobile app in Google Play

### Implementation
- [x] **Kernel-mode datapath** - Windows TAP driver runs in kernel
- [x] **Userspace implementation** - Most platforms use userspace with kernel TUN/TAP
- [x] **Container support** - Docker/Kubernetes integration available
