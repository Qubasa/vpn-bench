# Overview

Nebula is a scalable, open-source mesh VPN developed by Slack (now maintained by Defined Networking). It creates a peer-to-peer network overlay that enables direct communication between hosts regardless of their underlying network topology. Nebula uses a custom certificate-based PKI system for authentication and employs the Noise Protocol Framework for secure key exchange.

## Key Architecture Components

**Peer-to-peer mesh**: Every node can communicate directly with every other node after establishing encrypted tunnels. Data flows directly between peers without intermediary relay servers (unless required for NAT traversal).

**Lighthouse-assisted discovery**: Lightweight discovery servers (called "lighthouses") help nodes find each other's public IP addresses and ports. Lighthouses are only involved in the control plane - they do not relay data traffic under normal circumstances.

**Certificate-based PKI**: Nebula uses its own certificate format (v1: protobuf, single IPv4 address; v2 since 1.10.0: ASN.1, IPv6 and multiple addresses) that defines network membership, assigned IP addresses, groups, and routable unsafe networks. All nodes must have certificates signed by a trusted Certificate Authority (CA).

**UDP-based transport**: All control and data plane traffic flows over UDP with a custom 16-byte wire protocol header. Everything after the handshake is AEAD-encrypted; the exceptions are the first handshake message (sent before any key exists), unauthenticated `recv_error` replies and 1-byte hole-punch packets.

**Multi-threaded packet processing**: Each "routine" is a pair of run-to-completion goroutines (one TUN reader that encrypts and sends, one UDP reader that decrypts and writes to TUN). The `routines` setting (default 1) adds more pairs using SO_REUSEPORT UDP sockets and IFF_MULTI_QUEUE TUN queues. This only works on Linux; every other platform (including Android) logs a warning and falls back to one routine.

# Protocol

Nebula uses a custom wire protocol exclusively over UDP. Control plane (lighthouse, relay control, test) and data plane messages travel inside the same encrypted peer tunnels; only handshakes, `recv_error` and punch packets are unencrypted.

## Control Plane

The control plane uses several message types defined in the Nebula header:
- **Handshake messages** - Noise IX handshake for tunnel establishment (2 messages, 1 round trip)
- **Lighthouse messages** - HostQuery/HostQueryReply, HostUpdateNotification and HostPunchNotification, carried inside the encrypted tunnel to the lighthouse
- **Control messages** - Relay management (CreateRelayRequest/Response)
- **Test messages** - Tunnel liveness tests and path probing
- **CloseTunnel** - Authenticated tunnel teardown
- **RecvError** - Unauthenticated hint ("I have no tunnel for this index") that speeds up re-handshakes

Nodes periodically send HostUpdateNotification messages to configured lighthouses (default every 10 seconds, `lighthouse.interval`) to advertise their current IP addresses. When connecting to a new peer, nodes send HostQuery messages to all lighthouses to learn the target peer's addresses. The lighthouse answers and at the same time sends a HostPunchNotification to the target so it punches back toward the querier.

## Data Plane

Once a tunnel is established through the Noise IX handshake, all data packets flow directly between peers as encrypted UDP datagrams. Each packet has a 16-byte Nebula header containing version, message type/subtype, remote index, and a 64-bit message counter that serves as nonce and for replay protection. Per-packet overhead is 32 bytes (16-byte header + 16-byte AEAD tag) on top of the outer UDP/IP headers; relayed packets add another 32 bytes.

The data plane operates at Layer 3 (IP), routing IP packets through the encrypted tunnel. Nebula performs stateful firewall checks with connection tracking on both inbound and outbound packets.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary and only transport protocol
- [ ] **TCP fallback** - Not supported, UDP only
- [ ] **QUIC support** - Not supported
- [ ] **WebSocket support** - Not supported

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support (v1 and v2 certificates)
- [x] **IPv6 support** - Native IPv6 tunneling (v2 certificates only)
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6 (v2 certificates)

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing only (TUN device with IFF_TUN flag)
- [ ] **Layer 2 (Ethernet) mode** - Not supported, no TAP device support
- [ ] **Bridging support** - Cannot bridge non-VPN devices (Layer 3 only)

### Advanced
- [ ] **Multipath/bonding** - No support for aggregating multiple network paths
- [ ] **QoS/traffic shaping** - No built-in traffic prioritization
- [ ] **Multicast support** - No virtual multicast or broadcast support

# Encryption

Nebula implements the Noise Protocol Framework, specifically the **Noise IX** (Interactive with identity exchange) handshake pattern via `flynn/noise`. Both parties exchange and verify certificates during the handshake. The header subtype is named `ix_psk0`, but the pre-shared key is always empty, so it behaves as plain IX. In IX the initiator's first message carries its static public key and its certificate before any Diffie-Hellman has taken place, so they travel in cleartext. Only the responder's identity is encrypted.

## Encryption Layer Details

**Key Exchange**: Nebula supports two elliptic curves, either of which can be used with both v1 and v2 certificates:
- **Curve25519** (default) - Ed25519 signatures, X25519 ECDH
- **P-256 (NIST)** - ECDSA signatures, ECDH; PKCS#11 HSM-backed keys only when built with the `pkcs11` build tag (cgo)

**Symmetric Ciphers**: Two AEAD cipher options are available:
- **AES-256-GCM** (default) - Hardware-accelerated on platforms with AES-NI
- **ChaCha20-Poly1305** - Better performance on platforms without AES-NI

All nodes in the network must use the same cipher configuration (`cipher: aes` or `cipher: chachapoly`); it cannot be changed by config reload. A `boringcrypto` build (FIPS) swaps AES-GCM to BoringSSL's TLS-style GCM, which needs a per-tunnel lock around encryption.

**Nonce Construction**: Encryption uses a 12-byte nonce composed of 4 zero bytes + the 8-byte message counter (big-endian for AES-GCM, little-endian for ChaCha20-Poly1305). The counter is initialized to 2 (the two handshake messages), so the first data packet uses counter 3. It is an atomic counter shared by all routines.

**Replay Protection**: Nebula implements a 1024-packet sliding window bitmap to detect and reject replayed packets.

**Additional Authenticated Data**: The 16-byte Nebula header is used as AAD in the AEAD encryption, binding the ciphertext to the packet metadata.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519/X25519 ECDH (default) or P-256
- [x] **Perfect Forward Secrecy** - Noise IX handshake uses ephemeral Diffie-Hellman keys, providing PFS for each tunnel establishment. No timer-based periodic rekeying for long-lived sessions.
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange support
- [ ] **Key rotation** - No automatic session re-keying: a tunnel keeps its handshake keys until it is closed. A re-handshake happens only when the local certificate changes (reload/SIGHUP) or the certificate version should be upgraded. Certificates can be replaced via hot-reload, and a blocklist exists for exposed keys.

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 and AES-256-GCM supported
- [x] **Hardware-accelerated crypto** - AES-NI support for AES-256-GCM
- [x] **Constant-time operations** - Uses vetted crypto libraries with timing attack resistance

### Protocol Security
- [x] **Replay protection** - 1024-packet sliding window with bitmap verification
- [x] **Noise Protocol or equivalent** - Noise IX handshake framework
- [ ] **No cleartext metadata** - The 16-byte header (version, type, remote index, message counter) is sent in cleartext but authenticated as AEAD associated data. More importantly, Noise IX sends the initiator's static public key and full certificate (name, VPN IPs, groups, issuer) unencrypted in the first handshake message, so a passive observer learns the initiator's identity. Only the responder's certificate is encrypted.

# Performance

Nebula is written in Go and uses a goroutine-based, run-to-completion concurrency model, with optional multi-core scaling on Linux.

## Threading Model

**Default (`routines: 1`, all platforms)**:
- One goroutine reads one packet per `read()` from the TUN device, runs the outbound firewall/conntrack, encrypts and calls `sendto()` inline
- One goroutine reads from the UDP socket (Linux: `recvmmsg`, 64 packets per call), decrypts, runs the inbound firewall and writes each packet to TUN inline
- Both data-path goroutines are pinned to OS threads via `runtime.LockOSThread()`, so encryption and decryption can run on two cores in parallel, but each direction is single-core
- There is no separate crypto worker pool and no per-peer queue
- Additional goroutines handle handshakes, lighthouse queries/updates, connection management and timers

**Multi-routine mode** (configured via `routines: N`, Linux only):
- Uses IFF_MULTI_QUEUE for the TUN device, creating N queue file descriptors
- Opens N UDP sockets bound to the same port with SO_REUSEPORT, one per routine; routine *i* sends on socket *i*
- Other platforms (macOS, BSD, Windows, Android, iOS) report no multi-reader/multi-queue support and fall back to one routine with a warning
- The kernel distributes incoming UDP packets across sockets (and outgoing flows across TUN queues) by flow hash, so a single peer-to-peer tunnel with a single flow mostly stays on one routine; scaling comes from many peers/flows
- Traffic sent through a relay always uses the first UDP socket

**Concurrency primitives**:
- HostMap uses sync.RWMutex for peer lookups
- ConnectionState uses an atomic message counter; no lock on encrypt unless built with boringcrypto
- The firewall conntrack table is a single map behind one mutex that is taken per packet. A per-routine conntrack cache (`firewall.conntrack.routine_cache_timeout`) avoids this lock, but it is enabled by default (1 s) only when `routines > 1`

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - By default one goroutine per direction (encrypt and decrypt on separate cores); `routines` is a supported, documented option (promoted from experimental) that runs N reader pairs on Linux (`CHANGELOG.md:386`, `examples/config.yml:152-158`)
- [ ] **Per-peer packet queues** - No per-peer queues; packets are processed run-to-completion by the reader goroutine. Per-core parallelism comes from multi-queue TUN + SO_REUSEPORT (Linux, `routines`)

### Packet I/O
- [x] **Batch UDP receives** - Uses `recvmmsg` with default 64 packets per syscall (`listen.batch`, Linux non-Android only); Windows uses Registered I/O (RIO); other platforms read one packet per call
- [ ] **Batch UDP sends** - Does NOT use `sendmmsg`; one `sendto()` per packet
- [x] **Large batch sizes** - 64 packets per UDP receive batch (configurable, not reloadable); TUN reads and writes are one packet per syscall

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Not implemented
- [ ] **UDP GRO (Generic Receive Offload)** - Not implemented
- [x] **Multi-queue TUN / per-core sockets** - With `routines > 1` the TUN is opened with IFF_MULTI_QUEUE and each routine gets its own SO_REUSEPORT UDP socket (Linux only) (`overlay/tun_linux.go:106-107`, `udp/udp_linux.go:52-54`)

### Buffer Management
- [x] **Buffer pool reuse** - Fixed buffers pre-allocated per routine (recvmmsg ring of 64 × 9001 bytes, plaintext/ciphertext scratch buffers) and reused for every packet; no per-packet allocation
- [ ] **Large UDP socket buffers** - Not set by default (kernel `rmem_default`/`wmem_default`, typically ~200 KB). `listen.read_buffer`/`listen.write_buffer` can raise them via SO_RCVBUFFORCE/SO_SNDBUFFORCE (Linux)

### Userspace TCP Stack (optional)
- [x] **Userspace TCP implementation** - gVisor netstack, used only by the `service` package when Nebula is embedded as a Go library with `overlay.NewUserDeviceFromConfig`. The shipped `nebula` binaries always use a kernel TUN device. The netstack NIC uses MTU 1280 and an IPv4-only address.
- [ ] **Large TCP RX/TX buffers** - No custom buffer configuration (forwarder receive window 0 = default); inherits gVisor's stock 1 MiB defaults / 4 MiB max. Only TCP SACK is explicitly enabled. No Tailscale-style explicit overrides.
- [ ] **Tuned congestion control** - No congestion control overrides; inherits gVisor's default Reno. Tailscale's workarounds for gVisor's CUBIC integer-overflow bug (gvisor/issues/11632) are not applied because Nebula stays on the default and never enables CUBIC.
- [ ] **Reordering tolerance** - Inherits gVisor's default RACK loss-detection (`TCPRACKLossDetection`), which Tailscale found triggers spurious retransmits under reordering (tailscale/issues/9707) and explicitly disables. Nebula does not apply that workaround.

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No coalescing implemented
- [ ] **RX checksum offload** - Relies on kernel/hardware offload

### MTU Handling
- [x] **Conservative MTU** - Configurable MTU (`tun.mtu`), default 1300 bytes for the tunnel interface; per-`unsafe_routes` MTU overrides
- [ ] **Path MTU discovery** - No PMTU probing and no handling of ICMP "fragmentation needed"; relies on the conservative static MTU

### Peer Management
- [x] **Lazy peer removal** - Peers remain in hostmap until timeout
- [x] **Endpoint caching** - Caches discovered endpoints in lighthouse addrMap
- [x] **Efficient keepalive timers** - Timer-wheel driven connection manager (`timers.connection_alive_interval` 5 s); test packets only when traffic flows one way. NAT keepalive punches require `punchy.punch` (default off)

### Packet Processing
- [x] **Zero-allocation parsing** - Header and firewall tuple parsed into reused per-routine structs; no heap allocation on the hot path
- [x] **Zero-copy filtering** - The firewall reads addresses and ports in place from the packet buffer; only a small fixed-size 5-tuple struct is copied for the conntrack lookup

### State Synchronization
- [ ] **Delta updates** - Lighthouse updates send full address list
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression
- [ ] **Configurable compression level** - No data-plane compression, so there is nothing to configure

# Security

Nebula has had relatively few security vulnerabilities. The most notable recent issue was fixed in version 1.9.7.

## Known Security Issues

**Source-IP acceptance bug (fixed in v1.9.7, 2025-10-10, PR #1494)**: Nebula could incorrectly accept and process packets from an erroneous source IP when the sender's certificate was configured with unsafe_routes (cert v1/v2) or multiple IPs (cert v2). This allowed IP spoofing from inside the overlay. The fix enforces stricter source IP validation against the certificate's networks.

**Dependency fixes**: v1.8.1 updated `golang.org/x/crypto` for CVE-2023-48795 (Terrapin), and v1.5.2 fixed an SSH server panic; both affect only the optional debug SSH server (`sshd`, disabled by default).

## Potential Security Concerns

**Initiator identity in cleartext**: Because the handshake is Noise IX, the initiator's certificate (name, VPN IPs, groups, public key) is sent unencrypted in the first handshake message. Passive observers can tell which node is connecting.

**No automatic periodic rekeying for long-lived sessions**: The Noise IX handshake provides PFS through ephemeral Diffie-Hellman key exchange, so compromise of long-term keys does not expose past session traffic. However, there is no timer- or volume-based rekeying for long-lived tunnels. The message counter increments indefinitely, so compromise of a session key exposes traffic on that session until the tunnel is torn down and re-established.

**Unauthenticated recv_error**: Packets for unknown tunnel indexes trigger a 16-byte `recv_error` reply by default (`listen.send_recv_error: always`). The reply is not larger than the trigger, so it is not an amplifier, but it reveals that Nebula is running. Received `recv_error` packets are unauthenticated and tear down the matching tunnel if they come from the peer's current address, so an attacker who can spoof that address can force re-handshakes. Mitigation: `send_recv_error: never` or `private`. Since 1.9.7 no `recv_error` is sent for packets outside the replay window.

**No handshake rate limiting**: There is no rate limiting or cookie mechanism for incoming handshakes; every handshake message from the internet costs a DH operation and certificate verification.

**Roaming validation**: Hosts can roam to new addresses after authentication. Roaming only happens on packets that decrypt correctly with the established session keys, so an attacker cannot hijack a tunnel without possessing them. The `remote_allow_list` provides an additional layer of restriction on which source IPs are accepted for roaming.

**Certificate blocklist distribution**: No automatic distribution mechanism exists. Revoked certificates may remain valid until manual config reload occurs across all nodes.

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No handshake or control-packet rate limiting; only `send_recv_error` limits which unauthenticated replies are sent
- [x] **Stateful packet filter** - Connection tracking for stateful firewall rules
- [x] **Fine-grained ACLs** - Per-port, protocol, host, group, CIDR access control
- [x] **Capability-based access** - Group-based and CA-based rule matching

### Identity & Authentication
- [x] **Identity validation** - Certificate-based cryptographic verification during handshake
- [ ] **Signed configuration updates** - Config files are not signed. Certificates are signed by the CA and can be hot-reloaded via SIGHUP, but the config itself has no integrity protection.
- [x] **Certificate pinning** - No WebPKI involvement: lighthouses and relays are authenticated by the private CA pool (`pki.ca`) and their fixed VPN IP; blocklist by certificate fingerprint

### Implementation
- [x] **Memory-safe language** - Written in Go (garbage collected, memory safe)
- [ ] **Privilege separation** - Runs as single process, typically requires root for TUN device
- [ ] **Sandboxing** - No process isolation or sandboxing implemented
- [x] **Audit logging** - Security events logged (handshakes, firewall drops, certificate errors)

# NAT Traversal

Nebula implements sophisticated NAT traversal through UDP hole punching coordinated by lighthouses, with relay fallback for difficult NAT scenarios.

## How NAT Traversal Works

**Discovery Phase**: When Node A wants to connect to Node B, it queries configured lighthouses for B's known addresses. The lighthouse has learned these addresses from:
1. HostUpdateNotification messages B sent (reported addresses)
2. The UDP source addresses B's packets arrived from (learned addresses)

**Hole Punching**: The lighthouse sends a HostPunchNotification to Node B, telling it to initiate punching to Node A's addresses. Both nodes send UDP packets to each other's addresses, creating NAT mappings.

**Punchy Configuration**: Receiving a HostPunchNotification always triggers 1-byte punches (after `punchy.delay`, default 1 s). The `punchy` section adds:
- `punchy.punch` (default false; the example config enables it) - Sends periodic punch packets on tunnels to keep NAT mappings alive
- `punchy.respond` (default false) - After `punchy.respond_delay` (default 5 s), the punched node sends a test packet back, which makes it initiate a handshake toward the querier. This helps when only the querying side is behind a hard (e.g. symmetric) NAT
- `punchy.delay` - Delay before punching (handles misbehaving NATs)
- `punchy.target_all_remotes` - Punch all known addresses instead of only the current one

**Relay Fallback**: For symmetric NAT or double NAT scenarios where hole punching fails, Nebula (since 1.6.0) uses relay tunnels. A node lists in `relay.relays` the VPN IPs of nodes that may relay traffic *to it*. Those relay nodes must set `relay.am_relay: true` and advertise themselves to the lighthouse. Peers learn them from the lighthouse and, with `relay.use_relays` (default true), request relayed tunnels through all of them in parallel. Relaying is single-hop (relays cannot use relays). The relay only authenticates the outer hop; the inner packet stays end-to-end encrypted between the two peers.

## NAT Traversal Checklist

### Discovery
- [ ] **No own public node needed** - The user must run a lighthouse on a routable address and list it in `static_host_map`; nothing is built in (`README.md:85-89`, `lighthouse.go:350,369-377`)
- [x] **STUN support** - Lighthouse learns public addresses from UDP source IPs (STUN-like behavior)
- [x] **Multiple STUN servers** - Can configure multiple lighthouses for redundancy
- [ ] **NAT type detection** - No explicit NAT type detection, relies on hole punching attempts

### Port Mapping
- [ ] **UPnP port mapping** - Not supported
- [ ] **NAT-PMP support** - Not supported
- [ ] **PCP support** - Not supported

### Hole Punching
- [x] **UDP hole punching** - Bidirectional hole punching coordinated by lighthouse
- [x] **Symmetric NAT handling** - Partial: no port prediction or birthday attack; `punchy.respond` (off by default) reverses the connection direction when one side is behind a symmetric NAT, otherwise relays are needed
- [x] **Rendezvous coordination** - Lighthouse-assisted punch notification system

### Fallback
- [x] **Relay fallback** - Partial: encrypted relay tunnels when direct connection fails, but relays are opt-in (`am_relay` false and `relays` empty by default) and the config labels them EXPERIMENTAL (`examples/config.yml:204`, `relay_manager.go:40`)
- [x] **Multiple relay regions** - Partial: any number of self-hosted relay nodes can be listed per host; there is no region/geo concept
- [x] **Automatic relay selection** - Partial: the initiator requests relay tunnels through every relay the target advertised and uses the first established one; selection is not latency-based
- [ ] **TCP relay support** - Relay uses UDP only (no TCP relay option)

# Local Routing

Nebula does not have automatic LAN discovery. Peers discover each other exclusively through lighthouse queries or static host map entries, even if they are on the same local network.

## Peer Discovery on LANs

Nodes advertise their local IP addresses to lighthouses (filtered by `local_allow_list`). When a peer queries the lighthouse, it receives both public and private IPs for the target. The node sends handshakes to all advertised addresses in parallel, and the address of the first handshake reply becomes the tunnel endpoint. Without `preferred_ranges`, the candidate list is ordered public IPv4 first, then private IPv4, then IPv6.

**Preferred Ranges**: The `preferred_ranges` configuration lists local network ranges. Matching addresses are sorted first, and established tunnels periodically probe preferred addresses and roam to them (`TryPromoteBest`).

**Static Host Map**: For small networks or specific peering relationships, the static_host_map allows pre-configuring peer addresses, bypassing lighthouse queries entirely.

**Lighthouse DNS**: A lighthouse can optionally serve DNS (`lighthouse.serve_dns`, default off, `lighthouse.dns.host/port`). It answers A/AAAA queries for the certificate names of hosts it has a tunnel with, and TXT queries (from Nebula IPs or localhost only) with the peer's certificate. Nodes do not configure the OS resolver automatically; clients must point at or delegate to the lighthouse.

## Routing Features

**Unsafe Routes**: Nebula can route traffic to non-Nebula networks through gateway nodes. The gateway's certificate must include the routed subnet in its `UnsafeNetworks` field. Supports:
- ECMP (Equal-Cost Multi-Path) with weighted load balancing across multiple gateways
- Per-route MTU configuration
- Metric-based route selection

**System Route Table Integration**: Unsafe routes are installed into the OS routing table by default (`install: true`) on Linux, macOS, BSD and Windows, enabling full tunnel mode (0.0.0.0/0 unsafe route; on Linux use `listen.so_mark` to keep Nebula's own UDP traffic out of the tunnel). On Linux, `tun.use_system_route_table` additionally lets Nebula read routes for its device from the kernel table.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No broadcast/multicast LAN announcements
- [x] **Direct path advertisement** - Nodes share local IPs through lighthouse
- [ ] **Same-subnet detection** - No automatic detection; `preferred_ranges` is a manual hint

### LAN Optimization
- [x] **Automatic LAN preference** - Handshakes go to all known addresses and the first reply wins (usually the LAN path); `preferred_ranges` makes the preference explicit and enables later promotion
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [x] **LAN-only mode** - Partial: no dedicated toggle; achievable via `lighthouse.remote_allow_list` restricting remotes to private CIDRs (plus `preferred_ranges` and firewall rules)

### Routing Features
- [x] **Subnet routes** - Unsafe routes to other networks through gateway peer
- [x] **Full tunnel mode** - 0.0.0.0/0 unsafe route supported
- [x] **Split tunneling** - Default mode (only tunnel VPN IPs, not all traffic)
- [x] **Route priorities** - ECMP weighted routing and metric-based selection

# Central Point of Failure

Lighthouses are **NOT** a single point of failure for data plane operations. However, they are critical for control plane peer discovery.

## What Happens When Lighthouse Fails

**Existing tunnels continue working**: Lighthouses are only involved in peer discovery and address updates. Once a tunnel is established, data flows directly between peers without lighthouse involvement.

**New connections fail discovery**: Attempts to connect to previously unknown peers will fail because there is no way to discover their addresses.

**Static host map still works**: Peers configured in static_host_map can be reached without lighthouse queries.

**Peer roaming still mostly works**: An authenticated packet from a new address updates the peer's endpoint directly, so roaming between two peers that already share a tunnel works without the lighthouse as long as the roaming side keeps sending. Without a lighthouse, a peer whose address changed and that does not send cannot be found again by others.

## Mitigation Strategies

**Multiple lighthouses**: Configure multiple lighthouse nodes for redundancy. Nodes query all configured lighthouses and accept responses from any of them.

**Self-hosted lighthouses**: Run your own lighthouse infrastructure rather than relying on external services.

**Static host map**: For critical peering relationships, use static_host_map to bypass lighthouse dependency entirely.

**Lighthouse-less operation**: Small networks can operate with only static_host_map entries for all peers, eliminating lighthouse dependency completely.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Tunnels stay up without lighthouse
- [ ] **Local state caching** - Lighthouse responses and learned endpoints are kept in memory only (RemoteList); nothing is persisted across restarts (`remote_list.go:546-613`)
- [x] **Cached credentials** - Certificates are local files valid without control server contact; no ongoing connectivity required to maintain network identity
- [x] **Graceful degradation** - Existing tunnels work, new discoveries fail

### Redundancy
- [x] **Self-hosted controller** - Can run own lighthouse infrastructure
- [x] **Controller redundancy** - Multiple lighthouses supported
- [x] **Relay redundancy** - Partial: multiple relay nodes can be configured, but this rests on the same opt-in, experimental relay feature (`examples/config.yml:204-216`)
- [ ] **No single root of trust** - Nebula uses a CA-based PKI model. Multiple CAs can be configured in the CA pool, but all certificates must be signed by a trusted CA. Lighthouses provide discovery redundancy, not trust decentralization.

### Efficiency
- [ ] **Delta/incremental updates** - HostUpdateNotification sends full address list
- [ ] **Long polling / push updates** - Polling-based updates on interval
- [x] **Configurable sync interval** - Lighthouse interval adjustable (default 10s)

# Authentication

Nodes authenticate and join the network through Nebula's certificate-based PKI system. There is no interactive enrollment - all authentication is based on pre-distributed certificates.

## Certificate-Based Authentication

**Certificate Generation**:
1. Administrator generates CA key pair using `nebula-cert ca`
2. For each node, administrator generates host certificate using `nebula-cert sign`
3. Host certificate includes: VPN IP(s), name, groups, unsafe routes, validity period
4. Host certificate is signed by CA private key

**Node Enrollment**:
1. Node receives three files: CA certificate, host certificate, host private key
2. Node starts with these files configured in `pki` section
3. During first handshake with any peer, mutual certificate verification occurs
4. Both peers verify the other's certificate is signed by trusted CA
5. Both peers check certificate validity period and blocklist
6. Tunnel established after successful mutual verification

**Certificate Management**:
- Certificates can be hot-reloaded with SIGHUP signal
- Blocklist updates can revoke compromised certificates
- No automatic renewal in open-source Nebula - certificates must be manually regenerated before expiry (Defined Networking's managed Nebula service provides automatic renewal)
- `pki.disconnect_invalid` (default true) tears down tunnels whose peer certificate has expired or became invalid; blocklisted certificates are always disconnected

## Authentication Checklist

### Enrollment Methods
- [ ] **Pre-authentication keys** - Uses certificate-based enrollment instead (see below)
- [x] **Certificate-based enrollment** - CA-signed certificates encode identity (name, groups, IPs) cryptographically, avoiding the need to distribute keys to every peer
- [ ] **OAuth/OIDC** - Not supported
- [ ] **Interactive login** - No browser-based or interactive authentication
- [ ] **CLI authentication** - No interactive CLI auth flow

### Authorization
- [ ] **Admin approval workflow** - No built-in approval workflow
- [ ] **Automated enrollment rules** - No conditional authorization
- [ ] **Ephemeral nodes** - Certificate validity period provides time-limited authorization
- [x] **Node expiry** - Certificate NotBefore/NotAfter enforces expiration

### Identity
- [x] **Stable device identity** - Certificate public key provides persistent identity
- [x] **Identity portability** - Can copy certificate files to new device
- [ ] **Multi-user support** - No user concept: identity is a per-host certificate. Multiple Nebula instances with separate certificates can run on one device

# Platform Support

Nebula supports a wide range of platforms with full userspace implementation for portability.

## Supported Platforms

**Desktop/Server**:
- Linux (amd64, 386, arm v5/v6/v7, arm64, ppc64le, mips/mipsle/mips64/mips64le, riscv64, loong64)
- macOS (Intel and Apple Silicon)
- Windows (amd64, arm64)
- FreeBSD, OpenBSD, NetBSD

**Mobile**:
- iOS (via Mobile Nebula app)
- Android (via Mobile Nebula app)

## Implementation Details

**Userspace Implementation**: Nebula runs entirely in userspace using TUN devices. It does not use kernel modules or require kernel modifications. This provides:
- Easy deployment across platforms
- No kernel version dependencies
- Simpler security model
- Lower performance compared to kernel implementations

**TUN Device**: Uses Layer 3 TUN devices (IFF_TUN flag on Linux) for IP packet routing. Does not support TAP devices or Layer 2 Ethernet frames.

**Windows Implementation**: Uses the WinTun driver for the TUN device and Registered I/O (RIO) for UDP, falling back to standard sockets if RIO is unavailable.

**Container Support**: Official distroless image `nebulaoss/nebula` (since 1.9.0, built from `docker/Dockerfile`). Needs NET_ADMIN and `/dev/net/tun`. No specialized Kubernetes CNI plugin, but it can run as a sidecar or node-level daemon.

**Performance Optimizations**:
- Linux only: `routines` with multi-queue TUN (IFF_MULTI_QUEUE) and SO_REUSEPORT UDP sockets
- Linux: recvmmsg batch packet reception (64 per call); Windows: RIO
- All platforms: preallocated per-routine buffers; per-routine conntrack cache when `routines > 1`
- Not implemented: sendmmsg, UDP GSO/GRO, TUN offloads (IFF_VNET_HDR), PMTU discovery

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support, the only platform with multi-routine scaling and recvmmsg
- [x] **macOS** - Full support (userspace only)
- [x] **Windows** - Full support using WinTun driver
- [x] **FreeBSD/OpenBSD** - BSD support

### Mobile
- [x] **iOS** - In-repo iOS TUN support (`tun_ios.go`); app is the separate Mobile Nebula project
- [x] **Android** - In-repo Android TUN support (`tun_android.go`, single routine, no recvmmsg); app is the separate Mobile Nebula project

### Implementation
- [ ] **Kernel-mode datapath** - No kernel-mode packet processing
- [x] **Userspace implementation** - Runs entirely in userspace with TUN devices
- [x] **Container support** - Official `nebulaoss/nebula` image; works in Docker/Kubernetes with NET_ADMIN and `/dev/net/tun`
