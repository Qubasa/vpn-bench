# Overview

EasyTier is a mesh VPN written in Rust on the Tokio runtime. The crate metadata names "kkrainbow" as author and the GitHub organisation EasyTier as home (`src/easytier/easytier/Cargo.toml:1-13`). This overview describes version 2.4.5 (rev `7aba65ea32d3`), built by nix with the crate's default features `wireguard`, `websocket`, `smoltcp`, `tun`, `socks5` and `quic` (`src/easytier/easytier/Cargo.toml:311`). The optional `aes-gcm` and `openssl-crypto` features are not in that set.

Every node runs the same binary, `easytier-core`. A node joins a network by naming it and giving a shared password (`--network-name`, `--network-secret`). It connects to one or more configured peer URLs and accepts connections on its listeners. Nodes that are connected exchange a link-state routing table by RPC over the peer links (`peer_ospf_route.rs`). Each node then runs Dijkstra to find the next hop for every other node. A node also learns the listeners and interface addresses of every other node. It then tries to open a direct connection (`connector/direct.rs`), and if both sides sit behind NAT it tries UDP hole punching coordinated over the existing links (`connector/udp_hole_punch/`). Until a direct link exists, traffic is forwarded hop by hop through other nodes. Packets read from the TUN device get a 16-byte EasyTier header and are optionally compressed. They are then encrypted with AES-128-GCM under one static key that every member derives from the network secret (`src/easytier/easytier/src/common/global_ctx.rs:316-331`). There is no key exchange and no per-session key.

**At a glance**

- **Language:** Rust for the daemon (`easytier/`), TypeScript/Vue for the Tauri GUI and the web console (`easytier-gui/`, `easytier-web/`).
- **License:** GNU LGPL v3 (`src/easytier/LICENSE:1-2`, `src/easytier/easytier/LICENSE:1-2`).
- **Default peer transport:** TCP. The default flag `default_protocol = "tcp"` (`src/easytier/easytier/src/common/config.rs:28`) makes the direct connector try TCP listeners first, then UDP, then the rest (`src/easytier/easytier/src/connector/direct.rs:404-417`). A node started without `-l` listens on `tcp`/`udp` 11010, `wg`/`ws` 11011 and `wss` 11012 (`src/easytier/easytier/src/tunnel/mod.rs:26-27`, `src/easytier/easytier/src/core.rs:664-666`). UDP is used for hole-punched links. If no direct link works, traffic is relayed through other nodes over whatever link they have.
- **Data cipher (default):** AES-128-GCM from `ring` with a random 96-bit nonce per packet (`src/easytier/easytier/src/peers/encrypt/mod.rs:70-74`, `src/easytier/easytier/src/peers/encrypt/ring_aes_gcm.rs:102-104`). Alternatives selectable with `--encryption-algorithm`: `aes-256-gcm`, `chacha20` (ChaCha20-Poly1305 from `ring`), `xor`, and the OpenSSL variants only when built with `openssl-crypto` (`src/easytier/easytier/src/peers/encrypt/mod.rs:87-116`). `--disable-encryption` selects `NullCipher`.
- **Handshake:** No key exchange. Each side sends a plaintext protobuf `HandshakeRequest` with magic, peer ID, network name and a 32-byte digest of name and secret (`src/easytier/easytier/src/peers/peer_conn.rs:263-301`). The digest and the data keys come from Rust's `std` `DefaultHasher`, a keyless non-cryptographic hash (SipHash-1-3 in current Rust std, inferred) (`src/easytier/easytier/src/tunnel/mod.rs:280-292`, `src/easytier/easytier/src/common/global_ctx.rs:316-356`).
- **Default tunnel MTU:** The flag default is 1380 (`src/easytier/easytier/src/common/config.rs:32`). When encryption is on, the TUN device gets 1380 - 20 = 1360 (`src/easytier/easytier/src/instance/virtual_nic.rs:505-511`).
- **Control-plane model:** fully distributed. Link-state route sync between peers. Any node can be the entry point, and a project-run "public server" is optional.
- **Data-plane threading:** multi-threaded Tokio runtime with 2 worker threads by default (`src/easytier/easytier/src/launcher.rs:201-206`, `src/easytier/easytier/src/common/config.rs:56`). One TUN-reader task encrypts all outgoing packets and one peer-receive task decrypts all incoming packets.

## Key Architecture Components

**Control plane (`PeerManager`, `PeerRoute`).** `PeerManager::new` creates a random 32-bit peer ID on every start, the peer map, the encryptor, the peer RPC manager and the OSPF-like route (`src/easytier/easytier/src/peers/peer_manager.rs:176-316`). `PeerRoute` (`src/easytier/easytier/src/peers/peer_ospf_route.rs`) syncs `RoutePeerInfo` records with directly connected peers via `sync_route_info` (`peer_ospf_route.rs:2338`). The records carry virtual IPs, proxied CIDRs, NAT type, feature flags and HMAC group proofs (`src/easytier/easytier/src/proto/peer_rpc.proto:8-30`). Each node builds a graph and runs Dijkstra (`peer_ospf_route.rs:973`, `peer_ospf_route.rs:1008`). The "peer center" picks the non-public node with the lowest peer ID as collector of a global latency map (`src/easytier/easytier/src/peer_center/instance.rs:74-90`). That map gives the link costs for latency-first routing (`peer_center/instance.rs:378-383`).

**Discovery.** Initial peers come from the config (`connector/manual.rs`). They can also come from DNS `txt:`/`srv:` records or an HTTP redirect (`src/easytier/easytier/src/connector/mod.rs:91-94`, `connector/mod.rs:150-160`, `connector/http_connector.rs`). Each node collects its interface addresses and STUN-derived public addresses (`src/easytier/easytier/src/common/network.rs:204-310`). Other nodes fetch them over RPC to try direct connections (`src/easytier/easytier/src/connector/direct.rs:287-380`). NAT type and public endpoints come from STUN servers (`src/easytier/easytier/src/common/stun.rs:748-767`).

**Transport.** Tunnels implement a common `Tunnel` trait: TCP (`tunnel/tcp.rs`), UDP (`tunnel/udp.rs`), WireGuard via `boringtun` (`tunnel/wireguard.rs`), WebSocket/WSS (`tunnel/websocket.rs`), QUIC via `quinn` (`tunnel/quic.rs`) and an in-process ring tunnel (`tunnel/ring.rs`). Each peer connection (`PeerConn`) wraps its tunnel in an `MpscTunnel` with a 32-slot queue and a writer task (`src/easytier/easytier/src/peers/peer_conn.rs:138-181`, `src/easytier/easytier/src/tunnel/mpsc.rs:43-66`).

**Data path.** `VirtualNic` opens a single-queue L3 TUN device through the `tun-easytier` crate (`src/easytier/easytier/src/instance/virtual_nic.rs:369-443`). It spawns one task that reads the TUN and calls `PeerManager::send_msg_by_ip`, and one task that writes packets from peers into the TUN (`virtual_nic.rs:783-826`). Packets are `ZCPacket` buffers with headroom for the tunnel header and tailroom for the AES tag and nonce, so headers are written in place (`src/easytier/easytier/src/tunnel/packet_def.rs:300-332`).

**Identity.** There is no per-node key. Membership is proven by presenting the network name and the 32-byte secret digest in the handshake (`src/easytier/easytier/src/peers/peer_manager.rs:351-359`). The routing identity is the random peer ID (`peer_manager.rs:181`) plus a config-held instance UUID (`src/easytier/easytier/src/common/config.rs:626-633`). Virtual IPv4 addresses are static or picked by a simple DHCP scheme that defaults to 10.126.126.0/24 (`src/easytier/easytier/src/instance/instance.rs:695`).

# Protocol

## Control Plane

All control traffic is protobuf RPC carried in EasyTier packets of type `RpcReq`/`RpcResp` over the same peer links as data (`src/easytier/easytier/src/tunnel/packet_def.rs:61-75`, `src/easytier/easytier/src/peers/peer_manager.rs:810-832`). A link starts with the `HandShake` exchange in `PeerConn::do_handshake_as_client`/`do_handshake_as_server` (`peer_conn.rs:303-364`). The server checks the network name. For a foreign network name it either rejects the link (private mode) or hands it to the `ForeignNetworkManager`, which makes the node a relay for that other network (`peer_manager.rs:473-515`). Private mode is off by default and the relay whitelist is `*` (`src/easytier/easytier/src/common/config.rs:38`, `config.rs:51`). For the own network, `add_new_peer_conn` compares name and digest (`peer_manager.rs:351-359`).

After the handshake, each `PeerConn` sends a ping every second to measure latency and loss (`src/easytier/easytier/src/peers/peer_conn_ping.rs:63`). `PeerRoute` keeps one sync session per direct neighbour. It floods peer info and the connection bitmap through the mesh. Peers that stay unreachable for 90 s are removed (`src/easytier/easytier/src/peers/peer_ospf_route.rs:79`). RPC packets to a destination that is not known to be a public server are encrypted with the network key (`peer_manager.rs:86-102`).

## Data Plane

Outgoing: `do_forward_nic_to_peers` reads the IP version and destination (`virtual_nic.rs:684-781`). It then calls `send_msg_by_ip` (`peer_manager.rs:1169-1272`), which runs these steps:

1. Fill the 16-byte `PeerManagerHeader` (from/to peer ID, type, flags, forward counter, length; `packet_def.rs:91-102`).
2. Run the outbound ACL and NIC pipelines.
3. Map the destination IP to a peer ID or an exit node (`peer_manager.rs:1073-1153`).
4. Compress (zstd if enabled), then encrypt in place (`peer_manager.rs:1155-1167`).
5. Pick the next hop with `get_gateway_peer_id` and send on the peer's selected connection (`peer_manager.rs:1035-1064`, `src/easytier/easytier/src/peers/peer.rs:148-176`).

Broadcast and multicast destinations are cloned to every known peer (`peer_manager.rs:1082-1092`).

On the wire the TCP tunnel prefixes a 4-byte length (`packet_def.rs:15-20`). The UDP tunnel prefixes an 8-byte header with connection ID, message type and length (`packet_def.rs:42-50`). The encrypted payload ends with a 28-byte tail (16-byte tag, 12-byte nonce; `packet_def.rs:264-271`). The source comment gives the overhead as TUN MTU + 72 bytes for UDP and + 80 bytes for TCP (`packet_def.rs:331-332`).

Incoming: each `PeerConn` has a receive task that answers pings and pushes all other packets into one shared 128-slot channel (`peer_conn.rs:393-441`, `src/easytier/easytier/src/peers/mod.rs:54-58`). One `start_peer_recv` task handles that channel for the whole node (`peer_manager.rs:662-766`). Packets for another peer get their forward counter raised and are forwarded without decryption (`peer_manager.rs:681-719`). Packets for this node are decrypted, decompressed and checked by the inbound ACL. Data packets then go to the NIC channel and the TUN writer task.

Optional data-plane features are a KCP or QUIC proxy that carries TCP flows as KCP/QUIC streams to avoid TCP-in-TCP (`--enable-kcp-proxy`, `--enable-quic-proxy`, `src/easytier/easytier/src/core.rs:467-489`). A subnet proxy terminates TCP/UDP/ICMP to proxied CIDRs through kernel sockets or `smoltcp` (`src/easytier/easytier/src/gateway/tcp_proxy.rs:85-100`). A WireGuard "VPN portal" admits external WireGuard clients (`vpn_portal/wireguard.rs`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - UDP is a built-in transport with a default listener on port 11010 and is used for hole-punched links (`src/easytier/easytier/src/tunnel/udp.rs:234-299`, `src/easytier/easytier/src/tunnel/mod.rs:26-27`).
- [x] **Datagram encapsulation (no head-of-line blocking)** - Partial: UDP and WireGuard links send one datagram per packet (`src/easytier/easytier/src/tunnel/udp.rs:259`), but the default direct path prefers TCP (`src/easytier/easytier/src/connector/direct.rs:404-417`) and QUIC uses a single bidirectional stream (`src/easytier/easytier/src/tunnel/quic.rs:269`).
- [x] **TCP fallback** - The direct connector tries every advertised listener scheme by itself, TCP first, then UDP, then WG/WS/WSS (`src/easytier/easytier/src/connector/direct.rs:404-455`). Relayed paths can run over any peer's TCP link.
- [x] **QUIC support** - The default build includes the `quic` feature, and `quic://` URLs create a `QUICTunnelConnector` (`src/easytier/easytier/Cargo.toml:311`, `src/easytier/easytier/src/connector/mod.rs:101-116`).
- [x] **WebSocket support** - `ws://` and `wss://` are peer transports with default listeners on 11011/11012 (`src/easytier/easytier/src/connector/mod.rs:136-149`, `src/easytier/easytier/src/tunnel/mod.rs:26-27`).

### IP Support

- [x] **IPv4 support** - Inner IPv4 is the main mode, with static or DHCP-assigned addresses (`src/easytier/easytier/src/instance/virtual_nic.rs:684-733`, `src/easytier/easytier/src/instance/instance.rs:695`).
- [x] **IPv6 support** - Inner IPv6 is forwarded via `do_forward_nic_to_peers_ipv6` and routed by `get_msg_dst_peer_ipv6` (`src/easytier/easytier/src/instance/virtual_nic.rs:735-766`, `src/easytier/easytier/src/peers/peer_manager.rs:1125-1153`).
- [x] **Dual-stack** - The TUN device can get both an IPv4 and an IPv6 address at once (`src/easytier/easytier/src/instance/virtual_nic.rs:957-965`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - The TUN device is created as `Layer::L3` and routing is by IP (`src/easytier/easytier/src/instance/virtual_nic.rs:371`).
- [ ] **Layer 2 (Ethernet) mode** - Only L3 TUN devices are created, and no TAP path exists in the daemon (`src/easytier/easytier/src/instance/virtual_nic.rs:371`, `virtual_nic.rs:451`).
- [ ] **Bridging support** - Without L2 frames there is no bridging. LANs are reached only through the L3 subnet proxy (`src/easytier/easytier/src/gateway/tcp_proxy.rs:85`).

### Advanced Protocol Features

- [x] **Multipath/bonding** - A peer keeps several connections and `select_conn` sends on the lowest-latency one. The choice is re-evaluated every 5 s and on connection loss, so this is active-backup, not aggregation (`src/easytier/easytier/src/peers/peer.rs:100-107`, `peer.rs:148-167`).
- [x] **QoS/traffic shaping** - ACL rules have per-rule packet rate and burst limits enforced by token buckets, and relayed foreign-network traffic has a bps limit (`src/easytier/easytier/src/proto/acl.proto:65-66`, `src/easytier/easytier/src/common/acl_processor.rs:439-447`, `src/easytier/easytier/src/common/config.rs:55`).
- [x] **Multicast support** - IPv4 broadcast/multicast and IPv6 multicast destinations are copied to all peers (`src/easytier/easytier/src/peers/peer_manager.rs:1082-1092`, `peer_manager.rs:1134-1135`).

# Encryption

## Encryption Layer Details

**Key derivation.** There is no handshake key agreement. `GlobalCtx::get_128_key` feeds the network secret into `std::collections::hash_map::DefaultHasher` and takes two 64-bit outputs as the AES-128 key (`src/easytier/easytier/src/common/global_ctx.rs:316-331`). `get_256_key` does the same with the fixed string `"easytier-256bit-key"` and four 64-bit chunks (`global_ctx.rs:333-356`). `DefaultHasher::new()` is a fixed, unkeyed, fast non-cryptographic hash (SipHash-1-3 with zero keys in current Rust std, inferred). It is not a password KDF: no salt and no work factor. The key is the same for every node and every session of the network and is never rotated.

**Handshake.** The `HandshakeRequest` is sent unencrypted on every new link (`src/easytier/easytier/src/peers/peer_conn.rs:263-301`). It carries the network name and `network_secret_digest`, a 32-byte value made by `generate_digest_from_str(name, secret)` with the same `DefaultHasher` (`src/easytier/easytier/src/common/config.rs:281-288`, `src/easytier/easytier/src/tunnel/mod.rs:280-292`). Admission is an equality check of name and digest (`src/easytier/easytier/src/peers/peer_manager.rs:351-359`). The digest is static, so it works as a replayable bearer token.

**Data cipher.** With the default features, `create_encryptor` maps `aes-gcm` to `ring::aead::AES_128_GCM` (`src/easytier/easytier/src/peers/encrypt/mod.rs:70-74`). `encrypt` draws a random 12-byte nonce from `rand::thread_rng`, seals the payload in place with empty AAD, and appends tag and nonce (`src/easytier/easytier/src/peers/encrypt/ring_aes_gcm.rs:95-132`). The 16-byte EasyTier header is not authenticated. `aes-256-gcm` and `chacha20` use the 256-bit key with the same layout (`src/easytier/easytier/src/peers/encrypt/ring_chacha20.rs:69-100`). `xor` is a repeating-key XOR with no integrity (`src/easytier/easytier/src/peers/encrypt/xor_cipher.rs:21-24`). In `ring` 0.17.8 on x86_64, AES-GCM uses the stitched `aesni_gcm_encrypt`/`aesni_gcm_decrypt` assembly when AES-NI and AVX are present, AES-NI or VPAES/BSAES otherwise (`deps/easytier/cargo-vendor/ring-0.17.8/src/aead/aes_gcm.rs:87-120`, `deps/easytier/cargo-vendor/ring-0.17.8/src/aead/aes.rs:396-423`).

**Nonce and replay.** Nonces are random, not counters. There is no sequence number and no replay window anywhere in the EasyTier packet path. `decrypt` returns `Ok` without doing anything when the header's `ENCRYPTED` flag is clear (`ring_aes_gcm.rs:54-58`, `ring_chacha20.rs:33-37`). Nodes with and without encryption are tested to interoperate (`src/easytier/easytier/src/peers/peer_manager.rs:1643-1673`).

**Per-hop transports.** The `wg://` transport runs `boringtun` (Noise IKpsk2, X25519, ChaCha20-Poly1305, rekey after 120 s, replay window) underneath EasyTier packets (`deps/easytier/cargo-vendor/boringtun-easytier-0.6.1/src/noise/timers.rs:19`, `deps/easytier/cargo-vendor/boringtun-easytier-0.6.1/src/noise/session.rs:37-49`). Both ends use the same static private key, which is `generate_digest_from_str(network_name, network_secret)` (`src/easytier/easytier/src/tunnel/wireguard.rs:63-83`). That is the same 32 bytes that every TCP/UDP handshake sends in clear. WSS and QUIC use TLS with a self-signed certificate and `SkipServerVerification` (`src/easytier/easytier/src/tunnel/insecure_tls.rs:16`, `insecure_tls.rs:66-86`). They add obfuscation, not authentication.

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Partial: X25519 is used only inside the opt-in `wg://` hop transport, whose static key is derived from the network name and secret (`src/easytier/easytier/src/tunnel/wireguard.rs:63-83`). The default data key comes from hashing the secret (`src/easytier/easytier/src/common/global_ctx.rs:316-331`).
- [x] **Perfect Forward Secrecy** - Partial: only the `boringtun` layer of a `wg://` hop has ephemeral keys. The default AES-GCM key is static, so a leaked network secret decrypts all recorded traffic (`src/easytier/easytier/src/common/global_ctx.rs:316-331`).
- [ ] **Post-quantum readiness** - No KEM or hybrid exchange exists. Encryptors are created only from static keys (`src/easytier/easytier/src/peers/encrypt/mod.rs:54-117`).
- [x] **Key rotation** - Partial: `boringtun` rekeys `wg://` hops every 120 s (`deps/easytier/cargo-vendor/boringtun-easytier-0.6.1/src/noise/timers.rs:19`). The network data key is never rotated (`src/easytier/easytier/src/peers/peer_manager.rs:190-201`).

### Symmetric Encryption

- [x] **Authenticated encryption** - Default AES-128-GCM via `ring` `seal_in_place_separate_tag`/`open_in_place` (`src/easytier/easytier/src/peers/encrypt/ring_aes_gcm.rs:70-115`). The header is not covered (empty AAD), and unflagged packets bypass the check (`ring_aes_gcm.rs:54-58`).
- [x] **Hardware-accelerated crypto** - `ring` 0.17.8 dispatches to AES-NI/AVX `aesni_gcm_encrypt` on x86_64 and to ARMv8 AES where available (`deps/easytier/cargo-vendor/ring-0.17.8/src/aead/aes_gcm.rs:87-120`, `deps/easytier/cargo-vendor/ring-0.17.8/src/aead/aes.rs:396-423`).
- [x] **Constant-time operations** - Encryption uses `ring`, whose AES fallback is VPAES/BSAES or a constant-time `aes_nohw` path (`deps/easytier/cargo-vendor/ring-0.17.8/src/aead/aes.rs:154-195`). The digest comparison in `NetworkIdentity::eq` is a plain array compare (`src/easytier/easytier/src/common/config.rs:263-268`).

### Protocol Security

- [x] **Replay protection** - Partial: only `boringtun`'s counter window on opt-in `wg://` hops (`deps/easytier/cargo-vendor/boringtun-easytier-0.6.1/src/noise/session.rs:37-49`). The default AES-GCM path uses random nonces and keeps no replay state (`src/easytier/easytier/src/peers/encrypt/ring_aes_gcm.rs:102-104`).
- [x] **Noise Protocol** - Partial: only the opt-in `wg://` hop transport runs WireGuard's Noise IKpsk2 through `boringtun` (`src/easytier/easytier/src/tunnel/wireguard.rs:355`). The EasyTier handshake itself is a plaintext protobuf exchange (`src/easytier/easytier/src/peers/peer_conn.rs:263-301`).
- [ ] **No cleartext metadata** - The handshake sends the network name and the static secret digest in clear, and every packet carries clear from/to peer IDs (`src/easytier/easytier/src/peers/peer_conn.rs:265-282`, `src/easytier/easytier/src/tunnel/packet_def.rs:91-101`).
- [x] **End-to-end encryption through relays** - Partial: forwarding nodes do not decrypt (`src/easytier/easytier/src/peers/peer_manager.rs:681-719`). Foreign-network public servers lack the key, but every same-network relay holds the shared network key (`src/easytier/easytier/src/common/global_ctx.rs:316-331`).

# Performance

## Threading Model

`easytier-core` builds a Tokio multi-thread runtime with `max(2, multi_thread_count)` workers. The default count is 2 (`src/easytier/easytier/src/launcher.rs:201-206`, `src/easytier/easytier/src/common/config.rs:56`). All packet handling is async tasks on those two workers.

**TUN to socket.** `TunStream::poll_next` reads one packet per `read()` from the single-queue TUN fd. It reserves 4 KiB `BytesMut` chunks and splits each packet off with headroom and AES tailroom (`src/easytier/easytier/src/instance/virtual_nic.rs:70-100`). The `tun-easytier` crate opens `/dev/net/tun` with `IFF_TUN|IFF_NO_PI`. It rejects more than one queue, and it never sets `IFF_VNET_HDR` (`deps/easytier/cargo-vendor/tun-easytier-1.1.1/src/platform/linux/device.rs:91-100`). One task, `do_forward_nic_to_peers_task`, runs these per-packet steps (`virtual_nic.rs:783-805`, `src/easytier/easytier/src/peers/peer_manager.rs:1169-1272`):

1. Parse the IP header.
2. Run the ACL and route lookup.
3. Compress if enabled.
4. AES-GCM encrypt in place.
5. Push the packet into the chosen connection's 32-slot `MpscTunnel` queue.

A per-connection writer task drains that queue (`src/easytier/easytier/src/tunnel/mpsc.rs:43-96`):

- For TCP, `FramedWriter` collects up to 64 frames and flushes them with one vectored write (`src/easytier/easytier/src/tunnel/common.rs:218-220`, `common.rs:267-316`). Nagle is off (`src/easytier/easytier/src/tunnel/tcp.rs:36`).
- For UDP, packets go through a 128-slot ring to a task that calls `send_to` once per packet (`src/easytier/easytier/src/tunnel/udp.rs:234-266`, `udp.rs:711-712`).

**Socket to TUN.** For TCP, a `FramedReader` per connection reads into a 2000-byte-minimum buffer and splits frames (`common.rs:136-184`). For UDP, one task per socket calls `recv_buf_from` once per datagram (`udp.rs:268-299`). Each `PeerConn` receive task forwards packets into a single 128-slot channel. One `start_peer_recv` task decrypts, decompresses and filters everything for the node (`peer_manager.rs:662-766`). A third task writes each packet to the TUN with one `write()` (`virtual_nic.rs:807-826`).

Encryption and decryption can therefore run on the two workers at the same time. Each direction is serialized through one task, whatever the number of peers. No socket buffer sizes are set, `SO_REUSEPORT` is commented out (`common.rs:372-373`), and the default TCP/UDP path uses no `recvmmsg`/`sendmmsg`, GSO or GRO. The optional QUIC transport runs on `quinn-udp`, which uses `recvmmsg` with 32-message batches and GSO on Linux. EasyTier wraps its socket to disable GRO (`deps/easytier/cargo-vendor/quinn-udp-0.5.4/src/unix.rs:377-394`, `unix.rs:714`, `src/easytier/easytier/src/tunnel/quic.rs:40-82`).

## Performance Optimizations Checklist

### Threading

- [x] **Multi-threaded processing** - Partial: a 2-worker Tokio runtime lets the encrypting TUN task and the decrypting `start_peer_recv` task run on different cores (`src/easytier/easytier/src/launcher.rs:201-206`). Each direction is one task for all peers (`src/easytier/easytier/src/peers/peer_manager.rs:662`).
- [ ] **Multi-queue TUN / per-core sockets** - `tun-easytier` returns `InvalidQueuesNumber` for more than one queue, and `set_reuse_port` is commented out (`deps/easytier/cargo-vendor/tun-easytier-1.1.1/src/platform/linux/device.rs:91-94`, `src/easytier/easytier/src/tunnel/common.rs:372-373`).

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - Partial: only the opt-in QUIC transport, through `quinn-udp`'s `recvmmsg` (`deps/easytier/cargo-vendor/quinn-udp-0.5.4/src/unix.rs:377-394`). The UDP tunnel calls `recv_buf_from` per datagram (`src/easytier/easytier/src/tunnel/udp.rs:275`).
- [ ] **Batch UDP sends (sendmmsg)** - The UDP tunnel calls `send_to` per packet (`src/easytier/easytier/src/tunnel/udp.rs:259`), and `quinn-udp` uses `sendmsg` with GSO, not `sendmmsg`.
- [x] **Large batch sizes (64+)** - Partial: the TCP `FramedWriter` coalesces up to 64 frames per vectored write (`src/easytier/easytier/src/tunnel/common.rs:218-220`), but the feeding queue holds 32 (`src/easytier/easytier/src/tunnel/mpsc.rs:45`). UDP and TUN I/O are one packet per syscall.

### Offloads

- [x] **UDP GSO** - Partial: only on the opt-in QUIC transport, where EasyTier passes through `quinn-udp`'s `max_transmit_segments` (`src/easytier/easytier/src/tunnel/quic.rs:73-75`). The UDP tunnel sends plain datagrams (`src/easytier/easytier/src/tunnel/udp.rs:259`).
- [ ] **UDP GRO** - `NoGroAsyncUdpSocket` forces one receive segment for QUIC, and the UDP tunnel sets no `UDP_GRO` (`src/easytier/easytier/src/tunnel/quic.rs:40-82`).
- [ ] **TUN offload (virtio-net hdr)** - The TUN is opened with `IFF_TUN|IFF_NO_PI` only, with no `IFF_VNET_HDR` or `TUNSETOFFLOAD` (`deps/easytier/cargo-vendor/tun-easytier-1.1.1/src/platform/linux/device.rs:96-100`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - Partial: no free-list pool. Packets are split off shared `BytesMut` chunks (4 KiB per TUN read, 8 KB per UDP receive), so one allocation serves one to four packets (`src/easytier/easytier/src/instance/virtual_nic.rs:73`, `src/easytier/easytier/src/tunnel/udp.rs:274`).
- [ ] **Large UDP socket buffers (MB)** - No `SO_RCVBUF`/`SO_SNDBUF` is set anywhere in the daemon. `setup_sokcet2_ext` only sets non-blocking, reuse-address and bind-device (`src/easytier/easytier/src/tunnel/common.rs:347-407`).
- [x] **Zero-allocation parsing** - Headers are `zerocopy` views over the packet buffer, and encryption works in place with pre-reserved tailroom (`src/easytier/easytier/src/tunnel/packet_def.rs:14-102`, `packet_def.rs:300`, `src/easytier/easytier/src/peers/encrypt/ring_aes_gcm.rs:106-128`).

### MTU and Peers

- [ ] **Path MTU discovery** - No PMTU probing exists. The TUN MTU is fixed from the `mtu` flag (`src/easytier/easytier/src/instance/virtual_nic.rs:505-511`).
- [x] **Endpoint caching** - Each `Peer` caches the lowest-latency connection in `default_conn_id` and reuses it until it closes or the 5 s re-check (`src/easytier/easytier/src/peers/peer.rs:100-107`, `peer.rs:148-167`).

### Userspace TCP Stack

- [x] **Userspace TCP/IP stack** - `smoltcp` is an optional feature enabled by the normal `no_tun`/`use_smoltcp` config flags (`--no-tun`/`--use-smoltcp`). It serves the subnet proxy, no-TUN mode and SOCKS5, not the default datapath (`src/easytier/easytier/src/common/config.rs:36-37`, `src/easytier/easytier/src/gateway/tcp_proxy.rs:85-100`).

### Data Plane Compression

- [x] **Tunnel compression** - zstd compression of data payloads, off by default, enabled by `data_compress_algo` (`src/easytier/easytier/src/common/compressor.rs:88-122`, `src/easytier/easytier/src/common/config.rs:44`).
- [ ] **Configurable compression** - The only algorithm is `ZstdDefault` at a fixed default level. The setting is on/off, not an algorithm or level choice (`src/easytier/easytier/src/tunnel/packet_def.rs:273-278`).

# Security

## Known Security Issues

None found. The source tree has no security advisory or SECURITY file. No external CVE database was consulted, because the rules allow only the sources.

## Potential Security Concerns

- **Unflagged packets skip decryption.** `AesGcmCipher::decrypt` and `RingChaCha20Cipher::decrypt` return `Ok` when the `ENCRYPTED` header flag is clear (`src/easytier/easytier/src/peers/encrypt/ring_aes_gcm.rs:54-58`, `src/easytier/easytier/src/peers/encrypt/ring_chacha20.rs:33-37`). The header is not part of the AEAD. Anyone who can put a packet onto a peer link can therefore inject plaintext data or RPC packets that are accepted. That includes a member of the network, a relaying public server, or an on-path attacker on a UDP link who knows the clear `conn_id` (inferred for the last case).
- **Bearer digest sent in clear.** The 32-byte `network_secret_digest` is the only admission credential and is sent unencrypted in every handshake (`src/easytier/easytier/src/peers/peer_conn.rs:274-282`). A passive observer can replay it to join as a peer, take part in routing and inject unencrypted packets as above (inferred). The same value is the static WireGuard private key of every `wg://` hop (`src/easytier/easytier/src/tunnel/wireguard.rs:63-83`).
- **Weak key derivation.** Data keys and the digest come from `std` `DefaultHasher` with no salt or work factor (`src/easytier/easytier/src/common/global_ctx.rs:316-356`, `src/easytier/easytier/src/tunnel/mod.rs:280-292`). A captured digest or any captured ciphertext allows fast offline guessing of the network secret.
- **Static network-wide AES-GCM key with random nonces.** All nodes share one key for the life of the network and pick random 96-bit nonces (`ring_aes_gcm.rs:102-104`). Nonce collisions become likely after about 2^32 packets network-wide, and a collision breaks GCM authentication. No rekeying limits this.
- **No replay protection and no header authentication.** Packets can be replayed, and the from/to peer IDs and flags can be changed in flight (`ring_aes_gcm.rs:70-80` uses `Aad::empty()`).
- **Every node is an open relay by default.** `private_mode` is false and `relay_network_whitelist` is `*` (`src/easytier/easytier/src/common/config.rs:38`, `config.rs:51`). Any node with a listener accepts and relays traffic for unrelated networks (`src/easytier/easytier/src/peers/peer_manager.rs:473-515`).
- **Unsigned routing.** Route info is not signed. Any admitted peer can claim any virtual IP or proxy CIDR (`src/easytier/easytier/src/peers/peer_ospf_route.rs:1090-1146`).
- **Web console device token is the user name.** `get_user_id_by_token` looks up the user by name ("we don't have a token system"). Anyone who knows a user name can attach a device to that account on a config server (`src/easytier/easytier-web/src/db/mod.rs:71-91`). The default config server is `udp://config-server.easytier.cn:22020` (`src/easytier/easytier/src/web_client/mod.rs:122-128`).
- **TLS without verification.** WSS and QUIC clients skip certificate verification (`src/easytier/easytier/src/tunnel/insecure_tls.rs:16-76`).

## Security Features Checklist

### Network Security

- [ ] **Handshake rate limiting** - Listeners accept and handshake every connection with only a 5 s timeout. Token buckets exist only for ACL rules and foreign relay bandwidth (`src/easytier/easytier/src/peers/peer_conn.rs:244-261`, `src/easytier/easytier/src/common/acl_processor.rs:439-447`).
- [x] **Stateful packet filter** - ACL rules with `stateful = true` create conntrack entries (`src/easytier/easytier/src/proto/acl.proto:69`, `src/easytier/easytier/src/common/acl_processor.rs:547-560`).
- [x] **Fine-grained ACLs** - Inbound, outbound and forward chains match protocol, source/destination IPs and ports, with priorities (`src/easytier/easytier/src/proto/acl.proto:45-87`).
- [x] **Capability-based access** - Rules can match `source_groups`/`destination_groups`. Membership is proven by HMAC-SHA256 group proofs that peers verify (`src/easytier/easytier/src/proto/acl.proto:72-73`, `src/easytier/easytier/src/proto/peer_rpc.rs:9-39`, `src/easytier/easytier/src/peers/peer_ospf_route.rs:726-770`).

### Identity & Authentication

- [ ] **Identity validation** - Peer IDs are random 32-bit numbers and virtual IPs are self-declared. Nothing binds them to a key (`src/easytier/easytier/src/peers/peer_manager.rs:181`).
- [ ] **Signed config updates** - Route and peer info are exchanged by RPC without signatures (`src/easytier/easytier/src/peers/peer_ospf_route.rs:2338`).
- [ ] **Control-server key pinning** - N/A: the mesh has no controller. The optional config server is reached over an ordinary EasyTier tunnel (`src/easytier/easytier/src/web_client/mod.rs:157-163`).

### Implementation

- [x] **Memory-safe language** - The data path is Rust. It has a few `unsafe` buffer tricks in `TunStream` and `FramedReader` (`src/easytier/easytier/src/instance/virtual_nic.rs:75-88`, `src/easytier/easytier/src/tunnel/common.rs:166-171`).
- [ ] **Privilege separation** - The daemon runs as one root process. No setuid, capability drop or helper process exists (searched `src/easytier/easytier/src` for setuid/capset/drop).
- [ ] **Sandboxing** - No seccomp, landlock, chroot or similar code is present (same search over `src/easytier/easytier/src`).
- [x] **Audit logging** - Partial: connection and handshake errors, such as "network identity not match", reach stdout through the event printer by default (`src/easytier/easytier/src/instance/listeners.rs:242-246`, `src/easytier/easytier/src/instance_manager.rs:332-353`). ACL drops log at debug only, and tracing output is off by default (`src/easytier/easytier/src/peers/acl_filter.rs:228`, `src/easytier/easytier/src/utils.rs:36-39`, `utils.rs:109-113`).

# NAT Traversal

## How NAT Traversal Works

1. **Reach a first peer.** A node first connects to a configured peer, often a public server. Over that link it learns the route table and every node's listeners and addresses.
2. **Learn its own endpoints.** STUN servers give the node its public IPs and NAT type. The defaults are `txt:stun.easytier.cn`, `stun.miwifi.com`, `stun.chat.bilibili.com` and `stun.hitv.com`, plus `txt:stun-v6.easytier.cn` for IPv6 (`src/easytier/easytier/src/common/stun.rs:748-767`). `UdpNatTypeDetector` classifies the result as open, no-PAT, full cone, restricted, port-restricted, symmetric, or easy symmetric with incrementing or decrementing ports (`stun.rs:452-497`, `stun.rs:578`). UDP listeners also answer STUN binding requests, so EasyTier nodes act as reflectors for each other (`src/easytier/easytier/src/tunnel/udp.rs:124-204`).
3. **Try direct connections.** `DirectConnectorManager` tries each listener of each peer on all of the peer's interface and public IPs, with backoff and blacklisting (`src/easytier/easytier/src/connector/direct.rs:228-380`).
4. **Punch holes.** For peers still not directly connected, `UdpHolePunchConnector` picks a method from both NAT types (`src/easytier/easytier/src/connector/udp_hole_punch/mod.rs:525-530`). The two sides coordinate over peer RPC through the existing relay path (`select_punch_listener`, `send_punch_packet_*`, `mod.rs:83-155`):
   - cone-to-cone;
   - symmetric-to-cone, using a birthday-style spray from 84 sockets for hard symmetric NAT and port prediction for easy symmetric NAT (`src/easytier/easytier/src/connector/udp_hole_punch/sym_to_cone.rs:41-60`);
   - easy-symmetric-to-easy-symmetric, using 25 sockets and a ±20 port offset (`src/easytier/easytier/src/connector/udp_hole_punch/both_easy_sym.rs:29-31`).
5. **Fall back to relays.** If all of this fails, traffic stays on the multi-hop route through other peers or a public server.

There is no UPnP, NAT-PMP or PCP code.

## NAT Traversal Checklist

### Discovery

- [x] **No own public node needed** - The official GUI and web console default to the project's public server `tcp://public.easytier.top:11010` (`src/easytier/easytier-web/frontend-lib/src/types/network.ts:86-88`, `src/easytier/easytier/src/launcher.rs:519-525`). The bare CLI default has no peers.
- [x] **Public endpoint discovery (STUN or reflection)** - STUN against public servers, and peers' UDP listeners also answer STUN (`src/easytier/easytier/src/common/stun.rs:748-760`, `src/easytier/easytier/src/tunnel/udp.rs:146-204`).
- [x] **Multiple discovery servers** - Four IPv4 STUN servers and one IPv6 STUN server by default, replaceable by config, and several initial peers are allowed (`src/easytier/easytier/src/common/stun.rs:748-767`).
- [x] **NAT type detection** - `UdpNatTypeDetector` classifies 9 NAT types from STUN bind results (`src/easytier/easytier/src/common/stun.rs:452-497`).

### Port Mapping

- [ ] **UPnP port mapping** - No UPnP/IGD code or crate (searched `src/easytier/easytier` for upnp/igd).
- [ ] **NAT-PMP support** - No NAT-PMP code (same search).
- [ ] **PCP support** - No PCP code (same search).

### Hole Punching

- [x] **UDP hole punching** - Cone, symmetric-to-cone and easy-symmetric punching in `connector/udp_hole_punch/` (`src/easytier/easytier/src/connector/udp_hole_punch/mod.rs:525-530`).
- [x] **Symmetric NAT handling** - An 84-socket birthday spray for hard symmetric NAT and port prediction for incrementing/decrementing NATs (`src/easytier/easytier/src/connector/udp_hole_punch/sym_to_cone.rs:41`, `src/easytier/easytier/src/connector/udp_hole_punch/both_easy_sym.rs:29-31`).
- [x] **Rendezvous coordination** - The punch is coordinated by peer RPC (`UdpHolePunchRpc`) relayed over existing mesh links (`src/easytier/easytier/src/connector/udp_hole_punch/mod.rs:80-155`).

### Fallback

- [x] **Relay fallback** - Packets for peers without a direct link are forwarded by intermediate nodes using the route table (`src/easytier/easytier/src/peers/peer_manager.rs:681-719`, `peer_manager.rs:1035-1064`).
- [x] **Multiple relays** - Any node, and any number of public servers, can forward. Routes are recomputed by Dijkstra over all links (`src/easytier/easytier/src/peers/peer_ospf_route.rs:973-1010`).
- [x] **Latency-based relay selection** - `--latency-first` switches next-hop selection to `LeastCost` with latency costs from the peer center. The default is fewest hops (`src/easytier/easytier/src/peers/peer_manager.rs:992-998`, `src/easytier/easytier/src/peer_center/instance.rs:378-383`).
- [x] **TCP relay support** - Relaying works over any peer link, including the default TCP links to public servers (`src/easytier/easytier/src/peers/foreign_network_manager.rs:160-190`).

# Local Routing

## Peer Discovery on LANs

EasyTier has no broadcast or multicast peer discovery. Nodes on the same LAN find each other once both are in the mesh. Each node publishes its interface IPv4/IPv6 addresses through `collect_ip_addrs` (`src/easytier/easytier/src/common/network.rs:204-310`). `DirectConnectorManager` then connects to the other node's listeners on those addresses (`src/easytier/easytier/src/connector/direct.rs:287-380`). Without any shared peer, LAN nodes must list each other as peers by hand.

## Routing Features

Every node is a router. Routes come from the link-state sync and Dijkstra. Packets carry a forward counter capped at 8 hops (`src/easytier/easytier/src/peers/peer_manager.rs:681-692`). Nodes can advertise subnets with `-n/--proxy-networks` (`src/easytier/easytier/src/core.rs:201-207`). Clients pick a subnet's owner by longest prefix, and when several nodes advertise the same prefix, the shortest path wins (`src/easytier/easytier/src/peers/peer_ospf_route.rs:1112-1146`, `peer_ospf_route.rs:1163-1176`). `--exit-nodes` sends non-mesh destinations to the first reachable exit node, and `--enable-exit-node` lets a node act as one (`src/easytier/easytier/src/peers/peer_manager.rs:1095-1108`, `src/easytier/easytier/src/core.rs:335-347`). Magic DNS serves names under `et.net.` when `--accept-dns` is set (`src/easytier/easytier/src/instance/dns_server/mod.rs:15`, `src/easytier/easytier/src/core.rs:520-522`).

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - No LAN broadcast or multicast discovery. Broadcast sockets appear only in tests (`src/easytier/easytier/src/tests/three_node.rs:852-853`).
- [x] **Direct path advertisement** - Nodes advertise interface and public IPs and listeners via the GetIpList RPC (`src/easytier/easytier/src/common/network.rs:204-310`, `src/easytier/easytier/src/connector/direct.rs:287-380`).

### LAN Optimization

- [x] **Automatic LAN preference** - Direct connections to interface IPs are tried before hole punching. When a peer has several links, the lowest-latency one is used (`src/easytier/easytier/src/connector/direct.rs:304-330`, `src/easytier/easytier/src/peers/peer.rs:148-167`).
- [ ] **Trusted path mode** - Encryption is a node-wide flag, and no per-link plaintext mode exists (`src/easytier/easytier/src/peers/peer_manager.rs:190-201`).
- [x] **LAN-only mode** - Nodes work with only LAN peers configured. STUN failure leaves the NAT type unknown, which is treated as cone, and does not block links (`src/easytier/easytier/src/connector/udp_hole_punch/mod.rs:422-424`).

### Routing Features

- [x] **Subnet routes** - `--proxy-networks` advertises CIDRs, served by the kernel or `smoltcp` subnet proxy (`src/easytier/easytier/src/core.rs:201-207`, `src/easytier/easytier/src/gateway/tcp_proxy.rs:85`).
- [x] **Full tunnel mode** - `--exit-nodes` and `--enable-exit-node` route non-mesh traffic through a peer (`src/easytier/easytier/src/peers/peer_manager.rs:1095-1108`).
- [x] **Split tunneling** - By default only the virtual network and advertised CIDRs are routed into the TUN (`src/easytier/easytier/src/instance/virtual_nic.rs:828-912`).
- [x] **Route priorities** - Partial: among nodes advertising the same CIDR, the one with the shortest path wins and others take over when it disappears. There is no configurable priority (`src/easytier/easytier/src/peers/peer_ospf_route.rs:1077-1129`).
- [x] **Multi-hop routing via peers** - Ordinary nodes forward for others using the link-state routes, up to 8 hops (`src/easytier/easytier/src/peers/peer_manager.rs:681-719`).
- [x] **Built-in DNS** - Magic DNS resolves peer hostnames under `et.net.` with `--accept-dns` (`src/easytier/easytier/src/instance/dns_server/mod.rs:15`, `src/easytier/easytier/src/common/config.rs:50`).

# Central Point of Failure

## What Happens When the Public Server or Initial Peer Fails

EasyTier has no controller. The "public server" (shared node), or any initial peer from the config, is only the first link into the mesh and a relay and rendezvous point. When it goes away:

- Direct links that already exist keep working.
- Routing info keeps flowing over the remaining links.
- Peers that could only reach each other through that node lose connectivity. Their routes expire after 90 s (`src/easytier/easytier/src/peers/peer_ospf_route.rs:79`).
- New hole punches between NATed peers need some shared peer to relay the RPC.
- New nodes cannot join until one of their configured peers is reachable. `ManualConnectorManager` keeps retrying (`src/easytier/easytier/src/connector/manual.rs:145-168`).
- If the down node was the peer center (lowest peer ID), another node takes over that role (`src/easytier/easytier/src/peer_center/instance.rs:74-90`).

## Mitigation Strategies

- Configure several initial peers or public servers.
- Run your own public node: any `easytier-core` instance with a public listener relays and accepts other networks unless private mode is on (`src/easytier/easytier/src/common/config.rs:51`).
- Use `txt:`/`srv:`/HTTP peer URLs so the peer list can change without editing configs (`src/easytier/easytier/src/connector/mod.rs:91-94`, `connector/mod.rs:150-160`).

The optional web console (`easytier-web`) only pushes configs. Running instances do not depend on it.

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Direct `PeerConn`s and route sync do not depend on the initial peer (`src/easytier/easytier/src/peers/peer.rs:125-146`).
- [ ] **Local state caching** - The peer map and routes live only in memory. Only the config file and a machine-id file are persisted (`src/easytier/easytier/src/common/mod.rs:102-153`).
- [ ] **Cached credentials** - N/A: no controller issues credentials. The network secret is local config (`src/easytier/easytier/src/common/config.rs:281-288`).

### Redundancy

- [x] **Decentralized control plane** - Every node runs the same peer and exchanges link-state route info with ordinary peers over the `sync_route_info` RPC, with no controller (`src/easytier/easytier/src/peers/peer_ospf_route.rs:2180-2203,2336-2340`).
- [x] **Fully self-hostable** - Daemon, public server role (`foreign_network_manager.rs`) and web console (`easytier-web/`) are all in this repository.
- [ ] **Controller redundancy** - N/A: the mesh has no controller (`src/easytier/easytier/src/peers/peer_ospf_route.rs:2338`).
- [x] **Relay redundancy** - Any number of nodes relay at once, and routes are recomputed across them (`src/easytier/easytier/src/peers/peer_ospf_route.rs:973-1010`).
- [ ] **No single root of trust** - The single shared network secret both admits nodes and derives the data key (`src/easytier/easytier/src/common/global_ctx.rs:316-331`).

# Authentication

## How Nodes Join and Authenticate

A node is configured with a network name and network secret (CLI flags, TOML, or `ET_NETWORK_SECRET` env). On each new link the client sends its name and digest. The server replies with its own and accepts the link if both match (`src/easytier/easytier/src/peers/peer_conn.rs:303-364`, `src/easytier/easytier/src/peers/peer_manager.rs:351-359`). A different network name is accepted as a foreign network and relayed, unless private mode is on (`peer_manager.rs:473-515`). There is no CA, no per-node key, no approval step and no expiry. Optional ACL groups add HMAC-proven group membership (`src/easytier/easytier/src/proto/peer_rpc.rs:9-39`). Optional central management uses `--config-server`, where a node registers under a user name and receives configs from `easytier-web` (`src/easytier/easytier/src/web_client/mod.rs:115-165`).

## Authentication Checklist

### Enrollment Methods

- [x] **Pre-authentication keys** - The shared network secret admits any node without approval (`src/easytier/easytier/src/peers/peer_manager.rs:351-359`).
- [ ] **Certificate-based enrollment** - No certificates. TLS certificates are self-signed and not verified (`src/easytier/easytier/src/tunnel/insecure_tls.rs:16-86`).
- [ ] **OAuth/OIDC** - No OAuth/OIDC code in the daemon or `easytier-web` (searched for oidc/oauth/openid).
- [ ] **Interactive login** - Nodes never log in. The web console's password login is for admins only, and devices register by user name (`src/easytier/easytier-web/src/db/mod.rs:85-91`).
- [x] **CLI authentication** - `--network-name`/`--network-secret` on `easytier-core` (`src/easytier/easytier/src/core.rs:148-155`, `core.rs:725-729`).

### Authorization

- [ ] **Admin approval workflow** - Holding the secret is enough to join. No approval state exists (`src/easytier/easytier/src/peers/peer_manager.rs:351-359`).
- [ ] **Automated enrollment rules** - There is no rule engine for admission, only the name/digest check (`src/easytier/easytier/src/peers/peer_manager.rs:351-359`).
- [ ] **Ephemeral nodes** - There is no node registry that removes nodes. Unreachable peers only drop out of the route table after a 90 s timeout (`src/easytier/easytier/src/peers/peer_ospf_route.rs:79`, `peer_ospf_route.rs:2068`).
- [ ] **Node expiry** - Credentials are a shared secret with no lifetime (`src/easytier/easytier/src/common/config.rs:281-288`).

### Identity

- [x] **Stable device identity** - Partial: the instance UUID and a static virtual IP can persist in config, but the peer ID is random on every start and no device key exists (`src/easytier/easytier/src/common/config.rs:626-633`, `src/easytier/easytier/src/peers/peer_manager.rs:181`).
- [x] **Identity portability** - The identity is only the config (name, secret, IP, instance ID), which can be copied to another machine (`src/easytier/easytier/src/common/config.rs:222-288`).

# Platform Support

## Supported Platforms

The daemon has platform code for Linux (netlink), macOS and FreeBSD (`ifconfig`/`route` in `darwin.rs`) and Windows (Wintun) (`src/easytier/easytier/src/common/ifcfg/mod.rs:1-10`). CI builds FreeBSD (`src/easytier/.github/workflows/core.yml:129-131`). Android is supported through the Tauri GUI with a VPN service plugin, built in `mobile.yml` (`src/easytier/.github/workflows/mobile.yml:38-40`, `src/easytier/tauri-plugin-vpnservice`). OpenHarmony has its own build (`src/easytier/.github/workflows/ohos.yml`, `src/easytier/easytier-contrib/easytier-ohrs`). Magisk and JNI/FFI bindings are under `easytier-contrib/`. Official Docker images are published to Docker Hub and GHCR (`src/easytier/.github/workflows/docker.yml:75-76`). There is no iOS app in the tree. iOS devices can only join through the WireGuard VPN portal with a WireGuard client (`src/easytier/easytier/src/vpn_portal/wireguard.rs`).

## Implementation Details

Everything runs in userspace on Tokio. On Linux the TUN is opened through `tun-easytier` and configured over netlink (`src/easytier/easytier/src/common/ifcfg/netlink.rs`). The process needs root or `CAP_NET_ADMIN` for TUN and routes. `--no-tun` mode runs without a TUN device and uses `smoltcp` for proxying (`src/easytier/easytier/src/common/config.rs:36`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - Netlink ifcfg and the Linux TUN backend (`src/easytier/easytier/src/common/ifcfg/netlink.rs`, `deps/easytier/cargo-vendor/tun-easytier-1.1.1/src/platform/linux/device.rs`).
- [x] **macOS** - The darwin ifcfg and macOS TUN with a packet-info header (`src/easytier/easytier/src/common/ifcfg/mod.rs:1-2`, `src/easytier/easytier/src/instance/virtual_nic.rs:384-387`).
- [x] **Windows** - Wintun device, registry and firewall handling (`src/easytier/easytier/src/instance/virtual_nic.rs:390-433`, `src/easytier/easytier/src/common/ifcfg/windows.rs`).
- [x] **FreeBSD/OpenBSD** - FreeBSD only: darwin-style ifcfg and FreeBSD TUN, built in CI. There is no OpenBSD code (`src/easytier/easytier/src/common/ifcfg/mod.rs:1-2`, `src/easytier/.github/workflows/core.yml:129-131`).

### Mobile

- [x] **iOS** - Partial: no official iOS app or build. iOS devices join only through the WireGuard VPN portal with the third-party WireGuard client (`src/easytier/easytier/src/vpn_portal/wireguard.rs`).
- [x] **Android** - The official Tauri Android app with `tauri-plugin-vpnservice` is built in CI (`src/easytier/.github/workflows/mobile.yml:38-40`).

### Implementation

- [ ] **Kernel-mode datapath** - All encryption and forwarding run in userspace tasks (`src/easytier/easytier/src/peers/peer_manager.rs:662-766`).
- [x] **Container support** - The official Alpine-based image is pushed as `easytier/easytier` and `ghcr.io/easytier/easytier` (`src/easytier/.github/workflows/Dockerfile`, `src/easytier/.github/workflows/docker.yml:75-76`).
