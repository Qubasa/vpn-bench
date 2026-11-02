# Overview

Hyprspace is a lightweight, decentralized mesh VPN built on top of libp2p (IPFS's networking layer). It creates encrypted peer-to-peer tunnels between nodes without requiring public IP addresses, using NAT hole-punching and relay services. Written in Go, it leverages libp2p for peer discovery, transport encryption, and connection establishment, creating TUN interfaces for IP-level packet routing. Tunnel packets are not sent as datagrams: each IP packet is written into a reliable, ordered libp2p stream (a QUIC stream or a yamux stream over TLS/TCP).

**Key Architecture Components:**
- **libp2p networking stack** (go-libp2p v0.42): Handles transport, encryption, peer discovery, and NAT traversal
- **TUN device interface**: Layer 3 (IP) virtual network interface created with `songgao/water` (one `read()`/`write()` syscall per packet, no offloads)
- **Custom VPN protocol**: `/hyprspace/0.0.1` application protocol for forwarding packets
- **Parallel peer routing**: PeX, the public IPFS Kademlia DHT (in client mode) and HTTP delegated routing are queried simultaneously to find peer addresses
- **Peer Exchange (PeX)**: Discovery via `/hyprspace/pex/0.0.1`, where already-connected VPN peers share the addresses they know for other VPN peers
- **Service network**: gVisor-based userspace TCP stack that terminates TCP for virtual-hosted services and proxies the byte stream over `/hyprspace/service/0.0.1`
- **Built-in DNS server**: Loopback DNS server for `<name>.hyprspace.` names with automatic systemd-resolved integration

# Protocol

Hyprspace uses libp2p's transport layer with a custom application protocol for VPN traffic. The control plane uses PeX, the public IPFS DHT and HTTP delegated routing to find peer addresses. Data plane traffic is sent over libp2p streams with a simple framing protocol (2-byte length prefix per packet).

**Control Plane:**
- Kademlia DHT queries against the public IPFS (Amino) DHT; the node runs the DHT in client mode (`dht.ModeClient`) and does not serve records
- HTTP delegated routing to `https://p2p.privatevoid.net` (hardcoded)
- Peer Exchange protocol shares known peer addresses between configured VPN peers
- Bootstrap nodes for initial network entry (hardcoded; can only be extended, via a local IPFS API set in `HYPRSPACE_IPFS_API`)
- Parallel routing: all sources are queried at once, addresses from all of them are merged, and the remaining queries are cancelled 500 ms after the first success (30 s overall timeout)

**Data Plane:**
- Packets are read from the TUN device by a single reader goroutine into a freshly allocated 1420-byte buffer
- Each packet is handed to a **new goroutine** (`go node.sendPacket(...)`), so concurrent packets to the same peer can be written in a different order than they were read
- Each packet is framed with a 2-byte little-endian length prefix; the prefix and the payload are two separate stream writes
- Forwarded over one long-lived libp2p stream per destination peer, cached in `activeStreams` (avoids opening a new stream per packet; the connection handshake happens once per libp2p connection anyway)
- The receiver runs one goroutine per inbound stream and writes each packet to the TUN device with one `write()` call
- Tunnel MTU is hardcoded to 1420 bytes (`tun.MTU(1420)`)
- Because the stream is reliable and ordered, a lost outer packet stalls all tunnelled flows to that peer until the retransmission arrives (head-of-line blocking), and inner TCP runs on top of QUIC or TCP congestion control (TCP-over-reliable-transport)

**Transports:** Only QUIC (`quic-v1` over UDP) and TCP are enabled. Hyprspace passes explicit `libp2p.Transport(...)` options, which replace libp2p's default transport set, so WebSocket, WebTransport and WebRTC are **not** available even though their libraries appear as indirect dependencies in `go.mod`. The default config listens on TCP and UDP port 8001 on IPv4 and IPv6. libp2p's dial ranker prefers QUIC and delays TCP dials by 250 ms on public addresses. On TCP, connections are secured with TLS 1.3 (or Noise) and multiplexed with yamux; QUIC provides its own TLS 1.3 encryption and native streams. Circuit relay v2 is available as an additional transport.

## Protocol Features Checklist

### Transport
- [ ] **UDP transport** - No plain UDP transport; only the QUIC and TCP transports are enabled, and UDP is used only underneath QUIC (`p2p/node.go:142-143`)
- [x] **TCP fallback** - libp2p TCP transport (TLS 1.3/Noise + yamux), direct or via circuit relay
- [x] **QUIC support** - Preferred transport via libp2p (`quic-v1`)
- [ ] **WebSocket support** - Not enabled; explicit transport list (QUIC + TCP only) replaces libp2p's default WS/WebTransport/WebRTC transports

### IP Support
- [x] **IPv4 support** - Each node gets a `100.64.x.y/32` built-in address; IPv4 subnet routes supported
- [x] **IPv6 support** - Each node gets an `fd00:6879:7072:7370:6163:6500::/96` built-in address; IPv6 subnet routes supported
- [x] **Dual-stack** - Both addresses are assigned to the same TUN interface at startup

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing via TUN device
- [ ] **Layer 2 (Ethernet) mode** - No TAP/Ethernet frame support
- [ ] **Bridging support** - No bridging capability for non-VPN devices

### Advanced
- [ ] **Multipath/bonding** - No path aggregation
- [ ] **QoS/traffic shaping** - No priority queues or traffic classes
- [ ] **Multicast support** - No multicast/broadcast support

# Encryption

Hyprspace relies entirely on libp2p's transport-layer encryption for security. It adds no VPN-layer encryption scheme of its own.

**Transport Encryption (via libp2p):**
- **QUIC** (preferred transport): always TLS 1.3 as part of the QUIC handshake (quic-go); Noise is not used on QUIC
- **TCP**: security protocol negotiated with multistream-select from libp2p's `DefaultSecurity`, which lists **TLS 1.3 first and Noise second**, so two Hyprspace nodes end up with TLS 1.3; Noise XX is only a fallback for peers that lack TLS
- libp2p TLS embeds the peer's libp2p public key in a self-signed certificate extension; peers are authenticated by peer ID, not by a CA

**TLS 1.3 Details (default):**
- Cipher suites: Go `crypto/tls` defaults (no override), so AES-128-GCM is chosen when both sides have AES hardware support, otherwise ChaCha20-Poly1305; AES-256-GCM is also offered
- Key exchange: ephemeral ECDHE, X25519 preferred
- No post-quantum hybrid: the toolchain is Go 1.24, but `go.mod` declares `go 1.23.8`, which makes the `tlsmlkem=0` GODEBUG default apply and disables X25519MLKEM768

**Noise Details (offered on TCP, never chosen between Hyprspace nodes):**
- `Noise_XX_25519_ChaChaPoly_SHA256`: X25519, ChaCha20-Poly1305, SHA-256 (no BLAKE2s)
- Pattern: XX (mutual authentication, both parties send static keys)

**Identity & Keys:**
- Ed25519 key pairs for node identity, generated by `hyprspace init`
- Private key stored in the JSON config as a base58btc multibase string
- Peer IDs are an identity multihash of the Ed25519 public key (`12D3KooW...`), so the public key is embedded in the peer ID rather than hashed
- Private-network PSK via `HYPRSPACE_SWARM_KEY` is wired up but **does not work**: go-libp2p's QUIC transport refuses to start with a PSK ("QUIC doesn't support private networks yet"), and Hyprspace always enables QUIC, so node creation fails

**Security Properties:**
- Transport-level encryption only (no application-layer encryption)
- No separate VPN-layer replay protection; QUIC packet-number duplicate detection and TLS record sequence numbers over ordered TCP provide it
- Perfect Forward Secrecy from ephemeral (EC)DHE in TLS 1.3 and in Noise XX
- Key rotation only on QUIC: quic-go initiates a 1-RTT key update after the first 100 packets and then every 100,000 packets; Go's TLS-over-TCP and libp2p Noise never re-key during a connection
- End-to-end through relays: relayed connections are upgraded with TLS/Noise between the two endpoints, so the relay only forwards ciphertext

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - X25519 ECDHE in TLS 1.3 (and in Noise XX when negotiated)
- [x] **Perfect Forward Secrecy** - Ephemeral keys in TLS 1.3 / Noise handshakes
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange (`go 1.23.8` in go.mod → `tlsmlkem=0`)
- [x] **Key rotation** - Partial: automatic QUIC key updates (quic-go); none on TLS-over-TCP or Noise

### Symmetric Encryption
- [x] **Authenticated encryption** - TLS 1.3 AEAD (AES-GCM or ChaCha20-Poly1305); ChaCha20-Poly1305 under Noise
- [x] **Hardware-accelerated crypto** - Go's AES-GCM uses AES-NI/PCLMULQDQ (x86) and ARMv8 crypto extensions; chosen by default when hardware support exists
- [x] **Constant-time operations** - Go standard-library crypto

### Protocol Security
- [x] **Replay protection** - QUIC packet numbers / TLS record sequence numbers (transport layer, not VPN-layer)
- [ ] **Noise Protocol or equivalent** - Never negotiated between Hyprspace nodes: QUIC always uses TLS 1.3, and on TCP both sides offer `/tls/1.0.0` first, so Noise XX is never picked (`p2p/node.go:138`, go-libp2p v0.42.0 `defaults.go:30-32`)
- [x] **No cleartext metadata** - TLS 1.3 encrypts the certificates that carry peer IDs; only libp2p protocol names (multistream `/tls/1.0.0`, ALPN `libp2p`) are visible. Peer IDs are, however, published to and looked up in the public IPFS DHT

# Performance

Hyprspace uses Go's goroutine-based concurrency model but has significant performance limitations compared to optimized VPN implementations. Most of its I/O optimizations come from quic-go on the UDP side; the TUN side is completely unoptimized.

**Threading Model:**
- **Multi-goroutine architecture**: Separate goroutines for TUN reading, stream handling, discovery, PeX, route metrics, DNS, RPC and AutoRelay
- **Single TUN reader**: Only one goroutine reads from the TUN device, one packet per `read()` syscall
- **Goroutine per outgoing packet**: The TUN reader spawns `go node.sendPacket(...)` for every packet. Writes to the same peer are serialised by a per-peer `sync.Mutex`, but the goroutines acquire it in arbitrary order, so Hyprspace itself can reorder packets of one flow
- **Per-stream handlers**: Each incoming stream is handled by its own goroutine, which reads frames and writes them to the TUN device one packet per syscall
- **Crypto per connection**: QUIC encryption and decryption run in quic-go's per-connection run loop, and TLS-over-TCP encryption runs in yamux's per-session send loop, so one peer's tunnel uses roughly one core for crypto; different peers can use different cores
- **Synchronization**: The `activeStreams` map is read and written from the per-packet goroutines **without a lock** (only the stream itself is locked), which is a data race that can abort the process with Go's "concurrent map read and map write" error

**Performance Characteristics:**
- **No TUN batching or offloads**: `songgao/water` performs one `read()`/`write()` syscall per packet with no `IFF_VNET_HDR`, GSO/GRO or multi-queue. (`BatchSize()=1` in `netstack/tun.go` belongs only to the service-network gVisor device.)
- **UDP side via quic-go**: `recvmmsg` batches of 8 packets on Linux, UDP GSO (`UDP_SEGMENT`) for sends when the kernel supports it, no UDP GRO, `sync.Pool` packet buffers
- **Socket buffers**: quic-go requests 7 MiB `SO_RCVBUF`/`SO_SNDBUF` and falls back to `SO_RCVBUFFORCE`/`SO_SNDBUFFORCE` (which succeeds because Hyprspace runs as root). The TCP transport uses OS defaults
- **Flow-control windows**: libp2p's QUIC config allows 10 MiB per stream and 15 MiB per connection; all traffic to one peer shares a single stream
- **Per-packet allocation**: New `make([]byte, 1420)` for each TUN read (required because the buffer is handed to a goroutine) plus `binary.Write` for the length prefix
- **Two writes per packet**: The length prefix and payload are written separately, producing two yamux frames (and TLS records) per packet on TCP
- **Reliable stream transport**: Inner packets ride a reliable ordered stream, which hides outer reordering from inner TCP but adds head-of-line blocking and a second congestion controller under loss
- **Long write timeout**: 25-second write deadline delays failure detection

**Performance Under Loss/Reordering:**
Under the old sender-side Medium profile (2.5% reordering and 1% loss per direction, 5% and 2% combined), Hyprspace performs significantly worse than optimized mesh VPNs like Tailscale. The likely causes are in the source rather than in syscall batching: every outer loss stalls the single per-peer stream (head-of-line blocking) while QUIC or TCP retransmits, inner TCP sees that stall as latency spikes, and the TUN path has no batching or offloads.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Partial: goroutines spread over cores, but crypto for one peer is serialised in one QUIC/yamux connection loop
- [ ] **Per-core packet queues** - Single TUN reader, one goroutine per packet, no per-peer or per-core queues

### Packet I/O
- [x] **Batch UDP receives** - QUIC is the default transport, and on Linux quic-go reads with `recvmmsg` (batches of 8) (`p2p/node.go:142`, quic-go v0.52.0 `sys_conn_helper_linux.go:24`); TUN reads are single-packet
- [ ] **Batch UDP sends** - No `sendmmsg`; quic-go uses GSO instead
- [ ] **Large batch sizes** - quic-go receive batch is 8; TUN batch is 1

### UDP Offload
- [x] **UDP GSO (Generic Segmentation Offload)** - quic-go `UDP_SEGMENT` on Linux (QUIC transport only)
- [ ] **UDP GRO (Generic Receive Offload)** - Not enabled by quic-go

### Buffer Management
- [x] **Buffer pool reuse** - Partial: quic-go pools UDP packet buffers; Hyprspace allocates a new buffer per TUN packet
- [x] **Large UDP socket buffers** - quic-go requests 7 MiB receive/send buffers (forced as root); TCP transport uses OS defaults

### Userspace TCP Stack (optional)
- [x] **Userspace TCP implementation** - gVisor TCP stack used **only** for the in-VPN service-network feature (`svc/network.go`, `netstack/tun.go`). Regular tunnel traffic uses the host kernel's TCP stack on both ends: packets traverse a kernel TUN device (`tun/tun_linux.go`, `songgao/water`) and the forwarding loop in `node/node.go` only diverts an IPv6 packet into gVisor when its destination falls inside the `fd00:6879:7072:7370:7376::/80` (`fd00:hyprspsv::/80`) service prefix and the L4 protocol is TCP. gVisor terminates the TCP connection **locally**, and the byte stream is then proxied over a libp2p stream to the remote node, which dials the real service with kernel TCP. The gVisor stack therefore only ever sees the local, lossless TUN hop, never the WAN path.
- [ ] **Large TCP RX/TX buffers** - No custom buffer configuration; inherits gVisor's stock 1 MiB defaults / 4 MiB max with receive-buffer moderation on. Only affects the local service-network hop.
- [ ] **Tuned congestion control** - No congestion control override; gVisor default Reno. Only affects the local service-network hop.
- [ ] **Reordering tolerance** - Hyprspace only enables SACK (off by default in the pinned gVisor); loss detection stays at gVisor's default RACK. Since the gVisor hop is local, WAN reordering never reaches it; ordinary tunnel flows are governed by the host kernel's TCP settings.

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No coalescing
- [ ] **RX checksum offload** - Not utilized

### MTU Handling
- [x] **Conservative MTU** - Fixed 1420 byte MTU (`tun.MTU(1420)`); buffers are also sized at 1420
- [x] **Path MTU discovery** - Partial: tunnel MTU is fixed; quic-go runs DPLPMTUD for the outer QUIC packets, and because tunnel packets are carried as stream bytes they never need outer fragmentation

### Peer Management
- [x] **Lazy peer removal** - Cached streams are only dropped from `activeStreams` after a write fails
- [x] **Endpoint caching** - Partial: libp2p in-memory peerstore keeps addresses and the established connection is reused; nothing is persisted across restarts
- [x] **Efficient keepalive timers** - libp2p QUIC keepalive (15 s) and TCP keepalives; no Hyprspace-level keepalive traffic

### Packet Processing
- [ ] **Zero-allocation parsing** - New buffer, goroutine and `binary.Write` allocation per packet
- [ ] **Zero-copy filtering** - Packets copied through buffers

### State Synchronization
- [ ] **Delta updates** - No incremental state updates documented
- [ ] **Compression** - No control plane compression

### Data Plane Compression
- [ ] **Tunnel compression** - No packet compression
- [ ] **Configurable compression level** - No data-plane compression, so there is nothing to configure

# Security

Hyprspace has not been formally audited and the project README explicitly warns against using it in high-security environments. No public CVEs or severe security flaws have been disclosed, but the analysis identified several security concerns.

**Security Concerns Identified:**

1. **Weak IP address derivation**: Built-in addresses are XOR-folds of the peer ID bytes: 16 bits for IPv4 (`100.64.x.y`) and a 32-bit node ID for IPv6, so collisions are likely in larger networks (acknowledged as a known issue in the docs)
2. **Service ID collisions**: 16-bit service IDs (XOR of name bytes) easily collide
3. **Remote crash by a trusted peer**: The receive loop reads a 16-bit length and copies into a 1420-byte buffer without checking it, so a frame with length > 1420 panics with "slice bounds out of range". libp2p does not recover panics in stream handlers, so the whole daemon exits. The 2-byte length prefix is also read with a single `Read()` that may return only one byte, which desynchronises framing
4. **Unsynchronised `activeStreams` map**: Read and written from one goroutine per outgoing packet without a lock; Go aborts the process on detected concurrent map writes
5. **No source-address validation**: Packets received from a trusted peer are written to the TUN device without checking that their source IP belongs to that peer's built-in address or routes, so any trusted peer can spoof other peers' tunnel IPs
6. **Unlimited relay service**: Every node runs a circuit relay v2 service with `relay.WithLimit(nil)` (no duration or data cap). Reservations are restricted to configured peers, but `AllowConnect` accepts a circuit if *either* the source *or* the destination is a configured peer, so third parties can relay unlimited traffic through a node to its peers
7. **Hardcoded bootstrap nodes and delegated-routing URL**: Not configurable (bootstrap list can only be extended via a local IPFS API); privatevoid.net servers are a soft dependency
8. **Metadata exposure to the public IPFS network**: Nodes join the public IPFS DHT and query it (and `p2p.privatevoid.net`) for their peers' IDs, which reveals VPN membership relationships to DHT participants
9. **No certificate pinning**: Delegated routing uses plain WebPKI HTTPS
10. **Panic on errors**: `NewRecursionGater` panics if the interface lookup fails; the service network panics on listener or TUN write errors
11. **Swarm-key private networks broken**: Setting `HYPRSPACE_SWARM_KEY` makes node creation fail, because libp2p's QUIC transport rejects PSKs
12. **No VPN-layer replay protection**: Only transport-layer (QUIC/TLS) protection

**Project Status:** Originally created by Alec Scott, archived on Feb 24, 2024. Forked and maintained by Max Headroom (@max-privatevoid) since September 2022 with active development continuing.

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - Inherited from libp2p's default resource manager: per-IP/subnet new-connection rate limits (e.g. 0.2 conn/s per IPv4 /32 with burst), per-subnet connection caps, QUIC source-address verification; connection manager trims at 160/192 connections
- [ ] **Stateful packet filter** - No connection tracking for ACLs
- [ ] **Fine-grained ACLs** - Binary trust model only (peer trusted or not); no per-port/protocol rules on tunnel traffic
- [ ] **Capability-based access** - No advanced access control

### Identity & Authentication
- [x] **Identity validation** - Cryptographic verification via libp2p peer IDs
- [ ] **Signed configuration updates** - No cryptographic config verification
- [ ] **Certificate pinning** - N/A: there is no controller; the delegated-routing endpoint is only a lookup service (`p2p/node.go:261-262`)

### Implementation
- [x] **Memory-safe language** - Written in Go with garbage collection
- [ ] **Privilege separation** - Runs as root for TUN/netlink setup and never drops privileges (NixOS unit runs as root, `Group = "wheel"`)
- [ ] **Sandboxing** - No process isolation; the NixOS unit sets no systemd hardening options
- [x] **Audit logging** - Partial: at the default `info` level only a trusted peer asking for an unknown service is logged; untrusted service attempts are logged at debug, and rejected VPN/PeX streams are reset silently (`cli/up.go:37-38`, `svc/receiver.go:13,33`, `node/node.go:291-293`)

# NAT Traversal

Hyprspace leverages libp2p's NAT traversal stack, enabling direct peer-to-peer connections behind most cone NATs and falling back to relays elsewhere.

**NAT Traversal Methods:**
1. **NAT Port Mapping**: `libp2p.NATPortMap()` uses UPnP IGDv1/IGDv2 and NAT-PMP (no PCP)
2. **Address discovery**: libp2p identify collects "observed addresses" reported by connected peers (an address is used after 4 observers); AutoNAT v1 dial-backs determine public/private reachability. Every node also serves AutoNAT to others (`EnableNATService`)
3. **Hole Punching (DCUtR)**: `EnableHolePunching()` coordinates simultaneous QUIC/UDP and TCP dials over an existing relayed connection (up to 3 attempts). There is no port prediction, so peers behind symmetric NATs usually stay relayed
4. **Circuit Relay v2**: Relay fallback; the relayed connection is encrypted end to end with TLS/Noise. Every Hyprspace node also acts as an unlimited relay (`relay.WithLimit(nil)`) for its configured peers
5. **AutoRelay**: Keeps reservations with 2 relays (10-second boot delay). Candidates are fed from all currently connected peers (including public IPFS nodes) and chosen at **random** by libp2p; public IPFS relays impose the default 2 min / 128 KiB per-connection limits, so in practice only other Hyprspace peers can carry tunnel traffic

**Double NAT Support:**
Supported via relay fallback. When direct connection or hole punching fails, circuit relay provides end-to-end encrypted connectivity through an intermediate peer. There is no STUN: the pion/stun and WebRTC libraries in `go.mod` are indirect dependencies of libp2p's WebRTC transport, which Hyprspace does not enable.

**Discovery Process:**
- Hardcoded bootstrap nodes for initial DHT entry
- Discovery loop that dials unconnected configured peers: starts at 1 s and doubles up to 1 min while connected, retries every 10 s (with DHT re-bootstrap) when not connected to any peer
- Parallel routing queries across PeX, DHT and HTTP delegated routing

## NAT Traversal Checklist

### Discovery
- [x] **No own public node needed** - Hardcoded bootstrap nodes (privatevoid.net, `bootstrap.libp2p.io`), public IPFS DHT and delegated routing find peers; AutoRelay on public peers plus DCUtR hole punching connect NATed nodes (`p2p/node.go:140-202,261-262`)
- [x] **STUN support** - No STUN; server reflection via libp2p identify observed addresses plus AutoNAT v1 dial-back
- [x] **Multiple STUN servers** - Observations from any connected peer (4 needed to activate an address); no dedicated servers
- [x] **NAT type detection** - Partial: libp2p's observed-address manager classifies TCP/UDP NAT as cone or symmetric, but Hyprspace does not use the result

### Port Mapping
- [x] **UPnP port mapping** - Via `libp2p.NATPortMap()` (UPnP IGDv1/v2)
- [x] **NAT-PMP support** - Included in libp2p NAT port mapping
- [ ] **PCP support** - libp2p's NAT package only implements UPnP and NAT-PMP

### Hole Punching
- [x] **UDP hole punching** - DCUtR via `libp2p.EnableHolePunching()` (QUIC/UDP and TCP simultaneous open)
- [ ] **Symmetric NAT handling** - No port prediction or birthday-style probing
- [x] **Rendezvous coordination** - Relay connection carries the DCUtR synchronisation; relays are other Hyprspace peers or public libp2p relays

### Fallback
- [x] **Relay fallback** - Circuit Relay v2, end-to-end encrypted
- [x] **Multiple relay regions** - Partial: 2 concurrent reservations on arbitrary peers; no notion of regions
- [ ] **Automatic relay selection** - AutoRelay shuffles candidates randomly (no latency-based choice)
- [x] **TCP relay support** - libp2p relay works over TCP and QUIC

# Local Routing

Hyprspace has no dedicated LAN logic; it relies on libp2p's address exchange and dial ranking, and it prevents routing loops through the VPN interface itself.

**LAN Discovery:**
There is no mDNS or broadcast discovery (libp2p's mDNS service must be set up explicitly and Hyprspace does not do so). Local addresses are learned through libp2p identify, which advertises all listen addresses including private LAN ones, and through the Peer Exchange (PeX) protocol, which passes on every address a connected VPN peer has stored for other VPN peers.

**Direct Path Priority:**
Parallel routing queries PeX, the DHT and HTTP delegated routing simultaneously (30-second timeout) and merges all addresses found within 500 ms of the first answer. libp2p's dial ranker then dials private (RFC 1918/local) addresses after 30 ms and public addresses after 250 ms (relay addresses another 500 ms later), so a LAN address usually wins when the connection is first established. An existing connection is not migrated to a better path later, except for relay-to-direct upgrades through hole punching.

**Recursion Prevention:**
The `RecursionGater` intercepts outgoing dials to IPv4 addresses that Hyprspace itself routes to the same peer, and blocks them when the kernel route for that address points at the VPN interface (link index comparison). IPv6 dial addresses are not checked.

**Traffic Routing:**
When peers are on the same LAN and connected via a LAN address, packets travel directly over the local network through libp2p connections. The encryption and VPN protocol still apply.

**Routes:**
Each node lists, in its own config, which subnets are reachable via which peer (`peers[].routes`); routes are not advertised by the remote peer. Routes can also be added or removed at runtime via `hyprspace route`. Kernel routes are installed with metric 3000, and the remote peer must enable IP forwarding/NAT itself. When several entries match, Hyprspace prints a duplicate warning and uses the first.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No mDNS/broadcast discovery enabled
- [x] **Direct path advertisement** - libp2p identify advertises listen addresses (incl. LAN); PeX relays addresses between VPN peers
- [x] **Same-subnet detection** - Partial: the dial ranker distinguishes private from public addresses, but there is no same-subnet check

### LAN Optimization
- [x] **Automatic LAN preference** - Partial: private addresses are dialed first (30 ms vs 250 ms) at connection setup; no later path migration
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [ ] **LAN-only mode** - No restriction to local network only

### Routing Features
- [x] **Subnet routes** - Locally configured `routes` map subnets to a peer; peer forwards with kernel IP forwarding
- [x] **Full tunnel mode** - Partial: a `0.0.0.0/0` route via a peer is possible, but there is no exit-node support (metric 3000 loses to an existing default route, no bypass route for the underlay, NAT on the exit is manual)
- [x] **Split tunneling** - Only configured prefixes are routed into the tunnel
- [ ] **Route priorities** - No priority/HA route selection; overlapping routes use the first match

# Central Point of Failure

Hyprspace is mostly decentralized with peer-to-peer connections, but relies on several centralized components for initial discovery and degraded-mode operation.

**Centralized Dependencies:**

1. **Bootstrap Nodes**: 20 hardcoded multiaddresses: 14 for 6 peer IDs on 4 privatevoid-operated hosts (TCP and QUIC) plus 6 `/dnsaddr/bootstrap.libp2p.io` entries
   - Required for initial DHT entry
   - Not configurable; the list can only be extended from a local IPFS (Kubo) API via `HYPRSPACE_IPFS_API`
   - If all bootstrap nodes fail, nodes that cannot reach a peer via PeX or delegated routing cannot find each other
   - Existing connections unaffected

2. **HTTP Delegated Routing**: Single hardcoded endpoint at `https://p2p.privatevoid.net`
   - Queried in parallel with DHT and PeX
   - Failure degrades discovery but DHT and PeX compensate
   - Not critical for operation

**Failure Scenarios:**
- **Bootstrap down**: Slows initial connection, but PeX and delegated routing still work once one peer is reachable
- **DHT unavailable**: PeX and HTTP delegated routing provide redundancy
- **All infrastructure down**: Pre-established connections continue working; peer addresses are only kept in memory, so a restarted node needs some discovery source (or a LAN/direct address learned through PeX from an already-connected peer)

**Controller Model:**
No central controller exists. Configuration is stored locally in JSON files, and private keys are managed locally. Nodes authenticate via peer IDs listed in each other's configuration files.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Established tunnels stay up without infrastructure
- [x] **Local state caching** - Partial: peer IDs and routes are in the local config, but peer addresses live only in libp2p's in-memory peerstore and are not persisted
- [x] **Cached credentials** - Private keys and peer IDs stored locally
- [x] **Graceful degradation** - PeX and delegated routing work when DHT/bootstrap unavailable

### Redundancy
- [ ] **Self-hosted controller** - N/A (no controller); bootstrap list and delegated-routing URL are hardcoded, so discovery infrastructure cannot be fully replaced without patching
- [ ] **Controller redundancy** - N/A (no controller)
- [x] **Relay redundancy** - AutoRelay keeps 2 reservations; every Hyprspace peer runs a relay service
- [x] **No single root of trust** - Distributed trust via peer ID authentication

### Efficiency
- [ ] **Delta/incremental updates** - No documented incremental updates
- [ ] **Long polling / push updates** - No controller for updates
- [ ] **Configurable sync interval** - N/A (no centralized sync)

# Authentication

Hyprspace uses cryptographic peer IDs derived from Ed25519 key pairs for node identity and authentication. There is no centralized authentication server or PKI infrastructure.

**Enrollment Process:**

1. **Key Generation**: `hyprspace init` generates an Ed25519 key pair and a default config (listen on TCP/UDP 8001)
2. **Peer ID Derivation**: Peer ID is an identity multihash of the public key (format: `12D3KooW...`)
3. **Manual Configuration**: Peer IDs (and optional names/routes) manually added to each node's configuration file
4. **Mutual Trust**: Both peers must list each other's peer IDs in their configs (each side only accepts VPN, PeX and service streams from listed peers)

**Authorization:**
- Binary trust model: peers either in trusted list or rejected
- The VPN, PeX and service stream handlers reset streams from peer IDs that are not configured
- Relay ACL: reservations only for configured peers; relayed circuits are allowed when either endpoint is a configured peer
- No automatic enrollment, admin approval, or time-limited access

**Authentication Flow:**
1. libp2p establishes transport connection with a TLS 1.3 handshake (QUIC, or TCP with Noise as fallback)
2. Peer identity cryptographically verified via public key
3. Application layer checks if peer ID exists in trusted peers list
4. Stream accepted if authorized, otherwise stream reset (the libp2p connection itself is not rejected, because the node also talks to public IPFS peers)

## Authentication Checklist

### Enrollment Methods
- [ ] **Pre-authentication keys** - No enrollment keys; peers are trusted by statically listing peer IDs
- [ ] **Certificate-based enrollment** - No CA/certificates; self-signed libp2p TLS certificates only carry the peer key
- [ ] **OAuth/OIDC** - No SSO integration
- [ ] **Interactive login** - No browser-based auth
- [ ] **CLI authentication** - Manual config editing only (`hyprspace init` just generates a key)

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

Hyprspace currently works on Linux only. The repository still contains macOS and Windows TUN code, but at this revision it does not compile for those platforms, and there is no mobile client.

**Supported Platforms:**

- **Linux**: Supported via native TUN device (`tun_linux.go`, netlink for addresses/routes); the only platform built in CI
- **macOS**: `tun_darwin.go` exists (utun via `ifconfig`), but it lacks the `addRoute`/`delRoute` methods that `tun/options.go` calls, so the package does not build for darwin; Linux-only netlink is also used by `NewRecursionGater` (panics on failure) and the DNS server. `package.nix` and the flake still list darwin
- **Windows**: `tun_windows.go` (TAP-Windows `tap0901` driver via water, `netsh` configuration) has the same missing `addRoute`/`delRoute` methods, so it does not build either
- **FreeBSD/OpenBSD**: No platform code

**Implementation Details:**

- **Userspace datapath**: All packet processing in userspace via TUN device
- **TUN library**: `songgao/water` for the real interface; `golang.zx2c4.com/wireguard/tun` is only used as the interface type of the gVisor service-network device (copied from wireguard-go `tun/netstack`)
- **Network stack**: gVisor userspace TCP/IP stack for service network feature
- **Packaging**: Nix package and NixOS module (`services.hyprspace`); no official container image or Kubernetes integration
- **Privilege requirements**: Requires root for TUN creation, netlink route changes and the RPC socket in `/run`

**Mobile Platforms:**
No iOS or Android clients exist. The codebase is Go-based which could theoretically support mobile platforms, but no mobile-specific implementations are present.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Native TUN + netlink
- [ ] **macOS** - Code present but does not build (missing `addRoute`/`delRoute`; Linux-only netlink use)
- [ ] **Windows** - Code present but does not build (missing `addRoute`/`delRoute`)
- [ ] **FreeBSD/OpenBSD** - No platform code

### Mobile
- [ ] **iOS** - No mobile app
- [ ] **Android** - No mobile app

### Implementation
- [ ] **Kernel-mode datapath** - No kernel datapath
- [x] **Userspace implementation** - Fully userspace via TUN/libp2p
- [ ] **Container support** - No official image or k8s integration (running in a container needs `NET_ADMIN` and `/dev/net/tun`)
