# Overview

ZeroTier is a software-defined networking solution that creates virtual Ethernet networks (Layer 2) spanning the global internet. It functions as a "planetary scale virtual switch" allowing devices anywhere to communicate as if on a local LAN.

**Key Architecture Components:**

- **Node** - Core implementation handling virtual network frame processing, encryption, and packet routing
- **Switch** - Packet switching, ZeroTier-level fragmentation/reassembly and relaying. It also contains a 9-bucket CoDel/DRR QoS queue, but that code is disabled (`Network::qosEnabled()` always returns false)
- **Topology** - Network topology management tracking peers, root servers (listed in the signed "planet" world definition), and optional user-defined root sets (moons)
- **Network** - Virtual LAN abstraction providing Ethernet emulation with multicast/broadcast support
- **PacketMultiplexer** - Optional (opt-in `multicoreEnabled`) worker threads that write already-decrypted frames to the TAP device (Linux and FreeBSD only)
- **Network controller** - Issues signed network configs and certificates. Since 1.16.0 it lives in `nonfree/` under a source-available license and is left out of default builds (needs `make ZT_NONFREE=1`)

The architecture follows a VL1 (virtual layer 1 - point-to-point encryption) and VL2 (virtual layer 2 - Ethernet emulation) model, where each peer-to-peer connection is independently encrypted before being used to tunnel Layer 2 Ethernet frames.

**License:** Since 1.16.0 the core (`node/`, `include/`), service (`service/`, `osdep/`) and most other code are MPL-2.0 (1.4.4–1.14 used BSL 1.1). The network controller in `nonfree/` uses the "ZeroTier Source-Available License", which forbids commercial use. Code in `ext/` keeps its upstream licenses.

# Protocol

ZeroTier uses a custom UDP-based protocol (currently version 13, introduced with 1.16.0, accepting peers back to version 4). The protocol is designed for NAT traversal with root server coordination.

**Control Plane Communication:**

The control plane uses a verb-based protocol with commands like HELLO (handshake), WHOIS (address lookup), RENDEZVOUS (NAT traversal coordination), NETWORK_CONFIG_REQUEST/NETWORK_CONFIG (configuration distribution), and various multicast coordination verbs.

Root servers (listed in the signed "planet" world file; the built-in default planet has 4 roots, each with one IPv4 and one IPv6 endpoint) facilitate peer discovery, relaying and NAT hole-punching. When two peers need to connect:
1. Each peer maintains connections to root servers
2. Peers request network configuration from the network controller (its address is the first 40 bits of the network ID) and resolve other peers' identities via WHOIS to the roots
3. Until a direct path exists, packets are relayed through a root, which sends VERB_RENDEZVOUS to both peers
4. Peers send HELLO/ECHO directly to each other to open a direct path. The per-peer key is already fixed by the two long-term identities, so there is no key negotiation
5. Once established, peers exchange PUSH_DIRECT_PATHS to advertise additional endpoints

**Data Plane Communication:**

Data packets are sent using VERB_FRAME (implicit MAC addresses derived from ZeroTier addresses) or VERB_EXT_FRAME (full MAC addresses) verbs. Each packet header contains a 64-bit packet ID (IV/nonce), destination and source ZeroTier addresses (5 bytes each, in cleartext), a flags/cipher/hops byte, and a 64-bit MAC field. With AES-GMAC-SIV the packet-ID and MAC fields together carry the 128-bit SIV tag. With legacy Salsa20/12-Poly1305 the MAC is a Poly1305 tag truncated to 64 bits.

The virtual network MTU defaults to 2800 bytes (set per network by the controller, range 1280–10000). ZeroTier fragments at its own layer. The default physical UDP payload is 1432 bytes, configurable per physical subnet in local.conf. A full-size 2800-byte frame therefore leaves as two UDP datagrams (a head plus one fragment; up to 7 pieces are allowed). IP-level PMTU discovery is disabled on the UDP sockets (IP_MTU_DISCOVER=0, DONTFRAG off).

**Transport Protocol Support:**

ZeroTier uses UDP for all peer traffic: default port 9993, plus a random secondary port and a third port used for UPnP/NAT-PMP mappings. If no UDP packet has arrived from any global IP for 60 seconds, it tunnels over a single TCP connection to a TCP proxy (default anycast 204.80.128.1:443, configurable via `tcpFallbackRelay`, IPv4 only). The proxy frames packets as fake TLS 1.2 application-data records and forwards them as UDP, acting like a remote UDP socket. `forceTcpRelay` forces this mode. TCP fallback is disabled when bonding is in use. There is no QUIC or WebSocket support.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary transport protocol
- [x] **TCP fallback** - TLS-framed TCP to a proxy (default anycast 204.80.128.1:443, self-hostable `tcp-proxy`) after 60 s without UDP; IPv4 only
- [ ] **QUIC support** - Modern multiplexed transport
- [ ] **WebSocket support** - HTTP-compatible tunneling

### IP Support
- [x] **IPv4 support** - IPv4 tunnel traffic
- [x] **IPv6 support** - Native IPv6 tunneling
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6

### Network Layer Mode
- [ ] **Layer 3 (IP) mode** - Always Ethernet over a TAP device; no TUN/L3-only mode
- [x] **Layer 2 (Ethernet) mode** - Full Ethernet frame tunneling
- [x] **Bridging support** - Bridge non-VPN devices onto network

### Advanced
- [x] **Multipath/bonding** - Opt-in via local.conf bonding policies (6 policies: NONE, ACTIVE_BACKUP, BROADCAST, BALANCE_RR, BALANCE_XOR, BALANCE_AWARE); default policy is NONE
- [ ] **QoS/traffic shaping** - A PRIORITY rule action and a 9-bucket CoDel/DRR queue exist in the code but are disabled (`qosEnabled()` returns false), so frames go out without queuing
- [x] **Multicast support** - Virtual multicast/broadcast via MULTICAST_LIKE/GATHER/FRAME verbs

# Encryption

ZeroTier uses modern elliptic curve cryptography with multiple cipher suites for different use cases.

**Key Exchange:**

Each node has a long-term identity: a Curve25519 (X25519) key for ECDH plus an Ed25519 key for signatures (64-byte public key, 64-byte private key). There is no session handshake. Each pair of peers computes a static X25519 shared secret from their long-term keys, hashes it with SHA-512 and uses 48 bytes as the per-peer symmetric key. The two AES-GMAC-SIV keys (K0, K1) are derived from it with KBKDF-HMAC-SHA384. The Salsa20/12 path uses the first 32 bytes, mangled per packet. The key changes only when one of the identities changes.

**Cipher Suites:**

1. **C25519_POLY1305_NONE** - MAC-only for HELLO packets
2. **C25519_POLY1305_SALSA2012** - Legacy: Salsa20/12 encryption + Poly1305 MAC truncated to 64 bits. Used only with peers older than protocol 12 (ZeroTier < 1.6.0)
3. **NO_CRYPTO_TRUSTED_PATH** - No encryption for trusted LANs (data center use)
4. **AES_GMAC_SIV** - Default for peers speaking protocol 12+ (ZeroTier 1.6.0+). AES-256 in a GMAC-SIV construction with a 128-bit tag. Accelerated with AES-NI/PCLMULQDQ on x86-64 and ARMv8 Crypto Extensions on ARM64 (runtime-detected), with a software lookup-table AES fallback elsewhere

**Encrypted HELLO / Extended Armor (Protocol v13, ZeroTier 1.16+):**

Opt-in via `encryptedHelloEnabled` in local.conf (default off). The sender generates an ephemeral X25519 key and agrees with the recipient's long-term key. It then AES-CTR-encrypts everything after the header flags (MAC, verb and payload, including the sender's identity) and appends the ephemeral public key. This applies to every directly sent HELLO. The cleartext header still carries the source and destination ZeroTier addresses. The ephemeral key protects only the HELLO and does not feed into data keys.

**Notable Security Design:**

- HELLO packets are authenticated (Poly1305 with the static key) but sent unencrypted, carrying the full public identity, unless encrypted HELLO is enabled
- Static ECDH keys are reused until identity changes (no perfect forward secrecy)
- Memory-hard hashcash identity validation prevents identity grinding attacks (2MB, SHA-512 + Salsa20)
- No data-plane replay protection: there is no counter or sliding window. Only OK/ERROR replies are matched against recently sent packet IDs

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519/X25519 ECDH
- [ ] **Perfect Forward Secrecy** - Static ECDH keys reused (ephemeral keys only for HELLO extended armor)
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange
- [ ] **Key rotation** - Keys are static per identity, no automatic periodic rotation

### Symmetric Encryption
- [x] **Authenticated encryption** - AES-256-GMAC-SIV (default) and Salsa20/12-Poly1305 (legacy)
- [x] **Hardware-accelerated crypto** - AES-NI/PCLMULQDQ on x86-64, ARMv8 Crypto Extensions on ARM64 (runtime-detected); Salsa20/12 assembly on x86-64/ARM32
- [x] **Constant-time operations** - Partial: AES-NI/ARMv8-CE, Salsa20, Poly1305 and Curve25519 are constant-time; the software AES fallback uses lookup tables

### Protocol Security
- [ ] **Replay protection** - No replay window or counter check on the data plane
- [ ] **Noise Protocol or equivalent** - Custom handshake protocol (not Noise)
- [ ] **No cleartext metadata** - Every packet header carries source/destination ZeroTier addresses in cleartext; HELLO carries the full public identity unless encrypted HELLO is enabled

# Performance

By default ZeroTier's data plane runs on few threads: one thread receives and decrypts, and one thread per network reads and encrypts. An opt-in multicore mode on Linux and FreeBSD adds worker threads, but receive-side decryption always stays on one thread.

**Threading Model:**

The service runs one `select()`-based event loop (Phy). It receives UDP for all networks, decrypts and filters packets, and (by default) writes the resulting frames to the TAP device. Each virtual network also has its own TAP reader thread. That thread reads outbound frames, encrypts them and calls sendto().

With `"multicoreEnabled": true` in local.conf (Linux and FreeBSD only; ignored on macOS, Windows, OpenBSD and NetBSD), `concurrency` sets the thread count N. If the value is ≤1 or ≥ the core count, it falls back to 2 on machines with ≥4 cores and 1 otherwise. `cpuPinningEnabled` pins the threads to cores. In this mode:
- N TAP reader threads read the same single-queue TAP fd, so outbound encryption runs in parallel.
- The PacketMultiplexer hands decrypted inbound frames to N post-decode threads that write them to the TAP device, choosing a queue by flow hash. The receive path computes that flow hash only when a BALANCE_XOR/BALANCE_AWARE bond is active. Otherwise every frame gets flow ID −1 and lands in the same queue, so in practice one worker does all inbound TAP writes.
- UDP receive, decryption and rule filtering stay on the single event-loop thread.

Throughout the codebase, extensive mutex protection is used (network state, peer tables, path tables, bond state).

**Packet Processing:**

Packets are copied at several stages. recvmmsg fills 128 stack buffers of 1500 bytes each. Each datagram is copied into a stack-allocated Packet (Buffer<ZT_PROTO_MAX_PACKET_LENGTH>, 7 × 1432 bytes), decrypted in place, and the frame is written to the TAP device. In multicore mode the frame is copied once more into a pooled PacketRecord. TAP reads use a 16KB stack buffer per thread. The fixed 32-entry RX queue only holds fragments and packets waiting for a WHOIS reply; it is not a general buffer pool.

**I/O Optimizations:**

On Linux, receive batching uses recvmmsg with 128 packets per call. However, sending uses individual sendto() calls per packet (no sendmmsg batching). An outer loop can process up to 1024 receive batches before returning. Non-Linux platforms fall back to recvfrom() in a tight loop. UDP sockets request 1 MiB SO_RCVBUF/SO_SNDBUF, which the kernel caps at rmem_max/wmem_max. On Linux, UDP checksums on IPv4 sockets are turned off (SO_NO_CHECK). IP-level PMTU discovery is disabled. The TAP device is opened with IFF_TAP|IFF_NO_PI only (no multi-queue, no vnet-header offloads).

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Partial: opt-in (`multicoreEnabled`) on Linux/FreeBSD; spreads TX encryption across TAP reader threads, while RX decryption stays single-threaded
- [ ] **Per-core packet queues** - Multicore mode has per-thread post-decrypt TAP-write queues, but no per-peer or per-core crypto queues

### Packet I/O
- [x] **Batch UDP receives** - Uses recvmmsg with 128 packets per batch (Linux only)
- [ ] **Batch UDP sends** - Uses individual sendto() per packet (no sendmmsg)
- [x] **Large batch sizes** - 128 packets per recvmmsg batch (Linux only)

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Not implemented
- [ ] **UDP GRO (Generic Receive Offload)** - Not implemented

### Buffer Management
- [x] **Buffer pool reuse** - Partial: the hot path uses stack buffers; only multicore mode recycles PacketRecord objects. The 32-slot RX queue is for fragment reassembly/WHOIS
- [x] **Large UDP socket buffers** - 1 MiB requested (ZT_UDP_DESIRED_BUF_SIZE = 1048576) via Binder.hpp; the kernel caps it at rmem_max/wmem_max

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - None; ZeroTier carries Ethernet frames between kernel TAP devices
- [ ] **Large TCP RX/TX buffers** - N/A (no userspace TCP stack)
- [ ] **Tuned congestion control** - N/A (no userspace TCP stack)
- [ ] **Reordering tolerance** - N/A (no userspace TCP stack)

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No coalescing
- [ ] **RX checksum offload** - Standard kernel handling

### MTU Handling
- [ ] **Conservative MTU** - Default virtual MTU is 2800, larger than the 1432-byte physical payload, so full-size frames are fragmented at the ZeroTier layer
- [ ] **Path MTU discovery** - No PMTU probing. The physical MTU is fixed at 1432 (per-subnet override in local.conf), and kernel PMTUD is disabled on the sockets

### Peer Management
- [x] **Lazy peer removal** - Paths expire after 243 seconds (ZT_PEER_PATH_EXPIRATION), peers timeout after 500 seconds (ZT_PEER_ACTIVITY_TIMEOUT)
- [x] **Endpoint caching** - Keeps up to 64 paths per peer and saves known peer paths to disk (peers.d) for reuse after restart
- [x] **Efficient keepalive timers** - An ECHO is sent on a path only after 14 s without outbound traffic; a full HELLO every 60 s

### Packet Processing
- [x] **Zero-allocation parsing** - Packets are parsed in stack buffers on the hot path
- [ ] **Zero-copy filtering** - Multiple buffer copies (socket buffer → Packet, TAP buffer → Packet)

### State Synchronization
- [ ] **Delta updates** - The full network config is re-sent (signed, chunked) on every update; no deltas
- [x] **Compression** - Control plane messages compressed with LZ4 (PUSH_DIRECT_PATHS, credentials, multicast, config requests)

### Data Plane Compression
- [x] **Tunnel compression** - Partial: multicast/broadcast frames are LZ4-compressed when that shrinks them; unicast VERB_FRAME/VERB_EXT_FRAME data is never compressed (receivers accept the ZT_PROTO_VERB_FLAG_COMPRESSED flag on any packet)
- [ ] **Configurable compression level** - LZ4 fast mode only, not configurable

# Security

ZeroTier has a relatively good security track record with a few documented issues.

**Known Security Issues:**

1. **Windows File Permissions (v1.10.4, March 2023; the repository records no CVE ID)** - File permission problem on Windows allowed non-privileged local users to read privileged files in the ZeroTier service's working directory, enabling unprivileged local Windows users to administrate the local ZeroTier instance. Not remotely exploitable.

2. **Local Privilege Escalation (Windows Installer, v1.8.8, April 2022)** - Bug in Windows installer allowed local privilege escalation.

3. **Authentication Failure Bug (v1.8.9, April 2022)** - Long-standing bug causing sporadic "phantom" packet authentication failures. Not a security vulnerability but could cause link failures.

**Security Strengths:**

- Memory-hard hashcash identity validation prevents address collision attacks
- Modern cryptography (Curve25519/Ed25519, AES-256-GMAC-SIV; legacy Salsa20/12-Poly1305)
- Extensive rate limiting throughout the codebase
- Signed world/root updates prevent silent replacement
- Optional HELLO packet encryption (extended armor)

**Potential Concerns:**

- No perfect forward secrecy (static ECDH keys, no session keys)
- No data-plane replay protection (no counter/window)
- HELLO packets reveal the full identity in cleartext unless `encryptedHelloEnabled` is set; every packet header exposes source/destination ZeroTier addresses
- Trusted path mode disables all security (for data centers)
- Controller compromise = network compromise (single point of trust)
- 64-bit MAC only on the legacy Salsa20/12-Poly1305 path and on HELLO; AES-GMAC-SIV uses a 128-bit tag
- The network controller is source-available (`nonfree/`), not open source

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - Prevents amplification/DoS attacks throughout codebase
- [ ] **Stateful packet filter** - The flow rules engine is stateless; TCP flags can be matched, but there is no connection tracking
- [x] **Fine-grained ACLs** - Per-port/protocol access control via flow rules (up to 1024 rules)
- [x] **Capability-based access** - Capabilities, tags, certificates of ownership

### Identity & Authentication
- [x] **Identity validation** - Memory-hard hashcash with 2MB buffer prevents grinding
- [x] **Signed configuration updates** - Network configs and certificates signed by controller
- [x] **Certificate pinning** - Root identities are pinned in the embedded planet (updates must be signed by the planet's update key). The controller is pinned by its address embedded in the network ID, and that address is a hash of its identity. No WebPKI is involved

### Implementation
- [ ] **Memory-safe language** - C++ (not memory-safe, though uses modern practices)
- [x] **Privilege separation** - Partial: on Linux the service switches to the `zerotier-one` user (if it exists) and keeps only CAP_NET_ADMIN/CAP_NET_RAW. macOS uses a separate setuid tap helper (MacEthernetTapAgent); Windows runs as a service
- [ ] **Sandboxing** - No seccomp/pledge/chroot
- [x] **Audit logging** - Partial: remote trace events (packet/credential rejections, etc.) are sent to a controller-configured trace target; no dedicated local audit log

# NAT Traversal

ZeroTier uses root server coordination for NAT hole-punching with support for various NAT types.

**NAT Traversal Mechanism:**

When an upstream (root or moon) relays a packet between two peers, it also coordinates hole punching via VERB_RENDEZVOUS. Peers only accept RENDEZVOUS from upstreams:
1. The relaying root sends RENDEZVOUS to both peers with the other's best known address (highest IP scope)
2. Each peer sends a 4-byte "junk" packet with TTL 2 to open its NAT mapping
3. Peers then attempt direct contact (ECHO/HELLO) to establish an encrypted direct path
4. Peers learn their own external address from the address that roots and peers echo back in HELLO/OK (reports from roots are trusted; entries expire after 10 minutes) and advertise it in PUSH_DIRECT_PATHS
5. Paths in a scope are reset when a trusted reporter sees a changed external address (NAT rebinding detection)

**Port Mapping:**

UPnP/NAT-PMP support is built in via the miniupnpc and libnatpmp libraries and is **enabled by default** (`portMappingEnabled`, default true). The service binds a third random port for the mapping, tries NAT-PMP first and falls back to UPnP.

**Symmetric NAT:**

There is no port prediction or birthday-style probing. Hole punching only uses the addresses peers have actually observed. When it fails (typically symmetric NAT on both sides), traffic keeps flowing relayed over UDP through the lowest-latency root, still end-to-end encrypted. The TCP proxy fallback only engages when no UDP from any global address has arrived for 60 seconds.

## NAT Traversal Checklist

### Discovery
- [x] **No own public node needed** - The built-in default planet's roots relay traffic and introduce peers for hole punching; even a self-hosted controller is reached through them (`node/Topology.cpp:20-36,56-61`, `node/Switch.cpp:1083-1088`)
- [x] **STUN support** - No STUN protocol; the external address is reflected by roots and peers in OK(HELLO) (server/peer reflection)
- [x] **Multiple STUN servers** - Every root and peer reflects; the default planet has 4 roots
- [ ] **NAT type detection** - External addresses are tracked, but the NAT type is not classified (no symmetric-NAT prediction)

### Port Mapping
- [x] **UPnP port mapping** - Automatic router port forwarding via miniupnpc (on by default)
- [x] **NAT-PMP support** - Apple/open port mapping protocol via libnatpmp
- [ ] **PCP support** - No Port Control Protocol (RFC 6887) support

### Hole Punching
- [x] **UDP hole punching** - Direct peer-to-peer through NAT via rendezvous
- [ ] **Symmetric NAT handling** - No port prediction; symmetric-NAT pairs usually stay relayed through roots
- [x] **Rendezvous coordination** - Root server-assisted hole punching

### Fallback
- [x] **Relay fallback** - Roots relay UDP traffic when no direct path exists; the TCP proxy is the last resort
- [x] **Multiple relay regions** - 4 roots on separate hosts and networks in the default planet; moons add more
- [x] **Automatic relay selection** - The root with the best latency/recency score (relayQuality) is chosen
- [x] **TCP relay support** - Single TCP proxy (default anycast 204.80.128.1:443, IPv4 only; self-hostable `tcp-proxy`)

# Local Routing

ZeroTier does not use broadcast/multicast for LAN discovery but supports optimizations for local networks.

**LAN Discovery:**

ZeroTier removed LAN announcement parsing in Protocol v13. All peer discovery happens through:
1. Root servers (primary discovery mechanism)
2. Moon servers (optional user-defined roots)
3. PUSH_DIRECT_PATHS from known peers advertising their endpoints

There is no multicast/broadcast-based local discovery. LAN peers find each other because each node also advertises its local interface addresses (including private LAN IPs) in PUSH_DIRECT_PATHS.

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

Once trust is established, peers advertise their reachable addresses via VERB_PUSH_DIRECT_PATHS: local interface addresses plus external addresses learned from peers, up to 8 per scope and address family. This is rate-limited to prevent DoS amplification. Because local LAN addresses are included, peers on the same LAN can connect directly even though the advertisement first travels over a relayed path.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - Removed in v13, no LAN announcements
- [x] **Direct path advertisement** - PUSH_DIRECT_PATHS shares reachable endpoints
- [ ] **Same-subnet detection** - No subnet comparison; private LAN addresses are pushed and tried like any other endpoint

### LAN Optimization
- [x] **Automatic LAN preference** - Path quality is latency multiplied by an IP-scope weight: private-scope (LAN) paths get 1×, global paths 4×, so LAN paths win
- [x] **Trusted path mode** - Skip encryption on configured trusted LANs
- [ ] **LAN-only mode** - No LAN-only restriction option

### Routing Features
- [x] **Subnet routes** - Route traffic for other networks through peer (up to 128 routes per network)
- [x] **Full tunnel mode** - Route all traffic through a peer (the client must opt in per network with `allowDefault`)
- [x] **Split tunneling** - Only routes pushed by the controller are installed; `allowGlobal`/`allowDefault` are client-side opt-ins
- [ ] **Route priorities** - The route `metric` field exists but is marked "not currently used"

# Central Point of Failure

ZeroTier has both root servers (planet/moons) and network controllers as potential points of failure, though with significant resilience.

**Root Servers (Planet):**

The built-in default planet defines 4 root servers (the format allows at most 4 roots per world, each with up to 32 stable endpoints); each default root has one IPv4 and one IPv6 endpoint. If all root servers fail:
- Existing direct peer-to-peer connections continue working
- New connections cannot be established (no rendezvous coordination)
- Cannot receive network configuration updates
- Cannot validate new peer identities via WHOIS

**Network Controllers:**

Every network ID embeds the controller address (first 40 bits of network ID = controller ZeroTier address). If the controller fails:
- Existing authorized members continue communicating
- New members cannot join
- Configuration changes cannot propagate
- Peers keep accepting each other's certificates only while their last config timestamps stay within `credentialTimeMaxDelta` (default 30 minutes, configurable 5 minutes–2 hours). Nodes normally refresh their config every 60 seconds

**Mitigations:**

1. **Moons** - User-operated root sets. Release notes for 1.16 call them deprecated in favour of network-specific relays, which are a preview: the relay specialist type exists, but relay selection still only considers roots/moons
2. **Self-hosted controllers** - Run your own EmbeddedNetworkController (source-available `nonfree/` code, built only with `make ZT_NONFREE=1`; default binaries do not include it)
3. **Root redundancy** - Multiple roots can be defined per planet/moon
4. **Cached state** - Nodes cache peer paths (peers.d), the planet/moons and network configuration locally

**Offline Operation:**

Nodes cache peer information, paths, and network configuration locally. Existing connections remain functional when the controller is unreachable, but new connections and configuration changes require controller availability.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Direct peer connections continue without controller
- [x] **Local state caching** - Persists peer/config information to disk
- [x] **Cached credentials** - Partial: network config and COM are persisted and reused after restart; they stay valid while peers' config timestamps are within the 30-minute default window
- [x] **Graceful degradation** - Existing tunnels work, new connections fail without roots

### Redundancy
- [x] **Self-hosted controller** - Can run your own EmbeddedNetworkController (source-available license, `ZT_NONFREE=1` build)
- [x] **Controller redundancy** - Partial: each network has exactly one controller address, and clients have no failover. HA requires replicating `controller.d` to a standby or running instances that share a PostgreSQL backend (as ZeroTier Central does). Moons are roots, not controllers
- [x] **Relay redundancy** - 4 default roots plus optional moons; the TCP proxy is self-hostable
- [ ] **No single root of trust** - Controller holds signing keys for network (single point of trust)

### Efficiency
- [ ] **Delta/incremental updates** - The full network config is re-sent in signed chunks
- [x] **Long polling / push updates** - The controller pushes a new config to online members when their member record changes; nodes also re-request every 60 s
- [ ] **Configurable sync interval** - The 60-second refresh (ZT_NETWORK_AUTOCONF_DELAY) is a compile-time constant; `lowBandwidthMode` only stretches timers

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
- Validity is relative: peers compare COM timestamps within `credentialTimeMaxDelta` (default 30 minutes), and nodes fetch a fresh config every 60 seconds

**Network Types:**

- **Private Networks** - Require COMs signed by controller (default)
- **Public Networks** - No access control, anyone can join

**Additional Credentials:**

- **Capabilities** - Fine-grained access control permissions
- **Tags** - Numeric ID/value pairs for flow rule matching
- **Revocations** - Credential revocation lists
- **Certificates of Ownership** - IP/MAC ownership proofs

**SSO/OIDC Support:**

Client-side OIDC (the Rust `zeroidc` crate in rustybits, enabled via ZT_SSO_SUPPORTED) is built by default on x86-64, ARM64 and most other Linux targets, on macOS and on Windows. If a network requires SSO, the client exposes an authentication URL. `zerotier-cli` prints it, and the local service hosts the `/sso` callback. On the controller side, SSO data comes only from the PostgreSQL-backed controller databases (the file-based controller DB returns no SSO info). In practice OIDC therefore needs ZeroTier Central or a self-built `ZT_CONTROLLER=1` controller.

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Partial: there are no join keys in the stock client, but admins can pre-authorize node IDs via the controller API. The controller also has `authTokens` handling, which the client never uses (it never sends a token)
- [ ] **Certificate-based enrollment** - No CA/certificate enrollment; COMs are only issued after authorization
- [x] **OAuth/OIDC** - Partial: client support is built in by default; needs a PostgreSQL-backed controller (ZeroTier Central)
- [x] **Interactive login** - Partial: browser-based SSO login, only on SSO-enabled networks
- [x] **CLI authentication** - `zerotier-cli join <network>`; for SSO networks the CLI prints the authentication URL

### Authorization
- [x] **Admin approval workflow** - Manual device authorization by network admin
- [x] **Automated enrollment rules** - Partial: public networks auto-admit anyone. The controller's token-based auto-authorization cannot be reached from the stock client
- [ ] **Ephemeral nodes** - No automatic cleanup (manual deauthorization required)
- [x] **Node expiry** - Partial: only on SSO networks, where membership expires at the member's authenticationExpiryTime

### Identity
- [x] **Stable device identity** - Persistent cryptographic identity across restarts
- [x] **Identity portability** - Partial: `identity.secret`/`identity.public` can be copied to another machine; no export tooling
- [ ] **Multi-user support** - One identity per node, not per-user

# Platform Support

ZeroTier supports a wide range of platforms with varying implementation details.

**Supported Platforms:**

ZeroTier runs on Linux, macOS, Windows, FreeBSD, OpenBSD and NetBSD (make-*.mk and osdep/). The README points to official iOS and Android apps, but their code is not in this repository; `java/` contains an Android JNI wrapper. The core is written in C++ with platform-specific code in the osdep/ directory; Rust (rustybits) is used only for the OIDC client and controller helpers.

**Implementation Details:**

- **Linux**: TAP device (IFF_TAP|IFF_NO_PI; no multi-queue, no offloads); opt-in multicore mode
- **macOS**: Single-threaded, uses a feth (fake Ethernet) pair driven by a root helper (MacEthernetTapAgent) via BPF/ndrv; full tunnel mode support
- **Windows**: Single-threaded, uses custom NDIS TAP driver (TapDriver6), experimental ARM64 support (v1.12.0+)
- **BSD**: FreeBSD supports the multicore option; OpenBSD and NetBSD are single-threaded
- **iOS/Android**: Official apps (not in this repository)

**Multi-threading Limitations:**

Multicore mode (PacketMultiplexer and multiple TAP reader threads) is explicitly disabled on macOS, OpenBSD, NetBSD and Windows. Linux and FreeBSD can enable it via `multicoreEnabled` in local.conf (default off).

**Data Path:**

- All packet processing (crypto, rule filtering, switching, fragmentation) runs in the userspace `zerotier-one` service on every platform
- Kernel drivers (Linux/BSD tun/tap, Windows TapDriver6, macOS feth) only move Ethernet frames between the OS and the service
- No kernel-mode datapath

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support (opt-in multicore)
- [x] **macOS** - Full support (single-threaded)
- [x] **Windows** - Full support (single-threaded, ARM64 experimental)
- [x] **FreeBSD/OpenBSD** - FreeBSD (multicore option), OpenBSD and NetBSD

### Mobile
- [x] **iOS** - Official App Store app referenced by the README (code not in this repository)
- [x] **Android** - Official Google Play app referenced by the README; Android JNI wrapper in `java/`

### Implementation
- [ ] **Kernel-mode datapath** - All processing is in userspace; TapDriver6/tun-tap only move frames
- [x] **Userspace implementation** - Userspace service with kernel TAP/feth interfaces on every platform
- [x] **Container support** - Official Dockerfile.release image with entrypoint; Kubernetes-deployed controllers (cycle/update scripts)
