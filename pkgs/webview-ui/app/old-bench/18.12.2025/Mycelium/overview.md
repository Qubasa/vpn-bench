# Overview

Mycelium is an IPv6 overlay network written in Rust by ThreeFold Tech (`src/mycelium/README.md:3`, config path "ThreeFold Tech/Mycelium" at `src/mycelium/README.md:99`, documentation URL in `src/mycelium/systemd/mycelium.service`). This overview describes v0.6.1, rev `a9ba23d7`, built as the `myceliumd` crate (binary `mycelium`) with the `message` feature and without the `private-network` feature (`src/mycelium/myceliumd/Cargo.toml`, `src/mycelium/flake.nix` `sourceRoot = "source/myceliumd"`). The vendored lock file (`src/mycelium/myceliumd/Cargo.lock`) contains no `openssl` crate, which confirms the TLS-PSK private-network code is not compiled in.

Every node owns one X25519 key pair. Its overlay address is a BLAKE3 hash of the public key, mapped into `400::/7` (`src/mycelium/mycelium/src/crypto.rs:112-124`), and it announces the /64 that contains this address (`src/mycelium/mycelium/src/lib.rs:140-155`). Nodes connect to each other over TCP or QUIC links ("peers") that are configured by hand or found by IPv6 link-local multicast. A Babel-derived distance-vector protocol runs over these links and finds routes on demand with route requests (`src/mycelium/mycelium/src/router.rs:853-985`). Data packets are encrypted end to end with AES-256-GCM under a static X25519 shared secret between source and destination node, then forwarded hop by hop through intermediate nodes. Every node can forward for others. There is no controller. The project runs public nodes that users can add as peers.

At a glance:

- **Language:** Rust (workspace `src/mycelium/Cargo.toml`). Mobile glue is a Rust crate called from Flutter, Kotlin or Swift (`src/mycelium/mobile/README.md`).
- **License:** Apache License 2.0 (`src/mycelium/LICENSE:1-3`).
- **Default peer transport:** a reliable byte stream. Plain TCP on port 9651 with Nagle off (`src/mycelium/mycelium/src/peer_manager.rs:499-509`, `src/mycelium/myceliumd/src/main.rs:30`) for `tcp://` peers and for every link-local discovered peer (`src/mycelium/mycelium/src/peer_manager.rs:1161-1169`). QUIC on UDP 9651 with one bidirectional stream (`src/mycelium/mycelium/src/peer_manager.rs:637-641`, `src/mycelium/myceliumd/src/main.rs:32`) for `quic://` peers. QUIC is on by default. There is no automatic switch between QUIC and TCP, but TCP is a default carrier (LAN discovery, and `tcp://` public peers in the shipped unit, `src/mycelium/systemd/mycelium.service:15`), so a node keeps working with UDP blocked. If both endpoints of a peer are configured, both links stay up and routing picks one. QUIC links carry a lower static cost (7/12 vs 10/15, `src/mycelium/mycelium/src/connection.rs:21-32`), so routing tends to prefer QUIC when RTTs are equal (inferred).
- **Data cipher (default):** AES-256-GCM with a random 96-bit nonce per packet (`src/mycelium/mycelium/src/crypto.rs:142-158`). There is no alternative data cipher. QUIC hop links add TLS 1.3 with rustls and ring (AES-256-GCM, AES-128-GCM or ChaCha20-Poly1305, `deps/mycelium/cargo-vendor/rustls-0.23.27/src/crypto/ring/mod.rs:71-75`).
- **Handshake:** none on the data plane. Static-static X25519 ECDH between the two node keys. The raw 32-byte DH output is the AES key without a KDF (`src/mycelium/mycelium/src/crypto.rs:97-99`, `src/mycelium/mycelium/src/crypto.rs:143`). Hop links: none on TCP. TLS 1.3 with ephemeral X25519 on QUIC, where the client skips server certificate checks (`src/mycelium/mycelium/src/peer_manager.rs:1250-1270`).
- **Default tunnel MTU:** 1400, set as `LINK_MTU` in `src/mycelium/mycelium/src/tun/linux.rs:16` and applied in `create_tun_interface` (`src/mycelium/mycelium/src/tun/linux.rs:121`).
- **Control-plane model:** fully distributed (Babel-style routing, no controller, `src/mycelium/mycelium/src/babel.rs:1-5`, `src/mycelium/mycelium/src/router.rs:1806-1810`; optional hosted public nodes as bootstrap peers, `src/mycelium/systemd/mycelium.service:15`).
- **Data-plane threading:** multi-threaded tokio runtime (`src/mycelium/myceliumd/src/main.rs:356`). One TUN task, one encrypt task, one decrypt task, one router forwarding task and one task per peer link. Each direction runs its crypto serially.

## Key Architecture Components

**Control plane (router).** `Router` in `src/mycelium/mycelium/src/router.rs` implements a reduced Babel (RFC 8966) with Hello, IHU, Update, RouteRequest and SeqNoRequest TLVs (`src/mycelium/mycelium/src/babel.rs:1-44`). Hellos go out every 20 s and a peer is dead after 43 s without an IHU (`src/mycelium/mycelium/src/router.rs:34-50`). Link cost is a smoothed Hello/IHU round-trip time in milliseconds plus a static per-transport cost (`src/mycelium/mycelium/src/router.rs:836-848`, `src/mycelium/mycelium/src/peer.rs:267-283`). Since 0.6.0, nodes no longer push all routes. They send a RouteRequest for a /64 when they need it, and the request floods up to 16 generations (`src/mycelium/mycelium/src/router.rs:68`, `src/mycelium/mycelium/src/router.rs:921-984`). The routing table is a left-right, lock-free-read tree bitmap (`src/mycelium/mycelium/src/routing_table.rs:80-152`).

**Discovery (peer manager).** `PeerManager` in `src/mycelium/mycelium/src/peer_manager.rs` connects to static peers from `--peers` or the config file, retries dead ones every 5 s (`src/mycelium/mycelium/src/peer_manager.rs:42`, `src/mycelium/mycelium/src/peer_manager.rs:372-442`) and accepts inbound TCP and QUIC peers. It sends a 50-byte beacon (magic, TCP port, RouterId with the full public key) to `ff02::cafe` on UDP 9650 every 60 s on each interface that has a link-local address (`src/mycelium/mycelium/src/peer_manager.rs:33-40`, `src/mycelium/mycelium/src/peer_manager.rs:1079-1100`). It adds the sender as a TCP peer (`src/mycelium/mycelium/src/peer_manager.rs:1124-1177`).

**Transport.** `Peer::new` wraps any `Connection` (TCP stream, QUIC bidirectional stream, or TLS stream in the private build) in a `tokio_util` `Framed` codec with a 128 KiB buffer (`src/mycelium/mycelium/src/peer.rs:95`). The wire format is a 4-byte packet header followed by a data packet (length, hop limit, source IPv6, destination IPv6, ciphertext) or a Babel control packet (`src/mycelium/mycelium/src/packet.rs:113-127`, `src/mycelium/mycelium/src/packet/data.rs:137-152`). QUIC uses quinn 0.11.7 with datagrams turned off (`src/mycelium/mycelium/src/peer_manager.rs:632-634`, `src/mycelium/mycelium/src/peer_manager.rs:1209-1211`).

**Data path.** `DataPlane` in `src/mycelium/mycelium/src/data.rs` reads IPv6 packets from the TUN device, looks up the cached shared secret of the destination, encrypts, and hands the packet to `Router::route_packet`. That function picks the selected next hop and queues it on that peer's channel (`src/mycelium/mycelium/src/router.rs:1602-1677`). On receive, packets for the local /64 go to `extract_packet_loop`, which decrypts and writes to the TUN device (`src/mycelium/mycelium/src/data.rs:319-372`).

**Identity.** The 32-byte X25519 secret lives in `priv_key.bin` by default and is created with mode 0600 if it does not exist (`src/mycelium/myceliumd/src/main.rs:42`, `src/mycelium/myceliumd/src/main.rs:456-464`, `src/mycelium/myceliumd/src/main.rs:664-676`). The public key determines the overlay address, the RouterId (public key plus 2-byte zone and 6 random bytes, `src/mycelium/mycelium/src/router_id.rs:7-24`) and the data encryption key.

# Protocol

## Control Plane

The control plane is a modified Babel. Each node is a router identified by a `RouterId` that embeds its public key. Hello and IHU TLVs measure link RTT and liveness per peer (`src/mycelium/mycelium/src/router.rs:822-848`, `src/mycelium/mycelium/src/router.rs:1857-1874`). Updates carry subnet, metric, seqno, a hold interval and the RouterId of the origin (`src/mycelium/mycelium/src/babel/update.rs:29-44`). Feasibility uses a Babel source table and seqno requests (`src/mycelium/mycelium/src/router.rs:1265-1292`). A new best route replaces the current one only if it is at least 10 better, or if it is directly connected (`src/mycelium/mycelium/src/router.rs:56-59`, `src/mycelium/mycelium/src/router.rs:1209-1234`).

Nodes only accept updates that pass three filters (`src/mycelium/mycelium/src/lib.rs:157-164`):

- the subnet is inside `400::/7` (`src/mycelium/mycelium/src/filters.rs:21-38`);
- the prefix is /64 or longer (`src/mycelium/mycelium/src/filters.rs:11-19`);
- the subnet contains the address derived from the announcing RouterId's public key, unless it is a retraction (`src/mycelium/mycelium/src/filters.rs:40-53`).

So a node can only originate routes for its own key-derived /64. Updates are not signed. Static routes are re-announced every 300 s (`src/mycelium/mycelium/src/router.rs:39-41`). Routes are pulled with RouteRequest and refreshed when a route used for data is less than 15 s from expiry (`src/mycelium/mycelium/src/router.rs:78`, `src/mycelium/mycelium/src/router.rs:1627-1637`). Update processing runs on `spawn_blocking` workers, by default one (`src/mycelium/mycelium/src/router.rs:726-783`, `src/mycelium/myceliumd/src/main.rs:307`). The update queue holds 1,000,000 entries. When it is full, updates with a non-zero metric are dropped (`src/mycelium/mycelium/src/router.rs:614`, `src/mycelium/mycelium/src/router.rs:644-665`).

A local HTTP API (127.0.0.1:8989) and a JSON-RPC API (127.0.0.1:8990) expose info, peer add and delete, and routes without authentication (`src/mycelium/myceliumd/src/main.rs:36-40`, `src/mycelium/mycelium-api/src/lib.rs:56-63`).

## Data Plane

Inner traffic is IPv6 only. `inject_l3_packet_loop` drops anything that is not IPv6 (`src/mycelium/mycelium/src/data.rs:133-141`). It answers local-subnet misses and sources outside `400::/7` with ICMPv6 (`src/mycelium/mycelium/src/data.rs:154-200`). It writes a 4-byte inner header (version 1, type L3) into the buffer (`src/mycelium/mycelium/src/data.rs:206-208`). `encrypt_and_route_packet` fetches the shared secret only when a selected route exists. Otherwise it sends a route request and returns ICMPv6 no-route (`src/mycelium/mycelium/src/data.rs:240-317`, `src/mycelium/mycelium/src/router.rs:272-314`). Encryption is AES-256-GCM in place with a fresh random nonce. The output is `inner header | ciphertext | 16-byte tag | 12-byte nonce` (`src/mycelium/mycelium/src/crypto.rs:142-158`).

The outer data header carries a 24-bit length, the hop limit and the source and destination overlay addresses in clear (`src/mycelium/mycelium/src/packet/data.rs:137-152`). Intermediate nodes decrement the hop limit and forward on the selected route. They return encrypted out-of-band ICMP on expiry or no route (`src/mycelium/mycelium/src/router.rs:1611-1616`, `src/mycelium/mycelium/src/router.rs:1749-1803`). On the destination, `extract_packet_loop` picks the key from the cleartext source address, decrypts, checks the inner version and type, copies the outer hop limit into the IPv6 header and writes the packet to TUN. Message-type payloads go to the message stack (`src/mycelium/mycelium/src/data.rs:330-385`).

Per-hop overhead is 4 (packet header) + 36 (data header) + 4 (inner header) + 16 (tag) + 12 (nonce) = 72 bytes, plus the TCP/IP or QUIC/UDP/IP headers of the link (`src/mycelium/mycelium/src/packet.rs:13`, `src/mycelium/mycelium/src/packet/data.rs:7`, `src/mycelium/mycelium/src/crypto.rs:21-27`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - Partial: UDP is only used under QUIC (quinn on UDP 9651, `src/mycelium/mycelium/src/peer_manager.rs:1214-1225`); there is no plain-UDP peer transport, `Protocol` is only `Tcp`, `Tls` or `Quic` (`src/mycelium/mycelium/src/endpoint.rs:21-30`).
- [ ] **Datagram encapsulation (no head-of-line blocking)** - Every transport is a reliable ordered stream: TCP, or a single QUIC bidirectional stream with QUIC datagrams disabled (`src/mycelium/mycelium/src/peer_manager.rs:632-641`, `src/mycelium/mycelium/src/connection.rs:42-54`).
- [x] **TCP fallback** - TCP is a default carrier: LAN-discovered peers always use TCP (`src/mycelium/mycelium/src/peer_manager.rs:1161-1169`) and the shipped unit lists `tcp://` public peers next to `quic://` ones (`src/mycelium/systemd/mycelium.service:15`), so connectivity works with UDP blocked without extra per-node setup.
- [x] **QUIC support** - QUIC via quinn 0.11.7 is on by default on UDP 9651 and selected per peer with `quic://` (`src/mycelium/myceliumd/src/main.rs:241-247`, `src/mycelium/mycelium/src/peer_manager.rs:596-683`).
- [ ] **WebSocket support** - No WebSocket transport; `Protocol` has only Tcp, Tls and Quic (`src/mycelium/mycelium/src/endpoint.rs:21-30`).

### IP Support

- [ ] **IPv4 support** - Non-IPv6 packets from TUN are dropped (`src/mycelium/mycelium/src/data.rs:138-141`) and `best_routes` panics on IPv4 (`src/mycelium/mycelium/src/routing_table.rs:141-144`).
- [x] **IPv6 support** - The overlay is IPv6 `400::/7` with a key-derived /64 per node (`src/mycelium/mycelium/src/lib.rs:46-49`, `src/mycelium/mycelium/src/crypto.rs:112-124`).
- [ ] **Dual-stack** - Only IPv6 is carried inside the tunnel (`src/mycelium/mycelium/src/data.rs:138-141`); IPv4 and IPv6 are supported only as underlay for links (`src/mycelium/mycelium/src/connection.rs:56-74`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - TUN device in `IFF_TUN | IFF_NO_PI` mode routing IPv6 packets (`src/mycelium/mycelium/src/tun/linux.rs:118-129`, `deps/mycelium/cargo-vendor/tokio-tun-0.13.2/src/builder.rs:196-199`).
- [ ] **Layer 2 (Ethernet) mode** - No TAP mode is used; `create_tun_interface` never sets `tap` (`src/mycelium/mycelium/src/tun/linux.rs:118-126`).
- [ ] **Bridging support** - No Layer 2 path exists, so LAN devices cannot be bridged (`src/mycelium/mycelium/src/tun/linux.rs:118-126`).

### Advanced Protocol Features

- [x] **Multipath/bonding** - Active-backup across links: fallback routes over other peers or links take over when the selected one dies (`src/mycelium/mycelium/src/router.rs:409-457`); there is no aggregation, each subnet uses one selected next hop (`src/mycelium/mycelium/src/router.rs:1625-1648`).
- [ ] **QoS/traffic shaping** - No priority queues or rate limits; data uses unbounded per-peer channels (`src/mycelium/mycelium/src/peer.rs:74-78`).
- [ ] **Multicast support** - Only unicast routes for `400::/7` /64 subnets exist (`src/mycelium/mycelium/src/filters.rs:11-38`); multicast destinations never match a route (inferred).

# Encryption

## Encryption Layer Details

**Key agreement.** There is no handshake on the data plane. When the router first accepts a route for a subnet, it computes `SecretKey::shared_secret` (X25519 `diffie_hellman` between its static secret and the static public key in the RouterId). It caches the result with the subnet's route list (`src/mycelium/mycelium/src/router.rs:1289-1290`, `src/mycelium/mycelium/src/crypto.rs:97-99`, `src/mycelium/mycelium/src/routing_table.rs:235-241`, `src/mycelium/mycelium/src/routing_table/route_list.rs:19-35`). The 32-byte DH output is converted straight to an `Aes256Gcm` key (`src/mycelium/mycelium/src/crypto.rs:143`). No KDF, salt, context binding or per-direction key is applied. Both directions of a node pair use the same key.

**Cipher.** `aes-gcm` 0.10.3 (`Aes256Gcm`) encrypts in place with empty associated data (`src/mycelium/mycelium/src/crypto.rs:146-149`). The outer source, destination and hop limit are not authenticated. A new cipher object, and so a new AES key schedule, is built for every packet (`src/mycelium/mycelium/src/crypto.rs:146`, `src/mycelium/mycelium/src/crypto.rs:180`).

**Nonce.** `Aes256Gcm::generate_nonce(OsRng)` draws a random 96-bit nonce per packet (`src/mycelium/mycelium/src/crypto.rs:144`). `OsRng` goes through getrandom 0.2.15, which issues one `getrandom(2)` syscall per call on Linux (`deps/mycelium/cargo-vendor/getrandom-0.2.15/src/linux_android_with_fallback.rs:9-17`, `deps/mycelium/cargo-vendor/getrandom-0.2.15/src/util_libc.rs:153-161`).

**Replay and rekeying.** The end-to-end layer has no counter, no replay window and no rekeying. `decrypt` only checks length and the GCM tag (`src/mycelium/mycelium/src/crypto.rs:167-191`). QUIC hop links have quinn's sliding-window packet-number deduplicator and forced key updates (`deps/mycelium/cargo-vendor/quinn-proto-0.11.11/src/connection/spaces.rs:426`, `deps/mycelium/cargo-vendor/quinn-proto-0.11.11/src/connection/packet_builder.rs:46-50`). Plain TCP hop links have neither.

**Hop links.** TCP links are not encrypted. QUIC links run TLS 1.3 from rustls 0.23.27 with the ring provider. Key exchange is ephemeral X25519 first in the list (`deps/mycelium/cargo-vendor/rustls-0.23.27/src/crypto/ring/mod.rs:174-178`). The server uses a fresh self-signed rcgen certificate (`src/mycelium/mycelium/src/peer_manager.rs:1190-1197`) and the client accepts any certificate (`SkipServerVerification`, `src/mycelium/mycelium/src/peer_manager.rs:1250-1270`). The separate `myceliumd-private` binary wraps TCP in OpenSSL TLS 1.3 with an external 32-byte PSK and a network name, and disables QUIC (`src/mycelium/mycelium/src/peer_manager.rs:195-208`, `src/mycelium/mycelium/src/peer_manager.rs:474-497`, `src/mycelium/mycelium/src/peer_manager.rs:688-714`). That binary was not the one benchmarked.

**Implementations.** On x86/x86_64, `aes` 0.8.4 picks AES-NI at runtime through `cpufeatures` (`deps/mycelium/cargo-vendor/aes-0.8.4/src/lib.rs:138-144`, `deps/mycelium/cargo-vendor/aes-0.8.4/src/autodetect.rs:19`). GHASH uses `polyval` 0.6.2 with PCLMULQDQ detection (`deps/mycelium/cargo-vendor/polyval-0.6.2/src/backend/autodetect.rs:19-22`). X25519 is `x25519-dalek` 2.0.1 on `curve25519-dalek` 4.1.3, whose Montgomery ladder uses `subtle` conditional swaps (`deps/mycelium/cargo-vendor/curve25519-dalek-4.1.3/src/montgomery.rs:64-66`, `deps/mycelium/cargo-vendor/curve25519-dalek-4.1.3/src/montgomery.rs:177-183`).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - The data key is X25519 `diffie_hellman` of the static node keys (`src/mycelium/mycelium/src/crypto.rs:97-99`, `src/mycelium/mycelium/src/router.rs:1289`).
- [x] **Perfect Forward Secrecy** - Partial: only per hop on QUIC links, whose TLS 1.3 handshake uses ephemeral keys (`deps/mycelium/cargo-vendor/rustls-0.23.27/src/crypto/ring/kx.rs:43-46`); the end-to-end layer has none, as long-lived `StaticSecret` keys give a DH output that is the AES key for the lifetime of the keys (`src/mycelium/mycelium/src/crypto.rs:41`, `src/mycelium/mycelium/src/crypto.rs:97-99`, `src/mycelium/mycelium/src/crypto.rs:143`).
- [ ] **Post-quantum readiness** - No PQ or hybrid KEM; only X25519 (`src/mycelium/mycelium/src/crypto.rs:32-48`) and the rustls ring groups X25519, P-256, P-384 (`deps/mycelium/cargo-vendor/rustls-0.23.27/src/crypto/ring/mod.rs:177-178`).
- [x] **Key rotation** - Partial: only per hop on QUIC links, where quinn forces a key update when the key phase limit is reached (`deps/mycelium/cargo-vendor/quinn-proto-0.11.11/src/connection/packet_builder.rs:49-50`); the end-to-end shared secret is computed once per subnet entry and cached with no rekey (`src/mycelium/mycelium/src/routing_table.rs:235-241`).

### Symmetric Encryption

- [x] **Authenticated encryption** - AES-256-GCM with a 16-byte tag on every data packet (`src/mycelium/mycelium/src/crypto.rs:142-191`).
- [x] **Hardware-accelerated crypto** - `aes` 0.8.4 uses AES-NI through runtime detection (`deps/mycelium/cargo-vendor/aes-0.8.4/src/lib.rs:138-144`) and `polyval` uses PCLMULQDQ (`deps/mycelium/cargo-vendor/polyval-0.6.2/src/backend/autodetect.rs:19-22`); ring covers QUIC.
- [x] **Constant-time operations** - The AES-NI and CLMUL backends, plus the `subtle`-based X25519 ladder (`deps/mycelium/cargo-vendor/curve25519-dalek-4.1.3/src/montgomery.rs:177-183`), are constant-time implementations.

### Protocol Security

- [x] **Replay protection** - Partial: only per hop on QUIC links, through quinn's sliding-window packet number deduplicator (`deps/mycelium/cargo-vendor/quinn-proto-0.11.11/src/connection/spaces.rs:426`); the end-to-end layer has no counter or window and `decrypt` accepts any valid ciphertext again (`src/mycelium/mycelium/src/crypto.rs:142-191`, `src/mycelium/mycelium/src/data.rs:330-347`).
- [ ] **Noise Protocol** - The design uses no handshake pattern, only static-static DH used directly as a key (`src/mycelium/mycelium/src/crypto.rs:97-99`).
- [x] **No cleartext metadata** - Partial: on QUIC links TLS 1.3 hides headers, but plain TCP links (the default for LAN-discovered and `tcp://` peers) expose key-derived source and destination addresses in every data packet (`src/mycelium/mycelium/src/packet/data.rs:145-148`) and full public keys in Babel updates (`src/mycelium/mycelium/src/router_id.rs:27-33`); LAN beacons also broadcast the RouterId (`src/mycelium/mycelium/src/peer_manager.rs:1079-1082`).
- [x] **End-to-end encryption through relays** - Encryption uses the source and destination node keys before routing; intermediate nodes only forward `raw_data` (`src/mycelium/mycelium/src/data.rs:309-314`, `src/mycelium/mycelium/src/router.rs:1641`).

# Performance

## Threading Model

The daemon runs on a multi-threaded tokio runtime. `#[tokio::main]` (`src/mycelium/myceliumd/src/main.rs:356`) expands to `Builder::new_multi_thread()` (`deps/mycelium/cargo-vendor/tokio-macros-2.5.0/src/entry.rs:414-415`), and the worker count defaults to the number of CPUs (`deps/mycelium/cargo-vendor/tokio-1.44.2/src/loom/std/mod.rs:90-95`). The data path is a chain of single tasks joined by channels.

**Transmit path (TUN to peer):**

1. A single TUN task in `tun::linux::new` selects between reading and writing the one-queue TUN fd (`src/mycelium/mycelium/src/tun/linux.rs:69-109`, `.queues(1)` at `src/mycelium/mycelium/src/tun/linux.rs:122`). Each read is one `read(2)` into a fresh `PacketBuffer` of 1432 bytes (`src/mycelium/mycelium/src/crypto.rs:18-30`, `src/mycelium/mycelium/src/crypto.rs:196-201`). It forwards the buffer on an unbounded channel.
2. `DataPlane::inject_l3_packet_loop`, one task, parses the IPv6 header, fetches the shared secret from the left-right routing table and calls `SharedSecret::encrypt` (`src/mycelium/mycelium/src/data.rs:100-218`). Encryption builds a new AES key schedule, makes one `getrandom` syscall for the nonce and runs AES-GCM in place (`src/mycelium/mycelium/src/crypto.rs:142-158`).
3. `Router::route_packet` then runs inline in the same task and pushes the `DataPacket` onto the next hop's unbounded channel (`src/mycelium/mycelium/src/router.rs:1602-1648`).
4. The per-peer task feeds up to 50 queued packets (`PACKET_COALESCE_WINDOW`) into the `Framed` codec, which copies each one into a 128 KiB `BytesMut`, then flushes (`src/mycelium/mycelium/src/peer.rs:28`, `src/mycelium/mycelium/src/peer.rs:95`, `src/mycelium/mycelium/src/peer.rs:140-206`, `src/mycelium/mycelium/src/packet/data.rs:137-152`).

**Receive path (peer to TUN):**

1. The per-peer task decodes frames. Each data packet costs one heap `Vec` and a copy (`src/mycelium/mycelium/src/packet/data.rs:115-118`).
2. The packet goes on the bounded (1000) router data channel.
3. `handle_incoming_data_packet`, one task, routes it to the node's unbounded TUN channel (`src/mycelium/mycelium/src/router.rs:131`, `src/mycelium/mycelium/src/router.rs:1719-1724`, `src/mycelium/mycelium/src/router.rs:1618-1622`).
4. `extract_packet_loop`, one task, decrypts in place and sends the buffer to the TUN task through a bounded (1000) `PollSender` (`src/mycelium/mycelium/src/data.rs:319-372`, `src/mycelium/mycelium/src/tun/linux.rs:69`).

Encryption for all peers runs serially in one task, and decryption in another. The two directions can run on different cores, but a single flow uses at most about one core per direction for crypto, plus separate cores for peer I/O and the TUN task. There is no `recvmmsg`, GSO or virtio-net header on the TUN or TCP side.

On QUIC links, quinn adds a third layer: TLS 1.3 encryption, Cubic congestion control and a default per-stream receive window of 1.25 MB (`deps/mycelium/cargo-vendor/quinn-proto-0.11.11/src/config/transport.rs:321-354`). Its UDP I/O uses quinn-udp with `recvmmsg` batches of 32 and UDP GSO/GRO up to 64 segments (`deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:456-478`, `deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:767`, `deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:784-798`, `deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:849-867`). All tunnel traffic to one peer shares one QUIC stream or one TCP connection, so inner TCP runs over a reliable stream (inferred head-of-line and nested congestion control effects).

Two pauses can stall the data path:

- **Unknown destination:** when the destination has no route or a pending query, `route_packet` and `get_shared_secret_*` call `block_in_place(std::thread::sleep(100 ms))` and recurse (`src/mycelium/mycelium/src/router.rs:249-268`, `src/mycelium/mycelium/src/router.rs:299-312`, `src/mycelium/mycelium/src/router.rs:1654-1674`). This blocks the encrypt or decrypt loop.
- **QUIC MTU probing:** quinn runs it on the hop link (`src/mycelium/mycelium/src/peer_manager.rs:630`, `src/mycelium/mycelium/src/peer_manager.rs:1207`). The tunnel MTU itself stays fixed at 1400.

## Performance Optimizations Checklist

### Threading

- [x] **Multi-threaded processing** - Partial: tokio multi-thread runtime with separate tasks for encryption (`src/mycelium/mycelium/src/data.rs:82-85`), decryption (`src/mycelium/mycelium/src/data.rs:86-90`) and each peer (`src/mycelium/mycelium/src/peer.rs:101`), but all encryption is serialized in one task and all decryption in another.
- [ ] **Multi-queue TUN / per-core sockets** - The TUN is built with `.queues(1)` (`src/mycelium/mycelium/src/tun/linux.rs:122`), so `IFF_MULTI_QUEUE` is never set (`deps/mycelium/cargo-vendor/tokio-tun-0.13.2/src/linux/interface.rs:36-38`); there is one TCP listener and one QUIC socket (`src/mycelium/mycelium/src/peer_manager.rs:721`, `src/mycelium/mycelium/src/peer_manager.rs:1214`).

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - Partial: only on QUIC links, through quinn-udp `recvmmsg` with up to 32 messages (`deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:456-478`, `deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:767`); TCP links and the TUN device read one buffer at a time (`deps/mycelium/cargo-vendor/tokio-tun-0.13.2/src/linux/io.rs:50-56`).
- [ ] **Batch UDP sends (sendmmsg)** - quinn-udp `send` on Linux calls `libc::sendmsg` with a GSO segment size, never `sendmmsg` (`deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:272-306`); TCP and TUN writes are single `write` calls (`deps/mycelium/cargo-vendor/tokio-tun-0.13.2/src/linux/io.rs:58-64`).
- [x] **Large batch sizes (64+)** - Partial: only QUIC links reach 64, through GSO/GRO segment counts of 64 (`deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:796-797`, `deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:864-865`); `recvmmsg` uses 32 and the peer coalesce window is 50 (`src/mycelium/mycelium/src/peer.rs:28`).

### Offloads

- [x] **UDP GSO** - Partial: quinn-udp sets `UDP_SEGMENT` on QUIC links only (`deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:784-809`); the default TCP transport has no UDP.
- [x] **UDP GRO** - Partial: quinn-udp enables `UDP_GRO` on the QUIC socket only (`deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:128-129`, `deps/mycelium/cargo-vendor/quinn-udp-0.5.10/src/unix.rs:849-867`).
- [ ] **TUN offload (virtio-net hdr)** - tokio-tun opens the device with `IFF_TUN | IFF_NO_PI` only, without `IFF_VNET_HDR` or `TUNSETOFFLOAD` (`deps/mycelium/cargo-vendor/tokio-tun-0.13.2/src/builder.rs:195-201`).

### Buffers and Parsing

- [ ] **Buffer pool reuse** - Every TUN read allocates `PacketBuffer::new()` (`src/mycelium/mycelium/src/tun/linux.rs:76-80`, `src/mycelium/mycelium/src/crypto.rs:196-201`), and every received data packet allocates a `Vec` (`src/mycelium/mycelium/src/packet/data.rs:116`); there is no pool.
- [ ] **Large UDP socket buffers (MB)** - No `SO_RCVBUF`/`SO_SNDBUF` is set in mycelium or quinn-udp (`src/mycelium/mycelium/src/peer_manager.rs:1214-1225`); the 128 KiB `Framed` capacity is a userspace buffer (`src/mycelium/mycelium/src/peer.rs:95`).
- [ ] **Zero-allocation parsing** - `data::Codec::decode` copies each payload into a new `Vec` (`src/mycelium/mycelium/src/packet/data.rs:115-118`), and the OOB ICMP path allocates with `to_vec` (`src/mycelium/mycelium/src/data.rs:438`).

### MTU and Peers

- [x] **Path MTU discovery** - Partial: quinn PMTU probing is enabled on QUIC hop links (`src/mycelium/mycelium/src/peer_manager.rs:630`, `src/mycelium/mycelium/src/peer_manager.rs:1207`), but the tunnel MTU is a fixed 1400 (`src/mycelium/mycelium/src/tun/linux.rs:16`) and TCP links rely on the kernel.
- [ ] **Endpoint caching** - Peers are fixed configured endpoints retried every 5 s (`src/mycelium/mycelium/src/peer_manager.rs:372-442`); there is no per-peer memory of a best endpoint.

### Userspace TCP Stack

- [ ] **Userspace TCP/IP stack** - No smoltcp or netstack dependency; packets go through the kernel TUN device (`src/mycelium/mycelium/src/tun/linux.rs:118-129`).

### Data Plane Compression

- [ ] **Tunnel compression** - Packets are encrypted and framed without any compression step (`src/mycelium/mycelium/src/crypto.rs:142-158`, `src/mycelium/mycelium/src/packet/data.rs:137-152`).
- [ ] **Configurable compression** - No compression option exists in `NodeArguments` (`src/mycelium/myceliumd/src/main.rs:231-317`).

# Security

## Known Security Issues

None found. The source tree contains no CVE or advisory text. The 0.6.1 changelog lists functional fixes only, among them "Fixed an unsoundness issue in the routing table clone implementation", which this version already contains (`src/mycelium/CHANGELOG.md:10-41`, line 28). The vendored crate versions (`src/mycelium/myceliumd/Cargo.lock`) were not checked against an advisory database, because none is available offline.

## Potential Security Concerns

- **No KDF, shared key for both directions, random nonces.** The X25519 output becomes the AES-256-GCM key directly (`src/mycelium/mycelium/src/crypto.rs:97-99`, `src/mycelium/mycelium/src/crypto.rs:143`). Both directions share it, and nonces are random 96-bit values (`src/mycelium/mycelium/src/crypto.rs:144`). Nonce collision risk under one key grows with the total packet count of both directions (birthday bound, inferred). There is no forward secrecy and no rekeying.
- **No replay protection and no header binding.** Associated data is empty (`src/mycelium/mycelium/src/crypto.rs:148`, `src/mycelium/mycelium/src/crypto.rs:182`), and the key is chosen from the cleartext source address (`src/mycelium/mycelium/src/data.rs:332-341`). Any on-path node can replay data packets. It can also send a captured A to B packet back to A with source B. A then decrypts it with the same shared key and delivers its own packet as if it came from B (inferred from code).
- **Plain TCP links by default.** TCP peers, including all LAN-discovered peers, carry Babel control traffic and data headers in clear (`src/mycelium/mycelium/src/peer_manager.rs:568-576`, `src/mycelium/mycelium/src/peer_manager.rs:1161-1169`). A passive observer sees overlay source and destination addresses and public keys. An active attacker on the path can inject or alter routing TLVs.
- **Unsigned routing updates.** The `RouterIdOwnsSubnet` filter (`src/mycelium/mycelium/src/filters.rs:44-53`) only checks that a subnet matches the public key in the update. It does not check that the sender owns that key. Any peer can announce another node's /64 with a high seqno or low metric and black-hole its traffic (inferred). The attacker cannot decrypt the payload.
- **QUIC server identity not verified.** `SkipServerVerification` accepts any certificate (`src/mycelium/mycelium/src/peer_manager.rs:612`, `src/mycelium/mycelium/src/peer_manager.rs:1260-1270`), so QUIC hop links can be intercepted by an active attacker.
- **Open network, no packet filter.** Any host that reaches TCP or QUIC 9651 becomes a peer (`src/mycelium/mycelium/src/peer_manager.rs:721-813`, `src/mycelium/mycelium/src/peer_manager.rs:830-907`). Any overlay node with a route can send packets to the local TUN. Mycelium itself filters nothing (`src/mycelium/mycelium/src/data.rs:330-372`).
- **Blocking sleeps on lookups.** Packets to or from unknown addresses trigger route requests and 100 ms `block_in_place` sleeps that stall the single encrypt or decrypt loop (`src/mycelium/mycelium/src/router.rs:249-268`, `src/mycelium/mycelium/src/router.rs:1654-1674`, `src/mycelium/mycelium/src/data.rs:332-340`). A peer that sends data with many fake source addresses could slow the receive path (inferred).
- **TCP listener can stop.** If `set_nodelay` fails on one accepted socket, the listener task `return`s and accepts no more TCP peers (`src/mycelium/mycelium/src/peer_manager.rs:731-734`).
- **Unauthenticated local API.** HTTP and JSON-RPC on 127.0.0.1 allow peer add and delete and message access without authentication (`src/mycelium/mycelium-api/src/lib.rs:56-63`). Any local user can change the peer set.

## Security Features Checklist

### Network Security

- [x] **Handshake rate limiting** - Partial: inbound QUIC handshakes are capped at 10 concurrent with a 10 s timeout (`src/mycelium/mycelium/src/peer_manager.rs:49-55`, `src/mycelium/mycelium/src/peer_manager.rs:852`, `src/mycelium/mycelium/src/peer_manager.rs:901`), and full Update/SeqNo queues drop TLVs (`src/mycelium/mycelium/src/router.rs:644-683`); TCP accepts are unlimited (`src/mycelium/mycelium/src/peer_manager.rs:725-818`).
- [ ] **Stateful packet filter** - The data plane delivers every decrypted IPv6 packet to TUN without connection tracking (`src/mycelium/mycelium/src/data.rs:358-372`).
- [ ] **Fine-grained ACLs** - No port or protocol rules for tunnel traffic; topic whitelists in `--topic-config` apply only to the message subsystem (`src/mycelium/myceliumd/src/main.rs:310-316`).
- [ ] **Capability-based access** - No tags, groups or certificate attributes exist; identity is only a key-derived address (`src/mycelium/mycelium/src/crypto.rs:112-124`).

### Identity & Authentication

- [x] **Identity validation** - The overlay address is a BLAKE3 hash of the public key (`src/mycelium/mycelium/src/crypto.rs:112-124`), the router only accepts routes whose subnet contains the key-derived address (`src/mycelium/mycelium/src/filters.rs:44-53`), and data only decrypts with that key.
- [ ] **Signed config updates** - Babel Updates carry no signature (`src/mycelium/mycelium/src/babel/update.rs:29-44`), and there is no signed peer list.
- [ ] **Control-server key pinning** - N/A: there is no control server; peers are equals (`src/mycelium/mycelium/src/peer_manager.rs:164-175`).

### Implementation

- [x] **Memory-safe language** - Rust; the core crate has only 5 `unsafe` uses, all in the macOS and Windows TUN code (`src/mycelium/mycelium/src/tun/darwin.rs:268-328`, `src/mycelium/mycelium/src/tun/windows.rs:27`).
- [x] **Privilege separation** - Partial: only through the shipped systemd unit, which bounds capabilities to `CAP_NET_ADMIN` (`src/mycelium/systemd/mycelium.service:11`); the daemon itself never drops privileges (`src/mycelium/myceliumd/src/main.rs:442-551`).
- [x] **Sandboxing** - Partial: only the shipped systemd unit sets `ProtectHome`, `ProtectSystem` and `CapabilityBoundingSet=CAP_NET_ADMIN` (`src/mycelium/systemd/mycelium.service`); the code has no seccomp or similar.
- [x] **Audit logging** - Partial: connection failures log at error level on the first attempt (`src/mycelium/mycelium/src/peer_manager.rs:403-405`), but decryption failures, TLS handshake failures and route filter denials log only at debug or trace (`src/mycelium/mycelium/src/data.rs:343-345`, `src/mycelium/mycelium/src/peer_manager.rs:755-758`, `src/mycelium/mycelium/src/router.rs:1240-1244`).

# NAT Traversal

## How NAT Traversal Works

Mycelium does no NAT traversal in the usual sense. It has no STUN, no hole punching and no port mapping. A node makes outbound TCP or QUIC connections to configured peers (`src/mycelium/mycelium/src/peer_manager.rs:458-683`). Any node that accepts such a connection becomes a hop. Babel routing then carries traffic between two NATed nodes through any chain of nodes that both reach (`src/mycelium/mycelium/src/router.rs:1602-1677`). Route choice follows the metric, which is the sum of measured link RTTs plus static per-transport costs (`src/mycelium/mycelium/src/router.rs:836-848`, `src/mycelium/mycelium/src/router.rs:1209-1234`). The project lists hosted public nodes in five regions in its README (`src/mycelium/README.md:104-124`). The daemon's built-in default peer list is empty (`src/mycelium/myceliumd/src/main.rs:233-235`), but the shipped systemd unit presets the project's public nodes as TCP and QUIC peers (`src/mycelium/systemd/mycelium.service:15`). With that unit, NATed nodes join the mesh through them without running their own public node.

## NAT Traversal Checklist

### Discovery

- [x] **No own public node needed** - The shipped configuration presets project-run public nodes (`src/mycelium/systemd/mycelium.service:15`, `src/mycelium/README.md:104-110`), so NATed nodes join through them; the bare daemon default peer list is empty (`src/mycelium/myceliumd/src/main.rs:233-235`).
- [ ] **Public endpoint discovery (STUN or reflection)** - No STUN client or reflected-address field exists; links are plain outbound connections (`src/mycelium/mycelium/src/peer_manager.rs:499-509`, `src/mycelium/mycelium/src/peer_manager.rs:637-641`).
- [ ] **Multiple discovery servers** - The design has no discovery servers; the static peer list is not a discovery service (`src/mycelium/mycelium/src/peer_manager.rs:213-241`).
- [ ] **NAT type detection** - No NAT classification code exists in `src/mycelium/mycelium/src/peer_manager.rs` or `src/mycelium/mycelium/src/router.rs`.

### Port Mapping

- [ ] **UPnP port mapping** - No UPnP code or crate is used (`src/mycelium/mycelium/Cargo.toml` dependencies).
- [ ] **NAT-PMP support** - No NAT-PMP code or crate is used (`src/mycelium/mycelium/Cargo.toml`).
- [ ] **PCP support** - No PCP code or crate is used (`src/mycelium/mycelium/Cargo.toml`).

### Hole Punching

- [ ] **UDP hole punching** - No simultaneous-open logic; QUIC connects only to configured endpoints (`src/mycelium/mycelium/src/peer_manager.rs:596-683`).
- [ ] **Symmetric NAT handling** - No port prediction or similar (`src/mycelium/mycelium/src/endpoint.rs:32-38`).
- [ ] **Rendezvous coordination** - No node coordinates direct connections between two other nodes; peers exchange only Babel TLVs (`src/mycelium/mycelium/src/babel.rs:35-44`).

### Fallback

- [x] **Relay fallback** - Every node forwards data for others through Babel routes (`src/mycelium/mycelium/src/router.rs:1623-1648`), so NATed nodes reach each other through public or other mesh nodes.
- [x] **Multiple relays** - Any number of peers can be configured, and all forward (`src/mycelium/myceliumd/src/main.rs:233-235`, `src/mycelium/mycelium/src/router.rs:1209-1234`).
- [x] **Latency-based relay selection** - The route metric adds smoothed Hello/IHU RTT per link, and route selection picks the minimum (`src/mycelium/mycelium/src/router.rs:836-848`, `src/mycelium/mycelium/src/peer.rs:276-283`, `src/mycelium/mycelium/src/router.rs:1209-1217`).
- [x] **TCP relay support** - TCP is a default peer transport, so relays are reached over TCP (`src/mycelium/mycelium/src/peer_manager.rs:458-594`, `src/mycelium/mycelium/src/peer_manager.rs:687-823`).

# Local Routing

## Peer Discovery on LANs

Unless `--disable-peer-discovery` is given, `local_discovery` binds UDP 9650 and joins `ff02::cafe` on every up, non-loopback, non-TUN, multicast-capable interface with an `fe80::` address (`src/mycelium/mycelium/src/peer_manager.rs:1002-1060`, `src/mycelium/mycelium/src/peer_manager.rs:1306-1327`). It sends a beacon every 60 s with the magic `mycelium`, its TCP listen port and its RouterId (`src/mycelium/mycelium/src/peer_manager.rs:1079-1102`). Received beacons from `fe80::/64` with the right size and magic, and not from itself, add a TCP (or TLS in the private build) peer at the link-local address and announced port (`src/mycelium/mycelium/src/peer_manager.rs:1124-1177`). Discovered peers are forgotten after 3 failed connection attempts (`src/mycelium/mycelium/src/peer_manager.rs:45`, `src/mycelium/mycelium/src/peer_manager.rs:413-417`).

## Routing Features

Routing is per /64 overlay subnet. Each node originates only its own key-derived /64 (`src/mycelium/mycelium/src/lib.rs:140-165`) and learns other subnets on demand. The TUN device gets the node address with a /7 prefix, so the kernel routes all of `400::/7` into the TUN device and nothing else (`src/mycelium/mycelium/src/tun/linux.rs:48-56`, `src/mycelium/mycelium/src/lib.rs:238-244`). Inner hop limits are decremented per overlay hop (`src/mycelium/mycelium/src/router.rs:1611-1616`). Routes through LAN peers usually win because their measured RTT is lower, and IPv6 links get a lower static cost than IPv4 links (`src/mycelium/mycelium/src/connection.rs:14-32`).

## Local Routing Checklist

### LAN Discovery

- [x] **Broadcast/multicast discovery** - IPv6 link-local multicast beacons to `ff02::cafe` on UDP 9650 (`src/mycelium/mycelium/src/peer_manager.rs:33-40`, `src/mycelium/mycelium/src/peer_manager.rs:1002-1120`).
- [x] **Direct path advertisement** - Partial: a node only advertises its own link-local endpoint (TCP port) in LAN beacons (`src/mycelium/mycelium/src/peer_manager.rs:1079-1082`); endpoints are never shared over the overlay with remote peers.

### LAN Optimization

- [x] **Automatic LAN preference** - Discovered LAN peers are connected directly (`src/mycelium/mycelium/src/peer_manager.rs:1161-1176`), and route selection takes the lowest RTT-based metric (`src/mycelium/mycelium/src/router.rs:1209-1217`), which favors the LAN link.
- [ ] **Trusted path mode** - Every data packet is AES-GCM encrypted regardless of link (`src/mycelium/mycelium/src/data.rs:309-314`).
- [x] **LAN-only mode** - Link-local discovery and static LAN peers work without any internet node (`src/mycelium/mycelium/src/peer_manager.rs:1002-1177`).

### Routing Features

- [x] **Subnet routes** - Partial: each node announces its key-derived /64, which can be routed to hosts behind the node (`src/mycelium/mycelium/src/lib.rs:140-155`, `src/mycelium/mycelium/src/data.rs:154-157`); `RouterIdOwnsSubnet` and `AllowedSubnet` reject any other prefix (`src/mycelium/mycelium/src/lib.rs:157-164`, `src/mycelium/mycelium/src/filters.rs:21-53`).
- [ ] **Full tunnel mode** - Only `400::/7` is routed to TUN, and IPv4 is not carried (`src/mycelium/mycelium/src/tun/linux.rs:48-56`, `src/mycelium/mycelium/src/data.rs:138-141`).
- [x] **Split tunneling** - Only overlay traffic for `400::/7` enters the TUN device; all other traffic stays on the host routes (`src/mycelium/mycelium/src/tun/linux.rs:48-56`). This split is fixed, not configurable.
- [ ] **Route priorities** - A subnet can only be originated by the owner of its key (`src/mycelium/mycelium/src/filters.rs:44-53`), so there is no HA or failover between routers.
- [x] **Multi-hop routing via peers** - Babel-style distance-vector routing forwards packets across any number of mesh hops (`src/mycelium/mycelium/src/router.rs:1602-1677`, route requests up to 16 generations at `src/mycelium/mycelium/src/router.rs:68`).
- [ ] **Built-in DNS** - No DNS code in the `mycelium` crate (`src/mycelium/mycelium/src/lib.rs:21-44` module list).

# Central Point of Failure

## What Happens When a Hosted Public Node Fails

Mycelium has no controller. The only shared infrastructure is the set of hosted public nodes, which the shipped systemd unit presets as ten TCP and QUIC endpoints on several hosts (`src/mycelium/systemd/mycelium.service:15`, `src/mycelium/README.md:104-124`). When one public node goes down, its links die. The router marks the peer dead after 43 s without an IHU, or at once if the stream closes (`src/mycelium/mycelium/src/router.rs:47`, `src/mycelium/mycelium/src/router.rs:381-406`, `src/mycelium/mycelium/src/peer.rs:129-136`). It retracts routes through that peer and runs route selection again, so fallback routes through the other preset public nodes take over (`src/mycelium/mycelium/src/router.rs:409-457`). The README states these nodes are interconnected, so two nodes on different public nodes still reach each other (`src/mycelium/README.md:119-120`). Direct links between nodes are not affected. Traffic only stops if every preset public node and every other common path fails at once. The peer manager keeps retrying static peers every 5 s (`src/mycelium/mycelium/src/peer_manager.rs:421-438`).

## Mitigation Strategies

Configure several public nodes or own nodes as static peers. The README recommends connecting to all public nodes (`src/mycelium/README.md:119-124`). Run an own reachable node, since every node relays. Use LAN discovery for local traffic. Routes are refreshed on demand, so other paths are found automatically (`src/mycelium/mycelium/src/router.rs:1627-1637`).

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - There is no controller; direct peer links keep working and routes fail over to other peers when a public node goes away (`src/mycelium/mycelium/src/router.rs:409-457`).
- [ ] **Local state caching** - Only the key file is persisted (`src/mycelium/myceliumd/src/main.rs:456-464`); peers, discovered endpoints and routes live in memory (`src/mycelium/mycelium/src/peer_manager.rs:164-175`).
- [ ] **Cached credentials** - N/A: there is no controller that issues credentials; the node key is local (`src/mycelium/myceliumd/src/main.rs:456-464`).

### Redundancy

- [x] **Decentralized control plane** - Every node runs the same router and announces routes to its peers with Babel-style updates, with no controller; public nodes are ordinary peers (`src/mycelium/mycelium/src/router.rs:1806,1879`, `src/mycelium/mycelium/src/peer_manager.rs:164-175`).
- [x] **Fully self-hostable** - Every node runs the same daemon; public nodes are ordinary `mycelium` instances that anyone can run (`src/mycelium/mycelium/src/peer_manager.rs:687-907`).
- [ ] **Controller redundancy** - N/A: there is no controller (`src/mycelium/mycelium/src/peer_manager.rs:164-175`).
- [x] **Relay redundancy** - Any number of peers can forward at once, and route selection fails over among them (`src/mycelium/mycelium/src/router.rs:409-457`, `src/mycelium/mycelium/src/router.rs:1209-1234`).
- [x] **No single root of trust** - Identity is each node's own key; no CA or signing authority exists (`src/mycelium/mycelium/src/crypto.rs:84-124`).

# Authentication

## How Nodes Join and Authenticate

There is no enrollment. A node generates a random X25519 key on first start and stores it in `priv_key.bin` (`src/mycelium/myceliumd/src/main.rs:456-464`). Any node that connects over TCP or QUIC becomes a peer without proof of identity (`src/mycelium/mycelium/src/peer_manager.rs:725-813`, `src/mycelium/mycelium/src/peer_manager.rs:852-901`). Its identity only matters for routing filters and end-to-end encryption, which bind the overlay address to the key (`src/mycelium/mycelium/src/filters.rs:44-53`, `src/mycelium/mycelium/src/crypto.rs:112-124`). The public `mycelium` binary always passes `private_network_config: None` (`src/mycelium/myceliumd/src/main.rs:484`, `src/mycelium/myceliumd/src/main.rs:516`). The separate `myceliumd-private` binary adds a private network mode. Nodes there must present a network name and a 32-byte PSK in an OpenSSL TLS 1.3 PSK handshake, and QUIC is disabled (`src/mycelium/myceliumd-private/src/main.rs:291-300`, `src/mycelium/mycelium/src/peer_manager.rs:195-208`, `src/mycelium/mycelium/src/peer_manager.rs:474-497`, `src/mycelium/mycelium/src/peer_manager.rs:688-714`).

## Authentication Checklist

### Enrollment Methods

- [x] **Pre-authentication keys** - Partial: only the separate `myceliumd-private` binary with the `private-network` feature checks a network name and 32-byte PSK in TLS (`src/mycelium/mycelium/src/peer_manager.rs:688-714`, `src/mycelium/myceliumd-private/src/main.rs:291-300`); the benchmarked `mycelium` binary has no such check (`src/mycelium/myceliumd/src/main.rs:484`).
- [ ] **Certificate-based enrollment** - No CA; QUIC certificates are self-signed and not verified (`src/mycelium/mycelium/src/peer_manager.rs:1190-1197`, `src/mycelium/mycelium/src/peer_manager.rs:1260-1270`).
- [ ] **OAuth/OIDC** - No identity provider integration exists (`src/mycelium/mycelium-api/src/lib.rs:56-63`).
- [ ] **Interactive login** - No login flow; the node starts with a local key (`src/mycelium/myceliumd/src/main.rs:456-464`).
- [ ] **CLI authentication** - No enrollment step exists; the CLI only starts the node or queries the local API (`src/mycelium/myceliumd/src/main.rs:442-560`).

### Authorization

- [ ] **Admin approval workflow** - Inbound peers are added without approval (`src/mycelium/mycelium/src/peer_manager.rs:799-812`).
- [ ] **Automated enrollment rules** - No enrollment rules exist; filters only check prefix ranges (`src/mycelium/mycelium/src/filters.rs:11-53`).
- [ ] **Ephemeral nodes** - No node registry exists to remove nodes from; only dead peer links and expired routes are dropped (`src/mycelium/mycelium/src/peer_manager.rs:422-423`).
- [ ] **Node expiry** - Keys never expire (`src/mycelium/mycelium/src/crypto.rs:84-106`).

### Identity

- [x] **Stable device identity** - The key file persists, and the overlay address is derived from it, so identity survives restarts and underlay address changes (`src/mycelium/myceliumd/src/main.rs:456-464`, `src/mycelium/mycelium/src/crypto.rs:112-124`).
- [x] **Identity portability** - Copying the 32-byte key file (`-k/--key-file`, `src/mycelium/myceliumd/src/main.rs:88`, `src/mycelium/myceliumd/src/main.rs:653-662`) moves the identity and address to another machine.

# Platform Support

## Supported Platforms

The core crate has TUN back ends for Linux (tokio-tun with rtnetlink), macOS (a fork of `tun`), Windows (wintun), Android and iOS (TUN fd passed in from the app) (`src/mycelium/mycelium/src/tun.rs:29-54`, `src/mycelium/mycelium/Cargo.toml` target sections). The repository also ships a Windows MSI definition (`src/mycelium/installers/windows/wix/mycelium.wxs`), a systemd unit, a Dioxus desktop UI (`src/mycelium/mycelium-ui/Cargo.toml`) and a `mobile` crate for Flutter, Kotlin and Swift (`src/mycelium/mobile/README.md`). On other operating systems, such as FreeBSD, `Node::new` panics unless `--no-tun` is set (`src/mycelium/mycelium/src/lib.rs:215-224`).

## Implementation Details

The whole data path is in userspace Rust on tokio. The TUN device is created with MTU 1400 on every platform (`src/mycelium/mycelium/src/tun/linux.rs:16`, `src/mycelium/mycelium/src/tun/darwin.rs:25`, `src/mycelium/mycelium/src/tun/windows.rs:11`, `src/mycelium/mycelium/src/tun/android.rs:17`, `src/mycelium/mycelium/src/tun/ios.rs:17`). On Linux the address is set over rtnetlink (`src/mycelium/mycelium/src/tun/linux.rs:43-67`). An optional `SO_MARK` firewall mark can be set on peer sockets on Linux (`src/mycelium/mycelium/src/peer_manager.rs:1230-1243`, `src/mycelium/myceliumd/src/main.rs:293-299`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - tokio-tun TUN plus rtnetlink setup (`src/mycelium/mycelium/src/tun/linux.rs:18-129`).
- [x] **macOS** - utun back end (`src/mycelium/mycelium/src/tun/darwin.rs`) and default TUN name `utun0` (`src/mycelium/myceliumd/src/main.rs:47-49`).
- [x] **Windows** - wintun back end (`src/mycelium/mycelium/src/tun/windows.rs:27-39`) and an MSI installer definition (`src/mycelium/installers/windows/wix/mycelium.wxs`).
- [ ] **FreeBSD/OpenBSD** - No TUN back end; `Node::new` panics unless `--no-tun` is set (`src/mycelium/mycelium/src/lib.rs:215-224`).

### Mobile

- [x] **iOS** - TUN fd back end (`src/mycelium/mycelium/src/tun/ios.rs`) and `mobile` crate entry points for Swift (`src/mycelium/mobile/src/lib.rs`, `src/mycelium/mobile/README.md`).
- [x] **Android** - TUN fd back end (`src/mycelium/mycelium/src/tun/android.rs`) and Android logging in the `mobile` crate (`src/mycelium/mobile/src/lib.rs:16-29`).

### Implementation

- [ ] **Kernel-mode datapath** - All packet processing is in userspace (`src/mycelium/mycelium/src/data.rs:100-372`).
- [ ] **Container support** - No Dockerfile, container image definition or Kubernetes manifest exists in the repository (fd search of `src/mycelium`).
