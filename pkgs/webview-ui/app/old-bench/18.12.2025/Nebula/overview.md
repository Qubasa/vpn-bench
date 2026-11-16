# Overview

Nebula is a peer-to-peer overlay network written in Go (`src/nebula/go.mod:1-3`, `go 1.25`; the benchmarked build uses the Go 1.25 standard library, `deps/nebula/go-stdlib/internal/goversion/goversion.go:12`). Slack Technologies wrote it and released it under the MIT license (`src/nebula/LICENSE:1-3`). The README links the official iOS and Android apps, which Defined Networking publishes (`src/nebula/README.md:60-63`). This overview describes revision `770147264da1`, which is v1.9.4 plus 93 commits. That code already includes the v2 certificate format and IPv6 overlay addresses (`src/nebula/cert/cert_v2.go`, `src/nebula/handshake_ix.go:26-34`). The changelog does not list these additions yet (`src/nebula/CHANGELOG.md:8-15`).

Every node has a certificate signed by a CA the operator creates. The certificate binds the node's public key, overlay addresses, name and groups (`src/nebula/cert/ca_pool.go:130-201`). Nodes find each other through "lighthouses". These are ordinary Nebula nodes with a public address that store each node's reported and observed underlay addresses and answer queries over encrypted tunnels (`src/nebula/lighthouse.go:1056-1110`). Two nodes then run a Noise IX handshake directly over UDP and send IP packets to each other in independent encrypted UDP datagrams.

At a glance:

- **Language:** Go. Crypto comes from the Go standard library and `golang.org/x/crypto` via `github.com/flynn/noise` v1.1.0 (`src/nebula/go.mod:10,25`).
- **License:** MIT (`src/nebula/LICENSE:1`).
- **Default peer transport:** direct UDP, one inner packet per datagram (`src/nebula/udp/udp_linux.go:35-73`). If configured, traffic can fall back to a relay, which is a Nebula node that forwards UDP datagrams (`src/nebula/handshake_manager.go:267`). There is no TCP fallback.
- **Data cipher (default):** AES-256-GCM (`cipher: aes`, `src/nebula/pki.go:158`, `src/nebula/connection_state.go:49-50`). The only alternative is ChaCha20-Poly1305 (`cipher: chachapoly`, `src/nebula/connection_state.go:46-47`).
- **Handshake:** Noise IX with X25519 by default, or P-256 for P256 certificates. The pattern name is `Noise_IX_25519_AESGCM_SHA256` because no PSK is set (`src/nebula/connection_state.go:31-67`, `deps/nebula/go-modules/github.com/flynn/noise/state.go:336-356`). Certificates travel as the handshake payload.
- **Default tunnel MTU:** 1300 (`DefaultMTU`, `src/nebula/overlay/tun.go:13`, applied from `tun.mtu` in `src/nebula/overlay/tun_linux.go:169`).
- **Control-plane model:** lighthouse/bootstrap nodes run by the operator (`src/nebula/lighthouse.go:83-87`, `src/nebula/examples/config.yml:44-62`).
- **Data-plane threading:** multi-threaded. Each routine runs one TUN-reader and one UDP-reader goroutine, each locked to an OS thread. `routines` defaults to 1. With `routines` > 1, Nebula opens one IFF_MULTI_QUEUE TUN queue and one SO_REUSEPORT socket per routine (`src/nebula/interface.go:227-303`, `src/nebula/main.go:87-109`).

## Key Architecture Components

**Control plane (PKI and config).** There is no central server. Each node reads a YAML config, its key, its certificate and the trusted CA bundle from local files (`src/nebula/pki.go:256-341`). `nebula-cert` creates CAs and signs host certificates offline. A new CA defaults to a v2, Curve25519 certificate that is valid for one year (`src/nebula/cmd/nebula-cert/ca.go:50-62`). By default, `nebula-cert sign` writes both a v1 and a v2 certificate (`src/nebula/cmd/nebula-cert/sign.go:46`).

**Discovery (lighthouses).** Non-lighthouse nodes send a `HostUpdateNotification` to every host in `lighthouse.hosts` every `lighthouse.interval` seconds (code default 10). The update lists their local interface addresses and any `advertise_addrs` (`src/nebula/lighthouse.go:222,828-967`). Lighthouses also record the source address they see on the tunnel. This acts as server reflection (`src/nebula/hostmap.go:685-691`, `src/nebula/remote_list.go:277-285`). Every lighthouse must also have an entry in `static_host_map` (`src/nebula/lighthouse.go:372-377`).

**Transport.** Nebula uses one raw UDP socket per routine, set up with `unix.Socket`/`unix.Bind`. It receives with `recvmmsg` (batch 64) and sends with one `sendto` per packet (`src/nebula/udp/udp_linux.go:35-249`). Every packet starts with a 16-byte header: version/type, subtype, reserved, the receiver's 32-bit index and a 64-bit counter (`src/nebula/header/header.go:10-27`).

**Data path.** `listenIn` reads one packet from the TUN fd. It parses the packet for the firewall, looks up the peer, checks the firewall and encrypts in place into a reused buffer (`src/nebula/inside.go:14-82,334-411`). `listenOut` receives a batch, parses the header, checks the replay window, decrypts, checks the firewall and writes to the TUN device (`src/nebula/outside.go:22-217,468-509`).

**Identity.** The identity is the Curve25519 (or P-256) key pair plus a CA-signed certificate. The certificate carries the name, overlay networks, unsafe networks, groups, validity period and issuer. Peers verify it against `pki.ca` and `pki.blocklist` (`src/nebula/cert/ca_pool.go:165-201`, `src/nebula/pki.go:519`). The firewall matches rules on these certificate fields.

# Protocol

## Control Plane

All control messages go through the encrypted Noise session with a peer. Lighthouse traffic (`header.LightHouse`) carries protobuf `NebulaMeta` messages of these types: `HostQuery`, `HostQueryReply`, `HostUpdateNotification`, `HostPunchNotification` and their acks (`src/nebula/lighthouse.go:1020-1054`). When a node needs a peer, it queries every configured lighthouse (`src/nebula/lighthouse.go:754-800`). The lighthouse answers with the peer's learned (observed) address and its reported addresses, plus the peer's advertised relays (`src/nebula/lighthouse.go:1165-1204`). At the same time, it sends the peer a `HostPunchNotification` with the querier's addresses (`src/nebula/lighthouse.go:1113-1163`).

Relay setup uses `header.Control` messages with `NebulaControl_CreateRelayRequest`/`Response` (`src/nebula/handshake_manager.go:297-330`, `src/nebula/relay_manager.go:119-331`). A node only accepts relay requests if `relay.am_relay` is true (`src/nebula/relay_manager.go:40,331`).

Handshake retries follow linear backoff: `try_interval` 100 ms, 10 retries (`src/nebula/handshake_manager.go:22-25,196-202`). The `connectionManager` checks each tunnel every 5 s. It sends an authenticated test packet when traffic flows one way only, and deletes the tunnel if nothing comes back within 10 s (`src/nebula/connection_manager.go:73-74,321-432`). A SIGHUP reloads the config, including the firewall, certificates and CAs, without restarting the process (`src/nebula/interface.go:305-363`).

## Data Plane

On Linux the TUN device is opened with `IFF_TUN | IFF_NO_PI`, plus `IFF_MULTI_QUEUE` when `routines` > 1 (`src/nebula/overlay/tun_linux.go:104-113`). IP addresses come from the certificate networks via netlink. A link-scope route for each VPN network carries the default MTU of 1300 (`src/nebula/overlay/tun_linux.go:282-444`). The transmit queue length is 500 (`src/nebula/overlay/tun_linux.go:131,357`).

For each outbound packet, `consumeInsidePacket` parses the IPv4 or IPv6 header (`newPacket`, `src/nebula/outside.go:284-450`). It then finds or starts a tunnel. Destinations outside the VPN networks use `unsafe_routes`, with weighted ECMP across multiple gateways (`src/nebula/inside.go:140-210`). Next comes the outbound firewall check. `sendNoMetrics` then writes the 16-byte header, which also serves as AEAD associated data, and seals the payload behind it (`src/nebula/inside.go:334-411`). The nonce is 4 zero bytes followed by the 64-bit message counter (`src/nebula/noise.go:36-55`). Total overhead is 16 bytes of header plus a 16-byte tag.

When the peer has no direct address, the encrypted packet is wrapped in a `MessageRelay` header for the relay tunnel. The relay tunnel only authenticates this outer layer as associated data and does not encrypt it again (`src/nebula/inside.go:277-332`). The relay checks that tag and forwards the inner ciphertext, which it cannot decrypt (`src/nebula/outside.go:67-125`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - Yes: all peer traffic runs over UDP sockets that `udp.NewListener` opens (`src/nebula/udp/udp_linux.go:35-73`).
- [x] **Datagram encapsulation (no head-of-line blocking)** - Yes: each TUN packet becomes one UDP datagram with its own header and counter (`src/nebula/inside.go:355-393`).
- [ ] **TCP fallback** - No: the only `udp.Conn` implementations are UDP sockets (`src/nebula/udp/conn.go:16-23`), and the code has no TCP transport.
- [ ] **QUIC support** - No: there is no QUIC module in `src/nebula/go.mod` and no QUIC code in `src/nebula/udp/`.
- [ ] **WebSocket support** - No: there is no WebSocket code or dependency in the source tree (`src/nebula/go.mod:5-37`).

### IP Support

- [x] **IPv4 support** - Yes: `parseV4` handles inner IPv4, and v1 and v2 certificates carry IPv4 networks (`src/nebula/outside.go:396-450`).
- [x] **IPv6 support** - Yes: `parseV6` handles inner IPv6. IPv6 overlay addresses need a v2 certificate, which `ixHandshakeStage0` selects for v6 peers (`src/nebula/outside.go:299-394`, `src/nebula/handshake_ix.go:26-34`).
- [x] **Dual-stack** - Yes: a v2 certificate can list several networks, and `addIPs` puts all of them on the same TUN device (`src/nebula/overlay/tun_linux.go:282-321`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - Yes: the TUN device is created with `IFF_TUN | IFF_NO_PI` and carries IP packets (`src/nebula/overlay/tun_linux.go:105`).
- [ ] **Layer 2 (Ethernet) mode** - No: there is no TAP mode, and `newPacket` rejects anything that is not IPv4 or IPv6 (`src/nebula/outside.go:284-297`).
- [ ] **Bridging support** - No: without TAP or Ethernet frames, there is no L2 bridging. `unsafe_routes` only routes at L3 (`src/nebula/overlay/route.go:146-305`).

### Advanced Protocol Features

- [ ] **Multipath/bonding** - No: each peer has one active `hostinfo.remote` (`src/nebula/hostmap.go:685-691`). The weighted ECMP in `routing.BalancePacket` spreads traffic across different gateway peers, not across underlay paths to one peer (`src/nebula/routing/balance.go:27-39`).
- [ ] **QoS/traffic shaping** - No: the TX and RX paths have no queues, traffic classes or rate limits (`src/nebula/inside.go:14-82`, `src/nebula/outside.go:468-509`).
- [ ] **Multicast support** - No: a multicast destination is not inside the VPN networks or any route, so `consumeInsidePacket` drops it. `tun.drop_multicast` only adds an earlier drop (`src/nebula/inside.go:46-63`).

# Encryption

## Encryption Layer Details

**Handshake.** Nebula uses Noise IX from `flynn/noise` v1.1.0. The message patterns are `e, s` followed by `e, ee, se, s, es` (`deps/nebula/go-modules/github.com/flynn/noise/patterns.go:111-115`). `NewConnectionState` chooses `DH25519` or P-256 based on the certificate curve. For the cipher, it uses `CipherAESGCM` when `cipher: aes` (the default) or `CipherChaChaPoly` when `cipher: chachapoly`, always with SHA-256 (`src/nebula/connection_state.go:31-50`). `PresharedKey` is empty, so no PSK token is mixed in, even though the subtype is named `ix_psk0` (`src/nebula/connection_state.go:58-67`, `deps/nebula/go-modules/github.com/flynn/noise/state.go:336-356`).

The payload of each handshake message is a protobuf `NebulaHandshake`. It holds the sender's certificate with the public key removed, the sender's index and a timestamp. The receiver rebuilds the certificate from the Noise static key with `cert.Recombine` and checks it against the CA pool (`src/nebula/handshake_ix.go:63-82,136-162`). X25519 runs through `golang.org/x/crypto/curve25519`, which wraps `crypto/ecdh` (`deps/nebula/go-modules/golang.org/x/crypto/curve25519/curve25519.go:16,39`).

**Key derivation.** The Noise `Split` after message 2 produces the two transport keys. These become `eKey`/`dKey` as `NebulaCipherState` (`src/nebula/handshake_ix.go:298-331`).

**Data cipher.** The default is AES-256-GCM through `cipher.NewGCM` (`deps/nebula/go-modules/github.com/flynn/noise/cipher_suite.go:140-145`). On amd64 and arm64, Go 1.25 runs this in AES-NI/PCLMULQDQ or ARMv8 assembly (`deps/nebula/go-stdlib/crypto/internal/fips140/aes/gcm/gcm_asm.go:34-44,66-70`). The alternative ChaCha20-Poly1305 comes from `x/crypto`, with SSSE3/AVX2 assembly on amd64 (`deps/nebula/go-modules/golang.org/x/crypto/chacha20poly1305/chacha20poly1305_amd64.go:23,50`). The cipher must be the same on all nodes (`src/nebula/examples/config.yml:175-177`). A `boringcrypto` build switches AES-GCM to BoringSSL's `NewGCMTLS` and adds an encrypt lock (`src/nebula/noiseutil/boring.go:31-62`).

**Nonces and replay.** The nonce is the 64-bit `messageCounter`, an atomic value that starts at 2, placed after 4 zero bytes (`src/nebula/connection_state.go:81`, `src/nebula/noise.go:44-49`). The receiver keeps a 1024-entry sliding bitmap (`ReplayWindow`). It checks the window before decryption and updates it after successful decryption (`src/nebula/connection_state.go:16`, `src/nebula/bits.go:29-80`, `src/nebula/outside.go:258-272,484`).

**Rekeying.** Nebula has no rekey based on time or packet count. `tryRehandshake` starts a new handshake only when the local certificate or the initiating version has changed (`src/nebula/connection_manager.go:530-544`). Tunnels end when the peer's certificate expires or is blocklisted (`src/nebula/connection_manager.go:481-503`).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Yes: Curve25519 certificates (the `nebula-cert` default) use `noise.DH25519`, which calls X25519 (`src/nebula/connection_state.go:33-34`, `src/nebula/cmd/nebula-cert/ca.go:62`).
- [x] **Perfect Forward Secrecy** - Yes: Noise IX mixes the ephemeral-ephemeral `ee` DH into the transport keys, so long-term keys alone do not decrypt past sessions (`deps/nebula/go-modules/github.com/flynn/noise/patterns.go:113-114`).
- [ ] **Post-quantum readiness** - No: the only DH functions are X25519 and P-256, with no KEM (`src/nebula/connection_state.go:31-42`).
- [x] **Key rotation** - Partial: re-keying happens only when the local certificate changes (`tryRehandshake`, `src/nebula/connection_manager.go:530-544`). Nothing re-keys on a timer or counter.

### Symmetric Encryption

- [x] **Authenticated encryption** - Yes: every data packet goes through `cipher.AEAD.Seal`/`Open` with the header as associated data (`src/nebula/noise.go:49,64`, `src/nebula/outside.go:471`).
- [x] **Hardware-accelerated crypto** - Yes: the default AES-GCM uses the Go 1.25 AES-NI/PCLMULQDQ assembly (`deps/nebula/go-stdlib/crypto/internal/fips140/aes/gcm/gcm_asm.go:34-35`). ChaCha20-Poly1305 has AVX2 assembly (`deps/nebula/go-modules/golang.org/x/crypto/chacha20poly1305/chacha20poly1305_amd64.go:23`).
- [x] **Constant-time operations** - Yes: all primitives come from Go `crypto/*` and `x/crypto` (AES-GCM assembly, `crypto/ecdh` X25519, Ed25519), which are constant-time implementations (`deps/nebula/go-modules/golang.org/x/crypto/curve25519/curve25519.go:16`).

### Protocol Security

- [x] **Replay protection** - Yes: a 1024-packet sliding window `Bits` is checked in `handleEncrypted` and updated after decryption (`src/nebula/bits.go:29-80`, `src/nebula/outside.go:267,484`).
- [x] **Noise Protocol** - Yes: the handshake is Noise IX through `flynn/noise` (`src/nebula/handshake_ix.go:53,108`).
- [ ] **No cleartext metadata** - No: in IX message 1, the initiator's static key and certificate payload (name, networks, groups, issuer) go out before any DH, so they are not encrypted (`deps/nebula/go-modules/github.com/flynn/noise/state.go:171-175`, `src/nebula/handshake_ix.go:63-82`).
- [x] **End-to-end encryption through relays** - Yes: the relay receives the inner packet already encrypted with the end-to-end key. The relay tunnel only authenticates it as associated data (`src/nebula/inside.go:293-319,399-409`).

# Performance

## Threading Model

`Interface.run` starts `routines` UDP readers (`listenOut`) and `routines` TUN readers (`listenIn`). Each one calls `runtime.LockOSThread` (`src/nebula/interface.go:245-303`). The `routines` setting defaults to 1 (`src/nebula/main.go:87-109`), so the default Linux build runs two data-plane threads: one encrypts TUN to UDP, the other decrypts UDP to TUN. With `routines: N`, Nebula opens N UDP sockets with `SO_REUSEPORT` (`src/nebula/udp/udp_linux.go:52-56`) and N TUN queues with `IFF_MULTI_QUEUE` (`src/nebula/overlay/tun_linux.go:106-108,219-235`). It also turns on a per-routine conntrack cache with a 1 s default (`src/nebula/main.go:114-118`).

**TUN to UDP.** `listenIn` makes one blocking `read(2)` per packet into a 9001-byte buffer allocated once. The TUN fd is not O_NONBLOCK, so `os.NewFile` does not register it with the Go poller (`src/nebula/interface.go:279-303`, `deps/nebula/go-stdlib/os/file_unix.go:97,154`). `consumeInsidePacket` then parses the IP header into a reused `firewall.Packet` and looks up the peer under a `HostMap` RLock (`src/nebula/handshake_manager.go:420-434`). Next, `Firewall.Drop` runs. It takes the global conntrack mutex for every packet unless the routine cache is on (`src/nebula/firewall.go:493-512`). Finally, `EncryptDanger` seals into the reused `out` buffer, so the plaintext is read once and the ciphertext written once. One `sendto` syscall then sends the packet (`src/nebula/inside.go:334-393`, `src/nebula/udp/udp_linux.go:190-249`).

**UDP to TUN.** `ListenOut` calls `recvmmsg` with `MSG_WAITFORONE` and up to `listen.batch` = 64 messages. Each message uses a preallocated 9001-byte buffer (`src/nebula/udp/udp_linux.go:121-188`, `src/nebula/udp/udp_linux_64.go:36-56`, `src/nebula/main.go:167`). Each datagram passes through `readOutsidePackets`, `handleEncrypted` (replay check) and `decryptToTun`. That function decrypts into a reused plaintext buffer, runs the inbound firewall, updates the window and makes one `write(2)` to TUN (`src/nebula/outside.go:22-64,468-509`, `src/nebula/overlay/tun_linux.go:242-263`). Handshake packets are processed inline on the same reader goroutine (`src/nebula/outside.go:171-174`).

Nebula uses no UDP GSO/GRO, no virtio-net header and no batched TUN I/O. Socket buffers stay at the system default unless `listen.read_buffer`/`write_buffer` are set (`src/nebula/udp/udp_linux.go:251-280`). The lighthouse, handshake manager and connection manager run in their own goroutines (`src/nebula/main.go:263`, `src/nebula/lighthouse.go:828-852`, `src/nebula/connection_manager.go:149`).

## Performance Optimizations Checklist

### Threading

- [x] **Multi-threaded processing** - Yes: TX and RX crypto run on separate OS-locked goroutines, and `routines: N` adds N pairs (`src/nebula/interface.go:245-303`). The default is one pair (`src/nebula/main.go:99-104`).
- [x] **Multi-queue TUN / per-core sockets** - Yes: with `routines` > 1, Nebula uses `IFF_MULTI_QUEUE` TUN queues and `SO_REUSEPORT` sockets, one per worker. This is off at the default `routines: 1` (`src/nebula/overlay/tun_linux.go:106-108`, `src/nebula/udp/udp_linux.go:52-56`).

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - Yes: `ReadMulti` calls `SYS_RECVMMSG` whenever `listen.batch` > 1 (`src/nebula/udp/udp_linux.go:125-127,170-188`).
- [ ] **Batch UDP sends (sendmmsg)** - No: `WriteTo` makes one `SYS_SENDTO` per packet (`src/nebula/udp/udp_linux.go:197-249`).
- [x] **Large batch sizes (64+)** - Yes: `listen.batch` defaults to 64 messages per `recvmmsg` (`src/nebula/main.go:167`). TUN I/O is one packet per syscall.

### Offloads

- [ ] **UDP GSO** - No: the code never sets `UDP_SEGMENT` (`src/nebula/udp/udp_linux.go:35-73`).
- [ ] **UDP GRO** - No: the code never sets `UDP_GRO`, and each receive buffer holds one datagram (`src/nebula/udp/udp_linux_64.go:36-56`).
- [ ] **TUN offload (virtio-net hdr)** - No: TUN flags are only `IFF_TUN|IFF_NO_PI|IFF_MULTI_QUEUE`, with no `IFF_VNET_HDR` or `TUNSETOFFLOAD` (`src/nebula/overlay/tun_linux.go:105-108`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - Yes: each routine allocates its packet, out, nonce and batch buffers once and reuses them for every packet. There is no `sync.Pool` (`src/nebula/interface.go:269-272,282-285`, `src/nebula/udp/udp_linux_64.go:36-56`).
- [ ] **Large UDP socket buffers (MB)** - No: `listen.read_buffer`/`write_buffer` default to 0, which keeps the kernel default. Setting them uses `SO_RCVBUFFORCE`/`SO_SNDBUFFORCE` (`src/nebula/udp/udp_linux.go:251-280`).
- [x] **Zero-allocation parsing** - Yes: `header.H.Parse` and `newPacket` fill reused structs from byte slices without allocating (`src/nebula/header/header.go:143-156`, `src/nebula/outside.go:284-450`).

### MTU and Peers

- [ ] **Path MTU discovery** - No: the MTU is static. It comes from `tun.mtu` (1300) and per-route `tun.routes` overrides, with no probing (`src/nebula/overlay/tun_linux.go:167-182`).
- [x] **Endpoint caching** - Yes: each `HostInfo` keeps its working `remote`, and `RemoteList` caches learned and reported addresses per peer (`src/nebula/hostmap.go:685-691`, `src/nebula/remote_list.go:277-285`).

### Userspace TCP Stack

- [x] **Userspace TCP/IP stack** - Partial: the embeddable `service` package runs gVisor netstack for in-process TCP/UDP when Nebula is used as a library. The default `nebula` binary uses the kernel TUN (`src/nebula/service/service.go:62-64`, `src/nebula/cmd/nebula/main.go:55`).

### Data Plane Compression

- [ ] **Tunnel compression** - No: `sendNoMetrics` encrypts the raw packet, and the code has no compression step (`src/nebula/inside.go:374`).
- [ ] **Configurable compression** - No: compression does not exist, so there is nothing to configure (`src/nebula/inside.go:334-411`).

# Security

## Known Security Issues

None found for this revision. The changelog's only security entries are dependency or behavior fixes from older releases: CVE-2023-48795 in `x/crypto` was fixed in 1.8.1, and `send_recv_error` was added in 1.6.0 (`src/nebula/CHANGELOG.md:136-138,326-330`). The vendored `golang.org/x/crypto` is v0.43.0 (`src/nebula/go.mod:25`). No external advisory database was consulted, because the task rules forbid web access.

## Potential Security Concerns

- **Initiator identity in cleartext.** In Noise IX message 1, the initiator's static key and its whole certificate (name, overlay networks, groups, issuer) go out before any key exists. A passive observer can read who is connecting and what groups they have (`deps/nebula/go-modules/github.com/flynn/noise/state.go:171-175`, `src/nebula/handshake_ix.go:63-82`).
- **No handshake rate limiting or cookie.** Every message-1 packet from an allowed source triggers DH, certificate parsing and signature verification. This work runs inline on the UDP reader goroutine that also decrypts data (`src/nebula/outside.go:171-174`, `src/nebula/handshake_manager.go:138-161`, `src/nebula/handshake_ix.go:98-162`). A flood of handshakes therefore slows the data path. `NebulaHandshakeDetails.Cookie` exists in the protobuf but nothing uses it (`src/nebula/nebula.pb.go:548`).
- **Unauthenticated `recv_error` teardown.** A `RecvError` packet is not authenticated. It closes the tunnel whose index it names, as long as the source address matches the peer's current remote (`src/nebula/outside.go:529-550`). The index is visible in cleartext in every header (`src/nebula/header/header.go:102-110`). An attacker who can spoof the peer's source address can therefore tear down tunnels, and they rebuild with a new handshake.
- **Blocklist evasion with P-256 certificates (inferred).** Certificate fingerprints are SHA-256 over the encoding that includes the signature (`src/nebula/cert/cert_v1.go:98-105`, `src/nebula/cert/cert_v2.go:129-141`). P-256 signatures are checked with `ecdsa.VerifyASN1`, and no low-S rule is enforced (`src/nebula/cert/cert_v1.go:117-122`, `src/nebula/cert/cert_v2.go:156-161`). Because ECDSA signatures are malleable, a holder of a blocklisted P-256 certificate could produce a second valid encoding with a different fingerprint that passes `IsBlocklisted` (`src/nebula/cert/ca_pool.go:166`). Ed25519 certificates, the default, are not affected.
- **Rekeying only on certificate change.** Session keys stay the same for the life of a tunnel unless the local certificate changes (`src/nebula/connection_manager.go:530-544`). The 64-bit counter makes nonce reuse unrealistic, but long sessions have no time-based key renewal.
- **Replay window not synchronized (inferred).** `Bits` has no lock (`src/nebula/bits.go:8-16`). With `routines` > 1, two reader goroutines could update one peer's window at the same time. SO_REUSEPORT hashing usually keeps one peer on one socket, which makes this unlikely in practice.
- **Runs as root with no sandbox.** The daemon keeps full privileges for its whole life. It contains no setuid, capability drop or seccomp code, and the sample systemd unit sets no hardening options (`src/nebula/examples/service_scripts/nebula.service:1-16`).

## Security Features Checklist

### Network Security

- [ ] **Handshake rate limiting** - No: `HandleIncoming` only applies `remote_allow_list` before running the full handshake (`src/nebula/handshake_manager.go:138-161`).
- [x] **Stateful packet filter** - Yes: the built-in firewall has a conntrack table with TCP, UDP and default timeouts of 12 m, 3 m and 10 m (`src/nebula/firewall.go:203-207,426-467`).
- [x] **Fine-grained ACLs** - Yes: rules match on protocol, port ranges, host, CIDR and local CIDR, separately for inbound and outbound (`src/nebula/firewall.go:250`).
- [x] **Capability-based access** - Yes: rules can match certificate groups, CA name or CA fingerprint (`src/nebula/firewall.go:105-119,250`).

### Identity & Authentication

- [x] **Identity validation** - Yes: the peer certificate must be signed by a CA in `pki.ca`, be within its validity period, not be blocklisted and stay within the CA's constraints (`src/nebula/cert/ca_pool.go:165-201`).
- [ ] **Signed config updates** - No: configuration is a local file reloaded on SIGHUP (`src/nebula/interface.go:305-363`). Lighthouse peer lists are only protected by the tunnel and carry no authority signature (`src/nebula/lighthouse.go:1206-1235`).
- [ ] **Control-server key pinning** - N/A: Nebula has no controller; lighthouses only do discovery (`src/nebula/lighthouse.go:349-379`). Lighthouses are still authenticated like any peer against the private CA in `pki.ca`, and their VPN IP must match `lighthouse.hosts` (`src/nebula/handshake_ix.go:144`, `src/nebula/lighthouse.go:1207-1209`).

### Implementation

- [x] **Memory-safe language** - Yes: Nebula is written in Go. `unsafe` appears only in syscall glue such as `msghdr` setup (`src/nebula/udp/udp_linux_64.go:36-56`).
- [ ] **Privilege separation** - No: there is no privilege drop or separate helper. The process that configures TUN and routes keeps running as root (`src/nebula/overlay/tun_linux.go:81-124`).
- [ ] **Sandboxing** - No: the source contains no seccomp, Landlock, chroot or pledge calls, and the systemd unit has no hardening (`src/nebula/examples/service_scripts/nebula.service`).
- [x] **Audit logging** - Partial: invalid certificates and refused handshakes are logged at Info or Error, the default level being `info` (`src/nebula/handshake_ix.go:160,220`, `src/nebula/logger.go:14`). Firewall drops are logged only at Debug (`src/nebula/inside.go:75-80`, `src/nebula/outside.go:495-499`).

# NAT Traversal

## How NAT Traversal Works

1. **Registration.** Each node keeps a tunnel to every lighthouse in `lighthouse.hosts`. It reaches them through `static_host_map` (`src/nebula/lighthouse.go:349-377`). Every `lighthouse.interval` seconds it sends its local interface addresses and `advertise_addrs` (`src/nebula/lighthouse.go:854-967`, `src/nebula/hostmap.go:770`).
2. **Reflection.** The lighthouse stores the UDP source address it sees for the node as the "learned" address (`SetRemote` calls `LearnRemote`), so the node's public NAT mapping is known (`src/nebula/hostmap.go:685-691`, `src/nebula/remote_list.go:277-285`).
3. **Query and punch.** When A wants B, A sends a `HostQuery` to all lighthouses. The lighthouse replies with B's learned and reported addresses, and sends B a `HostPunchNotification` with A's addresses (`src/nebula/lighthouse.go:1056-1163`). After `punchy.delay` (1 s), B sends a 1-byte UDP packet to each of A's addresses, which opens B's NAT for A (`src/nebula/lighthouse.go:1323-1346`, `src/nebula/punchy.go:71`). Meanwhile A sends handshake message 1 to every known address of B, and the first reply wins (`src/nebula/handshake_manager.go:237-251`).
4. **Respond.** If `punchy.respond` is enabled (default off), B also sends a test packet to A after 5 s, which starts a handshake from B's side. This helps when one side is behind a hard NAT (`src/nebula/lighthouse.go:1351-1361`, `src/nebula/punchy.go:53-62,85`).
5. **Keepalive.** With `punchy.punch` (code default false, example config true), idle tunnels get 1-byte punches to keep NAT state (`src/nebula/connection_manager.go:505-528`, `src/nebula/punchy.go:35`).
6. **Relays.** A node can list relay VPN IPs in `relay.relays`. It reports them to the lighthouse, which hands them to anyone who queries for that node. The initiator then sends `CreateRelayRequest` to those relays alongside its direct attempts (`src/nebula/lighthouse.go:322-343`, `src/nebula/handshake_manager.go:267-330`). A relay must set `relay.am_relay: true` (`src/nebula/relay_manager.go:331`).

## NAT Traversal Checklist

### Discovery

- [ ] **No own public node needed** - No: the user must run a lighthouse with a reachable `static_host_map` address. The source ships no public lighthouses (`src/nebula/lighthouse.go:368-377`, `src/nebula/examples/config.yml:27-28`).
- [x] **Public endpoint discovery (STUN or reflection)** - Yes: server reflection. The lighthouse records the observed source address as `learned` and returns it in query replies (`src/nebula/remote_list.go:277-285`, `src/nebula/lighthouse.go:1165-1182`).
- [x] **Multiple discovery servers** - Yes: `lighthouse.hosts` is a list, and updates and queries go to every entry (`src/nebula/lighthouse.go:770-799,888-964`).
- [ ] **NAT type detection** - No: the code has no NAT classification, only address collection (`src/nebula/lighthouse.go:854-967`).

### Port Mapping

- [ ] **UPnP port mapping** - No: there is no UPnP code or dependency (`src/nebula/go.mod:5-37`).
- [ ] **NAT-PMP support** - No: there is no NAT-PMP code or dependency (`src/nebula/go.mod:5-37`).
- [ ] **PCP support** - No: there is no PCP code or dependency (`src/nebula/go.mod:5-37`).

### Hole Punching

- [x] **UDP hole punching** - Yes: a lighthouse `HostPunchNotification` makes the target send UDP to the querier while the querier sends its handshake (`src/nebula/lighthouse.go:1113-1163,1308-1346`).
- [x] **Symmetric NAT handling** - Partial: there is no port prediction. Optional `punchy.respond` reverses the connection direction, and relays cover the remaining cases (`src/nebula/lighthouse.go:1351-1361`).
- [x] **Rendezvous coordination** - Yes: the lighthouse coordinates the punch with `sendHostPunchNotification` (`src/nebula/lighthouse.go:1109`).

### Fallback

- [x] **Relay fallback** - Yes: when relays are configured (`relay.relays` on the target, `relay.am_relay` on the relay) and `relay.use_relays` is on (default true), traffic goes through a relay if there is no direct remote (`src/nebula/main.go:201`, `src/nebula/inside.go:398-409`).
- [x] **Multiple relays** - Yes: `relay.relays` is a list, and `handleOutbound` requests a relay from every listed relay (`src/nebula/lighthouse.go:333-342`, `src/nebula/handshake_manager.go:270-330`).
- [ ] **Latency-based relay selection** - No: `sendNoMetrics` uses the first relay in `CopyRelayIps` that works (`src/nebula/inside.go:400-408`).
- [ ] **TCP relay support** - No: relays forward Nebula UDP datagrams only (`src/nebula/inside.go:327`).

# Local Routing

## Peer Discovery on LANs

Nebula does not discover peers on the LAN by itself. Each node reports all local interface addresses to the lighthouses, filtered by `local_allow_list` (`src/nebula/hostmap.go:770-800`, `src/nebula/lighthouse.go:866-878`). Peers therefore learn private addresses as well as the public one and send handshakes to all of them at once (`src/nebula/handshake_manager.go:237-251`).

When sorting candidate addresses, Nebula puts `preferred_ranges` first, then IPv6, then public IPv4 ahead of private IPv4 (`src/nebula/remote_list.go:604-690`). LAN paths are only preferred when `preferred_ranges` is set. `TryPromoteBest` then probes preferred addresses every 1000 packets and switches the tunnel to them (`src/nebula/hostmap.go:20,640-664`). The experimental `calculated_remotes` guesses LAN addresses from the VPN IP before the lighthouse answers (`src/nebula/lighthouse.go:592-635`).

## Routing Features

`tun.unsafe_routes` sends non-Nebula subnets through a Nebula gateway whose certificate lists the subnet as an unsafe network. A route can have several weighted gateways (ECMP by port hash) and a metric (`src/nebula/overlay/route.go:146-305`, `src/nebula/routing/balance.go:14-39`). If the chosen gateway is unreachable, another gateway is tried (`src/nebula/inside.go:180-207`). Optionally, `tun.use_system_route_table` imports such routes from the kernel table (`src/nebula/overlay/tun_linux.go:326-328,536-671`). Lighthouses can optionally serve DNS A/AAAA records for certificate names of hosts they have tunnels with (`src/nebula/dns_server.go:42-102`, `src/nebula/hostmap.go:579`).

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - No: peers are found only through lighthouses and `static_host_map`. The code has no broadcast or multicast discovery (`src/nebula/lighthouse.go:349-377`).
- [x] **Direct path advertisement** - Yes: `SendUpdate` reports every allowed local interface address to the lighthouses (`src/nebula/lighthouse.go:866-878`).

### LAN Optimization

- [x] **Automatic LAN preference** - Partial: LAN paths are preferred only for CIDRs listed in `preferred_ranges`. The default sort puts public IPv4 before private IPv4 (`src/nebula/remote_list.go:625-668`, `src/nebula/hostmap.go:640-664`).
- [ ] **Trusted path mode** - No: every data packet is encrypted in `sendNoMetrics`, and no setting skips encryption (`src/nebula/inside.go:374`).
- [x] **LAN-only mode** - Yes: lighthouses, relays and CA are all operator-run, so a network built from LAN addresses in `static_host_map` works without internet (`src/nebula/lighthouse.go:408-455`).

### Routing Features

- [x] **Subnet routes** - Yes: `tun.unsafe_routes` combined with certificate `unsafeNetworks` lets a node route for a subnet behind it (`src/nebula/overlay/route.go:146-305`, `src/nebula/hostmap.go:733-748`).
- [x] **Full tunnel mode** - Partial: `unsafe_routes` accepts `0.0.0.0/0` through a gateway, and `listen.so_mark` helps avoid routing loops. The user must set up NAT/forwarding on the gateway and policy routing on the client by hand (`src/nebula/overlay/route.go:287-301`, `src/nebula/examples/config.yml:147-151`).
- [x] **Split tunneling** - Yes: only the VPN networks and configured routes are installed on the TUN device. All other traffic stays on the host's normal routes (`src/nebula/overlay/tun_linux.go:378-388,446-485`).
- [x] **Route priorities** - Yes: unsafe routes support `metric` and weighted gateways, and fail over to another gateway when the chosen one cannot be reached (`src/nebula/overlay/route.go:185-260`, `src/nebula/inside.go:159-207`).
- [ ] **Multi-hop routing via peers** - No: Nebula has no routing protocol. Forwarding happens only through explicitly configured relays (one hop) or unsafe-route gateways (`src/nebula/outside.go:101-123`).
- [x] **Built-in DNS** - Partial: only lighthouses with `lighthouse.serve_dns` answer, and only for certificate names of hosts they have tunnels with. Clients must point their resolver at it by hand (`src/nebula/main.go:215-222`, `src/nebula/dns_server.go:166-187`).

# Central Point of Failure

## What Happens When the Lighthouse Fails

Lighthouses only handle discovery and punch coordination. Tunnels run directly between peers and are kept alive by `connectionManager` with peer-to-peer test packets (`src/nebula/connection_manager.go:321-432`). When every lighthouse is down, existing tunnels keep working. A tunnel can still roam, because `handleHostRoaming` accepts authenticated packets from a new address (`src/nebula/outside.go:233-255`).

New tunnels to peers whose address is not already cached or in `static_host_map` cannot be built. Lighthouse queries go unanswered, and the handshake times out after its retries (`src/nebula/handshake_manager.go:184-194`). Address caches are dropped when a peer's last tunnel closes (`src/nebula/outside.go:220-226`), and they are never written to disk.

The CA is not online at all. Certificates are verified locally against `pki.ca`, so losing the CA's machine only stops new certificates from being issued (`src/nebula/cert/ca_pool.go:130-201`).

## Mitigation Strategies

- Run several lighthouses. Nodes update and query all of them (`src/nebula/lighthouse.go:770-799,888-964`).
- Put stable peers in `static_host_map`, and use `calculated_remotes` for predictable LANs (`src/nebula/lighthouse.go:408-455,592-635`).
- Configure several relays in `relay.relays` (`src/nebula/lighthouse.go:333-342`).
- Issue certificates with sensible lifetimes, and use `pki.blocklist` to revoke them (`src/nebula/pki.go:519`).

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Yes: tunnels are peer-to-peer, and the connection manager tests them without contacting a lighthouse (`src/nebula/connection_manager.go:321-432`).
- [ ] **Local state caching** - No: the peer address cache (`RemoteList`) lives only in memory and is cleared when tunnels close. Nothing is persisted (`src/nebula/outside.go:220-226`).
- [ ] **Cached credentials** - N/A: Nebula has no controller that issues or checks credentials at runtime. The key, certificate and CA bundle are local files, verified locally (`src/nebula/pki.go:256-341`).

### Redundancy

- [x] **Decentralized control plane** - Partial: nodes need operator-run lighthouses listed in `lighthouse.hosts` to find each other (`src/nebula/lighthouse.go:349-379`), while membership comes from certificates signed by the offline CA, not from the lighthouses.
- [x] **Fully self-hostable** - Yes: lighthouses, relays and the CA (`nebula-cert`) are all run by the operator (`src/nebula/cmd/nebula-cert/ca.go`, `src/nebula/lighthouse.go:84`).
- [ ] **Controller redundancy** - N/A: Nebula has no controller; lighthouses are discovery nodes only (`src/nebula/lighthouse.go:349-379`). Several lighthouses can still run at once through the `lighthouse.hosts` list.
- [x] **Relay redundancy** - Yes: several relays can be listed, and Nebula requests relays through all of them (`src/nebula/handshake_manager.go:270-330`).
- [ ] **No single root of trust** - No: anyone with a trusted CA key can sign certificates for any VPN IP and groups that CA's constraints allow (`src/nebula/cert/ca_pool.go:165-201`).

# Authentication

## How Nodes Join and Authenticate

An administrator creates a CA with `nebula-cert ca`, which by default makes a v2 Curve25519 CA valid for one year. The CA key can be encrypted with Argon2 (`src/nebula/cmd/nebula-cert/ca.go:32-62`). For each node, the administrator runs `nebula-cert sign` to issue a certificate with networks, groups and optional unsafe networks. It is valid until one second before the CA expires unless `-duration` is set (`src/nebula/cmd/nebula-cert/sign.go:46-61,168-171`). The certificate, key and CA bundle are copied to the node.

At runtime, peers exchange certificates in the Noise IX handshake. Each side verifies the other's certificate against its local CA pool and blocklist (`src/nebula/handshake_ix.go:136-162`, `src/nebula/cert/ca_pool.go:165-201`). It also checks that the certificate networks overlap its own VPN networks (`src/nebula/handshake_ix.go:193-222`). Tunnels close when a peer certificate expires or is blocklisted, because `pki.disconnect_invalid` defaults to true (`src/nebula/connection_manager.go:481-503`, `src/nebula/interface.go:319`). Nebula has no online enrollment service, so nodes do not request certificates themselves.

## Authentication Checklist

### Enrollment Methods

- [ ] **Pre-authentication keys** - No: no shared secret admits a node. The PSK field of the handshake is empty (`src/nebula/connection_state.go:63-67`).
- [x] **Certificate-based enrollment** - Yes: a node is admitted only by a certificate signed by a CA in `pki.ca` (`src/nebula/cert/ca_pool.go:130-201`).
- [ ] **OAuth/OIDC** - No: the source has no OIDC or OAuth code (`src/nebula/go.mod:5-37`).
- [ ] **Interactive login** - No: Nebula has no login flow. Credentials are files (`src/nebula/pki.go:256-285`).
- [x] **CLI authentication** - Yes: `nebula-cert keygen` and `nebula-cert sign` enroll nodes from the command line (`src/nebula/cmd/nebula-cert/main.go`, `src/nebula/cmd/nebula-cert/sign.go:46-61`).

### Authorization

- [x] **Admin approval workflow** - Partial: an administrator must sign every certificate by hand, but there is no request-and-approve flow (`src/nebula/cmd/nebula-cert/sign.go`).
- [ ] **Automated enrollment rules** - No: there is no enrollment service. CA constraints only limit what a signed certificate may contain (`src/nebula/cert/ca_pool.go:233-240`).
- [ ] **Ephemeral nodes** - No: idle tunnels can be dropped (`tunnels.drop_inactive`, default false), but node identities are never removed (`src/nebula/connection_manager.go:94-96,434-448`).
- [x] **Node expiry** - Yes: certificates have `NotAfter`, expired ones fail `verify`, and active tunnels are torn down on expiry (`src/nebula/cert/ca_pool.go:175-181`, `src/nebula/connection_manager.go:481-503`).

### Identity

- [x] **Stable device identity** - Yes: the identity is the key pair plus certificate on disk, so it does not change with restarts or underlay address changes (`src/nebula/pki.go:256-341`).
- [x] **Identity portability** - Yes: the key and certificate are plain files or inline PEM that can move to another machine. PKCS#11 hardware keys are optional (`src/nebula/pki.go:259-285`).

# Platform Support

## Supported Platforms

The repository has TUN backends for Linux, Android, macOS (utun), iOS, FreeBSD, OpenBSD, NetBSD and Windows (Wintun) (`src/nebula/overlay/tun_linux.go`, `src/nebula/overlay/tun_android.go`, `src/nebula/overlay/tun_darwin.go`, `src/nebula/overlay/tun_ios.go`, `src/nebula/overlay/tun_freebsd.go`, `src/nebula/overlay/tun_openbsd.go`, `src/nebula/overlay/tun_netbsd.go`, `src/nebula/overlay/tun_windows.go`). The README lists Linux, Windows, macOS and FreeBSD packages, an official Docker image, and official iOS and Android apps (`src/nebula/README.md:17-63`).

## Implementation Details

Everything is pure Go and selected by build tags. Linux uses raw `recvmmsg`/`sendto` sockets and netlink for addresses and routes (`src/nebula/udp/udp_linux.go`, `src/nebula/overlay/tun_linux.go`). Windows uses the Wintun driver and RIO sockets from the `golang.zx2c4.com` modules (`src/nebula/overlay/tun_windows.go:23-48`, `src/nebula/udp/udp_rio_windows.go:22`). macOS and other platforms use the generic Go UDP path (`src/nebula/udp/udp_generic.go:1-4`, `src/nebula/udp/udp_darwin.go`).

Mobile builds get the TUN fd from the host app through `newTunFromFd` (`src/nebula/overlay/tun_android.go:29-32`, `src/nebula/overlay/tun_ios.go:35-36`). Multi-queue works only on Linux. Darwin and Windows return "multiqueue not implemented" (`src/nebula/overlay/tun_darwin.go:553`, `src/nebula/overlay/tun_windows.go:238`). `tun.disabled` runs a lighthouse or relay without a TUN device and without root (`src/nebula/overlay/tun.go:20-22`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - Yes: Linux is the primary platform, with multi-queue TUN, recvmmsg and netlink routes (`src/nebula/overlay/tun_linux.go`, `src/nebula/udp/udp_linux.go`).
- [x] **macOS** - Yes: macOS uses the utun backend (`src/nebula/overlay/tun_darwin.go:82-127`).
- [x] **Windows** - Yes: Windows uses the Wintun TUN and RIO UDP (`src/nebula/overlay/tun_windows.go:45-48`, `src/nebula/udp/udp_rio_windows.go`).
- [x] **FreeBSD/OpenBSD** - Yes: both have their own backends (`src/nebula/overlay/tun_freebsd.go`, `src/nebula/overlay/tun_openbsd.go`).

### Mobile

- [x] **iOS** - Yes: the repo has an iOS backend (`src/nebula/overlay/tun_ios.go:35`), and the README links the official Mobile Nebula app (`src/nebula/README.md:62`).
- [x] **Android** - Yes: the repo has an Android backend (`src/nebula/overlay/tun_android.go:29`), and the README links the official app (`src/nebula/README.md:63`).

### Implementation

- [ ] **Kernel-mode datapath** - No: all encryption and forwarding happens in the userspace Go process through TUN (`src/nebula/interface.go:245-303`).
- [x] **Container support** - Yes: the repo has a distroless Dockerfile for the official `nebulaoss/nebula` image (`src/nebula/docker/Dockerfile:1-11`, `src/nebula/README.md:55-58`).
