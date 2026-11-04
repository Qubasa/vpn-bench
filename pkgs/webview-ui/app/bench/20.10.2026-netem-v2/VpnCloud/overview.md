# Overview

VpnCloud is a peer-to-peer mesh VPN written in Rust by Dennis Schwerdel (`src/vpncloud/Cargo.toml:4`, `src/vpncloud/LICENSE.md:3-4`). The benchmarked tree is tag v2.3.0 plus 11 commits; its `Cargo.toml` already says version 2.4.0 and the changelog lists those changes as "UNRELEASED" (`src/vpncloud/Cargo.toml:3`, `src/vpncloud/CHANGELOG.md:5-9`). Each node is one process. It opens a TUN device (default) or a TAP device and one UDP socket on port 3210 (`src/vpncloud/src/config.rs:12`, `src/vpncloud/src/config.rs:55-64`). Nodes find each other through a list of configured peer addresses and then through gossip of peer lists, and every pair of nodes builds its own direct encrypted UDP session. No server or coordinator exists. Authentication uses Ed25519 key pairs. Each node has either an explicit key pair with a list of trusted public keys, or a shared password from which every node derives the same key pair (`src/vpncloud/src/crypto/common.rs:89-110`). Session keys come from ephemeral X25519 and are rotated every 120 seconds. Payloads are encrypted with an AEAD from the `ring` crate.

At a glance:

- **Language:** Rust, edition 2021, toolchain 1.75.0 (`src/vpncloud/Cargo.toml:11-14`). Crypto comes from `ring` 0.17.8, which is Rust plus BoringSSL-derived C and assembly (`deps/vpncloud/cargo-vendor/ring-0.17.8`).
- **License:** GPL-3.0 or later (`src/vpncloud/LICENSE.md:1-12`, `src/vpncloud/Cargo.toml:5`).
- **Default peer transport:** Direct UDP on port 3210, with an IPv6 dual-stack socket bound to `[::]:3210` (`src/vpncloud/src/net.rs:38-56`). No automatic fallback exists. A WebSocket proxy (`listen: ws://...`) can be configured by hand and carries the same UDP datagrams over TCP (`src/vpncloud/src/main.rs:325-333`, `src/vpncloud/src/wsproxy.rs:50-92`).
- **Data cipher (default):** The cipher is negotiated per peer pair. By default each node offers AES-128-GCM, AES-256-GCM and ChaCha20-Poly1305 (`src/vpncloud/src/crypto/common.rs:30`), benchmarks them at startup (`src/vpncloud/src/crypto/common.rs:116-122`), and the pair picks the algorithm with the highest minimum speed (`src/vpncloud/src/crypto/init.rs:540-565`). On x86-64 with AES-NI this is usually AES-128-GCM (inferred). An opt-in `plain` setting turns encryption off (`src/vpncloud/src/crypto/common.rs:75-77`).
- **Handshake:** A custom 3-message "ping/pong/peng" exchange. Each message is signed with Ed25519, and the two sides do an ephemeral X25519 key agreement. The first bytes of the raw X25519 output become the AEAD key, with no KDF (`src/vpncloud/src/crypto/init.rs:5-55`, `src/vpncloud/src/crypto/init.rs:461-466`).
- **Default tunnel MTU:** The MTU of the default-route interface minus 73 bytes for TUN (1427 on a 1500-byte underlay) or minus 87 bytes for TAP. It is computed in `TunTapDevice::get_overhead`/`set_mtu` (`src/vpncloud/src/device.rs:223-244`) and applied at startup (`src/vpncloud/src/main.rs:151`).
- **Control-plane model:** Fully distributed. Peers gossip peer lists and claimed subnets, and no central or lighthouse role exists.
- **Data-plane threading:** Single-threaded. One epoll loop handles one packet per wakeup (`src/vpncloud/src/cloud.rs:934-969`, `src/vpncloud/src/poll/epoll.rs:54`).

## Key Architecture Components

**Control plane (`GenericCloud`).** The struct `GenericCloud` in `src/vpncloud/src/cloud.rs:70-98` holds all state: peers keyed by UDP socket address, pending handshakes, the reconnect list, the claim table and this node's own addresses. Once per second, `housekeep` (`src/vpncloud/src/cloud.rs:423-481`) expires peers, drives handshake retries and key rotation (`crypto_housekeep`, `src/vpncloud/src/cloud.rs:340-368`), broadcasts a `NodeInfo` message, reconnects configured peers and handles beacons.

**Discovery.** A node starts from the `peers` list (`src/vpncloud/src/main.rs:195-202`). It learns further nodes from the `NodeInfo` peer lists that each peer sends. These lists hold up to 20 random peers, each with its addresses (`src/vpncloud/src/cloud.rs:304-321`). Unknown peers are contacted at once (`connect_to_peers`, `src/vpncloud/src/cloud.rs:692-718`). Optional "beacons" publish a node's own addresses to a file or command and read other nodes' addresses back (`src/vpncloud/src/cloud.rs:483-524`, `src/vpncloud/src/beacon.rs`).

**Transport.** One `std::net::UdpSocket`, using plain `recv_from`/`send_to` (`src/vpncloud/src/net.rs:52-78`). The `Socket` trait can be backed instead by `ProxyConnection`, a WebSocket client to a `vpncloud ws-proxy` relay (`src/vpncloud/src/wsproxy.rs:110-169`).

**Data path.** `handle_interface_data` parses the inner source and destination (an IP header for TUN, a MAC address with an optional VLAN tag for TAP; `src/vpncloud/src/payload.rs:20-117`). It looks up the destination in the `ClaimTable` (`src/vpncloud/src/table.rs:94-116`), encrypts in place and sends one datagram (`src/vpncloud/src/cloud.rs:611-643`). The receive side is `handle_net_message` followed by `handle_payload_from` (`src/vpncloud/src/cloud.rs:747-882`).

**Identity.** A node's long-term identity is an Ed25519 key pair. It comes from a configured private key, or is derived from a password with PBKDF2-HMAC-SHA256 (4096 iterations, fixed salt) (`src/vpncloud/src/crypto/common.rs:21`, `src/vpncloud/src/crypto/common.rs:160-164`). A random 16-byte node ID is generated on every start and is used only to detect duplicate and self connections (`src/vpncloud/src/cloud.rs:133`, `src/vpncloud/src/types.rs:19-21`).

# Protocol

## Control Plane

Control traffic travels inside the same encrypted per-peer session as data, marked by a one-byte message type: `DATA=0`, `NODE_INFO=1`, `KEEPALIVE=2`, `CLOSE=0xff` (`src/vpncloud/src/messages.rs:18-21`). A key rotation message uses type `0x10` and is handled inside the crypto layer (`src/vpncloud/src/crypto/common.rs:23`, `src/vpncloud/src/crypto/common.rs:374-381`). Handshake messages are unencrypted but signed, and start with byte `0xff` (`src/vpncloud/src/crypto/common.rs:22`, `src/vpncloud/src/crypto/common.rs:431-434`).

`NodeInfo` is a tagged-field record. It carries the node ID, up to 20 peers with up to 7 IPv4 and 7 IPv6 addresses each, the subnets the node claims, its peer timeout, and its own addresses (`src/vpncloud/src/messages.rs:32-47`, `src/vpncloud/src/messages.rs:148-200`). It is sent inside the handshake payload and again every `min(keepalive, peer_timeout/2 - 60)` seconds, which is 90 s by default (`src/vpncloud/src/config.rs:343-348`, `src/vpncloud/src/cloud.rs:446-455`). The receiver stores the claims in the claim table and connects to every peer it does not know (`src/vpncloud/src/cloud.rs:720-745`). The `KEEPALIVE` type is handled on receive but never sent in this version (`src/vpncloud/src/cloud.rs:787-790`). The periodic `NodeInfo` serves as the keepalive.

A peer that sends nothing for `peer_timeout` (300 s, `src/vpncloud/src/config.rs:11`) is dropped, and the node tries to reconnect (`src/vpncloud/src/cloud.rs:427-437`). Configured peers are retried every second. After every 10 tries the interval doubles, up to one hour, and DNS names are resolved again every 300 s (`src/vpncloud/src/cloud.rs:370-421`).

Forwarding behavior depends on `mode` (`src/vpncloud/src/cloud.rs:105-113`). In `normal` mode, TUN is routed by claims with no learning or flooding, and TAP behaves as a learning switch. `router` mode uses claims only. `switch` mode learns MAC/IP sources and floods unknown destinations. `hub` mode floods everything.

## Data Plane

Every inner packet or frame becomes exactly one UDP datagram. The wire format is a 1-byte key ID and a 7-byte nonce suffix (`EXTRA_LEN = 8`), then the encrypted 1-byte message type and payload, then a 16-byte tag (`src/vpncloud/src/crypto/core.rs:58-60`, `src/vpncloud/src/crypto/core.rs:158-176`). With an IPv4 outer header the per-packet overhead is 20 + 8 + 8 + 1 + 16 = 53 bytes. The MTU calculation reserves 40 bytes for an IPv6 outer header instead (`src/vpncloud/src/device.rs:223-232`).

On the send side, `handle_device_event` reads one packet from the TUN fd into a 64 KiB `MsgBuffer`, which keeps 100 bytes of headroom (`src/vpncloud/src/cloud.rs:48`, `src/vpncloud/src/cloud.rs:919-925`, `src/vpncloud/src/util.rs:24-35`). `P::parse` extracts the addresses, `ClaimTable::lookup` finds the peer, `PeerCrypto::send_message` prepends the type byte and seals in place, and `send_to` issues one `sendto` (`src/vpncloud/src/cloud.rs:199-221`, `src/vpncloud/src/crypto/common.rs:388-393`). A destination without a claim is dropped in TUN `normal` mode. It is flooded to all peers when broadcasting is on (`src/vpncloud/src/cloud.rs:631-640`).

On the receive side, `recv_from` writes into the same buffer. The peer is found by source address, the packet is opened in place, the type byte is removed, and the payload is written to the TUN fd (`src/vpncloud/src/cloud.rs:822-882`, `src/vpncloud/src/cloud.rs:747-762`). Packets from unknown addresses that are not handshake messages are dropped and counted (`src/vpncloud/src/cloud.rs:864-868`). Peers are identified only by socket address. A peer whose NAT mapping changes looks like a new, unknown sender until a new handshake completes (inferred from `src/vpncloud/src/cloud.rs:861-868`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - Peer traffic uses a `std::net::UdpSocket` bound to port 3210 by default (`src/vpncloud/src/net.rs:52-67`, `src/vpncloud/src/config.rs:64`).
- [x] **Datagram encapsulation (no head-of-line blocking)** - Each TUN read becomes one encrypted `sendto` datagram on the default path (`src/vpncloud/src/cloud.rs:611-621`, `src/vpncloud/src/cloud.rs:199-209`).
- [ ] **TCP fallback** - No automatic switch exists; the only TCP path is the WebSocket proxy, which must be set by hand with `listen: ws://...` (`src/vpncloud/src/main.rs:325-333`).
- [ ] **QUIC support** - No QUIC code or crate is in the source or in `deps/vpncloud/cargo-vendor`.
- [x] **WebSocket support** - The default `websocket` feature adds a `ws-proxy` relay server and a `ws://` client transport, plain WS only, since tungstenite is built without TLS and `as_raw_fd` handles only `MaybeTlsStream::Plain` (`src/vpncloud/Cargo.toml:46-48`, `src/vpncloud/src/wsproxy.rs:94-169`).

### IP Support

- [x] **IPv4 support** - `Packet::parse` handles IPv4 headers, and `--ip` configures an IPv4 address and netmask on the TUN (`src/vpncloud/src/payload.rs:97-106`, `src/vpncloud/src/main.rs:154-158`).
- [x] **IPv6 support** - `Packet::parse` handles IPv6 headers and claims accept IPv6 ranges, but IPv6 addresses on the interface must be set with an `ifup` hook because `ip` is IPv4-only (`src/vpncloud/src/payload.rs:107-114`, `src/vpncloud/src/types.rs:98-126`).
- [x] **Dual-stack** - One TUN/TAP device carries both families, because routing is by claim lookup on either address length (`src/vpncloud/src/payload.rs:92-117`, `src/vpncloud/src/table.rs:94-116`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - TUN is the default device type and routes IP packets by claimed subnets (`src/vpncloud/src/config.rs:55`, `src/vpncloud/src/main.rs:335-338`).
- [x] **Layer 2 (Ethernet) mode** - `type: tap` uses the `Frame` protocol, with MAC learning and VLAN tags (`src/vpncloud/src/payload.rs:18-53`, `src/vpncloud/src/cloud.rs:105-108`).
- [x] **Bridging support** - In TAP/switch mode a node learns source MAC addresses behind each peer and floods unknown ones, so a TAP device added to a Linux bridge (for example from an `ifup` hook) extends a LAN segment (`src/vpncloud/src/cloud.rs:757-760`, `src/vpncloud/src/cloud.rs:631-635`).

### Advanced Protocol Features

- [ ] **Multipath/bonding** - Each peer is one `SocketAddr` entry, and each packet goes to exactly one address (`src/vpncloud/src/cloud.rs:75`, `src/vpncloud/src/cloud.rs:616-621`).
- [ ] **QoS/traffic shaping** - The event loop handles packets in arrival order and has no queue or rate limiting (`src/vpncloud/src/cloud.rs:943-957`).
- [x] **Multicast support** - In TAP `normal`, `switch` and `hub` modes, packets with no claimed destination (broadcast and multicast) are sent to every peer by `broadcast_msg`; TUN `normal` mode drops them (`src/vpncloud/src/cloud.rs:105-113`, `src/vpncloud/src/cloud.rs:631-640`).

# Encryption

## Encryption Layer Details

**Handshake.** The handshake is a custom three-message exchange, ping (A to B), pong (B to A) and peng (A to B), described in `src/vpncloud/src/crypto/init.rs:5-55`. Each message starts with a 4-byte random salt and the first 4 bytes of `SHA256(ed25519_pubkey || salt)`. This lets the receiver pick the sender's key from its trusted list without sending the key itself (`src/vpncloud/src/crypto/init.rs:132-160`, `src/vpncloud/src/crypto/init.rs:294-301`). Then follow type-length-value fields: stage, a 20-byte salted node-ID hash, an X25519 ephemeral public key (ping, pong), the offered algorithms with measured speeds (ping, pong), and an encrypted payload (pong, peng). An Ed25519 signature over all of it comes last (`src/vpncloud/src/crypto/init.rs:291-372`). The receiver drops messages from keys that are not trusted or that have bad signatures (`src/vpncloud/src/crypto/init.rs:158-160`, `src/vpncloud/src/crypto/init.rs:236-240`). If both sides send ping at once, the side with the larger salted node-ID hash takes the responder role (`src/vpncloud/src/crypto/init.rs:578-589`).

**Key derivation.** `derive_master_key` calls `ring::agreement::agree_ephemeral` and passes the first `key_len` bytes of the raw 32-byte X25519 shared secret directly to `UnboundKey::new` (`src/vpncloud/src/crypto/init.rs:461-466`). No HKDF step runs and the transcript is not hashed. Both directions share one key. The nonce space is split by the most significant byte, 0x00 for one side and 0x80 for the other, chosen by comparing salted node-ID hashes (`src/vpncloud/src/crypto/init.rs:610`, `src/vpncloud/src/crypto/core.rs:25-37`, `src/vpncloud/src/crypto/core.rs:112-114`). The node payload in pong and peng is already encrypted with this key (`src/vpncloud/src/crypto/init.rs:478-492`).

**Data cipher.** The cipher is one of `ring`'s `AES_128_GCM`, `AES_256_GCM` or `CHACHA20_POLY1305`, used through `LessSafeKey::seal_in_place_separate_tag` and `open_in_place` with empty AAD (`src/vpncloud/src/crypto/core.rs:158-192`). Selection is speed-based. Each node runs `test_speed` for 0.1 s per algorithm at startup and advertises the result. The chosen algorithm has the largest `min(own_speed, peer_speed)` (`src/vpncloud/src/crypto/common.rs:33-35`, `src/vpncloud/src/crypto/common.rs:116-122`, `src/vpncloud/src/crypto/init.rs:540-565`). If both sides list `plain`, encryption is off even when AEADs are also listed (`src/vpncloud/src/crypto/init.rs:541-543`).

**Nonce and replay.** The send nonce starts at a random 6-byte value and is incremented per packet. Seven bytes are sent on the wire, and the receiver rebuilds the rest (`src/vpncloud/src/crypto/core.rs:77-81`, `src/vpncloud/src/crypto/core.rs:158-176`, `src/vpncloud/src/crypto/core.rs:194-211`). Replays are limited by "nonce pinning". Every second, the highest nonce seen one second earlier plus one becomes the minimum accepted nonce (`src/vpncloud/src/crypto/core.rs:39-42`, `src/vpncloud/src/crypto/core.rs:124-128`, `src/vpncloud/src/crypto/core.rs:178-192`). There is no bitmap, so duplicates inside the 1 to 2 second window are accepted.

**Rekeying.** `RotationState` runs an interleaved X25519 exchange inside the encrypted channel every 120 housekeeping ticks, which is 120 s (`src/vpncloud/src/crypto/common.rs:37`, `src/vpncloud/src/crypto/common.rs:410-424`, `src/vpncloud/src/crypto/rotate.rs:5-30`). Each new key is again the raw ECDH output truncated to the key length (`src/vpncloud/src/crypto/rotate.rs:139-146`, `src/vpncloud/src/crypto/common.rs:332-343`). Four key slots, indexed by a 2-bit key ID, let old and new keys overlap (`src/vpncloud/src/crypto/core.rs:131-136`, `src/vpncloud/src/crypto/core.rs:213-220`).

**Library.** In `ring` 0.17.8, AES uses AES-NI (`HWAES`), or VPAES/BSAES with SSSE3/NEON, or a portable fallback (`deps/vpncloud/cargo-vendor/ring-0.17.8/src/aead/aes.rs:384-424`). AES-GCM on x86-64 with AES-NI and AVX uses the stitched `aesni_gcm_encrypt` assembly (`deps/vpncloud/cargo-vendor/ring-0.17.8/src/aead/aes_gcm.rs:89-117`). ChaCha20 uses assembly on x86, x86-64, ARM and AArch64 (`deps/vpncloud/cargo-vendor/ring-0.17.8/src/aead/chacha.rs:91-120`). X25519 uses the masked fiat-crypto or ADX code and rejects all-zero shared secrets (`deps/vpncloud/cargo-vendor/ring-0.17.8/src/ec/curve25519/x25519.rs:96-158`).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Session and rotation keys come from `ring::agreement::X25519` ephemeral agreements (`src/vpncloud/src/crypto/init.rs:461-476`, `src/vpncloud/src/crypto/rotate.rs:125-146`).
- [x] **Perfect Forward Secrecy** - Every handshake and every 120 s rotation uses fresh `EphemeralPrivateKey`s, and the long-term Ed25519 key only signs (`src/vpncloud/src/crypto/init.rs:426-435`, `src/vpncloud/src/crypto/rotate.rs:174-210`).
- [ ] **Post-quantum readiness** - Only X25519 is used for key agreement, and no KEM exists in the source (`src/vpncloud/src/crypto/init.rs:65`).
- [x] **Key rotation** - `RotationState::cycle` runs every `ROTATE_INTERVAL = 120` seconds and installs new keys through `CryptoCore::rotate_key` (`src/vpncloud/src/crypto/common.rs:37`, `src/vpncloud/src/crypto/common.rs:410-424`).

### Symmetric Encryption

- [x] **Authenticated encryption** - All data uses `ring` AES-GCM or ChaCha20-Poly1305 AEAD with a 16-byte tag, unless both peers opt into `plain` (`src/vpncloud/src/crypto/core.rs:158-192`).
- [x] **Hardware-accelerated crypto** - `ring` 0.17.8 selects AES-NI/ARMv8-CE (`HWAES`) and the `aesni_gcm_encrypt` assembly when available (`deps/vpncloud/cargo-vendor/ring-0.17.8/src/aead/aes.rs:384-405`, `deps/vpncloud/cargo-vendor/ring-0.17.8/src/aead/aes_gcm.rs:89-117`).
- [x] **Constant-time operations** - All primitives come from `ring`, whose BoringSSL-derived code uses masked scalars and `constant_time_*` helpers (`deps/vpncloud/cargo-vendor/ring-0.17.8/src/ec/curve25519/x25519.rs:103`, `deps/vpncloud/cargo-vendor/ring-0.17.8/crypto/curve25519/curve25519.c:725-751`).

### Protocol Security

- [x] **Replay protection** - Partial: per-key "nonce pinning" rejects nonces below last second's maximum, but duplicates inside the 1 to 2 s window are accepted because there is no sliding-window bitmap (`src/vpncloud/src/crypto/core.rs:124-128`, `src/vpncloud/src/crypto/core.rs:178-192`).
- [ ] **Noise Protocol** - The handshake is a custom signed ping/pong/peng exchange, not a Noise pattern (`src/vpncloud/src/crypto/init.rs:5-55`).
- [x] **No cleartext metadata** - Partial: the Ed25519 public key is never sent, only a 4-byte salt and a 4-byte salted hash, but an observer who knows candidate public keys (or guesses the password in password mode) can match and verify the signed handshakes (`src/vpncloud/src/crypto/init.rs:20-26`, `src/vpncloud/src/crypto/init.rs:132-160`).
- [x] **End-to-end encryption through relays** - The only relay, `ws-proxy`, forwards already-encrypted UDP payloads with an address prefix and holds no keys (`src/vpncloud/src/wsproxy.rs:66-84`).

# Performance

## Threading Model

The data plane runs on the main thread in `GenericCloud::run` (`src/vpncloud/src/cloud.rs:934-969`). `EpollWait` registers two fds, the UDP socket and the TUN/TAP fd, for `EPOLLIN` (`src/vpncloud/src/poll/epoll.rs:18-41`). It calls `epoll_wait` with `maxevents = 1` and a 1000 ms timeout (`src/vpncloud/src/poll/epoll.rs:54`, `src/vpncloud/src/cloud.rs:937`). So each wakeup handles exactly one packet. A socket event leads to one `recv_from` (`src/vpncloud/src/net.rs:58-63`), decryption, and one `write` to the TUN fd (`src/vpncloud/src/device.rs:286-292`). A device event leads to one `read` from the TUN fd (`src/vpncloud/src/device.rs:278-284`), encryption, and one `sendto` (`src/vpncloud/src/net.rs:65-67`). Every packet therefore costs three syscalls, `epoll_wait`, a read and a write, and no syscall is batched.

The same thread runs `housekeep` at most once per second (`src/vpncloud/src/cloud.rs:958-968`). That covers peer timeouts, handshake retransmits and key rotation, `NodeInfo` broadcast, reconnects, stats, beacons and UPnP lease renewal. The only extra threads are detached threads for hook scripts and beacon commands (`src/vpncloud/src/config.rs:367-368`, `src/vpncloud/src/beacon.rs:239`, `src/vpncloud/src/beacon.rs:291`). Encryption is never parallelized.

One stack-allocated `MsgBuffer` (a 65535-byte array plus 100 bytes of headroom) is reused for every packet (`src/vpncloud/src/cloud.rs:940`, `src/vpncloud/src/util.rs:24-35`). Header, type byte and tag are written in place around the payload, and AEAD seal and open run in place. So no userspace copy happens on the hot path (`src/vpncloud/src/crypto/core.rs:158-176`, `src/vpncloud/src/crypto/common.rs:388-393`). Each packet also updates two FNV `HashMap` traffic counters (`src/vpncloud/src/cloud.rs:615`, `src/vpncloud/src/cloud.rs:893`, `src/vpncloud/src/traffic.rs:83-104`) and does one FNV lookup in the claim cache (`src/vpncloud/src/table.rs:94-98`). The code sets no socket options, so it uses neither `SO_RCVBUF`/`SO_SNDBUF`, nor `UDP_SEGMENT`/`UDP_GRO`, nor `IFF_VNET_HDR`/`IFF_MULTI_QUEUE`. The TUN is opened with `IFF_TUN | IFF_NO_PI` only (`src/vpncloud/src/device.rs:144-164`). Debug logging on the hot path is skipped at the default `Info` level (`src/vpncloud/src/main.rs:242-248`).

Startup has two costs that affect benchmarks. The crypto speed test takes 0.1 s per algorithm (`src/vpncloud/src/crypto/common.rs:35`). The UPnP gateway search (`port_forwarding` is on by default) blocks for up to the `igd` default 10 s timeout when no router answers (`src/vpncloud/src/config.rs:76`, `src/vpncloud/src/main.rs:177`, `deps/vpncloud/cargo-vendor/igd-0.12.1/src/common/options.rs:28-35`, `deps/vpncloud/cargo-vendor/igd-0.12.1/src/search.rs:27-35`).

## Performance Optimizations Checklist

### Threading

- [ ] **Multi-threaded processing** - One thread runs the whole epoll loop, including all encryption and decryption (`src/vpncloud/src/cloud.rs:934-969`).
- [ ] **Multi-queue TUN / per-core sockets** - The TUN is opened with `IFF_TUN | IFF_NO_PI` only, and only one UDP socket exists (`src/vpncloud/src/device.rs:147-150`, `src/vpncloud/src/main.rs:334`).

### Packet I/O

- [ ] **Batch UDP receives (recvmmsg)** - Each socket event does one `recv_from` (`src/vpncloud/src/net.rs:58-63`).
- [ ] **Batch UDP sends (sendmmsg)** - Each packet is one `send_to` call (`src/vpncloud/src/net.rs:65-67`).
- [ ] **Large batch sizes (64+)** - `epoll_wait` is called with `maxevents = 1` and every read handles one packet (`src/vpncloud/src/poll/epoll.rs:54`).

### Offloads

- [ ] **UDP GSO** - No `UDP_SEGMENT` or other `setsockopt` is called on the socket (`src/vpncloud/src/net.rs:52-56`).
- [ ] **UDP GRO** - No `UDP_GRO` is set, and receives are plain `recv_from` (`src/vpncloud/src/net.rs:58-63`).
- [ ] **TUN offload (virtio-net hdr)** - Neither `IFF_VNET_HDR` nor `TUNSETOFFLOAD` is used, only `TUNSETIFF` with `IFF_TUN|IFF_NO_PI` (`src/vpncloud/src/device.rs:20`, `src/vpncloud/src/device.rs:147-153`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - One preallocated 64 KiB `MsgBuffer` is reused for every received and sent packet; it is a single buffer, not a pool (`src/vpncloud/src/cloud.rs:940`, `src/vpncloud/src/util.rs:24-35`).
- [ ] **Large UDP socket buffers (MB)** - The code never sets `SO_RCVBUF`/`SO_SNDBUF`, so kernel defaults apply (`src/vpncloud/src/net.rs:52-56`).
- [x] **Zero-allocation parsing** - `Packet::parse`/`Frame::parse` read into stack arrays, and decryption and type extraction work in place; hash-map entries are allocated only for new address pairs (`src/vpncloud/src/payload.rs:25-52`, `src/vpncloud/src/crypto/common.rs:361-386`, `src/vpncloud/src/traffic.rs:95-104`).

### MTU and Peers

- [ ] **Path MTU discovery** - The MTU is a static computation from the default-route interface MTU minus overhead, with no probing (`src/vpncloud/src/device.rs:234-244`).
- [x] **Endpoint caching** - Partial: a peer is the socket address its handshake succeeded on, and the claim cache maps inner addresses to it, but alternative endpoints are not ranked or switched (`src/vpncloud/src/cloud.rs:657-669`, `src/vpncloud/src/table.rs:94-116`).

### Userspace TCP Stack

- [ ] **Userspace TCP/IP stack** - Packets go straight between the kernel TUN device and the UDP socket, and no netstack crate is vendored (`src/vpncloud/src/cloud.rs:747-762`).

### Data Plane Compression

- [ ] **Tunnel compression** - Payloads are encrypted as they are, and no compression code or crate exists (`src/vpncloud/src/crypto/common.rs:388-393`).
- [ ] **Configurable compression** - There is no compression to configure (`src/vpncloud/src/config.rs:14-50`).

# Security

## Known Security Issues

None found. The source tree holds no advisory for this version, and no CVE or advisory database could be checked offline. The only CVE the code mentions is CVE-2019-14899, a host-side reverse-path issue that affects VPNs in general. At startup VpnCloud warns when `rp_filter` is not 1 and can fix it with `fix_rp_filter` (`src/vpncloud/src/main.rs:162-169`, `src/vpncloud/src/device.rs:252-266`). The repository runs a cargo-audit workflow, but its results are not part of the sources (`src/vpncloud/.github/workflows/audit.yml`).

## Potential Security Concerns

- **No KDF and no transcript binding.** The raw X25519 output, truncated, becomes the AEAD key (`src/vpncloud/src/crypto/init.rs:461-466`, `src/vpncloud/src/crypto/rotate.rs:139-146`, `src/vpncloud/src/crypto/common.rs:339`). Ping and pong are signed separately, and the key does not depend on the identities or the negotiated algorithm. This is not standard practice and has not been analyzed like Noise or TLS 1.3.
- **Offline password guessing in password mode.** In password mode every node derives the same Ed25519 key with PBKDF2 (4096 iterations, fixed public salt), and by default trusts only that key (`src/vpncloud/src/crypto/common.rs:21`, `src/vpncloud/src/crypto/common.rs:105-110`, `src/vpncloud/src/crypto/common.rs:160-164`). Each handshake packet carries a salt and a 4-byte salted hash of the public key (`src/vpncloud/src/crypto/init.rs:294-301`). A passive observer can test password guesses offline at 4096 PBKDF2 rounds each and confirm a hit with the Ed25519 signature. The interactive wizard defaults to password mode (`src/vpncloud/src/wizard.rs:69`).
- **Replayed ping causes 120 responses (reflection and amplification).** A captured, validly signed ping can be replayed from any spoofed source address. The ping carries no timestamp or cookie, and an unknown source address creates a new `pending_inits` entry and gets a signed pong (`src/vpncloud/src/cloud.rs:829-853`). The pending handshake then repeats its pong every second for up to `MAX_FAILED_RETRIES = 120` seconds (`src/vpncloud/src/crypto/init.rs:84`, `src/vpncloud/src/crypto/init.rs:441-459`, `src/vpncloud/src/cloud.rs:343-351`). Each replay costs the node an Ed25519 verify and sign plus an X25519 operation, and `pending_inits` has no size limit (`src/vpncloud/src/cloud.rs:78`).
- **Weak replay window.** Duplicates inside the 1 to 2 s nonce-pinning window are accepted (`src/vpncloud/src/crypto/core.rs:178-192`). Captured packets can be re-injected within that window.
- **Panic on malformed ECDH keys from trusted peers.** `agree_ephemeral(...).unwrap()` panics when `ring` rejects a public key of the wrong length or a low-order point (`src/vpncloud/src/crypto/init.rs:462-465`, `src/vpncloud/src/crypto/rotate.rs:140-145`, `deps/vpncloud/cargo-vendor/ring-0.17.8/src/ec/curve25519/x25519.rs:104`, `deps/vpncloud/cargo-vendor/ring-0.17.8/src/ec/curve25519/x25519.rs:152-156`). Any holder of a trusted key or the password can crash a node with one signed ping.
- **No inner source validation.** `handle_payload_from` writes decrypted packets to the TUN without checking the inner source address against the sender's claims (`src/vpncloud/src/cloud.rs:747-762`). In TAP/switch mode it also learns that source for the sender (`src/vpncloud/src/cloud.rs:757-760`). Any trusted peer can spoof other nodes' overlay addresses or take over their MAC table entries.
- **Unencrypted mode is silent per pair.** If both ends list `plain`, data has no confidentiality and no integrity, even when AEADs are also listed (`src/vpncloud/src/crypto/init.rs:541-543`, `src/vpncloud/src/crypto/common.rs:345-359`). Only a startup warning is logged (`src/vpncloud/src/crypto/common.rs:112-114`).
- **Log flooding.** Every handshake-looking packet with an unknown key hash is logged at `error` level, without its source address (`src/vpncloud/src/cloud.rs:855-858`, `src/vpncloud/src/cloud.rs:911-914`). Unauthenticated senders can fill the logs.
- **Self-connection check never matches.** `check_salted_node_id_hash` compares the 20-byte hash with a full 32-byte SHA-256 digest computed differently from `InitState::new`, so it is always false (`src/vpncloud/src/crypto/init.rs:403-408`, `src/vpncloud/src/crypto/init.rs:494-500`). Only the exact-equality check and the `own_addresses` filter prevent self connections.
- **Beacons are obfuscated, not authenticated.** Beacon data is XORed with a SHA-512 keystream and protected by a 1-byte check value, which the code says guards only against random changes (`src/vpncloud/src/beacon.rs:96-112`).
- **Runs as root by default.** Privileges are dropped only when `user`/`group` is set (`src/vpncloud/src/main.rs:203-226`). Hook scripts run through `sh -c` with environment variables taken from peers, such as `PEER`, `CLAIMS` and `NODE_ID` (`src/vpncloud/src/config.rs:350-372`, `src/vpncloud/src/cloud.rs:647-656`).

## Security Features Checklist

### Network Security

- [ ] **Handshake rate limiting** - Every handshake from a new source address creates an unbounded `pending_inits` entry with no rate limit or cookie (`src/vpncloud/src/cloud.rs:829-853`).
- [ ] **Stateful packet filter** - Decrypted packets go straight to `device.write` with no connection tracking (`src/vpncloud/src/cloud.rs:747-762`).
- [ ] **Fine-grained ACLs** - The only rules are subnet claims used for routing, with no port or protocol rules (`src/vpncloud/src/table.rs:94-116`).
- [ ] **Capability-based access** - Trust is a flat list of Ed25519 public keys with no tags, groups or attributes (`src/vpncloud/src/crypto/common.rs:52-58`).

### Identity & Authentication

- [x] **Identity validation** - Every handshake message must carry a valid Ed25519 signature from a key in `trusted_keys` (`src/vpncloud/src/crypto/init.rs:150-160`, `src/vpncloud/src/crypto/init.rs:236-240`).
- [ ] **Signed config updates** - Peer lists and claims in `NodeInfo` are accepted from any authenticated peer and are not signed by an authority (`src/vpncloud/src/cloud.rs:720-745`).
- [ ] **Control-server key pinning** - N/A: there is no control server; peers authenticate each other directly with Ed25519 keys (`src/vpncloud/src/crypto/init.rs:142-160`).

### Implementation

- [x] **Memory-safe language** - The data path is Rust; `unsafe` appears only in the ioctl and epoll wrappers and inside `ring`'s C and assembly (`src/vpncloud/src/device.rs:153`, `src/vpncloud/src/poll/epoll.rs:28-54`).
- [x] **Privilege separation** - Setting `user`/`group` makes VpnCloud drop root through `privdrop` or `daemonize` after opening the device and socket; it is off by default (`src/vpncloud/src/main.rs:203-226`).
- [x] **Sandboxing** - Partial: the code has no seccomp, chroot or namespace setup, but the shipped systemd unit sets `PrivateTmp`, `ProtectHome`, `ProtectSystem=strict`, a capability bounding set and a device allow-list (`src/vpncloud/assets/vpncloud@.service:17-23`, `src/vpncloud/src/main.rs:175-231`).
- [x] **Audit logging** - At the default `Info` level, failed handshakes (untrusted key, bad signature) are logged at `error`, and peer connects, disconnects and timeouts at `info`, though the error lines omit the source address (`src/vpncloud/src/cloud.rs:433`, `src/vpncloud/src/cloud.rs:646`, `src/vpncloud/src/cloud.rs:890-916`).

# NAT Traversal

## How NAT Traversal Works

VpnCloud has no STUN, relay or rendezvous servers. NAT traversal comes from address gossip, simultaneous handshakes and UPnP.

1. **Own address collection.** `reset_own_addresses` (every 300 s) collects the configured `advertise_addresses` and the socket's port. It pairs that port with the local IP chosen by routing towards 8.8.8.8 (`get_ip`). If a UPnP mapping exists, it also adds the UPnP internal and external addresses (`src/vpncloud/src/cloud.rs:223-240`, `src/vpncloud/src/net.rs:24-28`, `src/vpncloud/src/net.rs:69-73`).
2. **UPnP.** With the default `nat` feature and `port_forwarding: true`, `PortForwarding::new` searches for an IGD gateway. It requests a UDP mapping for port 3210, then any port, then nearby ports, then random ports. The lease is 1800 s and is renewed one minute before it ends (`src/vpncloud/src/port_forwarding.rs:14-144`, `src/vpncloud/src/main.rs:177`).
3. **Reflection through peers.** When a peer receives `NodeInfo`, it stores the observed source address of the sender first in that peer's address list (`src/vpncloud/src/cloud.rs:724-732`). It then passes this list to others in its own peer list (`src/vpncloud/src/cloud.rs:304-321`). When a node finds its own node ID in a received peer list, it adds those addresses, including its NAT-mapped public address, to `own_addresses` (`src/vpncloud/src/cloud.rs:699-707`).
4. **Hole punching.** Every node that learns of an unknown peer sends handshakes to all of that peer's addresses (`src/vpncloud/src/cloud.rs:692-718`, `src/vpncloud/src/cloud.rs:279-302`). A common peer gossips both nodes to each other, so both ends start handshakes. Each pending handshake is resent every second for up to 120 s (`src/vpncloud/src/crypto/init.rs:441-459`). The attempts therefore overlap and open endpoint-independent NAT mappings (inferred). Crossed pings are resolved by the node-ID tie-break (`src/vpncloud/src/crypto/init.rs:578-589`).
5. **Keeping mappings open.** `NodeInfo` goes to every peer every 90 s by default, and rotation messages every 120 s (`src/vpncloud/src/config.rs:343-348`, `src/vpncloud/src/crypto/common.rs:37`). NATs with shorter idle UDP timeouts can drop idle mappings (inferred).
6. **Beacons.** `beacon.store` and `beacon.load` write and read up to 3 of a node's own addresses through a file or shell command, for example a web or DNS upload, to help nodes find each other without a fixed address (`src/vpncloud/src/cloud.rs:483-524`).

Symmetric NATs are not handled: there is no port prediction and no relay. The only relay is the manually configured WebSocket proxy, which replaces the node's UDP socket with a WebSocket connection to a `ws-proxy` that holds a UDP socket on the node's behalf (`src/vpncloud/src/wsproxy.rs:50-92`).

## NAT Traversal Checklist

### Discovery

- [ ] **No own public node needed** - Nodes bootstrap only from configured `peers` or beacons, so at least one node must be reachable (public or UPnP-mapped); the project runs no public nodes (`src/vpncloud/src/main.rs:195-202`, `src/vpncloud/src/cloud.rs:504-523`).
- [x] **Public endpoint discovery (STUN or reflection)** - Reflection: peers gossip the observed source address of each node, and a node adds addresses listed under its own node ID to `own_addresses`; UPnP also reports the external IP (`src/vpncloud/src/cloud.rs:699-707`, `src/vpncloud/src/cloud.rs:724-732`, `src/vpncloud/src/port_forwarding.rs:45-54`).
- [x] **Multiple discovery servers** - Any number of `peers` can be configured, and every connected peer acts as a reflector and peer-list source (`src/vpncloud/src/config.rs:29`, `src/vpncloud/src/main.rs:195-202`).
- [ ] **NAT type detection** - The code never classifies NAT behavior; it only collects addresses (`src/vpncloud/src/cloud.rs:223-240`).

### Port Mapping

- [x] **UPnP port mapping** - The default `nat` feature uses the `igd` crate to add, renew and remove UDP mappings, and `port_forwarding` defaults to true (`src/vpncloud/Cargo.toml:46-47`, `src/vpncloud/src/port_forwarding.rs:25-151`, `src/vpncloud/src/config.rs:76`).
- [ ] **NAT-PMP support** - Only UPnP IGD through `igd` is implemented (`src/vpncloud/src/port_forwarding.rs:10`).
- [ ] **PCP support** - Only UPnP IGD through `igd` is implemented (`src/vpncloud/src/port_forwarding.rs:10`).

### Hole Punching

- [x] **UDP hole punching** - Both sides learn each other's observed addresses from a common peer and resend handshakes every second for up to 120 s, so the openings overlap; coordination is implicit through gossip, with no timed signal (`src/vpncloud/src/cloud.rs:692-718`, `src/vpncloud/src/crypto/init.rs:441-459`, `src/vpncloud/src/crypto/init.rs:578-589`).
- [ ] **Symmetric NAT handling** - Only gossiped addresses are tried, with no port prediction or port spraying (`src/vpncloud/src/cloud.rs:279-302`).
- [x] **Rendezvous coordination** - Ordinary peers act as rendezvous points by gossiping `NodeInfo` peer lists with observed addresses to all their peers (`src/vpncloud/src/cloud.rs:446-455`, `src/vpncloud/src/cloud.rs:720-745`).

### Fallback

- [ ] **Relay fallback** - No automatic relaying exists, and peers never forward traffic for others; the WebSocket proxy must be chosen in place of UDP by hand (`src/vpncloud/src/cloud.rs:747-762`, `src/vpncloud/src/main.rs:325-333`).
- [ ] **Multiple relays** - A node uses at most one `ws://` proxy URL as its whole transport (`src/vpncloud/src/wsproxy.rs:135-144`).
- [ ] **Latency-based relay selection** - The code has no relay selection at all (`src/vpncloud/src/main.rs:325-333`).
- [x] **TCP relay support** - Partial: `vpncloud ws-proxy` relays a node's UDP traffic over a WebSocket/TCP connection, but it must be deployed and configured by hand and is not a fallback (`src/vpncloud/src/wsproxy.rs:50-108`, `src/vpncloud/src/main.rs:281-284`).

# Local Routing

## Peer Discovery on LANs

VpnCloud sends no LAN broadcast or multicast for discovery. The UPnP SSDP search inside `igd` looks for routers, not peers (`deps/vpncloud/cargo-vendor/igd-0.12.1/src/search.rs:27-31`). Every node advertises its LAN address: the socket's local IP comes from `get_ip()` and is part of `own_addresses` (`src/vpncloud/src/net.rs:69-73`, `src/vpncloud/src/cloud.rs:230-231`). Peers forward these addresses in `NodeInfo`. A node that learns of another peer sends handshakes to all of its addresses, including the LAN one (`src/vpncloud/src/cloud.rs:279-302`). Whichever handshake finishes defines the peer entry. No rule prefers the LAN address. Because peers are keyed by address and each address gets its own handshake, a node can end up with two sessions to the same remote node, one per address (inferred from `src/vpncloud/src/cloud.rs:279-288`, `src/vpncloud/src/cloud.rs:645-669`).

## Routing Features

Routing uses claims. Each node claims subnets (`claims`) and, in TUN mode, auto-claims its interface address as /32 (`src/vpncloud/src/cloud.rs:114-130`). Claims spread through `NodeInfo`. `ClaimTable::lookup` returns the peer with the longest matching prefix and caches the result per destination address (`src/vpncloud/src/table.rs:94-116`). When two peers claim the same prefix, the earlier entry wins. When a peer goes away its claims expire and the other claimant takes over (`src/vpncloud/src/table.rs:80-92`). VpnCloud does not install OS routes. The `ip` option only sets an IPv4 address and netmask, and further routes have to be added through `ifup` or hook scripts (`src/vpncloud/src/main.rs:154-161`). Received packets are written to the local TUN and never forwarded to another peer (`src/vpncloud/src/cloud.rs:747-762`).

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - The code sends no LAN discovery broadcast or multicast; peers come from configuration, gossip or beacons (`src/vpncloud/src/cloud.rs:195-202`).
- [x] **Direct path advertisement** - Each node advertises its local socket address (local IP plus port), UPnP addresses and `advertise_addresses` in `NodeInfo` (`src/vpncloud/src/cloud.rs:223-240`, `src/vpncloud/src/cloud.rs:314-320`).

### LAN Optimization

- [ ] **Automatic LAN preference** - Handshakes go to all known addresses and whichever completes is used; LAN addresses get no priority (`src/vpncloud/src/cloud.rs:296-301`).
- [x] **Trusted path mode** - Partial: listing `plain` in `algorithms` on both ends disables encryption for that pair, but it is a per-node setting, not a per-link trust decision (`src/vpncloud/src/crypto/common.rs:75-77`, `src/vpncloud/src/crypto/init.rs:541-543`).
- [x] **LAN-only mode** - Partial: static `peers` work without internet, but `get_ip()` and `get_internal_ip()` `unwrap()` a UDP connect to 8.8.8.8, which panics on a host with no default route (`src/vpncloud/src/net.rs:24-28`, `src/vpncloud/src/util.rs:203-211`).

### Routing Features

- [x] **Subnet routes** - `claims` lets a node announce arbitrary subnets behind it, and peers route them by longest prefix (`src/vpncloud/src/config.rs:38`, `src/vpncloud/src/table.rs:94-116`).
- [x] **Full tunnel mode** - Partial: a node can claim `0.0.0.0/0` so peers send everything to it, but VpnCloud installs no default route or NAT, so both must be set up by hand with hooks (`src/vpncloud/src/types.rs:167-178`, `src/vpncloud/src/main.rs:159-161`).
- [x] **Split tunneling** - Only traffic the OS routes to the VPN interface is carried, which by default is the configured overlay subnet (`src/vpncloud/src/main.rs:154-158`).
- [x] **Route priorities** - Partial: the longest prefix wins and duplicate claims give implicit failover when a claimant times out, but there are no explicit priorities or metrics (`src/vpncloud/src/table.rs:94-122`).
- [ ] **Multi-hop routing via peers** - Received packets go only to the local device, and the mesh has no forwarding or routing protocol (`src/vpncloud/src/cloud.rs:747-762`).
- [ ] **Built-in DNS** - The source has no DNS resolver or name service (`src/vpncloud/src/main.rs:17-38`).

# Central Point of Failure

## What Happens When the Configured Peers Fail

VpnCloud has no controller. The only special nodes are the addresses in a node's `peers` list or beacon, which serve as bootstrap peers. Once nodes are connected, every pair has its own direct session and its own keys. The failure of a bootstrap peer removes only that peer's sessions and its claims (`src/vpncloud/src/cloud.rs:427-437`). Other sessions keep running and keep rotating keys on their own (`src/vpncloud/src/crypto/common.rs:395-424`). The node keeps retrying configured peers with exponential backoff up to one hour (`src/vpncloud/src/cloud.rs:406-417`). A node that is restarted or new can join again only if at least one of its configured peers, or an address from a beacon, is reachable. Peers it learned earlier through gossip are not saved to disk.

## Mitigation Strategies

- Configure several `peers` per node, including DNS names, which are resolved again every 300 s (`src/vpncloud/src/cloud.rs:389-401`).
- Use beacons (`beacon.store`/`beacon.load`, optionally through commands) so nodes can find each other's current addresses without a fixed bootstrap host (`src/vpncloud/src/cloud.rs:470-474`).
- Use explicit key pairs with per-node `trusted_keys` rather than one shared password. Then a single leaked secret does not compromise the whole network (`src/vpncloud/src/crypto/common.rs:89-110`).

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Sessions are direct peer-to-peer with local keys and rotation, so losing a bootstrap peer drops only its own sessions (`src/vpncloud/src/cloud.rs:423-439`).
- [ ] **Local state caching** - Learned peers are kept only in memory, and beacons store a node's own addresses, not a peer map (`src/vpncloud/src/cloud.rs:483-499`).
- [ ] **Cached credentials** - N/A: there is no controller; credentials are static keys or a password in local config (`src/vpncloud/src/crypto/common.rs:52-58`).

### Redundancy

- [x] **Decentralized control plane** - Nodes start from a local `peers` list and gossip lists of up to 20 peers with their addresses to each other (`src/vpncloud/src/main.rs:195-202`, `src/vpncloud/src/cloud.rs:304-321,720-745`).
- [x] **Fully self-hostable** - All components (nodes, optional `ws-proxy`, beacon storage) run on the user's own machines, and the project has no hosted service (`src/vpncloud/src/main.rs:233-339`).
- [ ] **Controller redundancy** - N/A: the design has no controller, and peers gossip state directly (`src/vpncloud/src/cloud.rs:720-745`).
- [ ] **Relay redundancy** - A node can use only one `ws://` proxy, and mesh nodes do not relay (`src/vpncloud/src/wsproxy.rs:135-144`).
- [x] **No single root of trust** - With explicit key pairs each node trusts a local list of public keys and no CA or server exists; password mode (the wizard default) makes the shared password a single network-wide secret (`src/vpncloud/src/crypto/common.rs:89-110`, `src/vpncloud/src/wizard.rs:69`).

# Authentication

## How Nodes Join and Authenticate

A node joins by having credentials that the other nodes accept. Two configurations exist (`src/vpncloud/src/crypto/common.rs:89-110`):

- **Password mode (wizard default).** `password` is stretched with PBKDF2-HMAC-SHA256 (4096 iterations, fixed salt) into an Ed25519 seed. With no `trusted_keys` set, each node trusts only its own public key, so every node with the same password trusts every other one (`src/vpncloud/src/crypto/common.rs:105-110`, `src/vpncloud/src/crypto/common.rs:160-164`, `src/vpncloud/src/wizard.rs:69-89`).
- **Key mode.** `vpncloud genkey` prints a random (or password-derived) Ed25519 private and public key in base62 (`src/vpncloud/src/main.rs:251-257`, `src/vpncloud/src/crypto/common.rs:137-158`). Each node sets `private-key` and lists the public keys of the nodes it accepts in `trusted-keys` (`src/vpncloud/src/crypto/common.rs:101-104`).

During the handshake each side checks that the other's messages are signed by a trusted key. A failed check aborts the handshake (`src/vpncloud/src/crypto/init.rs:142-160`, `src/vpncloud/src/crypto/init.rs:236-240`). VpnCloud has no enrollment server, no node registry and no expiry. Removing a node means deleting its key from every `trusted_keys` list, or changing the password everywhere.

## Authentication Checklist

### Enrollment Methods

- [x] **Pre-authentication keys** - A shared `password` admits any node that knows it, with no further approval (`src/vpncloud/src/crypto/common.rs:96-110`).
- [ ] **Certificate-based enrollment** - Trust is a flat list of raw Ed25519 public keys, with no CA or certificates (`src/vpncloud/src/crypto/common.rs:101-104`).
- [ ] **OAuth/OIDC** - The source has no identity-provider integration (`src/vpncloud/src/config.rs:375-420`).
- [ ] **Interactive login** - There is no login flow; the interactive `config` wizard only writes a local config file (`src/vpncloud/src/wizard.rs:64-120`).
- [x] **CLI authentication** - The join secret or key can be given on the command line with `--password`, `--private-key` and `--trusted-key`, and `vpncloud genkey` creates keys (`src/vpncloud/src/config.rs:397-415`, `src/vpncloud/src/main.rs:251-257`).

### Authorization

- [x] **Admin approval workflow** - Partial: in key mode an admin approves a node by adding its public key to `trusted_keys` on each node by hand, with no central workflow (`src/vpncloud/src/crypto/common.rs:101-104`).
- [ ] **Automated enrollment rules** - The source has no rule engine; acceptance is only key membership or password knowledge (`src/vpncloud/src/crypto/init.rs:150-160`).
- [ ] **Ephemeral nodes** - No node registry exists; peers that time out are dropped from the session table, but their keys stay trusted (`src/vpncloud/src/cloud.rs:427-437`).
- [ ] **Node expiry** - Keys and passwords never expire, and the code checks no validity period (`src/vpncloud/src/crypto/common.rs:89-135`).

### Identity

- [x] **Stable device identity** - The identity is the Ed25519 key from the config, which survives restarts and address changes; only the 16-byte node ID changes per run (`src/vpncloud/src/crypto/common.rs:89-100`, `src/vpncloud/src/cloud.rs:133`).
- [x] **Identity portability** - The private key is a base62 string in the config file and can be copied to another machine, since nothing binds it to hardware (`src/vpncloud/src/crypto/common.rs:166-179`).

# Platform Support

## Supported Platforms

Only Linux is supported in this tree. The event loop exists only for `target_os = "linux"` and `"android"` (`src/vpncloud/src/poll/mod.rs:5-9`), and the device code opens `/dev/net/tun` and uses Linux ioctls (`src/vpncloud/src/device.rs:144-172`). `device.rs` has BSD and macOS branches for the 4-byte TUN header (`src/vpncloud/src/device.rs:178-221`). Without a `WaitImpl` for those targets, the crate cannot build there (inferred). The README asks for help porting to Windows and macOS (`src/vpncloud/README.md:65-67`). The packaging scripts build Linux `.deb`/`.rpm` and static musl binaries for x86-64, i686, arm64, armhf and armel (`src/vpncloud/maskfile.md:32-124`). The packages include systemd units (`src/vpncloud/Cargo.toml:83-90`).

## Implementation Details

The program is a single static-capable Rust binary. It contains the VPN daemon and the subcommands `genkey`, `migrate-config`, `completion`, `ws-proxy`, `config` (the wizard) and an optional `install` (`src/vpncloud/src/main.rs:249-298`). Default Cargo features are `nat` (UPnP through `igd`), `websocket` (through `tungstenite`) and `wizard` (through `dialoguer`) (`src/vpncloud/Cargo.toml:45-50`). The release profile uses LTO and stripping (`src/vpncloud/Cargo.toml:60-62`). The data path is entirely in userspace and uses no kernel module. Statistics go to a YAML-like stats file or to statsd (`src/vpncloud/src/cloud.rs:526-609`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - The epoll loop, `/dev/net/tun` device and ioctl helpers target Linux, and packages and systemd units are built for it (`src/vpncloud/src/poll/mod.rs:5-9`, `src/vpncloud/src/device.rs:144-172`, `src/vpncloud/Cargo.toml:83-90`).
- [ ] **macOS** - Only TUN header fixups exist; there is no event-loop implementation for macOS, so the crate does not build there (`src/vpncloud/src/device.rs:178-221`, `src/vpncloud/src/poll/mod.rs:5-9`).
- [ ] **Windows** - There is no Windows code; the crate depends on `std::os::unix` and `/dev/net/tun` (`src/vpncloud/src/device.rs:13`, `src/vpncloud/src/device.rs:168-172`).
- [ ] **FreeBSD/OpenBSD** - Only TUN header fixups exist, with no `WaitImpl` for BSD targets (`src/vpncloud/src/device.rs:178-221`, `src/vpncloud/src/poll/mod.rs:5-9`).

### Mobile

- [ ] **iOS** - There is no iOS app or event loop, only a `target_os = "ios"` header fixup (`src/vpncloud/src/device.rs:178-186`).
- [ ] **Android** - `cfg(target_os = "android")` branches exist, but there is no app, no build target in `maskfile.md`, and the daemon would need root for `/dev/net/tun` (`src/vpncloud/src/poll/mod.rs:5-9`, `src/vpncloud/maskfile.md:73-124`).

### Implementation

- [ ] **Kernel-mode datapath** - All packet handling is in the userspace epoll loop (`src/vpncloud/src/cloud.rs:934-969`).
- [ ] **Container support** - There is no official image or Kubernetes integration; the only Dockerfile records asciinema demos (`src/vpncloud/contrib/asciinema-recorder/Dockerfile:1-12`).
