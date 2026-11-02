# Overview

EasyTier is a decentralized, open-source mesh VPN solution written in Rust using the Tokio async runtime. It provides a peer-to-peer virtual private network without requiring a central server. The architecture is built around several key components:

**Key Architecture Components:**

- **PeerManager**: Central component managing peer connections and coordinating between different subsystems
- **OSPF-Based Routing (PeerRoute)**: Handles routing between peers using a simplified OSPF (Open Shortest Path First) link-state routing protocol with Dijkstra's algorithm
- **Tunnel System**: Modular transport layer supporting multiple protocols (TCP, UDP, WebSocket/WSS, QUIC, WireGuard, FakeTCP)
- **ForeignNetworkManager**: Handles packet forwarding between different networks and manages multi-network routing
- **VirtualNIC**: TUN interface management for packet injection/extraction to/from the OS network stack
- **Connector System**: Manages NAT traversal, hole punching, and automatic peer connection establishment

The design is fully decentralized with no mandatory central server - nodes are equal and communicate peer-to-peer. Optional public shared nodes can be used as bootstrap/relay points for easier deployment. By default every node with a listener also acts as a shared node: it accepts connections from foreign networks and relays their traffic (`relay_network_whitelist = "*"`) unless `--private-mode` is set.

# Protocol

EasyTier uses a **custom protocol by default**, not WireGuard. The custom protocol includes:

**Control Plane:**
- Custom plaintext handshake (protobuf `HandshakeRequest`) with magic number validation (0xd1e1a5e1), peer ID, network name, and a 32-byte network secret digest. The digest is built with Rust's `DefaultHasher` (SipHash-1-3 with fixed keys), not SHA-256, and is compared for equality; there is no challenge-response and no key exchange
- OSPF-like route propagation where each peer shares routing tables with directly connected peers
- Route sync is incremental per neighbour session (checked every second and triggered immediately on change); each node refreshes its own peer info every 3600 seconds and dead peer info expires after 3660 seconds. RPC payloads (including route sync) are zstd-compressed when the peer accepts it
- RPC-based coordination for features like UDP/TCP hole punching and peer information exchange

**Data Plane:**
- Custom packet format with a 16-byte PeerManagerHeader containing packet type, source/destination peer IDs, flags (encrypted, compressed, latency-first, exit-node, ...), forward counter (max 7 hops) and length. The header is cleartext and not covered by the AEAD tag
- Packets are encapsulated with protocol-specific headers (TCP length prefix, UDP connection ID, etc.)
- Optional per-packet compression with zstd only (`--compression zstd`), off by default

**Transport Support:**
- Default listeners (`-l 11010` / no `-l`): tcp and udp on 11010, wg and ws on 11011, wss on 11012, faketcp on 11013
- **TCP** is the default protocol (`default_protocol = "tcp"`): when connecting directly to a peer's listeners, TCP is tried first, then UDP, then the rest
- UDP transport (udp://), also the transport used for UDP hole punching
- WebSocket (ws://) and WebSocket SSL (wss://) for HTTP-compatible tunneling through restrictive firewalls; TLS uses a self-signed certificate and the client skips certificate verification
- QUIC (quic://, opt-in listener) via quinn with BBR congestion control and 5-second keepalive; same unverified self-signed TLS
- WireGuard transport (wg://) via boringtun; the wg listener is enabled by default on port 11011. Its X25519 static key is the same SipHash digest of network name and secret that is sent in the handshake. Separately, the VPN portal exposes a WireGuard server for standard WireGuard clients
- FakeTCP (faketcp://): raw-socket transport that disguises datagrams as TCP segments (BPF on Linux/macOS, WinDivert on Windows)
- Optional KCP proxy (`--enable-kcp-proxy`) and QUIC proxy (`--enable-quic-proxy`) terminate TCP flows locally and carry them as KCP (turbo mode) or QUIC/BBR streams over the overlay, for lossy UDP paths

The protocol allows direct peer-to-peer communication with automatic fallback to relay when direct connection fails.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary transport protocol supported
- [x] **TCP fallback** - TCP listener is on by default and preferred for direct connections; TCP relays work too
- [x] **QUIC support** - Opt-in quic:// transport (quinn, BBR); also used by the optional QUIC proxy
- [x] **WebSocket support** - HTTP-compatible tunneling via ws:// and wss://

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic
- [x] **IPv6 support** - Inner IPv6 via `--ipv6` address (the `enable_ipv6`/`--disable-ipv6` flag only controls IPv6 underlay)
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6 supported

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing (default mode using TUN devices)
- [ ] **Layer 2 (Ethernet) mode** - Full Ethernet frame tunneling not supported
- [ ] **Bridging support** - Bridge non-VPN devices onto network not available

### Advanced
- [x] **Multipath/bonding** - Active-backup only: several connections per peer (e.g. TCP+UDP) are kept and the lowest-latency one is used, re-evaluated every 5 s; no aggregation
- [x] **QoS/traffic shaping** - L4 stream rate limiting via ACL-based rules
- [x] **Multicast support** - IPv4/IPv6 multicast and broadcast are replicated by the sender to every routed peer

# Encryption

EasyTier's encryption layer is based on the network secret and provides multiple encryption algorithm options.

**Key Derivation:**
- All nodes of a network share one static data key derived only from the network secret; there is no per-peer or per-session key and no key exchange
- Derivation uses Rust's `DefaultHasher` (SipHash-1-3 with fixed zero keys), a fast non-cryptographic hash with no salt and no work factor, so the key can be brute-forced from guessed secrets very cheaply
- The 128-bit key (AES-128-GCM) and the 256-bit key (AES-256-GCM, ChaCha20) are built by chaining 64-bit SipHash outputs
- The 32-byte network secret digest (same SipHash chaining over network_name + network_secret) is sent in plaintext in every client handshake, including to public shared nodes. It acts as a reusable bearer token for joining the network's control plane and is also used directly as the X25519 static private key of the wg:// transport

**Default Algorithm:** AES-128-GCM (ring). Alternatives via `--encryption-algorithm`: `aes-256-gcm`, `chacha20` (ChaCha20-Poly1305, ring), `xor`, and the OpenSSL variants `openssl-aes128-gcm`/`openssl-aes256-gcm`/`openssl-chacha20` (only in builds with the non-default `openssl-crypto` feature). `--disable-encryption` sends plaintext.

**Encryption Process:**
- Encryption is end-to-end between source and destination node: the source encrypts data/KCP packets once and intermediate peers and shared nodes forward without decrypting. Every member derives the same AES key from the network secret, so a member node that forwards multi-hop traffic could decrypt it; foreign shared nodes cannot
- AEAD with a random 96-bit nonce per packet and empty associated data; the trailer is 28 bytes (16-byte tag + 12-byte nonce). The PeerManagerHeader (peer IDs, flags) is not authenticated
- The receiver decides whether to decrypt from the cleartext `ENCRYPTED` header flag; packets with the flag cleared are accepted as plaintext even when encryption is enabled
- Control-plane RPC between members is encrypted with the same key; RPC with public shared nodes is not
- When encryption is enabled, the TUN MTU is reduced by 20 bytes (1380 → 1360)
- No forward secrecy - same static key used for all sessions

**Critical Security Issues:**
- Weak key derivation using SipHash instead of proper KDF (HKDF, Argon2, scrypt)
- No perfect forward secrecy and no key rotation
- Network secret digest sent in plaintext enables offline dictionary attacks and lets anyone who observes it join the control plane
- Encryption is not enforced on receive and headers are unauthenticated, so a holder of the digest (e.g. any shared node) can inject plaintext packets
- Random nonces under a never-rotated, network-wide key: NIST SP 800-38D limits random-nonce GCM to 2^32 messages per key
- XOR cipher option is cryptographically broken and should not be offered

## Encryption Checklist

### Key Exchange
- [ ] **Modern key exchange** - EasyTier's own protocol has no X25519/ECDH and uses a static pre-shared key. X25519 appears only at the hop layer: optional wg:// transport (WireGuard via boringtun) and TLS 1.3 of wss/quic transports
- [ ] **Perfect Forward Secrecy** - No ephemeral session keys for the EasyTier layer; only per-hop forward secrecy when the hop uses wg://, wss:// or quic://
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [ ] **Key rotation** - No automatic periodic key refresh

### Symmetric Encryption
- [x] **Authenticated encryption** - AES-128/256-GCM and ChaCha20-Poly1305 (XOR and none also selectable)
- [x] **Hardware-accelerated crypto** - ring AES-GCM uses AES-NI/CLMUL (ARMv8 crypto extensions on ARM) and SIMD ChaCha20
- [x] **Constant-time operations** - AEAD from ring (BoringSSL-derived constant-time code); the digest check is a plain equality compare, but the digest is public anyway

### Protocol Security
- [ ] **Replay protection** - Random per-packet nonces, no counter or sliding window
- [ ] **Noise Protocol or equivalent** - Custom handshake; only the optional wg:// hop transport runs WireGuard's Noise IKpsk2
- [ ] **No cleartext metadata** - Network name, peer ID and secret digest in the handshake, cleartext peer IDs in every data header
- [x] **End-to-end encryption through relays** - Partial: all members derive the same AES key from the network secret, so member nodes that forward multi-hop traffic can decrypt it; only foreign shared nodes cannot (`easytier/src/common/global_ctx.rs:330-357`, `easytier/src/peers/peer_manager.rs:659-699`)

# Performance

EasyTier supports both single-threaded and multi-threaded operation via runtime configuration.

**Threading Model:**
- Multi-threaded mode enabled by default using Tokio's multi-threaded runtime
- Default: 2 worker threads (`--multi-thread-count`, minimum 2)
- Single-threaded mode available for resource-constrained devices
- Async I/O throughout using Tokio primitives
- One task reads the TUN device and encrypts outgoing packets; all incoming packets from all peer connections go through one shared queue (capacity 128) into a single receive task that decrypts, decompresses, runs ACLs and forwards. Each peer connection has its own send task. Crypto is therefore serialized to roughly one core per direction

**Packet Processing:**
- UDP transport: one `recv_from`/`send_to` per packet, no recvmmsg/sendmmsg
- TCP transport: the per-connection send task drains all queued packets and flushes them with vectored writes (up to 64 buffers); one read can return several framed packets
- QUIC transport: quinn-udp uses recvmmsg (32 datagrams) and UDP GSO on Linux; GRO is disabled by EasyTier
- Packet buffers reserve headroom for headers and AEAD runs in place; copies still occur for multi-destination sends (broadcast), compression and the smoltcp path
- No packet sorting before sending to kernel
- TUN interface read in single task, no multi-queue parallelism or TUN offloads

**Concurrency Primitives:**
- tokio::sync::Mutex and RwLock for async-aware locking
- DashMap for concurrent hash maps
- JoinSet for managing task groups
- broadcast channels for event distribution
- ArcSwap for lock-free ACL hot-reload

**Performance vs Tailscale:**
EasyTier underperforms Tailscale under the old sender-side Medium profile (2.5% reordering and 1% loss per direction, 5% and 2% combined). While Tailscale achieves 41 Mbps, EasyTier performs worse. Likely reasons, based on the source:
- More syscalls (no recvmmsg/sendmmsg on the UDP transport)
- OS-default socket buffers
- Single receive task for decryption and forwarding
- No GSO/GRO offloading on UDP or TUN
- TCP is tried first for direct connections, so overlay TCP may run over TCP (TCP-over-TCP) under loss

Note: in the default Linux configuration, overlay TCP runs end to end on kernel TCP stacks through the TUN device. smoltcp is used only for subnet-proxy/exit-node TCP with `--use-smoltcp`, in no-TUN mode and on Android/HarmonyOS. The optional KCP/QUIC proxies replace overlay TCP with KCP or QUIC/BBR streams.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Partial: multi-threaded Tokio runtime, but all inbound decryption runs in one task and outbound encryption in the TUN reader task
- [ ] **Per-core packet queues** - No per-peer or per-core crypto queues; one shared inbound queue

### Packet I/O
- [x] **Batch UDP receives** - Partial: only the QUIC transport (quinn-udp recvmmsg, 32 per call); UDP transport is one packet per syscall
- [ ] **Batch UDP sends** - No sendmmsg; QUIC uses sendmsg with GSO, TCP transport uses vectored writes
- [x] **Large batch sizes** - Partial: TCP transport can coalesce up to 64 queued frames per writev; no 64+ packet UDP or TUN batching

### UDP Offload
- [x] **UDP GSO (Generic Segmentation Offload)** - Partial: only the QUIC transport via quinn-udp (UDP_SEGMENT)
- [ ] **UDP GRO (Generic Receive Offload)** - Not used (QUIC explicitly disables it)

### Buffer Management
- [x] **Buffer pool reuse** - Partial: UDP/TCP/TUN receive paths reserve a larger BytesMut chunk (4-8 KB) and split one packet off at a time; there is no free-list pool
- [ ] **Large UDP socket buffers** - SO_RCVBUF/SO_SNDBUF are left at OS defaults (only the FakeTCP raw socket sets SO_RCVBUF)

### Userspace TCP Stack (optional)
- [x] **Userspace TCP implementation** - Partial: smoltcp only for subnet-proxy/exit-node TCP with `--use-smoltcp`, no-TUN mode, Android/HarmonyOS and the SOCKS5 portal; default datapath uses kernel TCP
- [ ] **Large TCP RX/TX buffers** - smoltcp sockets use 16 KiB RX/TX buffers
- [ ] **Tuned congestion control** - smoltcp built without congestion control (`socket-tcp-cubic` disabled); BBR only via the optional QUIC proxy, KCP turbo mode via the KCP proxy
- [ ] **Reordering tolerance** - smoltcp assembler keeps at most 16 out-of-order ranges within the 16 KiB window

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No evidence of merging small segments
- [ ] **RX checksum offload** - Likely handled by NIC/kernel, not explicitly managed

### MTU Handling
- [x] **Conservative MTU** - Default 1380 bytes; the TUN device is set to 1360 when encryption is enabled
- [ ] **Path MTU discovery** - No evidence of dynamic MTU discovery

### Peer Management
- [ ] **Lazy peer removal** - Unreachable peers leave the route table after 90 s; dead peer info expires after 3660 s
- [x] **Endpoint caching** - Keeps several connections per peer and caches the lowest-latency one as default, re-evaluated every 5 s
- [x] **Efficient keepalive timers** - Adaptive per-connection ping: 1 s interval backing off to 32 s, reset on loss or one-way traffic; connection closed after 5 consecutive losses with no received traffic

### Packet Processing
- [x] **Zero-allocation parsing** - Partial: headers are parsed in place via `zerocopy`, but every packet is a BytesMut slice from chunked allocation
- [x] **Zero-copy filtering** - ACL parsing reads the packet buffer in place

### State Synchronization
- [x] **Delta updates** - OSPF-style incremental route updates
- [x] **Compression** - RPC payloads (including route sync) are zstd-compressed when the peer accepts it

### Data Plane Compression
- [x] **Tunnel compression** - zstd via `--compression zstd` (off by default)
- [ ] **Configurable compression level** - Only on/off; single algorithm (zstd) at a fixed default level

# Security

**Known Security Issues:**

1. **Weak Key Derivation (Critical)**: Uses DefaultHasher (SipHash-1-3, fixed keys, no salt) for deriving encryption keys and the handshake digest from the network secret instead of a cryptographic KDF like HKDF, Argon2, or scrypt
2. **XOR Cipher Option (Critical)**: Offers XOR encryption which is trivially breakable and provides no real security
3. **No Forward Secrecy (High)**: Same static encryption key used for all sessions; compromise of network secret compromises all past traffic
4. **Cleartext Digest Transmission (High)**: The client sends the network secret digest in plaintext in every handshake, including to public shared nodes and to any server it dials. This enables offline dictionary/brute-force attacks, and anyone holding the digest can complete the handshake and join the network's control plane. The digest is also the wg:// transport's X25519 static private key
5. **Encryption Not Enforced / Unauthenticated Header (High)**: Receivers accept packets whose cleartext `ENCRYPTED` flag is cleared as plaintext, and the PeerManagerHeader is not covered by the AEAD tag. A party holding the digest (e.g. a public shared node relaying the network) can inject plaintext data or RPC packets and rewrite peer IDs
6. **Peer ID Collision Panic (Medium)**: The node calls `panic!` when route info claims its own peer ID with a newer version. Peer IDs are random 32-bit values regenerated at every start, so any route-sync participant, including a shared node, can crash members remotely
7. **No Replay Protection (Medium)**: Random per-packet nonces, no counter or sliding window
8. **Random Nonces Under a Static Key (Medium)**: One never-rotated key per network with random 96-bit GCM nonces; NIST SP 800-38D caps this at 2^32 packets per key network-wide
9. **Unverified TLS (Medium)**: wss:// and quic:// use self-signed certificates and the client accepts any server certificate, so these transports only resist passive observers

No CVE or security advisory is referenced in the repository.

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No handshake/control-packet rate limiting; only bandwidth caps (`foreign_relay_bps_limit` for relayed foreign networks, per-rule ACL token buckets) and a cap on direct connections per foreign peer
- [x] **Stateful packet filter** - ACL rules can enable connection tracking (`stateful = true`), state preserved across hot reloads
- [x] **Fine-grained ACLs** - Per-port/protocol access control with inbound/outbound/forward chains and hot-reload
- [x] **Capability-based access** - ACL rules can match source/destination groups; group membership is proven by an HMAC-SHA256 of the peer ID with a shared group secret

### Identity & Authentication
- [ ] **Identity validation** - No proof-of-work, simple digest comparison only
- [ ] **Signed configuration updates** - No cryptographic verification of config updates
- [ ] **Certificate pinning** - N/A: there is no controller to pin. (Separately, there is no PKI, and TLS certificates of wss/quic transports are not verified at all)

### Implementation
- [x] **Memory-safe language** - Written in Rust, memory-safe by design
- [ ] **Privilege separation** - Runs with full privileges for TUN interface access
- [ ] **Sandboxing** - No process isolation visible
- [ ] **Audit logging** - ACL hit/drop logging and peer add/remove events via tracing, but no dedicated security audit log

# NAT Traversal

EasyTier has comprehensive NAT traversal support handling various NAT scenarios.

**Discovery Mechanism:**
- STUN-based NAT type detection for UDP (Open Internet, No-PAT, Full Cone, Restricted, Port Restricted, Symmetric, plus predictable "easy" symmetric with incrementing/decrementing ports) and a separate TCP NAT type
- Discovers public IP/port mappings via a built-in list of public STUN servers (configurable with `--stun-servers`/`--stun-servers-v6`, `txt:` DNS records supported); EasyTier UDP listeners also answer STUN requests
- Supports both IPv4 and IPv6 STUN servers

**Hole Punching Strategies:**

1. **Cone-to-Cone**: Both peers behind cone NAT - high success rate, standard hole punching where each peer sends to other's public address
2. **Symmetric-to-Cone**: One symmetric NAT, one cone NAT - for predictable symmetric NATs the cone side predicts the next ports; for hard symmetric NATs the symmetric side opens 84 sockets and the cone side sprays random ports (birthday-style)
3. **EasySymToEasySym**: Both sides behind predictable ("easy") symmetric NATs - 25 sockets with incremental/decremental port prediction

**TCP Hole Punching:**
- Uses TCP simultaneous open technique where both peers connect simultaneously
- Provides fallback when UDP is blocked

**Relay Fallback:**
- Automatically falls back to relaying through any peer or shared node that can reach both sides, chosen by the link-state routing
- Public shared nodes such as tcp://public.easytier.cn:11010 act as relay points. They forward the network's packets without decrypting the payload, but they receive the network name and secret digest and participate in the network's route sync unencrypted. They therefore see peer IDs, virtual IPv4/IPv6 addresses, hostnames, proxied subnets, NAT types and versions, plus per-packet metadata

## NAT Traversal Checklist

### Discovery
- [x] **No own public node needed** - The GUI/web default (`PublicServer` mode) and the installer's `default.conf` peer with the project's shared node `tcp://public.easytier.top:11010` (`easytier-web/frontend-lib/src/types/network.ts:87-89`, `script/install.sh:253-254`). A bare `easytier-core` has no built-in peer (`easytier/src/core.rs:186-198`)
- [x] **STUN support** - Discovers public IP/port via STUN servers
- [x] **Multiple STUN servers** - Built-in list, overridable via `--stun-servers`
- [x] **NAT type detection** - Identifies Full Cone, Restricted Cone, Port Restricted, Symmetric and easy (predictable) Symmetric NAT

### Port Mapping
- [ ] **UPnP port mapping** - No automatic router port forwarding via UPnP
- [ ] **NAT-PMP support** - No Apple port mapping protocol
- [ ] **PCP support** - No Port Control Protocol (RFC 6887)

### Hole Punching
- [x] **UDP hole punching** - Direct peer-to-peer through NAT via multiple strategies
- [x] **Symmetric NAT handling** - Port prediction for easy symmetric NATs, random port spraying across 84 sockets for hard symmetric NATs
- [x] **Rendezvous coordination** - RPC-based server-assisted hole punching coordination

### Fallback
- [x] **Relay fallback** - Relay through peers or shared nodes when direct fails; foreign shared nodes cannot read the payload, but member nodes hold the shared network key
- [x] **Multiple relay regions** - Partial: any number of shared nodes and peers can relay at the same time, but there is no region concept
- [x] **Automatic relay selection** - Routing algorithm selects best relay path
- [x] **TCP relay support** - Relay over TCP when UDP blocked

# Local Routing

**LAN Discovery:**
- Peers discover each other through manual configuration (`-p` peers) or shared public nodes
- OSPF-like route propagation spreads peer information throughout the mesh
- Peers exchange their interface IPs, public IPs and listener URLs over RPC; the direct connector tries every candidate address (LAN and public) to establish a direct connection
- No broadcast/multicast/mDNS discovery on the local LAN

**Local Optimization:**
- Shortest-path routing prefers direct connections (one hop) over relayed paths
- When a peer is reachable over several connections (e.g. LAN address and public address), the lowest-latency connection is used
- AVOID_RELAY_COST (i32::MAX) is added to edges of nodes that set `avoid_relay_data` (nodes whose own network is not in their relay whitelist), so such nodes relay only as a last resort

**Routing Mechanism:**
- Link-state database maintained by each node with complete network topology
- Dijkstra's algorithm computes shortest paths
- Two routing policies:
  - **LeastHop** (default): Prefer direct connections (minimizes hops)
  - **LeastCost** (`--latency-first`): Prefer lowest latency paths (minimizes latency)

**Subnet Routing:**
- Nodes can share accessible subnets via `-n` (`--proxy-networks`)
- Subnet proxy information automatically synced to all peers
- Each node auto-configures routes for proxied subnets
- Supports exit node mode for routing all traffic through specific peer (`--enable-exit-node` on the exit, `--exit-nodes` on clients)
- Optional magic DNS (`--accept-dns`): a built-in DNS server on 100.100.100.101 resolves `<hostname>.et.net.` (zone configurable) and modifies the system DNS settings

If two peers are on the same LAN and connect to the mesh, they will establish direct connection and route traffic locally without going through public relay nodes.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No LAN broadcast/mDNS discovery; peers are found via configured peers and route flooding
- [x] **Direct path advertisement** - Peers share interface IPs, public IPs and listeners
- [ ] **Same-subnet detection** - No explicit subnet check; LAN addresses are simply tried along with public ones

### LAN Optimization
- [x] **Automatic LAN preference** - Direct LAN connections win over relays (fewer hops) and over other direct connections (lowest latency)
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [ ] **LAN-only mode** - No option to restrict to local network only

### Routing Features
- [x] **Subnet routes** - Route traffic for other networks through peer via `-n` (`--proxy-networks`)
- [x] **Full tunnel mode** - Exit node support routes all traffic through a peer
- [x] **Split tunneling** - Selective routing through VPN via subnet configuration
- [x] **Route priorities** - Partial: if several peers advertise the same subnet, the one with the shortest path wins and failover is automatic, but there is no configurable priority

# Central Point of Failure

**No mandatory central point of failure** - EasyTier is fundamentally decentralized.

**Peer Center (Optional Optimization):**
- Optional "peer center" node elected based on smallest peer ID
- Used for aggregating global peer/latency information (e.g. for the CLI)
- NOT required for operation - failure only affects info aggregation
- Route information still propagated peer-to-peer via OSPF-like protocol
- Can dynamically change when peers enter/leave network

**Public Shared Nodes:**
- tcp://public.easytier.cn:11010 and similar nodes are optional bootstrap/relay points
- NOT required between peers with direct connectivity
- Can be self-hosted (any easytier-core instance acts as one by default)
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
- Optional self-hostable web console (easytier-web) can push configurations to nodes started with `--config-server`
- No on-disk peer cache; routing state is held in memory only

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - P2P tunnels stay up without controller/shared node
- [ ] **Local state caching** - Routing tables are in memory only; nothing is persisted across restarts
- [ ] **Cached credentials** - Not applicable: the network secret in the local config is the only credential, nothing is issued by a controller
- [x] **Graceful degradation** - Clear behavior: existing connections work, new connections require bootstrap

### Redundancy
- [x] **Self-hosted controller** - Can run own shared nodes for bootstrap/relay
- [x] **Controller redundancy** - Multiple shared nodes can be configured
- [x] **Relay redundancy** - Multiple relay servers supported
- [x] **No single root of trust** - Distributed trust model, any peer can relay

### Efficiency
- [x] **Delta/incremental updates** - OSPF-style incremental route updates
- [ ] **Long polling / push updates** - Not applicable, P2P route flooding
- [ ] **Configurable sync interval** - Timers are compile-time constants (1 s session check, 3600 s self refresh)

# Authentication

**Pre-Shared Key Model:**
EasyTier uses a simple pre-shared key authentication model with no PKI infrastructure.

**Network Identity:**
- **network_name**: String identifier for the virtual network
- **network_secret**: Optional pre-shared secret for authentication and encryption key derivation
- **network_secret_digest**: 32-byte SipHash-based (DefaultHasher) digest of network_name + network_secret

**Enrollment Process:**
1. Node configured with network name and secret via command line (`--network-name`, `--network-secret`) or config file
2. During handshake, the client sends network_secret_digest in plaintext; the server returns its own digest only if the client's network name and digest equal its own (otherwise zeros)
3. Both peers compare digest - connection accepted if match; connections from other network names are accepted as foreign networks (relay service) unless `--private-mode` is set
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
- The optional easytier-web console uses username/password accounts; nodes attach to it with `--config-server <url>/<username>` (default host config-server.easytier.cn) and receive their network config from it

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
- [x] **Stable device identity** - Partial: peer ID is random on every start; only the instance UUID (if set in the config) and the machine ID used by the web console are persistent, and none is cryptographically bound
- [x] **Identity portability** - Partial: the node identity (`instance_id`) lives in the config file next to the network secret, so copying the config moves it; it is not cryptographically bound (`easytier/src/common/config.rs:390,628-635`)
- [x] **Multi-user support** - One process can run several network instances, any node can host foreign networks, and the web console has user accounts

# Platform Support

**Supported Platforms:**
- **Linux** - Full support (x86, ARM, MIPS architectures)
- **macOS** - Full support
- **Windows** - Full support
- **FreeBSD** - Supported (x86_64 release build)
- **Android** - Mobile app support (Tauri GUI with VpnService)
- **HarmonyOS** - Separate easytier-ohrs integration
- **iOS** - No native client; standard WireGuard clients connect through the VPN portal

**Implementation Details:**

**TUN Interface:**
- Userspace implementation using tun crate
- Layer 3 (IP) mode only, TUN devices not TAP
- Reads/writes IP packets from virtual network interface
- Platform-specific interface configuration via ifcfg module

**Container Support:**
- Official images published to Docker Hub and GHCR (easytier/easytier)
- Requires privileged mode for TUN interface access
- Network namespace support via the `netns` config option

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
- [x] **FreeBSD/OpenBSD** - Partial: FreeBSD supported, no OpenBSD

### Mobile
- [x] **iOS** - Partial: only via a standard WireGuard client to the VPN portal
- [x] **Android** - Native mobile app

### Implementation
- [ ] **Kernel-mode datapath** - No in-kernel packet processing
- [x] **Userspace implementation** - Runs entirely in userspace with TUN interface
- [x] **Container support** - Official Docker images (no Kubernetes manifests in the repo)
