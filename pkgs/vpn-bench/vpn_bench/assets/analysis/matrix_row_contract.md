# Feature matrix row contract

Every overview checklist item and every matrix cell uses these definitions, so all VPNs are
scored the same way by every reader.

## Cell values

| Cell | Overview checklist | Meaning |
|---|---|---|
| `✓` | `- [x] **Row** - ...` | Supported (see "How to score a row"). |
| `◐` | `- [x] **Row** - Partial: ...` | Supported for only part of the traffic, peers or platforms, or in a reduced form. Say which part. |
| `✗` | `- [ ] **Row** - ...` | Not in this version. |
| `N/A` | `- [ ] **Row** - N/A: ...` | Only for the controller rows of a design without a controller. |
| `?` | `- [ ] **Row** - Unknown: ...` | Last resort, after searching the source. Say what you searched. |

Every value needs evidence: a path and line in `sources/` (`src/<input>/path/file.go:123`, or
`deps/<input>/<dep>/...` for dependency code), or a symbol name.

## How to score a row

Go through these steps in order and stop at the first one that decides the cell.

1. **This version only.** Count only what the code in `sources/` does. A feature added in a
   later release, or one the README promises but the code lacks, is ✗. Code that exists but
   does not compile or is never called is ✗.
2. **Absent means ✗.** If the code has no such feature, the cell is ✗, even when the design
   makes the row look irrelevant (no compression means Configurable compression ✗). N/A is
   reserved for the three controller rows (Controller redundancy, Cached credentials,
   Control-server key pinning) when there is no controller. Lighthouses, bootstrap nodes,
   roots and DHTs are not controllers.
3. **Be generous about how it is turned on.** If an operator gets the full feature with the
   benchmarked binary, it is ✓, even when it is off by default. All of these count:
   - a config option, CLI flag or environment variable;
   - a file the project ships in the source tree (systemd unit, Dockerfile, NixOS module,
     example config);
   - a compile-time feature that is on in the benchmarked build;
   - a dependency the VPN uses (crypto library, QUIC stack, Go stdlib, kernel crypto).
   It does not count if it needs patching, rebuilding with other features, or third-party
   software the project does not ship.
4. **Be strict about how much it covers.** ◐ when the feature exists but covers only part
   of what the row asks:
   - only one of several transports or link types that run together by default, or only an
     opt-in transport (e.g. only on QUIC links, only on `wg://` links);
   - only per hop when the row is about the tunnel end to end;
   - only some platforms, or only some peers or roles;
   - marked experimental in the code, or a reduced form the row definition names as ◐.
5. **Tie-break towards the generous value.** If you still hesitate between two values, pick
   the higher one (✓ over ◐, ◐ over ✗) and state the limitation in the evidence sentence.
   Do not use `?` to avoid a decision.

Further rules:

- Performance rows judge Linux with the default build of the benchmarked binary. A kernel
  datapath is judged on its in-kernel equivalent (e.g. TUN offload means GSO/GRO on the
  device; it hands packets one at a time to the UDP layer means no batched sends).
- Relay rows: ordinary mesh nodes that forward traffic for others count as relays.
- Enrollment rows are ✗, not N/A, when the design has no enrollment step.
- Platform rows: in-repo code that builds, or an official app of the same project that this
  version's source tree refers to (README, store links, build files), gives ✓. Third-party
  apps give ◐. Nothing gives ✗.
- Scores: ✓ = 1, ◐ = 0.5, ✗ = 0. N/A and ? leave the denominator. The web UI computes the
  scores from the cells, so never write a score table.

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
| Data-plane threading | `single-threaded`, or `multi-threaded` only if packet crypto of one direction runs on more than one core at once, plus one phrase (e.g. "N workers, SO_REUSEPORT", "one task per direction"). |

## Protocol

### Transport
- **UDP transport**: ✓ plain UDP datagrams carry peer data. ◐ UDP only as the carrier of QUIC.
- **Datagram encapsulation (no head-of-line blocking)**: ✓ if on the default path each inner
  packet is an independent datagram. ✗ if carried in a reliable ordered stream (TCP, QUIC
  stream, TLS). ◐ if it depends on an opt-in transport.
- **TCP fallback**: ✓ when a fresh setup keeps working with UDP blocked and needs no extra
  setup per node, either by switching to TCP by itself or because TCP is already a default
  carrier. A TCP or WebSocket transport the user must set up by hand per node gives ✗.
- **QUIC support**: QUIC is a selectable peer transport.
- **WebSocket support**: WS/WSS usable for peer or relay traffic.

### IP Support
- **IPv4 support** / **IPv6 support**: inner (tunneled) traffic of that family.
- **Dual-stack**: both families on the same virtual interface at once.

### Network Layer Mode
- **Layer 3 (IP) mode**: routes IP packets. ◐ if IP rides on an emulated Ethernet (TAP) layer.
- **Layer 2 (Ethernet) mode**: carries Ethernet frames.
- **Bridging support**: non-VPN LAN devices bridged into the overlay at Layer 2. ◐ if only
  IP crosses the tunnel but a device can sit behind a bridge.

### Advanced Protocol Features
- **Multipath/bonding**: ✓ aggregation or active-backup across several underlay paths or
  links to one peer.
- **QoS/traffic shaping**: ✓ configurable priority queues, traffic classes or rate limits.
  ◐ a fixed built-in scheduler or only copying the inner TOS/DSCP to the outer packet.
- **Multicast support**: multicast or broadcast carried between peers.

## Encryption

### Key Exchange
- **Modern key exchange (Curve25519)**: X25519/Curve25519 ECDH derives the session keys.
- **Perfect Forward Secrecy**: session keys come from ephemeral keys, so leaking long-term keys
  does not decrypt past traffic.
- **Post-quantum readiness**: hybrid or post-quantum KEM available. ◐ if only an optional
  pre-shared key adds post-quantum protection.
- **Key rotation**: ✓ session keys are replaced automatically during a long-lived session, by
  timer or packet count, at the layer that protects tunnel traffic on the default path (a
  QUIC/TLS key update counts when that layer carries the default traffic). ◐ if only on some
  transports, or only on an event such as a certificate change or reconnect.

### Symmetric Encryption
- **Authenticated encryption**: AEAD on the data plane.
- **Hardware-accelerated crypto**: ✓ the default data cipher on x86_64 uses AES-NI, PCLMULQDQ,
  SSSE3/AVX2/AVX-512 or similar code, also through runtime dispatch in a dependency. ◐ only
  for a non-default cipher. Check `deps/` (crates, Go modules, Go stdlib, OpenSSL, kernel crypto).
- **Constant-time operations**: ✓ the default cipher and tag check are constant-time. ◐ if one
  part is not (e.g. a `memcmp` tag check, table-based fallback used on some CPUs).

### Protocol Security
- **Replay protection**: ✓ data-plane counter or sliding window on the default path. ◐ only a
  time window, or only on some transports or per hop.
- **Noise Protocol**: the handshake used between two nodes by default is a Noise Framework pattern.
- **No cleartext metadata**: ✓ neither handshake nor data packets reveal a long-term identity
  (public key, certificate, node ID, node name) to a passive observer. ◐ if only some
  transports hide it, or only a salted hash is visible. ✗ otherwise.
- **End-to-end encryption through relays**: relays and intermediate hops cannot decrypt the
  tunneled payload.

## Performance

### Threading
- **Multi-threaded processing**: data-plane crypto of one direction runs on several cores at once.
- **Multi-queue TUN / per-core sockets**: IFF_MULTI_QUEUE TUN and/or several UDP sockets
  (SO_REUSEPORT) driven by separate workers.

### Packet I/O
- **Batch UDP receives (recvmmsg)** / **Batch UDP sends (sendmmsg)**: batched socket syscalls,
  also inside a dependency (quic-go, quinn-udp, wireguard-go). One `sendmsg` with UDP GSO is
  credited in the UDP GSO row, not here.
- **Large batch sizes (64+)**: batches of at least 64 packets on socket or TUN I/O.

### Offloads
- **UDP GSO** / **UDP GRO**: UDP_SEGMENT / UDP_GRO socket options.
- **TUN offload (virtio-net hdr)**: TSO/GSO/GRO on the TUN device via IFF_VNET_HDR / TUNSETOFFLOAD.

### Buffers and Parsing
- **Buffer pool reuse**: ✓ hot-path packet buffers come from a pool or arena, or are allocated
  once per worker and reused. ✗ a new buffer per packet.
- **Large UDP socket buffers (MB)**: SO_RCVBUF/SO_SNDBUF of at least 1 MiB requested by default.
- **Zero-allocation parsing**: ✓ the hot path parses packets without a heap allocation per
  packet. ◐ if one direction or one transport allocates per packet.

### MTU and Peers
- **Path MTU discovery**: ✓ active PMTU probing between peers, also in the QUIC or TCP stack
  that carries the default traffic.
- **Endpoint caching**: ✓ keeps the last working endpoint per peer (in memory counts) and
  tries it first.

### Userspace TCP Stack
- **Userspace TCP/IP stack**: ✓ the code contains a userspace TCP/IP stack (gVisor netstack,
  smoltcp, ...) that any configuration uses. Say for what: default datapath or optional feature.

### Data Plane Compression
- **Tunnel compression**: ✓ tunnel payload can be compressed. ◐ if only control or multicast
  traffic is compressed.
- **Configurable compression**: algorithm or level selectable. On/off alone is ✗.

## Security

### Network Security
- **Handshake rate limiting**: ✓ any limit on handshakes, connection attempts or control
  packets per source or per peer. ◐ only a global connection cap.
- **Stateful packet filter**: ✓ built-in conntrack firewall for tunnel traffic. ◐ if it tracks
  only some protocols.
- **Fine-grained ACLs**: per-port/protocol rules.
- **Capability-based access**: policies on tags, groups or certificate attributes, not only IPs.

### Identity & Authentication
- **Identity validation**: ✓ a peer's overlay address is cryptographically bound to its key
  (derived from the key, in a signed certificate, or in a signed map). ◐ if keys are pinned
  but addresses are not bound to them.
- **Signed config updates**: network config or peer list signed by an authority and verified by nodes.
- **Control-server key pinning**: control-plane server identity pinned beyond WebPKI.

### Implementation
- **Memory-safe language**: the data path is written in a memory-safe language.
- **Privilege separation**: ✓ the daemon drops root or capabilities after setup, or a separate
  privileged helper exists, through a flag, config or a shipped unit/container.
- **Sandboxing**: ✓ seccomp, Landlock, pledge, chroot, systemd sandboxing or similar, through
  a flag, config or a shipped unit/container.
- **Audit logging**: ✓ failed authentication or failed handshakes are logged at the default log
  level. ◐ only at debug level, or only to a remote collector. ✗ not logged.

## NAT Traversal

### Discovery
- **No own public node needed**: nodes that are all behind NAT form a mesh. ✓ if the default
  configuration, an official client or a shipped config presets public nodes the project,
  vendor or community runs. ◐ if such nodes exist but must be added by hand, or only a hosted
  service works while the self-hosted setup needs a public server. ✗ if the user must run a
  node with a public address. Hole punching alone does not make it ✓.
- **Public endpoint discovery (STUN or reflection)**: ✓ a node learns its public endpoint from
  STUN or from what a server or peer reports seeing. Say which.
- **Multiple discovery servers**: ✓ several STUN servers, lighthouses, roots or reflecting peers
  are used or configurable at once.
- **NAT type detection**: classifies NAT behavior.

### Port Mapping
- **UPnP port mapping** / **NAT-PMP support** / **PCP support**: the protocol is implemented and
  compiled into the benchmarked build.

### Hole Punching
- **UDP hole punching**: both sides send towards each other's public endpoint to open a path.
- **Symmetric NAT handling**: ✓ port prediction, birthday spray or similar. ◐ a specific
  mechanism for symmetric NAT without prediction (reverse connect from the cone side).
- **Rendezvous coordination**: a server or peer tells both sides when and where to punch.

### Fallback
- **Relay fallback**: ✓ traffic goes through a relay by itself when no direct path works.
  ◐ if the relay must be configured on both sides by hand.
- **Multiple relays**: several relays used or configurable.
- **Latency-based relay selection**: picks the relay or forwarding path by measured latency.
- **TCP relay support**: relay reachable over TCP.

## Local Routing

### LAN Discovery
- **Broadcast/multicast discovery**: finds peers on the LAN by broadcast or multicast.
- **Direct path advertisement**: peers share their local endpoints.

### LAN Optimization
- **Automatic LAN preference**: ✓ prefers the LAN path when both work, also by picking the
  lowest-latency path. ◐ only for address ranges the user lists.
- **Trusted path mode**: skips encryption on trusted links. ◐ only per node or only in a
  legacy protocol.
- **LAN-only mode**: ✓ nodes on a LAN with no internet access form the mesh, using only LAN
  addresses, LAN discovery, or controllers/lighthouses run on that LAN. ✗ only if the code
  needs an internet service it cannot do without.

### Routing Features
- **Subnet routes**: ✓ a node advertises a non-VPN subnet behind it. ◐ only a key-derived
  prefix that can be routed to hosts behind the node.
- **Full tunnel mode**: ✓ a peer can be the default route (exit node) through config. ◐ if it
  needs routes set outside the VPN or loses to the existing default route.
- **Split tunneling**: ✓ only some traffic goes through the VPN, fixed overlay prefixes included.
- **Route priorities**: ✓ failover between several routers for one route. Per-link priority
  does not count.
- **Multi-hop routing via peers**: ordinary mesh nodes forward traffic for others through a
  routing protocol, beyond dedicated relay servers.
- **Built-in DNS**: ✓ the VPN resolves peer names itself. ◐ if only some nodes serve it and
  clients must be pointed at them by hand.

## Resilience

### Offline Operation (controller / lighthouse / bootstrap down)
- **Existing connections survive**: established tunnels keep working.
- **Local state caching**: peer map persisted to disk.
- **Cached credentials**: node credentials stay valid without the controller.

### Redundancy
- **Decentralized control plane**: ✓ no node or server has a special role: membership,
  routes and peer addresses come from local config or are exchanged between ordinary peers,
  and any node can introduce new ones. ◐ dedicated discovery nodes (lighthouses, bootstrap
  nodes, roots, a DHT entry point) that nodes need to find each other, but that do not
  decide membership, keys or config. ✗ a central server or controller decides membership,
  keys or config. Matches the "Control-plane model" glance key: fully distributed ✓,
  lighthouse/bootstrap nodes ◐, central server ✗.
- **Fully self-hostable**: every component (control, discovery, relay) can run on own infrastructure.
- **Controller redundancy**: several controllers at once.
- **Relay redundancy**: several relays at once.
- **No single root of trust**: no single key, secret or server whose compromise takes over the
  network. A network-wide shared secret is a single root of trust.

## Authentication

### Enrollment Methods
- **Pre-authentication keys**: a secret a new node presents to join without manual approval.
  Pre-approving a node ID is the Admin approval workflow row, not a pre-auth key.
- **Certificate-based enrollment**: a CA-signed certificate admits the node.
- **OAuth/OIDC**: login through an identity provider.
- **Interactive login**: browser or interactive login flow.
- **CLI authentication**: ✓ the join credential (secret, certificate, invite, auth key) can be
  given on the command line.

### Authorization
- **Admin approval workflow**: ✓ new nodes wait in a pending state until an admin approves
  them on a controller. ◐ an admin adds each node's key, ID, certificate or host file by
  hand. ✗ anyone holding a shared secret joins.
- **Automated enrollment rules**: rules admit nodes automatically.
- **Ephemeral nodes**: ✓ a registry removes nodes automatically when they go away. Route or
  session timeouts alone are ✗.
- **Node expiry**: node credentials expire.

### Identity
- **Stable device identity**: the identity survives restarts and address changes.
- **Identity portability**: ✓ the identity is a key or certificate file that works on another
  machine when copied. ◐ if the controller must re-approve it. ✗ if bound to the hardware.

## Platform

### Desktop/Server
- **Linux** / **macOS** / **Windows** / **FreeBSD/OpenBSD**: in-repo code that builds, or official
  clients (see the platform rule above). ◐ if only one of FreeBSD or OpenBSD.

### Mobile
- **iOS** / **Android**: in-repo code or official apps (see the platform rule above).

### Implementation
- **Kernel-mode datapath**: tunnel packets processed in the kernel (e.g. kernel WireGuard).
- **Container support**: ✓ an official container image, a Dockerfile in the repo, or a
  Kubernetes integration.
