# Overview

Yggdrasil is an experimental, fully end-to-end encrypted IPv6 overlay network. It is lightweight, self-arranging, and designed to provide secure communication between nodes without requiring central infrastructure.

Key Architecture Components:

- **Ironwood Routing Library**: Provides the core routing functionality using a combination of spanning tree and DHT-based routing. The spanning tree is used for greedy routing towards destinations based on tree coordinates, while the DHT handles node location lookups.

- **Phony Actor Model**: All components (Core, links, protocol handlers, nodeinfo, multicast) use the Phony actor model for concurrency, communicating via message passing through actor inboxes rather than traditional mutexes.

- **Source Routing**: Once a path to a destination is discovered via DHT lookup, the path is cached for 2 minutes and packets include explicit path coordinates for efficient forwarding.

- **Cryptographic Identity**: Each node has an Ed25519 key pair, and IPv6 addresses are cryptographically derived from public keys with the prefix 0x02. Keys with more leading 1s (when inverted) result in shorter, more desirable addresses.

- **TUN Interface**: Uses the wireguard-go TUN library for cross-platform support, providing batch read/write operations between the kernel TUN device and userspace.

# Protocol

Yggdrasil uses protocol version 0.5 and supports multiple transport protocols for flexibility across different network environments.

**Control Plane**: Nodes exchange metadata during handshake containing protocol version, Ed25519 public key, and priority value. The handshake is signed using Ed25519 with optional password-based BLAKE2b authentication. Once connected, nodes exchange routing information through the Ironwood DHT and spanning tree protocols.

**Data Plane**: Traffic is sent as encrypted IPv6 packets. The routing uses a hybrid approach: greedy routing via the spanning tree for initial forwarding, DHT lookups for unknown destinations, and cached source routes for known paths. All data is encrypted via Ironwood's encrypted PacketConn which uses ephemeral X25519 key exchange.

**Transport Support**: Yggdrasil does not use raw UDP - instead it supports TCP, TLS (minimum TLS 1.2, prefers TLS 1.3), QUIC, WebSocket (WS), and WebSocket Secure (WSS). The TLS implementation intentionally sets InsecureSkipVerify because it relies on custom Ed25519 signature verification in the handshake rather than traditional PKI.

**Packet Types**: Two packet types are defined - typeSessionTraffic (1) for normal data traffic and typeSessionProto (2) for protocol messages including nodeinfo and debug information.

## Protocol Features Checklist

### Transport
- [ ] **UDP transport** - Not used; relies on TCP/TLS/QUIC/WS instead
- [x] **TCP fallback** - Works through restrictive firewalls
- [x] **QUIC support** - Modern multiplexed transport (uses quic-go library)
- [x] **WebSocket support** - HTTP-compatible tunneling (WS and WSS)

### IP Support
- [ ] **IPv4 support** - IPv4 tunnel traffic not supported (overlay is IPv6-only)
- [x] **IPv6 support** - Native IPv6 tunneling (only IPv6)
- [ ] **Dual-stack** - No IPv4 support at all

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing only (TUN interface)
- [ ] **Layer 2 (Ethernet) mode** - No TAP support, TUN only
- [ ] **Bridging support** - Cannot bridge non-VPN devices onto network

### Advanced
- [ ] **Multipath/bonding** - Only one path used at a time (no multipath routing)
- [ ] **QoS/traffic shaping** - No bandwidth limiting or QoS
- [ ] **Multicast support** - No virtual multicast/broadcast for tunnel traffic

# Encryption

Yggdrasil uses multiple layers of encryption to provide end-to-end security.

**Key Exchange**: Each node has a static Ed25519 key pair for identity. During connection setup, Ironwood's encrypted PacketConn performs ephemeral X25519 key exchange for per-session encryption. The handshake metadata (containing the Ed25519 public key, protocol version, and priority) is signed with the node's Ed25519 private key. Optional password-based authentication uses BLAKE2b-512 keyed hashing.

**Transport Security**: All transport connections use TLS 1.3 (minimum TLS 1.2). However, certificate verification is disabled (InsecureSkipVerify: true) because Yggdrasil performs custom verification based on Ed25519 signatures in the protocol handshake.

**Symmetric Encryption**: Handled by the Ironwood library using ephemeral session keys derived from X25519 key exchange. The exact cipher suite depends on TLS negotiation (typically AES-GCM or ChaCha20-Poly1305).

**Address Derivation**: IPv6 addresses are deterministically derived from Ed25519 public keys. The format is: prefix (0x02) + leading_ones_count (8 bits) + truncated inverted key. This ensures addresses are cryptographically bound to node identity.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - X25519 ECDH (via Ironwood) + Ed25519 signatures
- [x] **Perfect Forward Secrecy** - Ephemeral X25519 session keys
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [ ] **Key rotation** - No visible automatic periodic key refresh mechanism

### Symmetric Encryption
- [x] **Authenticated encryption** - TLS 1.3 provides ChaCha20-Poly1305 or AES-GCM
- [ ] **Hardware-accelerated crypto** - Depends on Go crypto library (may use AES-NI)
- [x] **Constant-time operations** - Ed25519 and X25519 are constant-time

### Protocol Security
- [ ] **Replay protection** - No visible nonce/timestamp in handshake (may be in TLS layer)
- [ ] **Noise Protocol or equivalent** - Uses TLS 1.3 + custom handshake (not Noise)
- [ ] **No cleartext metadata** - Ed25519 public keys are visible to peers during handshake

# Performance

Yggdrasil uses the Phony actor model for concurrency, with each major component having its own actor inbox.

**Threading Model**: The codebase spawns goroutines for each peer connection handler, TUN read/write loops, multicast listener, and listener accept loops. All actors communicate via phony.Act() method calls for asynchronous operations, or phony.Block() for synchronous operations. This provides clean isolation but adds message-passing overhead compared to direct function calls.

**Multi-core Utilization**: The actor model allows work to be distributed across CPU cores, though the global keystore uses a sync.Mutex that can become a contention point under high packet rates.

**Memory Management**: Extensive use of sync.Pool for packet buffers - both in the TUN layer (65,615 byte buffers) and core encryption layer. Buffers are returned to the pool after processing to reduce GC pressure.

**Packet Processing Path**: Kernel TUN → Batched Read (via wireguard/tun) → Channel (FIFO) → Batched Write → Core (Ironwood encryption) → Network Links. Notably, while the TUN layer uses batching, each packet is individually processed by Ironwood and sent over the network (no batching at the network/UDP layer).

**Network I/O**: Platform-specific syscalls are abstracted behind the wireguard/tun interface.Read() and interface.Write() methods, which may use recvmmsg/sendmmsg internally on supported platforms. However, Yggdrasil's own network sending code does not batch packets - each is sent individually.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Actor model allows parallel packet handling across cores
- [ ] **Per-core packet queues** - Uses actor inboxes, not per-core queues (potential contention)

### Packet I/O
- [ ] **Batch UDP receives** - Does not use raw UDP; TLS/TCP/QUIC transports not batched
- [ ] **Batch UDP sends** - Network layer sends individual packets through Ironwood
- [ ] **Large batch sizes** - TUN layer batches, but not extended to network layer

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - No raw UDP support
- [ ] **UDP GRO (Generic Receive Offload)** - No raw UDP support

### Buffer Management
- [x] **Buffer pool reuse** - Extensive sync.Pool usage (TUN: 65,615 bytes, Core: variable)
- [ ] **Large UDP socket buffers** - Not applicable; uses TCP/TLS defaults (~128-200KB)

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - Uses kernel TCP
- [ ] **Large TCP RX/TX buffers** - Uses kernel defaults (~128KB)
- [ ] **Tuned congestion control** - Uses kernel default (typically CUBIC)
- [ ] **Reordering tolerance** - Relies on kernel TCP behavior

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No coalescing beyond kernel defaults
- [ ] **RX checksum offload** - Depends on kernel/NIC configuration

### MTU Handling
- [x] **Conservative MTU** - Default MTU handles IPv6 minimum (1280) properly
- [x] **Path MTU discovery** - Sends ICMPv6 Packet Too Big messages

### Peer Management
- [x] **Lazy peer removal** - Exponential backoff for reconnection (max ~1h8m)
- [x] **Endpoint caching** - DHT paths cached for 2 minutes
- [x] **Efficient keepalive timers** - QUIC uses 20-second KeepAlivePeriod

### Packet Processing
- [ ] **Zero-allocation parsing** - Buffers pooled, but parsing allocates on heap
- [ ] **Zero-copy filtering** - Packets copied through multiple layers

### State Synchronization
- [ ] **Delta updates** - DON'T KNOW (handled by Ironwood library)
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression
- [ ] **Configurable compression level** - Not available

# Security

Yggdrasil has had one notable security vulnerability documented:

**CVE: Denial-of-Service in QUIC Library** (v0.5.4 - December 2023): A DoS vulnerability in the underlying QUIC library was fixed with a dependency update. This was not a vulnerability in Yggdrasil's code itself but in the third-party quic-go library.

**Other Security Issues** (from code analysis, not CVEs):

1. **Admin Socket No Authentication**: The admin socket has no authentication (TODO comment in code). Anyone with access to the admin socket (TCP/9001 or UNIX socket) can add/remove peers. File permissions are set to 0660 but there's no password protection.

2. **Debug Endpoint Exposure**: The PPROFLISTEN environment variable enables a pprof HTTP server with no authentication, potentially exposing sensitive runtime information.

3. **Peer Filter Bypass**: The AllowedPublicKeys filter does not apply to local listeners or multicast connections, potentially allowing unauthorized peers on the same LAN.

4. **Password Storage**: Passwords are stored in plaintext in configuration and link options, and are not zeroed after use.

5. **Multicast Beacon Security**: Multicast beacons reveal node presence on local networks and include password hashes that could be brute-forced offline.

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No built-in rate limiting or DoS protection
- [ ] **Stateful packet filter** - No built-in firewall or ACLs
- [ ] **Fine-grained ACLs** - Only AllowedPublicKeys whitelist (binary allow/deny)
- [ ] **Capability-based access** - No capability system beyond simple whitelist

### Identity & Authentication
- [x] **Identity validation** - Ed25519 signature verification of handshakes
- [ ] **Signed configuration updates** - No configuration signing mechanism
- [ ] **Certificate pinning** - Optional per-peer public key pinning

### Implementation
- [x] **Memory-safe language** - Written in Go (memory-safe)
- [x] **Privilege separation** - Supports user privilege dropping and OpenBSD pledge
- [ ] **Sandboxing** - No process sandboxing beyond pledge on OpenBSD
- [ ] **Audit logging** - No security event logging

# NAT Traversal

Yggdrasil does NOT implement traditional NAT traversal techniques like STUN/TURN/ICE. Instead, it relies on at least one peer having a publicly accessible endpoint.

**Strategy**: Uses persistent outbound connections that maintain NAT state. If a node behind NAT connects to a public peer, the connection remains open and bidirectional. However, two nodes behind restrictive NAT cannot connect to each other without an intermediary peer.

**Proxy Support**: Can tunnel through SOCKS5 proxies and HTTP proxies (via WebSocket/WSS), which helps traverse some network restrictions but doesn't solve the double-NAT problem.

**Local Discovery**: Multicast discovery works on local network segments using IPv6 multicast group [ff02::114]:9001, but this only works on the same LAN.

## NAT Traversal Checklist

### Discovery
- [ ] **STUN support** - No STUN implementation
- [ ] **Multiple STUN servers** - Not applicable
- [ ] **NAT type detection** - No NAT detection

### Port Mapping
- [ ] **UPnP port mapping** - No UPnP support
- [ ] **NAT-PMP support** - No NAT-PMP support
- [ ] **PCP support** - No PCP support

### Hole Punching
- [ ] **UDP hole punching** - No UDP support at all (uses TCP/TLS/QUIC)
- [ ] **Symmetric NAT handling** - Not applicable
- [ ] **Rendezvous coordination** - No hole-punching coordination

### Fallback
- [ ] **Relay fallback** - No built-in relay mechanism
- [ ] **Multiple relay regions** - Not applicable
- [ ] **Automatic relay selection** - Not applicable
- [x] **TCP relay support** - Any publicly accessible peer acts as relay implicitly

# Local Routing

Yggdrasil uses multicast discovery on local networks but all traffic is still routed through the mesh topology (encrypted and potentially via remote paths).

**LAN Discovery**: Nodes on the same LAN discover each other via IPv6 multicast beacons on [ff02::114]:9001. Beacons contain protocol version, Ed25519 public key, listening port, and optional password hash. When a beacon is received and verified, the node initiates a TLS connection to the discovered peer.

**Routing Behavior**: Even between local peers, packets are routed through the Yggdrasil mesh using the spanning tree/DHT routing algorithm. The routing is overlay-based and doesn't necessarily prefer the direct LAN connection - it depends on the tree topology. If two LAN nodes connect but the spanning tree routes through remote nodes, traffic may take inefficient paths.

**No LAN Optimization**: There is no automatic preference for local paths over WAN paths, and no trusted path mode to skip encryption on local networks. All traffic is always encrypted end-to-end.

## Local Routing Checklist

### LAN Discovery
- [x] **Broadcast/multicast discovery** - IPv6 multicast announcements on configured interfaces
- [x] **Direct path advertisement** - Peers exchange routing information via spanning tree
- [ ] **Same-subnet detection** - Multicast finds local peers but doesn't optimize routing

### LAN Optimization
- [ ] **Automatic LAN preference** - Routing follows tree topology, not physical proximity
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [ ] **LAN-only mode** - No restriction to local network only

### Routing Features
- [ ] **Subnet routes** - No subnet routing through peers
- [ ] **Full tunnel mode** - No default route support
- [ ] **Split tunneling** - No selective routing configuration
- [ ] **Route priorities** - Link priority configuration exists but not route priorities

# Central Point of Failure

Yggdrasil is fully decentralized with no central points of failure.

**No Bootstrap Servers**: Peers can be manually configured or discovered via multicast. There are no required bootstrap or rendezvous servers.

**No Central Controller**: The network has no control plane server. All routing information is distributed via the DHT, and the spanning tree root is automatically selected based on cryptographic key properties (highest key value). Any node can become root.

**Self-Healing**: Persistent connection attempts with exponential backoff (default max ~1h8m) ensure nodes automatically reconnect when peers become available. The DHT provides multiple paths to destinations, and if the spanning tree root disappears, a new root is automatically elected.

**Graceful Degradation**: When peers are unreachable, the node continues to function with remaining peers. Cached routing information (DHT paths) expires after 2 minutes, forcing fresh lookups if stale. Existing connections remain operational even if multicast or configuration changes occur.

**Potential Weaknesses**: Small networks may be susceptible to Sybil attacks. Initial peer discovery requires at least one known peer or multicast capability. If all peers are down, the node is isolated.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Connections maintain state independent of other peers
- [x] **Local state caching** - DHT paths cached for 2 minutes, peer info persisted
- [ ] **Cached credentials** - Configuration must be available (file or explicit)
- [x] **Graceful degradation** - Node functions with available peers, no hard requirements

### Redundancy
- [x] **Self-hosted controller** - No controller at all; fully peer-to-peer
- [x] **Controller redundancy** - Not applicable (no controller)
- [x] **Relay redundancy** - Any peer can relay; mesh topology provides redundancy
- [x] **No single root of trust** - Tree root is elected automatically, not fixed

### Efficiency
- [ ] **Delta/incremental updates** - DON'T KNOW (handled by Ironwood library)
- [ ] **Long polling / push updates** - DHT uses request/response, not push
- [x] **Configurable sync interval** - DHT path cache timeout is fixed at 2 minutes

# Authentication

Yggdrasil uses cryptographic identity-based authentication with optional access control.

**Enrollment**: There is no enrollment process or centralized authentication. Nodes generate an Ed25519 key pair locally (using crypto/rand for secure random generation). The public key becomes the node's permanent identity, and the IPv6 address is deterministically derived from this key.

**Peer Authentication**: During connection handshake, both sides exchange signed metadata containing their Ed25519 public key, protocol version, and priority. Each side verifies the other's signature to prove possession of the private key. Optional password-based authentication uses BLAKE2b-512 keyed hashing - both sides must know the password for the connection to succeed.

**Access Control**: The AllowedPublicKeys configuration option provides a whitelist of permitted peer public keys. If the list is empty, all connections are allowed. If populated, only peers whose public keys are in the list can connect (for outbound connections). However, this filter does not apply to local listeners or multicast-discovered peers.

**No Revocation**: There is no certificate revocation or key expiry mechanism. Once a key pair is generated, it remains valid forever unless manually replaced.

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Generate key pair locally, no enrollment required
- [ ] **OAuth/OIDC** - No SSO integration
- [ ] **Interactive login** - No login process; purely cryptographic
- [x] **CLI authentication** - Generate keys via command-line tool

### Authorization
- [ ] **Admin approval workflow** - No centralized approval mechanism
- [ ] **Automated enrollment rules** - Only AllowedPublicKeys whitelist
- [ ] **Ephemeral nodes** - No automatic cleanup
- [ ] **Node expiry** - No time-limited authorization

### Identity
- [x] **Stable device identity** - Ed25519 key persists across restarts (if config saved)
- [x] **Identity portability** - Can copy private key to another device
- [ ] **Multi-user support** - One identity per node

# Platform Support

Yggdrasil supports a wide range of platforms through Go's cross-compilation and the wireguard-go TUN library.

**Implementation**: Entirely userspace implementation using the wireguard-go TUN library (golang.zx2c4.com/wireguard) for cross-platform TUN device support. No kernel module required. Platform-specific code exists for TCP socket control (link_tcp_linux.go, link_tcp_darwin.go, link_tcp_other.go) to handle interface binding and other OS-specific features.

**Privilege Requirements**: Requires CAP_NET_ADMIN on Linux or administrator/root privileges on other platforms to create TUN adapters. OpenBSD supports pledge() for privilege separation. User privilege dropping is supported after TUN creation.

**Container Support**: Can run in containers with appropriate capabilities. Mobile platform support exists for iOS and Android in the contrib/mobile/ directory.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support (mentioned in README)
- [x] **macOS** - Full support (mentioned in README)
- [x] **Windows** - Full support (uses wintun library)
- [x] **FreeBSD/OpenBSD** - BSD support (OpenBSD has pledge support)

### Mobile
- [x] **iOS** - Mobile app support in contrib/mobile/
- [x] **Android** - Mobile app support in contrib/mobile/

### Implementation
- [ ] **Kernel-mode datapath** - No kernel module
- [x] **Userspace implementation** - Entirely userspace via wireguard-go TUN
- [x] **Container support** - Docker/Kubernetes compatible with proper capabilities
