# Overview

**gVisor** is **not a VPN**. It is an **application kernel** written in Go that re-implements a Linux-compatible system call surface entirely in userspace. It is included in this VPN comparison because its `pkg/tcpip` package — usually called **netstack** — is reused as a standalone, pure-Go userspace TCP/IP stack by several mesh VPNs in this benchmark suite (notably Tailscale's `wgengine/netstack` and Hyprspace's "service network" feature). This document focuses on gVisor as a building block for VPN data planes, while also covering its primary role as a container sandbox so the security and performance trade-offs are clear.

> **Note on the feature checklists below.** The same section structure as the other VPN overviews is preserved for diff-ability, but most of the rows do not apply cleanly to gVisor: a TCP/IP stack is not a tunneling layer, has no peer concept, no encryption layer, and no NAT traversal. Rows are marked **N/A** wherever the question only makes sense for a VPN. **gVisor should not be added to `feature_matrix.md` and should not be scored against the per-VPN totals there** — the comparison surface is not commensurate.

**Two Distinct Components:**

1. **runsc / Sentry** (`runsc/`, `pkg/sentry/`): An OCI-compatible container runtime that intercepts every guest application syscall and serves it from a Go-based "Sentry" process. This is gVisor's main product and is unrelated to mesh VPNs.

2. **netstack** (`pkg/tcpip/`): A pure-Go implementation of IPv4, IPv6, ARP, ICMP, TCP, UDP, raw sockets, packet sockets, IP fragmentation, NAT, netfilter/iptables, and nftables. It has only a handful of external Go dependencies (`golang.org/x/sys`, `golang.org/x/time/rate`, `github.com/google/btree`). The networking architecture guide explicitly states "Netstack aims to be usable independent of gVisor" and it is the part that VPN projects pull in. The same guide warns that netstack's API is not guaranteed stable and is not published with Go module-style versions, so consumers pin pseudo-versions of the generated `go` branch (Tailscale pins a February 2025 snapshot, Hyprspace a September 2023 one). Defaults differ between those snapshots (see the TCP defaults below).

**Key Architecture Components:**

- **Sentry** (`pkg/sentry/kernel/`): The application kernel — implements processes, schedulers, signals, VFS, memory management, the syscall table (`pkg/sentry/syscalls/linux/`).
- **Platform** (`pkg/sentry/platform/`): The syscall-interception backend. Available platforms: `systrap` (default since 2023, uses `SECCOMP_RET_TRAP` + `SIGSYS`), `kvm` (uses KVM virtualization extensions), `ptrace` (legacy, uses `PTRACE_SYSEMU`).
- **Gofer** (`runsc/cmd/gofer.go`, `runsc/fsgofer/`): A separate process that brokers filesystem access for the sandbox over a lisafs connection (the old 9P package `pkg/p9` is still in the tree but no longer used by runsc or the Sentry).
- **netstack / tcpip** (`pkg/tcpip/`): The userspace network stack used by both the Sentry and external consumers.
  - `pkg/tcpip/stack/`: Stack object, NICs, neighbor table, packet buffers, GRO engine.
  - `pkg/tcpip/transport/{tcp,udp,icmp,packet,raw}/`: Transport-layer protocols.
  - `pkg/tcpip/network/{ipv4,ipv6,arp}/`: Network-layer protocols including fragmentation, IGMP, MLD, NDP.
  - `pkg/tcpip/link/{fdbased,xdp,channel,sharedmem,tun,...}/`: Pluggable link-layer endpoints.
  - `pkg/tcpip/stack/iptables*.go`, `pkg/tcpip/nftables/`: iptables-style and nftables filtering inside netstack; `pkg/sentry/socket/netfilter/` translates the Linux iptables ABI for guests.
- **runsc** (`runsc/`): The OCI runtime CLI that wires Sentry, Gofer, platforms, and netstack together for container execution.
- **Shim** (`shim/`): containerd integration shim (`containerd-shim-runsc-v1`).

**Where this matters for VPNs:** Tailscale uses netstack to terminate tunneled TCP/UDP flows in userspace when it runs without a kernel TUN (userspace-networking, tsnet, wasm), as the subnet router on Windows/macOS/FreeBSD/OpenBSD/Synology, and for its own 100.100.100.100 services. It overrides several defaults: it pins Reno, disables RACK, keeps SACK on, raises the maximum TCP receive buffer to 8 MiB and the maximum send buffer to 6 MiB (default stays 1 MiB), and enables gVisor's GRO engine plus host GSO on Linux. Hyprspace uses netstack only for its in-VPN "service network" (TCP listeners on `fd00:hyprspsv::/80`, MTU 1420); its only TCP tuning is turning SACK on. Neither project uses Sentry, runsc, the platforms, or any of the syscall implementation; they import only `gvisor.dev/gvisor/pkg/tcpip` plus helper packages (`pkg/buffer`, `pkg/waiter`, `pkg/refs`).

# Protocol

gVisor itself does not define a wire protocol. Its netstack implements **standard internet protocols** that the consuming application drives:

**Network-layer protocols implemented in `pkg/tcpip/network/`:**
- **IPv4** (`ipv4/ipv4.go`): Full IPv4 with reassembly, IGMPv2/v3, ICMPv4
- **IPv6** (`ipv6/`): Full IPv6 with NDP, MLDv1/v2, ICMPv6, extension headers, fragment reassembly
- **ARP** (`arp/`): ARP request/response handling for Ethernet link layers

**Transport-layer protocols in `pkg/tcpip/transport/`:**
- **TCP** (`tcp/`): A full RFC-compliant TCP implementation with SACK (on by default since May 2024), RACK-TLP loss detection (on by default, only effective when SACK is negotiated), window scaling, timestamps, fast retransmit, Reno (default) and CUBIC congestion control, SYN cookies (automatic when the accept backlog is full, or always via an option), TIME_WAIT reuse (loopback-only by default), keep-alive
- **UDP** (`udp/`)
- **ICMP** (`icmp/`)
- **Raw sockets** (`raw/`)
- **Packet sockets** (`packet/`)

**Link-layer endpoint backends in `pkg/tcpip/link/`:**
- **fdbased** (`fdbased/`): The most common backend; reads/writes packets via a file descriptor (TUN, TAP, AF_PACKET, seqpacket sockets). Supports `readv`, `recvmmsg`, and `PACKET_RX_RING` (PACKET_MMAP) dispatch modes. `runsc` uses it on the AF_PACKET socket attached to the sandbox veth, in `RecvMMsg` mode (runsc's own comment says PACKET_MMAP did not give higher throughput).
- **xdp** (`xdp/`): AF_XDP-backed link endpoint for kernel-bypass NIC ingress/egress.
- **channel** (`channel/`): In-process Go channels, used to inject already-decapsulated packets directly into netstack with no syscalls. Hyprspace uses `channel.New(1024, 1420, "")`; Tailscale uses its own channel-like endpoint (`wgengine/netstack/link_endpoint.go`, 512-packet outbound queue) that adds GRO, GSO and RX-checksum-offload support.
- **sharedmem** (`sharedmem/`): Shared-memory ring buffers for inter-process zero-copy networking (Linux only).
- **tun** (`tun/`): A virtual `/dev/net/tun` Device implementation backing the Sentry's TUN/TAP support.
- **muxed**, **nested**, **pipe**, **veth**, **loopback**, **packetsocket**, **sniffer**, **waitable**, **qdisc/fifo**: Composability and tooling endpoints.
- **ethernet** (`ethernet/`): Wraps a non-Ethernet endpoint to add Ethernet framing.

**Sentry-side wire protocols:** `runsc` itself uses lisafs (`pkg/lisafs`) over Unix sockets to talk to the Gofer, urpc (`pkg/urpc`) for control, and flipcall (`pkg/flipcall`) for fast cross-process method calls. None of these are network protocols that touch peers.

## Protocol Features Checklist

### Transport
> The matrix rows below ask which transport a VPN can tunnel its encrypted traffic over (e.g. WireGuard-over-UDP, DERP-over-TCP). gVisor netstack is not a tunneling layer — it terminates these protocols as endpoints for application sockets. The rows are therefore **N/A** for gVisor; what netstack actually implements is noted instead.

- [ ] **UDP transport** - N/A (no tunnel). netstack does implement UDP as a transport endpoint in `pkg/tcpip/transport/udp/`.
- [ ] **TCP fallback** - N/A (no tunnel). netstack does implement TCP as a transport endpoint in `pkg/tcpip/transport/tcp/`.
- [ ] **QUIC support** - N/A; no QUIC implementation in netstack regardless.
- [ ] **WebSocket support** - N/A; WebSocket is application-layer.

### IP Support
- [x] **IPv4 support** - Full IPv4 with fragmentation, IGMP, ICMPv4
- [x] **IPv6 support** - Full IPv6 with NDP, MLD, extension headers
- [x] **Dual-stack** - Stack supports both protocols simultaneously per NIC

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - Native IP routing via `Stack.SetRouteTable`
- [ ] **Layer 2 (Ethernet) mode** - N/A in the VPN sense (gVisor exposes no overlay to user devices). netstack does have Ethernet link endpoints, ARP, and a neighbor table.
- [ ] **Bridging support** - N/A in the VPN sense. netstack can forward between NICs (`link/nested`, `veth`), which is bridge-like at the stack level only.

### Advanced
- [ ] **Multipath/bonding** - No path bonding (single egress per route)
- [ ] **QoS/traffic shaping** - No. The only queueing discipline is `link/qdisc/fifo` (plain FIFO queues with a batching writer goroutine); there are no priority classes or rate limits.
- [ ] **Multicast support** - N/A in the VPN sense (no overlay to carry multicast across). netstack does implement IGMPv2/v3, MLDv1/v2, multicast routing tables, and `IP_ADD_MEMBERSHIP` for guest applications.

# Encryption

**gVisor netstack does not implement any transport encryption.** It is a plain TCP/IP stack — TLS, IPsec, WireGuard, Noise, and similar are entirely the responsibility of the application above it (or, for VPN consumers like Tailscale, of the surrounding WireGuard layer that has already decrypted the packets *before* they are handed to netstack).

What gVisor does provide on the cryptographic side:

- **`pkg/crypto/`**: A tiny wrapper package with ECDSA P-384/SHA-384 verification and SHA-384 helpers. It is not exposed to peers and is not used by netstack.
- **TCP sequence number / timestamp secret randomization** (`pkg/tcpip/transport/tcp/protocol.go`): netstack reads 16 bytes of secure random for `seqnumSecret` and `tsOffsetSecret` at startup, and ISNs are derived with keyed SHA-256 over the 4-tuple, so ISN and TS offset generation is unpredictable across connections. Snapshots before November 2023 (including Hyprspace's pin) used 32-bit secrets from a `math/rand` generator and a Jenkins hash instead.
- **Jenkins hashing** (`pkg/tcpip/hash/jenkins`): Used for TCP processor selection and similar; not security-critical. The GRO engine picks buckets with a plain byte sum of addresses and ports.
- **`getrandom`, `/dev/urandom`** are implemented by the Sentry on behalf of guest applications (`pkg/sentry/syscalls/linux/sys_random.go`, backed by `pkg/rand`, which uses host `getrandom(2)` and falls back to Go's `crypto/rand`).

For the Sentry's own host-facing channel to the Gofer, communication runs over inherited Unix sockets in the same user namespace, so there is no on-wire encryption required.

## Encryption Checklist

### Key Exchange
- [ ] **Modern key exchange** - N/A (no encryption layer)
- [ ] **Perfect Forward Secrecy** - N/A
- [ ] **Post-quantum readiness** - N/A
- [ ] **Key rotation** - N/A

### Symmetric Encryption
- [ ] **Authenticated encryption** - N/A (netstack carries plaintext IP)
- [ ] **Hardware-accelerated crypto** - N/A
- [ ] **Constant-time operations** - N/A

### Protocol Security
- [ ] **Replay protection** - N/A (no encrypted data plane). TCP sequence-number windowing discards stale segments, but that is not cryptographic replay protection.
- [ ] **Noise Protocol or equivalent** - N/A
- [ ] **No cleartext metadata** - N/A; all packet data is plaintext

# Performance

netstack is the part of gVisor that VPN benchmarks care about, so this section focuses on it. gVisor's own `g3doc/architecture_guide/performance.md` is candid: it names the network stack as the example of an **implementation cost** ("does not support all the advanced recovery mechanisms offered by other stacks and is less CPU efficient"), and most network workloads pay a measurable throughput penalty when running under runsc.

**Threading Model:**

- **Goroutine-per-component**: Link endpoints (e.g. `fdbased`) spawn one or more dispatcher goroutines that read raw packets from their FD and call into the network dispatcher.
- **fdbased inbound processors** (`link/fdbased/processors.go`): Each FD's dispatcher hashes packets by connection onto `ProcessorsPerChannel` processor goroutines (runsc default: `GOMAXPROCS` divided by the number of channels). Each processor owns its own GRO instance.
- **TCP processor pool** (`pkg/tcpip/transport/tcp/dispatcher.go`): TCP creates `runtime.GOMAXPROCS(0)` processor goroutines at startup. Endpoints are queued onto a processor by hashing the endpoint ID (Jenkins hash), so per-flow ordering is preserved while different flows fan out across cores.
- **Inline UDP/ICMP processing**: Datagram protocols are processed on the dispatcher goroutine with no queueing.
- **Outgoing packets**: Sent on whatever goroutine called `Write` (syscall, TCP processor, or link dispatcher) until they reach a queueing discipline; `link/qdisc/fifo` then has its own writer goroutine that batches packets out the link endpoint.
- **Link FD fan-out** (`fdbased`): Multiple FDs can be passed in (runsc default: one, `--num-network-channels=1`); if the underlying socket is `AF_PACKET`, the endpoint enables `PACKET_FANOUT_HASH` so the host kernel hashes packets across FDs and per-flow ordering is preserved without netstack coordination. Outbound packets use only the first FD.

**Link-layer Packet I/O Modes** (`pkg/tcpip/link/fdbased/endpoint.go`):

- **`Readv`** — one packet per `readv()` syscall, the universal fallback.
- **`RecvMMsg`** — uses `recvmmsg()` to drain up to 8 packets per syscall (`MaxMsgsPerRecv = 8`, sockets only). This is the mode `runsc` uses.
- **`PacketMMap`** — uses `PACKET_RX_RING` for mmap-ring packet delivery on AF_PACKET FDs. runsc does not use it; its loader comment says it did not give higher throughput than `RecvMMsg`.
- **`AF_XDP`** (`link/xdp/`) — kernel-bypass via UMEM rings.
- **`BatchSize = 47`** for outbound writes (`sendmmsg`, with `writev` fallback), sized so a single 65 KB GVisor-GSO TCP segment (which fragments to 46×1420 + 1×216) fits exactly in one batch. `qdisc/fifo` uses the same batch size.

**GSO / GRO:**

- **GSO** (`stack/gso.go`, `link/fdbased/endpoint.go:598`): Two flavors — `HostGSOSupported` (defers segmentation to the kernel via `virtio_net_hdr` on the AF_PACKET FD, up to ~64 KB) and `GVisorGSOSupported` (in-Go segmentation when the link layer can't offload). TCP fast-path emits GSO super-segments instead of one MSS-sized packet at a time, drastically reducing per-packet overhead. runsc enables both by default (`--gso`, `--software-gso`).
- **GRO** (`pkg/tcpip/stack/gro/gro.go`): A receive-side GRO engine with 8 hash buckets, each tracking up to 8 in-progress flows, coalescing TCP segments into super-packets of up to 64 KB before they hit TCP. It only handles TCP without IP options and without fragments. It is **off by default**: it is enabled per link endpoint via the fdbased `GRO` option (runsc flag `--gvisor-gro`, default `false`), or by consumers that drive `gro.GRO` themselves (Tailscale on Linux).

**TCP buffer defaults** (`pkg/tcpip/transport/tcp/protocol.go`):

- `MinBufferSize = 4 KiB`
- `DefaultSendBufferSize = 1 MiB`
- `DefaultReceiveBufferSize = 1 MiB`
- `MaxBufferSize = 4 MiB`
- `moderateReceiveBuffer = true` — receive-window auto-tuning enabled by default.
- `sackEnabled = true` since May 2024. Older snapshots (e.g. Hyprspace's September 2023 pin) default to SACK **off**, which is why both Tailscale and Hyprspace set `TCPSACKEnabled(true)` explicitly.
- Non-TCP sockets (UDP, ICMP, raw) use the stack-wide defaults: 212 KiB default, 4 MiB max (`stack/stack_options.go`).
- RTO bounds: `MinRTO = 200 ms`, `MaxRTO = 120 s`; keep-alive 2 h idle / 75 s interval / 9 probes.
- Default congestion control: **Reno**, with CUBIC also available (`availableCongestionControl: []string{"reno", "cubic"}`). `tcp.NewProtocol` gives Reno; `tcp.NewProtocolCUBIC` (added July 2024) gives CUBIC, with a `TODO(b/345835636)` to make CUBIC the default everywhere. runsc itself uses `tcp.NewProtocol` (Reno). Tailscale sets Reno explicitly anyway; its code comment says this guards against a future default change and against an int overflow in netstack's sender congestion-window arithmetic that is more prone to trigger with CUBIC (gVisor issue 11632).
- Default loss detection: **`TCPRACKLossDetection`** (RACK-TLP with an adaptive, DSACK-driven reordering window), only active when SACK is negotiated. Tailscale sets `TCPRecovery(0)` because, per its code comment (Tailscale issue 9707), gVisor's RACK did not handle ACKs in a timely manner, which caused spurious retransmissions and a smaller congestion window. With RACK off, netstack falls back to the classic 3-duplicate-ACK threshold plus RFC 6675 SACK scoreboard recovery.

**Buffer / packet management:**

- `pkg/buffer/`: Reference-counted, scatter/gather buffer chains shared by all packets. Avoids per-packet allocations on the hot path.
- `pkg/tcpip/stack/PacketBuffer`: Holds link/network/transport header offsets and a buffer chain; supports clone/slice without copying payload data.
- `pkg/tcpip/transport/tcp/segment.go`: TCP segment objects come from a `sync.Pool` (as do `PacketBuffer`s); `pkg/buffer` pools payload chunks from 64 B to 64 KiB. The segment heap reorders out-of-order arrivals.
- `pkg/sleep/`: A custom multi-waker primitive used everywhere instead of channels to avoid select-case overhead.

**MTU handling:**

- netstack has no MTU default of its own: the link endpoint's MTU is supplied by the caller (Tailscale 1280, Hyprspace 1420, runsc the veth MTU).
- `defaultDevMtu = 1500` for the Sentry's virtual TUN device (`link/tun/device.go`)
- XDP endpoint: `MTU = 1500` (sized so the packet fits in a 2048-byte XDP frame)
- PMTUD is passive: an ICMP "fragmentation needed" / "packet too big" lowers the send MTU of the affected TCP endpoint (`SndMTU`); there is no per-route PMTU cache and no active probing. Static per-route MTUs can be set in the route table.

**Sentry-side performance overhead** (relevant only when running under runsc, not when consuming netstack as a library): every guest syscall round-trips through the platform layer (`systrap`/`kvm`/`ptrace`). gVisor's own performance guide concedes that `redis` and other syscall-bound workloads pay heavy structural cost; it explicitly states "networking is mostly bound by **implementation costs**, and gVisor's network stack is improving quickly."

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - TCP processor pool sized to `GOMAXPROCS`, plus hashed inbound processor goroutines in `fdbased`
- [x] **Per-core packet queues** - Endpoint-ID-hashed TCP processor queues; connection-hashed fdbased processors; AF_PACKET fanout for link FDs

### Packet I/O
- [x] **Batch UDP receives** - `RecvMMsg` dispatch mode uses `recvmmsg()` (link level, up to 8 packets per call)
- [x] **Batch UDP sends** - `BatchSize = 47` write batches via `sendmmsg` (with `writev` fallback)
- [ ] **Large batch sizes** - No batch reaches 64: outbound batches are 47 packets (sized for GSO) and `recvmmsg` reads at most 8. PACKET_MMAP rings exist but runsc does not use them.

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Not supported. `pkg/tcpip/stack/registration.go:1428` defines only `GSONone`, `GSOTCPv4`, `GSOTCPv6`, `GSOGvisor` — there is no UDP GSO type. netstack *does* support TCP GSO (host-offloaded via `virtio_net_hdr` plus an in-Go `GVisorGSOSupported` fallback), which is what TCP fast-path uses.
- [ ] **UDP GRO (Generic Receive Offload)** - Not supported. The `pkg/tcpip/stack/gro/` engine (8 buckets × 8 flows, 64 KB max super-packet) coalesces TCP segments only, not UDP datagrams.

### Buffer Management
- [x] **Buffer pool reuse** - `pkg/buffer` chunk pools and refcounted buffer chains; `sync.Pool` for `PacketBuffer`s and TCP segments
- [ ] **Large UDP socket buffers** - Non-TCP sockets default to 212 KiB (4 MiB max); tuning is left to the consumer. Neither Tailscale nor Hyprspace changes these netstack defaults.

### Userspace TCP Stack (optional)
- [x] **Userspace TCP implementation** - This *is* the userspace TCP stack
- [x] **Large TCP RX/TX buffers** - 1 MiB defaults, 4 MiB max, receive auto-tuning on. Tailscale keeps the 1 MiB default but raises the maximum to 8 MiB (RX) / 6 MiB (TX), except on iOS (4 MiB).
- [ ] **Tuned congestion control** - Knobs are present (Reno default, CUBIC opt-in via `NewProtocolCUBIC` or `CongestionControlOption`, SACK on by default since 2024), but nothing beyond Reno is on by default. The `TODO(b/345835636)` only records the plan to make CUBIC the default; it says nothing about Reno being broken. Tailscale pins Reno itself because of a congestion-window int overflow that triggers more easily with CUBIC (gVisor issue 11632).
- [x] **Reordering tolerance** - By default: SACK, a segment heap for out-of-order data, and RACK-TLP loss detection with an adaptive, DSACK-driven reordering window. Tailscale turns RACK off (`TCPRecovery(0)`) because of spurious retransmissions it attributes to slow ACK handling, which leaves it on the 3-duplicate-ACK threshold with SACK recovery. Hyprspace keeps RACK.

### Receive Path
- [x] **TCP/packet coalescing on ingress** - GRO engine coalesces TCP segments before TCP processing. It is opt-in: runsc `--gvisor-gro` defaults to off; Tailscale enables it on Linux.
- [x] **RX checksum offload** - `LinkEndpointCapabilities.CapabilityRXChecksumOffload` skips redundant checksum validation when the link layer attests it

### MTU Handling
- [ ] **Conservative MTU** - netstack has no default MTU of its own; the caller sets it (Tailscale 1280, Hyprspace 1420). The Sentry's TUN device and the XDP endpoint use 1500.
- [x] **Path MTU discovery** - Passive PMTUD only: ICMP "frag needed" / "packet too big" lowers the affected TCP endpoint's send MTU; no active probing

### Peer Management
- [ ] **Lazy peer removal** - N/A (no peer concept; ARP/NDP neighbor cache only)
- [ ] **Endpoint caching** - N/A
- [ ] **Efficient keepalive timers** - TCP keepalive only (2h idle / 75s interval / 9 probes)

### Packet Processing
- [x] **Zero-allocation parsing** - `header.IPv4`/`header.TCP` etc. are byte-slice views, not allocations
- [x] **Zero-copy filtering** - `PacketBuffer` slices/clones share buffer chains; netfilter/nftables operate on the same buffer

### State Synchronization
- [ ] **Delta updates** - N/A (no control plane)
- [ ] **Compression** - N/A

### Data Plane Compression
- [ ] **Tunnel compression** - N/A (not a tunnel)
- [ ] **Configurable compression level** - N/A

# Security

This is gVisor's primary design goal — but the security boundary is around the **Sentry**, not around netstack. A VPN that imports `gvisor.dev/gvisor/pkg/tcpip` gets the network stack but **none of the sandbox guarantees**: there is no syscall interception, no platform layer, no seccomp filter, no Gofer. The threat model below applies to `runsc` users, not to Tailscale or Hyprspace.

**Sentry threat model** (from `g3doc/architecture_guide/security.md`):

The Sentry is a Go re-implementation of the Linux system call surface. Its job is to ensure that an attacker who has full control of a guest process cannot reach the host kernel's syscall implementations. The defense layers are:

1. **No syscall pass-through.** Every supported syscall has an independent implementation in `pkg/sentry/syscalls/linux/`. A guest cannot craft arguments to a host kernel call directly; the Sentry interprets the call and may make a *different* host call as part of servicing it.
2. **Memory-safe Go.** The Sentry is a pure-Go binary with no CGo. Buffer overflows, use-after-free, and similar C-kernel bug classes are categorically eliminated for the kernel implementation itself. `unsafe` usage is confined to files suffixed `*_unsafe.go` to make auditing tractable. (The systrap stub signal handler, `sysmsg`, is small C/assembly code compiled into an embedded blob, not linked via CGo.)
3. **Minimal host syscall surface.** The Sentry runs under a restrictive seccomp filter (built with `pkg/seccomp/`, rules in `runsc/boot/filter/`). It is not allowed to `open(2)` files (unless directfs is enabled), create new sockets (unless host networking is enabled), or call most syscalls. Allowed calls are essentially: FD duplication/closing, futex/synchronization, timers, signal management, memory mapping, and packet I/O on the veth-attached socket used for networking.
4. **No raw filesystem access.** The Sentry runs in an empty mount namespace. Filesystem requests are forwarded to the **Gofer** process, which itself runs under a separate seccomp filter (`runsc/fsgofer/filter/`) and a chroot. With `directfs` enabled the Sentry receives host FDs from the Gofer and may open files relative to them itself; the docs describe a stricter mode in which the Gofer performs all filesystem operations.
5. **Platform interception** (`pkg/sentry/platform/`):
   - **systrap** (default): `seccomp` → `SECCOMP_RET_TRAP` → `SIGSYS` → Sentry handler.
   - **kvm**: Sentry runs as both guest and VMM via KVM ioctls; uses hardware virt extensions to switch address spaces cheaply.
   - **ptrace**: Legacy `PTRACE_SYSEMU` mode that runs anywhere `ptrace` works (including VMs without nested virtualization); the docs call it no longer supported and expected to be removed.
6. **Defense-in-depth project rules**: No CGo, no external imports inside core packages, all `unsafe` isolated and named, continuous fuzzing of the Sentry. `SECURITY.md` is the vulnerability-reporting and CVE-assignment policy, not an advisory list.

**What gVisor does NOT defend against** (per its own documentation):

- Hardware side channels (Spectre, L1TF, Rowhammer, MDS) — gVisor relies on host kernel and microcode mitigations.
- Resource exhaustion / DoS — defers to host cgroups.
- Bugs in supported syscall implementations themselves. Per `SECURITY.md`, CVEs are generally assigned only to issues that **cross the sandbox boundary**; bugs that stay inside one sandbox (which includes most netstack bugs) are not considered critical and get no CVE by default. Library consumers of netstack therefore cannot rely on the CVE stream to learn about netstack bugs.
- Anything outside the syscall vector — e.g. an exploitable network service inside the sandbox is still exploitable; gVisor does not patch user code.

**netstack-specific security considerations** (relevant when used as a library):

- **Plaintext stack.** netstack carries cleartext IP. Anything sensitive must be encrypted at a higher layer.
- **Injection surface.** A VPN that pipes attacker-controlled bytes from a peer into a link endpoint is exposing the netstack parser. netstack's parsers (in `pkg/tcpip/header/`) are pure-Go bounds-checked code, but the attack surface is still that of a TCP/IP stack.
- **Memory is bounded per flow, not per stack.** Out-of-order TCP segments are bounded by the receive buffer, and IP fragment reassembly is capped (4 MiB high / 3 MiB low threshold, 30 s timeout). There is no stack-wide socket-memory accounting, so total memory scales with the number of connections the consumer accepts; Tailscale limits in-flight forwarded TCP connection attempts itself.
- **Random secrets** for ISN and timestamp offsets read from `s.SecureRNG()`, which defaults to `pkg/rand` (`getrandom(2)` on Linux, Go `crypto/rand` otherwise). Consumers on pre-November-2023 snapshots (Hyprspace) get 32-bit ISN secrets drawn from a `math/rand` generator and a Jenkins-hash ISN instead of keyed SHA-256.
- **iptables/nftables code** (`pkg/tcpip/stack/iptables*.go`, `pkg/tcpip/nftables/`, plus the guest ABI translation in `pkg/sentry/socket/netfilter/`) is large and complex.

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No connection-level rate limiting. netstack only rate-limits ICMP error generation (`stack/icmp_rate_limit.go`) and out-of-window ACKs (one per 500 ms per endpoint); SYN floods are mitigated via SYN cookies (automatic when the backlog is full, or forced with `TCPAlwaysUseSynCookies`)
- [x] **Stateful packet filter** - iptables-style rules with conntrack (`pkg/tcpip/stack/iptables*.go`, `pkg/tcpip/stack/conntrack.go`, TCP state tracking in `pkg/tcpip/transport/tcpconntrack/`) and an nftables interpreter (`pkg/tcpip/nftables/`)
- [x] **Fine-grained ACLs** - Full iptables/nftables rule sets supported
- [ ] **Capability-based access** - N/A (kernel-style filtering, not capability tokens)

### Identity & Authentication
- [ ] **Identity validation** - N/A (no peer identity concept)
- [ ] **Signed configuration updates** - N/A
- [ ] **Certificate pinning** - N/A

### Implementation
- [x] **Memory-safe language** - Pure Go, no CGo, `unsafe` isolated to `*_unsafe.go` files
- [x] **Privilege separation** - Sentry / Gofer / runsc are separate processes with independent seccomp filters (runsc only)
- [x] **Sandboxing** - This is gVisor's whole purpose for runsc users
- [x] **Audit logging** - `seccheck` framework (`pkg/sentry/seccheck/`) emits structured audit events for syscalls, file ops, etc.

# NAT Traversal

gVisor's networking subsystem performs **NAT** in the iptables sense — it can SNAT/DNAT packets traversing the stack, backed by a connection-tracking module (`stack/conntrack.go`) — but it does **not** perform NAT *traversal*. There is no STUN, no UPnP, no hole-punching, no relay protocol. A VPN that uses netstack must layer all of that on top.

What is implemented:

- **iptables NAT targets** (`pkg/tcpip/stack/iptables_targets.go`, exposed to guests via `pkg/sentry/socket/netfilter/`): SNAT, DNAT, MASQUERADE, REDIRECT
- **nftables** (`pkg/tcpip/nftables/`): the `nat` base-chain type and `srcnat`/`dstnat` priorities are defined, but there are no NAT/masquerade expressions, so NAT in practice goes through the iptables path
- **Connection tracking** (`pkg/tcpip/stack/conntrack.go`, with TCP state tracking in `pkg/tcpip/transport/tcpconntrack/`): Tracks TCP/UDP/ICMP flows for stateful NAT and conntrack matches
- **Port allocation / rewriting** for NAT. (`IP_BIND_ADDRESS_NO_PORT` is accepted from guests but silently ignored.)

What is *not* implemented:

- STUN, TURN, ICE
- UPnP / NAT-PMP / PCP port mapping
- UDP hole punching helpers
- Any kind of relay protocol
- ALG (application-layer gateways) for NAT-traversed protocols

## NAT Traversal Checklist

### Discovery
- [ ] **STUN support** - Not implemented
- [ ] **Multiple STUN servers** - N/A
- [ ] **NAT type detection** - Not implemented

### Port Mapping
- [ ] **UPnP port mapping** - Not implemented
- [ ] **NAT-PMP support** - Not implemented
- [ ] **PCP support** - Not implemented

### Hole Punching
- [ ] **UDP hole punching** - Not implemented
- [ ] **Symmetric NAT handling** - N/A
- [ ] **Rendezvous coordination** - N/A

### Fallback
- [ ] **Relay fallback** - N/A
- [ ] **Multiple relay regions** - N/A
- [ ] **Automatic relay selection** - N/A
- [ ] **TCP relay support** - N/A

# Local Routing

netstack ships a **classical Linux-style routing table** rather than any peer-discovery mechanism. Routing decisions are made per packet by `Stack.FindRoute(...)`, which walks the route table installed via `Stack.SetRouteTable`.

**Routing model:**

- **Route table entries**: destination prefix, gateway, NIC, source hint, MTU
- **Per-NIC primary addresses**: First-, secondary-, and never-primary endpoint promotion controlled by `stack.PrimaryEndpointBehavior`
- **Forwarding** can be enabled per NIC and per network protocol (`SetForwardingDefaultAndAllNICs`), so netstack can act as an IP forwarder/router between link endpoints. Tailscale does **not** use this: its userspace subnet router and exit node put the NIC in promiscuous mode and terminate each TCP/UDP flow with netstack's TCP/UDP forwarders, then re-dial the destination from host sockets.
- **Multicast routing tables** (`pkg/tcpip/network/internal/multicast/route_table.go`, IPv4/IPv6 multicast forwarding) for IGMP/MLD-based group membership
- **Loopback** via `link/loopback` endpoint
- **Neighbor table** (`stack/neighbor_cache.go`): ARP/NDP-driven L2 resolution with the RFC 4861 NUD state machine (`Incomplete`, `Reachable`, `Stale`, `Delay`, `Probe`, `Unreachable`, plus `Static`)

There is no concept of peers, "subnets", LAN preference, exit nodes, or split tunneling at the netstack layer — those are all things the consuming VPN must implement and then encode as routes/NICs in the netstack instance it owns.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No service discovery; mDNS-style discovery would be an application above netstack
- [ ] **Direct path advertisement** - N/A
- [ ] **Same-subnet detection** - Only via the standard route-table prefix match

### LAN Optimization
- [ ] **Automatic LAN preference** - N/A; the route table determines the egress NIC
- [ ] **Trusted path mode** - N/A
- [ ] **LAN-only mode** - N/A

### Routing Features
- [x] **Subnet routes** - Standard CIDR prefix routes via `Stack.SetRouteTable`
- [x] **Full tunnel mode** - A `0.0.0.0/0` / `::/0` route is just another table entry
- [x] **Split tunneling** - Achieved by populating the route table selectively
- [ ] **Route priorities** - No metric/preference field. Routes are kept sorted longest-prefix-first; among equal prefixes the earliest-added route wins

# Central Point of Failure

gVisor has **no controller, no registry, no signaling server, and no infrastructure dependencies** of any kind. A `runsc`-launched sandbox is a single process tree (Sentry + Gofer + optional metric server) that runs entirely on one host. The only "control plane" is the OCI runtime invocation from the container manager (`containerd`, `dockerd`, `kubelet`), and once the sandbox is up it has no further dependence on that manager.

For netstack used as a library, the question is even simpler: it is a Go package linked into the consuming binary. It has no out-of-process state and no runtime service dependencies.

**What can fail:**

- **Sentry crash** → entire sandbox dies; the container manager restarts it the same way it would restart a crashed `runc` container.
- **Gofer crash** → filesystem becomes inaccessible inside the sandbox; the Sentry detects the broken connection and shuts down.
- **Platform driver unavailable** (e.g. KVM disabled in BIOS while `--platform=kvm` is requested) → `runsc` fails to start the sandbox at all.

There is no analogue to a Headscale or NebulaCert to lose.

## Resilience Checklist

### Offline Operation
- [ ] **Existing connections survive** - N/A; the stack has no upstream to lose contact with
- [ ] **Local state caching** - N/A; all state is local and in-memory
- [ ] **Cached credentials** - N/A
- [ ] **Graceful degradation** - N/A (nothing to degrade from)

### Redundancy
- [ ] **Self-hosted controller** - N/A — there is no controller
- [ ] **Controller redundancy** - N/A
- [ ] **Relay redundancy** - N/A
- [ ] **No single root of trust** - N/A; trust boundary is the host kernel

### Efficiency
- [ ] **Delta/incremental updates** - N/A
- [ ] **Long polling / push updates** - N/A
- [ ] **Configurable sync interval** - N/A

# Authentication

gVisor has **no notion of node identity, peer authentication, or enrollment**. It is a single-host runtime, and netstack is a single-process library. The closest things to "authentication" are:

- **Container identity** is whatever the OCI runtime / container manager passes in via the OCI bundle (`config.json`). gVisor inherits the container's user namespace, capabilities, and seccomp profile but does not authenticate them — that is the host container manager's job.
- **Sentry ↔ Gofer channel** is an inherited Unix socket pair created at fork time; there is no on-wire authentication because the channel is by construction private to the sandbox.
- **runsc CLI** trusts whoever can invoke it on the host, exactly like `runc`.
- **Inside the sandbox**, the Sentry implements the full Linux `setuid`/`setgid`/`capabilities`/`SELinux` story (`pkg/sentry/kernel/auth/`) and presents these to guest applications, but this is *guest-internal* authorization, not authentication of the sandbox to anyone else.

For VPN consumers of netstack, identity and authentication are wholly the surrounding VPN's responsibility — netstack has no peer concept to authenticate.

## Authentication Checklist

### Enrollment Methods
- [ ] **Pre-authentication keys** - N/A
- [ ] **Certificate-based enrollment** - N/A
- [ ] **OAuth/OIDC** - N/A
- [ ] **Interactive login** - N/A
- [ ] **CLI authentication** - N/A

### Authorization
- [ ] **Admin approval workflow** - N/A
- [ ] **Automated enrollment rules** - N/A
- [ ] **Ephemeral nodes** - N/A
- [ ] **Node expiry** - N/A

### Identity
- [ ] **Stable device identity** - N/A
- [ ] **Identity portability** - N/A
- [ ] **Multi-user support** - The Sentry implements full Linux multi-user semantics for guest processes, but no multi-tenant identity for the sandbox itself

# Platform Support

**runsc / Sentry:**

- **Linux x86_64** — Primary, fully supported, all platforms (`systrap`, `kvm`, `ptrace`)
- **Linux ARM64** — Supported, all platforms
- **macOS** — Build/test of some packages only via `brew install bazel@8`; not a runtime target — runsc cannot sandbox containers on macOS
- **Windows / FreeBSD / OpenBSD** — Not supported as runtime targets
- **Other architectures** — README notes "Other architectures may become available in the future"
- **Linux kernel requirement**: 4.14.77 or newer (older platforms link in the docs)
- **Container runtimes**: Docker (via `--runtime=runsc`), containerd (via `containerd-shim-runsc-v1` in `shim/`), Kubernetes (via the runtime class mechanism, used in production by GKE Sandbox)
- **Webhook**: `webhook/` ships a Kubernetes admission webhook that injects the `runsc` runtime class

**netstack as a library:**

- **Anywhere Go runs.** netstack is pure Go. The platform-gated parts are link endpoints: `link/fdbased`, `link/xdp`, and `link/sharedmem` are `//go:build linux` (as is `link/tun`'s host-TUN open helper), while `link/channel`, `link/loopback`, and friends are portable. That is why Tailscale and Hyprspace can embed it on Linux, macOS, Windows, and BSD. Tailscale still has platform-specific netstack code: GRO/GSO only on Linux, smaller TCP buffer limits on iOS, and per-platform ping helpers.

**Container support:**

- runsc is a container runtime. It is used by Docker, containerd, Kubernetes, and (notably) GKE Sandbox. The `images/` directory holds the test images plus the `default` build-environment image that carries bazel and the toolchain.

**Filesystem implementations** (`pkg/sentry/fsimpl/`): tmpfs, proc, sys, dev, devpts, devtmpfs, fuse, nsfs, overlay, host, gofer (talks lisafs to the Gofer), erofs (read-only images), cgroupfs, mqfs, signalfd, eventfd, timerfd, pipefs, sockfs, kernfs, user, iouringfs.

**Platform implementations** (`pkg/sentry/platform/`):

- **systrap** — Default since mid-2023, uses `seccomp` `SECCOMP_RET_TRAP` + `SIGSYS`. Replaces ptrace.
- **kvm** — Uses host KVM virtualization extensions; best on bare-metal.
- **ptrace** — Legacy `PTRACE_SYSEMU`; works in nested VMs without virt extensions, but slow. The docs say it is no longer supported and is expected to be removed.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full runsc support on x86_64 and ARM64; netstack is platform-independent
- [ ] **macOS** - No runsc runtime; netstack itself builds and runs on macOS as a library
- [ ] **Windows** - No runsc; netstack builds as a library
- [ ] **FreeBSD/OpenBSD** - No runsc; netstack builds (the fdbased, xdp and sharedmem link endpoints are Linux-gated)

### Mobile
- [ ] **iOS** - No runsc; netstack-as-library ships inside Tailscale's iOS client (Tailscale has an iOS-specific netstack buffer file)
- [ ] **Android** - No runsc; Tailscale's mobile builds embed netstack as a library (Tailscale uses mobile-specific netstack limits)

### Implementation
- [ ] **Kernel-mode datapath** - The whole point is *not* to be in-kernel
- [x] **Userspace implementation** - Pure-userspace Sentry and pure-Go netstack
- [x] **Container support** - runsc is an OCI container runtime; integrates with Docker, containerd, Kubernetes, and the containerd shim
