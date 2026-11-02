# Overview

VpnCloud is a peer-to-peer mesh VPN written in Rust that operates over UDP (default port 3210). It creates virtual network interfaces (TUN or TAP devices) and forwards all received data via UDP to destination peers. Nodes authenticate with Ed25519 identity keys; session keys come from ephemeral X25519 (Curve25519) ECDH, and traffic is protected with authenticated encryption (AES-128-GCM, AES-256-GCM or ChaCha20-Poly1305, all from the `ring` library).

## Key Architecture Components

**Single-Threaded Event Loop**: VpnCloud uses a single-threaded architecture with epoll-based event multiplexing over exactly two file descriptors: one UDP socket and one TUN/TAP device. The main loop processes one event at a time (maxevents=1 in epoll_wait), handling socket events, device events, and once-per-second housekeeping sequentially. The epoll backend is only compiled for Linux/Android; there is no kqueue or Windows backend.

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

**Few Runtime Dependencies**: VpnCloud is a single binary and needs no kernel module. It is written in Rust, but uses `unsafe` FFI for the TUN/TAP and interface ioctls and for epoll, and the `ring` crypto library contains C and assembly. The Debian package links against glibc (`libc6`), so the binary is not fully static. Device handling is Linux-specific (`/dev/net/tun`, `TUNSETIFF`, `/proc/net/route`, `/proc/sys`).

# Protocol

VpnCloud uses a custom UDP-based protocol. Handshake (init) messages start with the byte 0xFF and are sent unencrypted but signed. All other messages are AEAD-encrypted, and the message type is the first byte inside the ciphertext:
- DATA (0x00): Encrypted payload packets
- NODE_INFO (0x01): Peer and subnet claim announcements
- KEEPALIVE (0x02): Defined and handled on receive, but never sent; NODE_INFO broadcasts act as keepalives
- ROTATION (0x10): Key-rotation messages (internal to the crypto layer)
- CLOSE (0xFF): Graceful connection termination

## Control Plane Communication

**3-Way Handshake (Ping-Pong-Peng)**:

1. **PING**: Initiator sends a salted node ID hash (4-byte random salt plus 16 bytes of SHA-256 over the salt and the per-run random node ID), an ephemeral X25519 ECDH public key, its supported encryption algorithms with benchmark speeds, and an Ed25519 signature. The Ed25519 public key itself is not sent: it is identified by a 4-byte random salt plus the first 4 bytes of SHA-256(public key ‖ salt), which the receiver matches against its trusted keys
2. **PONG**: Responder sends own salted node ID hash, ECDH public key, algorithms, and its NODE_INFO payload encrypted with the negotiated session key
3. **PENG**: Initiator confirms with its own encrypted NODE_INFO payload

The handshake includes automatic role negotiation for concurrent connections (the side with the higher salted node ID hash wins) and algorithm selection: for every algorithm both sides support, the slower of the two reported speeds counts, and the algorithm with the highest such value is chosen. Unanswered handshake messages are retransmitted every second, up to 120 times, before the attempt is aborted.

**Session key derivation**: The raw X25519 shared secret is truncated to the cipher's key length and used directly as the AEAD key. There is no KDF, no hashing of the handshake transcript, and the same key is used in both directions, with the nonce space split between the two peers.

**Peer Discovery**: Peers broadcast NODE_INFO messages periodically, by default every 90 seconds (`keepalive` defaults to `peer_timeout / 2 - 60` with `peer_timeout` = 300 s), containing:
- Their own addresses (configured advertise addresses, the local socket address, UPnP internal/external addresses, and addresses peers reported back)
- Up to 20 randomly chosen known peers with their addresses
- Claimed subnet ranges
- Peer timeout settings

Each NODE_INFO is a full snapshot, not a delta.

## Data Plane

**Packet Flow**:
1. Application writes packet to virtual TUN/TAP interface
2. VpnCloud wakes from `epoll_wait` and reads exactly one packet via `read()` into a reused 64 KiB buffer
3. Destination address looked up in the claim table (hash-map cache first, then longest-prefix scan over claims)
4. Packet encrypted with the peer's session key in place (an 8-byte key ID + nonce header is prepended and a 16-byte tag appended; no buffer copy)
5. Sent via one blocking UDP `sendto()` to the destination peer
6. Receiving peer does `epoll_wait` + `recvfrom()`, decrypts in place, and `write()`s the packet to its virtual interface

That is at least three syscalls per packet on each side. There is no batching (`recvmmsg`/`sendmmsg`), no UDP GSO/GRO, no socket buffer tuning, and no TUN offload (`IFF_VNET_HDR`) or multi-queue TUN.

**Transport Protocol**: Normally UDP only; there is no native TCP transport. The optional WebSocket proxy mode replaces a node's UDP socket: if `listen` is set to a `ws://` URL, the node opens a single plain WebSocket (TCP) connection to a `vpncloud ws-proxy` server. That proxy opens a UDP socket on its own public address and forwards datagrams between the node and its UDP peers. This mode is chosen manually per node and is not an automatic fallback. Only `ws://` works: `wss://`/TLS is not supported.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary and only transport protocol for peer-to-peer communication
- [x] **TCP fallback** - Partial: no native TCP transport. A node can be configured to send all its traffic over a WebSocket/TCP connection to a ws-proxy, but this is manual and not an automatic fallback
- [ ] **QUIC support** - Not implemented
- [x] **WebSocket support** - WebSocket proxy mode for restrictive firewalls (UDP datagrams tunneled over plain `ws://`, not `wss://`)

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support
- [x] **IPv6 support** - Native IPv6 tunneling support
- [x] **Dual-stack** - TUN mode carries IPv4 and IPv6 packets on the same interface; the outer socket listens on `[::]` (IPv4-mapped). `--ip` and auto-claim only handle IPv4, so IPv6 addresses and claims must be configured manually (ifup script and `--claim`)

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - TUN device for IP packet routing
- [x] **Layer 2 (Ethernet) mode** - TAP device for Ethernet frame tunneling
- [x] **Bridging support** - TAP mode allows bridging non-VPN devices onto virtual network

### Advanced
- [ ] **Multipath/bonding** - No support for aggregating multiple network paths
- [ ] **QoS/traffic shaping** - No priority queues or traffic classes
- [x] **Multicast support** - Broadcast/multicast and unknown destinations are flooded to all peers (one encrypted unicast per peer) in TAP normal, switch and hub mode, and in TUN hub mode; TUN normal/router mode drops them

# Encryption

VpnCloud implements strong end-to-end encryption using modern cryptographic primitives from the `ring` library.

## Encryption Layer

**Key Exchange**:
- Ed25519 keypairs for node identity and digital signatures
- X25519 Elliptic Curve Diffie-Hellman (ECDH) for ephemeral session key agreement
- PBKDF2-HMAC-SHA256 with 4096 iterations for deriving keypairs from passwords (note: this iteration count is below modern recommendations of 100,000+)

**Session Encryption**:
- Negotiated per-peer based on performance benchmarks
- AES-128-GCM, AES-256-GCM, or ChaCha20-Poly1305 (default allows all three; the fastest common one wins). An optional `plain` setting disables encryption if both peers allow it
- All are authenticated encryption with associated data (AEAD) modes
- In-place encryption (no data copying during encrypt/decrypt operations)

**Nonce Management**:
- 12-byte nonce (96 bits)
- Only 7 bytes transmitted, plus 1 key-ID byte (8-byte header; 5 nonce bytes saved per packet)
- Most significant byte differs between peers (0x00 vs 0x80) to prevent self-decryption
- Nonce pinning: once per second, the minimum accepted nonce per key is raised to the highest nonce seen in the previous interval plus one. Older packets are rejected after 1–2 seconds, which tolerates reordering within that window. There is no per-nonce bitmap, so an exact duplicate that arrives inside the window is accepted

**Key Rotation**:
- Automatic rotation every 120 seconds (per peer, counted by the 1-second housekeeping tick)
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
- [x] **Replay protection** - Partial: nonce pinning rejects packets older than ~1–2 s, but there is no sliding-window bitmap, so duplicates within that window are accepted
- [ ] **Noise Protocol or equivalent** - Custom protocol, not Noise framework
- [x] **No cleartext metadata** - The Ed25519 public key is never sent; it appears only as a 4-byte salted truncated hash (confirmable only by an observer who already knows the key). Node IDs are random per run and salted. Everything after the handshake is encrypted

# Performance

VpnCloud uses a **single-threaded architecture** which significantly limits its performance compared to modern multi-threaded VPN solutions like Tailscale.

## Threading Model

The main event loop uses epoll with `maxevents=1`, processing exactly one event per iteration:
- One packet at a time from UDP socket OR device
- No parallel processing of encryption/decryption
- Cannot utilize multiple CPU cores
- Helper threads exist only for side tasks: beacon commands and hook scripts run in detached threads, and the separate `ws-proxy` server spawns one thread per client. None of them process tunnel packets

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
- [x] **Buffer pool reuse** - No pool, but a single 64 KiB `MsgBuffer` (65535-byte array) allocated once at loop start is reused for every packet; the hot path does no heap allocation
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
- [x] **Conservative MTU** - Partial: at startup the TUN/TAP MTU is set to the default-route interface MTU minus overhead (73 bytes TUN, 87 bytes TAP, assuming an outer IPv6 header), i.e. 1427 (TUN) / 1413 (TAP) on a 1500-byte underlay. The TUN value is above 1420
- [ ] **Path MTU discovery** - Not explicitly implemented

### Peer Management
- [x] **Lazy peer removal** - Peers time out after `peer_timeout` (default 300 s) without any message; a reconnect is attempted immediately
- [x] **Endpoint caching** - Partial: a peer is bound to the socket address its handshake completed on, and its other advertised addresses are stored; there is no best-endpoint selection or path switching. The claim table caches address→peer lookups in a hash map with timeouts (not an LRU)
- [x] **Efficient keepalive timers** - Periodic NODE_INFO broadcast (default every 90 s, configurable via `keepalive`) checked from a 1-second housekeeping tick; no per-packet timers

### Packet Processing
- [x] **Zero-allocation parsing** - Packets are received into the reused buffer, decrypted in place, and parsed for addresses via a `Cursor` over the slice, with no heap allocation on the UDP path (the WebSocket proxy path allocates a `Vec` per packet)
- [ ] **Zero-copy filtering** - No packet filter exists; apart from the kernel↔user copies of `recvfrom`/`read`/`write`, the data path works in place without extra userspace copies

### State Synchronization
- [ ] **Delta updates** - NODE_INFO messages are full periodic snapshots (own addresses, all claims, up to 20 random peers), not incremental updates
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression (LZ4, LZO, Zlib)
- [ ] **Configurable compression level** - Not available

## Performance Impact

The single-packet-per-iteration model with epoll maxevents=1 is the most critical performance bottleneck:
- At least three syscalls per packet (epoll_wait + recvfrom/read + sendto/write), no batching, no offloads
- All encryption and decryption for all peers runs on one core
- No VpnCloud-specific loss/reordering measurements are available here. Reordering itself is tolerated by the 1–2 s nonce-pinning window, so degradation under loss/reordering comes from the inner TCP flows rather than from VpnCloud dropping reordered packets

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

3. **Shared-Password Mode = Shared Identity**: With `password`, every node derives the same Ed25519 key pair, so any member can impersonate any other member

4. **No KDF for Session Keys**: The raw X25519 shared secret (truncated) is used directly as the AEAD key, without HKDF and without binding to the handshake transcript

5. **Beacon Encryption Weakness**: Beacons are XOR-masked with a SHA-512 keystream derived from the beacon password and carry only a 1-byte check value, which protects against random corruption but not malicious tampering. Without `beacon_password`, the key is empty

6. **Public Key Privacy**: The Ed25519 public key is identified by a 4-byte salt plus a 4-byte truncated hash, so an observer who knows a candidate key can confirm it

7. **Unauthenticated Claims**: Any trusted peer can claim any subnet, and in switch/TAP mode any peer's source MAC is learned. Claims are not bound to identities

8. **Replay Window**: Duplicate data packets inside the ~1–2 s nonce-pinning window are accepted (no bitmap)

9. **Open WebSocket Proxy**: `vpncloud ws-proxy` accepts any WebSocket client without authentication and sends UDP to any destination the client names (an open UDP relay); the WebSocket link is plain `ws://` without TLS

10. **Hook/Beacon Scripts**: Hook scripts and beacon commands run via `sh -c`. Peer-controlled values (peer address, claims, node ID) are passed as environment variables, not interpolated, so the risk lies in operator scripts that use them unquoted

11. **No Rate Limiting**: No protection against handshake floods; every PING with a trusted key hash triggers signature verification, X25519, and per-address state

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
- [ ] **Certificate pinning** - N/A: no control-plane server; peers are authenticated against a locally configured trusted-key list

### Implementation
- [x] **Memory-safe language** - Written in Rust (with `unsafe` blocks for ioctl/epoll FFI; `ring` contains C/assembly)
- [x] **Privilege separation** - Optional `user`/`group` settings drop root after the device is opened (via `privdrop`, or `daemonize` when running with `--daemon`)
- [x] **Sandboxing** - Partial: no in-process seccomp/chroot, but the shipped systemd units use `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `CapabilityBoundingSet` and `DeviceAllow=/dev/net/tun`
- [x] **Audit logging** - Security events logged (untrusted peers, signature failures, etc.)

# NAT Traversal

VpnCloud implements NAT traversal through UDP hole-punching, peer-reflected address learning, and automatic UPnP port forwarding, but has no STUN/TURN.

## How It Works

**UDP Hole-Punching**: Peers exchange complete address lists in NODE_INFO messages. Each peer attempts connections to all known addresses of other peers from both sides. When a peer behind NAT sends a packet, it opens a temporary hole in the NAT allowing return traffic.

**Address Learning**: Peers learn their own public addresses from peer lists: when a NODE_INFO lists an entry carrying this node's own node ID, the addresses in it (as seen by the other peer) are added to the node's own address list. These addresses are then advertised to other peers to facilitate hole-punching. Own addresses are recomputed every 300 seconds.

**UPnP Port Forwarding**: Enabled by default (`port_forwarding: true`). VpnCloud uses the IGD protocol (IPv4) to request a UDP mapping, trying the listen port, any port, nearby ports, and random ports. Mappings use an 1800-second lease that is renewed 60 seconds before expiry (permanent only if the router supports nothing else) and are removed on shutdown.

**WebSocket Proxy**: For restrictive networks where UDP is blocked, a node can be configured to connect to a WebSocket proxy server, which sends and receives UDP on the node's behalf from the proxy's public address. The proxy only forwards already-encrypted datagrams. It is not an automatic fallback and does not relay between two peers that cannot reach each other.

## Double NAT Handling

VpnCloud does **not explicitly handle double NAT** (NAT behind NAT scenarios). It relies on:
- Cross-connection attempts through extensive peer address sharing
- Manually configured WebSocket proxy for nodes whose UDP is blocked (not an automatic fallback)
- No intelligent symmetric NAT detection or specialized hole-punching techniques

## NAT Traversal Checklist

### Discovery
- [ ] **No own public node needed** - `peers` is empty and beacons are off by default; beacons only publish addresses the node already knows, so two fully NATed nodes never learn each other's external endpoint (`src/config.rs:65-76`, `src/cloud.rs:223-236,484-495`)
- [x] **STUN support** - Partial: no STUN protocol; the public endpoint is learned by reflection from peers (NODE_INFO) and from the UPnP gateway's external IP
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
- [x] **Relay fallback** - Partial: no peer relay; a node can be manually configured to route all its traffic through a WebSocket proxy, which forwards encrypted datagrams over UDP
- [ ] **Multiple relay regions** - No geographic redundancy for relays (user-deployed)
- [ ] **Automatic relay selection** - Manual configuration only
- [x] **TCP relay support** - Partial: the WebSocket proxy link runs over TCP (plain `ws://` only)

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
- Full tunnel mode (a peer claims 0.0.0.0/0; the OS default route, an exclusion for the underlay peer addresses, and NAT on the exit peer must be configured manually, e.g. in ifup scripts)
- Site-to-site VPN (peers claim their local network ranges)

**VLAN Support**: TAP mode supports IEEE 802.1q VLAN tags, allowing segmentation of Layer 2 traffic.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No LAN announcements or mDNS
- [x] **Direct path advertisement** - Peers share all known addresses in NODE_INFO messages
- [ ] **Same-subnet detection** - No detection of local vs remote peers

### LAN Optimization
- [ ] **Automatic LAN preference** - All peer connections treated equally
- [x] **Trusted path mode** - Partial: no LAN-specific option, but the global `plain` algorithm setting disables encryption for peers that both allow it
- [ ] **LAN-only mode** - No restriction to local network only

### Routing Features
- [x] **Subnet routes** - Full support via claims system (announce reachable subnets)
- [x] **Full tunnel mode** - Partial: possible via a 0.0.0.0/0 claim, but VpnCloud does not manage OS routes or NAT
- [ ] **Split tunneling** - No granular per-application routing control
- [x] **Route priorities** - Partial: longest-prefix match; for equal prefixes the first stored claim wins. If the claiming peer times out or closes, its claims are dropped and another peer's identical claim takes over (passive failover after up to `peer_timeout`)

# Central Point of Failure

VpnCloud is a **fully peer-to-peer mesh VPN with no mandatory central controller**. There is no single point of failure in the core architecture.

## Decentralized Operation

**No central server required**: All peers communicate directly with each other. Any peer can be used as an initial bootstrap peer to join the network.

**Automatic peer discovery**: Once connected to any peer, nodes learn about other peers through periodic peer exchange messages (default every 90 seconds). The network self-organizes without central coordination.

**Reconnection handling**: Configured peers are retried every second at first; every 10 failed tries the interval doubles, up to a maximum of 3600 seconds, and retries never stop. Peers that time out are re-handshaked immediately. Each handshake attempt retransmits once per second for up to 120 seconds. Peers maintain routing tables and automatically update them as peers join/leave.

## Optional Centralized Components

These are optional and not required for operation:

1. **Beacon storage**: Optional shared beacon files (filesystem, database, message broker) for peer discovery without fixed IP addresses. If beacon storage is unavailable, peers can still use static peer addresses or peer exchange.

2. **WebSocket proxy**: Optional proxy for nodes whose UDP is blocked. Each such node is configured with exactly one proxy URL; there is no automatic failover between proxies.

## What Happens If Components Fail

**If initial bootstrap peer is down**: Cannot join network initially, but once any peer address is reachable, the node joins and discovers others.

**If beacon storage fails**: Peers with static addresses or already-connected peers continue working normally. Only affects new peer discovery via beacons.

**If WebSocket proxy fails**: Only affects nodes configured to use the proxy. On such a node, a WebSocket read error is fatal and the VpnCloud process exits (it relies on systemd restart). Peers using direct UDP connections are unaffected.

**Network partition**: If the network splits, each partition continues operating independently. When connectivity is restored, peers automatically reconnect and merge.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Peer-to-peer tunnels continue working without any controller
- [ ] **Local state caching** - Peer and claim tables live only in memory; nothing is persisted across restarts (the beacon store only publishes the node's own addresses)
- [ ] **Cached credentials** - N/A: keys are static local configuration; nothing is fetched from a server
- [x] **Graceful degradation** - Peers continue forwarding packets even if peer exchange fails

### Redundancy
- [ ] **Self-hosted controller** - N/A: no controller exists; fully peer-to-peer architecture
- [ ] **Controller redundancy** - Not applicable (no controller)
- [ ] **Relay redundancy** - Several WebSocket proxies can exist, but each node uses one proxy URL with no failover
- [x] **No single root of trust** - Distributed trust via peer key exchange, no central CA

### Efficiency
- [ ] **Delta/incremental updates** - NODE_INFO messages are full snapshots of current peer/claim state
- [ ] **Long polling / push updates** - Timer-based periodic exchange (default 90-second interval)
- [x] **Configurable sync interval** - Peer timeout and keepalive intervals are configurable

# Authentication

VpnCloud uses public key cryptography for node authentication with support for password-based key derivation for easier setup.

## Authentication Methods

**Ed25519 Public Key Authentication**: Each node has an Ed25519 keypair that serves as its identity. During the initial handshake:
1. Node sends a 4-byte random salt plus the first 4 bytes of the salted SHA-256 hash of its public key (for privacy)
2. Sends full ECDH ephemeral public key and supported algorithms
3. Signs entire init message with Ed25519 private key
4. Peer validates signature against trusted public keys

**Trusted Keys List**: Each node maintains a list of trusted Ed25519 public keys. Only peers with trusted keys can join the network. If no trusted keys are configured, only the node's own public key is trusted (creating isolated peer-to-peer pairs).

**Password-Derived Keys**: For simpler setup, VpnCloud can derive Ed25519 keypairs from passwords using PBKDF2-HMAC-SHA256 (4096 iterations, static salt). All nodes using the same password derive the same keypair and can authenticate each other, which also means every member shares one identity. Note: This is less secure than using randomly-generated keys.

## Joining Process

1. **Initial connection**: Node connects to bootstrap peer address (manually configured)
2. **Handshake**: 3-way handshake (PING-PONG-PENG) establishes encrypted session
3. **Key validation**: Bootstrap peer validates signature against trusted keys, rejects if untrusted
4. **Peer exchange**: Upon successful auth, peers exchange NODE_INFO with other known peers
5. **Mesh expansion**: Node connects to discovered peers, repeating handshake process

## Security Considerations

- **Privacy**: Node identities transmitted as salted hashes (not full public keys) during initial handshake
- **No enrollment workflow**: No manual approval process; authentication is purely cryptographic
- **Replay prevention**: Handshake messages carry no timestamp or cookie; a replayed PING is answered with a PONG, but the session cannot be completed without the ephemeral private key. Data packets use nonce pinning (see Encryption)
- **Concurrent connection handling**: When two peers simultaneously initiate, the side with the higher salted node ID hash wins to prevent duplicate connections

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Ed25519 public keys for headless/automated enrollment
- [ ] **OAuth/OIDC** - No SSO integration
- [ ] **Interactive login** - No browser-based authentication
- [ ] **CLI authentication** - No enrollment step; the CLI has only `genkey`, `ws-proxy`, `migrate-config`, `config` and `install`. Keys are set via CLI/config (`src/config.rs:538-585`)

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

VpnCloud only targets Linux.

## Supported Platforms

**Linux**: Full support with all features. Uses standard Linux TUN/TAP interfaces via /dev/net/tun. VpnCloud is packaged for Debian/Ubuntu (DEB) and RedHat/CentOS (RPM) distributions.

**macOS**: Not supported. The event loop (`poll` module) is only compiled for `target_os = "linux"`/`"android"`, and device setup uses Linux `TUNSETIFF`/`/dev/net/tun` and `/proc`. The README asks for help porting to macOS. Leftover BSD/macOS `cfg` branches for the 4-byte TUN header do not make it build.

**Windows**: Not supported. The code uses `std::os::unix`, epoll and Linux ioctls; there is no Wintun/TAP-Windows code. The README asks for help porting to Windows.

**FreeBSD/OpenBSD**: Not supported (no kqueue backend; Linux-only device and `/proc` code).

**Mobile (iOS/Android)**: No apps. The epoll code is also enabled for `target_os = "android"`, but there is no VpnService integration.

## Implementation Details

**Userspace implementation**: VpnCloud runs entirely in userspace. It does not use any kernel modules or require kernel modifications.

**TUN/TAP interface**: Uses standard operating system TUN (Layer 3) and TAP (Layer 2) virtual network interfaces. On Linux, this is the standard /dev/net/tun device.

**Single binary**: One binary (also contains the `ws-proxy` server and config wizard), dynamically linked against glibc in the Debian package. Entire VPN runs as a single process.

**Privilege requirements**: Requires root/administrator privileges to create TUN/TAP interfaces. After interface creation, can drop privileges to specified user/group for security.

**Container support**: No official container image or Kubernetes integration (the only Dockerfile is an asciinema demo recorder in `contrib/`). It can run in a container with NET_ADMIN and `/dev/net/tun`, and ships hardened systemd units (`vpncloud@.service`, `vpncloud-wsproxy.service`).

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support with all features
- [ ] **macOS** - Not supported (Linux-only epoll and TUN code; porting help wanted)
- [ ] **Windows** - Not supported (Unix/Linux-only code; porting help wanted)
- [ ] **FreeBSD/OpenBSD** - Not supported

### Mobile
- [ ] **iOS** - No mobile app
- [ ] **Android** - No mobile app

### Implementation
- [ ] **Kernel-mode datapath** - No kernel module (not WireGuard-based)
- [x] **Userspace implementation** - Runs entirely in userspace via TUN/TAP devices
- [ ] **Container support** - No official image or k8s integration; runs in containers with NET_ADMIN and /dev/net/tun
