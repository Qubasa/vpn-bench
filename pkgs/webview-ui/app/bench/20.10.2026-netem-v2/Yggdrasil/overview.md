# Overview

Yggdrasil v0.5.12 (rev 213f72b8403f) is an end-to-end encrypted IPv6 overlay network from the Yggdrasil Network project, written in Go (`src/yggdrasil/README.md:7-11`). Each node derives its IPv6 address in `200::/7` and a routed `/64` from its Ed25519 public key (`src/yggdrasil/src/address/address.go:51`, `:101`). Nodes open stream links (TCP, TLS, QUIC, WebSocket, SOCKS, UNIX) to peers that the user lists in the config, and they find LAN neighbours by IPv6 multicast beacons. The vendored routing library Ironwood (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood`) builds a spanning tree over all links, looks up paths with bloom filters and forwards packets hop by hop through ordinary nodes. A second Ironwood layer (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted`) encrypts every packet end to end with ratcheted per-session X25519 keys and XSalsa20-Poly1305. There is no controller, no bootstrap server and no NAT traversal. A node behind NAT reaches the network by dialing out to a peer that can accept connections.

At a glance:

- **Language:** Go. `src/yggdrasil/go.mod:3` declares `go 1.22`. The toolchain that built it ships a standard library whose `go.mod` says `go 1.25` (`deps/yggdrasil/go-stdlib/go.mod:3`).
- **License:** LGPLv3 with a static/dynamic linking exception (`src/yggdrasil/LICENSE:1-5`).
- **Default peer transport:** TCP. A fresh Linux config has no peers and no listeners (`src/yggdrasil/src/config/config.go:77-79`). Multicast discovery on all interfaces (`src/yggdrasil/src/config/defaults_linux.go:17-19`) then sets up `tls://` links (TLS 1.3 over TCP) between link-local neighbours (`src/yggdrasil/src/multicast/multicast.go:327-332`, `:444-449`). Manually configured peers use whatever URI scheme the user writes: `tcp`, `tls`, `quic`, `ws`, `wss`, `socks`, `sockstls` or `unix` (`src/yggdrasil/src/core/link.go:581-602`). There is no automatic fallback between them. The benchmark harness adds `tls://` and `quic://` listeners (inferred, from the harness config outside `sources/`).
- **Data cipher (default):** XSalsa20-Poly1305 (NaCl `box`/`secretbox`) end to end (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:325`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:116`). On `tls://` links each hop also runs TLS 1.3, which uses AES-128-GCM when the CPU has AES-GCM support and ChaCha20-Poly1305 otherwise (`deps/yggdrasil/go-stdlib/crypto/tls/handshake_server_tls13.go:179-182`). `tcp://` links add no hop encryption. The end-to-end cipher cannot be changed.
- **Handshake:** Custom. On each link a signed "meta" exchange (Ed25519 over BLAKE2b-512 of the public key, optionally keyed with a password) runs either raw or inside TLS 1.3 with self-signed certificates and verification turned off (`src/yggdrasil/src/core/version.go:59-96`, `src/yggdrasil/src/core/tls.go:8-29`). End to end, a session init/ack carries Ed25519-signed ephemeral X25519 keys sealed with an ephemeral-static X25519 box (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:483-551`), followed by a key ratchet in the data path.
- **Default tunnel MTU:** 65535, from `DefaultIfMTU` (`src/yggdrasil/src/config/defaults_linux.go:22-23`), capped by `(*Core).MTU` (`src/yggdrasil/src/core/core.go:170-177`).
- **Control-plane model:** fully distributed.
- **Data-plane threading:** multi-threaded actor pipeline (`phony`): one actor per session does that session's crypto, one router actor serves all traffic, one reader goroutine per link. No worker pool.

## Key Architecture Components

**Control plane (Ironwood router).** The `router` actor in `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go` keeps a spanning tree. The node with the lowest public key becomes root (`router.go:238`). Each node picks its parent by cost, where cost is the root distance times the link latency (`router.go:221-279`). Latency is an exponentially weighted average of the signature request/response round trip on each link (`router.go:424-443`). Tree state is refreshed once per second in `_doMaintenance` (`router.go:89-100`). Signed `routerAnnounce` messages spread tree info to peers (`router.go:321`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:342-352`).

**Discovery.** There are two parts. First, link discovery: static `Peers`/`InterfacePeers` from the config plus IPv6 link-local multicast beacons on `[ff02::114]:9001` (`src/yggdrasil/src/multicast/multicast.go:72`, `:248-378`). Second, destination discovery: a `pathLookup` is multicast along tree links whose bloom filter matches the partial destination key (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/bloomfilter.go:301-330`). The destination answers with a signed `pathNotify` that carries its tree coordinates (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/pathfinder.go:53-85`).

**Transport (links).** Each link is a reliable byte stream handed to `(*PacketConn).HandleConn` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/packetconn.go:148`). Ironwood frames each message as a uvarint length plus a one-byte type (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:200-226`). The supported schemes are listed in `links.connect` and `links.listen` (`src/yggdrasil/src/core/link.go:431-450`, `:581-602`). Persistent peers redial with exponential backoff up to about 68 minutes (`link.go:30`, `:266-284`).

**Data path.** TUN packets go through `ipv6rwc` (address checks, key lookup), `Core.WriteTo`, Ironwood's session encryption and then the router, which forwards greedily in tree space toward the destination's coordinates (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:685-752`). The Linux TUN device comes from wireguard-go and has virtio-net offloads turned on (`src/yggdrasil/src/tun/tun_linux.go:20`).

**Identity.** The identity is an Ed25519 key pair stored in the config (`src/yggdrasil/src/config/config.go:203-209`). The same key is converted to X25519 for end-to-end key agreement (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:60`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/internal/e2c/e2c.go`). The IPv6 address and subnet are deterministic functions of the public key (`src/yggdrasil/src/address/address.go:51-114`).

# Protocol

## Control Plane

When a link comes up, both sides send a "meta" record: magic `meta`, TLV fields for the major/minor version, the Ed25519 public key and the link priority, and an Ed25519 signature over `BLAKE2b-512(key=password, publicKey)` (`src/yggdrasil/src/core/version.go:59-96`). The receiver verifies the signature and the version (0.5) (`version.go:99-169`). It then checks pinned keys from the `?key=` URI option and the `AllowedPublicKeys` list for inbound links (`src/yggdrasil/src/core/link.go:637-662`). The handshake has a 6-second deadline (`link.go:612`).

Ironwood then runs on the link. Each side sends a `routerSigReq` with a random nonce. The peer returns a `routerSigRes` that signs (node, parent, seq, nonce, port) (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:381-417`, `:793-860`). The response is checked against the peer's key (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:324-336`). These signed responses make up each node's tree position. Signed announcements of every known node's (key, parent, signature) are spread to peers (`router.go:321-380`, `:472-575`). Keepalives go out 1 second after received traffic, and a link is dropped after 3 seconds without any reply to traffic (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/config.go:26-27`, `peers.go:124-178`). Router info times out after 5 minutes and is refreshed every 4 minutes (`config.go:24-25`).

Each node keeps an 8192-bit bloom filter (8 hashes) per tree link. It holds the transformed keys reachable through that link (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/bloomfilter.go:13-31`). Yggdrasil sets the transform to the key's `/64` subnet prefix (`src/yggdrasil/src/core/core.go:96-101`), so a lookup for an address or subnet only needs the partial key derived from the IPv6 address (`src/yggdrasil/src/address/address.go:117-150`). Lookups go out at most once per second per destination (`config.go:32`, `pathfinder.go:27-42`, `:164-192`). A found path is cached for 1 minute and refreshed by received traffic (`config.go:31`, `pathfinder.go:259-266`). When a hop has no next hop, it sends a `pathBroken` back to the source, which looks the path up again (`pathfinder.go:226-251`).

## Data Plane

An outbound IPv6 packet is checked for a source in the node's own address or subnet (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:283-311`). It is mapped to a destination key through the `keyStore`. A packet for an unknown destination is buffered (one per destination, 2-minute timeout) while a lookup runs (`ipv6rwc.go:77-133`). `Core.WriteTo` prefixes a one-byte session type (`src/yggdrasil/src/core/core.go:214-224`).

The Ironwood session layer then builds a packet like this: type byte, uvarint local key sequence, uvarint remote key sequence, uvarint nonce, then `secretbox(nextPub || payload)` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:312-325`). Each packet therefore carries 32 bytes of next-ratchet public key plus a 16-byte Poly1305 tag. The fixed overhead budget is 79 bytes (`session.go:21-22`).

The network layer wraps that in a `traffic` record: destination tree path, source tree path, source key (32 bytes), destination key (32 bytes), watermark and payload (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/traffic.go:9-49`). Each hop runs `_lookup`. It keeps only peers strictly closer to the destination in tree space, which prevents loops, and picks the one with the lowest latency cost per unit of distance. Among links to the same key it picks the lowest priority value, and on ties the oldest link (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:685-752`). The watermark must decrease at every hop (`router.go:689-696`). Each peer has a fair queue keyed by destination and source. When the oldest queued packet is more than 25 ms old, the oldest packet of the largest flow is dropped (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:427-441`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/packetqueue.go:121-150`).

On receive, `ipv6rwc.readPC` drops non-IPv6 packets, packets not addressed to the local address or subnet, and packets whose source address does not match the sender's key. It also answers oversize packets with ICMPv6 Packet Too Big (`ipv6rwc.go:228-281`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - Partial: peer data uses UDP only through the opt-in `quic://` transport (`src/yggdrasil/src/core/link_quic.go:53-73`). Default links are TCP, and multicast beacons are the only other UDP traffic (`src/yggdrasil/src/multicast/multicast.go:97-116`).
- [ ] **Datagram encapsulation (no head-of-line blocking)** - Every link is a reliable ordered stream. Ironwood reads length-prefixed messages from a `bufio.Reader` on the `net.Conn` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:243-266`), and even QUIC links carry everything on one stream (`src/yggdrasil/src/core/link_quic.go:64`).
- [x] **TCP fallback** - TCP is the default carrier, so no switch is needed when UDP is blocked: `tcp://`, `tls://`, `ws://`, `wss://` and `socks://` all run over TCP (`src/yggdrasil/src/core/link.go:581-602`), and multicast peering uses `tls://` (`src/yggdrasil/src/multicast/multicast.go:327-331`).
- [x] **QUIC support** - `quic://` is a selectable peer scheme backed by quic-go v0.48.2 with one stream per connection (`src/yggdrasil/src/core/link_quic.go:40-108`, `deps/yggdrasil/go-modules/modules.txt`).
- [x] **WebSocket support** - `ws://` and `wss://` links use `github.com/coder/websocket` with the `ygg-ws` subprotocol (`src/yggdrasil/src/core/link_ws.go:56-120`, `link_wss.go`).

### IP Support

- [ ] **IPv4 support** - Only IPv6 is tunneled. `writePC` rejects any packet whose version nibble is not 6 (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:284-286`), and `readPC` drops them (`ipv6rwc.go:243-245`).
- [x] **IPv6 support** - Inner traffic is IPv6 inside `200::/7`. The TUN gets the node address with a `/7` prefix (`src/yggdrasil/src/tun/tun.go:120-124`).
- [ ] **Dual-stack** - No inner IPv4 path exists, because the TUN only carries IPv6 (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:284-286`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - The TUN device is created with `IFF_TUN` and carries IPv6 packets (`src/yggdrasil/src/tun/tun_linux.go:20`, `deps/yggdrasil/go-modules/golang.zx2c4.com/wireguard/tun/tun_linux.go:566`).
- [ ] **Layer 2 (Ethernet) mode** - There is no TAP mode. Only `wgtun.CreateTUN` is used (`src/yggdrasil/src/tun/tun_linux.go:20`).
- [ ] **Bridging support** - There is no Ethernet bridging code. The only path into the overlay is the IPv6 TUN (`src/yggdrasil/src/tun/iface.go:11-35`).

### Advanced Protocol Features

- [x] **Multipath/bonding** - Several links to the same peer key can be up at once (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:47-77`), and `_lookup` uses the one with the lowest priority value, so another link takes over when that one drops (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:727-732`). This is active-backup. Traffic is never split across links.
- [x] **QoS/traffic shaping** - Partial: each peer has a built-in fair queue per destination and source that drops the oldest packet of the largest flow after 25 ms of queueing (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:434-440`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/packetqueue.go:121-150`). There are no user-configurable classes or rate limits.
- [ ] **Multicast support** - IPv6 multicast destinations fail the `200::/7` address and subnet check in `writePC` and are rejected as "invalid destination address" (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:303-309`).

# Encryption

## Encryption Layer Details

**Link layer.** `tls://`, `wss://` and `sockstls://` links run Go `crypto/tls`. The certificate is a self-signed Ed25519 certificate built from the node key, with a validity end in year 9999 (`src/yggdrasil/src/config/config.go:155-201`). Peer certificate verification is disabled (`InsecureSkipVerify: true`, and the verify callbacks return nil) (`src/yggdrasil/src/core/tls.go:15-29`). The server side requires TLS 1.3 (`tls.go:18`). The dialer allows 1.2 (`link_tls.go:38`), so two Yggdrasil nodes negotiate 1.3. The TLS 1.3 suite is AES-128-GCM when `hasAESGCMHardwareSupport` is true, otherwise ChaCha20-Poly1305 (`deps/yggdrasil/go-stdlib/crypto/tls/handshake_server_tls13.go:179-182`, `cipher_suites.go:371-376`). The key exchange is ECDHE with X25519. Go 1.25 would prefer the hybrid `X25519MLKEM768` (`deps/yggdrasil/go-stdlib/crypto/tls/defaults.go:19-24`). However, the GODEBUG default `tlsmlkem=0` applies to main modules that declare a Go version below 1.24 (`deps/yggdrasil/go-stdlib/internal/godebugs/table.go:65`, `deps/yggdrasil/go-stdlib/cmd/go/internal/load/godebug.go:48-52`), and Yggdrasil declares `go 1.22` (`src/yggdrasil/go.mod:3`). `tcp://` links have no link encryption. Inside the stream, the meta record authenticates the claimed public key with an Ed25519 signature over `BLAKE2b-512(key=password, publicKey)` (`src/yggdrasil/src/core/version.go:80-92`).

**End-to-end session handshake.** Encryption is done by `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted`. The node's Ed25519 key is converted to an X25519 key (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:60-72`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/packetconn.go:31`). To open a session, the sender creates "current" and "next" X25519 key pairs (`session.go:154-166`). The init message contains a fresh ephemeral X25519 public key. The sender signs `ephemeral || current || next || keySeq || seq` with Ed25519 (`seq` is the Unix time, `session.go:479`). The signature and keys are sealed with NaCl box between the ephemeral key and the recipient's static X25519 key, using nonce 0 (`session.go:483-520`). The receiver opens the box with its static key and checks the signature against the sender's Ed25519 key, which is the routing address (`session.go:522-551`). Inits and acks with a `seq` not newer than the last one are ignored (`session.go:265`, `:276`). The ack has the same format with a different type byte (`session.go:561-567`).

**Key derivation and data cipher.** Each side keeps three of its own key pairs (recv, send, next) and two of the remote's public keys (current, next). Shared keys come from `box.Precompute`, which is X25519 plus HSalsa20 (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:107-109`, `deps/yggdrasil/go-modules/golang.org/x/crypto/nacl/box/box.go:81-84`). Data packets are sealed with `secretbox.Seal` (XSalsa20-Poly1305) under a 24-byte nonce whose last 8 bytes hold a 64-bit counter (`crypto.go:116-128`, `deps/yggdrasil/go-modules/golang.org/x/crypto/nacl/secretbox/secretbox.go:113-116`). X25519 runs through Go's `crypto/ecdh` (`deps/yggdrasil/go-modules/golang.org/x/crypto/curve25519/curve25519.go:13`, `:36`).

**Nonce and replay handling.** For each key slot, a packet is accepted only if its nonce is strictly greater than the highest nonce accepted so far (`session.go:368`, `:377`, `:403`). There is no sliding window, so reordered packets are dropped. When decryption fails or the key sequence numbers make no sense, the receiver sends a new init and the session resyncs (`session.go:425-429`, `:443-448`).

**Rekeying.** Every data packet carries the sender's next public key inside the ciphertext (`session.go:320-325`). When a packet arrives under the remote's next key, the receiver rotates both sides' key slots, at most once per minute (`session.go:375-424`). A send-nonce overflow also forces a rotation (`session.go:303-311`). New inits and acks rotate keys as well (`session.go:284-297`). A session idle for 1 minute is deleted (`session.go:20`, `:250-261`).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Session keys come from X25519 through `box.Precompute`/`curve25519.ScalarMult` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:107-109`, `deps/yggdrasil/go-modules/golang.org/x/crypto/nacl/box/box.go:81-84`). TLS links use X25519 ECDHE.
- [x] **Perfect Forward Secrecy** - Traffic keys come only from per-session X25519 key pairs made by `newBoxKeys` and replaced on every ratchet step (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:227-238`, `:284-297`). The static key only seals the init that carries ephemeral public keys (`session.go:483-520`).
- [ ] **Post-quantum readiness** - The end-to-end layer is plain X25519 (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:98-109`). The TLS hybrid `X25519MLKEM768` is turned off by the `tlsmlkem=0` default for a `go 1.22` main module (`src/yggdrasil/go.mod:3`, `deps/yggdrasil/go-stdlib/internal/godebugs/table.go:65`).
- [x] **Key rotation** - Sessions ratchet to fresh X25519 keys while traffic flows, at most once per minute, and on nonce overflow (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:375-424`, `:303-311`).

### Symmetric Encryption

- [x] **Authenticated encryption** - Every data packet is sealed with XSalsa20-Poly1305 `secretbox` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:116-119`). TLS links add AES-GCM or ChaCha20-Poly1305 per hop.
- [x] **Hardware-accelerated crypto** - On amd64, Salsa20 runs SSE2 assembly (`deps/yggdrasil/go-modules/golang.org/x/crypto/salsa20/salsa/salsa20_amd64.go:11-22`, `salsa20_amd64.s:56-60`) and Poly1305 runs amd64 assembly (`deps/yggdrasil/go-modules/golang.org/x/crypto/internal/poly1305/sum_amd64.s`). TLS AES-GCM uses AES-NI and PCLMULQDQ when available (`deps/yggdrasil/go-stdlib/crypto/tls/cipher_suites.go:371`).
- [x] **Constant-time operations** - All primitives come from Go `golang.org/x/crypto` and the standard library (`crypto/ed25519`, `crypto/ecdh`, `crypto/tls`), which are constant-time implementations (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:3-11`).

### Protocol Security

- [x] **Replay protection** - Each key slot accepts only nonces strictly greater than the last accepted one (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:368`, `:377`, `:403`). Session inits must carry a newer `seq` (`session.go:265`).
- [ ] **Noise Protocol** - The handshake is a custom signed init/ack built on NaCl box (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:467-567`). No Noise code is vendored (`deps/yggdrasil/go-modules/modules.txt`).
- [x] **No cleartext metadata** - Partial: on `tls://` links (used by multicast peering) the TLS 1.3 certificate and the meta record are encrypted (`src/yggdrasil/src/core/tls.go:18`). But `tcp://` links send the public key in the clear meta record (`src/yggdrasil/src/core/version.go:72-74`) and put source and destination keys in every traffic header (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/traffic.go:40-41`). Multicast beacons also broadcast the public key on the LAN (`src/yggdrasil/src/multicast/advertisement.go:17-26`).
- [x] **End-to-end encryption through relays** - Intermediate nodes only see the `traffic` header. The payload is sealed with session keys that only the two endpoints derive (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:325`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:592-605`).

# Performance

## Threading Model

Yggdrasil uses `phony` actors. Each actor is a lock-free message queue that starts a goroutine when work arrives and runs its messages one at a time (`deps/yggdrasil/go-modules/github.com/Arceliar/phony/actor.go:41-54`, `:95-133`). Parallelism comes from different actors running on different cores at the same time. No data-plane stage has a worker pool. The session code has `// TODO? some worker pool to multi-thread this` on both `doSend` and `doRecv` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:300`, `:335`).

**TUN to socket (send).** `(*TunAdapter).read` is one goroutine. It calls wireguard-go `NativeTun.Read` with an 80-byte virtio header offset and up to `BatchSize()` = 128 buffers of 64 KiB (`src/yggdrasil/src/tun/iface.go:9-35`). wireguard-go opens the TUN with `IFF_VNET_HDR`, sets `TUNSETOFFLOAD` for TSO4/TSO6 (plus USO where supported) and splits GSO super-packets with `gsoSplit` (`deps/yggdrasil/go-modules/golang.zx2c4.com/wireguard/tun/tun_linux.go:511-549`, `:566`, `:375-448`). Because the default MTU is 65535, TCP segments are already up to about 64 KiB before any split (inferred from `src/yggdrasil/src/config/defaults_linux.go:22-23`). Each packet then goes through these steps one at a time:

1. `ipv6rwc.writePC` takes a mutex and looks up the key (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:77-82`).
2. `Core.WriteTo` copies the packet into a pooled buffer behind a type byte (`src/yggdrasil/src/core/core.go:214-224`).
3. `encrypted.PacketConn.WriteTo` copies it again (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/packetconn.go:54-72`) and calls `sessionManager.writeTo` through `phony.Block`, so the TUN goroutine waits for the one session-manager actor (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:142-152`).
4. The per-session actor in `doSend` allocates a pooled buffer, copies `nextPub || msg` into a temp buffer and seals it (`session.go:299-332`).
5. `network.PacketConn.WriteTo` copies the payload into a pooled `traffic` record (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/packetconn.go:72-95`).
6. The single router actor runs `pathfinder._handleTraffic`, which also copies every packet into the path cache (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/pathfinder.go:9`, `:194-207`), and then `_lookup`.
7. The per-peer actor sends the packet directly or queues it (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:427-441`).
8. The per-peer writer actor encodes the packet into another pooled buffer and writes it into a default 4 KiB `bufio.Writer`. The buffer is flushed only when the peer queue is empty, which coalesces small messages into larger stream writes (`peers.go:74`, `:187-226`, `:443-454`).
9. The stream is a Go `net.TCPConn` (with `TCP_NODELAY` on by Go default, `deps/yggdrasil/go-stdlib/net/tcpsock.go:289-290`), wrapped in `crypto/tls` for `tls://` links, where TLS encryption runs in the writer actor's goroutine.

**Socket to TUN (receive).** `peer.handler` is one goroutine per link. It reads a uvarint length and the message from a `bufio.Reader` into a pooled buffer, then handles it inside `phony.Block` on the peer actor (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:228-267`). The receive path continues like this:

1. `traffic.decode` copies the payload (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/traffic.go:51-69`), and the router actor forwards it or delivers it locally (`router.go:592-605`).
2. Local delivery goes through a channel of capacity 1 (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/packetconn.go:42`, `:199-221`).
3. The `netManager` read loop copies each packet into a 128 KiB buffer and then into a pooled message (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/network.go:41-80`).
4. The session-manager actor dispatches the packet to the per-session actor, which decrypts and copies the payload once more (`session.go:78-102`, `:432-442`).
5. The result goes through another capacity-1 channel (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/network.go:28-39`) and is copied by `encrypted.PacketConn.ReadFrom`, then by `Core.ReadFrom` (`src/yggdrasil/src/core/core.go:179-212`).
6. `ipv6rwc.readPC` allocates a new 64 KiB slice on every call (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:229`) and copies the packet out.
7. `TunAdapter.queue` pushes the packet into a channel of capacity 128 (`src/yggdrasil/src/tun/tun.go:151`, `iface.go:36-46`).
8. `TunAdapter.write` drains up to 128 queued packets, copies them behind the virtio header and writes them in one batch (`iface.go:48-74`). wireguard-go coalesces TCP/UDP segments with `handleGRO` before the write (`tun_linux.go:335-348`).

Counted from the code, a received packet is copied about eight times between the TCP socket and the TUN. A single flow uses roughly these concurrent stages: the TUN reader, the session actor, the router actor and the peer writer (TLS) on send, and the link reader, router, session and TUN writer on receive. Yggdrasil sets no socket options except `SO_BINDTODEVICE` for interface peers and `SO_REUSEADDR` on the multicast socket (`src/yggdrasil/src/core/link_tcp_linux.go:14-30`, `src/yggdrasil/src/multicast/multicast_unix.go:16-33`).

## Performance Optimizations Checklist

### Threading

- [x] **Multi-threaded processing** - Partial: separate sessions encrypt in separate actors on separate cores, and TLS work runs in per-peer writer actors (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:299-332`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:200-226`). But one session's crypto is serialized in one actor with no worker pool (`session.go:300`), and all traffic passes one router actor (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:583-605`).
- [ ] **Multi-queue TUN / per-core sockets** - The TUN is opened with `IFF_TUN | IFF_NO_PI | IFF_VNET_HDR` and no `IFF_MULTI_QUEUE` (`deps/yggdrasil/go-modules/golang.zx2c4.com/wireguard/tun/tun_linux.go:566`). One goroutine reads it (`src/yggdrasil/src/tun/iface.go:11`), and each peer link is one TCP connection.

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - Partial: only through the opt-in QUIC transport, whose listener and dialer use quic-go's batched `ReadBatch` reads (`src/yggdrasil/src/core/link_quic.go:76`, `deps/yggdrasil/go-modules/github.com/quic-go/quic-go/sys_conn_oob.go:174`). The default links are TCP streams read through `bufio.Reader` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:243-255`).
- [ ] **Batch UDP sends (sendmmsg)** - Sends are TCP stream writes through `bufio.Writer` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:187-198`). There is no UDP data socket on the default path.
- [x] **Large batch sizes (64+)** - TUN reads and writes use batches of `conn.IdealBatchSize` = 128 (`src/yggdrasil/src/tun/iface.go:12-17`, `:48-67`, `deps/yggdrasil/go-modules/golang.zx2c4.com/wireguard/conn/conn.go:19`, `tun/tun_linux.go:537`).

### Offloads

- [x] **UDP GSO** - Partial: only the opt-in `quic://` transport uses `UDP_SEGMENT` through quic-go (`deps/yggdrasil/go-modules/github.com/quic-go/quic-go/sys_conn_helper_linux.go:76-102`). Default links are TCP.
- [ ] **UDP GRO** - No `UDP_GRO` socket option is set in Yggdrasil or in the vendored quic-go (searched `src/yggdrasil/src` and `deps/yggdrasil/go-modules/github.com/quic-go`).
- [x] **TUN offload (virtio-net hdr)** - wireguard-go creates the TUN with `IFF_VNET_HDR` and enables TSO4/TSO6 (and USO if the kernel allows) through `TUNSETOFFLOAD`, with GSO split on read and GRO on write (`deps/yggdrasil/go-modules/golang.zx2c4.com/wireguard/tun/tun_linux.go:511-549`, `:566`, `:348`). Yggdrasil reserves the 80-byte header offset (`src/yggdrasil/src/tun/iface.go:9`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - Hot-path buffers come from `sync.Pool` in Ironwood (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/pool.go:5-35`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/pool.go:5-17`), in the core (`src/yggdrasil/src/core/pool.go:5`) and in the TUN queue (`src/yggdrasil/src/tun/tun.go:187-194`).
- [ ] **Large UDP socket buffers (MB)** - No `SO_RCVBUF`/`SO_SNDBUF` is set anywhere in `src/yggdrasil/src`. Only the opt-in QUIC transport asks for 7 MiB through quic-go (`deps/yggdrasil/go-modules/github.com/quic-go/quic-go/internal/protocol/params.go:6-9`).
- [ ] **Zero-allocation parsing** - `ipv6rwc.readPC` allocates a 64 KiB slice per received packet (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:229`), and each send or receive creates several actor closures (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:299-301`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:592-593`).

### MTU and Peers

- [ ] **Path MTU discovery** - No PMTU probing exists. The node only sends a local ICMPv6 Packet Too Big for packets above its own MTU (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:252-263`). The underlay MTU is handled by TCP.
- [ ] **Endpoint caching** - `findSuitableIP` tries the resolved IPs in order on every dial and keeps no record of the one that worked (`src/yggdrasil/src/core/link.go:693-737`). Only overlay paths are cached, for 1 minute (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/pathfinder.go:93-162`).

### Userspace TCP Stack

- [ ] **Userspace TCP/IP stack** - No userspace stack is vendored (no gVisor or similar in `deps/yggdrasil/go-modules/modules.txt`). Packets go to the kernel TUN (`src/yggdrasil/src/tun/tun_linux.go:20`).

### Data Plane Compression

- [ ] **Tunnel compression** - The send path in `doSend` seals the raw payload with no compression step (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:312-325`).
- [ ] **Configurable compression** - There is no compression option in `NodeConfig` (`src/yggdrasil/src/config/config.go:42-57`).

# Security

## Known Security Issues

None found. The `0.5.12` changelog entry lists no security fixes (`src/yggdrasil/CHANGELOG.md:29-41`). The QUIC denial-of-service fix noted in `0.5.6` predates this version (`CHANGELOG.md:135-153`). No external advisory database was checked, because this analysis is limited to `sources/` (inferred: there may be advisories for vendored modules such as quic-go v0.48.2 that are not recorded in the source tree).

## Potential Security Concerns

1. **Remote crash through a malformed multicast beacon.** `multicastAdvertisement.UnmarshalBinary` slices `b[40:40+dl]`, where `dl` is a 16-bit length from the packet, without checking it against the packet size (`src/yggdrasil/src/multicast/advertisement.go:36-37`). The receive buffer has a capacity of 2048 bytes (`src/yggdrasil/src/multicast/multicast.go:385`). Any `dl` above 2008 makes the slice expression panic in the `listen` goroutine, and no `recover` exists in the code base (searched `src/yggdrasil`). Multicast listening is on by default for all interfaces (`src/yggdrasil/src/config/defaults_linux.go:17-19`), so a single crafted packet to `[ff02::114]:9001` from the local link should terminate the daemon (inferred from code, not tested).
2. **Replayable link authentication.** The meta signature covers only `BLAKE2b-512(password, publicKey)`. It has no nonce and no binding to the TLS channel (`src/yggdrasil/src/core/version.go:80-92`, `:142-153`), and TLS certificates are not verified (`src/yggdrasil/src/core/tls.go:15-29`). Any node that has peered with a victim has received the victim's static meta record, and on `tcp://` a passive observer can capture it too. Replaying the record lets an attacker claim the victim's key on a new link. Both the `?key=` pin and `AllowedPublicKeys` check only that claimed key (`src/yggdrasil/src/core/link.go:637-662`), and the code says this is "a bit of a weak check" (`link.go:637-638`). Ironwood later demands a fresh signed `routerSigRes` (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:324-336`). So the attacker cannot take the victim's tree position, but the attacker may still attract and drop traffic routed toward that key (inferred). End-to-end payload confidentiality is not affected.
3. **Partial-key addressing.** An address holds an 8-bit prefix, an 8-bit count of leading one bits of the inverted key, and the next 112 key bits. A `/64` subnet keeps only 48 key bits after the count (`src/yggdrasil/src/address/address.go:51-114`). Lookups for an address or subnet use only that partial key (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:102`, `:131`). The first answering key that matches the partial key is accepted (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/pathfinder.go:120-150`). Brute-forcing a key that matches a victim's `/64` costs about 2^50 key generations for typical keys, far below the cost of breaking Ed25519, so an attacker could hijack lookups for a victim's subnet (inferred cost).
4. **Greedy routing trusts coordinates.** The Ironwood source warns that a node can advertise the same port to two children and blackhole everything downstream at no cost (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:19-36`).
5. **Unauthenticated source key in the traffic header.** `tr.source` is plain header data (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/traffic.go:40`). A packet with an unknown source makes the receiver send a 193-byte session init to that key (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:127-139`, `:23`). A malicious node can therefore make other nodes send inits to third parties (inferred, low amplification).
6. **Topology and host disclosure.** Any node can query any other node for its nodeinfo, which by default includes build name, version, OS and architecture (`src/yggdrasil/src/core/nodeinfo.go:85-90`), and for its full list of peer keys (`src/yggdrasil/src/core/proto.go:169-181`).
7. **Open by default.** With a listener configured and an empty `AllowedPublicKeys`, any node may peer (`src/yggdrasil/src/core/link.go:652`). Every reachable node can then send IP traffic to the TUN. The config states plainly that `AllowedPublicKeys` "IS NOT A FIREWALL" (`src/yggdrasil/src/config/config.go:51`).
8. **Unauthenticated admin socket.** The admin API can add and remove peers. It listens on a UNIX socket with mode 0660 by default, or on plain TCP if configured, and has no authentication (`src/yggdrasil/src/admin/admin.go:106-122`, `src/yggdrasil/src/config/defaults_linux.go:11`).
9. **Key reuse across primitives.** The same Ed25519 secret is used for signatures and, after conversion, for X25519 key agreement (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/packetconn.go:30-31`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/crypto.go:60-72`). This is a non-standard construction (inferred, no known break).

## Security Features Checklist

### Network Security

- [x] **Handshake rate limiting** - Partial: a node's own path lookups are throttled to one per second per destination (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/config.go:32`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/pathfinder.go:27-33`, `:164-169`), and remote-triggered key rotation is limited to once per minute (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:383`). Inbound link handshakes, session inits and forwarded lookups are not limited (`pathfinder.go:64`).
- [ ] **Stateful packet filter** - No firewall is built in. The session firewall was removed in 0.5 (`src/yggdrasil/CHANGELOG.md:399-402`).
- [ ] **Fine-grained ACLs** - The only access list is `AllowedPublicKeys`, which gates inbound peering links and not traffic (`src/yggdrasil/src/core/link.go:646-662`).
- [ ] **Capability-based access** - There are no tags, groups or certificate attributes. Keys are only compared for equality (`src/yggdrasil/src/core/link.go:653-658`).

### Identity & Authentication

- [x] **Identity validation** - The address is derived from the public key (`src/yggdrasil/src/address/address.go:51`). `readPC` drops packets whose source address does not match the key that sent them (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:274-277`), and session inits are Ed25519-signed (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:550`).
- [ ] **Signed config updates** - There is no authority that distributes config. Each node reads its own local file (`src/yggdrasil/src/config/config.go:92-127`).
- [ ] **Control-server key pinning** - N/A: no control server exists. Peering URIs can pin peer keys with `?key=` (`src/yggdrasil/src/core/link.go:175-187`).

### Implementation

- [x] **Memory-safe language** - The data path is pure Go (`src/yggdrasil/go.mod:3`). The only cgo code is the Apple mobile logger (`src/yggdrasil/contrib/mobile/mobile_apple.go:6-15`).
- [x] **Privilege separation** - The `-user` flag drops to another UID/GID after the TUN and sockets are set up (`src/yggdrasil/cmd/yggdrasil/main.go:71`, `:307-313`, `src/yggdrasil/cmd/yggdrasil/chuser_unix.go:52-58`). The systemd unit limits capabilities to `CAP_NET_ADMIN CAP_NET_BIND_SERVICE` (`src/yggdrasil/contrib/systemd/yggdrasil.service:13`).
- [x] **Sandboxing** - Partial: the binary applies `unveil` only on OpenBSD through `suah.dev/protect` (`src/yggdrasil/cmd/yggdrasil/main.go:51-56`). On Linux, sandboxing comes only from packaging: an AppArmor profile (`src/yggdrasil/contrib/apparmor/usr.bin.yggdrasil`) and systemd `ProtectSystem`/`ProtectHome` (`contrib/systemd/yggdrasil.service:10-11`).
- [x] **Audit logging** - Partial: connects and disconnects are logged at Info (`src/yggdrasil/src/core/link.go:675-689`). Rejected peers (bad password, pinned-key mismatch, not in `AllowedPublicKeys`) are logged only at Debug (`link.go:373`, `:568`), and session decrypt failures are not logged (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:443-448`).

# NAT Traversal

## How NAT Traversal Works

Yggdrasil has no NAT traversal code. There is no STUN, UPnP, NAT-PMP, PCP or hole punching; a case-insensitive search of `src/yggdrasil` and the Ironwood module finds only unrelated matches. A node behind NAT dials outbound stream connections to configured peers (`src/yggdrasil/src/core/link.go:296-399`) and keeps them alive with Ironwood keepalives (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/peers.go:124-178`). Once one link is up, the node joins the global tree, and all traffic to other nodes is forwarded hop by hop by the nodes along the tree path (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:592-605`). Two nodes behind different NATs therefore talk through whatever reachable nodes connect them. They never get a direct path unless one of them accepts inbound connections. The config comment says Yggdrasil "has no concept of bootstrap nodes" and that all traffic will transit peer connections (`src/yggdrasil/src/config/config.go:46`). The generated config has no default peers (`config.go:79`).

## NAT Traversal Checklist

### Discovery

- [x] **No own public node needed** - Partial: any reachable node, including community-run public peers, can join NATed nodes. But the default config has an empty peer list, so such peers must be added by hand (`src/yggdrasil/src/config/config.go:46`, `:79`).
- [ ] **Public endpoint discovery (STUN or reflection)** - No STUN or address-reflection code exists in `src/yggdrasil` or Ironwood, and no protocol message carries an observed endpoint (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/wire.go:7-18`).
- [ ] **Multiple discovery servers** - There are no discovery servers. Peers are only static URIs or multicast neighbours (`src/yggdrasil/src/core/link.go:159-402`).
- [ ] **NAT type detection** - No NAT classification code exists in `src/yggdrasil` or Ironwood.

### Port Mapping

- [ ] **UPnP port mapping** - Not implemented, and no UPnP module is vendored (`deps/yggdrasil/go-modules/modules.txt`).
- [ ] **NAT-PMP support** - Not implemented, and no NAT-PMP module is vendored (`deps/yggdrasil/go-modules/modules.txt`).
- [ ] **PCP support** - Not implemented, and no PCP code exists in `src/yggdrasil`.

### Hole Punching

- [ ] **UDP hole punching** - There is no coordinated simultaneous open. Links are only plain dials and listens (`src/yggdrasil/src/core/link.go:581-602`).
- [ ] **Symmetric NAT handling** - There is no port prediction or similar logic. Dials use the configured host and port as written (`src/yggdrasil/src/core/link.go:693-737`).
- [ ] **Rendezvous coordination** - No message type coordinates a punch. The wire types are only tree, bloom, path and traffic messages (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/wire.go:7-18`).

### Fallback

- [x] **Relay fallback** - Ordinary nodes forward traffic for others whenever no direct link exists, which is the normal routing path (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:592-605`, `:685-752`).
- [x] **Multiple relays** - Any number of peers can be configured, and each node on the tree path forwards (`src/yggdrasil/src/config/config.go:46-47`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:702-708`).
- [x] **Latency-based relay selection** - The next hop minimizes measured link latency per unit of tree progress (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:715-735`, `:221-228`), and the parent choice also weighs latency (`router.go:230-279`, `:424-443`).
- [x] **TCP relay support** - All forwarding links run over TCP by default (`tcp://`, `tls://`, `ws://`, `wss://`) (`src/yggdrasil/src/core/link.go:581-602`).

# Local Routing

## Peer Discovery on LANs

The multicast module is enabled by default for interfaces matching `.*`, with both beacon and listen on (`src/yggdrasil/src/config/defaults_linux.go:17-19`). For each up, multicast-capable, non-point-to-point interface with an IPv6 link-local address (`src/yggdrasil/src/multicast/multicast.go:183-237`, `:149-170`), the node starts a `tls://` listener on the link-local address (`multicast.go:320-339`). It then sends a beacon to `[ff02::114]:9001` with its version, public key, listener port and a BLAKE2b hash of its key keyed with the optional password (`multicast.go:351-366`). The beacon interval grows by one second per beacon up to 15 seconds (`multicast.go:367-370`), plus a random jitter of about one second (`multicast.go:374`). A node that hears a matching beacon dials `tls://[link-local%iface]:port` with `?key=` pinned to the advertised key (`multicast.go:380-454`). Links that were set up locally skip the `AllowedPublicKeys` check (`src/yggdrasil/src/core/link.go:647`, `src/yggdrasil/src/core/api.go:163`).

## Routing Features

The overlay routes only `200::/7`. Each node owns one address and one `/64` in `300::/8` that LAN hosts behind it can use (`src/yggdrasil/src/address/address.go:19-44`, `:101-114`). The TUN is set up with the node address and a `/7` prefix (`src/yggdrasil/src/tun/tun.go:120-124`). Tunnel routing of arbitrary prefixes ("CKR") was removed in 0.5 (`src/yggdrasil/CHANGELOG.md:395-398`). Multi-hop forwarding through ordinary nodes is the core function of Ironwood (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:685-752`). Peer links carry an optional `priority` to choose between parallel links to the same node (`src/yggdrasil/src/core/link.go:188-195`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:727-732`). There is no name resolution.

## Local Routing Checklist

### LAN Discovery

- [x] **Broadcast/multicast discovery** - IPv6 link-local multicast beacons on `[ff02::114]:9001` are on by default for all interfaces (`src/yggdrasil/src/multicast/multicast.go:72`, `src/yggdrasil/src/config/defaults_linux.go:17-19`).
- [x] **Direct path advertisement** - Partial: beacons advertise the node's LAN listener port, and the receiver takes the link-local address from the packet source (`src/yggdrasil/src/multicast/multicast.go:351-358`, `:421-448`). Nodes do not exchange LAN endpoints over the overlay (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/wire.go:7-18`).

### LAN Optimization

- [x] **Automatic LAN preference** - Multicast creates a direct link to a LAN neighbour (`src/yggdrasil/src/multicast/multicast.go:449`). `_lookup` prefers a direct peer, since the peer is the destination at tree distance 0, and weighs link latency (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:715-735`).
- [ ] **Trusted path mode** - End-to-end encryption always runs, even on `tcp://` or local links (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:299-332`).
- [x] **LAN-only mode** - Multicast peering over IPv6 link-local addresses needs no internet or configured peers (`src/yggdrasil/src/multicast/multicast.go:305-372`, `src/yggdrasil/src/config/config.go:79-82`).

### Routing Features

- [x] **Subnet routes** - Partial: each node can route its key-derived `/64` from `300::/8` to hosts behind it (`src/yggdrasil/src/address/address.go:101-114`, `src/yggdrasil/src/ipv6rwc/ipv6rwc.go:305-306`). Arbitrary non-Yggdrasil subnets cannot be advertised, because tunnel routing was removed (`src/yggdrasil/CHANGELOG.md:395-398`).
- [ ] **Full tunnel mode** - There is no exit node or default route. Only destinations inside `200::/7` are accepted (`src/yggdrasil/src/ipv6rwc/ipv6rwc.go:303-309`).
- [x] **Split tunneling** - Only `200::/7` goes to the TUN (`src/yggdrasil/src/tun/tun.go:120-124`). All other traffic uses the normal routes. This is fixed by design and not configurable.
- [ ] **Route priorities** - There is no failover between routers for a subnet. The per-link `priority` only picks between links to the same node (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:727-732`), which does not count.
- [x] **Multi-hop routing via peers** - Every node forwards traffic for others by greedy tree routing (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:592-605`, `:685-752`).
- [ ] **Built-in DNS** - No DNS resolver or name service exists in `src/yggdrasil/src`. Nodeinfo is only queried through the admin API (`src/yggdrasil/src/core/nodeinfo.go`).

# Central Point of Failure

## What Happens When the Tree Root or a Public Peer Fails

Yggdrasil has no controller and no bootstrap nodes (`src/yggdrasil/src/config/config.go:46`). The closest things to central points are the spanning-tree root and the public peers that NATed nodes dial. The root is simply the node with the lowest key. If it disappears, its info times out and the remaining nodes elect the next-lowest key by the same rule (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:230-279`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/config.go:24-25`). End-to-end sessions live only at the two endpoints (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:38-59`), so they survive reconvergence. While paths change, packets can be dropped, which triggers `pathBroken` and a new lookup (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/pathfinder.go:226-251`). If a public peer that was the only link between two NATed nodes fails, those nodes lose contact until another path exists. A direct link between two nodes does not depend on any third party.

## Mitigation Strategies

Configure several peers, ideally including nearby ones, so the tree has redundant paths (`src/yggdrasil/src/config/config.go:46`). Persistent peers redial with backoff (`src/yggdrasil/src/core/link.go:266-284`), and `RetryPeersNow` forces immediate redials (`src/yggdrasil/src/core/core.go:138-147`). Parallel links to the same node give active-backup (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:727-732`). A private network can run its own peers and use `AllowedPublicKeys` to keep others from peering in (`src/yggdrasil/src/core/link.go:646-662`).

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Session state is held only by the endpoints and expires after 1 minute idle (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/encrypted/session.go:20`, `:250-261`). Routing reconverges without any central node (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:89-100`).
- [ ] **Local state caching** - Learned peers, tree state and paths are kept only in memory maps (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:41-63`, `deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/pathfinder.go:12-18`). Only the static config persists.
- [ ] **Cached credentials** - N/A: no controller issues credentials. The node key lives in the local config (`src/yggdrasil/src/config/config.go:43-44`).

### Redundancy

- [x] **Fully self-hostable** - Every node runs the same binary, with no external service (`src/yggdrasil/cmd/yggdrasil/main.go:206-297`).
- [ ] **Controller redundancy** - N/A: there is no controller (`src/yggdrasil/src/config/config.go:46`).
- [x] **Relay redundancy** - Any number of peers can forward at once, and `_lookup` chooses among all closer peers (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/router.go:697-750`).
- [x] **No single root of trust** - There is no CA. Each node's key is self-certifying through its address (`src/yggdrasil/src/address/address.go:51`), and TLS certificates are self-signed and not verified (`src/yggdrasil/src/core/tls.go:15-29`).

# Authentication

## How Nodes Join and Authenticate

There is no enrollment. A node generates an Ed25519 key (`src/yggdrasil/src/config/config.go:203-209`) and gets an address from it. Any node it can open a link to admits it, unless that node restricts inbound peering with `AllowedPublicKeys` (`src/yggdrasil/src/core/link.go:646-662`) or requires a per-link password (`?password=` on the URI, or `Password` on a multicast interface) that both sides must share (`link.go:196-202`, `src/yggdrasil/src/core/version.go:80-92`, `src/yggdrasil/src/multicast/multicast.go:215-232`). Outbound peers can be pinned with `?key=` (`link.go:175-187`). After the link handshake, every node in the network can reach the new node's address.

## Authentication Checklist

### Enrollment Methods

- [x] **Pre-authentication keys** - Partial: an optional per-link password is folded into the signed handshake hash and must match on both sides (`src/yggdrasil/src/core/version.go:80-92`, `:142-153`). It gates a single peering, not network membership.
- [ ] **Certificate-based enrollment** - TLS certificates are self-signed and not verified (`src/yggdrasil/src/core/tls.go:15-29`).
- [ ] **OAuth/OIDC** - There is no enrollment step and no identity-provider code (`src/yggdrasil/src/core/link.go:604-691`).
- [ ] **Interactive login** - There is no login flow. Nodes start from a local config (`src/yggdrasil/cmd/yggdrasil/main.go:106-155`).
- [ ] **CLI authentication** - There is no enrollment step. The CLI only generates or reads configs (`src/yggdrasil/cmd/yggdrasil/main.go:58-72`).

### Authorization

- [x] **Admin approval workflow** - Partial: an admin can pre-approve keys in `AllowedPublicKeys`, but the list only gates inbound peering and skips multicast peers (`src/yggdrasil/src/core/link.go:646-662`, `src/yggdrasil/src/config/config.go:51`).
- [ ] **Automated enrollment rules** - No rule engine exists. Admission is only a key list or password (`src/yggdrasil/src/core/link.go:637-662`).
- [ ] **Ephemeral nodes** - No node registry exists to remove nodes from. State only times out (`deps/yggdrasil/go-modules/github.com/Arceliar/ironwood/network/config.go:25`, `:31`).
- [ ] **Node expiry** - The self-signed certificate is valid until 9999-12-31, and keys never expire (`src/yggdrasil/src/config/config.go:155-156`).

### Identity

- [x] **Stable device identity** - The key is persisted in the config, and the address is derived from it, so the identity survives restarts and underlay address changes (`src/yggdrasil/src/config/config.go:43-44`, `src/yggdrasil/src/address/address.go:51`).
- [x] **Identity portability** - Copying `PrivateKey` or `PrivateKeyPath` (exportable with `-exportkey`) moves the identity and address to another machine (`src/yggdrasil/cmd/yggdrasil/main.go:62`, `:197-203`, `src/yggdrasil/src/config/config.go:129-139`).

# Platform Support

## Supported Platforms

The README lists Linux, macOS, Ubiquiti EdgeRouter, VyOS, Windows, FreeBSD, OpenBSD and OpenWrt (`src/yggdrasil/README.md:15-16`). TUN backends exist for Linux/Android (`src/yggdrasil/src/tun/tun_linux.go`), macOS (`tun_darwin.go`), Windows (`tun_windows.go`, using wintun from `golang.zx2c4.com/wintun`), FreeBSD (`tun_freebsd.go`) and OpenBSD (`tun_openbsd.go`). `contrib/mobile` provides gomobile bindings for iOS (TUN through a passed file descriptor, `contrib/mobile/mobile_apple.go:32-40`) and Android (`contrib/mobile/mobile_android.go`), built by `contrib/mobile/build -i/-a`. The official iOS and Android apps live in separate repositories of the project (inferred, not in `sources/`). Packaging exists for Debian, macOS pkg, Windows MSI, FreeBSD rc, OpenRC, systemd and Docker (`src/yggdrasil/contrib/`).

## Implementation Details

There is one static Go binary, `yggdrasil`, plus the `yggdrasilctl` admin client (`src/yggdrasil/cmd/`). On Linux the TUN is created by wireguard-go's `CreateTUN` with virtio-net offloads and configured through netlink (`src/yggdrasil/src/tun/tun_linux.go:16-68`). The data path runs entirely in userspace. Windows runs as a service through `kardianos/minwinsvc` (`src/yggdrasil/cmd/yggdrasil/main.go:299-305`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - Native TUN through wireguard-go and netlink (`src/yggdrasil/src/tun/tun_linux.go:16-68`), with a systemd unit (`src/yggdrasil/contrib/systemd/yggdrasil.service`).
- [x] **macOS** - utun backend (`src/yggdrasil/src/tun/tun_darwin.go`), launchd plist and pkg builder (`src/yggdrasil/contrib/macos/`).
- [x] **Windows** - wintun backend (`src/yggdrasil/src/tun/tun_windows.go`) and MSI builder (`src/yggdrasil/contrib/msi/build-msi.sh`).
- [x] **FreeBSD/OpenBSD** - TUN backends for both (`src/yggdrasil/src/tun/tun_freebsd.go`, `tun_openbsd.go`) and a FreeBSD rc script (`src/yggdrasil/contrib/freebsd/yggdrasil`).

### Mobile

- [x] **iOS** - In-repo gomobile bindings with fd-based TUN takeover (`src/yggdrasil/contrib/mobile/mobile_apple.go:32-40`, `contrib/mobile/build`). The official app is in a separate project repository (inferred).
- [x] **Android** - In-repo gomobile bindings (`src/yggdrasil/contrib/mobile/mobile_android.go`, `contrib/mobile/mobile.go`). The official app is in a separate project repository (inferred).

### Implementation

- [ ] **Kernel-mode datapath** - All forwarding and crypto run in the Go process. The kernel only provides the TUN device (`src/yggdrasil/src/tun/iface.go:11-74`).
- [x] **Container support** - The repository ships a multi-stage Dockerfile with an entrypoint (`src/yggdrasil/contrib/docker/Dockerfile:1-25`). It still runs as root (`Dockerfile:17-21`).
