# Overview

Headscale is an open-source, self-hosted implementation of the Tailscale control server, started by Juan Font. It does not carry traffic. The benchmarked network is the official Tailscale client (`tailscaled` v1.88.4, Tailscale Inc.) pointed at a Headscale v0.27.0 server. Headscale authenticates nodes, assigns tailnet addresses, compiles ACLs and pushes network maps (peer keys, endpoints, DERP map, filter rules) to each client over the Tailscale "ts2021" Noise control protocol (`src/headscale/hscontrol/noise.go:53-120`). The client builds a WireGuard mesh in userspace: a fork of wireguard-go (`github.com/tailscale/wireguard-go`) does the cryptography, and Tailscale's `magicsock` package replaces the WireGuard UDP bind to add NAT traversal, path selection and relay fallback through DERP servers (`src/tailscale/wgengine/magicsock/magicsock.go:3256-3270`). Its README says Headscale implements "a _single_ Tailscale network" (`src/headscale/README.md:42`).

At a glance:

- **Language:** Go for both components (`src/tailscale/go.mod`, `src/headscale/go.mod`). The hot crypto paths use Go assembly from `golang.org/x/crypto` and the Go standard library.
- **License:** BSD 3-Clause for Tailscale (`src/tailscale/LICENSE`) and for Headscale (`src/headscale/LICENSE`). The wireguard-go fork is MIT (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/LICENSE`).
- **Default peer transport:** WireGuard packets in plain UDP datagrams sent straight to the peer's best endpoint. If no direct path is confirmed, packets go through a DERP relay over TCP with TLS on port 443 (`src/tailscale/wgengine/magicsock/endpoint.go:568-585`, `src/tailscale/derp/derphttp/derphttp_client.go:502`). With Headscale's example config, the DERP relays are Tailscale's public ones (`src/headscale/config-example.yaml:114-115`).
- **Data cipher (default):** ChaCha20-Poly1305 (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:473`). There are no alternatives. Disco control packets use NaCl box (XSalsa20-Poly1305) (`src/tailscale/types/key/disco.go:13,215`).
- **Handshake:** WireGuard `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` with an all-zero PSK (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/noise-protocol.go:51`, `src/tailscale/wgengine/wgcfg/parser.go:176`). The client-to-Headscale channel is `Noise_IK_25519_ChaChaPoly_BLAKE2s` (`src/tailscale/control/controlbase/handshake.go:31`).
- **Default tunnel MTU:** 1280. `safeTUNMTU` is set in `src/tailscale/net/tstun/mtu.go:79` and applied when the TUN is created in `src/tailscale/net/tstun/tun.go:61`.
- **Control-plane model:** central server (one Headscale process with SQLite or PostgreSQL).
- **Data-plane threading:** multi-threaded. There is one encryption and one decryption worker per CPU, per-peer sequential sender and receiver goroutines, and one UDP socket per IP family (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/device.go:311-323`).

## Key Architecture Components

**Control plane (Headscale).** One Go binary serves `/key`, `/ts2021`, `/register/{id}`, `/oidc/callback`, an optional embedded DERP server and a gRPC/REST admin API (`src/headscale/hscontrol/app.go:444-480`). Inside the Noise connection it serves HTTP/2 and exposes only `/machine/register` and `/machine/map` (`src/headscale/hscontrol/noise.go:100-106`). Node state lives in the database plus an in-memory `NodeStore` snapshot (`src/headscale/hscontrol/state/node_store.go:90-95`). Policy is a HuJSON file with groups, hosts, tagOwners, ACLs, autoApprovers and SSH rules (`src/headscale/hscontrol/policy/v2/types.go:1576-1588`).

**Discovery (netcheck, disco, portmapper).** The client sends STUN probes to the STUN servers listed in the DERP map (`src/tailscale/net/netcheck/netcheck.go:292`). It also tries UPnP, NAT-PMP and PCP port mappings (`src/tailscale/net/portmapper/portmapper.go:875`). It reports the endpoints it finds to Headscale in each `MapRequest` (`src/tailscale/control/controlclient/direct.go:909-910`). Peers then exchange encrypted "disco" ping, pong and CallMeMaybe messages over UDP and DERP to find a working direct path (`src/tailscale/wgengine/magicsock/endpoint.go:1352`, `:1926`).

**Transport (magicsock + DERP).** `magicsock.Conn` implements the wireguard-go `conn.Bind`. It returns three receive functions: UDP over IPv4, UDP over IPv6, and DERP (`src/tailscale/wgengine/magicsock/magicsock.go:3263`). DERP is a TCP relay over HTTPS that forwards opaque WireGuard packets addressed by node public key (`src/tailscale/derp/derp.go:73-75`).

**Data path (tstun + wireguard-go).** On Linux, `tailscaled` creates the kernel TUN `tailscale0` with `IFF_VNET_HDR` (`src/tailscale/cmd/tailscaled/tailscaled.go:100`, `deps/tailscale/go-modules/github.com/tailscale/wireguard-go/tun/tun_linux.go:560`). The `tstun.Wrapper` runs the packet filter and hands packets to wireguard-go (`src/tailscale/net/tstun/wrap.go:924-995`). gVisor netstack handles only traffic to the 100.100.100.100 service IP, peerAPI and Tailscale SSH unless userspace networking is chosen (`src/tailscale/wgengine/netstack/netstack.go:757-779`, `:1050-1100`).

**Identity.** Each client has a long-term machine key, which is its identity to Headscale over ts2021, and a node key, which is its WireGuard static key (`src/tailscale/types/persist/persist.go:24-28`). It also has a disco key that is regenerated at every start (`src/tailscale/wgengine/magicsock/magicsock.go:613`). Headscale binds node keys to machine keys and checks that binding on every map request (`src/headscale/hscontrol/noise.go:297-309`).

# Protocol

## Control Plane

The client first fetches Headscale's Noise public key with `GET /key?v=<capver>` over the configured server URL (`src/tailscale/control/controlclient/direct.go:1231-1264`). It then dials `/ts2021`, tries HTTP port 80 first and races HTTPS on 443 as a backup (`src/tailscale/control/controlhttp/client.go:224-282`). Over that HTTP upgrade it runs a Noise IK handshake (`src/tailscale/control/controlbase/handshake.go:31`). Headscale accepts the upgrade with `controlhttpserver.AcceptHTTP` and serves HTTP/2 over the Noise connection (`src/headscale/hscontrol/noise.go:77-119`).

Registration goes to `/machine/register`. A request with a pre-auth key is approved at once (`src/headscale/hscontrol/auth.go:320-393`). Without a key, Headscale returns an auth URL, which leads to OIDC or to a page telling an admin to run `headscale nodes register` (`src/headscale/hscontrol/auth.go:395-452`, `src/headscale/hscontrol/templates/register_web.go:31`). After that, `/machine/map` is a streaming long-poll. Headscale pushes full and incremental network maps through a batcher (`src/headscale/hscontrol/poll.go`, `src/headscale/hscontrol/mapper/`). The client keeps a backoff loop and retries when the server is unreachable (`src/tailscale/control/controlclient/auto.go:480-484`). Headscale loads the DERP map from URLs, files or its embedded server, and refreshes it every 3 h by default (`src/headscale/hscontrol/app.go:288-296`, `src/headscale/hscontrol/types/config.go:305`). Startup fails if a configured DERP map URL cannot be fetched (`src/headscale/hscontrol/app.go:526-528`).

## Data Plane

Data packets are standard WireGuard transport messages: type, receiver index, 64-bit counter, then ChaCha20-Poly1305 ciphertext padded to 16 bytes (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:456-478`). The fork reserves 8 bytes of headroom before each message, so magicsock can prepend a Geneve header for UDP peer relays (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/noise-protocol.go:69`, `src/tailscale/net/batching/conn_linux.go:107`). magicsock sends each batch either to the peer's trusted best UDP address or, while that address is unconfirmed, to both the UDP address and the peer's home DERP region (`src/tailscale/wgengine/magicsock/endpoint.go:568-585`, `:1033-1111`). Inbound packets are told apart by their first bytes: disco (`TS💬` magic), STUN or WireGuard (`src/tailscale/wgengine/magicsock/magicsock.go:1793-1828`).

Peer relays (UDP relay servers with Geneve) exist in this client, but a peer must hold the `tailscale.com/cap/relay` capability (`src/tailscale/wgengine/magicsock/magicsock.go:2442`, `:2910`, `src/tailscale/tailcfg/tailcfg.go:1531-1534`). The Headscale policy has no grants section and Headscale never emits `CapGrant` (`src/headscale/hscontrol/policy/v2/types.go:1576-1588`). Peer relays therefore cannot be enabled with this Headscale version (inferred from the absence of any code path that sets these capabilities).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - Yes: WireGuard messages go over UDP sockets that magicsock binds per address family (`src/tailscale/wgengine/magicsock/magicsock.go:3483-3561`).
- [x] **Datagram encapsulation (no head-of-line blocking)** - Yes: each inner packet becomes its own WireGuard UDP datagram on the direct path (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:446-484`). Only the DERP fallback uses a TCP stream.
- [x] **TCP fallback** - Yes: when no direct UDP path is trusted, magicsock sends through the peer's DERP region over TLS on TCP 443 without user action (`src/tailscale/wgengine/magicsock/endpoint.go:582-584`, `src/tailscale/derp/derphttp/derphttp_client.go:667`).
- [ ] **QUIC support** - No QUIC transport exists in magicsock or DERP. The bind exposes only UDP and DERP receive functions (`src/tailscale/wgengine/magicsock/magicsock.go:3263`).
- [x] **WebSocket support** - Partial: Headscale's embedded DERP server accepts DERP over WebSocket (`src/headscale/hscontrol/derp/server/derp_server.go:151-209`). The Linux client uses WebSocket only in js/wasm or `ts_debug_websockets` builds (`src/tailscale/derp/derphttp/websocket.go:4`, `derphttp_client.go:317-327`).

### IP Support

- [x] **IPv4 support** - Yes: nodes get addresses from `100.64.0.0/10` by default (`src/headscale/config-example.yaml:59`).
- [x] **IPv6 support** - Yes: nodes also get addresses from `fd7a:115c:a1e0::/48` (`src/headscale/config-example.yaml:60`), and wireguard-go routes IPv6 packets (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:268-273`).
- [x] **Dual-stack** - Yes: both prefixes are assigned to each node and carried on the same `tailscale0` interface (`src/headscale/config-example.yaml:58-60`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - Yes: wireguard-go looks up the peer by destination IP in its allowed-IPs table (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:258-281`).
- [ ] **Layer 2 (Ethernet) mode** - The optional Linux TAP mode strips the 14-byte Ethernet header before WireGuard, so Ethernet frames never cross the tunnel (`src/tailscale/feature/tap/tap_linux.go:429-430`).
- [x] **Bridging support** - Partial: the experimental `--tun=tap:NAME:BRIDGE` mode adds the TAP to a Linux bridge, answers ARP and serves DHCP to one device behind it (`src/tailscale/feature/tap/tap_linux.go:4,77-79,204-260`). Only IP crosses the tunnel.

### Advanced Protocol Features

- [ ] **Multipath/bonding** - Each peer uses a single `bestAddr`. There is no aggregation or active-backup across paths beyond falling back to DERP (`src/tailscale/wgengine/magicsock/endpoint.go:568-585`).
- [ ] **QoS/traffic shaping** - No priority queues or rate limits on tunnel traffic were found in tstun, wireguard-go or magicsock. The send path is FIFO per peer (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:487-552`).
- [ ] **Multicast support** - The packet filter drops every multicast destination (`src/tailscale/wgengine/filter/filter.go:629-631`).

# Encryption

## Encryption Layer Details

**Handshake.** Peer sessions use the WireGuard handshake `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/noise-protocol.go:51`). X25519 runs through `golang.org/x/crypto/curve25519` (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/noise-helpers.go:94-103`). That package calls `crypto/ecdh` (`deps/tailscale/go-modules/golang.org/x/crypto/curve25519/curve25519.go:13,36`), whose field arithmetic has amd64 assembly (`deps/tailscale/go-stdlib/crypto/internal/fips140/edwards25519/field/fe_amd64.s:8`). The static keys are the node keys that Headscale distributes in the network map. Tailscale never sets a PSK: the `preshared_key` UAPI key is ignored (`src/tailscale/wgengine/wgcfg/parser.go:176`), so the psk2 slot holds zeros. Handshake messages carry MAC1 and, under load, MAC2 cookies encrypted with XChaCha20-Poly1305 (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/cookie.go:165,204`).

**Key derivation.** HKDF uses BLAKE2s-HMAC (`KDF1`/`KDF2`/`KDF3` in `deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/noise-helpers.go:24-60`). BLAKE2s has SSE4.1 assembly (`deps/tailscale/go-modules/golang.org/x/crypto/blake2s/blake2s_amd64.go:12`).

**Data cipher.** ChaCha20-Poly1305 with a 96-bit nonce built from the 64-bit counter (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:472-478`, `receive.go:252-260`). The amd64 build selects an AVX2+BMI2 code path when the CPU supports it (`deps/tailscale/go-modules/golang.org/x/crypto/chacha20poly1305/chacha20poly1305_amd64.go:23`, `chacha20poly1305_amd64.s:204-206`). There is no alternative cipher.

**Nonce and replay.** Each keypair has an atomic send counter. The receiver checks a sliding window bitmap of 127×64 = 8128 counters (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/replay/replay.go:12-15`) in `RoutineSequentialReceiver`, after decryption (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/receive.go:453`).

**Rekeying.** The initiator starts a new handshake after 120 s or 2^60 messages, and keys are rejected after 180 s (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/constants.go:15-22`, `send.go:202-211`). Node keys can also be rotated through re-registration with Headscale (`OldPrivateNodeKey` in `src/tailscale/types/persist/persist.go:25`).

**Other channels.** The control channel is Noise IK with X25519, ChaCha20-Poly1305 and BLAKE2s (`src/tailscale/control/controlbase/handshake.go:31,371`). Disco messages are sealed with NaCl box between per-start disco keys (`src/tailscale/types/key/disco.go:72,215`). The 32-byte sender disco public key travels in clear in every disco header (`src/tailscale/disco/disco.go:5-16`).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Yes: session keys come from X25519 DH in the WireGuard Noise IK handshake (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/noise-helpers.go:94-103`).
- [x] **Perfect Forward Secrecy** - Yes: every handshake mixes fresh ephemeral X25519 keys, so a leaked node key does not decrypt past sessions (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/noise-protocol.go:51`).
- [ ] **Post-quantum readiness** - The PSK slot is never filled (`src/tailscale/wgengine/wgcfg/parser.go:176`), and no PQ KEM exists in wireguard-go or controlbase.
- [x] **Key rotation** - Yes: automatic rekey after 120 s or 2^60 messages, with rejection after 180 s (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/constants.go:15-22`).

### Symmetric Encryption

- [x] **Authenticated encryption** - Yes: ChaCha20-Poly1305 AEAD seals every transport message (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:473-478`).
- [x] **Hardware-accelerated crypto** - Yes: x/crypto ChaCha20-Poly1305 uses an AVX2/BMI2 assembly path on amd64 (`deps/tailscale/go-modules/golang.org/x/crypto/chacha20poly1305/chacha20poly1305_amd64.go:23`).
- [x] **Constant-time operations** - Yes: the AEAD, BLAKE2s and X25519 come from x/crypto and the Go standard library `crypto/ecdh` (`deps/tailscale/go-modules/golang.org/x/crypto/curve25519/curve25519.go:13`), which are written to run in constant time.

### Protocol Security

- [x] **Replay protection** - Yes: an 8128-entry sliding-window counter check runs per keypair (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/replay/replay.go:12-15`, `receive.go:453`).
- [x] **Noise Protocol** - Yes: `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` for peers and `Noise_IK_25519_ChaChaPoly_BLAKE2s` for control (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/noise-protocol.go:51`, `src/tailscale/control/controlbase/handshake.go:31`).
- [x] **No cleartext metadata** - Partial: WireGuard encrypts the static key in the handshake, but every disco packet carries the sender's disco public key in clear (`src/tailscale/disco/disco.go:5-16`, `src/tailscale/wgengine/magicsock/magicsock.go:1982-1983`). That key stays the same until the process restarts.
- [x] **End-to-end encryption through relays** - Yes: DERP forwards already-encrypted WireGuard packets addressed only by destination public key (`src/tailscale/derp/derp.go:75`), so the relay cannot decrypt payloads.

# Performance

## Threading Model

The default Linux build uses the kernel TUN `tailscale0` with `IFF_TUN|IFF_NO_PI|IFF_VNET_HDR` (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/tun/tun_linux.go:560`). `initFromFlags` enables `TUN_F_CSUM|TSO4|TSO6`, adds `USO4|USO6` when the kernel supports them, and sets the TUN batch size to 128 (`tun_linux.go:503-542`). `tstun.Wrapper.SetLinkFeaturesPostUp` probes TCP GRO and keeps it on unless the probe fails (`src/tailscale/net/tstun/wrap_linux.go:23-38`).

**TX path.**
1. The `tstun.Wrapper.pollVector` goroutine calls `NativeTun.Read`. That reads one virtio super-packet of up to 64 KiB into a staging buffer and splits it with `GSOSplit` into up to 128 vector buffers (`src/tailscale/net/tstun/wrap.go:437-478`, `deps/tailscale/go-modules/github.com/tailscale/wireguard-go/tun/tun_linux.go:427-452`).
2. wireguard-go's single `RoutineReadFromTUN` calls `Wrapper.Read`. That runs the packet filter and copies each packet into a pooled wireguard-go message buffer (`src/tailscale/net/tstun/wrap.go:924-995`, copy at `:971`). It then groups packets by peer through an allowed-IPs lookup (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:213-304`).
3. `SendStagedPackets` assigns nonces and queues the batch to the shared encryption channel. `runtime.NumCPU()` `RoutineEncryption` workers encrypt in place (`device.go:311-317`, `send.go:446-484`).
4. The per-peer `RoutineSequentialSender` hands the batch to `magicsock.Conn.Send` → `endpoint.send` → `sendUDPBatch` (`send.go:487-552`, `src/tailscale/wgengine/magicsock/endpoint.go:1033-1074`).
5. `linuxBatchingConn.WriteBatchTo` coalesces same-size datagrams into `UDP_SEGMENT` GSO messages of at most 64 segments and sends them with `sendmmsg` (`src/tailscale/net/batching/conn_linux.go:92,107-161,181-251`).

**RX path.**
1. Three `RoutineReceiveIncoming` goroutines run, one each for IPv4 UDP, IPv6 UDP and DERP. Each reads up to 128 messages per `recvmmsg` call with `UDP_GRO` enabled, and splits coalesced reads back into datagrams (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/receive.go:72-110`, `src/tailscale/wgengine/magicsock/magicsock.go:1710-1774`, `src/tailscale/net/batching/conn_linux.go:253-308`).
2. Per-CPU `RoutineDecryption` workers decrypt in place (`receive.go:238-267`).
3. The per-peer `RoutineSequentialReceiver` checks replay and source allowed-IPs, then writes the batch to `tstun.Wrapper.Write`. That runs the inbound filter and calls `NativeTun.Write`, which coalesces TCP and UDP flows with `handleGRO` before writing virtio-hdr super-packets (`receive.go:429-537`, `src/tailscale/net/tstun/wrap.go:1213`, `deps/tailscale/go-modules/github.com/tailscale/wireguard-go/tun/tun_linux.go:352-365`, `offload_linux.go:880`).

UDP socket buffers are force-set to 7 MiB with `SO_RCVBUFFORCE`/`SO_SNDBUFFORCE` (`src/tailscale/wgengine/magicsock/magicsock.go:85,3870-3880`, `src/tailscale/net/sockopts/sockopts_linux.go:23`). There is one socket per address family. No `SO_REUSEPORT` fan-out and no multi-queue TUN are used. The 1280-byte default MTU means more packets per byte than a 1420-byte WireGuard MTU would. TSO and GRO on the TUN reduce the per-syscall cost for TCP (inferred).

## Performance Optimizations Checklist

### Threading

- [x] **Multi-threaded processing** - Yes: `NumCPU` encryption and decryption workers run in parallel (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/device.go:311-317`).
- [ ] **Multi-queue TUN / per-core sockets** - The TUN is opened without `IFF_MULTI_QUEUE` (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/tun/tun_linux.go:560`), and magicsock binds one UDP socket per family (`src/tailscale/wgengine/magicsock/magicsock.go:3483-3561`).

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - Yes: `ReadBatch` on the x/net `ipv4`/`ipv6.PacketConn` maps to `recvmmsg` on Linux (`src/tailscale/net/batching/conn_linux.go:297-308`, `deps/tailscale/go-modules/golang.org/x/net/internal/socket/sys_linux.go:14`).
- [x] **Batch UDP sends (sendmmsg)** - Yes: `writeBatch` calls `WriteBatch`, which maps to `sendmmsg` (`src/tailscale/net/batching/conn_linux.go:233-251`, `deps/tailscale/go-modules/golang.org/x/net/internal/socket/sys_linux.go:19`).
- [x] **Large batch sizes (64+)** - Yes: `IdealBatchSize = 128` for sockets and TUN on Linux (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/conn/conn.go:19`, `src/tailscale/wgengine/magicsock/magicsock.go:3241-3249`).

### Offloads

- [x] **UDP GSO** - Yes: `UDP_SEGMENT` is probed and used for coalesced sends of up to 64 segments (`src/tailscale/net/batching/conn_linux.go:92,331-332,369-384`).
- [x] **UDP GRO** - Yes: `setsockopt(UDP_GRO, 1)` is set on each socket, and coalesced reads are split (`src/tailscale/net/batching/conn_linux.go:333,347-365`).
- [x] **TUN offload (virtio-net hdr)** - Yes: `IFF_VNET_HDR` plus `TUNSETOFFLOAD` with TSO4/6 and USO4/6, and GRO coalescing on write (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/tun/tun_linux.go:521-534`, `offload_linux.go:880`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - Yes: message buffers and element containers come from `sync.Pool`-backed `WaitPool`s, and magicsock pools receive batches (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/pools.go:13-21,49-54`, `src/tailscale/wgengine/magicsock/magicsock.go:627,1673`).
- [x] **Large UDP socket buffers (MB)** - Yes: 7 MiB is requested for read and write with the FORCE variants (`src/tailscale/wgengine/magicsock/magicsock.go:85`, `src/tailscale/net/sockopts/sockopts_linux.go:23`).
- [x] **Zero-allocation parsing** - Partial: WireGuard headers are parsed in place and `packet.Parsed` comes from a pool (`src/tailscale/net/tstun/wrap.go:943-949`). But x/net allocates a new `net.IP` and `net.UDPAddr` for every received message (`deps/tailscale/go-modules/golang.org/x/net/internal/socket/sys_posix.go:83,90`).

### MTU and Peers

- [x] **Path MTU discovery** - Partial: disco pings can probe the sizes in `WireMTUsToProbe` (`src/tailscale/net/tstun/mtu.go:85-92`), but only when `TS_DEBUG_ENABLE_PMTUD` or the `PeerMTUEnable` control knob is set (`src/tailscale/wgengine/magicsock/peermtu.go:38-53`). Headscale does not set that knob, and the TUN MTU stays 1280 (`mtu.go:133-149`).
- [x] **Endpoint caching** - Yes: each endpoint keeps a `bestAddr` that is trusted for 6.5 s and refreshed by traffic and pings. Receive functions keep an `epAddrEndpointCache` for hot flows (`src/tailscale/wgengine/magicsock/endpoint.go:87,568-573`, `magicsock.go:1711-1712,3793`).

### Userspace TCP Stack

- [x] **Userspace TCP/IP stack** - Yes: gVisor netstack serves MagicDNS TCP and the HTTP service on 100.100.100.100, peerAPI and Tailscale SSH in default TUN mode. It carries all traffic only with `--tun=userspace-networking` (`src/tailscale/wgengine/netstack/netstack.go:757-779,1050-1100`, `src/tailscale/cmd/tailscaled/tailscaled.go:608-614`).

### Data Plane Compression

- [ ] **Tunnel compression** - No compression step exists between the TUN read and `Seal` in wireguard-go (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:446-484`).
- [ ] **Configurable compression** - There is no compression, so nothing to configure (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:446-484`).

# Security

## Known Security Issues

None found for these versions. The Headscale `CHANGELOG.md` mentions only fixes in older releases: TS-2023-006 (`src/headscale/CHANGELOG.md:678-679`) and an OIDC fix in 0.24.0 (`src/headscale/CHANGELOG.md:383`). Neither affects 0.27.0. The Tailscale tree carries no advisory list (`src/tailscale/SECURITY.md`). Under this report's rules, no external CVE database was queried, so advisories published after these releases would not appear here.

## Potential Security Concerns

- **Allow-all default policy.** With no policy file or an empty `acls` list, Headscale compiles `tailcfg.FilterAllowAll`, so every node can reach every port on every other node, across users (`src/headscale/hscontrol/policy/v2/filter.go:24-25`). The example config ships with `policy.path: ""` (`src/headscale/config-example.yaml:240-246`).
- **Control key fetched without pinning.** The client fetches Headscale's Noise key from `/key` on every fresh start and does not persist it (`src/tailscale/control/controlclient/direct.go:546-563,1231-1264`, `src/tailscale/types/persist/persist.go:24-28`). The client accepts `http://` server URLs and skips HTTPS for private hosts (`src/tailscale/control/controlclient/noise.go:121-152`). The example `server_url` is `http://127.0.0.1:8080` (`src/headscale/config-example.yaml:13`). Without TLS, an on-path attacker can swap the key and impersonate the controller.
- **Pre-auth keys stored in clear.** `CreatePreAuthKey` stores the generated key string as-is (`src/headscale/hscontrol/db/preauth_keys.go:69-75`), while API keys are bcrypt-hashed (`src/headscale/hscontrol/db/api_key.go:38`). A database leak exposes every unexpired reusable key.
- **Third-party relays by default.** The example config pulls Tailscale Inc.'s DERP map (`src/headscale/config-example.yaml:114-115`), and the embedded DERP is off (`src/headscale/hscontrol/types/config.go:301`). A self-hosted tailnet therefore relays through, and STUNs against, servers run by a third party. Those servers see node public keys, IPs and traffic timing (`src/tailscale/derp/derp.go:73-75`), though not payloads.
- **Controller is a single root of trust.** Headscale serves only `/machine/register` and `/machine/map` over Noise and implements no Tailnet Lock (TKA) endpoints (`src/headscale/hscontrol/noise.go:100-106`). A compromised Headscale can inject peers, rebind IPs to new keys or open ACLs, and clients cannot detect it.
- **Coarse TCP filter.** The inbound filter accepts every TCP packet without SYN, and all ICMP echo replies and errors, without connection state (`src/tailscale/wgengine/filter/filter.go:466-490`). A peer allowed by WireGuard can send crafted non-SYN segments to any port.
- **No privilege separation.** `tailscaled` runs as root. The shipped systemd unit has no capability bounding or sandbox directives (`src/tailscale/cmd/tailscaled/tailscaled.service`), and no seccomp, Landlock or privilege-drop code exists in the tree. A memory-safety bug in parsing code would run as root.
- **Linkable disco key.** The cleartext disco public key in every disco packet lets a passive observer link a node's packets across networks until the daemon restarts (`src/tailscale/disco/disco.go:5-16`, `src/tailscale/wgengine/magicsock/magicsock.go:613`).

## Security Features Checklist

### Network Security

- [x] **Handshake rate limiting** - Yes: under load, wireguard-go requires MAC2 cookies and applies a per-IP limit of 20 handshakes/s with a burst of 5 (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/receive.go:318-338`, `ratelimiter/ratelimiter.go:15-16`).
- [x] **Stateful packet filter** - Partial: UDP and SCTP replies are tracked in a 512-entry LRU, but TCP is allowed for any non-SYN packet, and ICMP replies are always allowed (`src/tailscale/wgengine/filter/filter.go:74-78,466-506,579-588`).
- [x] **Fine-grained ACLs** - Yes: ACL rules have protocol, sources and destinations with port ranges (`src/headscale/hscontrol/policy/v2/types.go:1523-1528,625-628`).
- [x] **Capability-based access** - Yes: rules can use groups, tags (with tagOwners) and autogroups such as `autogroup:member`, `autogroup:tagged` and `autogroup:self` (`src/headscale/hscontrol/policy/v2/types.go:486-490,1582-1587`).

### Identity & Authentication

- [x] **Identity validation** - Partial: wireguard-go drops inner packets whose source IP is not in the sending peer's allowed IPs (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/receive.go:486,503`). The IP-to-key binding, however, comes from an unsigned Headscale netmap and is not derived from the key.
- [ ] **Signed config updates** - Network maps are not signed. Headscale exposes no TKA endpoints, so the client's Tailnet Lock code (`src/tailscale/tka/`) has no server to use (`src/headscale/hscontrol/noise.go:100-106`).
- [ ] **Control-server key pinning** - The Noise key is fetched over HTTP(S) from `/key` and held only in memory, so it is not pinned across restarts (`src/tailscale/control/controlclient/direct.go:546-563,1231-1264`).

### Implementation

- [x] **Memory-safe language** - Yes: the client, wireguard-go and Headscale are Go. Assembly is limited to the crypto primitives (`deps/tailscale/go-modules/golang.org/x/crypto/chacha20poly1305/chacha20poly1305_amd64.s`).
- [ ] **Privilege separation** - `tailscaled` runs as root on Linux and does not drop privileges (`src/tailscale/cmd/tailscaled/tailscaled.service`).
- [ ] **Sandboxing** - No seccomp, Landlock, chroot or systemd hardening is used for `tailscaled` (`src/tailscale/cmd/tailscaled/tailscaled.service`).
- [x] **Audit logging** - Partial: filter drops are logged by default but rate-limited (`src/tailscale/net/tstun/wrap.go:282`, `src/tailscale/wgengine/filter/filter.go:311-335`). WireGuard handshake failures such as invalid MAC1 are logged only at verbose level (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/receive.go:318-319`).

# NAT Traversal

## How NAT Traversal Works

1. **Discovery.** `netcheck` sends STUN binding requests to the STUN nodes of several DERP regions, at least the three fastest in steady state (`src/tailscale/net/netcheck/netcheck.go:416-419,433`). It records the global IPv4/IPv6 endpoint and whether the mapping changes with the destination, which signals endpoint-dependent NAT (`netcheck.go:98-120`). It also measures per-region latency to choose a home DERP (`addReportHistoryAndSetPreferredDERP`, `netcheck.go:1388-1430`).
2. **Port mapping.** In parallel, the portmapper tries UPnP IGD, NAT-PMP and PCP on the gateway (`src/tailscale/net/portmapper/upnp.go:431`, `portmapper.go:803`, `pcp.go:84`).
3. **Advertisement.** The resulting local, STUN and port-mapped endpoints go to Headscale in the `MapRequest`. Headscale distributes them in peers' network maps (`src/tailscale/control/controlclient/direct.go:909-910`).
4. **Hole punching.** When a peer is first used, `endpoint.send` triggers `sendDiscoPingsLocked`. That pings all known endpoints and also sends a CallMeMaybe through DERP, so the remote side pings back and both NATs open (`src/tailscale/wgengine/magicsock/endpoint.go:1047-1048,1352`, `handleCallMeMaybe` at `:1926`).
5. **Path choice.** `betterAddr` picks among working paths by latency. It favors loopback, link-local and private addresses and IPv6, and needs at least 1% improvement before switching (`endpoint.go:1835-1920`). Heartbeats every 3 s and re-probes every minute keep the path fresh (`src/tailscale/wgengine/magicsock/magicsock.go:3777,3789`).
6. **Fallback.** Until a UDP path is confirmed, packets go both direct and through DERP (`endpoint.go:582-584`). DERP runs over TLS on TCP 443 (`src/tailscale/derp/derphttp/derphttp_client.go:502,667`).

There is no port prediction or birthday-style probing for endpoint-dependent NATs. Such peers stay on DERP unless port mapping succeeds. UDP peer relays could help here, but they are unusable under Headscale (see Data Plane).

## NAT Traversal Checklist

### Discovery

- [x] **No own public node needed** - Partial: STUN and DERP default to Tailscale Inc.'s public servers (`src/headscale/config-example.yaml:114-115`), but every node must reach the self-hosted Headscale server, which therefore needs a public or shared reachable address (`src/headscale/config-example.yaml:13`).
- [x] **Public endpoint discovery (STUN or reflection)** - Yes: STUN binding requests to DERP-region STUN servers, handled in `ReceiveSTUNPacket` (`src/tailscale/net/netcheck/netcheck.go:292`).
- [x] **Multiple discovery servers** - Yes: netcheck probes STUN nodes in several regions of the DERP map (`src/tailscale/net/netcheck/netcheck.go:416-470`).
- [x] **NAT type detection** - Yes: `MappingVariesByDestIP` detects destination-dependent mapping, and the report also records UPnP, PMP and PCP presence (`src/tailscale/net/netcheck/netcheck.go:98-110`).

### Port Mapping

- [x] **UPnP port mapping** - Yes: SSDP discovery plus IGD `AddPortMapping` (`src/tailscale/net/portmapper/upnp.go:431`, `portmapper.go:1218-1232`).
- [x] **NAT-PMP support** - Yes: `buildPMPRequestMappingPacket` to port 5351 (`src/tailscale/net/portmapper/portmapper.go:786,803`).
- [x] **PCP support** - Yes: `buildPCPRequestMappingPacket` (`src/tailscale/net/portmapper/pcp.go:27,84`).

### Hole Punching

- [x] **UDP hole punching** - Yes: simultaneous disco pings to all candidate endpoints, plus CallMeMaybe so the peer pings back (`src/tailscale/wgengine/magicsock/endpoint.go:1352,1926`).
- [ ] **Symmetric NAT handling** - No port prediction or birthday probing exists in magicsock or netcheck. Hard NAT is only detected (`src/tailscale/net/netcheck/netcheck.go:98-100,643-646`).
- [x] **Rendezvous coordination** - Yes: Headscale distributes endpoints, and CallMeMaybe messages are relayed through DERP to trigger the punch (`src/tailscale/wgengine/magicsock/endpoint.go:1922-1926`).

### Fallback

- [x] **Relay fallback** - Yes: packets go through the peer's home DERP region whenever no trusted UDP path exists (`src/tailscale/wgengine/magicsock/endpoint.go:568-585,1061-1071`).
- [x] **Multiple relays** - Yes: the DERP map holds many regions, merged from URLs, files and the embedded server (`src/headscale/hscontrol/derp/derp.go:94-122`).
- [x] **Latency-based relay selection** - Yes: the home DERP is the region with the best recent measured latency, with hysteresis (`src/tailscale/net/netcheck/netcheck.go:1388-1430`).
- [x] **TCP relay support** - Yes: DERP runs over HTTP Upgrade on TLS/TCP 443 (`src/tailscale/derp/derphttp/derphttp_client.go:502,667`).

# Local Routing

## Peer Discovery on LANs

There is no LAN broadcast or multicast peer discovery. Each client reports its local interface addresses as endpoints to Headscale (`src/tailscale/control/controlclient/direct.go:909-910`). Peers on the same LAN learn those addresses from the netmap and reach them with disco pings. `betterAddr` gives private addresses 20 extra points and link-local addresses 30, so a LAN path wins over a public path of similar latency (`src/tailscale/wgengine/magicsock/endpoint.go:1875-1896`). If Headscale and all nodes share a LAN and the config uses only a local DERP map (embedded server, empty `urls`), the mesh works without internet. With the example config, startup fails when the Tailscale DERP map URL cannot be fetched (`src/headscale/hscontrol/app.go:526-528`).

## Routing Features

Nodes advertise subnet routes and exit routes (`0.0.0.0/0`, `::/0`). Headscale approves them manually or through `autoApprovers` (`src/headscale/hscontrol/types/node.go:268-273`, `src/headscale/hscontrol/policy/v2/types.go:1586`). When several nodes announce the same prefix, `PrimaryRoutes.updatePrimaryLocked` picks one primary and fails over when it goes offline (`src/headscale/hscontrol/routes/primary.go:39-48`). Clients use exit nodes only when asked, so the default is split tunneling. MagicDNS is on by default (`src/headscale/hscontrol/types/config.go:294`), and the client's resolver answers on 100.100.100.100 (`src/tailscale/net/dns/resolver/tsdns.go:298,598`).

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - No LAN broadcast or multicast peer discovery exists. Endpoints come only from Headscale and disco (`src/tailscale/control/controlclient/direct.go:909-910`).
- [x] **Direct path advertisement** - Yes: local, STUN and port-mapped endpoints are sent in each `MapRequest` and pushed to peers (`src/tailscale/control/controlclient/direct.go:909-910`).

### LAN Optimization

- [x] **Automatic LAN preference** - Yes: `betterAddr` adds points for private, link-local and loopback addresses (`src/tailscale/wgengine/magicsock/endpoint.go:1883-1896`).
- [ ] **Trusted path mode** - Every packet is encrypted with ChaCha20-Poly1305. There is no plaintext path (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/send.go:446-484`).
- [x] **LAN-only mode** - Yes: with Headscale on the LAN and a local DERP map (embedded server, no URLs), nodes connect directly over LAN endpoints (`src/headscale/hscontrol/derp/derp.go:94-122`, `src/headscale/hscontrol/types/config.go:301-304`).

### Routing Features

- [x] **Subnet routes** - Yes: advertised routes are approved by an admin or by `autoApprovers` and pushed as AllowedIPs (`src/headscale/hscontrol/auth.go:359`, `src/headscale/hscontrol/types/node.go:268-273`).
- [x] **Full tunnel mode** - Yes: exit routes `0.0.0.0/0` and `::/0` are handled as exit nodes (`src/headscale/hscontrol/types/node.go:268-273`).
- [x] **Split tunneling** - Yes: by default only tailnet prefixes and approved subnet routes go through `tailscale0`. An exit node is opt-in per client (`src/headscale/hscontrol/types/node.go:268-273`).
- [x] **Route priorities** - Yes: HA primary-route selection with automatic failover among routers that advertise the same prefix (`src/headscale/hscontrol/routes/primary.go:39-48`).
- [ ] **Multi-hop routing via peers** - There is no mesh routing protocol. Peer relays need `tailscale.com/cap/relay` grants that Headscale cannot issue (`src/tailscale/wgengine/magicsock/magicsock.go:2442,2910`).
- [x] **Built-in DNS** - Yes: MagicDNS is on by default and the client resolves peer names on 100.100.100.100 (`src/headscale/hscontrol/types/config.go:294`, `src/tailscale/net/dns/resolver/tsdns.go:598`).

# Central Point of Failure

## What Happens When Headscale Fails

If Headscale goes down, clients keep their last network map and WireGuard configuration in memory. They retry the map long-poll with backoff (`src/tailscale/control/controlclient/auto.go:480-484`). Direct UDP paths and DERP relays keep working, because DERP servers are separate processes, or the embedded DERP goes down with Headscale if that is what the map uses. Disco keeps refreshing paths, since endpoints already known can still be pinged (`src/tailscale/wgengine/magicsock/endpoint.go:805`). New nodes cannot join. Key, route and ACL changes do not propagate, and nodes that restart cannot learn their peers again: `tailscaled` persists keys and prefs but not the netmap (`src/tailscale/types/persist/persist.go:24-28`). Headscale itself keeps state in SQLite or PostgreSQL and rebuilds its in-memory `NodeStore` on start (`src/headscale/hscontrol/state/node_store.go:97-100`).

## Mitigation Strategies

- Enable the embedded DERP and STUN server (`derp.server.enabled`) or run `derper`, so relays do not depend on Tailscale Inc. (`src/headscale/config-example.yaml:75-101`, `src/tailscale/cmd/derper`).
- Use PostgreSQL and back up the database, the Noise private key and the DERP key files (`src/headscale/config-example.yaml:43-47,101,141-145`).
- Run several subnet routers or exit nodes for the same prefix to get HA routing (`src/headscale/hscontrol/routes/primary.go:39-48`).
- Keep `server_url` on HTTPS so the `/key` fetch is authenticated by TLS (`src/tailscale/control/controlclient/noise.go:121-152`).

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Yes: the engine keeps the last netmap while the map routine retries with backoff (`src/tailscale/control/controlclient/auto.go:480-484`).
- [ ] **Local state caching** - Only keys and prefs are persisted (`src/tailscale/types/persist/persist.go:24-28`). No netmap cache was found, so a restarted client has no peers until Headscale answers.
- [x] **Cached credentials** - Yes: node and machine keys persist in the state file and stay valid until their expiry. Headscale is needed only to refresh them (`src/tailscale/types/persist/persist.go:24-25`, `src/headscale/hscontrol/state/state.go:766`).

### Redundancy

- [x] **Fully self-hostable** - Yes: Headscale for control, plus its embedded DERP and STUN server or `derper` for relay and discovery (`src/headscale/hscontrol/app.go:470-473`, `src/headscale/config-example.yaml:75-101`).
- [ ] **Controller redundancy** - The client takes one control URL (`src/tailscale/ipn/prefs.go:37-40`). Headscale holds live node state in a per-process `NodeStore` (`src/headscale/hscontrol/state/node_store.go:90-95`), so several Headscale instances cannot share one tailnet.
- [x] **Relay redundancy** - Yes: the DERP map has many regions, and each client can fall back to other regions (`src/headscale/hscontrol/derp/derp.go:94-122`, `src/tailscale/net/netcheck/netcheck.go:1388-1430`).
- [ ] **No single root of trust** - Headscale's database and Noise key decide all peer keys, IPs and ACLs, and Tailnet Lock is not available (`src/headscale/hscontrol/noise.go:100-106`).

# Authentication

## How Nodes Join and Authenticate

A client runs `tailscale up --login-server=<headscale>`. It opens the ts2021 Noise channel using its machine key and sends a `RegisterRequest` with its node key (`src/headscale/hscontrol/noise.go:237`).

- **With `--authkey`.** Headscale checks the pre-auth key: whether it exists, is used, reusable or expired. It creates the node under the key's user with the key's tags, ephemeral flag and auto-approved routes (`src/headscale/hscontrol/auth.go:320-393`, `src/headscale/hscontrol/types/preauth_key.go:16-31`).
- **Without a key.** Headscale caches a pending registration and returns an auth URL (`src/headscale/hscontrol/auth.go:395-452`). With OIDC configured, the URL starts an OIDC login. The login succeeds only if the identity passes the `allowed_domains`, `allowed_groups` and `allowed_users` checks (`src/headscale/hscontrol/oidc.go:286-296`). Without OIDC, the page shows `headscale nodes register --key <id> --user USERNAME` for an admin to run (`src/headscale/hscontrol/templates/register_web.go:31`).

Every later map request must use the same machine key that registered the node key (`src/headscale/hscontrol/noise.go:297-309`). Ephemeral nodes are deleted after `ephemeral_node_inactivity_timeout`, which is 30 min in the example config and 120 s as the code default (`src/headscale/hscontrol/db/node.go:516-612`, `src/headscale/config-example.yaml:139`, `src/headscale/hscontrol/types/config.go:334`). Expired nodes are swept by `ExpireExpiredNodes` (`src/headscale/hscontrol/state/state.go:766`). OIDC logins get a 180-day expiry by default (`src/headscale/hscontrol/types/config.go:326`).

## Authentication Checklist

### Enrollment Methods

- [x] **Pre-authentication keys** - Yes: reusable or one-time keys, optionally ephemeral and tagged (`src/headscale/hscontrol/types/preauth_key.go:16-31`, `src/headscale/hscontrol/auth.go:320-393`).
- [ ] **Certificate-based enrollment** - No CA or certificate path exists. Nodes join only with pre-auth keys, OIDC or admin CLI registration (`src/headscale/hscontrol/auth.go:28-130`).
- [x] **OAuth/OIDC** - Yes: OIDC login with PKCE option and domain, group and user allow-lists (`src/headscale/hscontrol/oidc.go:286-296`, `src/headscale/hscontrol/types/config.go:324-329`).
- [x] **Interactive login** - Yes: the browser flow through `/register/{id}` or `/oidc/callback` (`src/headscale/hscontrol/app.go:451-455`).
- [x] **CLI authentication** - Yes: `tailscale up --authkey` on the node, or `headscale nodes register` by the admin (`src/headscale/hscontrol/templates/register_web.go:31`).

### Authorization

- [x] **Admin approval workflow** - Yes: without OIDC or a pre-auth key, a node stays pending until an admin runs `headscale nodes register` (`src/headscale/hscontrol/auth.go:442-451`, `src/headscale/hscontrol/templates/register_web.go:31`).
- [x] **Automated enrollment rules** - Yes: OIDC allow-lists admit matching users automatically, and `autoApprovers` approve their routes (`src/headscale/hscontrol/oidc.go:286-296`, `src/headscale/hscontrol/auth.go:359`).
- [x] **Ephemeral nodes** - Yes: an ephemeral pre-auth key marks the node, and a garbage collector deletes it after inactivity (`src/headscale/hscontrol/db/node.go:516-612`).
- [x] **Node expiry** - Yes: per-node expiry, a 180-day OIDC default, and `ExpireExpiredNodes` (`src/headscale/hscontrol/state/state.go:603,766`, `src/headscale/hscontrol/types/config.go:326`).

### Identity

- [x] **Stable device identity** - Yes: the machine key and node key persist in `/var/lib/tailscale/tailscaled.state` across restarts and address changes (`src/tailscale/types/persist/persist.go:24-28`, `src/tailscale/cmd/tailscaled/tailscaled.service`).
- [x] **Identity portability** - Yes: state-file encryption with the TPM is off by default on Linux (`src/tailscale/cmd/tailscaled/tailscaled.go:199,1007-1016`), so copying the state file moves the identity.

# Platform Support

## Supported Platforms

Headscale is a Go server for Linux and other Unix systems. It ships as a container image built with ko (`src/headscale/.goreleaser.yml:119-153`). Headscale's own client table lists Linux, OpenBSD, FreeBSD, Windows, Android, macOS, iOS and tvOS, all using official Tailscale clients (`src/headscale/docs/about/clients.md`). Headscale serves setup pages for Apple and Windows clients (`src/headscale/hscontrol/platform_config.go:16-35`). The Tailscale tree contains router and DNS backends for Linux, macOS, Windows, FreeBSD, OpenBSD, Android and Plan 9 (`src/tailscale/wgengine/router/router_*.go`). wireguard-go has TUN drivers for Linux, Darwin, Windows, FreeBSD and OpenBSD (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/tun/`). The iOS and Android GUI apps are official Tailscale apps that live outside this repository. In this repository they appear through `GOOS == "ios"` paths and Android-specific code (`src/tailscale/ipn/ipnlocal/peerapi.go`, `src/tailscale/wgengine/router/router_android.go`, `deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/queueconstants_ios.go`).

## Implementation Details

On Linux, `tailscaled` uses the kernel TUN with virtio offloads and policy routing through netlink or iptables/nftables (`src/tailscale/wgengine/router/router_linux.go`). WireGuard runs entirely in userspace. Kernel WireGuard is never used. `--tun=userspace-networking` swaps the TUN for gVisor netstack (`src/tailscale/cmd/tailscaled/tailscaled.go:196,757-768`). Synology defaults to trying TUN, then userspace networking (`tailscaled.go:92-97`). Containers and Kubernetes are supported through `cmd/containerboot`, `cmd/k8s-operator` and the `Dockerfile` (`src/tailscale/cmd/`, `src/tailscale/Dockerfile`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - Yes: the default `tailscale0` TUN backend (`src/tailscale/cmd/tailscaled/tailscaled.go:91-100`).
- [x] **macOS** - Yes: the `utun` backend and router/DNS code for Darwin (`src/tailscale/cmd/tailscaled/tailscaled.go:83-86`, `src/tailscale/wgengine/router/router_darwin.go`).
- [x] **Windows** - Yes: the Wintun backend and the `/windows` setup page in Headscale (`src/tailscale/cmd/tailscaled/tailscaled.go:81-82`, `src/headscale/hscontrol/platform_config.go:16`).
- [x] **FreeBSD/OpenBSD** - Yes: TUN drivers and routers for both (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/tun/tun_freebsd.go`, `tun_openbsd.go`, `src/tailscale/wgengine/router/router_openbsd.go`).

### Mobile

- [x] **iOS** - Yes: the official Tailscale iOS app supports a custom server, and Headscale serves `/apple` profiles for it (`src/headscale/hscontrol/platform_config.go:26-35`, `src/headscale/docs/about/clients.md`).
- [x] **Android** - Yes: the official Tailscale Android app (separate repository) supports Headscale, and Android code paths exist in the client (`src/headscale/docs/about/clients.md`, `src/tailscale/wgengine/router/router_android.go`).

### Implementation

- [ ] **Kernel-mode datapath** - Encryption and routing run in userspace wireguard-go. Only the TUN device is in the kernel (`deps/tailscale/go-modules/github.com/tailscale/wireguard-go/device/device.go:311-323`).
- [x] **Container support** - Yes: official Headscale images (`src/headscale/.goreleaser.yml:119-122`), plus Tailscale's `containerboot` and Kubernetes operator (`src/tailscale/cmd/containerboot`, `src/tailscale/cmd/k8s-operator`).
