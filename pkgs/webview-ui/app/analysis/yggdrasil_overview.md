# Overview

Yggdrasil is an experimental, fully end-to-end encrypted IPv6 overlay network. It is lightweight, self-arranging, and designed to provide secure communication between nodes without requiring central infrastructure.

Key Architecture Components:

- **Ironwood Routing Library**: Provides the core encrypted mesh routing layer using a spanning tree topology with bloom filter-based lookups. Key features:
  - **Spanning Tree**: Nodes maintain a soft-state CRDT-based spanning tree with parent/child relationships. Parent selection is latency-weighted (per-link RTT measured from the signed tree-protocol request/response exchange)
  - **Bloom Filter Lookups**: Per-peer bloom filters (8192-bit, 1024 bytes, 8 hash functions) track which keys are reachable through each on-tree link's subtree, replacing the DHT used in v0.4
  - **Greedy Routing**: Packets are forwarded to the peer that minimises "link cost per unit of tree distance" toward the destination's tree coordinates (cost = smoothed link latency), i.e. maximising "velocity in treespace"
  - **Encryption Layers**: The library offers unsigned (legal for amateur radio), signed (ed25519), or encrypted (nacl/box with a key ratchet for forward secrecy) packet connections; Yggdrasil always uses the encrypted variant

- **Greedy Tree Routing**: Packets are routed greedily through the spanning tree toward their destination based on tree coordinates. Unknown destinations are discovered via bloom filter-based multicast lookups over the tree structure. While a lookup or session setup is pending, only the most recent packet per destination is buffered; earlier packets are dropped.

- **Cryptographic Identity**: Each node has an Ed25519 key pair. IPv6 addresses are derived from the public key inside 200::/7: a node address in 200::/8 (first byte 0x02) and a routed /64 subnet in 300::/8 (first byte 0x03). Keys with more leading zero bits (leading ones after inversion) encode more key bits into the address and make a node more likely to become tree root (the root is the node with the numerically lowest key).

- **TUN Interface**: Uses the wireguard-go TUN library for cross-platform support. On Linux it opens the TUN with IFF_VNET_HDR and TSO/USO offloads, giving vectorised reads/writes of up to 128 packets per call between the kernel TUN device and userspace.

# Protocol

Yggdrasil uses protocol version 0.5 and supports multiple stream-oriented transport protocols for flexibility across different network environments.

**Control Plane**: When a link comes up, nodes exchange a metadata block containing protocol version, Ed25519 public key, and link priority. The block carries an Ed25519 signature over BLAKE2b-512(key = optional link password, message = own public key). This signature is static (no nonce or transcript binding), so it proves knowledge of the password but is replayable and not tied to the TLS session; the source code itself calls the resulting pinned-key check "a bit of a weak check". Once connected, nodes exchange routing information through Ironwood's spanning tree protocol (signed announcements, nonce-based signature request/response per link) and bloom filter gossip. Updates are pushed to peers when they change; tree state is refreshed every 4 minutes and expires after 5 minutes.

**Data Plane**: Traffic is sent as encrypted IPv6 packets using greedy routing through the spanning tree topology. Unknown destinations are discovered via bloom filter-based lookups that multicast over the tree structure. All payload data is encrypted end-to-end between the source and destination nodes by Ironwood's encrypted PacketConn (per-destination sessions with ephemeral X25519 keys, XSalsa20-Poly1305 and a key ratchet). Intermediate nodes forward packets without being able to decrypt them, but every routed packet carries the source and destination Ed25519 public keys in its Ironwood header.

> **Note**: Yggdrasil v5 (0.5.x) uses a significantly different routing architecture than v4. The DHT and source routing from v4 were replaced with bloom filters and greedy routing for improved convergence speed and bandwidth efficiency.

**Transport Support**: Peer links are always reliable streams; there is no raw UDP data transport. Supported link schemes are `tcp://`, `tls://`, `quic://`, `ws://`, `wss://` (dial only; use a WS listener behind a reverse proxy), `unix://` and `socks://` / `sockstls://` (dial only, via a SOCKS5 proxy). QUIC (quic-go) is used as a single bidirectional stream per connection, so it behaves like TCP regarding head-of-line blocking. `tcp://`, `ws://`, `unix://` and `socks://` links are not encrypted at the link layer. TLS-based links (tls, quic, wss, sockstls) use a self-signed certificate and intentionally skip certificate verification (InsecureSkipVerify); listeners require TLS 1.3 and dialers accept TLS 1.2–1.3. Multicast-discovered peers always use `tls://`.

**Packet Types**: Two in-band session packet types are defined: typeSessionTraffic (1) for normal data traffic and typeSessionProto (2) for protocol messages including nodeinfo and remote debug requests (getSelf, getPeers, getTree).

## Protocol Features Checklist

### Transport
- [ ] **UDP transport** - Not used for peer data; links are TCP/TLS/QUIC/WS/WSS/UNIX/SOCKS streams (UDP only for LAN multicast beacons and as QUIC's underlay)
- [x] **TCP fallback** - TCP/TLS/WS(S) links work through restrictive firewalls and HTTP(S) proxies
- [x] **QUIC support** - `quic://` scheme (quic-go library), one stream per connection, 20 s keepalive, 1 min idle timeout
- [x] **WebSocket support** - `ws://` listen and dial, `wss://` dial only (subprotocol `ygg-ws`)

### IP Support
- [ ] **IPv4 support** - IPv4 tunnel traffic not supported (non-IPv6 packets are rejected)
- [x] **IPv6 support** - Native IPv6 tunneling (only IPv6, within 200::/7)
- [ ] **Dual-stack** - No IPv4 support at all

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IPv6 packet routing only (TUN interface)
- [ ] **Layer 2 (Ethernet) mode** - No TAP support, TUN only
- [ ] **Bridging support** - No L2 bridging (non-Yggdrasil hosts can only be routed at L3 via the node's 300::/64 subnet)

### Advanced
- [x] **Multipath/bonding** - Partial: several simultaneous links to the same node (e.g. per interface or per transport) are kept up; per packet the lowest `priority` link, then the lowest-latency link, is used, with automatic failover. No aggregation/bonding
- [ ] **QoS/traffic shaping** - No configurable QoS; per-peer send queues do built-in fair queuing per source/destination and drop the oldest packet of the largest flow once queueing delay exceeds 25 ms
- [ ] **Multicast support** - No virtual multicast/broadcast for tunnel traffic (only unicast 200::/7 destinations)

# Encryption

Yggdrasil has two independent encryption layers: mandatory end-to-end session encryption between source and destination nodes, and optional per-link TLS depending on the peering scheme.

**Key Exchange**: Each node has a static Ed25519 key pair for identity. End-to-end sessions are per remote node, not per link: Ironwood's encrypted PacketConn sends a session init/ack containing two fresh X25519 public keys ("current" and "next") plus a key sequence number and a timestamp. The init is signed with the sender's Ed25519 key and sealed with nacl/box using a one-time ephemeral sender key and the recipient's static key (Ed25519 converted to Curve25519). The link-level metadata handshake (public key, protocol version, priority) is separate and signed with Ed25519; the optional link password is applied as a BLAKE2b-512 key.

**Key Ratchet**: Each data packet carries, inside the encryption, the sender's next ephemeral public key. When a side receives traffic encrypted with the peer's next key, both sides rotate to new X25519 key pairs (at most once per minute per side), so session keys are replaced roughly every minute while traffic flows in both directions. A forced rotation also happens on 64-bit nonce overflow. Sessions expire after 1 minute without traffic.

**Transport Security**: Only `tls://`, `quic://`, `wss://` and `sockstls://` links use TLS (listeners require TLS 1.3). Certificate verification is disabled (InsecureSkipVerify: true); the peer's identity is taken from the Ed25519 metadata exchanged inside the link, which is not bound to the TLS session. `tcp://`, `ws://`, `unix://` and `socks://` links carry the metadata and Ironwood routing headers in cleartext.

**Symmetric Encryption**: End-to-end payload encryption is nacl/box: X25519 shared keys (precomputed) with XSalsa20-Poly1305 and a 64-bit counter nonce. This does not depend on the link type; on TLS-based links packets are additionally encrypted by TLS (typically AES-GCM or ChaCha20-Poly1305), i.e. encrypted twice.

**Address Derivation**: IPv6 addresses are deterministically derived from Ed25519 public keys. The format is: prefix (0x02) + count of leading one bits of the inverted key (8 bits) + the remaining inverted key bits after the first zero bit, truncated to fit. The /64 subnet uses the same bits with prefix 0x03. This ensures addresses are cryptographically bound to node identity (with limited collision resistance, because only part of the key fits).

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - X25519 ECDH (nacl/box, via Ironwood) + Ed25519 signatures
- [x] **Perfect Forward Secrecy** - Ephemeral X25519 session keys, ratcheted roughly once per minute
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [x] **Key rotation** - Automatic ratchet to new ephemeral keys (at most once per minute, triggered by bidirectional traffic) plus rekey on nonce overflow

### Symmetric Encryption
- [x] **Authenticated encryption** - XSalsa20-Poly1305 (nacl/box) end-to-end on every packet
- [x] **Hardware-accelerated crypto** - Partial: golang.org/x/crypto has amd64 assembly for Salsa20 and Poly1305; other architectures use generic Go. No AES-NI path
- [x] **Constant-time operations** - Go standard/x/crypto implementations of Ed25519, X25519, XSalsa20-Poly1305

### Protocol Security
- [x] **Replay protection** - Per-session counter nonce must be strictly greater than the last accepted one (no sliding window, so reordered packets are dropped); session inits carry a timestamp sequence that must increase
- [ ] **Noise Protocol or equivalent** - Custom nacl/box session protocol (not Noise); TLS only at link level
- [ ] **No cleartext metadata** - Ed25519 public keys appear in the link handshake, in every Ironwood routing header (source and destination keys) on unencrypted links, and in LAN multicast beacons

# Performance

Yggdrasil is written in Go and uses goroutines plus the phony actor library for concurrent packet handling.

**Threading Model**: The TUN adapter runs three goroutines (batched TUN reader, core reader/queue, batched TUN writer). Each peer link has one reader goroutine and its own writer actor. Inside Ironwood, a single router actor makes every forwarding decision, a single session-manager actor dispatches packets, a single network-reader actor drains incoming traffic, and each end-to-end session is its own actor that performs both encryption and decryption (the code has a "TODO? some worker pool to multi-thread this").

**Multi-core Utilization**: Different actors run in parallel, so traffic to/from different remote nodes and different links can use several cores. A single flow (one session) is encrypted and decrypted serially on one core at a time, and all forwarding decisions pass through the one router actor. The IPv6 key store (ipv6rwc) is protected by a global sync.Mutex taken for every packet.

**Memory Management**: sync.Pool is used for packet buffers in the TUN layer (65,615-byte buffers = 80-byte offset + 65,535), in the core and in Ironwood (byte slices and traffic structs). Packets are still copied several times between layers (TUN buffer → core → session plaintext buffer → ciphertext → wire encoding → bufio writer).

**Packet Processing Path**: Send: Kernel TUN → batched read (up to 128 packets on Linux) → per-packet key-store lookup and Core.WriteTo → session actor (encrypt) → router actor (next hop) → per-peer queue → peer writer (bufio). Receive: link reader goroutine → router actor → session actor (decrypt) → core reader → channel (capacity = TUN batch size) → batched TUN write (wireguard-go coalesces TCP/UDP packets via GRO on Linux).

**Network I/O**: Peer links are TCP/TLS/QUIC/WS streams. Ironwood writes each packet as a length-prefixed frame into a 4 KiB bufio.Writer that is flushed only when the per-peer queue is empty, so small packets are coalesced into fewer write syscalls; larger frames go straight to the socket. Reads use a 4 KiB bufio.Reader. No recvmmsg/sendmmsg is used on the data path (wireguard-go's TUN batching is based on virtio-net headers, not mmsg syscalls); only the optional QUIC transport, via quic-go, uses batched UDP reads (8 packets), UDP GSO and 7 MB socket buffers. TCP keepalives are disabled; Ironwood sends its own keepalives only in reply to traffic and expects a reply within 3 seconds.

**Default MTU**: The TUN MTU defaults to the platform maximum: 65535 on Linux, macOS and Windows, 32767 on FreeBSD and 16384 on OpenBSD (minimum 1280). Because links are reliable streams, there is no underlay fragmentation concern.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Partial: actors for different sessions/peers run in parallel, but one session's crypto and all routing decisions are serialized
- [ ] **Per-core packet queues** - Per-actor inboxes and per-peer fair queues, not per-core queues

### Packet I/O
- [ ] **Batch UDP receives** - Not on TCP/TLS/WS links; only the optional QUIC transport (quic-go recvmmsg, batch of 8)
- [ ] **Batch UDP sends** - No sendmmsg; peer writes are coalesced via bufio instead
- [x] **Large batch sizes** - Partial: TUN reads/writes up to 128 packets per call on Linux (wireguard-go vnet-hdr mode); network layer not batched

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Only inside quic-go when the QUIC transport is used
- [ ] **UDP GRO (Generic Receive Offload)** - Not used

### Buffer Management
- [x] **Buffer pool reuse** - Extensive sync.Pool usage (TUN: 65,615 bytes, core and Ironwood: variable)
- [ ] **Large UDP socket buffers** - Not applicable to TCP links (kernel defaults); quic-go requests 7 MB for QUIC links only

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - Uses kernel TCP
- [ ] **Large TCP RX/TX buffers** - Not applicable (kernel TCP with default socket buffers)
- [ ] **Tuned congestion control** - Not applicable (kernel default, typically CUBIC)
- [ ] **Reordering tolerance** - Not applicable; note that the session replay check drops any out-of-order packet

### Receive Path
- [x] **TCP/packet coalescing on ingress** - Partial: on Linux wireguard-go coalesces TCP/UDP packets (GRO) when writing batches to the TUN
- [ ] **RX checksum offload** - Depends on kernel/NIC configuration

### MTU Handling
- [ ] **Conservative MTU** - Default TUN MTU is 65535 on Linux/macOS/Windows (32767 FreeBSD, 16384 OpenBSD)
- [x] **Path MTU discovery** - Partial: no probing; a receiving node answers packets larger than its own TUN MTU with an ICMPv6 Packet Too Big so the sender's kernel can lower the path MTU

### Peer Management
- [x] **Lazy peer removal** - Sessions and paths are created on demand and expire when idle (sessions 1 min, key-store entries 2 min); persistent peers reconnect with exponential backoff (max ~1h8m)
- [x] **Endpoint caching** - Partial: destination tree coordinates are cached for 1 minute; there is no underlay endpoint per remote node (only direct peers have endpoints, from config or multicast)
- [x] **Efficient keepalive timers** - Ironwood keepalives are only sent in response to traffic (1 s delay, 3 s timeout); QUIC uses a 20-second KeepAlivePeriod

### Packet Processing
- [ ] **Zero-allocation parsing** - Buffers pooled, but parsing allocates on heap
- [ ] **Zero-copy filtering** - Packets copied through multiple layers

### State Synchronization
- [x] **Delta updates** - Tree announcements are only sent to a peer if not already sent; bloom filters are only re-sent when they change (plus periodic resend)
- [x] **Compression** - Partial: bloom filters are encoded with flags that omit all-zero/all-one 64-bit words; no general compression

# Security

Yggdrasil's changelog documents one security-relevant dependency fix:

**Denial-of-Service in QUIC Library** (v0.5.6 - May 2024): A DoS vulnerability in the underlying QUIC library was fixed with a dependency update. This was not a vulnerability in Yggdrasil's code itself but in the third-party quic-go library. The changelog does not name a CVE ID.

**Other Security Issues** (from code analysis, not CVEs):

1. **Admin Socket No Authentication**: The admin socket has no authentication (TODO comment in code). Anyone with access to the admin socket (default UNIX socket /var/run/yggdrasil.sock on Linux/macOS/BSD, TCP localhost:9001 on Windows) can add/remove peers. UNIX socket permissions are set to 0660 but there's no password protection.

2. **Debug Endpoint Exposure**: The PPROFLISTEN environment variable enables a pprof HTTP server with no authentication, potentially exposing sensitive runtime information.

3. **Peer Filter Scope**: AllowedPublicKeys is only checked for incoming connections on configured listeners. It does not apply to outbound peerings or to multicast (link-local) listeners; the multicast exemption is intentional according to the changelog, so any node on the same LAN can peer by default.

4. **Password Storage**: Passwords are stored in plaintext in configuration and link options, and are not zeroed after use.

5. **Multicast Beacon Security**: Multicast beacons reveal node presence and public key on local networks and include BLAKE2b(password, public key) hashes that could be brute-forced offline.

6. **Weak Link Authentication**: The link handshake signature does not include a nonce or the TLS session, so it can be replayed, and TLS certificates are not verified. Per-peer key pinning (`?key=`) therefore only checks the claimed key. End-to-end payload encryption is unaffected.

7. **Remote Information Disclosure**: Any node can query another node's nodeinfo (build name, version, OS and architecture unless NodeInfoPrivacy is set) and, via remote debug requests, its peer list and tree information.

8. **Unencrypted Link Metadata**: On `tcp://` and `ws://` links, routing headers (source/destination public keys, tree coordinates) and protocol traffic are visible to on-path observers.

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No DoS rate limiting; only the node's own path lookups are throttled (1 per second per destination)
- [ ] **Stateful packet filter** - No built-in firewall
- [ ] **Fine-grained ACLs** - Only AllowedPublicKeys whitelist for inbound peerings (binary allow/deny)
- [ ] **Capability-based access** - No capability system beyond simple whitelist

### Identity & Authentication
- [x] **Identity validation** - Address derived from the Ed25519 key; session inits and tree announcements are Ed25519-signed
- [ ] **Signed configuration updates** - No configuration signing mechanism
- [x] **Certificate pinning** - Partial: optional per-peer Ed25519 key pinning via `?key=` (checked against the replayable link metadata, not bound to TLS); no control-plane server exists

### Implementation
- [x] **Memory-safe language** - Written in Go (memory-safe)
- [x] **Privilege separation** - Partial: optional `-user` privilege drop after TUN/socket setup; no separate privileged helper
- [x] **Sandboxing** - Partial: OpenBSD pledge(); AppArmor profile shipped in contrib/. No seccomp
- [ ] **Audit logging** - No security event logging (only connect/disconnect info logs)

# NAT Traversal

Yggdrasil does NOT implement traditional NAT traversal techniques like STUN/TURN/ICE. Instead, it relies on at least one peer having a publicly accessible endpoint.

**Strategy**: Uses persistent outbound connections that maintain NAT state. If a node behind NAT connects to a public peer, the connection remains open and bidirectional. However, two nodes behind restrictive NAT cannot connect to each other without an intermediary peer.

**Proxy Support**: Can dial peers through SOCKS5 proxies (`socks://`, `sockstls://`), and WebSocket peerings honour HTTP(S) proxy environment variables, which helps traverse some network restrictions but doesn't solve the double-NAT problem.

**Local Discovery**: Multicast discovery is enabled by default on all interfaces (Linux/Windows/BSD; `en*`/`bridge*` on macOS) using the link-local IPv6 multicast group [ff02::114]:9001, so it only works on the same LAN segment.

## NAT Traversal Checklist

### Discovery
- [x] **No own public node needed** - Partial: community public peers (github.com/yggdrasil-network/public-peers) connect NATed nodes, but the generated config has an empty `Peers` list (`src/config/config.go:79`)
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
- [ ] **Relay fallback** - No dedicated relay fallback; all non-adjacent traffic is always forwarded hop-by-hop by mesh peers
- [ ] **Multiple relay regions** - Not applicable
- [ ] **Automatic relay selection** - Not applicable (next hops are chosen by latency-weighted greedy routing)
- [x] **TCP relay support** - Any node forwards traffic for others over its TCP-based links; publicly reachable peers act as relays implicitly

# Local Routing

Yggdrasil uses multicast discovery on local networks and then peers directly with discovered nodes; all traffic is still routed through the mesh topology and encrypted end-to-end.

**LAN Discovery**: Nodes on the same LAN discover each other via IPv6 multicast beacons on [ff02::114]:9001. Beacons contain protocol version, Ed25519 public key, listening port, and a BLAKE2b hash of the public key keyed with the (possibly empty) interface password. When a beacon is received and the hash matches, the node initiates a TLS connection to the discovered peer's link-local address.

**Routing Behavior**: Directly peered nodes are at tree distance zero from each other, so greedy routing uses the direct LAN link for traffic between them. Next-hop and parent selection are weighted by measured link latency, so low-latency (typically LAN) links are naturally preferred, but there is no explicit LAN policy. Nodes on the same LAN that are not peered with each other still route through the tree.

**No LAN Optimization**: There is no explicit preference setting for local paths, and no trusted path mode to skip encryption on local networks. All traffic is always encrypted end-to-end.

## Local Routing Checklist

### LAN Discovery
- [x] **Broadcast/multicast discovery** - IPv6 multicast beacons on configured interfaces (default: all)
- [x] **Direct path advertisement** - Partial: beacons advertise the link-local listener port on the LAN only; endpoints are not exchanged over the overlay
- [ ] **Same-subnet detection** - No explicit detection; link-local beacons implicitly only find same-link peers

### LAN Optimization
- [x] **Automatic LAN preference** - Partial: latency-weighted next-hop selection prefers fast direct links; no explicit LAN rule
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [ ] **LAN-only mode** - No dedicated mode (can be approximated with no static peers and multicast only)

### Routing Features
- [x] **Subnet routes** - Partial: each node owns a key-derived routed /64 in 300::/8 that it can advertise to non-Yggdrasil LAN hosts; arbitrary prefixes or IPv4 subnets cannot be routed
- [ ] **Full tunnel mode** - No default route / exit node support (only 200::/7 is routed)
- [ ] **Split tunneling** - Not applicable: only the 200::/7 overlay prefix is ever routed into the TUN
- [ ] **Route priorities** - Link `priority` only selects between multiple links to the same peer, not between routes

# Central Point of Failure

Yggdrasil is fully decentralized with no central points of failure.

**No Bootstrap Servers**: Peers can be manually configured or discovered via multicast. There are no required bootstrap or rendezvous servers.

**No Central Controller**: The network has no control plane server. All routing information is distributed via the spanning tree and bloom filter gossip protocols. The spanning tree root is selected automatically as the node with the lowest public key. Any node can become root.

**Self-Healing**: Persistent connection attempts with exponential backoff (default max ~1h8m, configurable per peer with `?maxbackoff=`) ensure nodes automatically reconnect when peers become available. Greedy routing reroutes over remaining links, path-broken notifications trigger new lookups, and if the root disappears, a new root is automatically elected.

**Graceful Degradation**: When peers are unreachable, the node continues to function with remaining peers. Routing state is soft-state with periodic refresh (4 minutes) and a 5-minute timeout, ensuring stale information is eventually purged. No routing state is persisted to disk; after a restart the node rebuilds everything from its configured peers and multicast.

**Potential Weaknesses**: Small networks may be susceptible to Sybil attacks. Initial peer discovery requires at least one known peer or multicast capability. If all peers are down, the node is isolated.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - No controller exists; sessions continue as long as some path through peers remains
- [ ] **Local state caching** - Routing state is in-memory soft state only; nothing besides the config is persisted
- [ ] **Cached credentials** - Not applicable (only the static key in the config)
- [x] **Graceful degradation** - Node functions with available peers, no hard requirements

### Redundancy
- [ ] **Self-hosted controller** - Not applicable; no controller at all, fully peer-to-peer
- [ ] **Controller redundancy** - Not applicable (no controller)
- [x] **Relay redundancy** - Any peer can forward; mesh topology provides redundancy
- [x] **No single root of trust** - No CA; identities are self-generated keys and the tree root is elected automatically

### Efficiency
- [x] **Delta/incremental updates** - Announcements only sent when new to a peer; blooms only when changed
- [x] **Long polling / push updates** - Tree and bloom updates are pushed to peers when they change (plus a 4-minute refresh)
- [ ] **Configurable sync interval** - Refresh/timeout values are fixed in Yggdrasil (not exposed in the config)

# Authentication

Yggdrasil uses cryptographic identity-based authentication with optional access control.

**Enrollment**: There is no enrollment process or centralized authentication. Nodes generate an Ed25519 key pair locally (using crypto/rand for secure random generation). The public key becomes the node's permanent identity, and the IPv6 address is deterministically derived from this key.

**Peer Authentication**: During connection handshake, both sides exchange metadata containing their Ed25519 public key, protocol version, and priority, signed over BLAKE2b-512(password, public key). The signature is static and carries no challenge, so it proves password knowledge but not live key possession; possession of the private key is proven later by Ironwood's nonce-based tree signature exchange and by the signed end-to-end session handshake. Optional password-based authentication (password up to 64 bytes used as the BLAKE2b key) means both sides must know the password for the link to succeed.

**Access Control**: The AllowedPublicKeys configuration option provides a whitelist of permitted peer public keys. If the list is empty, all connections are allowed. If populated, only incoming connections on configured listeners from listed keys are accepted; outbound peerings and multicast (link-local) listeners are not filtered.

**No Revocation**: There is no certificate revocation or key expiry mechanism. Once a key pair is generated, it remains valid forever unless manually replaced.

## Authentication Checklist

### Enrollment Methods
- [ ] **Pre-authentication keys** - Not applicable: there is no enrollment; nodes generate their own key pair and join by peering
- [ ] **Certificate-based enrollment** - No certificates or CA
- [ ] **OAuth/OIDC** - No SSO integration
- [ ] **Interactive login** - No login process; purely cryptographic
- [ ] **CLI authentication** - Not applicable (keys/config are generated locally with `yggdrasil -genconf` or `genkeys`, no authentication step)

### Authorization
- [ ] **Admin approval workflow** - No centralized approval mechanism
- [ ] **Automated enrollment rules** - No enrollment; only the static AllowedPublicKeys inbound whitelist
- [ ] **Ephemeral nodes** - No automatic cleanup
- [ ] **Node expiry** - No time-limited authorization

### Identity
- [x] **Stable device identity** - Ed25519 key persists across restarts (if config saved)
- [x] **Identity portability** - Can copy private key to another device
- [ ] **Multi-user support** - One identity per node

# Platform Support

Yggdrasil supports a wide range of platforms through Go's cross-compilation and the wireguard-go TUN library.

**Implementation**: Entirely userspace implementation using the wireguard-go TUN library (golang.zx2c4.com/wireguard) for cross-platform TUN device support (wintun on Windows). No kernel module required. Platform-specific code exists for TCP socket control (link_tcp_linux.go sets SO_BINDTODEVICE for InterfacePeers, link_tcp_darwin.go sets SO_RECV_ANYIF, link_tcp_other.go is a no-op) and for per-OS TUN setup and defaults (Linux, macOS, Windows, FreeBSD, OpenBSD).

**Privilege Requirements**: Requires CAP_NET_ADMIN on Linux or administrator/root privileges on other platforms to create TUN adapters. The `-user` flag drops to an unprivileged user after TUN creation; on OpenBSD pledge() restricts the process afterwards.

**Container Support**: An official Dockerfile is shipped in contrib/docker (runs as root; running unprivileged is a TODO). Mobile support for iOS and Android is provided as gomobile bindings in contrib/mobile/; the app front-ends themselves are not part of this repository.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support (TUN with vnet-hdr offloads and batching)
- [x] **macOS** - Full support (utun)
- [x] **Windows** - Full support (uses wintun library)
- [x] **FreeBSD/OpenBSD** - BSD support (OpenBSD has pledge support)

### Mobile
- [x] **iOS** - gomobile bindings in contrib/mobile/ (app UI not in this repo)
- [x] **Android** - gomobile bindings in contrib/mobile/ (app UI not in this repo)

### Implementation
- [ ] **Kernel-mode datapath** - No kernel module
- [x] **Userspace implementation** - Entirely userspace via wireguard-go TUN
- [x] **Container support** - Official Dockerfile in contrib/docker
