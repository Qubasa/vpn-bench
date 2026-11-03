# Feature matrix row contract

Every overview checklist item and every matrix cell uses these definitions, so all VPNs are
scored the same way.

## Cell values

| Cell | Overview checklist | Meaning |
|---|---|---|
| `✓` | `- [x] **Row** - ...` | Supported: on by default, or a normal config option. |
| `◐` | `- [x] **Row** - Partial: ...` | Partial, opt-in experimental, only some platforms, or limited. Say why. |
| `✗` | `- [ ] **Row** - ...` | Not supported. |
| `N/A` | `- [ ] **Row** - N/A: ...` | The row cannot apply to this design. Rare, see the rules below. |
| `?` | `- [ ] **Row** - Unknown: ...` | Still unknown after reading the source. Say what you checked. |

Every value needs evidence: a path and line in `sources/` (`src/<input>/path/file.go:123`, or
`deps/<input>/<dep>/...` for dependency code), or a symbol name.

## Scoring rules

- Judge performance rows on Linux with the default build. Linux-only syscalls count as ✓ if
  used on Linux by default.
- A design that simply lacks what a row asks about gets ✗, not N/A. No compression means
  Configurable compression ✗. No discovery servers means Multiple discovery servers ✗.
- Controller rows (Controller redundancy, Cached credentials, Control-server key pinning) are
  N/A when the design has no controller.
- Enrollment rows are ✗, not N/A, when the design has no enrollment step.
- Relay rows: ordinary mesh nodes that forward traffic for others count as relays.
- Platform rows: official apps count even when they live in a separate repository of the same
  project. Third-party apps give at most ◐. Platform code that does not build is ✗.
- Scores: ✓ = 1, ◐ = 0.5, ✗ = 0. N/A and ? leave the denominator. The web UI computes the scores
  from the cells, so never write a score table.

## At a Glance (short free text)

| Key | What to report |
|---|---|
| Language | Main implementation language(s). |
| License | From the LICENSE file(s). |
| Default peer transport | What a fresh 2-node Linux setup uses for data, plus the fallback. |
| Data cipher (default) | Default AEAD for tunnel traffic. List alternatives. |
| Handshake | Key-exchange construction (e.g. Noise IK with X25519, custom ECDH, TLS 1.3). |
| Default tunnel MTU | Numeric default and where it is set. |
| Control-plane model | `central server`, `lighthouse/bootstrap nodes` or `fully distributed`, one phrase. |
| Data-plane threading | `single-threaded` or `multi-threaded` plus one phrase (e.g. "N workers, SO_REUSEPORT"). |

## Protocol

### Transport
- **UDP transport**: peer data can flow over plain UDP.
- **Datagram encapsulation (no head-of-line blocking)**: ✓ if on the default path each inner
  packet is an independent datagram. ✗ if carried in a reliable ordered stream (TCP, QUIC
  stream, TLS). ◐ if it depends on an opt-in transport.
- **TCP fallback**: the VPN switches to TCP by itself when UDP is blocked (direct or via relay).
  A TCP or WebSocket transport the user must set up by hand per node does not count (✗).
- **QUIC support**: QUIC is a selectable peer transport.
- **WebSocket support**: WS/WSS usable for peer or relay traffic.

### IP Support
- **IPv4 support** / **IPv6 support**: inner (tunneled) traffic of that family.
- **Dual-stack**: both families on the same virtual interface at once.

### Network Layer Mode
- **Layer 3 (IP) mode**: routes IP packets.
- **Layer 2 (Ethernet) mode**: carries Ethernet frames.
- **Bridging support**: non-VPN LAN devices bridged into the overlay at Layer 2.

### Advanced Protocol Features
- **Multipath/bonding**: aggregation or active-backup across several underlay paths for one peer.
- **QoS/traffic shaping**: priority queues, traffic classes or rate limits on tunnel traffic.
- **Multicast support**: multicast or broadcast carried between peers.

## Encryption

### Key Exchange
- **Modern key exchange (Curve25519)**: X25519/Curve25519 ECDH derives the session keys.
- **Perfect Forward Secrecy**: session keys come from ephemeral keys, so leaking long-term keys
  does not decrypt past traffic.
- **Post-quantum readiness**: hybrid or post-quantum KEM available.
- **Key rotation**: session keys are re-keyed automatically during a long-lived session.

### Symmetric Encryption
- **Authenticated encryption**: AEAD on the data plane.
- **Hardware-accelerated crypto**: the data-path cipher uses AES-NI/ARMv8-CE or SIMD code.
  Check the dependency code in `deps/` (crates, Go modules, Go stdlib, OpenSSL, kernel crypto).
- **Constant-time operations**: crypto through constant-time implementations.

### Protocol Security
- **Replay protection**: data-plane counter or sliding-window check.
- **Noise Protocol**: the handshake is a Noise Framework pattern.
- **No cleartext metadata**: neither handshake nor data packets reveal a long-term identity
  (public key, certificate, node ID) to a passive observer.
- **End-to-end encryption through relays**: relays and intermediate hops cannot decrypt the
  tunneled payload.

## Performance

### Threading
- **Multi-threaded processing**: data-plane crypto runs on several cores at once.
- **Multi-queue TUN / per-core sockets**: IFF_MULTI_QUEUE TUN and/or several UDP sockets
  (SO_REUSEPORT) driven by separate workers.

### Packet I/O
- **Batch UDP receives (recvmmsg)** / **Batch UDP sends (sendmmsg)**: batched socket syscalls.
- **Large batch sizes (64+)**: batches of at least 64 packets on socket or TUN I/O.

### Offloads
- **UDP GSO** / **UDP GRO**: UDP_SEGMENT / UDP_GRO socket options.
- **TUN offload (virtio-net hdr)**: TSO/GSO/GRO on the TUN device via IFF_VNET_HDR / TUNSETOFFLOAD.

### Buffers and Parsing
- **Buffer pool reuse**: hot-path packet buffers come from a pool or arena.
- **Large UDP socket buffers (MB)**: SO_RCVBUF/SO_SNDBUF of at least 1 MiB requested by default.
- **Zero-allocation parsing**: the hot path parses packets without heap allocation.

### MTU and Peers
- **Path MTU discovery**: active PMTU probing between peers.
- **Endpoint caching**: remembers the best working endpoint per peer.

### Userspace TCP Stack
- **Userspace TCP/IP stack**: a userspace TCP/IP stack (gVisor netstack, smoltcp, ...) handles
  some tunneled traffic. Say for what: default datapath or optional feature.

### Data Plane Compression
- **Tunnel compression**: tunnel payload can be compressed.
- **Configurable compression**: algorithm or level selectable.

## Security

### Network Security
- **Handshake rate limiting**: handshake or control-packet rate limiting against DoS/amplification.
- **Stateful packet filter**: built-in conntrack firewall for tunnel traffic.
- **Fine-grained ACLs**: per-port/protocol rules.
- **Capability-based access**: policies on tags, groups or certificate attributes, not only IPs.

### Identity & Authentication
- **Identity validation**: identity cryptographically bound (address derived from key, CA-signed
  certificate, proof of work).
- **Signed config updates**: network config or peer list signed by an authority and verified by nodes.
- **Control-server key pinning**: control-plane server identity pinned beyond WebPKI.

### Implementation
- **Memory-safe language**: the data path is written in a memory-safe language.
- **Privilege separation**: drops root/capabilities after setup, or a separate privileged helper.
- **Sandboxing**: seccomp, pledge, chroot or similar.
- **Audit logging**: security events (failed authentication and handshakes, rejected peers,
  ACL/firewall drops, certificate errors) logged at the default level: ✓. Only at debug level,
  only a narrow subset, or only to a remote collector: ◐. Not logged: ✗.

## NAT Traversal

### Discovery
- **No own public node needed**: nodes that are all behind NAT form a mesh. ✓ if the default
  configuration does it through public nodes the project, vendor or community runs. ◐ if such
  nodes exist but must be configured by hand, or only a hosted service works while the
  self-hosted setup needs a public server. ✗ if the user must run a node with a public address.
  Hole punching alone does not make it ✓, since the rendezvous still needs a reachable node.
- **Public endpoint discovery (STUN or reflection)**: own public endpoint discovered via STUN or
  server reflection. Say which.
- **Multiple discovery servers**: several discovery servers used or configurable.
- **NAT type detection**: classifies NAT behavior.

### Port Mapping
- **UPnP port mapping** / **NAT-PMP support** / **PCP support**: the protocol is implemented.

### Hole Punching
- **UDP hole punching**: coordinated simultaneous open.
- **Symmetric NAT handling**: port prediction, birthday attack or similar.
- **Rendezvous coordination**: a server or peer coordinates the punch.

### Fallback
- **Relay fallback**: traffic goes through a relay when no direct path works.
- **Multiple relays**: several relays used or configurable.
- **Latency-based relay selection**: picks the relay by measured latency.
- **TCP relay support**: relay reachable over TCP.

## Local Routing

### LAN Discovery
- **Broadcast/multicast discovery**: finds peers on the LAN by broadcast or multicast.
- **Direct path advertisement**: peers share their local endpoints.

### LAN Optimization
- **Automatic LAN preference**: prefers the LAN path when both work.
- **Trusted path mode**: skips encryption on trusted links.
- **LAN-only mode**: works without any internet connectivity.

### Routing Features
- **Subnet routes**: a node advertises a non-VPN subnet behind it.
- **Full tunnel mode**: exit node, default route through a peer.
- **Split tunneling**: only some traffic goes through the VPN.
- **Route priorities**: HA or failover between routers.
- **Multi-hop routing via peers**: ordinary mesh nodes forward traffic for others through a
  routing protocol, beyond dedicated relay servers.
- **Built-in DNS**: the VPN resolves peer names itself.

## Resilience

### Offline Operation (controller / lighthouse / bootstrap down)
- **Existing connections survive**: established tunnels keep working.
- **Local state caching**: peer map persisted locally.
- **Cached credentials**: node credentials stay valid without the controller.

### Redundancy
- **Fully self-hostable**: every component (control, discovery, relay) can run on own infrastructure.
- **Controller redundancy**: several controllers at once.
- **Relay redundancy**: several relays at once.
- **No single root of trust**: no single key or server whose compromise takes over the network.

## Authentication

### Enrollment Methods
- **Pre-authentication keys**: a secret a new node presents to join without manual approval.
  Pre-approving a node ID is the Admin approval workflow row, not a pre-auth key.
- **Certificate-based enrollment**: a CA-signed certificate admits the node.
- **OAuth/OIDC**: login through an identity provider.
- **Interactive login**: browser or interactive login flow.
- **CLI authentication**: enrollment from the command line.

### Authorization
- **Admin approval workflow**: an admin approves each new node.
- **Automated enrollment rules**: rules admit nodes automatically.
- **Ephemeral nodes**: nodes removed automatically when they go away.
- **Node expiry**: node credentials expire.

### Identity
- **Stable device identity**: the identity survives restarts and address changes.
- **Identity portability**: the identity can move to another machine.

## Platform

### Desktop/Server
- **Linux** / **macOS** / **Windows** / **FreeBSD/OpenBSD**: in-repo code or official clients.

### Mobile
- **iOS** / **Android**: in-repo code or official apps.

### Implementation
- **Kernel-mode datapath**: tunnel packets processed in the kernel (e.g. kernel WireGuard).
- **Container support**: official container image or Kubernetes integration.
