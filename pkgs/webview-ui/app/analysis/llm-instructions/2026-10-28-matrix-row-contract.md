# Feature-matrix row contract

Cell values: `✓` yes (on by default or a normal config option) · `◐` partial / opt-in experimental / only some platforms (explain) · `✗` no · `N/A` row does not apply · `?` still unknown after checking the source.

Every value needs evidence: `repo/path/file.ext:LINE` (or a symbol name) from the source under `/home/lhebendanz/Projects/meshvpns/`.

## A. At-a-glance values (free text, short)

| Key | What to report |
|---|---|
| Language | main implementation language(s) |
| License | from LICENSE file(s) |
| Data cipher (default) | default AEAD for tunnel traffic; list alternatives |
| Handshake | key-exchange construction (e.g. Noise IK X25519, custom ECDH, TLS 1.3) |
| Default tunnel MTU | numeric default and where set |
| Control-plane model | `central server` / `lighthouse/bootstrap nodes` / `fully distributed`, one phrase |
| Data-plane threading | `single-threaded` / `multi-threaded` + one phrase (e.g. "N workers, SO_REUSEPORT") |

## B. Existing rows (report a value for EVERY row)

### Transport
- UDP transport: peer data can flow over plain UDP.
- TCP fallback: peer data can flow over TCP (direct or via relay) when UDP is blocked.
- QUIC support: QUIC is a selectable peer transport in this codebase.
- WebSocket support: WS/WSS usable for peer or relay traffic.

### IP Support
- IPv4 support / IPv6 support: inner (tunneled) traffic of that family.
- Dual-stack: both families on the same virtual interface at once.

### Network Layer Mode
- Layer 3 (IP) mode · Layer 2 (Ethernet) mode · Bridging support (non-VPN LAN devices bridged into the overlay at L2).

### Advanced Protocol Features
- Multipath/bonding: aggregation or active-backup across several underlay paths for one peer.
- QoS/traffic shaping: priority queues, traffic classes or rate limits on tunnel traffic.
- Multicast support: multicast/broadcast frames/packets carried between peers.

### Key Exchange
- Modern key exchange (Curve25519): X25519/Curve25519 ECDH derives the session keys.
- Perfect Forward Secrecy: session keys come from ephemeral keys; leaking long-term keys does not decrypt past traffic.
- Post-quantum readiness: hybrid or PQ KEM available.
- Key rotation: session keys are re-keyed automatically during a long-lived session.

### Symmetric Encryption
- Authenticated encryption: AEAD on the data plane.
- Hardware-accelerated crypto: data-path cipher uses AES-NI/ARMv8-CE or SIMD-optimized code.
- Constant-time operations: crypto via constant-time implementations.

### Protocol Security
- Replay protection: data-plane counter/sliding window check.
- Noise Protocol: handshake is a Noise Framework pattern.
- No cleartext metadata: neither handshake nor data packets reveal a long-term identity (public key, certificate, node ID) to a passive observer.

### Threading
- Multi-threaded processing: data-plane crypto runs on several cores concurrently.
- Per-peer packet queues: per-peer encrypt/decrypt queues (old row; proposed replacement in C).

### Packet I/O
- Batch UDP receives (recvmmsg) · Batch UDP sends (sendmmsg) · Large batch sizes (64+): batch of >=64 packets on socket or TUN I/O.

### UDP Offload
- UDP GSO · UDP GRO (UDP_SEGMENT / UDP_GRO socket options).

### Buffer Management
- Buffer pool reuse: hot-path packet buffers come from a pool/arena.
- Large UDP socket buffers (MB): SO_RCVBUF/SO_SNDBUF >= 1 MiB requested by default.

### Userspace TCP Stack
- Userspace TCP implementation: a userspace TCP/IP stack (gVisor netstack, smoltcp, ...) handles some tunneled traffic. Say for what (default datapath vs optional feature).
- Large TCP RX/TX buffers · Tuned congestion control · Reordering tolerance: properties of that stack as configured by this VPN. `N/A` if no userspace stack.

### MTU Handling
- Conservative MTU: default MTU <= 1420 (old row; proposed replacement by the numeric glance value).
- Path MTU discovery: active PMTU probing/discovery between peers.

### Peer Management
- Lazy peer removal · Endpoint caching (remembers best working endpoint per peer) · Efficient keepalive timers.

### Packet Processing
- Zero-allocation parsing (hot path parses without heap allocation) · Zero-copy filtering.

### Data Plane Compression
- Tunnel compression · Configurable compression (algorithm or level selectable).

### Network Security
- Rate limiting: handshake/control-packet rate limiting against DoS/amplification.
- Stateful packet filter: built-in conntrack firewall for tunnel traffic.
- Fine-grained ACLs: per-port/protocol rules.
- Capability-based access: policies on tags/groups/certificate attributes, not only IPs.

### Identity & Authentication
- Identity validation: identity cryptographically bound (address derived from key, CA-signed cert, PoW).
- Signed config updates: network config/peer list signed by an authority and verified by nodes.
- Certificate pinning: control-plane server identity pinned beyond WebPKI.

### Implementation
- Memory-safe language · Privilege separation (drops root/caps after setup or separate privileged helper) · Sandboxing (seccomp/pledge/chroot/...) · Audit logging (security events logged).

### Discovery
- STUN support: own public endpoint discovered via STUN or server reflection (say which).
- Multiple STUN servers: several discovery servers used/configurable.
- NAT type detection: classifies NAT behavior.

### Port Mapping
- UPnP port mapping · NAT-PMP support · PCP support.

### Hole Punching
- UDP hole punching · Symmetric NAT handling (port prediction, birthday, etc.) · Rendezvous coordination (server/peer assisted).

### Fallback
- Relay fallback · Multiple relay regions · Automatic relay selection (latency-based) · TCP relay support.

### LAN Discovery
- Broadcast/multicast discovery · Direct path advertisement (peers share their local endpoints) · Same-subnet detection.

### LAN Optimization
- Automatic LAN preference · Trusted path mode (skip encryption on trusted links) · LAN-only mode.

### Routing Features
- Subnet routes · Full tunnel mode (exit node / default route via peer) · Split tunneling · Route priorities (HA/failover between routers).

### Offline Operation (controller / lighthouse / bootstrap down)
- Existing connections survive · Local state caching (peer map persisted) · Cached credentials · Graceful degradation.

### Redundancy
- Self-hosted controller · Controller redundancy · Relay redundancy · No single root of trust.

### Enrollment Methods
- Pre-authentication keys · Certificate-based enrollment · OAuth/OIDC · Interactive login · CLI authentication.

### Authorization
- Admin approval workflow · Automated enrollment rules · Ephemeral nodes · Node expiry.

### Identity
- Stable device identity · Identity portability · Multi-user support.

### Platforms (in-repo code or official clients referenced by the repo)
- Linux · macOS · Windows · FreeBSD/OpenBSD · iOS · Android.

### Implementation (platform)
- Kernel-mode datapath: tunnel packets processed in kernel (e.g. kernel WireGuard).
- Userspace implementation.
- Container support: official container image or k8s integration.

## C. Candidate new rows (report a value for each)

- Multi-queue TUN / per-core sockets: IFF_MULTI_QUEUE TUN and/or several UDP sockets (SO_REUSEPORT) driven by separate workers.
- TUN offload (virtio-net hdr): TSO/GSO/GRO on the TUN device via IFF_VNET_HDR / TUNSETOFFLOAD.
- Multi-hop routing via peers: ordinary mesh nodes forward traffic for others (routing protocol), beyond dedicated relay servers.
- End-to-end encryption through relays: relays/intermediate hops cannot decrypt tunneled payload.
- Built-in DNS: VPN resolves peer names itself (MagicDNS-like).
- Fully self-hostable: every component (control, discovery, relay) can run on own infrastructure.

## D. Row critique

List rows that are ill-defined, non-discriminating, or misleading for this VPN, with one line why.

## E. Amendments (decided after the first verification round)

- Extra row "Datagram encapsulation (no head-of-line blocking)": ✓ if on the default path each inner packet is an independent datagram, ✗ if carried in a reliable ordered stream (TCP, QUIC stream, TLS), ◐ if it depends on an opt-in transport.
- Extra glance key "Default peer transport": what a fresh 2-node Linux setup uses for data, plus the fallback.
- Controller rows (Controller redundancy, Cached credentials, Control-server key pinning) are N/A when the design has no controller.
- Performance rows are judged on Linux with the default build. Linux-only syscalls count as ✓ if used on Linux by default.
- A VPN whose default Linux datapath is in the kernel (NetBird with kernel WireGuard) gets N/A on per-packet socket/TUN rows; its userspace fallback is described in the evidence column.
- Extra row "No own public node needed" (Discovery): nodes that are all behind NAT form a mesh. ✓ if the default configuration does it through public nodes the project, vendor or community runs (bootstrap nodes, root servers, shared nodes, hosted control plane); ◐ if such public nodes exist but must be configured by hand, or only a hosted service works while the self-hosted setup needs a public server; ✗ if the user must run at least one node or server with a public address. Hole punching alone does not make it ✓, since the rendezvous still needs a reachable node.
- Overview checklist convention: `- [x] **Item** - ...` yes, `- [x] **Item** - Partial: ...` partial/opt-in, `- [ ] **Item** - ...` no; N/A is stated in the text.

## F. Final matrix layout (feature_matrix.md, 2026-10-28)

Removed rows: Conservative MTU (numeric value moved to At a Glance), Per-peer packet queues, Efficient keepalive timers, Graceful degradation, Lazy peer removal, Zero-copy filtering, Same-subnet detection, Multi-user support, Userspace implementation, Self-hosted controller (replaced by Fully self-hostable), Large TCP RX/TX buffers, Tuned congestion control, Reordering tolerance.

Added rows: Datagram encapsulation (no head-of-line blocking), Multi-queue TUN / per-core sockets, TUN offload (virtio-net hdr), Multi-hop routing via peers, End-to-end encryption through relays, Built-in DNS, Fully self-hostable, No own public node needed.

Renamed rows: STUN support -> Public endpoint discovery (STUN or reflection); Multiple STUN servers -> Multiple discovery servers; Multiple relay regions -> Multiple relays; Automatic relay selection -> Latency-based relay selection; Certificate pinning -> Control-server key pinning; Rate limiting -> Handshake rate limiting; Userspace TCP implementation -> Userspace TCP/IP stack.

Scoring: ✓ = 1, ◐ = 0.5, ✗ = 0; N/A and ? are excluded from the denominator; all rows unweighted.
