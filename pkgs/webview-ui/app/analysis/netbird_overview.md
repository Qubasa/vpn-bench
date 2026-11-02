# Overview

NetBird is an open-source mesh VPN developed by NetBird GmbH. It builds a peer-to-peer WireGuard overlay between hosts and adds a central control plane for peer registration, access policies, routes and DNS. Peers find each other through ICE (a fork of pion/ice) with STUN, port mapping and a NetBird relay fallback. On Linux the data plane is the in-kernel WireGuard module whenever it is available. On every other platform, and on Linux without the module, NetBird runs a fork of wireguard-go in userspace.

The repository is mixed-licensed. The client, shared libraries and most of the tree are BSD-3-Clause. The server components `management/`, `signal/`, `relay/` and `combined/` are AGPLv3 according to the root LICENSE. `proxy/` and `tools/idp-migrate/` also ship AGPL LICENSE files, although the root LICENSE and `LICENSES/REUSE.toml` do not list them.

## Key Architecture Components

**Management service**: The central controller. It stores accounts, users, peers, groups, policies, routes, DNS settings, setup keys and posture checks in SQLite, PostgreSQL or MySQL. It computes a network map for every peer and pushes it over a long-lived gRPC stream. It also hands out the STUN/TURN and relay URLs and short-lived relay tokens.

**Signal service**: A gRPC rendezvous server that forwards ICE offers, answers and candidates between peers. The message bodies are end-to-end encrypted between the two peers with their WireGuard keys. The signal server only sees sender and recipient public keys.

**Relay service**: NetBird's own relay. Clients connect to it over QUIC (datagrams) or WebSocket (TCP), whichever connects first. It forwards WireGuard packets between two peers registered on the same relay instance. It replaces TURN as the default fallback; pion TURN is only used when one side has no relay configured.

**STUN server**: A minimal embedded STUN server (Binding requests only). It is started by the combined server by default and by the relay binary with `--enable-stun`.

**Combined server**: One binary (`netbird-server`) that runs management, signal, relay, STUN and an embedded Dex OIDC provider. Everything except STUN is multiplexed on one TLS port (default 443).

**Client daemon**: Runs as a root service. It creates the WireGuard interface (`wt0`), runs one ICE agent and one relay worker per remote peer, programs the firewall (nftables, iptables or a userspace filter), installs routes and runs a local DNS resolver. A desktop UI (Fyne), CLI and gomobile bindings for Android and iOS talk to it.

**WireGuard data plane**: All peer traffic is plain WireGuard (Noise IKpsk2, ChaCha20-Poly1305). NetBird does not add its own packet header. Direct paths are UDP to the peer's ICE-selected address; relayed paths wrap the same WireGuard packets in relay messages.

# Protocol

NetBird separates the control plane (management and signal, both gRPC over HTTP/2 with TLS when the URL is `https`) from the data plane (WireGuard over UDP, or WireGuard inside relay messages).

## Control Plane

- **Management Login/Sync** - `Login` registers or re-authenticates a peer (setup key, JWT or an already-known WireGuard key). `Sync` is a server-streaming RPC: the server pushes a full `NetworkMap` (peer config, remote peers, routes, DNS config, firewall rules, route firewall rules, SSH auth, posture-check file list) on every relevant change. A 1 s debouncer coalesces bursts of updates. The client drops maps whose serial is older than its current one.
- **Management message encryption** - Every request and response body is an `EncryptedMessage`: protobuf sealed with NaCl box (X25519, XSalsa20-Poly1305) between the peer's WireGuard key and the management server's WireGuard key. A successful decryption proves the peer owns its WireGuard private key. The server key is fetched with `GetServerKey` before each call and is not pinned, so server authenticity rests on TLS.
- **Signal exchange** - OFFER, ANSWER, CANDIDATE, MODE and GO_IDLE messages carry ICE credentials and candidates, the WireGuard listen port, the relay server address, a session ID and the optional Rosenpass public key. The body is NaCl-box encrypted between the two peers. Registration on the signal server is by a public key in a gRPC header, without proof of possession.
- **Relay handshake** - The client authenticates to the relay with an HMAC-SHA256 token issued by management (default 12 h validity) and registers with a peer ID derived from a SHA-256 hash of its public key.

## Data Plane

Each remote peer gets a connection object that starts two workers in parallel: an ICE worker and a relay worker. The relay usually connects first and is installed as the WireGuard endpoint at priority 1. When ICE finds a direct pair (host or server-reflexive), NetBird pauses the relay proxy and points the WireGuard peer endpoint directly at the remote UDP address (priority 3). If ICE later fails, traffic switches back to the relay, which stays connected as a standby. A TURN-relayed ICE pair (priority 2) is only possible when the relay is not available on both sides.

Packets on the direct path are standard WireGuard transport messages (16-byte header plus 16-byte Poly1305 tag) over UDP, sent from the WireGuard port (default 51820). ICE STUN checks share that port: in kernel mode through a raw socket with a BPF filter that only passes STUN, in userspace mode by demultiplexing in the WireGuard bind.

On the relayed path the WireGuard packet is wrapped in a 2-byte relay header plus a 36-byte destination peer ID and sent as a QUIC datagram or a binary WebSocket message. In kernel mode a local proxy (eBPF-assisted with raw sockets, or a plain UDP proxy) moves packets between the relay connection and the kernel WireGuard socket.

The data plane is Layer 3. The overlay address space is IPv4 (`100.64.0.0/10`).

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Default; direct WireGuard over UDP after ICE
- [x] **TCP fallback** - The NetBird relay over WebSocket (TCP/TLS, `/relay` on port 443) is raced against QUIC and used if UDP is blocked
- [x] **QUIC support** - Relay transport only: QUIC with unreliable datagrams, raced against WebSocket. Not used for direct peer traffic. Forced off (WebSocket only) when the MTU is set above 1280
- [x] **WebSocket support** - Relay transport (binary messages over TCP); always used in the browser (wasm) client

### IP Support
- [x] **IPv4 support** - Overlay addresses come from `100.64.0.0/10`; IPv4 network routes and exit nodes
- [ ] **IPv6 support** - Peers only get an IPv4 overlay address. IPv6 route types exist in the data model, but the nftables and iptables routers skip IPv6 prefixes ("IPv6 support not yet implemented"), and an IPv4 exit node installs an IPv6 unreachable default ("TODO remove this once we have ipv6 support")
- [ ] **Dual-stack** - No IPv6 overlay addressing; the interface has one IPv4 address

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - WireGuard interface (kernel) or TUN device (userspace)
- [ ] **Layer 2 (Ethernet) mode** - Not supported
- [ ] **Bridging support** - Not supported; LANs are reached through routing peers at Layer 3

### Advanced
- [x] **Multipath/bonding** - Partial: the relay connection stays open as a warm standby while ICE is active and takes over when ICE fails. No aggregation, and only one ICE pair is active
- [ ] **QoS/traffic shaping** - No QoS, DSCP or shaping code; only TCP MSS clamping in the userspace filter
- [ ] **Multicast support** - Not supported; routes to multicast prefixes are rejected and ICE mDNS is disabled

# Encryption

NetBird does not define its own tunnel cryptography. Peer traffic uses the WireGuard protocol, either from the Linux kernel module or from NetBird's wireguard-go fork: the Noise construction `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s`. Control-plane payloads to management and signal are additionally sealed with NaCl box using the same WireGuard key pair.

## Encryption Layer Details

**Key Exchange**: WireGuard Noise IKpsk2 with X25519. Each peer's static key is generated locally and stored in the client config; management distributes the public keys. The PSK slot is filled with an optional pre-shared key from the local client config (`--preshared-key`), or with the Rosenpass output when Rosenpass is enabled.

**Post-quantum option (Rosenpass)**: `--enable-rosenpass` (default off, marked experimental) starts a go-rosenpass instance per client. Rosenpass public keys are exchanged through the encrypted signal messages. Rosenpass runs its own handshake over the tunnel (to the peer's NetBird IP) and writes each derived key into the WireGuard PSK slot. If a Rosenpass handshake expires, a random PSK is installed so the WireGuard session fails closed. `--rosenpass-permissive` allows peers without Rosenpass. Enabling Rosenpass disables lazy connections. The Rosenpass key pair is generated at startup and is authenticated only by the classical NaCl-box signal channel.

**Symmetric Cipher**: ChaCha20-Poly1305 only; there is no cipher negotiation.

**Nonce Construction**: WireGuard's 64-bit per-keypair counter, carried in each transport message.

**Replay Protection**: WireGuard sliding window (kernel: 8192-bit counter bitmap; wireguard-go: equivalent filter).

**Re-keying**: WireGuard re-handshakes every 120 s of use (`RekeyAfterTime`) and rejects keys older than 180 s.

**Control-plane sealing**: NaCl box (X25519 + XSalsa20-Poly1305) with a random 24-byte nonce for management and signal payloads.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - X25519 inside WireGuard's Noise IKpsk2
- [x] **Perfect Forward Secrecy** - Ephemeral X25519 per WireGuard handshake
- [x] **Post-quantum readiness** - Partial: Rosenpass hybrid PSK is opt-in and marked experimental; off by default
- [x] **Key rotation** - WireGuard re-keys every 2 minutes; with Rosenpass the PSK is also rotated

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305
- [x] **Hardware-accelerated crypto** - SIMD ChaCha20-Poly1305 in the kernel crypto library or in `golang.org/x/crypto` assembly (no AES-NI path, as there is no AES option)
- [x] **Constant-time operations** - Kernel and Go crypto libraries

### Protocol Security
- [x] **Replay protection** - WireGuard sliding-window counter check
- [x] **Noise Protocol or equivalent** - Noise IKpsk2
- [x] **No cleartext metadata** - WireGuard encrypts the initiator's static key and data packets carry only a random receiver index. Control-plane traffic carries public keys (gRPC header, relay peer ID) but inside TLS when the URLs are `https`/`rels`. Plain `http`/`rel` deployments expose them

# Performance

NetBird's performance depends on which WireGuard implementation the client selects. On Linux the selection order is: netstack mode if `NB_USE_NETSTACK_MODE=true`, otherwise kernel WireGuard if the module is present or can be loaded (unless `NB_WG_KERNEL_DISABLED=true`), otherwise a TUN device with userspace wireguard-go. A stock Linux install with a kernel of 5.6 or newer therefore uses kernel WireGuard. macOS, Windows, FreeBSD, Android and iOS always use userspace WireGuard.

## Threading Model

**Default on Linux (kernel WireGuard)**:
- Encryption and decryption run in the kernel on per-CPU workers, with per-peer ordered queues. No NetBird code is on the direct-path hot path
- Large GSO packets from the local stack are accepted by the WireGuard device and segmented before encryption; decrypted packets enter the stack through NAPI GRO
- ACLs are enforced by netfilter (nftables, or iptables if nftables is unusable) with kernel conntrack
- Relayed peers are the exception: packets cross userspace through a per-connection proxy (eBPF port redirection with raw sockets, or a plain UDP proxy) and are written one at a time to the QUIC or WebSocket relay connection

**Userspace fallback and other platforms (wireguard-go fork, synced with upstream in January 2026)**:
- One encryption, one decryption and one handshake goroutine per CPU, with per-peer inbound and outbound queues
- `ICEBind` wraps `StdNetBind`: one UDP socket per address family on the WireGuard port, shared with ICE
- On Linux the bind reads with `recvmmsg` and writes with `sendmmsg` in batches of 128 (`IdealBatchSize`), with UDP GSO (`UDP_SEGMENT`) on send and UDP GRO (`UDP_GRO`) on receive, falling back automatically if the kernel rejects GSO
- The TUN device is opened with `IFF_VNET_HDR` and `TUNSETOFFLOAD` (checksum, TSO4/TSO6, and USO when the kernel supports it), so TUN reads and writes are batched as well
- A device filter wraps the TUN device. On Linux, when nftables/iptables work, it only installs DNS-interception hooks. Elsewhere it runs the full userspace firewall (gopacket decoding with pooled parsers, per-protocol conntrack)
- Packets for relayed peers bypass the UDP socket: `ICEBind.Send` writes them one by one to the relay connection, and received relay packets enter wireguard-go through a channel with capacity 1

**Control plane**: Each remote peer has its own goroutines for ICE, relay, the handshaker and a reconnect guard. Management and signal each use one gRPC stream.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Kernel WireGuard per-CPU crypto workers by default; NumCPU goroutines in wireguard-go
- [x] **Per-peer packet queues** - Kernel WireGuard per-peer tx/rx queues; per-peer queues in wireguard-go

### Packet I/O
- [ ] **Batch UDP receives** - N/A on the default Linux path (kernel WireGuard, no socket syscalls). The userspace fallback uses `recvmmsg` (128 per call)
- [ ] **Batch UDP sends** - N/A on the default Linux path. The userspace fallback uses `sendmmsg`
- [ ] **Large batch sizes** - N/A on the default Linux path. The userspace fallback uses batches of 128 on socket and TUN I/O

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - N/A on the default Linux path (kernel WireGuard segments GSO packets itself before encryption). The userspace fallback uses `UDP_SEGMENT`
- [ ] **UDP GRO (Generic Receive Offload)** - N/A on the default Linux path (the kernel uses NAPI GRO on decrypted packets). The userspace fallback enables `UDP_GRO`

### Buffer Management
- [ ] **Buffer pool reuse** - N/A on the default Linux path (kernel skbs). wireguard-go uses `sync.Pool` message and element pools
- [ ] **Large UDP socket buffers** - N/A on the default Linux path (NetBird does not tune the kernel WireGuard socket). The userspace fallback requests 7 MiB with `SO_RCVBUFFORCE`/`SO_SNDBUFFORCE`

### Userspace TCP Stack (optional)
- [x] **Userspace TCP implementation** - Partial: gVisor netstack is used only in opt-in netstack mode (`NB_USE_NETSTACK_MODE`, the rootless container image, the embeddable Go client, and always in the wasm client), and by the userspace filter's forwarder when a routing peer has no native firewall. The default Linux path uses no userspace stack
- [ ] **Large TCP RX/TX buffers** - Netstack mode sets only SACK; the forwarder accepts TCP with a 32 KiB initial receive buffer. Otherwise gVisor defaults
- [ ] **Tuned congestion control** - No congestion-control option set; gVisor default
- [ ] **Reordering tolerance** - No recovery option set; inherits gVisor's default RACK loss detection

### Receive Path
- [x] **TCP/packet coalescing on ingress** - Kernel path: NAPI GRO on decrypted packets. Userspace fallback: wireguard-go TCP/UDP GRO coalescing before writing to the vnet-hdr TUN
- [ ] **RX checksum offload** - Relies on the kernel; no NetBird-specific code

### MTU Handling
- [x] **Conservative MTU** - Default 1280 (allowed range 576-8192). Management can push an MTU (`PeerConfig.mtu`), but the server code in this repository never sets it
- [ ] **Path MTU discovery** - No PMTU probing between peers; static MTU. Plus TCP MSS clamping in the userspace filter

### Peer Management
- [x] **Lazy peer removal** - Partial: lazy connections (opt-in, experimental) open a peer connection on first traffic or signal offer and, in userspace mode, close it after 15 min of inactivity. Off by default
- [x] **Endpoint caching** - Partial: the selected ICE pair and WireGuard endpoint are kept for the live connection and the relay stays as a standby; nothing is persisted and every reconnect runs full ICE gathering
- [x] **Efficient keepalive timers** - Partial: fixed per-peer timers, with WireGuard persistent keepalive every 25 s plus ICE STUN keepalives every 4 s on each connected peer. There is no idle back-off unless lazy connections are enabled

### Packet Processing
- [ ] **Zero-allocation parsing** - N/A on the default Linux path (kernel parsing). The userspace filter uses pooled gopacket parsers but allocates per new flow and per dropped packet
- [ ] **Zero-copy filtering** - N/A on the default Linux path (netfilter in kernel). The userspace filter decodes in place from the packet buffer

### State Synchronization
- [ ] **Delta updates** - Management sends the full network map on each update
- [ ] **Compression** - No gRPC compression configured

### Data Plane Compression
- [ ] **Tunnel compression** - Not supported
- [ ] **Configurable compression level** - Not applicable

# Security

NetBird relies on WireGuard for tunnel security and on the management server for all trust decisions. Its attack surface is mostly in the control plane, the client daemon and the optional embedded SSH server.

## Known Security Issues

The repository history at this commit contains no CVE or GHSA references. Security-related commits are container base-image updates for `client/Dockerfile` and an `x/crypto` upgrade (#3055). `SECURITY.md` asks for reports to security@netbird.io and states that only the latest version is supported.

## Potential Security Concerns

**Management server is the single root of trust**: Management decides which WireGuard public keys each peer accepts, which routes it installs and which firewall rules apply. The network map is not signed. The NaCl box server key is generated in memory per process and fetched over TLS before each call without pinning, so a compromised or impersonated management server (for example through a mis-issued TLS certificate, or a plain `http` URL) can add arbitrary peers to any client.

**Unauthenticated signal registration**: A client registers on the signal server by sending a public key in a gRPC header, without proof of possession, and a newer stream replaces the old one. Anyone who can reach the signal server can take over another peer's signal stream. They cannot read the encrypted bodies, but they can block that peer's connection setup.

**Local daemon socket**: The daemon runs as root and chmods its Unix socket (`/var/run/netbird.sock`) to 0666 without checking peer credentials. Any local user can call `SetConfig`/`Login` (for example to change the management URL) unless the service was installed with `--disable-update-settings`.

**Userspace filter gaps**: On platforms that use the userspace filter (macOS, Windows, FreeBSD, Android, iOS, or Linux without nftables/iptables), IPv4 fragments are passed without ACL checks and outbound traffic is not filtered by ACLs. The kernel path uses netfilter and is not affected.

**Embedded SSH server**: The optional NetBird SSH server authenticates with JWTs from the IdP. With `--disable-ssh-auth` it accepts connections without authentication, protected only by the NetBird ACL and a source-IP check. Pre-existing configs without an explicit value default to allowing the SSH server for backward compatibility.

**Peer approval in the open-source build**: The `PeerApprovalEnabled` setting exists, but the validator compiled into the open-source management server (`management-integrations`) is a stub that marks every peer as valid.

**Rosenpass trust**: Rosenpass public keys are exchanged through signal messages protected by classical X25519 NaCl box. This protects against passive harvest-now-decrypt-later attacks, but an active attacker with a quantum computer could substitute keys.

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - WireGuard cookie/ratelimiter under handshake load (kernel and wireguard-go). On the control side: a management Sync concurrency cap and a per-key login filter (it only blocks with `NB_BLOCK_SAME_PEERS=true`); no rate limiting on signal or relay
- [x] **Stateful packet filter** - Kernel conntrack (`ct state established,related`) with nftables/iptables; own TCP/UDP/ICMP conntrack in the userspace filter
- [x] **Fine-grained ACLs** - Policies with protocol (TCP/UDP/ICMP/all), ports and port ranges, accept/drop, uni- or bidirectional; default-deny inbound on the NetBird interface
- [x] **Capability-based access** - Group-based policies, network resources and posture checks (NetBird version, OS version, geolocation, peer network range, running process)

### Identity & Authentication
- [ ] **Identity validation** - Peers are identified by their WireGuard public key and WireGuard only accepts keys in the management-pushed map, but management assigns each peer a random IP from the range; the address is not derived from the key and no CA certificate binds it (same model as Tailscale) (`management/server/peer.go:759`, `management/server/types/network.go:204`)
- [ ] **Signed configuration updates** - The network map is only protected by TLS plus NaCl box with an unpinned server key; it is not signed by an offline authority
- [ ] **Certificate pinning** - Management, signal and relay are authenticated by WebPKI TLS (system roots, embedded fallback) only

### Implementation
- [x] **Memory-safe language** - Go. The default Linux data plane is the kernel WireGuard module (C)
- [ ] **Privilege separation** - The daemon runs as root (or SYSTEM). The only privilege drop is in the SSH server for user sessions. The rootless image (netstack mode with a SOCKS5 proxy) is the exception
- [ ] **Sandboxing** - No seccomp, landlock or similar. A hardened systemd unit template exists in `release_files` but is not used by the deb/rpm packages
- [x] **Audit logging** - Management activity events (peer, user, policy, route, setup-key and DNS changes, logins). Client flow logging (conntrack events) is sent to an external collector when management enables it

# NAT Traversal

NetBird uses standard ICE (a NetBird fork of pion/ice v4) for NAT traversal, combined with gateway port mapping and its own relay as a parallel fallback.

## How NAT Traversal Works

**Candidate gathering**: Each per-peer ICE agent gathers host and server-reflexive candidates over UDP4 and UDP6 on the WireGuard port, plus TURN relay candidates when TURN is still in use. STUN and TURN URLs, including TURN credentials, come from management. mDNS candidates are disabled. Interfaces from a default blacklist (`wt`, `utun`, `wg`, `ts`, `tailscale`, `zt`, `docker`, `veth`, `br-`, `lo`, ...) are ignored. Remote candidates inside routed networks are dropped so the tunnel is not used to reach itself.

**Port mapping**: A port-forward manager first tries PCP (own implementation) and then NAT-PMP/UPnP (`libp2p/go-nat`) to map the WireGuard UDP port on the gateway. The mapping uses a 2 h lease and a 1 min health check. The mapped address is signalled as an extra server-reflexive candidate with raised priority. `NB_DISABLE_NAT_MAPPER` turns this off.

**Extra server-reflexive candidate**: When a remote server-reflexive candidate's port differs from its base port, NetBird adds a second candidate with the same IP and the WireGuard base port. This helps NATs that keep the source port or have a static forward. Static 1:1 NAT mappings can be configured as `NATExternalIPs`.

**Connectivity checks**: Offers and answers (ICE ufrag/password plus candidates) travel through the signal server. Both agents run standard ICE connectivity checks, which punch holes from both sides. Keepalive 4 s, disconnected and failed timeouts 6 s each.

**Relay fallback**: The relay worker runs in parallel. The peer with the larger public key (the "controller") uses its own home relay and the other side connects to it. The home relay is chosen by dialing all management-supplied relay URLs (up to 7) at once and keeping the first that connects. When ICE succeeds the relay is paused but kept. When only the relay works, ICE is retried 3 times and then hourly.

## NAT Traversal Checklist

### Discovery
- [x] **No own public node needed** - Partial: the client defaults to NetBird Cloud (`DefaultManagementURL = "https://api.netbird.io:443"`, `client/internal/profilemanager/config.go:34-39`); self-hosting management, signal, relay and STUN needs a public VM on TCP 80/443 and UDP 3478 (`README.md:88-95`)
- [x] **STUN support** - Standard STUN servers from management; an embedded STUN server ships in the combined server and optionally in the relay
- [x] **Multiple STUN servers** - Any number of STUN/TURN URLs can be pushed to clients
- [ ] **NAT type detection** - No NAT classification

### Port Mapping
- [x] **UPnP port mapping** - Via `libp2p/go-nat` fallback, on by default
- [x] **NAT-PMP support** - Via `libp2p/go-nat` fallback, on by default
- [x] **PCP support** - Own PCP client, tried first

### Hole Punching
- [x] **UDP hole punching** - ICE connectivity checks from both sides
- [x] **Symmetric NAT handling** - Partial: no port prediction or birthday attack; gateway port mapping and the extra base-port srflx candidate cover some cases, otherwise the relay is used
- [x] **Rendezvous coordination** - Signal server exchanges encrypted offers, answers and candidates

### Fallback
- [x] **Relay fallback** - NetBird relay (QUIC datagrams or WebSocket), TURN when the relay is not available on both sides
- [x] **Multiple relay regions** - Partial: several relay URLs can be configured and peers connect on demand to the other side's home relay; there is no region concept in the open-source code
- [x] **Automatic relay selection** - Partial: the first relay that connects wins a concurrent dial race; no explicit latency measurement
- [x] **TCP relay support** - Relay over WebSocket (TCP/TLS on 443)

# Local Routing

NetBird has no dedicated LAN discovery. Local paths are found through ICE host candidates.

## Peer Discovery on LANs

Every ICE agent gathers host candidates on all non-blacklisted interfaces and sends them to the remote peer through the signal server. ICE then tests all candidate pairs. In standard ICE, host candidates have the highest type preference, so two peers on the same LAN usually end up on the host-host pair. There is no same-subnet logic beyond that, and multicast DNS is disabled.

## Routing Features

**Network routes and Networks**: Administrators define routes (IP prefixes or domains) served by a routing peer or a group of routing peers, with optional masquerading. The newer "Networks" model adds resources (host, subnet, domain) and routers with the same semantics. Routing peers add forwarding and NAT rules for the routes they serve.

**HA route groups**: Routes with the same network ID and prefix form an HA group. The client scores each router: metric first (lower is better), then a connected bonus, then latency from the ICE round-trip time, then a small bonus for non-relayed connections. It only switches when the new router is clearly better (10 ms hysteresis).

**Exit nodes**: A `0.0.0.0/0` route makes a peer an exit node. Clients auto-select it unless `SkipAutoApply` is set or the user picked another one.

**Domain routes**: With routing-peer DNS resolution enabled, a DNS interceptor resolves route domains through the chosen routing peer and installs routes for the returned IPs. The legacy mode resolves locally every minute.

**Linux route installation**: Routes go into a dedicated table (`0x1BD0`), selected by an ip rule for packets without the NetBird fwmark. A second rule keeps the main table authoritative except for its default route. NetBird's own sockets (WireGuard, ICE, relay, control) carry the fwmark, so full-tunnel mode does not loop.

**Built-in DNS**: The client runs a local resolver: in kernel mode on the NetBird IP or a loopback address on port 53, in userspace mode in memory on a reserved address of the NetBird network. It answers peer names from management-pushed zones (default domain `netbird.selfhosted` for self-hosted setups, custom zones possible). Other queries are forwarded to nameserver groups, which can be global or per domain. It integrates with systemd-resolved, NetworkManager, resolvconf or `/etc/resolv.conf` on Linux.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - None; ICE mDNS is disabled
- [x] **Direct path advertisement** - Host candidates are sent to the peer through the signal server
- [ ] **Same-subnet detection** - No explicit same-subnet logic

### LAN Optimization
- [x] **Automatic LAN preference** - ICE type preference favors host-host pairs
- [ ] **Trusted path mode** - No option to skip WireGuard encryption
- [ ] **LAN-only mode** - No toggle; STUN, relay and TURN cannot be disabled per network except by not configuring them

### Routing Features
- [x] **Subnet routes** - Network routes and Networks resources via routing peers
- [x] **Full tunnel mode** - Exit nodes (`0.0.0.0/0` routes) with fwmark-based policy routing on Linux
- [x] **Split tunneling** - Default; only overlay and routed prefixes go through the tunnel
- [x] **Route priorities** - Metric plus latency-based scoring within HA route groups

# Central Point of Failure

The management server is a central point of failure for the control plane. The signal server is required for new connections. The data plane is peer-to-peer.

## What Happens When Management Fails

**Existing tunnels continue working**: When the Sync stream breaks, the client retries with exponential backoff (up to 3 months) without tearing down the engine. WireGuard peers, routes, firewall rules and DNS stay as they were.

**No changes propagate**: New peers, removed peers, policy changes and key changes are not distributed until management is back.

**Restarts fail**: The client creates its engine only after a successful management login. No network map is cached on disk, so a client that restarts while management is down stays down.

**Signal outage**: Offers and answers go through signal. With signal down, no new ICE or relay connection can be negotiated. Established connections keep working.

**Relay outage**: Peers whose traffic depends on the failed relay lose connectivity until they reconnect through another configured relay or ICE succeeds. Direct ICE connections are not affected.

## Mitigation Strategies

**Self-hosting**: All server components (management, signal, relay, STUN, embedded Dex IdP) can be self-hosted, separately or as the single combined binary. The web dashboard is a separate project.

**Several relays and STUN servers**: Management can hand out multiple relay and STUN/TURN URLs.

**Database choice**: Management can use PostgreSQL or MySQL instead of SQLite, but the open-source code keeps per-peer update channels, the ephemeral-peer list and the server key in process memory, so it does not support several active management instances.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - WireGuard peers and routes stay configured while management or signal is down
- [ ] **Local state caching** - The network map is kept in memory only; the on-disk state file only holds cleanup state (DNS, routes, firewall)
- [x] **Cached credentials** - Partial: the WireGuard private key is stored in the client config and an already-registered peer logs in with it alone, but startup still needs a reachable management server, and SSO-added peers expire after 24 h by default
- [x] **Graceful degradation** - Existing tunnels keep working; new peers, changes and restarts wait for the control plane

### Redundancy
- [x] **Self-hosted controller** - Management, signal, relay and STUN are all self-hostable
- [ ] **Controller redundancy** - No multi-instance management support in the open-source code
- [x] **Relay redundancy** - Multiple relay URLs; the client picks one as home and connects to others on demand
- [ ] **No single root of trust** - Management alone decides peer membership, keys and policies

### Efficiency
- [ ] **Delta/incremental updates** - Full network map per update
- [x] **Long polling / push updates** - Server-streaming gRPC `Sync`, debounced at 1 s on the server
- [ ] **Configurable sync interval** - Not applicable (push-based)

# Authentication

Peers join through the management server, with either a setup key or a user login through an OpenID Connect identity provider.

## Enrollment Methods

**Setup keys**: Reusable or one-off keys with an expiry (default 30 days), an optional usage limit, revocation, auto-assigned groups and an `ephemeral` flag. Management stores only a SHA-256 hash. `netbird up --setup-key` (or `--setup-key-file`) registers the peer without user interaction.

**SSO login**: The client fetches the IdP flow configuration from management. Desktop clients use the OAuth authorization-code flow with PKCE (S256) and a local callback listener, falling back to the device authorization flow (RFC 8628). Headless Linux and FreeBSD clients use the device flow directly. `--no-browser` prints the URL. Management validates the resulting JWT (issuer, audience, JWKS) and can restrict logins to certain IdP groups.

**Identity providers**: The combined server always embeds a Dex OIDC provider. Management also has connectors for Auth0, Authentik, Azure AD, Google Workspace, JumpCloud, Keycloak, Okta, PocketID and Zitadel.

**Peer identity**: The peer's identity is its WireGuard key pair, generated locally and stored in the client config. Management binds the public key to an account and, for SSO peers, to a user.

**Expiration**: SSO-added peers expire after a configurable login period (24 h by default for new accounts) and need to log in again. Inactivity expiration for disconnected SSO peers is optional (default off). Ephemeral peers are deleted about 10 minutes after they disconnect.

**Posture checks and approval**: Posture checks are attached to policies and evaluated by management against metadata the peer reports about itself; failing peers are removed from the policy's sources. Peer approval exists as a setting, but the open-source validator approves every peer.

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Setup keys (reusable or one-off, expiry, usage limit, auto groups)
- [ ] **Certificate-based enrollment** - Not supported
- [x] **OAuth/OIDC** - Embedded Dex or external IdPs; JWT validated by management
- [x] **Interactive login** - Browser login with PKCE from the UI or CLI
- [x] **CLI authentication** - `netbird up` with device flow or a printed login URL

### Authorization
- [x] **Admin approval workflow** - Partial: new accounts default to `UserApprovalRequired=true`, and users joining by domain match stay PendingApproval until an admin approves them. This gates users, not single devices; per-peer approval in the open-source build is a stub that accepts every peer (`management/server/account.go:1224-1226,1904`, `management/server/user.go:1423`)
- [x] **Automated enrollment rules** - Setup-key auto groups, IdP group restrictions, and posture checks on policies
- [x] **Ephemeral nodes** - Ephemeral setup keys; peers are deleted about 10 min after disconnecting
- [x] **Node expiry** - SSO login expiration (default 24 h) and optional inactivity expiration

### Identity
- [x] **Stable device identity** - The WireGuard key pair persists in the client config
- [x] **Identity portability** - Copying the config file (which contains the private key) moves the identity
- [x] **Multi-user support** - Users and roles in management; client profiles for several accounts on one device

# Platform Support

NetBird ships clients for desktop, server, mobile and the browser. Server components are Linux-only.

## Supported Platforms

**Desktop/Server**:
- Linux (amd64, 386, arm, arm64, mips, mipsle, mips64, mips64le); deb and rpm packages
- macOS (Intel and Apple Silicon, universal binary; Homebrew tap)
- Windows (amd64, arm64)
- FreeBSD (userspace WireGuard; the FreeBSD kernel WireGuard module is deliberately unused)

**Mobile**:
- Android (gomobile bindings in `client/android`)
- iOS (gomobile SDK in `client/ios`; uses the OS-provided TUN with userspace WireGuard)

**Other**:
- Browser client (js/wasm): netstack plus relay-only connections, with SSH and RDP helpers
- Embeddable Go library (`client/embed`), netstack mode by default

## Implementation Details

**Kernel WireGuard on Linux**: On Linux the client creates a kernel WireGuard link when the module is present or can be loaded. Packet encryption, decryption and routing then happen in the kernel. NetBird only configures peers and endpoints through netlink and handles ICE, relay proxying, DNS and firewall setup in userspace.

**Userspace WireGuard elsewhere**: macOS, Windows (Wintun driver), FreeBSD, Android, iOS and Linux without the kernel module use NetBird's wireguard-go fork with `ICEBind`, which lets ICE and WireGuard share one UDP socket.

**TUN Device**: Layer 3 only. No TAP or Ethernet bridging.

**Container Support**: Official images `netbirdio/netbird` (Alpine; needs `NET_ADMIN`, `NET_RAW`, `BPF`) and `netbirdio/netbird:*-rootless` (netstack mode with a SOCKS5 proxy, runs as non-root). Server images for management, signal, relay and the combined server are also published. No Kubernetes operator in this repository.

**Performance Optimizations**:
- Linux default: kernel WireGuard (per-CPU crypto, in-kernel GSO segmentation, NAPI GRO), netfilter ACLs
- Userspace fallback: `recvmmsg`/`sendmmsg` (128 per batch), UDP GSO/GRO, TUN vnet-hdr offloads (TSO, USO), 7 MiB socket buffers, NumCPU crypto goroutines
- Not implemented: multi-queue TUN or per-core sockets, PMTU discovery, tunnel compression

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support; kernel WireGuard when available, userspace otherwise
- [x] **macOS** - Full support (userspace, utun)
- [x] **Windows** - Full support (userspace, Wintun)
- [x] **FreeBSD/OpenBSD** - Partial: FreeBSD only (userspace WireGuard); no OpenBSD interface implementation

### Mobile
- [x] **iOS** - In-repo gomobile SDK (`client/ios/NetBirdSDK`); the app is a separate project
- [x] **Android** - In-repo gomobile bindings (`client/android`); the app is a separate project

### Implementation
- [x] **Kernel-mode datapath** - Linux default: kernel WireGuard module when present or loadable (`NB_WG_KERNEL_DISABLED=true` turns it off). Other platforms are userspace only
- [x] **Userspace implementation** - wireguard-go fork on all other platforms and as the Linux fallback; netstack mode for rootless use
- [x] **Container support** - Official client (root and rootless) and server images
