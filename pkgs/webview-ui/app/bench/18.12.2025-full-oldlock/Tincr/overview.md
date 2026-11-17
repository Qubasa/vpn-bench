# Overview

tincr is a Rust rewrite of the tinc 1.1 mesh VPN daemon. It is developed in the `Mic92/tincr` repository (`src/tincr/README.md:1-9`, `src/tincr/README.md:49-53`). This report covers commit `b234dc798101` (2026-04-20). The workspace has eleven crates: the daemon `tincd`, the `tinc` CLI in `tinc-tools`, and libraries for crypto, SPTPS, the meta protocol, the graph, config parsing, the TUN device and the event loop (`src/tincr/Cargo.toml:1-15`). The nix build compiles only `tincd` and `tinc-tools` (`src/tincr/nix/tincd.nix:34`). The repository also contains a copy of the C tinc sources (`src/tincr/tinc-c/`) and a C FFI crate. Both are used only as test oracles and are not part of the deployed binary (`src/tincr/nix/tincd.nix:31-34`).

tincr speaks tinc's meta protocol 17.7 (`src/tincr/crates/tinc-proto/src/request.rs:138-139`) and its SPTPS protocol, so it can join an existing tinc 1.1 mesh. It removes the legacy RSA protocol completely. A peer without an Ed25519 key or with protocol minor below 2 is rejected (`src/tincr/crates/tincd/src/proto.rs:483-500`). Each node has a name and an Ed25519 key pair. Nodes open authenticated TCP meta connections to the peers named in `ConnectTo` or picked by `AutoConnect`. They flood edges and subnets over these connections. Every node computes its own routes from that graph, so there is no central server. Each pair of nodes that exchanges traffic runs its own SPTPS datagram session. SPTPS uses an ephemeral ECDH key exchange signed with Ed25519 and then sends ChaCha20-Poly1305 records over UDP port 655 (`src/tincr/crates/tincd/src/daemon/settings.rs:340`). Until UDP works, or when UDP is blocked, the same records travel inside the TCP meta connections. Compared with C tinc, tincr adds TUN TSO/GRO offload with UDP GSO batching, an opt-in BitTorrent-DHT rendezvous, a PCP/UPnP-IGD port mapper, a DNS stub, Landlock sandboxing and RTT-based edge weights (`src/tincr/README.md:12-47`).

At a glance:

- **Language:** Rust, edition 2024 (`src/tincr/Cargo.toml:18`). The only C in the binary is the vendored minilzo for LZO decompression (`src/tincr/crates/tincd/minilzo/minilzo.c`, `src/tincr/crates/tincd/build.rs:9-15`, `src/tincr/crates/tincd/src/compress.rs:29-39`).
- **License:** GPL-2.0-or-later, set once for the workspace (`src/tincr/Cargo.toml:19`). There is no separate LICENSE file in the repository root.
- **Default peer transport:** SPTPS datagrams in UDP to port 655, sent directly between peers once a UDP probe has confirmed the path. Before that, and whenever UDP is blocked, records go over the TCP meta connection as `SPTPS_PACKET`, either directly or relayed through other nodes (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:685-716`).
- **Data cipher (default):** ChaCha20-Poly1305 in the OpenSSH/SPTPS layout (64-bit nonce, Poly1305 over the ciphertext only) built from the `chacha20` 0.9 and `poly1305` 0.8 crates (`src/tincr/crates/tinc-crypto/src/chapoly.rs:1-30`). There is no alternative cipher. The legacy tinc 1.0 protocol is compiled out (`src/tincr/crates/tincd/src/proto.rs:481-500`).
- **Handshake:** SPTPS, a custom construction. Each side sends a 32-byte nonce and an ephemeral Curve25519 key, signs both KEX messages plus a label with its Ed25519 key, and derives keys with a TLS 1.0-style PRF over HMAC-SHA512 (`src/tincr/crates/tinc-sptps/src/state.rs:891-1020`, `src/tincr/crates/tinc-crypto/src/prf.rs:1-77`). It is not Noise and not TLS.
- **Default tunnel MTU:** tincd never sets the interface MTU (there is no `SIOCSIFMTU` in `src/tincr/crates/tinc-device/src/linux.rs`), so the kernel's TUN default of 1500 applies unless `tinc-up` changes it (inferred). The internal frame limit is `MTU = 1518` (1500 + 14 Ethernet + 4 VLAN, `src/tincr/crates/tincd/src/tunnel.rs:22-23`). On a 1500-byte IPv4 underlay the per-peer path MTU is seeded at 1439 bytes of inner IP (`src/tincr/crates/tincd/src/daemon/txpath.rs:82-91`).
- **Control-plane model:** fully distributed. Every node floods edges and subnets (`src/tincr/crates/tincd/src/daemon/gossip.rs:755-777`) and computes the graph itself (`src/tincr/crates/tincd/src/daemon/gossip.rs:929-934`).
- **Data-plane threading:** single-threaded. One epoll loop owns the TUN device, all sockets and all state (`src/tincr/crates/tincd/src/daemon.rs:693`). Worker threads only handle DNS lookups, DHT, port mapping and scripts.

## Key Architecture Components

**Control plane (meta protocol).** Nodes exchange tinc's line-based requests (ID, ACK, ADD_EDGE, ADD_SUBNET, REQ_KEY, ANS_KEY, SPTPS_PACKET and others) over TCP. The connection opens with a cleartext `ID name 17.7` line (`src/tincr/crates/tincd/src/proto.rs:510-520`). Then both sides run SPTPS in stream mode with the label `tinc TCP key expansion <initiator> <responder>` (`src/tincr/crates/tincd/src/proto.rs:329-335`, `src/tincr/crates/tincd/src/proto.rs:522-546`). A peer is accepted only if `hosts/<name>` holds its Ed25519 key (`src/tincr/crates/tincd/src/proto.rs:485-490`). Unlike C tinc, tincr refuses REQ_PUBKEY/ANS_PUBKEY, so keys of indirect nodes must also be provisioned by hand (`src/tincr/crates/tincd/src/daemon/gossip.rs:46-53`, `src/tincr/crates/tincd/src/daemon/gossip.rs:404-412`). The `tinc-graph` crate computes a Kruskal MST for broadcasts and a BFS shortest path with weight tie-breaking for `nexthop` and `via` (`src/tincr/crates/tinc-graph/src/lib.rs:1-14`, `src/tincr/crates/tinc-graph/src/lib.rs:493-516`).

**Discovery.** Bootstrap addresses come from `Address` lines in host files, an on-disk cache of addresses that recently worked, edge gossip and DHT records (`src/tincr/crates/tincd/src/addrcache.rs:1-24`). `AutoConnect` is on by default and keeps about three meta connections, plus up to two extra "shortcut" connections to peers that this node relays the most bytes for (`src/tincr/crates/tincd/src/daemon/settings.rs:361`, `src/tincr/crates/tincd/src/autoconnect.rs:1-40`). Relays append the sender's observed UDP address to REQ_KEY and ANS_KEY so both ends can punch (`src/tincr/crates/tincd/src/daemon/gossip.rs:252-300`, `src/tincr/crates/tincd/src/daemon/gossip.rs:668-696`). Optional extras are `DhtDiscovery`, which publishes the node's address as an encrypted, key-blinded BEP 44 record on the public BitTorrent DHT (`src/tincr/crates/tincd/src/discovery.rs:1-60`), and `UPnP`, which maps ports with PCP or UPnP-IGD (`src/tincr/crates/tincd/src/portmap/mod.rs:1-24`). Both are off by default (`src/tincr/crates/tincd/src/daemon/settings.rs:374-376`).

**Transport.** One TCP listener and one UDP socket per listen address, both on port 655, IPv4 and IPv6 (`src/tincr/crates/tincd/src/daemon/settings.rs:340-341`). A UDP datagram is a 6-byte destination ID, a 6-byte source ID, a 4-byte sequence number, the encrypted record type and payload, and a 16-byte tag (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:719-737`, `src/tincr/crates/tinc-sptps/src/lib.rs:54-56`). The IDs are the first 6 bytes of SHA-512 of the node name (`src/tincr/crates/tincd/src/node_id.rs:55-56`). On Linux, sends use one `sendmsg` with a `UDP_SEGMENT` control message per batch (`src/tincr/crates/tincd/src/egress/linux.rs:110-114`), and receives use `recvmmsg` with 64 slots (`src/tincr/crates/tincd/src/daemon/net/rx.rs:196-235`).

**Data path.** A Linux TUN device opened with `IFF_TUN | IFF_NO_PI | IFF_VNET_HDR` and `TUNSETOFFLOAD(CSUM|TSO4|TSO6)` (`src/tincr/crates/tinc-device/src/linux.rs:132-177`, `src/tincr/crates/tinc-device/src/linux.rs:481-482`), a userspace TSO splitter and TCP GRO coalescer (`src/tincr/crates/tinc-device/src/tso.rs:354`, `src/tincr/crates/tinc-device/src/tso.rs:601`), an IPv4/IPv6/ARP/NDP router over a subnet trie (`src/tincr/crates/tincd/src/route.rs:91-356`), and per-peer SPTPS datagram sessions. `Mode = switch` or `hub` uses a TAP device without the offload header (`src/tincr/crates/tinc-device/src/linux.rs:132-135`).

**Identity.** A node name plus an Ed25519 public key stored in `hosts/<name>` (`src/tincr/crates/tincd/src/daemon/gossip.rs:46-53`). The same key signs SPTPS handshakes (`src/tincr/crates/tinc-sptps/src/state.rs:922-935`). `tinc invite` and `tinc join` enroll new nodes with a single-use cookie and an invitation key whose hash is in the URL (`src/tincr/crates/tinc-tools/src/cmd/invite.rs:1-30`, `src/tincr/crates/tinc-tools/src/cmd/join.rs:1-30`).

# Protocol

## Control Plane

The meta protocol runs over TCP. The initiator sends `0 <name> 17.7` in clear text and the responder answers with its own ID line (`src/tincr/crates/tincd/src/proto.rs:510-520`). `handle_id` checks the name, refuses a peer that claims our own name, checks that an outgoing peer has the expected name, and loads the peer's Ed25519 key from `hosts/<name>` (`src/tincr/crates/tincd/src/proto.rs:438-490`). Protocol minor values below 2 are treated as a rollback and rejected (`src/tincr/crates/tincd/src/proto.rs:492-500`). The rest of the connection is an SPTPS stream session. Each record has a 2-byte cleartext length, then the type and body encrypted with ChaCha20-Poly1305 (`src/tincr/crates/tinc-sptps/src/state.rs:471-514`). The ID handler also serves two other greetings: `^cookie` for the local control socket only, and `?pubkey` for invitation redemption (`src/tincr/crates/tincd/src/proto.rs:415-436`).

After ACK, nodes flood ADD_EDGE and ADD_SUBNET with duplicate suppression (`src/tincr/crates/tincd/src/daemon/gossip.rs:705-711`). Every node recomputes the MST and shortest paths. The BFS prefers fewer hops and uses edge weight only to break ties between paths of equal hop count (`src/tincr/crates/tinc-graph/src/lib.rs:495-511`). tincr adds two changes to C tinc here. Edge weights are re-measured from the meta-connection PING round-trip time with an EWMA and re-gossiped when they leave a hysteresis band (`src/tincr/crates/tincd/src/daemon/gossip.rs:1434-1471`). Routes also keep their old next hop on equal-cost changes (`sssp_sticky`, `src/tincr/crates/tinc-graph/src/lib.rs:518-537`).

Per-peer data sessions start with REQ_KEY, which carries the initiator's SPTPS KEX. ANS_KEY carries the reply. Both ride the meta connections hop by hop (`src/tincr/crates/tincd/src/daemon/gossip.rs:78-165`, `src/tincr/crates/tincd/src/daemon/net/sptps.rs:599-628`). The data session uses the label `tinc UDP key expansion <initiator> <responder>` (`src/tincr/crates/tincd/src/tunnel.rs:290-301`). Every node also runs a `KeyExpire` timer, 3600 s by default, that forces a new KEX on every tunnel (`src/tincr/crates/tincd/src/daemon/periodic.rs:827-870`).

## Data Plane

In the default `Mode = router` (`src/tincr/crates/tincd/src/daemon/settings.rs:353`) the daemon needs `DeviceType = tun` in `tinc.conf`. Without it, tincd falls back to a dummy device that carries no packets and logs a warning (`src/tincr/crates/tincd/src/daemon/setup.rs:163-177`). With a TUN device, `on_device_read` drains the device into a page-aligned arena (`src/tincr/crates/tincd/src/daemon/net/device.rs:23-61`). A TSO super-frame of up to 64 KiB is split into MTU-sized TCP segments by `tso_split` (`src/tincr/crates/tincd/src/daemon/net/device.rs:142-183`). Each segment is routed by destination IP through the subnet trie (`src/tincr/crates/tincd/src/route.rs:356`). It is encrypted into a reusable scratch buffer with a 12-byte headroom for the node IDs (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:114-124`), and staged into a contiguous batch buffer. At the end of the burst, or when the destination or segment size changes, the batch leaves as one `sendmsg` with `UDP_SEGMENT` (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:768-796`). For TSO super-frames to a direct peer there is a faster path. `tx_probe` routes the first chunk once against a read-only snapshot, reserves all sequence numbers, and `seal_super` seals and ships the whole run without going through `route_packet` per chunk (`src/tincr/crates/tincd/src/shard/probe.rs:76-166`, `src/tincr/crates/tincd/src/shard/seal.rs:41-90`).

Records go over TCP instead of UDP in four cases: handshake records, `TCPOnly`, a relay that is too old, and any packet larger than the relay's confirmed `minmtu` (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:685-698`). `minmtu` starts at 0, so the first packets to a new peer use TCP until UDP probes confirm a path. On TCP, data is sent as binary `SPTPS_PACKET` frames for protocol minor 7 or later, or base64 in REQ_KEY for older peers (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:573-628`). A random early drop protects the TCP output buffer (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:559-571`).

On receive, `recvmmsg` fetches up to 64 datagrams (`src/tincr/crates/tincd/src/daemon/net/rx.rs:173-235`). `handle_incoming_vpn_packet` finds the sender by its source ID. If the destination ID belongs to another node, it forwards the record without decrypting it, but only for senders with a confirmed UDP address (`src/tincr/crates/tincd/src/daemon/net/rx.rs:405-426`, `src/tincr/crates/tincd/src/daemon/net/rx.rs:641-680`). Otherwise `open_data_into` checks the tag and the replay window and decrypts into a scratch buffer (`src/tincr/crates/tincd/src/daemon/net/rx.rs:479-541`). Inbound TCP segments of one flow are coalesced in a `GroBucket` and written to the TUN device as one super-frame with a virtio-net header (`src/tincr/crates/tincd/src/daemon/net/device.rs:380-454`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - SPTPS data records are sent as UDP datagrams to the peer or relay through `send_sptps_data_relay` and the `UdpEgress` backend (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:719-802`).
- [x] **Datagram encapsulation (no head-of-line blocking)** - On the default UDP path each inner packet is one SPTPS datagram record with its own sequence number (`src/tincr/crates/tinc-sptps/src/state.rs:715-740`). Only fallback traffic uses the TCP meta stream.
- [x] **TCP fallback** - `send_sptps_data_relay` switches to the TCP meta connection on its own when UDP is not confirmed (`minmtu` too small) or `TCPOnly` is set (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:685-716`), and `try_udp` drops back to TCP after `UDPDiscoveryTimeout` (30 s) without replies (`src/tincr/crates/tincd/src/daemon/txpath.rs:385-405`).
- [ ] **QUIC support** - Not supported: the transports are UDP sockets and TCP meta connections only (`src/tincr/crates/tincd/src/listen.rs:668-698`). There is no QUIC crate in `src/tincr/Cargo.lock`.
- [ ] **WebSocket support** - Not supported: `Proxy` knows only `exec`, `socks4`, `socks5` and `http` CONNECT (`src/tincr/crates/tincd/src/outgoing.rs:421-475`), and there is no WebSocket code.

### IP Support

- [x] **IPv4 support** - `route_ipv4` looks up IPv4 destinations in the subnet trie (`src/tincr/crates/tincd/src/route.rs:91-150`).
- [x] **IPv6 support** - `route_ipv6` handles IPv6 destinations (`src/tincr/crates/tincd/src/route.rs:153-230`), and TSO is enabled for both families (`TUN_F_TSO4|TUN_F_TSO6`, `src/tincr/crates/tinc-device/src/linux.rs:476-482`).
- [x] **Dual-stack** - One TUN device carries both families, and `route` dispatches on the EtherType synthesized from the IP version nibble (`src/tincr/crates/tincd/src/route.rs:356`, `src/tincr/crates/tinc-device/src/ether.rs`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - `Mode = router` is the default (`src/tincr/crates/tincd/src/daemon/settings.rs:324-333`) and uses a TUN device (`src/tincr/crates/tincd/src/daemon/setup.rs:213-234`).
- [x] **Layer 2 (Ethernet) mode** - `Mode = switch` and `Mode = hub` carry Ethernet frames on a TAP device (`src/tincr/crates/tincd/src/daemon/settings.rs:659-671`, `src/tincr/crates/tincd/src/daemon/setup.rs:235-251`), with MAC learning in `route_mac` (`src/tincr/crates/tincd/src/route_mac.rs:52`, `src/tincr/crates/tincd/src/mac_lease.rs:53`).
- [x] **Bridging support** - In switch mode the daemon learns MAC addresses seen on the local TAP device and floods unknown ones (`src/tincr/crates/tincd/src/route_mac.rs:52`). A TAP bridged with a LAN therefore carries non-VPN devices at Layer 2. The bridge itself is set up by the admin's scripts (inferred).

### Advanced Protocol Features

- [ ] **Multipath/bonding** - Not supported: each node has one cached UDP address (`udp_addr_cached`) and one `via`/`nexthop` at a time (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:649-668`, `src/tincr/crates/tincd/src/daemon/net/sptps.rs:739-762`).
- [x] **QoS/traffic shaping** - Partial: `PriorityInheritance` copies the inner TOS/TCLASS byte to the outer UDP socket (`src/tincr/crates/tincd/src/daemon/settings.rs:154-158`, `src/tincr/crates/tincd/src/daemon/net/sptps.rs:764-766`), and the TCP fallback uses random early drop (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:46-53`). There are no queues or rate limits.
- [x] **Multicast support** - `224.0.0.0/4`, `ff00::/8` and broadcast addresses are built-in broadcast subnets (`src/tincr/crates/tincd/src/daemon/setup.rs:462-486`), and such packets are flooded along the MST by default (`src/tincr/crates/tincd/src/broadcast.rs:1-40`).

# Encryption

## Encryption Layer Details

**Handshake.** SPTPS has three handshake records. `send_kex` sends a KEX body of version byte 0, a 32-byte random nonce and a fresh ephemeral ECDH public key (`src/tincr/crates/tinc-sptps/src/lib.rs:33-48`, `src/tincr/crates/tinc-sptps/src/state.rs:891-920`). The ECDH key is created from 32 random bytes for every KEX (`src/tincr/crates/tinc-sptps/src/state.rs:905-911`). When both KEX records are present, each side signs the transcript `[role bit][own KEX][peer KEX][label]` with its long-term Ed25519 key (`src/tincr/crates/tinc-sptps/src/state.rs:32-41`, `src/tincr/crates/tinc-sptps/src/state.rs:922-935`). `receive_sig` verifies the peer's signature against the key from `hosts/<name>` before it computes the shared secret (`src/tincr/crates/tinc-sptps/src/state.rs:1077-1093`). The ECDH public key is sent as an Ed25519 point and converted to a Montgomery u-coordinate without an on-curve check, to match C tinc. Only an all-zero shared secret is refused (`src/tincr/crates/tinc-crypto/src/ecdh.rs:110-150`, `src/tincr/crates/tinc-crypto/src/ecdh.rs:183-191`). The ladder itself is `MontgomeryPoint::mul_clamped` from `curve25519-dalek` 5.0.0-pre.6.

**Key derivation.** `generate_key_material` feeds the shared secret into tinc's PRF with the seed `"key expansion" || initiator nonce || responder nonce || label` and takes 128 bytes, two 64-byte ChaCha keys (`src/tincr/crates/tinc-sptps/src/state.rs:996-1020`). The PRF is the TLS 1.0 `P_hash` over HMAC-SHA512, with `A(0)` set to zeros as in the C code (`src/tincr/crates/tinc-crypto/src/prf.rs:1-77`). `key_half` assigns one half to each direction (`src/tincr/crates/tinc-sptps/src/state.rs:46-53`).

**Data cipher.** ChaCha20-Poly1305 in the OpenSSH layout: an 8-byte big-endian sequence-number nonce, block 0 of the keystream as the Poly1305 key, encryption from block 1, and a tag over the ciphertext only. Only the first 32 of the 64 key bytes are used (`src/tincr/crates/tinc-crypto/src/chapoly.rs:1-30`, `src/tincr/crates/tinc-crypto/src/chapoly.rs:99-120`). The tag is compared with `subtle::ConstantTimeEq` (`src/tincr/crates/tinc-crypto/src/chapoly.rs:209`, `src/tincr/crates/tinc-crypto/src/chapoly.rs:254`). There are no alternative ciphers.

**Nonce and replay.** The wire sequence number is 32 bits (`src/tincr/crates/tinc-sptps/src/state.rs:471-476`). `seal_data_into` refuses to seal after 2^32 - 2^16 records under one key (`SEAL_KEY_LIMIT`, `src/tincr/crates/tinc-sptps/src/state.rs:55-58`, `src/tincr/crates/tinc-sptps/src/state.rs:583`, `src/tincr/crates/tinc-sptps/src/state.rs:621-626`). The receiver keeps a sliding bitmap of `ReplayWindow` bytes, 32 bytes or 256 packets by default (`src/tincr/crates/tincd/src/daemon/settings.rs:368`, `src/tincr/crates/tinc-sptps/src/state.rs:202-310`). The window is updated only after the tag check passes (`src/tincr/crates/tinc-sptps/src/state.rs:229-237`).

**Rekeying.** `on_keyexpire` calls `force_kex` on every tunnel with a valid key every `KeyExpire` seconds, 3600 by default (`src/tincr/crates/tincd/src/daemon/periodic.rs:820-870`, `src/tincr/crates/tincd/src/daemon/settings.rs:364`). A rekey runs a full new KEX/SIG/ACK exchange with new ephemeral keys inside the old session (`src/tincr/crates/tinc-sptps/src/state.rs:947-958`). After a REQ_KEY restart, the previous session stays available for a while so that stragglers under the old key still decrypt (`src/tincr/crates/tincd/src/daemon/net/rx.rs:468-486`).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Session keys come from an X25519 ladder on ephemeral keys (`MontgomeryPoint::mul_clamped`, `src/tincr/crates/tinc-crypto/src/ecdh.rs:118-150`). The public key is carried in Ed25519 encoding and converted to Montgomery form (`src/tincr/crates/tinc-crypto/src/ecdh.rs:183-191`).
- [x] **Perfect Forward Secrecy** - Every KEX creates a new ECDH key pair from fresh random bytes (`src/tincr/crates/tinc-sptps/src/state.rs:905-911`), and `compute_shared` consumes it (`src/tincr/crates/tinc-crypto/src/ecdh.rs:110-118`). Long-term Ed25519 keys only sign.
- [ ] **Post-quantum readiness** - Not supported: SPTPS has only the X25519 exchange (`src/tincr/crates/tinc-sptps/src/state.rs:891-920`), and there is no KEM code in `src/` or the vendored crates.
- [x] **Key rotation** - The `KeyExpire` timer forces a new SPTPS KEX with each peer every 3600 s by default (`src/tincr/crates/tincd/src/daemon/periodic.rs:827-870`).

### Symmetric Encryption

- [x] **Authenticated encryption** - Data records use ChaCha20-Poly1305 (`src/tincr/crates/tinc-crypto/src/chapoly.rs:133-260`).
- [x] **Hardware-accelerated crypto** - The x86_64 build uses `target-cpu=x86-64-v3` and `--cfg chacha20_force_avx2` (`src/tincr/.cargo/config.toml:44-48`), which selects the AVX2 ChaCha20 backend (`deps/tincr/cargo-vendor/c19b7c6f923b580ac259164a89f2577984ad5ab09ee9d583b888f934adbbe8d0/chacha20-0.9.1/src/backends.rs:5-15`). Poly1305 has an AVX2 backend on x86_64 (`deps/tincr/cargo-vendor/c19b7c6f923b580ac259164a89f2577984ad5ab09ee9d583b888f934adbbe8d0/poly1305-0.8.0/src/backend.rs:3-13`). The nix build copies `.cargo` into the source (`src/tincr/nix/tincd.nix:19`), so these flags applied to the benchmarked binary (inferred).
- [x] **Constant-time operations** - The Poly1305 tag check uses `subtle::ConstantTimeEq` (`src/tincr/crates/tinc-crypto/src/chapoly.rs:209`), the control cookie check also uses `ct_eq` (`src/tincr/crates/tincd/src/proto.rs:593-596`), and X25519/Ed25519 come from `curve25519-dalek`/`ed25519-dalek`. The hand-written field code for the Edwards-to-Montgomery map uses fixed-exponent inversion (`src/tincr/crates/tinc-crypto/src/ecdh.rs:362`).

### Protocol Security

- [x] **Replay protection** - `ReplayWindow::check` keeps a sliding bitmap of 256 packets by default and rejects old or repeated sequence numbers (`src/tincr/crates/tinc-sptps/src/state.rs:252-310`, `src/tincr/crates/tincd/src/daemon/settings.rs:368`).
- [ ] **Noise Protocol** - Not supported: SPTPS is a custom signed-ECDHE protocol with a TLS 1.0-style PRF (`src/tincr/crates/tinc-sptps/src/state.rs:996-1020`, `src/tincr/crates/tinc-crypto/src/prf.rs:1-25`), not a Noise pattern.
- [ ] **No cleartext metadata** - The meta connection starts with a cleartext `ID <nodename> 17.7` line (`src/tincr/crates/tincd/src/proto.rs:510-520`), and every UDP datagram carries cleartext 6-byte source and destination IDs derived from SHA-512 of the node name (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:719-737`, `src/tincr/crates/tincd/src/node_id.rs:55-56`).
- [x] **End-to-end encryption through relays** - SPTPS sessions are per node pair. UDP relays forward the sealed record by destination ID without decrypting it (`src/tincr/crates/tincd/src/daemon/net/rx.rs:641-680`), and TCP relays forward `SPTPS_PACKET` as opaque data (`src/tincr/crates/tincd/src/daemon/gossip.rs:229-251`).

# Performance

## Threading Model

All packet work runs on one thread in `Daemon::run`, an epoll loop (`src/tincr/crates/tincd/src/daemon.rs:693`, `src/tincr/crates/tinc-event/src/io/epoll.rs:14`). It dispatches `IoWhat::Device`, `IoWhat::Tcp(i)` and `IoWhat::Udp(i)` events (`src/tincr/crates/tincd/src/daemon.rs:807-816`). Separate threads exist only for blocking side jobs: the DHT client (`src/tincr/crates/tincd/src/discovery.rs:359-362`), the port mapper (`src/tincr/crates/tincd/src/portmap/mod.rs:230-239`), hostname resolution (`src/tincr/crates/tincd/src/bgresolve.rs:78-81`) and the script runner (`src/tincr/crates/tincd/src/scriptworker.rs:60`). None of them touches packets.

**TUN to UDP.** `on_device_read` loops up to `DEVICE_DRAIN_CAP = 64` times per wake (`src/tincr/crates/tincd/src/daemon/net.rs:22`, `src/tincr/crates/tincd/src/daemon/net/device.rs:45-61`). The vnet-header `drain` reads one skb per call into a page-aligned arena with 1600-byte slots (`src/tincr/crates/tinc-device/src/linux.rs:658`, `src/tincr/crates/tinc-device/src/arena.rs:128-132`). A TSO super-frame (up to about 64 KiB) is split into MTU-sized segments in a separate scratch buffer (first copy), with new TCP/IP headers and checksums (`src/tincr/crates/tincd/src/daemon/net/device.rs:142-183`). On the fast path `tx_probe` routes once per super-frame and reserves N sequence numbers with one `fetch_add` (`src/tincr/crates/tincd/src/shard/probe.rs:76-166`). `seal_super` then encrypts each segment into `tx_scratch` (second copy, fused with encryption) and appends it to the contiguous `TxBatch` (third copy) (`src/tincr/crates/tincd/src/shard/seal.rs:41-90`). Other packets go through `route_packet` and `send_sptps_packet`, which uses the same `seal_data_into`, scratch and batch (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:114-124`, `src/tincr/crates/tincd/src/daemon/net/sptps.rs:768-796`). The batch is shipped with one `sendmsg` carrying a `UDP_SEGMENT` cmsg (`src/tincr/crates/tincd/src/egress/linux.rs:110-114`). It is limited to 65535 - 48 bytes, about 43 full-size datagrams (`src/tincr/crates/tincd/src/egress.rs:26-43`).

**UDP to TUN.** Each UDP wake runs one `recvmmsg` of up to 64 datagrams into 64 preallocated 2048-byte buffers (`src/tincr/crates/tincd/src/daemon/net.rs:16-50`, `src/tincr/crates/tincd/src/daemon/net/rx.rs:196-235`). `open_data_into` decrypts each one into the reusable `rx_scratch` (one copy) (`src/tincr/crates/tinc-sptps/src/state.rs:776-830`). For batches of more than one packet, a `GroBucket` coalesces in-order TCP segments of one flow (second copy) and writes them with one `write` and a synthesized virtio-net header (`src/tincr/crates/tincd/src/daemon/net/rx.rs:286-290`, `src/tincr/crates/tincd/src/daemon/net/device.rs:380-454`). Other packets are written one by one.

Sockets get 1 MiB `SO_RCVBUF` and `SO_SNDBUF` by default (`src/tincr/crates/tincd/src/listen.rs:80-90`, `src/tincr/crates/tincd/src/listen.rs:525-539`). The release profile uses thin LTO and one codegen unit (`src/tincr/Cargo.toml:44-46`). The `tinc-device` crate has an `IFF_MULTI_QUEUE` opener (`src/tincr/crates/tinc-device/src/linux.rs:187-284`) and the workspace has a `tincd-bpf` reuseport crate. tincd uses neither, so a single thread does all crypto at this revision.

## Performance Optimizations Checklist

### Threading

- [ ] **Multi-threaded processing** - Not supported: all TUN, UDP and crypto work runs on the single epoll thread in `Daemon::run` (`src/tincr/crates/tincd/src/daemon.rs:693`). Worker threads handle only DHT, port mapping, DNS and scripts (`src/tincr/crates/tincd/src/discovery.rs:359-362`).
- [ ] **Multi-queue TUN / per-core sockets** - Not supported in the daemon: `Tun::open_mq` exists (`src/tincr/crates/tinc-device/src/linux.rs:224`), but `open_device` calls only `Tun::open` (`src/tincr/crates/tincd/src/daemon/setup.rs:231`), and `tincd` does not depend on the `tincd-bpf` crate (`src/tincr/crates/tincd/Cargo.toml`).

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - `udp_recv_phase1` calls `recvmmsg` with 64 slots on Linux (`src/tincr/crates/tincd/src/daemon/net/rx.rs:196-235`).
- [ ] **Batch UDP sends (sendmmsg)** - Not supported: tincr never calls `sendmmsg`. It batches sends only through one `sendmsg` with a `UDP_SEGMENT` cmsg (`src/tincr/crates/tincd/src/egress/linux.rs:110-114`), which is credited in the UDP GSO row.
- [x] **Large batch sizes (64+)** - The `recvmmsg` batch and the TUN drain cap are both 64 (`src/tincr/crates/tincd/src/daemon/net.rs:16-22`). A GSO send carries up to about 43 full-size segments (`src/tincr/crates/tincd/src/egress.rs:43`).

### Offloads

- [x] **UDP GSO** - `linux::Fast::send_batch` attaches `ControlMessage::UdpGsoSegments` (UDP_SEGMENT) to one `sendmsg` per batch (`src/tincr/crates/tincd/src/egress/linux.rs:110-114`). Setup always uses it on Linux (`src/tincr/crates/tincd/src/daemon/setup.rs:298-308`).
- [ ] **UDP GRO** - Not supported: there is no `UDP_GRO` socket option in `src/`. Receive coalescing is done in userspace for the TUN write (`GroBucket`), not on the UDP socket (`src/tincr/crates/tinc-device/src/tso.rs:601`).
- [x] **TUN offload (virtio-net hdr)** - The TUN device is opened with `IFF_VNET_HDR` and `TUNSETOFFLOAD(TUN_F_CSUM|TUN_F_TSO4|TUN_F_TSO6)` (`src/tincr/crates/tinc-device/src/linux.rs:132-177`, `src/tincr/crates/tinc-device/src/linux.rs:481-482`). Reads are split by `tso_split`, and writes are coalesced into GSO super-frames (`src/tincr/crates/tinc-device/src/tso.rs:354`, `src/tincr/crates/tinc-device/src/tso.rs:686`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - The device arena, TSO scratch, `tx_scratch`, `TxBatch`, `UdpRxBatch` and the GRO bucket are allocated once and reused (`src/tincr/crates/tincd/src/daemon/dp.rs:81-109`, `src/tincr/crates/tincd/src/daemon/net.rs:27-50`, `src/tincr/crates/tincd/src/daemon/net/device.rs:157-166`).
- [x] **Large UDP socket buffers (MB)** - `SockOpts::default` sets `udp_rcvbuf` and `udp_sndbuf` to 1 MiB (`src/tincr/crates/tincd/src/listen.rs:80-90`), applied with `SO_RCVBUF`/`SO_SNDBUF` (`src/tincr/crates/tincd/src/listen.rs:525-539`).
- [x] **Zero-allocation parsing** - `seal_data_into` and `open_data_into` work on caller-owned buffers that keep their capacity (`src/tincr/crates/tinc-sptps/src/state.rs:571-590`, `src/tincr/crates/tinc-sptps/src/state.rs:756-830`). The 12-byte ID header is parsed in place (`src/tincr/crates/tincd/src/daemon/net/rx.rs:405-407`). Compressed packets and the TCP path still allocate (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:81-103`, `src/tincr/crates/tinc-sptps/src/state.rs:468-486`).

### MTU and Peers

- [x] **Path MTU discovery** - `PmtuState` runs tinc's probe state machine (8-probe bursts, fix after 20 probes, periodic re-probe of `maxmtu+1`) (`src/tincr/crates/tincd/src/pmtu.rs:1-20`). It is seeded from the kernel's `IP_MTU` for the peer (`src/tincr/crates/tincd/src/daemon/txpath.rs:51-92`), and `EMSGSIZE` lowers it (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:831-850`).
- [x] **Endpoint caching** - The confirmed UDP address is cached per peer (`udp_addr_cached`, `src/tincr/crates/tincd/src/daemon/net/rx.rs:504-526`), and up to eight working meta-connection addresses per peer are saved to `addrcache/<peer>` (`src/tincr/crates/tincd/src/addrcache.rs:1-30`).

### Userspace TCP Stack

- [ ] **Userspace TCP/IP stack** - Not supported: packets go only to a kernel TUN/TAP device or an inherited fd (`src/tincr/crates/tincd/src/daemon/setup.rs:157-281`). The DNS stub answers UDP/53 queries read from the TUN device without a TCP stack (`src/tincr/crates/tincd/src/dns.rs:1-16`).

### Data Plane Compression

- [x] **Tunnel compression** - `Compression` (default 0) enables per-packet zlib levels 1-9 or LZ4 (level 12). Each packet is compressed only if that makes it smaller (`src/tincr/crates/tincd/src/daemon/settings.rs:636-657`, `src/tincr/crates/tincd/src/daemon/net/sptps.rs:81-103`).
- [x] **Configurable compression** - Each node picks the algorithm and level it wants to receive with `Compression = 0..12`, announced in ANS_KEY (`src/tincr/crates/tincd/src/compress.rs:9-17`, `src/tincr/crates/tincd/src/daemon/net/sptps.rs:599-618`). LZO levels 10-11 are refused for sending (`src/tincr/crates/tincd/src/daemon/settings.rs:643-648`).

# Security

## Known Security Issues

None found. The source tree has no advisory or CVE list for tincr, and no web search was done per the instructions. Code comments refer to earlier internal audits whose fixes are present at this revision, for example the check that stops unauthenticated senders from using a node as a UDP reflector (`src/tincr/crates/tincd/src/daemon/net/rx.rs:659-668`). The legacy RSA protocol of C tinc is not in this code (`src/tincr/crates/tincd/src/proto.rs:481-500`), so issues limited to that protocol cannot apply (inferred).

## Potential Security Concerns

- **Fast-path nonce limit not enforced.** `seal_data_into` refuses to seal after `SEAL_KEY_LIMIT` (2^32 - 2^16) records under one key, because the nonce is a 32-bit sequence number (`src/tincr/crates/tinc-sptps/src/state.rs:55-58`, `src/tincr/crates/tinc-sptps/src/state.rs:583`). The TSO fast path reserves sequence numbers with a plain `fetch_add` on the shared counter and does not check that limit (`src/tincr/crates/tincd/src/shard/probe.rs:154-156`). Protection then depends only on the `KeyExpire` timer (`src/tincr/crates/tincd/src/daemon/periodic.rs:820-826`). With the default 3600 s, the counter wraps only above about 1.19 million packets per second to one peer (inferred from 2^32 / 3600). A larger `KeyExpire`, or a rekey that is skipped because one is already in flight (`src/tincr/crates/tincd/src/daemon/periodic.rs:850-854`), would allow ChaCha20-Poly1305 nonce reuse at lower rates.
- **Cleartext identities.** The meta connection starts with the plaintext node name (`src/tincr/crates/tincd/src/proto.rs:510-520`), and every UDP datagram carries 6-byte hashes of the source and destination names (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:719-737`). A passive observer can map node names to IP addresses.
- **Unsigned gossip.** ADD_EDGE and ADD_SUBNET are not signed by their origin. Any authenticated member can claim subnets of other nodes unless `StrictSubnets` is set, and it is off by default (`src/tincr/crates/tincd/src/daemon/settings.rs:141-149`, `src/tincr/crates/tincd/src/daemon/settings.rs:349`).
- **No point validation in ECDH.** The peer's ECDH key is mapped to a Montgomery u-coordinate without an on-curve check, and only an all-zero result is refused (`src/tincr/crates/tinc-crypto/src/ecdh.rs:28-35`, `src/tincr/crates/tinc-crypto/src/ecdh.rs:145-148`). This copies C tinc for compatibility. The transcript signature limits the impact (inferred).
- **Unauthenticated address hints.** Relays can append arbitrary reflexive addresses to REQ_KEY and ANS_KEY (`src/tincr/crates/tincd/src/daemon/gossip.rs:492-512`), and ADD_EDGE addresses are not authenticated either. The code sends at most probes there, because `udp_confirmed` needs an authenticated reply. A malicious member can still use other nodes to send small probes to chosen addresses.
- **DHT bootstrap trust.** With `DhtDiscovery`, a single attacker-controlled `DhtBootstrap` node can fake the reflexive address that the node publishes (`src/tincr/crates/tincd/src/daemon/settings.rs:288-293`).
- **Hardening is opt-in.** `-U`, `-R` and `Sandbox` are all off by default (`src/tincr/crates/tincd/src/main.rs:326-340`, `src/tincr/crates/tincd/src/main.rs:959-985`), so a default daemon runs as root for its whole life. The shipped systemd unit adds no hardening options (`src/tincr/contrib/tincd@.service:19-27`).
- **Silent data-plane failures.** Per-datagram decrypt and replay failures are logged only at debug level (`src/tincr/crates/tincd/src/daemon/net/rx.rs:549-561`), so an attack on the UDP path is not visible at the default log level.
- **Default dummy device.** Without `DeviceType`, tincd connects to peers but uses a dummy device that drops every packet. It only logs a warning (`src/tincr/crates/tincd/src/daemon/setup.rs:163-177`). This is a deployment trap, not a vulnerability.

## Security Features Checklist

### Network Security

- [x] **Handshake rate limiting** - The `Tarpit` uses same-host and all-host leaky buckets (`MaxConnectionBurst`, default 10) and parks excess connections (`src/tincr/crates/tincd/src/listen/tarpit.rs:1-40`, `src/tincr/crates/tincd/src/daemon/settings.rs:369`). `maybe_restart_stuck_tunnel` throttles SPTPS restarts to one per 10 s per peer (`src/tincr/crates/tincd/src/daemon/gossip.rs:186-192`).
- [ ] **Stateful packet filter** - Not supported: `route` forwards by subnet only and keeps no connection tracking (`src/tincr/crates/tincd/src/route.rs:356`).
- [ ] **Fine-grained ACLs** - Not supported: the only controls are subnet ownership with `StrictSubnets`, `TunnelServer`, `Forwarding` and `DirectOnly` (`src/tincr/crates/tincd/src/daemon/settings.rs:131-163`), with no port or protocol rules.
- [ ] **Capability-based access** - Not supported: there are no tags, groups or certificate attributes. Authorization is the presence of `hosts/<name>` with an Ed25519 key (`src/tincr/crates/tincd/src/proto.rs:485-490`).

### Identity & Authentication

- [x] **Identity validation** - Partial: every peer must prove the Ed25519 key pinned in its host file, including indirect peers, because REQ_PUBKEY is refused (`src/tincr/crates/tinc-sptps/src/state.rs:1077-1093`, `src/tincr/crates/tincd/src/daemon/gossip.rs:404-412`). VPN addresses are not bound to keys unless `StrictSubnets` is set (`src/tincr/crates/tincd/src/daemon/settings.rs:141-149`).
- [ ] **Signed config updates** - Not supported: ADD_EDGE and ADD_SUBNET are text requests flooded without origin signatures (`src/tincr/crates/tincd/src/daemon/gossip.rs:1250-1300`).
- [ ] **Control-server key pinning** - N/A: tincr has no control server. Every node is an equal peer (`src/tincr/crates/tinc-graph/src/lib.rs:1-14`).

### Implementation

- [x] **Memory-safe language** - The daemon, SPTPS and crypto are Rust. `tinc-crypto`, `tinc-sptps`, `tinc-graph` and the shard fast path use `#![forbid(unsafe_code)]` (`src/tincr/crates/tinc-crypto/src/lib.rs:12`, `src/tincr/crates/tinc-sptps/src/lib.rs:20`, `src/tincr/crates/tincd/src/shard/mod.rs:25`). The remaining `unsafe` is in ioctl/FFI wrappers and the vendored minilzo (`src/tincr/crates/tincd/minilzo/minilzo.c`, `src/tincr/crates/tincd/src/compress.rs:29-39`).
- [x] **Privilege separation** - `tincd -U user` drops to an unprivileged user with `setresuid`/`setresgid` after the device and sockets are set up, verifies the drop and sets `PR_SET_NO_NEW_PRIVS` (`src/tincr/crates/tincd/src/main.rs:668-767`). It is off by default.
- [x] **Sandboxing** - `Sandbox = normal|high` applies a Landlock path allowlist on Linux (`src/tincr/crates/tincd/src/sandbox.rs:1-25`, `src/tincr/crates/tincd/src/sandbox.rs:200-251`), and `tincd -R` chroots into the config directory (`src/tincr/crates/tincd/src/main.rs:713-735`). Both are off by default (`src/tincr/crates/tincd/src/main.rs:959-985`). There is no seccomp filter.
- [x] **Audit logging** - The default filter is `info` (`src/tincr/crates/tincd/src/main.rs:842-847`). At that level tincd logs rejected IDs such as unknown identities and rollback attempts (`src/tincr/crates/tincd/src/daemon/metaconn.rs:260-263`, `src/tincr/crates/tincd/src/proto.rs:485-500`), bad meta requests (`src/tincr/crates/tincd/src/daemon/metaconn.rs:157-164`), SPTPS signature and decrypt failures on meta connections (`src/tincr/crates/tincd/src/conn.rs:518-528`) and failed invitations (`src/tincr/crates/tincd/src/daemon/metaconn.rs:950-957`). UDP decrypt and replay failures are debug only.

# NAT Traversal

## How NAT Traversal Works

The base mechanism is the one from tinc 1.1. A node first needs a TCP meta connection to at least one other node. Relays on the meta path append the UDP address they observed for the sender to REQ_KEY and ANS_KEY (`src/tincr/crates/tincd/src/daemon/gossip.rs:252-300`, `src/tincr/crates/tincd/src/daemon/gossip.rs:668-696`). tincr also appends on REQ_KEY, so both ends learn each other's reflexive address during one handshake. Both then call `try_udp` at once, which sends PMTU probes to that address (`src/tincr/crates/tincd/src/daemon/gossip.rs:531-541`, `src/tincr/crates/tincd/src/daemon/gossip.rs:684-695`). UDP_INFO messages spread reflexive addresses further (`src/tincr/crates/tincd/src/udp_info.rs:1-10`). Probes repeat every 2 s until a reply arrives and every 10 s afterwards as a NAT keepalive (`src/tincr/crates/tincd/src/daemon/settings.rs:346-347`, `src/tincr/crates/tincd/src/daemon/txpath.rs:441-458`). If no path is confirmed, data goes through relays over UDP or over the TCP meta connections.

tincr adds two optional mechanisms. `UPnP = yes|udponly` starts a thread that asks the gateway for a port mapping with PCP first and falls back to UPnP-IGD for IPv4. It also asks for IPv6 firewall pinholes (`src/tincr/crates/tincd/src/portmap/mod.rs:1-24`, `src/tincr/crates/tincd/src/portmap/mod.rs:66-73`). `DhtDiscovery = yes` runs a Mainline DHT client on its own thread. It learns the public IPv4 address from BEP 42 replies and from a KRPC ping sent from tincd's own UDP socket. It then publishes the address every 5 minutes as an XChaCha20-Poly1305-encrypted BEP 44 record under a key that is blinded per day. Peers that hold the node's host file can find that record (`src/tincr/crates/tincd/src/discovery.rs:1-60`, `src/tincr/crates/tincd/src/discovery.rs:138`). The default bootstrap nodes are four public BitTorrent DHT routers (`src/tincr/crates/tincd/src/discovery.rs:122-127`). Both options are off by default (`src/tincr/crates/tincd/src/daemon/settings.rs:374-376`).

## NAT Traversal Checklist

### Discovery

- [x] **No own public node needed** - Partial: with `DhtDiscovery = yes`, nodes find each other through the public BitTorrent DHT and need no `Address` lines (`src/tincr/crates/tincd/src/discovery.rs:1-31`, `src/tincr/crates/tincd/src/discovery.rs:122-127`). It is off by default, and the TCP meta connection still needs a reachable address, such as one from PCP/UPnP mapping or IPv6 (`src/tincr/crates/tincd/src/discovery.rs:1047-1062`).
- [x] **Public endpoint discovery (STUN or reflection)** - Server reflection: meta-path nodes append the observed UDP address to REQ_KEY, ANS_KEY and UDP_INFO (`src/tincr/crates/tincd/src/daemon/gossip.rs:252-300`). The optional DHT path uses BEP 42 reflection from DHT nodes (`src/tincr/crates/tincd/src/discovery.rs:11-31`). There is no STUN client.
- [x] **Multiple discovery servers** - Every meta-connected node reflects addresses, any number of `ConnectTo` nodes can be configured, and `DhtBootstrap` takes several seeds (`src/tincr/crates/tincd/src/daemon/settings.rs:500-521`, `src/tincr/crates/tincd/src/daemon/settings.rs:708-711`).
- [ ] **NAT type detection** - Not supported: there is no NAT classification code. `try_udp` only probes (`src/tincr/crates/tincd/src/daemon/txpath.rs:378-482`).

### Port Mapping

- [x] **UPnP port mapping** - `UPnP = yes|udponly` uses a built-in SSDP/SOAP UPnP-IGD client as the IPv4 fallback (`src/tincr/crates/tincd/src/portmap/mod.rs:16-24`, `src/tincr/crates/tincd/src/portmap/igd.rs`). The `upnp` feature is on by default (`src/tincr/crates/tincd/Cargo.toml`, `[features] default = ["upnp"]`).
- [ ] **NAT-PMP support** - Not supported: the module says NAT-PMP is intentionally not implemented. A NAT-PMP-only server gets a PCP request, answers `UNSUPP_VERSION` and the code falls back to IGD (`src/tincr/crates/tincd/src/portmap/mod.rs:44-50`).
- [x] **PCP support** - A hand-written RFC 6887 client (version 2) maps ports and opens IPv6 pinholes (`src/tincr/crates/tincd/src/portmap/pcp.rs:1-40`).

### Hole Punching

- [x] **UDP hole punching** - Both peers learn each other's reflexive address from the relay during the REQ_KEY/ANS_KEY exchange and probe it at the same time (`src/tincr/crates/tincd/src/daemon/gossip.rs:492-541`, `src/tincr/crates/tincd/src/daemon/gossip.rs:684-695`).
- [ ] **Symmetric NAT handling** - Not supported: candidates are the reflexive address, edge addresses and the local address only, with no port prediction (`src/tincr/crates/tincd/src/daemon/txpath.rs:1384-1465`).
- [x] **Rendezvous coordination** - Mesh nodes that forward REQ_KEY/ANS_KEY act as rendezvous and append the addresses for the punch (`src/tincr/crates/tincd/src/daemon/gossip.rs:208-300`).

### Fallback

- [x] **Relay fallback** - Traffic falls back to `via` or `nexthop` over UDP, or to the TCP meta connections (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:649-716`).
- [x] **Multiple relays** - Any node can relay, and `via`/`nexthop` come from the graph over all nodes (`src/tincr/crates/tinc-graph/src/lib.rs:493-537`).
- [x] **Latency-based relay selection** - Partial: the BFS picks the fewest hops and breaks ties by edge weight, which tincr derives from the meta PING RTT with an EWMA (`src/tincr/crates/tinc-graph/src/lib.rs:495-511`, `src/tincr/crates/tincd/src/daemon/gossip.rs:1434-1471`).
- [x] **TCP relay support** - Packets are relayed through TCP meta connections as `SPTPS_PACKET` frames (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:573-587`, `src/tincr/crates/tincd/src/daemon/gossip.rs:229-251`).

# Local Routing

## Peer Discovery on LANs

There is no broadcast or multicast discovery. The UDP socket has `SO_BROADCAST` set (`src/tincr/crates/tincd/src/listen.rs:492-497`), but nothing sends LAN broadcasts. Each ADD_EDGE carries the local address of the connection (`src/tincr/crates/tincd/src/daemon/connect.rs:198`). With `LocalDiscovery` (on by default, `src/tincr/crates/tincd/src/daemon/settings.rs:358`), `try_udp` sends a second probe to a peer's local address while UDP is not yet confirmed (`src/tincr/crates/tincd/src/daemon/txpath.rs:459-478`). Whichever probe is answered first sets the UDP address (`src/tincr/crates/tincd/src/daemon/net/rx.rs:504-526`).

## Routing Features

Nodes announce `Subnet` entries from their host files (`src/tincr/crates/tincd/src/daemon/settings.rs:478-496`). A subnet can carry a weight (`#weight`). The lookup skips unreachable owners and prefers the lowest weight (`src/tincr/crates/tinc-proto/src/subnet.rs:1-33`, `src/tincr/crates/tincd/src/subnet_tree.rs:364-410`). Packets larger than the path MTU get ICMP "fragmentation needed" or "packet too big", or IPv4 fragmentation (`src/tincr/crates/tincd/src/daemon/net/route.rs:477-525`). The DNS stub (`DNSAddress`, `DNSSuffix`) answers A, AAAA and PTR for `<node>.<suffix>` from the live subnet table (`src/tincr/crates/tincd/src/dns.rs:1-37`, `src/tincr/crates/tincd/src/daemon/setup.rs:327-360`).

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - Not supported: there is no LAN broadcast or multicast probe. Local discovery uses addresses learned from ADD_EDGE (`src/tincr/crates/tincd/src/daemon/txpath.rs:459-478`).
- [x] **Direct path advertisement** - ADD_EDGE carries each connection's local address and port (`src/tincr/crates/tincd/src/daemon/connect.rs:198`, `src/tincr/crates/tincd/src/local_addr.rs:1-15`).

### LAN Optimization

- [x] **Automatic LAN preference** - Partial: `LocalDiscovery` (on by default) probes the local address in parallel only until any UDP address is confirmed (`src/tincr/crates/tincd/src/daemon/txpath.rs:459-478`). The first reply wins, and there is no explicit LAN priority.
- [ ] **Trusted path mode** - Not supported: tincr speaks only SPTPS and always encrypts. The legacy protocol with `Cipher = none` is compiled out (`src/tincr/crates/tincd/src/proto.rs:481-500`, `src/tincr/crates/tincd/src/main.rs:418-422`).
- [x] **LAN-only mode** - Nodes need only `Address` entries reachable on the LAN and no external service. DHT and port mapping are off by default (`src/tincr/crates/tincd/src/daemon/settings.rs:374-376`, `src/tincr/crates/tincd/src/addrcache.rs:1-24`).

### Routing Features

- [x] **Subnet routes** - Each node announces `Subnet` entries from its host file, and they are flooded with ADD_SUBNET (`src/tincr/crates/tincd/src/daemon/settings.rs:478-496`).
- [x] **Full tunnel mode** - An exit node can own `Subnet = 0.0.0.0/0` or `::/0`, which the trie matches for any destination (`src/tincr/crates/tincd/src/subnet_tree.rs:379-410`). The OS default route is set in `tinc-up` (inferred).
- [x] **Split tunneling** - Only packets the kernel routes into the TUN device reach tincd, and only destinations with a matching subnet are forwarded (`src/tincr/crates/tincd/src/route.rs:91-150`).
- [x] **Route priorities** - `Subnet = prefix#weight` orders owners of the same prefix, and unreachable owners are skipped, so traffic fails over between routers (`src/tincr/crates/tincd/src/subnet_tree.rs:113-140`, `src/tincr/crates/tincd/src/subnet_tree.rs:364-410`).
- [x] **Multi-hop routing via peers** - The graph computes `nexthop`/`via` for every node, and intermediate nodes forward packets for others (`src/tincr/crates/tinc-graph/src/lib.rs:493-537`, `src/tincr/crates/tincd/src/daemon/net/rx.rs:641-680`).
- [x] **Built-in DNS** - With `DNSAddress` and `DNSSuffix` set, the daemon answers A/AAAA/PTR queries for node names on a virtual address on the TUN (`src/tincr/crates/tincd/src/dns.rs:1-37`, `src/tincr/crates/tincd/src/daemon/setup.rs:327-360`). It is off by default.

# Central Point of Failure

## What Happens When a ConnectTo Node Fails

tincr has no controller. `ConnectTo` and `Address` nodes only help other nodes make their first meta connection. When one fails, its meta connections close, and the other nodes delete its edges and recompute routes (`src/tincr/crates/tinc-graph/src/lib.rs:493-537`). Per-pair SPTPS sessions between other nodes keep running because they do not depend on it. Traffic that was relayed through the failed node moves to another path found by the BFS. `AutoConnect` keeps about three meta connections and dials new ones when the count drops (`src/tincr/crates/tincd/src/autoconnect.rs:5-24`). A node that loses its only meta connection still sends direct UDP to peers that have a valid key until the graph marks them unreachable (inferred from `src/tincr/crates/tincd/src/daemon/periodic.rs:833-841`, which ties `validkey` to reachability).

## Mitigation Strategies

Configure several `ConnectTo` nodes and keep `AutoConnect` on so the meta graph stays connected. Recently working addresses are cached on disk per peer (`src/tincr/crates/tincd/src/addrcache.rs:24-30`), and the DHT client also stores up to 100 routing-table nodes (`src/tincr/crates/tincd/src/discovery.rs:133`). With `DhtDiscovery = yes`, nodes can find each other again after address changes without any fixed `Address` line. `tinc-dht-seed` can run a private DHT seed swarm for closed networks (`src/tincr/crates/tincd/src/bin/tinc-dht-seed.rs`). `StrictSubnets` limits the damage a compromised member can do through gossip.

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Per-pair SPTPS sessions and meta connections between other nodes do not depend on the failed node, and the graph reroutes (`src/tincr/crates/tincd/src/daemon/net/sptps.rs:635-716`, `src/tincr/crates/tinc-graph/src/lib.rs:493-537`).
- [x] **Local state caching** - Peer keys and addresses live in `hosts/` files, and recent addresses in `addrcache/<peer>` (`src/tincr/crates/tincd/src/addrcache.rs:1-30`).
- [ ] **Cached credentials** - N/A: there is no controller that issues credentials. Each node's own key files are its only credentials (`src/tincr/crates/tincd/src/daemon/gossip.rs:46-53`).

### Redundancy

- [x] **Decentralized control plane** - Every node floods ADD_EDGE and ADD_SUBNET with duplicate suppression and computes the graph itself (`src/tincr/crates/tincd/src/daemon/gossip.rs:757-770,1298,1651`, `src/tincr/crates/tinc-graph/src/lib.rs:1-14`).
- [x] **Fully self-hostable** - Every role (bootstrap, reflection, relay) is an ordinary tincd node. The optional DHT can use a private seed swarm (`src/tincr/crates/tincd/src/bin/tinc-dht-seed.rs`, `src/tincr/crates/tincd/src/daemon/settings.rs:288-293`).
- [ ] **Controller redundancy** - N/A: the design has no controller (`src/tincr/crates/tinc-graph/src/lib.rs:1-14`).
- [x] **Relay redundancy** - Any reachable node can relay, and the graph picks among all of them (`src/tincr/crates/tinc-graph/src/lib.rs:493-537`).
- [x] **No single root of trust** - There is no CA. Each node trusts the keys in its own `hosts/` directory (`src/tincr/crates/tincd/src/proto.rs:485-490`), although any member can forge routing state without `StrictSubnets` (`src/tincr/crates/tincd/src/daemon/settings.rs:141-149`).

# Authentication

## How Nodes Join and Authenticate

There are two ways to join. The manual way: run `tinc init NAME`, then exchange host files (`tinc export`/`tinc import`) so that every node has `hosts/<peer>` with the peer's `Ed25519PublicKey` (`src/tincr/crates/tinc-tools/src/bin/tinc.rs:113-125`, `src/tincr/crates/tinc-tools/src/cmd/exchange.rs`). The invitation way: an existing node runs `tinc invite NAME`. This creates an invitation key, an 18-byte cookie and an invitation file, and prints a URL `host:port/KEYHASH COOKIE` (`src/tincr/crates/tinc-tools/src/cmd/invite.rs:1-30`). The new node runs `tinc join URL`. It connects with a throwaway key and the `?` greeting, checks the hash of the invitation key, completes an SPTPS handshake with the label `tinc invitation`, and sends the cookie (`src/tincr/crates/tinc-tools/src/cmd/join.rs:1-30`, `src/tincr/crates/tincd/src/proto.rs:629-683`). The daemon renames the invitation file to `.used` (single use), rejects it after `InvitationExpire` (one week by default), sends the config, and stores the new node's real public key in `hosts/` (`src/tincr/crates/tincd/src/invitation_serve.rs:131-170`, `src/tincr/crates/tincd/src/daemon/settings.rs:357`, `src/tincr/crates/tincd/src/daemon/metaconn.rs:925-1010`).

At connection time, each side sends its ID, loads the peer's key from `hosts/<name>`, and runs SPTPS. The signature over the KEX transcript proves possession of the private key (`src/tincr/crates/tincd/src/proto.rs:438-546`, `src/tincr/crates/tinc-sptps/src/state.rs:1077-1093`). For per-peer data sessions with nodes that are not neighbours, the key must also be in `hosts/` because REQ_PUBKEY is not supported (`src/tincr/crates/tincd/src/daemon/gossip.rs:84-96`).

## Authentication Checklist

### Enrollment Methods

- [x] **Pre-authentication keys** - `tinc invite` creates a single-use, expiring cookie that a new node presents with `tinc join` to enroll without further approval (`src/tincr/crates/tinc-tools/src/cmd/invite.rs:1-30`, `src/tincr/crates/tincd/src/invitation_serve.rs:131-170`).
- [ ] **Certificate-based enrollment** - Not supported: there is no CA or certificate code. Keys are raw Ed25519 public keys in host files (`src/tincr/crates/tincd/src/daemon/gossip.rs:46-53`).
- [ ] **OAuth/OIDC** - Not supported: there is no identity-provider code in `src/`. Nodes are identified only by their name and Ed25519 key (`src/tincr/crates/tinc-tools/src/bin/tinc-auth.rs:4-7`).
- [ ] **Interactive login** - Not supported: there is no browser or interactive login flow. Enrollment is `tinc join` with a URL (`src/tincr/crates/tinc-tools/src/bin/tinc.rs:193`).
- [x] **CLI authentication** - `tinc join URL` takes the invitation on the command line, and `tinc invite`, `tinc import` and `tinc export` handle the rest (`src/tincr/crates/tinc-tools/src/bin/tinc.rs:113-193`).

### Authorization

- [x] **Admin approval workflow** - Partial: there is no pending-then-approve flow. A peer is accepted only after an admin adds its `hosts/<name>` file by hand (`src/tincr/crates/tincd/src/proto.rs:485-490`) or creates an invitation for it (`src/tincr/crates/tinc-tools/src/cmd/invite.rs:1-30`).
- [ ] **Automated enrollment rules** - Not supported: there is no rules engine. Admission is a host file or an invitation issued by hand (`src/tincr/crates/tincd/src/proto.rs:485-490`).
- [ ] **Ephemeral nodes** - Not supported: host files persist, and unreachable nodes are only removed by a manual `tinc purge` (`src/tincr/crates/tincd/src/daemon/purge.rs:58`, `src/tincr/crates/tinc-tools/src/bin/tinc.rs:245`).
- [ ] **Node expiry** - Not supported: node keys have no expiry. Only invitations expire (`src/tincr/crates/tincd/src/invitation_serve.rs:52`, `src/tincr/crates/tincd/src/invitation_serve.rs:167`).

### Identity

- [x] **Stable device identity** - The identity is the node name plus its Ed25519 key in the config directory, which survives restarts and address changes (`src/tincr/crates/tincd/src/proto.rs:485-490`).
- [x] **Identity portability** - Copying the config directory (keys plus `hosts/`) moves the identity, since nothing is tied to hardware (`src/tincr/crates/tincd/src/keys.rs`).

# Platform Support

## Supported Platforms

The flake builds for `x86_64-linux`, `aarch64-linux` and `aarch64-darwin` (`src/tincr/flake.nix:21-24`). `open_device` supports `tun`, `tap` and `fd` devices on Linux and `tun` (utun) on macOS (`src/tincr/crates/tincd/src/daemon/setup.rs:178-273`). Every other platform gets only the dummy device, and any other `DeviceType` is rejected (`src/tincr/crates/tincd/src/daemon/setup.rs:274-278`). The event loop has epoll for Linux and kqueue for the BSDs and macOS (`src/tincr/crates/tinc-event/src/io/mod.rs:23-44`). Landlock, recvmmsg, UDP GSO and the TUN offloads are Linux-only (`src/tincr/crates/tincd/src/sandbox.rs:218`, `src/tincr/crates/tincd/src/daemon/net/rx.rs:200-240`). There is no Windows code and no mobile app.

## Implementation Details

The deployed artifact is a set of binaries (`tincd`, `tinc`, `tinc-auth`, `tinc-dht-seed`, `sptps_keypair`) built by crane with man pages (`src/tincr/nix/tincd.nix:28-57`). On x86_64 Linux the build targets `x86-64-v3` with forced AVX2 ChaCha20 (`src/tincr/.cargo/config.toml:44-48`). The `chacha20` crate refuses to compile `chacha20_force_avx2` without the `avx2` target feature (`deps/tincr/cargo-vendor/c19b7c6f923b580ac259164a89f2577984ad5ab09ee9d583b888f934adbbe8d0/chacha20-0.9.1/src/lib.rs:162-165`), so the binary needs a Haswell-class or newer CPU (inferred). A systemd unit with `Type=notify`, a watchdog and socket activation is shipped in `contrib/` (`src/tincr/contrib/tincd@.service:13-27`). NixOS VM tests cover NAT, DHT, systemd and auth setups (`src/tincr/nix/nixos-test-nat.nix`, `src/tincr/nix/nixos-test-dht.nix`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - Full support: TUN/TAP/fd devices, epoll, recvmmsg, UDP GSO and TUN offload (`src/tincr/crates/tincd/src/daemon/setup.rs:178-251`, `src/tincr/crates/tinc-device/src/linux.rs:105-185`).
- [x] **macOS** - `DeviceType = tun` opens a utun device through `BsdTun::open_utun` (`src/tincr/crates/tincd/src/daemon/setup.rs:252-265`, `src/tincr/crates/tinc-device/src/bsd.rs:236`), and the flake builds `aarch64-darwin` (`src/tincr/flake.nix:24`). TAP is not supported on macOS (`src/tincr/crates/tincd/src/daemon/setup.rs:266-273`).
- [ ] **Windows** - Not supported: there is no Windows device or event-loop code in `src/tincr/crates`. `ScriptsExtension` is explicitly not parsed (`src/tincr/crates/tincd/src/daemon/settings.rs:413`).
- [ ] **FreeBSD/OpenBSD** - Not supported: `tinc-event` has a kqueue backend for the BSDs (`src/tincr/crates/tinc-event/src/io/mod.rs:31-44`), but `open_device` has no FreeBSD or OpenBSD device arm and the BSD `open` constructors exist only for macOS (`src/tincr/crates/tincd/src/daemon/setup.rs:252-278`, `src/tincr/crates/tinc-device/src/bsd.rs:236`), so no packets can flow there.

### Mobile

- [ ] **iOS** - Not supported: there is no iOS code or app in the repository. The TUN/TAP device backends are compiled only for Linux and macOS (`src/tincr/crates/tincd/src/daemon/setup.rs:213-278`).
- [ ] **Android** - Not supported: the `fd` device backend is a port of C tinc's Android backend (`src/tincr/crates/tinc-device/src/fd.rs:1-5`), but it is compiled only for `target_os = "linux"` (`src/tincr/crates/tincd/src/daemon/setup.rs:179-180`), and there is no Android app.

### Implementation

- [ ] **Kernel-mode datapath** - Not supported: all packets pass through userspace reads and writes on `/dev/net/tun` (`src/tincr/crates/tincd/src/daemon/net/device.rs:23-61`).
- [ ] **Container support** - Not supported: the repository has no Dockerfile, OCI image or Kubernetes manifests. It ships only a systemd unit and NixOS tests (`src/tincr/contrib/tincd@.service`, `src/tincr/nix/`).
