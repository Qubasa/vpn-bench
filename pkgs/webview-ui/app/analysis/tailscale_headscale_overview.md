# Overview

**Tailscale** is a mesh VPN solution consisting of two main components:

1. **Tailscale Client** (tailscaled): The open-source VPN client daemon written in Go that runs on end-user devices. It handles WireGuard-based peer-to-peer networking, NAT traversal, packet processing, and encryption. The client can work with any TS2021-compatible control plane.

2. **Control Plane**: Coordinates the mesh network by managing node registration, key distribution, policy enforcement, and endpoint coordination. Two implementations exist:
   - **Tailscale Control Server** (commercial/cloud): The official commercial control plane operated by Tailscale Inc. Provides additional enterprise features, web dashboard, and managed infrastructure.
   - **Headscale** (open-source/self-hosted): An open-source, self-hosted implementation of the Tailscale control server. Allows users to operate their own control plane while using the Tailscale client.

**Key Architecture Components:**

**Tailscale Client:**
- **tailscaled** (cmd/tailscaled/tailscaled.go): Main client daemon running continuously on the system
- **WireGuard Engine** (wgengine/userspace.go): Manages WireGuard interface via wireguard-go userspace implementation, routing, DNS, and peer configuration
- **MagicSock** (wgengine/magicsock/magicsock.go): UDP socket that actively manages endpoints and performs NAT traversal
- **Control Client** (control/controlclient/client.go): Maintains communication with the control server
- **Local Backend** (ipn/ipnlocal/local.go): Orchestrates all components and handles state management
- **Netstack (gVisor)** (wgengine/netstack/netstack.go): Userspace TCP/IP stack with tuned TCP settings. In the default Linux TUN mode it only terminates Tailscale-local services (peerAPI/Taildrop, Tailscale SSH, Serve, MagicDNS at 100.100.100.100, 4via6). It carries all tunneled traffic only with `--tun=userspace-networking`, plus subnet and exit-node traffic on Windows, macOS (tailscaled), FreeBSD, OpenBSD and Synology

**Headscale Control Server:**
- **Control Plane Server** (hscontrol/app.go): Main HTTP/gRPC server handling node registration and coordination
- **State Management** (hscontrol/state/state.go): Central coordinator for database, policy, IP allocation, DERP
- **NodeStore** (hscontrol/state/node_store.go): In-memory cache with copy-on-write semantics for performance
- **Policy Manager** (hscontrol/policy/v2/policy.go): ACL evaluation and enforcement
- **Mapper** (hscontrol/mapper/mapper.go): Converts internal state to Tailscale protocol format

**Important Distinction:** Headscale is **control plane only**. VPN data traffic flows directly between Tailscale clients using WireGuard. The one exception is Headscale's optional embedded DERP server: when it is enabled, relayed traffic (still WireGuard-encrypted) passes through the Headscale process. Headscale handles registration, authentication, key distribution, and policy management.

# Protocol

The Tailscale ecosystem uses two distinct protocol layers:

**Control Plane (Tailscale Client ↔ Control Server):**

The **TS2021 protocol** (Noise-based encryption) secures communication between clients and control servers (both Tailscale and Headscale):

- **Transport**: HTTP/1.1 `Upgrade: tailscale-control-protocol` on the `/ts2021` endpoint. Only browser (js/wasm) clients use a WebSocket upgrade instead
- **Encryption**: Noise Protocol Framework (IK pattern) with Curve25519, ChaCha20-Poly1305, and BLAKE2s
- **Message Framing**: Maximum 4096 bytes per frame with 3-byte header
- **HTTP/2 over Noise**: After handshake, HTTP/2 is served over the encrypted Noise connection

**Communication Flow:**
1. Client fetches the server's Noise public key from `/key`, then opens an HTTP Upgrade connection to `/ts2021`
2. Noise handshake establishes the encrypted channel. The server's early payload carries a per-connection NodeKeyChallenge
3. HTTP/2 runs over Noise connection
4. Client sends MapRequest via long-polling to `/machine/map`
5. Server responds with MapResponse containing network configuration
6. Keep-alive interval: 50 seconds plus 0–9 s random jitter (Headscale; hardcoded, not configurable)

**MapRequest/MapResponse Protocol:**
- **MapRequest**: Contains node endpoints, hostinfo, capabilities, network information (NAT type, available endpoints), TKA (Tailscale Key Authority) head hash
- **MapResponse**: Contains peer list, DERP map, DNS configuration, packet filters, ACL rules
- **Delta Updates**: Only changed peers sent (PeersChanged/PeersRemoved fields)
- **Compression**: Optional Zstd compression for large responses

**Data Plane (Peer-to-Peer Traffic):**

All actual VPN traffic uses **WireGuard** protocol:

- **Primary Transport**: UDP. The kernel picks the port unless `--port`/`PORT` is set (the shipped systemd defaults file and Windows use 41641)
- **WireGuard Implementation**: wireguard-go (userspace implementation in Go)
- **Encryption**: ChaCha20-Poly1305 (WireGuard standard)
- **Key Exchange**: Curve25519 (WireGuard standard)
- **TCP Fallback**: Not supported natively by WireGuard
- **DERP Relay Fallback**: When direct UDP fails, encrypted WireGuard packets are relayed over DERP
  - DERP runs over HTTP(S)/TCP (HTTP Upgrade, normally TLS on port 443). WebSocket is used only by browser (js/wasm) clients or with the `TS_DEBUG_DERP_WS_CLIENT` debug knob
  - DERP relay is encrypted (WireGuard packets remain encrypted inside DERP tunnel)

**Protocol Support:**
- **UDP**: Primary transport for WireGuard tunnels
- **TCP**: Via DERP relay servers (WireGuard packets encapsulated in TCP)
- **WebSocket**: DERP servers accept WebSocket, but native clients use plain HTTP Upgrade; only browser (js/wasm) clients use WebSocket
- **IPv4**: Full support for both control and data plane
- **IPv6**: Full support for both control and data plane

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary WireGuard transport protocol
- [x] **TCP fallback** - Works through restrictive firewalls via DERP relay over TCP
- [ ] **QUIC support** - No QUIC transport in DERP (not implemented in codebase)
- [x] **WebSocket support** - Partial: DERP servers (including Headscale's embedded DERP) accept WebSocket, but only browser (js/wasm) clients use it. Native clients need the `TS_DEBUG_DERP_WS_CLIENT` debug knob

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support
- [x] **IPv6 support** - Native IPv6 tunneling supported
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6 operation

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing only (WireGuard operates at Layer 3)
- [ ] **Layer 2 (Ethernet) mode** - No Ethernet frame tunneling. The experimental Linux `--tun=tap:` mode only answers ARP/DHCP locally and still forwards IP packets to peers
- [ ] **Bridging support** - Cannot bridge non-VPN devices onto network

### Advanced
- [ ] **Multipath/bonding** - No aggregation of multiple network paths (single best path selected)
- [ ] **QoS/traffic shaping** - No priority queues or traffic class support
- [ ] **Multicast support** - No virtual multicast/broadcast (Layer 3 only)

# Encryption

**Control Plane Encryption (TS2021 Protocol):**

The Noise Protocol Framework secures all communication between Tailscale clients and control servers:

- **Protocol**: Noise IK (Interactive Handshake) pattern
- **Key Exchange**: Curve25519 (X25519 ECDH)
- **Symmetric Encryption**: ChaCha20-Poly1305 (authenticated encryption)
- **Hash Function**: BLAKE2s
- **Perfect Forward Secrecy**: Yes, via Noise protocol ephemeral keys
- **Early Payload**: Before HTTP/2 starts, the server sends a per-connection NodeKeyChallenge, which the client uses to prove possession of its node key. Server authenticity comes from the IK pattern itself: the client must already know the server's static key
- **Handshake Hash**: Binds subsequent messages to connection (prevents replay attacks)

**Key Types:**

1. **MachineKey** (Curve25519):
   - Long-term machine identity key
   - Persisted to disk with `privkey:` prefix
   - Used for control plane authentication
   - Never sent to peers (only to control server)
   - Constant-time comparison to prevent timing attacks

2. **NodeKey** (Curve25519):
   - Key for WireGuard tunnels, persisted to disk (not ephemeral/per-session)
   - Distributed to peers via control server
   - Rotated on re-authentication (`tailscale up --force-reauth`, interactive login) or node-key expiry; the MachineKey stays the same
   - Used for peer-to-peer WireGuard encryption

3. **DiscoKey** (Curve25519):
   - Discovery/endpoint probing key
   - Used for NAT traversal and endpoint discovery
   - Published to peers for "Call-Me-Maybe" protocol
   - Regenerated at every tailscaled start; sent in cleartext in the header of every disco packet

**Data Plane Encryption (WireGuard):**

All peer-to-peer traffic encrypted by WireGuard:

- **Protocol**: WireGuard (Noise_IKpsk2 pattern)
- **Key Exchange**: Curve25519
- **Symmetric Encryption**: ChaCha20-Poly1305
- **Key Distribution**: Control server distributes peer public keys in MapResponse
- **Perfect Forward Secrecy**: Yes, WireGuard rotates keys every ~2 minutes
- **Replay Protection**: 64-bit counter prevents replay attacks
- **Per-Peer Configuration**: Each peer has separate WireGuard tunnel with independent keys

**Key Rotation:**

- **WireGuard Automatic Rotation**: Keys automatically rotated by WireGuard protocol (~2 minutes)
- **NodeKey Manual Rotation**: NodeKey can be manually rotated via client commands
- **MachineKey Rotation**: Requires re-registration (not automatic)
- **No Auto-Rotation Without Re-Login**: Node-key expiry forces re-authentication, which creates a new NodeKey; nothing rotates NodeKeys automatically in between

**Hardware Acceleration:**

- **AES-NI**: Not used (WireGuard is fixed to ChaCha20-Poly1305)
- **ChaCha20 Optimization**: golang.org/x/crypto ships assembly ChaCha20-Poly1305 for amd64 (SSSE3/AVX2) and ChaCha20 for arm64 (NEON), ppc64le and s390x
- **Constant-Time Operations**: All cryptographic operations use constant-time algorithms to prevent timing attacks

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519/X25519 ECDH used throughout
- [x] **Perfect Forward Secrecy** - Ephemeral session keys (Noise protocol + WireGuard automatic rotation)
- [ ] **Post-quantum readiness** - No hybrid or post-quantum key exchange currently implemented
- [x] **Key rotation** - WireGuard automatic key rotation (~2 minutes), manual NodeKey rotation supported

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 for both control and data plane
- [x] **Hardware-accelerated crypto** - SIMD assembly ChaCha20-Poly1305 from golang.org/x/crypto (amd64 SSSE3/AVX2, arm64 NEON); no AES-NI
- [x] **Constant-time operations** - Timing attack resistant (constant-time key comparison implemented)

### Protocol Security
- [x] **Replay protection** - 64-bit counter/nonce verification in WireGuard, handshake hash binding in Noise
- [x] **Noise Protocol or equivalent** - Full Noise IK implementation for control plane, WireGuard (Noise_IKpsk2) for data plane
- [x] **No cleartext metadata** - Partial: WireGuard handshakes and control traffic hide long-term keys, but every disco packet (NAT-traversal ping/pong, CallMeMaybe) carries the sender's 32-byte DiscoKey in cleartext. The DiscoKey is regenerated at each tailscaled start, but it links all of a node's endpoints for that run

# Performance

**Threading Model:**

Both Tailscale client and Headscale use **Go's goroutine model** for concurrent operation across multiple CPU cores.

**Tailscale Client Threading:**

The client uses extensive parallelism with careful synchronization:

- **WireGuard Device**: wireguard-go starts one encryption, one decryption and one handshake goroutine per CPU (`runtime.NumCPU()`); per-peer staged/inbound/outbound queues keep each peer's packets in order
- **Control Client**: Dedicated long-polling goroutine for map updates
- **MagicSock**: wireguard-go runs one receive goroutine per receive function (UDPv4, UDPv6, DERP). There is one UDP socket per address family, with no SO_REUSEPORT fan-out
- **Network Monitor**: Background goroutine listening for system network changes
- **Router**: Asynchronous OS routing table updates
- **Netstack (gVisor)**: Userspace TCP/IP stack with per-connection goroutines, used only for the traffic it terminates (see Netstack Integration)

**Concurrency Patterns:**
- `sync.Mutex` for shared state protection in userspaceEngine
- `atomic` types for lock-free reads on endpoints
- `sync.Pool` for efficient buffer reuse in UDP operations
- Event bus for inter-component communication
- Per-endpoint heartbeat timer management

**Headscale Control Server Threading:**

The control server is designed for multi-core scalability:

- **Copy-on-Write NodeStore**: Lock-free reads using `atomic.Pointer`; writes are batched (`tuning.node_store_batch_size` 100, `tuning.node_store_batch_timeout` 500 ms)
- **Worker Pools**: `tuning.batcher_workers` (default ¾ of CPU cores) generate MapResponses in parallel
- **Concurrent Map Access**: `xsync.Map` for thread-safe maps in batcher
- `sync.WaitGroup` for client stream management
- `sync.Mutex` and `deadlock.Mutex` (optional) for thread safety
- **Deadlock Detection**: Optional via `HEADSCALE_DEBUG_DEADLOCK` environment variable

**Synchronization Points:**
- MapResponse updates trigger WireGuard configuration changes
- Endpoint changes trigger immediate magicsock updates
- Network changes detected by netmon.Monitor trigger re-evaluation
- Batched writes to reduce expensive peer recalculations (Headscale)

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - wireguard-go runs NumCPU encryption/decryption goroutines, so crypto uses all cores
- [x] **Per-peer packet queues** - wireguard-go uses per-peer queues to reduce lock contention

### Packet I/O
- [x] **Batch UDP receives** - `recvmmsg` on Linux (not Android): 128 messages per call without UDP GRO. With GRO enabled a read fills only 2 messages, each holding up to 64 coalesced datagrams
- [x] **Batch UDP sends** - `sendmmsg` with up to 128 messages per call on Linux; other platforms send one packet per call
- [x] **Large batch sizes** - `IdealBatchSize` = 128 for the UDP socket and the TUN device (Linux only; batch size 1 elsewhere)

### UDP Offload
- [x] **UDP GSO (Generic Segmentation Offload)** - `UDP_SEGMENT` control message; up to 64 datagrams coalesced per send (Linux)
- [x] **UDP GRO (Generic Receive Offload)** - `UDP_GRO` socket option enabled when the kernel supports it (Linux)
- [x] **TUN offload (virtio-net header)** - TUN opened with `IFF_VNET_HDR`; `TUNSETOFFLOAD` enables CSUM/TSO4/TSO6, plus USO4/USO6 on kernel ≥ 6.2. wireguard-go splits TSO super-packets on read and GRO-coalesces TCP/UDP before writing to the TUN. Linux only (not Android); TUN GRO is probed at start-up and disabled on EINVAL
- [ ] **Multi-queue TUN / per-core sockets** - Single TUN fd (no `IFF_MULTI_QUEUE`) and one UDP socket per address family (no `SO_REUSEPORT`)

### Buffer Management
- [x] **Buffer pool reuse** - `sync.Pool` reuses allocated buffers to reduce GC pressure
- [x] **Large UDP socket buffers** - 7 MiB requested via `SO_RCVBUFFORCE`/`SO_SNDBUFFORCE` (needs CAP_NET_ADMIN); the `SO_RCVBUF`/`SO_SNDBUF` fallback is clamped by `net.core.rmem_max`/`wmem_max`

### Userspace TCP Stack (not in the default Linux data path)
- [x] **Userspace TCP implementation** - Partial: gVisor netstack is always built in, but in Linux kernel-TUN mode it only terminates Tailscale-local services (peerAPI/Taildrop, Tailscale SSH, Serve, MagicDNS, 4via6). It carries all traffic only with `--tun=userspace-networking`, plus subnet/exit-node traffic on Windows, macOS tailscaled, FreeBSD, OpenBSD and Synology
- [x] **Large TCP RX/TX buffers** - netstack maximum 8 MiB receive / 6 MiB send (smaller on iOS)
- [x] **Tuned congestion control** - Reno pinned explicitly (gVisor's int-overflow bug is more likely with CUBIC), SACK enabled, RACK loss detection disabled (gVisor's RACK caused spurious retransmits)
- [ ] **Reordering tolerance** - Not improved: with RACK disabled, gVisor falls back to a fixed 3-duplicate-ACK threshold. Large buffers only prevent window stalls

### Receive Path
- [x] **TCP/packet coalescing on ingress** - wireguard-go GRO-coalesces TCP (and UDP on kernel ≥ 6.2) before TUN writes; netstack has its own TCP GRO on Linux
- [x] **RX checksum offload** - netstack GRO marks coalesced packets `RXChecksumValidated` (netstack path only); TUN writes use virtio-net checksum offload

### MTU Handling
- [x] **Conservative MTU** - TUN MTU 1280 (IPv6 minimum; 1360-byte wire MTU with 80 bytes of WireGuard overhead); override with `TS_DEBUG_MTU`
- [x] **Path MTU discovery** - Partial: off by default. `TS_DEBUG_ENABLE_PMTUD` or the control knob `NodeAttrPeerMTUEnable` (Headscale does not send it) sets DF and sends sized disco probes, but the TUN MTU stays at 1280

### Peer Management
- [x] **Lazy peer removal** - Peers whose AllowedIPs are all single IPs stay out of the wireguard-go config until they send or receive traffic, and are trimmed again after 5 minutes idle
- [x] **Endpoint caching** - Caches best endpoints to minimize probe overhead
- [x] **Efficient keepalive timers** - Disco heartbeat every 3 s only while a session is active; stops after 45 s idle

### Packet Processing
- [x] **Zero-allocation parsing** - Parses packets without heap allocations on hot paths (packet.Parsed struct)
- [x] **Zero-copy filtering** - The filter decides on the parsed header in place. It is stateless for TCP (only SYNs are checked) and tracks UDP/SCTP flows in a 512-entry LRU

### State Synchronization
- [x] **Delta updates** - Only changed peers sent in MapResponse (PeersChanged/PeersRemoved)
- [x] **Compression** - Zstd compression for control plane MapResponse messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression (WireGuard encrypted traffic is incompressible)
- [ ] **Configurable compression level** - No data-plane compression, so there is nothing to configure

**Performance Results:**

Under the old sender-side Medium profile (2.5% reordering and 1% packet loss per direction, 5% and 2% combined), the benchmark measured Tailscale at **41 Mbps**, raw WireGuard at **9 Mbps** and a direct connection at **30 Mbps**.

The source code does not support the per-feature attribution given earlier (+50% batching, +100% socket buffers, ...). In the default Linux TUN mode, iperf TCP runs in the host kernel on both ends. The gVisor netstack settings (8 MiB buffers, SACK, RACK off, Reno) are therefore **not** on that path. They apply only if tailscaled runs with `--tun=userspace-networking`, or for subnet/exit traffic on the platforms listed under Netstack Integration.

These datapath differences from kernel WireGuard are active in Linux kernel-TUN mode:

1. **128-packet batching** via `recvmmsg`/`sendmmsg` and batched TUN reads/writes
2. **7 MiB UDP socket buffers** (`SO_RCVBUFFORCE`/`SO_SNDBUFFORCE`)
3. **UDP GSO/GRO** on the outer socket
4. **TUN offload**: TSO/USO via the virtio-net header, plus GRO coalescing of inbound segments before they reach the kernel
5. **1280-byte TUN MTU** (kernel WireGuard setups typically use 1420)

# Security

**Positive Security Aspects:**

1. **Strong Encryption**:
   - Noise Protocol for control plane
   - WireGuard for data plane
   - Perfect forward secrecy via ephemeral keys
   - ChaCha20-Poly1305 authenticated encryption throughout

2. **Key Management**:
   - Curve25519 for all key operations
   - Constant-time comparison prevents timing attacks
   - Machine key never sent to peers (only to control server)
   - Separate identity keys (MachineKey) from WireGuard keys (NodeKey)

3. **Protocol Security**:
   - Noise IK authenticates the server (client must know its static key); the early payload adds a NodeKeyChallenge for node-key proof of possession
   - Unique machine key per client
   - Handshake hash prevents replay attacks
   - WireGuard replay protection via 64-bit counter

4. **Network Security**:
   - Inbound packet filter: TCP checked on SYN only; UDP/SCTP return traffic tracked in a 512-flow LRU cache
   - Capability-based access control (fine-grained per-port/protocol ACLs)
   - ACL-based peer visibility filtering

5. **Authentication**:
   - PKCE support for OAuth/OIDC
   - Machine key verification
   - Persistent node keys (rotatable)
   - Email verification for OIDC (configurable)
   - Node expiry enforcement (nodes cannot extend their own expiry)

6. **Implementation Security**:
   - Memory-safe language (Go) for both client and Headscale
   - CSRF protection for OIDC flows (state/nonce cookies)

**Known Security Issues:**

These advisories come from the projects' GitHub/CVE records, not from the source:

- **Tailscale**: CVE-2022-41924 (critical, RCE via CSRF against the Windows daemon's local API), CVE-2022-41925 (low, information disclosure via CSRF), CVE-2023-28436 (medium, non-interactive Tailscale SSH sessions on FreeBSD could run with tailscaled's effective group ID)
- **Headscale**: CVE-2023-47390 (versions up to 0.22.3 wrote bearer tokens to info-level logs)

**Potential Security Concerns:**

1. **NAT Traversal Side Channels**:
   - Direct IP exposure through endpoint exchange (ISP/home IPs visible to peers)
   - DERP region leaks location information
   - No circuit-level privacy like Tor
   - Clock skew in heartbeat timing could leak information

2. **Relay Server Trust**:
   - DERP servers can observe encrypted packet metadata (but cannot decrypt)
   - DERP region selection reveals location preference
   - Embedded DERP client verification (`verify_clients`, default true) can be disabled; keep it enabled in production

3. **Control Server Trust** (Critical):
   - Control server has **full control** over the mesh network
   - Can push malicious peer keys, ACL changes, or route configurations
   - Can perform MITM by distributing attacker-controlled keys
   - **Headscale users must secure their control server** as it is the root of trust
   - Compromised control server = compromised network

4. **DNS Privacy**:
   - MagicDNS names are answered locally by tailscaled's 100.100.100.100 resolver from the netmap; other queries go to the upstream resolvers the control server configures
   - The control server sees the DNS configuration, not individual queries, unless it also supplies the upstream resolver

5. **Endpoint Selection**:
   - No randomization in endpoint selection (observable pattern)
   - Could leak usage patterns to network observers

6. **Headscale-Specific Concerns**:
   - Database credentials stored in config file (file-based secrets supported, e.g. `oidc.client_secret_path`)
   - API keys are stored bcrypt-hashed; pre-auth keys are bcrypt-hashed since the 2025-11 migration (legacy plaintext keys are still accepted)
   - No rate limiting anywhere in Headscale (registration, API, OIDC and Noise endpoints), so pre-auth keys can be brute-forced
   - Debug environment variables expose functionality (should be disabled in production)
   - DERP WebSocket accepts all origins (wildcard) - requires proper reverse proxy protection

7. **Missing Security Features** (Headscale vs. Tailscale SaaS):
   - Device posture: the client can report posture attributes (feature/posture) for Tailscale SaaS; Headscale does not use them
   - Hardware attestation: the client supports TPM 2.0 / Secure Enclave / Keystore-bound node identity (`--hardware-attestation`) and TPM-encrypted state (`--encrypt-state`); Headscale ignores attestation
   - Audit logging: the client sends audit events to `/machine/audit-log` and optional network flow logs (SaaS); Headscale implements neither endpoint
   - Tailnet Lock (TKA): SaaS only; Headscale does not implement the `/machine/tka/*` endpoints
   - No automatic node-key rotation without re-login

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - wireguard-go limits handshake initiations per source IP (20/s, burst 5) and answers with cookie replies when under load. Headscale itself has no rate limiting on registration/API endpoints
- [x] **Stateful packet filter** - Partial: TCP is only SYN-checked (no conntrack); UDP/SCTP return flows are tracked in a 512-entry LRU
- [x] **Fine-grained ACLs** - Per-port/protocol access control, enforced by the receiving node's packet filter
- [x] **Capability-based access** - Policies on users, groups, tags and autogroups (Headscale); SaaS adds grants with app capabilities

### Identity & Authentication
- [ ] **Identity validation** - Tailscale IPs are assigned by the control server, not derived from keys. Tailnet Lock (SaaS only) lets nodes verify Ed25519 signatures on peer node keys; Headscale has no TKA
- [ ] **Signed configuration updates** - MapResponses are only authenticated by the Noise channel, not signed. Tailnet Lock (SaaS only) signs node keys, not the whole netmap; Headscale does not implement it
- [ ] **Certificate pinning** - At every start the client fetches the server's Noise key from `/key` over HTTPS (WebPKI; plain HTTP if the control URL is http://) and does not persist it. Only DERP nodes can be pinned, via a `sha256-raw:` certificate hash in the DERP map

### Implementation
- [x] **Memory-safe language** - Go for both Tailscale client and Headscale
- [x] **Privilege separation** - Partial: tailscaled runs as root/SYSTEM; only helper children (Tailscale SSH incubator, Taildrive server) drop to the target user. Userspace-networking mode can run unprivileged
- [x] **Sandboxing** - Partial: no seccomp/landlock, and the shipped tailscaled unit has no hardening directives, but the Headscale systemd unit uses `SystemCallFilter=`, `ProtectSystem=strict`, `NoNewPrivileges` and a reduced capability set (`headscale/packaging/systemd/headscale.service:18-48`)
- [ ] **Audit logging** - Headscale: none (only normal logs). Tailscale SaaS: client audit events and network flow logs

# NAT Traversal

**STUN (Session Traversal Utilities for NAT):**

The Tailscale client uses STUN to discover public endpoints:

- **netcheck Package**: Probes network conditions and performs STUN queries
- **STUN Protocol**: Generates binding requests and parses responses to discover public IP:port
- **Multiple STUN Servers**: Uses multiple DERP servers as STUN servers for redundancy
- **NAT Type Detection**: Detects whether the NAT mapping varies by destination IP (easy vs. hard NAT) and whether port mapping is available

**Port Mapping Protocols:**

Tailscale attempts multiple port mapping protocols for NAT traversal:

- **UPnP** (Universal Plug and Play): Automatic router port forwarding
- **NAT-PMP** (NAT Port Mapping Protocol): Apple/BSD port mapping protocol
- **PCP** (Port Control Protocol): RFC 6887 standard port control

These protocols attempt to create explicit port mappings on the NAT device for more reliable connectivity.

**Discovery Protocol (Disco):**

Tailscale implements a custom discovery protocol for endpoint coordination:

- **Disco Keys**: Each node publishes a discovery key to peers
- **Call-Me-Maybe**: Peers send disco pings to discover each other's endpoints
- **Active Probing**: Tests connectivity via disco pings to multiple candidate endpoints
- **Best Address Selection**: Chooses endpoint based on latency and packet loss
- **Heartbeats**: Periodic keepalives maintain NAT mapping state

**UDP Hole Punching:**

The endpoint module manages aggressive hole-punching:

- **Multiple Candidate Endpoints**: Tracks all possible endpoints per peer (IPv4, IPv6, local, STUN-discovered)
- **Simultaneous Probing**: Tests all candidate endpoints in parallel
- **MTU Probing**: Only with opt-in peer path MTU discovery (off by default)
- **Symmetric NAT Handling**: No port prediction or birthday probing. Works when the other side is behind an easy NAT; otherwise relies on port mapping, peer relays (SaaS) or DERP

**DERP (Designated Encrypted Relay for Packets):**

When direct connections fail, DERP provides reliable fallback:

- **Relay Protocol**: Encrypted relay for WireGuard packets when direct path unavailable
- **Multiple Regions**: Geographic redundancy with multiple DERP regions
- **Automatic Region Selection**: Chooses lowest-latency region based on periodic probes
- **TCP and WebSocket Support**: DERP relay works over TCP when UDP is blocked
- **Client Pools**: Maintains connection pool to active DERP regions for fast failover

**Peer Relays (UDP relay):**

- Any node can act as a UDP relay server (`tailscale set --relay-server-port`); traffic is Geneve-encapsulated and stays WireGuard-encrypted
- Preferred over DERP but ranked below direct paths
- Requires `tailscale.com/cap/relay` grants from the control server, so it works only with Tailscale SaaS. Headscale has no grants, so peer relays are unavailable there

**Headscale DERP Support:**

Headscale can operate embedded DERP servers or use external relays:

- **Embedded DERP Server**: Optional DERP server alongside the control plane (`derp.server.enabled`, off by default)
- **Embedded STUN Server**: Runs together with the embedded DERP server
- **External DERP Maps**: `derp.urls`/`derp.paths`; the example config uses Tailscale's public map (`https://controlplane.tailscale.com/derpmap/default`)
- **Client Verification**: `verify_clients` (default true) restricts the embedded DERP to known nodes
- **WebSocket Support**: The embedded DERP accepts WebSocket from any origin (`OriginPatterns: *`)

## NAT Traversal Checklist

### Discovery
- [ ] **No own public node needed** - Every node must reach the self-hosted Headscale `server_url`, so it needs a public address (`headscale/config-example.yaml:8-19`); the example config uses Tailscale's public DERP map for relays only. Tailscale SaaS would be ✓ (`tailscale/ipn/prefs.go:40-41`)
- [x] **STUN support** - Discovers public IP/port via STUN servers (uses DERP servers as STUN)
- [x] **Multiple STUN servers** - netcheck probes STUN on every DERP region in the map (Headscale with only the embedded DERP has a single STUN server)
- [x] **NAT type detection** - netcheck reports `MappingVariesByDestIP` (endpoint-dependent vs. independent mapping)

### Port Mapping
- [x] **UPnP port mapping** - Automatic router port forwarding
- [x] **NAT-PMP support** - Apple/BSD port mapping protocol
- [x] **PCP support** - Port Control Protocol (RFC 6887)

### Hole Punching
- [x] **UDP hole punching** - Direct peer-to-peer through NAT via disco protocol
- [x] **Symmetric NAT handling** - Partial: hard NAT is detected, but there is no port prediction or birthday probing; it relies on the peer being behind an easy NAT, on port mapping, or on relays
- [x] **Rendezvous coordination** - Server-assisted hole punching via control plane endpoint exchange

### Fallback
- [x] **Relay fallback** - Encrypted DERP relay when direct connection fails
- [x] **Multiple relay regions** - Geographic redundancy for DERP relays
- [x] **Automatic relay selection** - Chooses lowest latency DERP region
- [x] **TCP relay support** - DERP relay over TCP (and WebSocket) when UDP blocked

# Local Routing

**LAN Discovery Mechanism:**

Peers discover each other's local endpoints through the control server:

1. **Endpoint Reporting**: Each node reports all its network interfaces and endpoints in MapRequest to control server
2. **Endpoint Distribution**: Control server distributes full endpoint list to authorized peers in MapResponse
3. **Endpoint Types Shared**:
   - Local LAN IPv4/IPv6 addresses
   - STUN-discovered public endpoints
   - DERP region preference
4. **Call-Me-Maybe Protocol**: When peers receive endpoint updates, they send disco pings to all candidate endpoints including LAN addresses

**LAN Detection:**

- **Same-Subnet Detection**: No explicit subnet comparison. LAN candidates are probed, and private, link-local and loopback addresses get bonus points in path selection
- **Direct Path Testing**: Disco protocol actively probes all endpoints including local IPs
- **No Broadcast/Multicast**: Does not use broadcast or multicast for discovery (all coordination via control server)

**LAN Optimization:**

Once local peers are identified:

- **Automatic LAN Preference**: MagicSock prefers direct local paths over WAN paths (lower latency wins)
- **Path Selection**: Prioritizes:
  1. Direct local LAN IPv4/IPv6 (lowest latency)
  2. Direct WAN IPv4/IPv6 (medium latency)
  3. Peer relay via Geneve encapsulation (needs SaaS grants; unavailable with Headscale)
  4. DERP relay (fallback)
- **Encryption Still Required**: **All LAN traffic is still WireGuard-encrypted** - no trusted path mode
- **No LAN-Only Mode**: Cannot restrict to local network only (always connects to control server)

**Routing Features:**

The combined Tailscale/Headscale system supports advanced routing:

- **Subnet Routes**: Nodes can advertise routes to other networks (requires approval)
- **Primary Routes**: High-availability route selection when multiple nodes advertise same subnet
- **Exit Node Routes**: Route all traffic (0.0.0.0/0, ::/0) through a designated peer
- **Route Priorities**: Support for failover between multiple subnet routers
- **AllowedIPs Calculation**: Combines node IP addresses, approved subnet routes, and exit routes into WireGuard AllowedIPs configuration

**Split Tunneling:**

- **Selective Routing**: Only Tailscale IP ranges and approved subnet routes go through VPN
- **Default Route Override**: Exit node mode routes all traffic through VPN
- **Per-Peer Routes**: WireGuard AllowedIPs configured per-peer based on what each peer advertises

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No LAN broadcast/multicast (uses control server for endpoint exchange)
- [x] **Direct path advertisement** - Peers share all reachable endpoints via control server
- [x] **Same-subnet detection** - Partial: no explicit subnet match; private and link-local endpoints get a path-selection bonus

### LAN Optimization
- [x] **Automatic LAN preference** - Prefers local paths (latency score plus a +20 bonus for private and +30 for link-local addresses)
- [ ] **Trusted path mode** - No option to skip encryption on LANs (all traffic encrypted via WireGuard)
- [ ] **LAN-only mode** - Cannot restrict to local network (requires control server connectivity)

### Routing Features
- [x] **Subnet routes** - Route traffic for other networks through peer (requires approval)
- [x] **Full tunnel mode** - Route all traffic through a peer (exit node functionality)
- [x] **Split tunneling** - Selective routing through VPN (default mode)
- [x] **Route priorities** - HA failover between subnet routers advertising the same prefix (Headscale primary routes; its docs call HA support limited)

# Central Point of Failure

**Yes, the control server is a single point of failure**, but with important mitigations:

**When Control Server is Down:**

- **Existing Connections Continue**: ✅ WireGuard tunnels remain active (keys already distributed)
- **Direct P2P Works**: ✅ Peer-to-peer connections continue if endpoints are known
- **DERP Relay May Work**: ✅ DERP relays can continue if they're separate from control server
- **No New Registrations**: ❌ Nodes cannot register or re-authenticate
- **No Policy Updates**: ❌ ACL changes don't propagate
- **No Endpoint Updates**: ❌ Clients cannot discover new peer endpoints or handle network changes
- **No New Peers**: ❌ Cannot add new devices to network

**Mitigation Factors:**

1. **Local State Caching**:
   - The Tailscale client keeps the network map in memory only. An on-disk netmap cache exists only as a declared build-feature tag and is not implemented in this checkout; prefs and keys are persisted
   - Peer information, endpoints and keys stay available while tailscaled keeps running; after a restart during an outage the client has no peers
   - Direct connections keep working based on the in-memory endpoints

2. **WireGuard Independence**:
   - WireGuard tunnels persist until key expiry (typically not an issue for short outages)
   - Encryption keys already distributed, no control server needed for ongoing traffic

3. **DERP Separation**:
   - DERP relays can be separate infrastructure from control server
   - If DERP servers remain online, relay connectivity continues
   - Headscale embedded DERP fails with control server (should use external DERP for redundancy)

4. **Graceful Degradation**:
   - Existing connections gracefully continue during control server outage
   - Client retries connection to control server with exponential backoff
   - Clear behavior: network frozen in last-known state

**Node Expiry Risk:**

- **Configurable Expiry**: Nodes have expiry timestamps enforced by control server
- **Expired Nodes**: Marked as unauthorized, peers stop accepting their traffic
- **Ephemeral Nodes**: Removed after `ephemeral_node_inactivity_timeout` (Headscale; 120 s code default, 30 min in the example config)
- **Long Outage Risk**: If control server down during expiry, nodes may lose connectivity

**Headscale-Specific Considerations:**

- **Self-Hosted Control**: You control availability (no built-in HA; see next point)
- **No Controller Redundancy**: Headscale does not support active-active or failover (single instance only)
- **Database Dependency**: SQLite (default, recommended) or PostgreSQL (discouraged, legacy support only) must be available
- **No Multi-Region**: Cannot distribute control server across regions

**Recommendations for High Availability:**

1. **External DERP Servers**: Use separate DERP infrastructure (not embedded)
2. **Monitoring**: Monitor control server and DERP relay availability
3. **Backup Strategy**: Regular database backups for Headscale
4. **Long Expiry**: Configure long node expiry (90+ days) to survive extended outages
5. **Regional DERP**: Deploy DERP relays in multiple regions for redundancy

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - WireGuard tunnels stay up without controller
- [ ] **Local state caching** - The netmap is held in memory only: it survives control outages but not a tailscaled restart (only prefs/keys are persisted)
- [x] **Cached credentials** - MachineKey persists, authentication survives restart
- [x] **Graceful degradation** - Clear behavior: network frozen in last-known state

### Redundancy
- [x] **Self-hosted controller** - Can run own control plane (Headscale)
- [ ] **Controller redundancy** - Multiple controllers NOT supported (single Headscale instance only)
- [x] **Relay redundancy** - Multiple DERP regions/nodes in the DERP map; Headscale can combine its embedded DERP with external maps
- [ ] **No single root of trust** - Control server is single root of trust (can push malicious configs)

### Efficiency
- [x] **Delta/incremental updates** - Only changed peers sent (PeersChanged/PeersRemoved)
- [x] **Long polling / push updates** - Changes are pushed over the long-poll `/machine/map` stream (HTTP/2 over Noise)
- [ ] **Configurable sync interval** - Headscale's 50 s keep-alive (+0–9 s jitter) is hardcoded; updates are pushed, not polled

# Authentication

**Enrollment Methods:**

The combined Tailscale/Headscale system supports multiple authentication methods:

**1. Pre-Authentication Keys (AuthKey):**

- **Headless Enrollment**: Ideal for servers, containers, and automated deployments
- **Reusable or Ephemeral**: Keys can be one-time or multi-use
- **Auto-Tagging**: Keys can automatically apply tags to nodes for policy assignment
- **Auto-Approval**: Can auto-approve subnet routes and exit nodes
- **Created via**: CLI/API in Headscale, web dashboard in Tailscale cloud
- **Use Case**: `tailscale up --authkey=tskey-auth-xxx`

**2. OAuth/OIDC (OpenID Connect):**

- **Full OAuth2/OIDC Flow**: Standards-compliant SSO integration
- **PKCE Support**: S256 and plain (off by default in Headscale; S256 is the default method)
- **Domain Filtering**: Restrict by email domain (e.g., @company.com)
- **Group Filtering**: Filter by OIDC groups (supported in both Headscale and Tailscale cloud)
- **User Filtering**: Allowlist specific users
- **Email Verification**: `oidc.email_verified_required` (default true)
- **IdP Support**: Works with any OIDC provider (Google, Okta, Azure AD, Keycloak, etc.)
- **Headscale OIDC**: Fully supported with profile updates from IdP

**3. Interactive/Web Authentication:**

- **Browser-Based Flow**: Client opens browser for authentication
- **Registration Cache**: Temporary cache with expiration for registration flow
- **Manual Approval**: Headscale web (non-OIDC) registration requires an admin to run `headscale nodes register --key <id> --user <user>`; OIDC logins register immediately. Tailscale SaaS offers optional device approval
- **Auth Code Exchange**: Server provides auth code, client completes registration

**Authorization Workflow:**

1. **Node Registration**:
   - Node sends registration request with MachineKey
   - Authentication method determines approval (auto-approve or manual)
   - Server assigns Tailscale IP from available pool

2. **Admin Approval** (if required):
   - Headscale: `headscale nodes register --key <registration-id> --user <user>`
   - Tailscale cloud: Approve via web dashboard
   - Can require manual approval for security

3. **Auto-Approval** (if configured):
   - Pre-auth keys enable automatic approval
   - Auto-approvers in ACL policy can approve routes/exit nodes
   - Tagged devices auto-approved based on key tags

4. **Node Expiry**:
   - Headscale uses `oidc.expiry` (default 180 days, 0 = never) for OIDC logins; for pre-auth-key/CLI registrations it uses the expiry requested by the client. Admins can expire nodes with `headscale nodes expire`
   - Expired nodes marked as unauthorized
   - Nodes **cannot extend their own expiry** (security feature)
   - After expiry, the node must re-authenticate (interactive registration needs another `headscale nodes register`; OIDC needs a new login)

**Identity Models:**

- **User-Owned Nodes**: Ownership defined by UserID (traditional model)
- **Tagged Nodes**: Ownership defined by tags, not user (service accounts)
- **Mutually Exclusive**: Node is either user-owned OR tagged, not both
- **TaggedDevices User**: Special protocol user for tagged devices

**Key Management:**

- **MachineKey**: Generated on first run, persisted to disk, identifies machine to control server
- **NodeKey**: Persisted to disk, distributed to peers for WireGuard tunnels, can be manually rotated
- **Key Validation**: MachineKey must match node association (prevents key reuse attacks)
- **Stable Identity**: MachineKey provides persistent device identity across restarts

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Headless/automated enrollment via reusable or ephemeral keys
- [x] **OAuth/OIDC** - SSO integration with domain/user/group filtering (supported in both Headscale and Tailscale cloud)
- [x] **Interactive login** - Browser-based authentication flow
- [x] **CLI authentication** - Command-line auth flow supported

### Authorization
- [x] **Admin approval workflow** - Headscale interactive registration needs `headscale nodes register`; OIDC registers without approval; SaaS device approval is optional
- [x] **Automated enrollment rules** - Conditional automatic authorization via pre-auth keys and auto-approvers
- [x] **Ephemeral nodes** - Auto-cleanup of temporary devices after inactivity (`ephemeral_node_inactivity_timeout`)
- [x] **Node expiry** - Time-limited authorization with enforcement (nodes cannot self-extend)

### Identity
- [x] **Stable device identity** - MachineKey persistent across restarts
- [ ] **Identity portability** - Identity is bound to the device's state file; `--hardware-attestation` can bind it to TPM/Secure Enclave keys
- [x] **Multi-user support** - Multiple users per tailnet (Headscale users; tagged nodes are owned by `TaggedDevices`); the client supports several login profiles (`tailscale switch`)

# Platform Support

**Tailscale Client Platform Support:**

The Tailscale client (tailscaled) supports extensive platform coverage:

**Desktop/Server Operating Systems:**
- **Linux**: Full support (wireguard-go userspace only; kernel WireGuard is NOT used because magicsock must intercept all packets)
- **macOS**: Full support (userspace wireguard-go, network extension)
- **Windows**: Full support (userspace wireguard-go, WinTun driver)
- **FreeBSD**: Full support (userspace wireguard-go)
- **OpenBSD**: Full support (userspace wireguard-go)

**Mobile Operating Systems:**
- **iOS**: Full support via iOS app (Network Extension framework)
- **Android**: Full support via Android app (VpnService API)

**Specialized Platforms:**
- **Docker/Containers**: Full support via containerboot
- **Kubernetes**: Operator support (k8s-operator)
- **Synology NAS**: Package available
- **QNAP NAS**: Package available
- **Other**: Various embedded Linux devices

**Implementation Details:**

**WireGuard Implementation:**

- **All Platforms (including Linux)**:
  - Always uses wireguard-go userspace implementation
  - Pure Go implementation (no kernel dependencies)
  - Kernel WireGuard is NOT used because Tailscale's magicsock layer must intercept all WireGuard packets to handle endpoint selection, DERP relay, and disco protocol — this is incompatible with the kernel WireGuard module which sends packets directly via the kernel network stack
  - Performance is compensated (Linux only) via UDP batching (recvmmsg/sendmmsg), GSO/GRO on the outer UDP socket, TUN TSO/GRO offload via the virtio-net header, and 7 MiB socket buffers

**TUN Interface:**

- **Linux**: Uses `/dev/net/tun` device
- **macOS**: Uses utun device (userspace tunnel)
- **Windows**: Uses WinTun driver (userspace tunnel)
- **FreeBSD/OpenBSD**: Uses tun device

**Privilege Requirements:**

- **Linux**: Runs as root (required for TUN device and routing table)
- **macOS**: Runs with admin privileges (required for network extension)
- **Windows**: Runs as SYSTEM (required for WinTun and routing)
- **iOS/Android**: Uses OS VPN APIs (user grants VPN permission)

**Netstack Integration:**

- **gVisor Netstack**: Always built in; which traffic it handles depends on the mode
- **Use Cases**:
  - Linux kernel-TUN mode (default): only Tailscale-local services: peerAPI (Taildrop), Tailscale SSH, Serve/VIP services, MagicDNS (100.100.100.100), 4via6
  - `--tun=userspace-networking`: all tunneled traffic (local IPs and subnets); no root needed
  - Subnet routers / exit nodes on Windows, macOS (tailscaled), FreeBSD, OpenBSD, Solaris/illumos and Synology, or with `TS_DEBUG_NETSTACK_SUBNETS`
- **Platforms**: All Go platforms; netstack GSO/GRO only on Linux

**Container Support:**

- **containerboot**: Special mode for ephemeral containers
- **Kubernetes Operator**: Manages Tailscale sidecar containers
- **Docker**: Can run tailscaled in privileged container
- **Network Namespaces**: Supports Linux network namespaces

**Headscale Platform Support:**

Headscale control server is much simpler (control plane only):

- **Linux / BSD**: The docs require a reasonably modern Linux or BSD; official binaries and DEB packages
- **Other OSes**: Not covered by the official docs
- **Docker**: Container images are published (`ghcr.io/juanfont/headscale`, `headscale/headscale`), but Docker deployment is not officially supported
- **Kubernetes**: No manifests in the repo; only community projects are linked

**Database Support (Headscale):**
- **SQLite**: Embedded database (default and recommended)
- **PostgreSQL**: Supported only for legacy reasons; upstream discourages it (maintenance mode)

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support (wireguard-go userspace only)
- [x] **macOS** - Full support (userspace wireguard-go)
- [x] **Windows** - Full support (userspace wireguard-go + WinTun)
- [x] **FreeBSD/OpenBSD** - BSD support (userspace wireguard-go)

### Mobile
- [x] **iOS** - Mobile app via Network Extension
- [x] **Android** - Mobile app via VpnService API

### Implementation
- [ ] **Kernel-mode datapath** - NOT used; always wireguard-go userspace (magicsock requires packet interception incompatible with kernel WireGuard)
- [x] **Userspace implementation** - wireguard-go runs entirely in userspace (all platforms)
- [x] **Container support** - Docker/Kubernetes integration via containerboot and k8s-operator
