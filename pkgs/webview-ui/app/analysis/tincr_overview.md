# Overview

> **Note on the benchmarked revision.** This overview describes tincr at commit `63f4e588` (2026-10-28), the checkout listed in `llm-instructions/2026-10-28-source-versions.md`. The benchmarks ran the older revision `b234dc79` (2026-04-20), whose daemon reports `tincd 0.1.0 (Rust) protocol 17.7`. At `b234dc79` the following statements in this document do not hold:
>
> - **Threading**: there is no `Shards` setting and no data-plane worker thread. The event-loop thread runs the whole data path, as in C tinc. The multi-queue TUN open, the classic-BPF reuseport program and the shareable sequence counters exist in the source, but the daemon does not use them. Everything about shard workers, per-shard steering and reordering between shards applies only to the newer commit.
> - **Crypto**: there is no OpenSSL. SPTPS offers only Ed25519 with X25519 and ChaCha20-Poly1305. The AEAD comes from the RustCrypto crates `chacha20` 0.9 and `poly1305` 0.8 (through `chacha20poly1305` 0.10). The x86_64 Linux build targets x86-64-v3 and sets `chacha20_force_avx2`, so the AVX2 backend is fixed at build time, without runtime dispatch and without an AVX-512 path. `SPTPSCipher` (AES-256-GCM) and `SPTPSKex` (X25519 + ML-KEM-768) do not exist, so neither the cipher nor the key exchange can be chosen. The daemon calls no C crypto library; its only C code is the vendored minilzo.
> - **Key rotation**: the `KeyExpire` timer (default 3600 s) re-keys every tunnel. There is no re-key after 2^31 records. After 2^32 - 2^16 records under one key, the session refuses further data records until the next re-key. The 2026-10-27 change that makes meta connections re-key before that limit is not included.
> - **Platforms and packaging**: there is no `android/` app, only the `DeviceType = fd` backend it would use. There is no `tincd-compat` package, no `services.tincr` NixOS module and no nix-darwin module; the benchmark deployed tincr through nixpkgs' `services.tinc`. macOS has no `recvmsg_x`/`sendmsg_x` batching.
> - **tinc-auth**: only the nginx `auth_request` backend exists, not the OIDC provider.
>
> `b234dc79` also has Mainline DHT discovery (`DhtDiscovery`, `tinc-dht-seed`), which this document does not describe.

tincr is a Rust rewrite of tinc 1.1. It reads the same configuration files, speaks the same meta protocol (17.7) and the same SPTPS wire protocol, and provides the same `tinc` command line, so tincr nodes can join an existing tinc 1.1 mesh as drop-in replacements. Like tinc, it builds a decentralized mesh: every node keeps the full network graph, routes traffic to the owner of each subnet, and forwards packets for other nodes when no direct path exists. On top of that it adds a multi-threaded, batched Linux data path, built-in port mapping, in-mesh DNS, an optional AES-256-GCM cipher, an optional post-quantum hybrid key exchange, a Landlock sandbox, and an Android app.

## Key Architecture Components

**tincd**: The daemon. A single event-loop thread (epoll on Linux, kqueue on macOS) owns all sockets, the TUN/TAP device, timers and daemon state. It is split internally into a control plane (meta connections, gossip, graph, routing snapshot) and a data plane (route, encrypt, batch, send). The data plane only reads an immutable routing snapshot published by the control plane.

**Shard workers (Linux)**: With `Shards` (default `auto` = number of cores, capped at 4) the data plane runs on several threads. Each worker owns one queue of a multi-queue TUN device and one `SO_REUSEPORT` UDP socket per listener. Sharding needs Linux, `DeviceType = tun` and `Mode = router`; otherwise tincd stays single-threaded.

**Helper threads**: Blocking work runs on small worker threads that exchange requests and results with the event loop over channels: `tinc-dns` (hostname resolution), `tinc-portmap` (PCP / UPnP-IGD) and `tinc-script` (hook scripts and address-cache writes).

**Meta protocol**: TCP connections carrying newline-terminated ASCII messages (ID, ACK, ADD_EDGE/DEL_EDGE, ADD_SUBNET/DEL_SUBNET, REQ_KEY/ANS_KEY, KEY_CHANGED, MTU_INFO/UDP_INFO, PING/PONG, PACKET/SPTPS_PACKET) inside an SPTPS stream session.

**SPTPS**: tinc's own authenticated key exchange and record layer, used in stream mode for meta connections and in datagram mode for UDP data between each pair of nodes.

**Graph routing**: Kruskal's minimum spanning tree for broadcasts and a breadth-first shortest-path search (fewest hops, then edge weight) for unicast. Unlike C tinc, edge weights are re-measured from meta-connection round-trip times and re-advertised when they drift.

**Auxiliary tools**: `tinc` (CLI, including `invite`/`join`), `tinc-auth` (nginx `auth_request` backend and OIDC provider that identifies users by the mesh node owning their source IP) and `sptps_keypair`.

## Differences from C tinc

- **Threading and sharded fast path**: C tinc is strictly single-threaded. tincr starts up to 4 data-plane threads on Linux by default (`Shards = auto`), using an `IFF_MULTI_QUEUE` TUN device and `SO_REUSEPORT` UDP sockets. A classic-BPF program steers each incoming datagram to a shard by its 6-byte source node ID, so all traffic received from one peer is decrypted on one thread. The kernel picks the TUN queue (and thus the sending shard) by flow hash. Workers only handle the fast cases (established direct tunnels, uncompressed data, TCP super-frames on transmit) and hand everything else to the main thread.
- **Batching**: C tinc batches only UDP receives (`recvmmsg`, 64). tincr also uses `recvmmsg` with 64 packets, drains up to 64 TUN reads per wakeup, and sends runs of equal-sized datagrams to the same peer with one `sendmsg` using `UDP_SEGMENT` (UDP GSO). It does not use `sendmmsg`. macOS uses `recvmsg_x`/`sendmsg_x`.
- **Offloads**: C tinc opens a plain TUN device. tincr opens the Linux TUN with `IFF_VNET_HDR` and enables TSO via `TUNSETOFFLOAD`, splits the resulting 64 KB TCP super-frames itself, and on receive coalesces in-order TCP segments of one flow back into a super-frame that is written to TUN in one call. The `UDP_GRO` socket option is not used.
- **Crypto implementation and SIMD**: C tinc uses bundled portable C code for ChaCha20-Poly1305 (no SIMD). tincr keeps the same OpenSSH-style construction on the wire but runs it through OpenSSL (`EVP_chacha20` plus the `POLY1305` MAC), which picks AVX2/AVX-512 code paths at runtime. tincr-to-tincr edges can also use AES-256-GCM (`SPTPSCipher`, OpenSSL with AES-NI/VAES) and a hybrid X25519 + ML-KEM-768 key exchange (`SPTPSKex`). Ed25519/X25519 use curve25519-dalek, and key derivation is the same HMAC-SHA512 PRF as in C. The `KeyExpire` re-key (default and maximum 3600 s) always runs, whereas C compiles it only into builds with legacy support; tincr additionally re-keys after 2^31 records and hard-stops a key before its 32-bit sequence number could wrap.
- **MTU**: Like C tinc, tincr does not set the interface MTU and uses a 1518-byte internal frame limit (1500-byte IP packet). It drops oversized TUN reads instead of truncating them, honours `PMTUDiscovery = no` per host, and its `ClampMSS` finds the MSS option anywhere in the TCP header. There is no jumbo-frame build.
- **Legacy protocol support**: Not implemented. There is no RSA meta protocol, no `Cipher`/`Digest`/`MACLength` (warned about and ignored) and no `--bypass-security`. Peers without an Ed25519 key, tinc 1.0 nodes and tinc 1.1 nodes with `ExperimentalProtocol = no` cannot connect. Missing public keys are not fetched over the mesh: REQ_PUBKEY/ANS_PUBKEY are rejected, which removes C tinc's trust-on-first-use path.
- **Sandboxing**: C tinc sandboxes only on OpenBSD (pledge/unveil). tincr offers a Linux Landlock filesystem allowlist (`Sandbox = normal|high`, kernel ≥ 5.13). It is off by default and restricts paths only, not syscalls. Privilege drop with `--user` sets and verifies all three uids/gids, always sets `no_new_privs`, and fails hard on error.
- **Platforms**: C tinc supports Linux, the BSDs, macOS, Windows and Solaris. tincr has device backends for Linux (TUN/TAP), macOS (utun only, no TAP) and a passed-in file descriptor (Android). There is no Windows support and no TUN/TAP backend for FreeBSD/OpenBSD/NetBSD, although the event loop compiles there.
- **Android directory**: C tinc has no Android app. tincr ships one in `android/`: a Kotlin VpnService app that runs `tincd` as a bundled executable and passes it the VPN tun file descriptor over a Unix socket. It supports joining a network with an invitation URL, including QR codes.
- **Nix packaging and containers**: tincr is packaged as a Nix flake (`tincd`, `tincd-compat`, Android builds) with its own NixOS module (`services.tincr`) and nix-darwin module, and also works with nixpkgs' `services.tinc`. The NixOS module runs tincd as an unprivileged system user on a persistent multi-queue TUN created by systemd-networkd, with systemd hardening, socket activation and watchdog. There is no OCI/Docker image and no Kubernetes integration. NixOS container tests run tincd with a dummy device because `/dev/net/tun` is not available there.
- **x86-64-v3 build default**: The workspace compiles x86_64 Linux builds with `target-cpu=x86-64-v3` (AVX2, Haswell or newer). The default binary dies with SIGILL on older or low-power x86 CPUs; the `tincd-compat` package drops that requirement. The AEAD kernels in OpenSSL use runtime dispatch either way.
- **Other additions**: PCP and UPnP-IGD port mapping (including IPv6 firewall pinholes) built in instead of the optional miniupnpc build, TCP simultaneous-open hole punching through a relay, in-mesh DNS, `tinc-auth`, systemd `Type=notify`/watchdog/socket activation, and a default replay window of 256 packets (C: 128).

# Protocol

tincr uses tinc 1.1's two-protocol design unchanged: a TCP meta protocol for control and per-node-pair SPTPS datagrams over UDP for data. All tincr extensions are trailing tokens that C tinc ignores, new REQ_KEY sub-types that C relays verbatim, or settings that are only used when both host files ask for them.

## Control Plane

Every meta connection starts with a single cleartext `ID <name> 17.7` line so the receiver can pick the right host key. The connection then switches to SPTPS stream mode and all further messages are encrypted. Inside, the messages are:
- **ID / ACK** - Node name, protocol version, listening port, options and initial edge weight
- **ADD_EDGE / DEL_EDGE** - Meta connections appearing or disappearing anywhere in the mesh, with endpoint address and weight; flooded to all nodes
- **ADD_SUBNET / DEL_SUBNET** - Which IP or MAC ranges a node owns; flooded
- **REQ_KEY / ANS_KEY** - Carry the SPTPS handshake of the per-pair UDP session hop-by-hop along the routed path. Relaying nodes append the source address they observed, which the endpoints use for hole punching. tincr also uses REQ_KEY sub-types 64/65 for its TCP simultaneous-open punch.
- **KEY_CHANGED** - A node discarded its data-channel keys
- **MTU_INFO / UDP_INFO** - Path-MTU ceilings and observed UDP endpoints along a relay path
- **PING / PONG** - Keepalive (default every 60 s); the round trip also feeds the edge weight
- **PACKET / SPTPS_PACKET** - Data packets tunnelled over the TCP stream when no UDP path is usable

Gossip is accepted on the authority of the direct neighbour and is not signed by the originating node.

## Data Plane

Data travels as UDP datagrams of the form `| dst node ID (6) | src node ID (6) | seqno (4) | encrypted type + payload | tag (16) |`. Node IDs are the first 6 bytes of SHA-512 of the node name and sit outside the encryption, so intermediate nodes can forward a datagram without holding its keys; the destination ID is zero for direct packets. In router mode the Ethernet header is removed before encryption and rebuilt on the receiver, so the per-packet overhead is 33 bytes plus UDP/IP headers. Each datagram is an independent record with its own sequence number, checked against a sliding replay window, so loss and reordering do not block later packets.

Direct UDP is preferred. Until PMTU discovery has confirmed a working UDP path, or when UDP is blocked, `TCPOnly` is set, or a packet is larger than the path MTU, the same encrypted record is sent as `SPTPS_PACKET` over the TCP meta connection to the next hop. As soon as a probe reply (or, when only the return direction is filtered, an MTU_INFO acknowledgement) confirms UDP, traffic moves back to UDP.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary transport for VPN data (SPTPS datagrams)
- [x] **TCP fallback** - Data goes over the TCP meta connection (or over other nodes' meta connections) until UDP is confirmed, for packets above the path MTU, or always with `TCPOnly`; outgoing meta connections can use SOCKS4, SOCKS5, HTTP CONNECT or exec proxies
- [ ] **QUIC support** - No QUIC implementation
- [ ] **WebSocket support** - No WebSocket transport

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support
- [x] **IPv6 support** - Native IPv6 tunneling with NDP handling in router mode
- [x] **Dual-stack** - IPv4 and IPv6 subnets on the same interface

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - Router mode (default) over a TUN device
- [x] **Layer 2 (Ethernet) mode** - Switch and hub modes over a TAP device; Linux only (macOS builds are utun-only)
- [x] **Bridging support** - Switch/hub mode with a TAP device can bridge non-VPN LAN devices into the overlay (Linux)

### Advanced
- [ ] **Multipath/bonding** - No aggregation or active-backup across several underlay paths
- [ ] **QoS/traffic shaping** - Only opt-in `PriorityInheritance` (copies the inner TOS/traffic class to the outer header); no queues, classes or rate limits
- [x] **Multicast support** - Broadcast and multicast are flooded along the minimum spanning tree (default) or to direct neighbours only (`Broadcast = direct`)

# Encryption

tincr implements only the SPTPS protocol. Each node has a long-term Ed25519 key. Both sides send a KEX record with a version byte, a 32-byte nonce and an ephemeral public key (Ed25519-encoded and converted to X25519 for the exchange). Both then sign the transcript (role bit, both KEX records, session label) with their identity key, compute the X25519 shared secret, and expand it with tinc's HMAC-SHA512 PRF (TLS 1.0 `P_hash` with a zero initial block) into two 64-byte directional keys. Either side can later re-key in-band under the current keys. For UDP sessions the handshake records travel inside REQ_KEY/ANS_KEY over the meta connections.

## Encryption Layer Details

**Key Exchange**: Ephemeral X25519 authenticated with Ed25519 signatures, implemented with curve25519-dalek and ed25519-dalek. No other curves. Optional `SPTPSKex = x25519-mlkem768` (tincr only, both host files must request it) adds one ML-KEM-768 encapsulation per direction, mixes both KEM secrets into the PRF input and binds all KEM public data into the PRF seed, and adds a key-confirmation round to the initial handshake.

**Symmetric Ciphers**:
- **ChaCha20-Poly1305** (default) - The OpenSSH-style construction tinc uses (64-bit nonce, Poly1305 key from keystream block 0, no AAD), executed through OpenSSL's `EVP_chacha20` and `POLY1305` MAC with thread-local reusable contexts. OpenSSL selects SIMD code paths (AVX2, AVX-512) at runtime.
- **AES-256-GCM** (opt-in `SPTPSCipher = aes-256-gcm`, tincr only) - OpenSSL `EVP_aes_256_gcm` with AES-NI/PMULL or VAES. The project reports roughly double the single-flow throughput on AES-capable CPUs.

Neither choice is negotiated on the wire. Each side derives it from both host files, and a non-default choice is mixed into the session label, so a mismatch fails the handshake instead of corrupting data. With defaults the handshake and data bytes are identical to C tinc.

**Nonce Construction**: The record sequence number is the nonce: a 32-bit counter on the wire, used as a 64-bit big-endian nonce for ChaCha20 and as `0⁸ ‖ seqno` for GCM. tincr hard-caps each key at 2^32 − 2^16 records and starts a new handshake at half of that.

**Key Rotation**: Every valid tunnel is re-keyed with a fresh handshake every `KeyExpire` seconds (default 3600, values above 3600 are clamped), and in addition when the record counter crosses the threshold. Meta connections also re-key before the nonce limit.

**Replay Protection**: Sliding bitmap window, default 32 bytes (256 packets), configurable with `ReplayWindow`.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - X25519 ECDH (Ed25519-encoded ephemeral keys) in SPTPS
- [x] **Perfect Forward Secrecy** - Ephemeral ECDH per session and per re-key
- [x] **Post-quantum readiness** - Partial: opt-in hybrid X25519 + ML-KEM-768 (`SPTPSKex`), only between tincr nodes whose host files both request it; signatures stay Ed25519
- [x] **Key rotation** - New SPTPS handshake every `KeyExpire` (default 3600 s) and after 2^31 records per key

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 (default) or AES-256-GCM
- [x] **Hardware-accelerated crypto** - OpenSSL's runtime-dispatched SIMD ChaCha20/Poly1305 (AVX2/AVX-512) by default; AES-NI/VAES for the opt-in AES-256-GCM
- [x] **Constant-time operations** - OpenSSL AEAD implementations, curve25519-dalek, and constant-time tag comparison

### Protocol Security
- [x] **Replay protection** - 256-packet sliding window by default (`ReplayWindow`, in bytes)
- [ ] **Noise Protocol or equivalent** - SPTPS is tinc's own protocol, not a Noise pattern
- [ ] **No cleartext metadata** - Every meta connection begins with a cleartext `ID` line containing the node name, and every UDP datagram carries cleartext 6-byte source (and, when relayed, destination) node IDs derived from node names

# Performance

tincr keeps tinc's event-driven design but rebuilt the Linux data path around kernel batching and offloads. On Linux it adds sharded data-plane threads. The project reports about 3.2 Gbit/s for a single flow (5.7 Gbit/s with AES-256-GCM) and 8.6 Gbit/s aggregate from 4 peers on a Ryzen AI 7 350, against about 1 Gbit/s for C tinc; these are the project's own measurements.

## Threading Model

**Main thread**: One event-loop thread (epoll) owns every socket, the TUN device, timers and all daemon state. It runs the complete control plane and the full data path, and is also shard 0 of the data plane. DNS resolution, port mapping and hook scripts run on helper threads.

**Sharded data plane (Linux default)**:
- `Shards = auto` resolves to the number of available cores, capped at 4; `Shards = 1` disables it. Sharding is active only on Linux with `DeviceType = tun` and `Mode = router`; on other platforms, with TAP, or in switch/hub mode tincd is single-threaded. If a multi-queue TUN cannot be opened in auto mode (e.g. a pre-created single-queue device), it falls back to one thread.
- The TUN device is opened with `IFF_MULTI_QUEUE`, one queue per shard. Each listener gets extra UDP sockets bound with `SO_REUSEPORT`, one per shard.
- A classic-BPF reuseport program (no `CAP_BPF` needed) selects the socket from the source node ID in the datagram prefix. All traffic received from one peer lands on the same shard. Relayed packets without a source ID go to shard 0; handshake datagrams land on an arbitrary shard and are handed to the main thread.
- The kernel chooses the TUN queue by inner flow hash, so different flows to the same peer can be encrypted on different shards.
- Worker threads handle only the fast paths: decrypting uncompressed data from established direct tunnels and writing it to TUN, and encrypting and sending TCP super-frames read from TUN. Everything else (single non-TSO frames, compressed packets, probes, handshakes, relayed or unknown traffic) is handed to the main thread through a queue and an eventfd.
- Workers receive routing state as shared immutable snapshots; sequence counters are atomics shared between threads and the replay window sits behind a per-tunnel mutex.

**Consequence for a two-node benchmark**: Decryption of everything one peer sends runs on a single shard, so a single receiving direction is bounded by one core. Several parallel TCP flows can spread encryption across shards on the sender. UDP traffic and small non-TSO packets are encrypted by the main thread.

**Packet I/O Details**: On Linux, UDP receives use `recvmmsg` with 64 messages per call. TUN reads are drained up to 64 per wakeup. Because TSO is enabled on the TUN device, a bulk TCP flow arrives as one super-frame of up to 64 KB, which tincr splits into segments, encrypts into a contiguous batch buffer and sends with one `sendmsg` carrying `UDP_SEGMENT`. Batches end at a change of destination or segment size. If the kernel rejects GSO (`EIO` or `ENOPROTOOPT`), tincr switches to one `sendto` per frame. On receive, in-order TCP segments of one flow from a `recvmmsg` batch are coalesced into a super-frame with a virtio-net header and written to TUN in one call. UDP sockets get 1 MiB send and receive buffers by default (`UDPSndBuf`/`UDPRcvBuf`). The main thread's buffers (receive batch, TUN arena, encrypt scratch, TX batch, coalescer) are allocated once and reused.

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Linux default: up to 4 shard threads with multi-queue TUN and reuseport UDP; RX from one peer is pinned to one shard, and the worker TX fast path covers only TCP super-frames. Single-threaded on macOS/Android, with TAP, and in switch/hub mode
- [ ] **Per-peer packet queues** - No per-peer queues; shards are per-core, with steering by source node ID (RX) and TUN flow hash (TX)

### Packet I/O
- [x] **Batch UDP receives** - `recvmmsg` with 64 messages per call on Linux and Android (main thread and every shard); `recvmsg_x` on macOS
- [x] **Batch UDP sends** - Not via `sendmmsg`: runs of equal-sized datagrams to one destination go out as one `sendmsg` with `UDP_SEGMENT`; other packets are sent one `sendto` each. macOS uses `sendmsg_x`
- [x] **Large batch sizes** - 64 datagrams per `recvmmsg`, up to 64 TUN reads per wakeup, and TCP super-frames of up to 64 KB (about 40 segments) per TUN read/write

### UDP Offload
- [x] **UDP GSO (Generic Segmentation Offload)** - `UDP_SEGMENT` control message on Linux, falling back to per-frame sends if the kernel refuses
- [ ] **UDP GRO (Generic Receive Offload)** - The `UDP_GRO` socket option is not used; receive batching relies on `recvmmsg`, and coalescing happens in userspace before the TUN write

### Buffer Management
- [x] **Buffer pool reuse** - Fixed arenas and scratch buffers allocated once per thread and reused (64 × 2 KB receive ring, TUN arena, TSO scratch, TX batch, 64 KB coalescing bucket); shard workers still allocate small per-batch bookkeeping vectors
- [x] **Large UDP socket buffers** - 1 MiB `SO_RCVBUF`/`SO_SNDBUF` requested by default (capped by the kernel's `rmem_max`/`wmem_max`)

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - No userspace TCP/IP stack; tunneled traffic goes through the kernel stack via TUN/TAP
- [ ] **Large TCP RX/TX buffers** - N/A (no userspace TCP stack)
- [ ] **Tuned congestion control** - N/A (no userspace TCP stack)
- [ ] **Reordering tolerance** - N/A (no userspace TCP stack)

### Receive Path
- [x] **TCP/packet coalescing on ingress** - In-order TCP segments of the same flow within a receive batch are merged into one super-frame and written to TUN with a virtio-net header (Linux TUN only)
- [ ] **RX checksum offload** - Not controlled by tincr; it computes checksums itself when splitting and coalescing

### MTU Handling
- [ ] **Conservative MTU** - tincr does not set the interface MTU; it stays at the OS default (1500 on Linux TUN) unless `tinc-up` changes it (the Android app sets 1400). Packets above the path MTU get ICMP Fragmentation Needed / Packet Too Big, and `ClampMSS` (default on) rewrites TCP MSS options to fit the path MTU
- [x] **Path MTU discovery** - Per-node UDP probing as in tinc 1.1, on by default; `PMTU` and `PMTUDiscovery` can be set per host

### Peer Management
- [x] **Lazy peer removal** - Unreachable nodes and their subnets stay known until `tinc purge`
- [x] **Endpoint caching** - Per-peer address cache; addresses that completed a handshake are persisted to disk and tried first. Learned UDP addresses do not replace a confirmed one
- [x] **Efficient keepalive timers** - UDP probes only while a tunnel is in use (2 s discovery, 10 s keepalive, 30 s timeout); meta connections ping every 60 s

### Packet Processing
- [x] **Zero-allocation parsing** - Wire headers are parsed in place with fixed-layout structs; the main-thread data path does no heap allocation in steady state
- [ ] **Zero-copy filtering** - No packet filter; packets are copied during TSO splitting, encryption into the batch buffer and decryption into the receive arena

### State Synchronization
- [x] **Delta updates** - ADD_EDGE/DEL_EDGE and ADD_SUBNET/DEL_SUBNET carry incremental changes (tincr additionally re-advertises edges when measured RTT drifts)
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [x] **Tunnel compression** - Optional per-node compression: zlib levels 1-9, LZO 10, LZ4 12 (LZO level 11 can be decompressed but tincr does not compress with it); off by default. Compressed packets bypass the shard fast path
- [x] **Configurable compression level** - Each node declares with `Compression` the level it wants to receive

# Security

tincr has no published CVEs or security advisories. There is no private security contact; reports go to the public issue tracker.

## Known Security Issues

**Nonce-limit fixes during development**: Early versions could, in theory, wrap the 32-bit record counter and reuse a ChaCha20 nonce under the same key. The parallel-encrypt path was then given a hard per-key cap below 2^32 (April 2026), and on 2026-10-27 meta connections were made to re-key before reaching that limit. Both fixes predate any release.

**Inherited CVEs do not apply**: The legacy-protocol vulnerabilities of C tinc (CVE-2018-16737, CVE-2018-16738, CVE-2018-16758) concern the RSA meta protocol and negotiable ciphers, which tincr does not implement.

## Potential Security Concerns

**Every member is trusted for routing**: Gossip is flooded and accepted on the authority of the neighbour that relayed it, not signed by its origin. Any authenticated node can announce arbitrary subnets (hijack or blackhole traffic), invent or delete edges for other nodes, or flood gossip. `StrictSubnets` and `TunnelServer` limit this but are off by default, and a SIGHUP does not reload the authorised subnets under `StrictSubnets`.

**Identity metadata in cleartext**: The `ID` line with the node name is sent unencrypted at the start of every meta connection, and UDP datagrams carry 6-byte IDs derived from the node name.

**Unsafe default device**: An unset `DeviceType` means a dummy device, so a fresh node connects to peers but moves no packets (logged as a warning).

**Unsafe code and C dependencies**: The daemon is Rust, but the AEAD runs in the system OpenSSL library through FFI, LZO compression uses vendored C (minilzo), and ioctls and syscall wrappers contain `unsafe` blocks. The project runs fuzzing targets for packet and proxy parsers.

**Sandbox is optional and path-only**: Landlock confinement is off by default and does not filter syscalls. The NixOS module instead relies on systemd hardening (unprivileged user, `SystemCallFilter`, `ProtectSystem=strict`).

**Replay window and reordering**: The default window is 256 packets. With several shards encrypting different flows for the same peer, packets can be reordered on the wire; reordering beyond the window is dropped unless `ReplayWindow` is raised.

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - Incoming meta connections are tarpitted above `MaxConnectionBurst` (default 10) per host and overall; inbound meta requests are capped at 2176 bytes
- [ ] **Stateful packet filter** - No connection tracking or firewall for tunnel traffic
- [ ] **Fine-grained ACLs** - No per-port/protocol rules in the daemon; `tinc-auth` only provides HTTP-level identity for web services behind nginx
- [ ] **Capability-based access** - Subnet ownership only; no tags or groups

### Identity & Authentication
- [x] **Identity validation** - Node names are bound to Ed25519 public keys pinned in `hosts/` files; peers without a locally provisioned key are refused (no REQ_PUBKEY trust-on-first-use)
- [ ] **Signed configuration updates** - Host files and gossip are not signed by any authority
- [ ] **Certificate pinning** - N/A: no control server; raw peer keys are pinned in `hosts/` files, and invitation URLs carry the hash of the mesh's invitation key, which the joining node checks

### Implementation
- [x] **Memory-safe language** - Rust; `unsafe` limited to FFI (OpenSSL AEAD, minilzo) and syscall/ioctl wrappers
- [x] **Privilege separation** - Opt-in `--user` (all uids/gids set and verified, `no_new_privs` always set, failure is fatal) and `--chroot`; the NixOS module runs tincd unprivileged with only `CAP_NET_BIND_SERVICE` on a pre-created TUN
- [x] **Sandboxing** - Partial: opt-in Landlock filesystem allowlist on Linux (`Sandbox = normal|high`, kernel ≥ 5.13; `high` disables hook scripts); no seccomp in the daemon
- [ ] **Audit logging** - Authentication and connection events go to the normal log; no dedicated security audit log

# NAT Traversal

tincr inherits tinc 1.1's peer-assisted NAT traversal and adds built-in port mapping and a TCP hole-punching mechanism.

## How NAT Traversal Works

**Reflexive Address Discovery**: When a node forwards REQ_KEY/ANS_KEY or UDP_INFO, it appends the UDP source address it observed for the sender. tincr also adds the reflexive address on REQ_KEY in the reverse direction. Nodes thereby learn their peers' public endpoints from third nodes; they do not learn their own endpoint via STUN.

**UDP Probing**: PMTU probes double as hole punches and keepalives (2 s discovery interval, 10 s keepalive, 30 s timeout). With `LocalDiscovery` (default on) a probe also goes to the peer's advertised local address. tincr extends MTU_INFO so a node whose inbound UDP is filtered can still learn that its outbound UDP works.

**Port Mapping**: With `UPnP = yes` (or `udponly`), a worker thread asks the default gateway for a mapping, first with PCP and then with UPnP-IGD. On IPv6 it requests a firewall pinhole. The client is built in (no miniupnpc). NAT-PMP is intentionally not implemented.

**TCP Simultaneous Open**: When AutoConnect wants a direct meta connection to a peer whose addresses all failed, but a relayed path exists, the two nodes exchange addresses through the relay and dial each other at the same time from pre-bound ephemeral ports. This only works when the obstacle is a stateful firewall without port translation; it fails behind port-translating NAT.

**Relay Fallback**: If no direct UDP path works, packets are forwarded along the mesh graph through intermediate nodes, over UDP or over their TCP meta connections. Relays forward by destination node ID without decrypting. tincr also relays binary SPTPS_PACKETs without holding a key with the destination, which C tinc cannot do.

## NAT Traversal Checklist

### Discovery
- [ ] **No own public node needed** - Outgoing meta connections need an `Address` from the peer's host file, and `tinc invite` refuses to run without one (`crates/tincd/src/outgoing.rs:661-695`, `crates/tinc-tools/src/cmd/invite.rs:500-503`)
- [ ] **STUN support** - No STUN; peers' reflexive addresses are reported by intermediate nodes (REQ_KEY/ANS_KEY, UDP_INFO)
- [ ] **Multiple STUN servers** - N/A (no STUN)
- [ ] **NAT type detection** - No NAT type classification

### Port Mapping
- [x] **UPnP port mapping** - Built-in UPnP-IGD client, runtime option `UPnP = yes|udponly` (off by default)
- [ ] **NAT-PMP support** - Not implemented on purpose; NAT-PMP-only gateways fall through to UPnP-IGD
- [x] **PCP support** - Built-in PCP client (tried first), including IPv6 firewall pinholes

### Hole Punching
- [x] **UDP hole punching** - Simultaneous probing toward reflexive addresses learned through the mesh
- [ ] **Symmetric NAT handling** - No port prediction; the TCP simultaneous-open punch does not work behind port-translating NAT. Such peers fall back to relaying
- [x] **Rendezvous coordination** - Meta protocol (REQ_KEY/ANS_KEY, UDP_INFO, PUNCH/PUNCH_SYNC) coordinates through existing mesh nodes

### Fallback
- [x] **Relay fallback** - Automatic forwarding through intermediate mesh nodes until a direct path works, or permanently
- [ ] **Multiple relay regions** - N/A (no relay infrastructure; any node can relay)
- [x] **Automatic relay selection** - Partial: next hop by fewest hops, then lowest edge weight; tincr measures edge weights continuously from meta-connection RTT
- [x] **TCP relay support** - Packets can be carried over the TCP meta connections of intermediate nodes; payloads stay end-to-end encrypted

# Local Routing

tincr supports tinc's three routing modes. Router mode (default) routes IP packets by subnet with ARP/NDP handling, IPv4 fragmentation and ICMP generation. Switch mode learns MAC addresses like an Ethernet switch, and hub mode floods every frame. Switch and hub modes need a TAP device and are not available on macOS.

## Peer Discovery on LANs

**Local Discovery**: With `LocalDiscovery` (default on), each edge carries the local address of its meta connection. While UDP to a peer is unconfirmed, tincr also probes that local address, so peers on the same LAN find the direct path even if hairpin NAT fails. There is no broadcast or multicast LAN discovery and no explicit same-subnet check.

**In-mesh DNS**: With `DNSAddress` and `DNSSuffix` set, tincd answers A/AAAA queries for `<node>.<suffix>` (all host-length subnets of that node) and PTR queries for mesh addresses by intercepting DNS packets addressed to `DNSAddress` on the TUN device. It does not bind a socket and does not forward other queries. OS resolver integration is left to `tinc-up` or the NixOS module (systemd-networkd/resolved split DNS).

## Routing Features

**Subnet Routing**: Nodes announce IPv4, IPv6 or MAC subnets with optional weights. The reachable owner with the lowest weight wins, with automatic failover. Any node can announce `0.0.0.0/0` or `::/0` to act as an exit; the default route on the client must be configured by scripts.

**Stable Routing**: tincr keeps a live connection's path when an equally good one appears, and AutoConnect opens direct connections to nodes it relays a lot of traffic for and keeps them for a grace period.

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No LAN broadcast/multicast announcements; local discovery uses unicast probes to advertised local addresses
- [x] **Direct path advertisement** - ADD_EDGE carries each meta connection's local address
- [ ] **Same-subnet detection** - No subnet comparison; local addresses are probed

### LAN Optimization
- [x] **Automatic LAN preference** - Partial: local-address probes are sent alongside WAN probes while UDP is unconfirmed; once an address is confirmed, learned addresses do not displace it
- [ ] **Trusted path mode** - No option to skip encryption
- [ ] **LAN-only mode** - No restriction to local networks

### Routing Features
- [x] **Subnet routes** - ADD_SUBNET advertises routed subnets
- [x] **Full tunnel mode** - A node can announce `Subnet = 0.0.0.0/0` / `::/0`; client default routes are set by user scripts
- [x] **Split tunneling** - Only announced subnets are routed into the mesh
- [x] **Route priorities** - Subnet weights (`Subnet = 10.0.0.0/24#5`) with failover to the next reachable owner

# Central Point of Failure

**tincr has NO central point of failure** - it is a peer-to-peer mesh without a controller, lighthouse or bootstrap server.

## What Happens When Nodes Fail

**Existing tunnels continue working**: Every node holds the full graph and its own keys. When a node goes down, DEL_EDGE gossip removes it and routing is recomputed around it.

**New nodes need any reachable member**: A joining node only needs a meta connection to one existing node (or an invitation from one) to learn the whole topology.

**Relays are ordinary nodes**: If a node that was relaying traffic disappears, traffic moves to the next shortest path, or to a direct path if one can be established.

## Mitigation Strategies

**AutoConnect** (default on): Keeps a small random set of meta connections (about 3) for resilience, connects to unreachable nodes and drops superfluous connections, but never one that is currently the next hop for active traffic.

**Multiple public nodes**: Give several nodes an `Address` so new or roaming nodes have more than one entry point.

**Optional hub-and-spoke**: `TunnelServer = yes` stops gossip forwarding so spokes do not see each other, which makes the hub a central point by design.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - No controller exists; tunnels do not depend on any special node
- [x] **Local state caching** - Full network graph in memory on every node; working peer addresses persisted in the address cache
- [ ] **Cached credentials** - N/A (no controller); keys and host files are local files
- [x] **Graceful degradation** - The mesh routes around failed nodes automatically

### Redundancy
- [x] **Self-hosted controller** - Fully decentralized; nothing runs outside the user's own nodes
- [ ] **Controller redundancy** - N/A (no controller)
- [x] **Relay redundancy** - Any intermediate node can relay
- [x] **No single root of trust** - Per-node key pairs pinned pairwise in host files; no CA

### Efficiency
- [x] **Delta/incremental updates** - ADD_EDGE/DEL_EDGE and ADD_SUBNET/DEL_SUBNET carry only changes
- [x] **Long polling / push updates** - Gossip is pushed immediately over the meta connections
- [ ] **Configurable sync interval** - Updates are pushed immediately; only the UDP_INFO/MTU_INFO debounce intervals are configurable

# Authentication

Nodes authenticate with Ed25519 keys that are pinned in host files; there is no CA, certificate or central account.

## Key-Based Authentication

**SPTPS Authentication**: Both sides sign the KEX transcript (role bit, both KEX records, label) with their Ed25519 identity key, and each verifies the signature against the public key stored in its `hosts/<name>` file. RSA keys are not supported; `generate-rsa-keys` is a no-op kept for compatibility with existing deployment scripts.

**Key Storage**: Public keys and optional `Address`/`Port`/`Subnet` lines live in `/etc/tinc/<netname>/hosts/<name>`; the private key is in `ed25519_key.priv`. `HostsOverlayDirectory` adds a second, writable host directory for deployments where `hosts/` is read-only.

**Invitations**: `tinc invite NODE` creates a single-use URL (valid one week by default, `InvitationExpire`) containing a hash of the mesh's invitation key and a random cookie. `tinc join URL` checks that the server holds that key, presents the cookie, receives a name, configuration and starter host files over SPTPS, and sends back its new public key. tincr adds `--replace` to re-key an existing node through an invitation and `-e KEY=VAL` to pass values to the invitation scripts; a failing `invitation-created` hook cancels the invitation. The Android app can join from a scanned QR code or a `tinc://` link.

**Static Configuration**: Host files can also be exchanged manually (`tinc export`/`import`/`exchange`). Since public keys are never fetched over the mesh, every peer a node talks to must have its key provisioned locally (directly or via an invitation).

**Mesh-identity web login**: `tinc-auth` lets web services use mesh membership as login: as an nginx `auth_request` backend it returns the node owning the client's source IP, and as an OIDC provider it signs in users of applications such as Gitea or Grafana. This authenticates users to other services; it is not an enrollment method for tincr itself.

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Single-use invitation URLs (`tinc invite`, default validity 1 week) or manual host-file exchange
- [ ] **Certificate-based enrollment** - No CA or certificates; raw Ed25519 keys only
- [ ] **OAuth/OIDC** - No SSO for joining the mesh (`tinc-auth` is an OIDC provider for other applications)
- [ ] **Interactive login** - No interactive or browser login
- [x] **CLI authentication** - `tinc join <URL>` enrolls a node from the command line

### Authorization
- [ ] **Admin approval workflow** - No approval step; possession of an invitation or a pinned key is sufficient
- [ ] **Automated enrollment rules** - No conditional rules; only the `invitation-created`/`invitation-accepted` hook scripts
- [ ] **Ephemeral nodes** - No automatic cleanup of temporary nodes
- [ ] **Node expiry** - Keys do not expire (only invitations do)

### Identity
- [x] **Stable device identity** - Ed25519 key pair per node
- [x] **Identity portability** - Private key and host files can be moved to another device
- [ ] **Multi-user support** - One identity per daemon instance, no user concept

# Platform Support

tincr runs on Linux and macOS and ships an Android app. It covers fewer platforms than C tinc.

## Supported Platforms

**Desktop/Server**:
- Linux (Nix flake packages for x86_64, aarch64 and riscv64; TUN, TAP, fd and dummy devices; C tinc's raw socket, multicast, UML and VDE device types are not available)
- macOS (aarch64 in the flake; utun only)

**Mobile**:
- Android (in-repo Kotlin app, arm64-v8a and x86_64, Android 7.0 / API 24 and newer)

**Not supported**: Windows, FreeBSD/OpenBSD/NetBSD (no TUN/TAP backend), iOS, Solaris.

## Implementation Details

**Userspace Implementation**: tincd runs entirely in userspace on TUN/TAP devices; packets are encrypted, decrypted and routed in the daemon.

**Linux**: TUN with `IFF_VNET_HDR`, TSO via `TUNSETOFFLOAD`, `IFF_MULTI_QUEUE` for sharding, `recvmmsg`, UDP GSO, 1 MiB socket buffers, and optional Landlock. systemd integration covers `Type=notify`, watchdog and socket activation for the TCP listener.

**macOS**: utun device with batched `recvmsg_x`/`sendmsg_x`; single-threaded data plane, no TAP; nix-darwin module.

**Android**: `DeviceType = fd`. The app's VpnService creates the tun interface (MTU 1400 by default, the app excluded from its own VPN) and hands the file descriptor to tincd over a Unix socket; tincd runs as an executable shipped as `libtincd.so`. OpenSSL is vendored for Android builds.

**Builds**: x86_64 Linux builds target x86-64-v3 (AVX2) by default; `tincd-compat` drops this requirement. Release builds use thin LTO with one codegen unit and frame pointers.

**Container Support**: No OCI/Docker image or Kubernetes integration. NixOS deployment is covered by `services.tincr` (and nixpkgs' `services.tinc`); it can run in a container that provides `/dev/net/tun` and `CAP_NET_ADMIN` or a pre-created TUN device.

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support; the only platform with sharding, TUN offloads and UDP GSO
- [x] **macOS** - utun (layer 3 only) with batched `recvmsg_x`/`sendmsg_x`; single-threaded data plane
- [ ] **Windows** - Not supported
- [ ] **FreeBSD/OpenBSD** - No TUN/TAP backend; the kqueue event loop compiles but only `fd`/`dummy` devices are available

### Mobile
- [ ] **iOS** - No iOS support
- [x] **Android** - In-repo VpnService app (`android/`) running tincd with the tun fd passed over a Unix socket

### Implementation
- [ ] **Kernel-mode datapath** - No in-kernel packet processing
- [x] **Userspace implementation** - Runs entirely in userspace with TUN/TAP devices
- [ ] **Container support** - No official container image or Kubernetes integration; NixOS module only
