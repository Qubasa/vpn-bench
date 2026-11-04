# Overview

tinc is a mesh VPN daemon (`tincd`) with a control CLI (`tinc`), written in C by Guus Sliepen, Ivo Timmermans and contributors (`src/tinc/COPYING:1`). This report covers release 1.1pre18 (`src/tinc/NEWS:1`), built with autotools, OpenSSL 3.6.0, LZO 2.10 and zlib 1.3.1 (`deps/tinc/openssl/VERSION.dat:1-3`, `deps/tinc/lzo/NEWS:5`, `deps/tinc/zlib/zlib.h:40`). The license is GPL version 2 or later (`src/tinc/COPYING:4-7`), with an extra exemption that allows linking against OpenSSL (`src/tinc/COPYING.README:3-6`).

Each node has a name, an Ed25519 key pair and, in the default build, a 2048-bit RSA key pair as well (`tincctl.c:2288-2296`). Nodes open authenticated TCP "meta connections" to the peers listed in `ConnectTo` or picked by `AutoConnect`. They flood edges (who is connected to whom) and subnets (which addresses live behind which node) over these connections. Every node runs its own graph algorithm on that data to find next hops (`graph.c:126`), so there is no central server. For tunnel traffic, each pair of nodes runs its own SPTPS session ("Simple Peer-to-Peer Security", tinc's own protocol). That session is an ephemeral ECDH handshake signed with Ed25519, then ChaCha20-Poly1305 records sent as UDP datagrams on port 655 (`net_setup.c:843-844`). If UDP does not work yet, the same encrypted records go over the TCP meta connections, either directly or relayed by other nodes.

At a glance:

- **Language:** C (`src/tinc/src/*.c`), with in-tree ChaCha20, Poly1305 and Ed25519 code and OpenSSL for the legacy protocol and the key-derivation HMAC.
- **License:** GPL-2.0-or-later with an OpenSSL linking exception (`COPYING:4-7`, `COPYING.README:3-6`).
- **Default peer transport:** SPTPS records in UDP datagrams to port 655, sent directly between peers. The fallbacks are the TCP meta connection and UDP or TCP relaying through other nodes (`net_packet.c:865-898`).
- **Data cipher (default):** ChaCha20-Poly1305 in portable C (`chacha-poly1305/chacha-poly1305.c:43-69`). The alternative is the tinc 1.0 "legacy" protocol, which defaults to AES-256-CBC with HMAC-SHA256 cut to 4 bytes (`net_setup.c:974-1005`). The legacy cipher and digest can be any OpenSSL name.
- **Handshake:** SPTPS is a custom construction. Each side sends an ephemeral Curve25519 ECDH key and a nonce, signs both KEX messages with its long-term Ed25519 key, and derives keys with a TLS 1.0-style PRF over HMAC-SHA512 (`sptps.c:156-248`, `openssl/prf.c:81-86`). It is not Noise and not TLS.
- **Default tunnel MTU:** tincd does not set the interface MTU on Linux (`linux/device.c:49-132` has no MTU ioctl), so the kernel's TUN default of 1500 applies unless `tinc-up` changes it (inferred). The internal frame limit is `MTU 1518` (`net.h:32`). Per-peer path MTU discovery finds about 1425 bytes of inner IP on a 1500-byte IPv4 underlay (inferred from the overhead arithmetic in `net_packet.c:1188-1197`).
- **Control-plane model:** fully distributed (every node floods and computes the graph itself).
- **Data-plane threading:** single-threaded, one `select()` event loop for TUN, UDP and TCP (`event.c:319-374`).

## Key Architecture Components

**Control plane (meta protocol).** Nodes exchange line-based text requests (ID, ACK, ADD_EDGE, ADD_SUBNET, REQ_KEY, ANS_KEY and others) over TCP meta connections (`protocol.h:28-29`, protocol 17.7). The connection opens with a cleartext `ID name 17.x` line (`protocol_auth.c:175`). Both sides then run SPTPS in stream mode with the label `tinc TCP key expansion` (`protocol_auth.c:477-487`). A peer is accepted only if its host file exists in `hosts/` (`protocol_auth.c:444-450`). Edges and subnets are flooded to all nodes. A minimum spanning tree (`graph.c:68`) carries broadcasts, and a BFS with edge-weight tie-breaking (`graph.c:126-200`) picks `nexthop` and `via` for each node.

**Discovery.** There are no discovery servers. Bootstrap addresses come from `Address` lines in host files and from an on-disk cache of recently working addresses (`address_cache.c:107-111`). `AutoConnect` is on by default (`net_setup.c:692-694`) and keeps 3 meta connections, also dialing nodes that are unreachable (`autoconnect.c:168-193`). Nodes on the path append the sender's reflexive UDP address to ANS_KEY and UDP_INFO messages (`protocol_key.c:442-446`, `protocol_misc.c:149-209`).

**Transport.** UDP sockets bound to port 655 for IPv4 and IPv6 carry SPTPS datagrams. The format is a 6-byte destination ID, a 6-byte source ID, a 4-byte sequence number, then encrypted type, payload and a 16-byte tag (`net_packet.c:900-927`, `sptps.c:94-113`). TCP meta connections carry handshakes and fallback data (`protocol_misc.c:84-129`).

**Data path.** TUN or TAP via `/dev/net/tun` (`linux/device.c:59-117`), a built-in IPv4/IPv6/ARP/NDP router (`route.c:623-1060`), per-peer SPTPS datagram sessions (`protocol_key.c:115-131`) and `recvmmsg`/`sendto` on UDP (`net_packet.c:1730-1799`, `net_packet.c:942`).

**Identity.** A node name plus an Ed25519 public key stored in `hosts/<name>` (`protocol_auth.c:452-454`). The 6-byte node ID in UDP headers is the first 6 bytes of SHA-512(name) (`node.c:124`). Invitations (`tinc invite` / `tinc join`) hand out a single-use cookie that pins the inviter's key (`invitation.c:443-519`).

# Protocol

## Control Plane

The meta protocol runs over TCP. The ID exchange is plaintext. When both sides know each other's Ed25519 key and speak protocol minor 2 or later, the rest of the connection is an SPTPS stream session: 2-byte cleartext length, then the record type and body encrypted with ChaCha20-Poly1305 (`sptps.c:115-138`, `protocol_auth.c:477-487`). Without Ed25519 keys, the node falls back to the legacy RSA METAKEY/CHALLENGE exchange (`protocol_auth.c:494-775`). A peer that knows the other side's Ed25519 key refuses that rollback (`protocol_auth.c:463-469`). A node that sees an older peer without an Ed25519 key "upgrades" it by sending its key through the legacy channel (`protocol_auth.c:778-948`).

After ACK, the nodes exchange all known edges and subnets (`protocol_auth.c:876-907`). These are flooded with duplicate suppression (`seen_request`). Every node recomputes the MST and the shortest paths (`graph.c:68`, `graph.c:126`). The edge weight is the measured connection setup time in milliseconds unless `Weight` is set (`protocol_auth.c:846`, `protocol_auth.c:869-871`). Per-peer SPTPS sessions for data start with REQ_KEY and ANS_KEY messages that ride the meta connections hop by hop (`protocol_key.c:104-131`, `net_packet.c:886-897`). Keys of nodes that are not direct neighbours can be fetched over the mesh with REQ_PUBKEY/ANS_PUBKEY and are then written to the host file (`protocol_key.c:194-223`).

## Data Plane

In the default `Mode = router` (`route.c:36`), tincd opens a TUN device with packet information (`linux/device.c:79-82`). It reads one packet per event into a stack `vpn_packet_t` (`net_packet.c:1801-1813`), looks up the destination subnet (`route.c:631-701`) and calls `send_packet` (`net_packet.c:1448`). `send_sptps_packet` strips the 14-byte fake Ethernet header in router mode and can compress the payload. It then calls `sptps_send_record` (`net_packet.c:574-623`). The record is copied into a stack buffer and encrypted in place (`sptps.c:94-113`). `send_sptps_data` then copies it again behind the 12-byte ID header and sends it with `sendto` (`net_packet.c:865-963`).

Large packets go over TCP: any record larger than the relay's confirmed `minmtu`, all handshake records, and all traffic when `TCPOnly` is set (`net_packet.c:873-897`). Since `minmtu` starts at 0 (`node.c:194`), the first packets to a new peer go over TCP until UDP probes confirm a path MTU. On receive, `recvmmsg` fetches up to 64 datagrams (`net_packet.c:1735-1759`). `handle_incoming_vpn_packet` finds the sender by address or by source ID and relays the packet without decrypting it if the destination ID is another node (`net_packet.c:1612-1706`). Otherwise it decrypts and checks the replay window (`sptps.c:531-598`). `receive_sptps_record` rebuilds the Ethernet header and routes the packet to the TUN device (`net_packet.c:965-1063`).

In `Mode = switch` or `hub`, a TAP device is used and the full Ethernet frame is sent with the `PKT_MAC` flag (`linux/device.c:83-91`, `net_packet.c:587-591`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - SPTPS data records are sent as UDP datagrams to the peer or relay with `sendto` in `send_sptps_data` (`net_packet.c:942`).
- [x] **Datagram encapsulation (no head-of-line blocking)** - On the default UDP path each inner packet is one SPTPS datagram record with its own sequence number (`sptps.c:94-113`). Only fallback traffic is carried in the TCP meta stream.
- [x] **TCP fallback** - `send_sptps_data` sends a record over the TCP meta connection on its own when UDP is not confirmed (`minmtu` too small), when `TCPOnly` is set, or when the relay cannot handle UDP relaying (`net_packet.c:873-897`).
- [ ] **QUIC support** - Not supported: the only transports are UDP sockets and TCP meta connections (`net_socket.c`), and there is no QUIC code in `src/` or `deps/`.
- [ ] **WebSocket support** - Not supported: the `Proxy` option knows only socks4, socks4a, socks5, http CONNECT and exec (`net_setup.c:457-495`), and there is no WebSocket code.

### IP Support

- [x] **IPv4 support** - `route_ipv4` routes IPv4 packets by subnet lookup (`route.c:623-704`).
- [x] **IPv6 support** - `route_ipv6` and `route_neighborsol` handle IPv6 and NDP (`route.c:708-956`).
- [x] **Dual-stack** - The same TUN device carries both families, and `receive_sptps_record` restores the EtherType from the IP version nibble (`net_packet.c:1037-1055`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - `Mode = router` is the default (`route.c:36`) and uses a TUN device (`linux/device.c:79-82`).
- [x] **Layer 2 (Ethernet) mode** - `Mode = switch` and `Mode = hub` carry Ethernet frames on a TAP device (`net_setup.c:558-568`, `linux/device.c:83-91`), with MAC learning in `route_mac` (`route.c:1028-1060`).
- [x] **Bridging support** - In switch mode tinc learns MAC addresses seen from the local TAP device as its own subnets (`route.c:527-560`), so a TAP bridged with a LAN carries non-VPN devices at Layer 2 (bridge setup is done by the admin's scripts, inferred).

### Advanced Protocol Features

- [ ] **Multipath/bonding** - Not supported: each node has one `address`/`sock` and one `nexthop`/`via` at a time (`net_packet.c:637-678`, `graph.c:188-196`).
- [x] **QoS/traffic shaping** - Partial: `PriorityInheritance` copies the inner TOS/TCLASS byte to the outer UDP socket (`route.c:672-674`, `net_packet.c:812-842`), and TCP fallback uses random early drop (`protocol_misc.c:88`). There are no queues or rate limits.
- [x] **Multicast support** - Packets to `224.0.0.0/4`, `ff00::/8` and broadcast addresses are default broadcast subnets (`net_setup.c:620-630`) and are flooded along the MST (`net_packet.c:1509-1534`).

# Encryption

## Encryption Layer Details

**Handshake.** SPTPS (`sptps.c`) has three steps. Each side sends a KEX record: a version byte, a 32-byte random nonce and a fresh ephemeral public key (`sptps.c:156-182`). The ephemeral key is an Ed25519 point from `ed25519_create_keypair` on a random seed (`ed25519/ecdh.c:33-41`). Each side then sends a SIG record: an Ed25519 signature with its long-term key over the initiator flag, both KEX records and a session label (`sptps.c:185-205`). The label binds the session to both node names and to its purpose, "tinc TCP key expansion" or "tinc UDP key expansion" (`protocol_auth.c:479-485`, `protocol_key.c:123-124`). The shared secret is X25519. `ed25519_key_exchange` maps the Edwards point to its Montgomery u-coordinate and runs a Montgomery ladder with `fe_cswap` (`ed25519/key_exchange.c:29-79`). Finally an empty ACK record switches to the new keys (`sptps.c:251-278`, `sptps.c:356-370`).

**Key derivation.** `generate_key_material` builds the seed "key expansion" + initiator nonce + responder nonce + label. It derives 128 bytes with a TLS 1.0-style P_hash over HMAC-SHA512, run through OpenSSL (`sptps.c:208-248`, `openssl/prf.c:32-86`). Each direction gets its own 64-byte ChaCha20-Poly1305 key (`sptps.c:263-270`, `sptps.c:362-370`).

**Data cipher.** `chacha_poly1305_encrypt` is the OpenSSH-style ChaCha20-Poly1305. The 64-bit nonce is the record sequence number. ChaCha20 block 0 gives the Poly1305 key, and the payload is encrypted from block 1 (`chacha-poly1305/chacha-poly1305.c:43-69`). The code is D. J. Bernstein's portable `chacha-merged.c` and Andrew Moon's `poly1305-donna-unrolled` (`chacha-poly1305/chacha.c:1-5`, `chacha-poly1305/poly1305.c:1-4`). It has no SIMD code and does not call OpenSSL. A datagram record adds 21 bytes: 4 bytes of cleartext sequence number, 1 type byte and a 16-byte tag (`sptps.h:43`).

**Legacy alternative.** When a peer has no Ed25519 key, or `ExperimentalProtocol = no` is set (`net_setup.c:865-875`), tinc uses the 1.0 protocol: RSA key transport over the meta connection, per-node AES-256-CBC by default, and HMAC-SHA256 cut to `MACLength = 4` bytes (`net_setup.c:974-1005`, `net_packet.c:767-797`). That mode is encrypt-then-MAC with a 32-bit tag and has no forward secrecy.

**Nonce and replay handling.** `outseqno` is a 32-bit counter that increments for every record (`sptps.h:67`, `sptps.c:98`). The receiver decrypts first and then checks a sliding-window bitmap. `ReplayWindow` defaults to 16 bytes, which is 128 packets (`sptps.c:31`, `sptps.c:446-508`, `sptps.c:564-570`). Packets far ahead of the window are dropped until a quarter of the window size has been seen, then the window jumps forward (`sptps.c:454-474`).

**Rekeying.** The `KeyExpire` timer (default 3600 s, `net_setup.c:688-690`) calls `regenerate_key` and `send_key_changed`. That forces a new SPTPS KEX with every reachable peer (`net_setup.c:347-362`, `protocol_key.c:54-61`, `sptps.c:376-383`). The timer is only built when the legacy protocol is compiled in (`net_setup.c:344-353`, `net_setup.c:988-990`), which is the default (`configure.ac:222-228`). The 32-bit sequence number is not reset on rekey. TCP meta-connection SPTPS sessions are not rekeyed at all.

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Session keys come from X25519 on ephemeral keys via `ecdh_compute_shared` and `ed25519_key_exchange` (`ed25519/ecdh.c:43-47`, `ed25519/key_exchange.c:4-80`).
- [x] **Perfect Forward Secrecy** - A new ECDH key pair is generated for each KEX (`sptps.c:177`) and freed after use (`ed25519/ecdh.c:45`). Long-term Ed25519 keys only sign (`sptps.c:199`). The legacy RSA mode has no PFS.
- [ ] **Post-quantum readiness** - Not supported: the only key exchange in SPTPS is X25519 (`sptps.c:156-182`), and there is no KEM code.
- [x] **Key rotation** - By default the `KeyExpire` timer forces a new SPTPS KEX with each peer every 3600 s (`net_setup.c:688-690`, `protocol_key.c:54-61`).

### Symmetric Encryption

- [x] **Authenticated encryption** - SPTPS data records use ChaCha20-Poly1305 AEAD (`sptps.c:107`, `chacha-poly1305/chacha-poly1305.c:43-106`).
- [x] **Hardware-accelerated crypto** - Partial: the default SPTPS cipher is portable C with no SIMD or AES-NI (`chacha-poly1305/chacha.c:82-100`). Only the opt-in legacy protocol uses OpenSSL EVP AES-256-CBC, which dispatches to `aesni_cbc_encrypt` on capable CPUs (`openssl/cipher.c:148-155`, `deps/tinc/openssl/providers/implementations/ciphers/cipher_aes_hw_aesni.inc:32-57`).
- [x] **Constant-time operations** - Partial: X25519 uses a `fe_cswap` ladder (`ed25519/key_exchange.c:45-75`) and Ed25519 base-point multiplication uses `cmov` (`ed25519/ge.c:349-363`), but the Poly1305 tag check is a plain `memcmp` (`chacha-poly1305/chacha-poly1305.c:95`). The legacy HMAC check is also `memcmp` (`openssl/digest.c:137-141`).

### Protocol Security

- [x] **Replay protection** - `sptps_check_seqno` keeps a 128-packet sliding-window bitmap by default (`sptps.c:31`, `sptps.c:446-508`).
- [ ] **Noise Protocol** - Not supported: SPTPS is a custom signed-ECDHE protocol with a TLS-style PRF (`sptps.c:33-51`, `openssl/prf.c:28-30`), not a Noise pattern.
- [ ] **No cleartext metadata** - The meta connection begins with a plaintext `ID <nodename> 17.x` line (`protocol_auth.c:175`), and every UDP datagram carries cleartext 6-byte source and destination IDs derived from SHA-512 of the node name (`net_packet.c:906-923`, `node.c:124`).
- [x] **End-to-end encryption through relays** - Per-pair SPTPS sessions are end to end. Relays forward the encrypted record by destination ID without decrypting it (`net_packet.c:1700-1705`), and TCP relays forward `SPTPS_PACKET` as opaque data (`protocol_key.c:148-163`). Legacy-protocol traffic relayed over TCP is decrypted at each hop.

# Performance

## Threading Model

tincd is one process with one thread. `event_loop` calls `select()` over all registered fds and dispatches callbacks one at a time (`event.c:319-374`). The only `pthread_create` is in the miniupnpc helper (`upnp.c:191-192`), which this build does not compile (`src/Makefile.am`: `if MINIUPNPC`, `m4/miniupnpc.m4:5-8`; no miniupnpc in `deps/`).

**TUN to UDP.** `handle_device_data` runs once per readable event and does one `read()` of one packet into a stack `vpn_packet_t` (`net_packet.c:1801-1813`, `linux/device.c:147-167`). In TUN mode the read lands at offset 10, so the 4-byte packet-info header ends up where the EtherType goes (`linux/device.c:152-166`). `route()` → `route_ipv4` does a cached subnet lookup, an MTU check, MSS clamping and then `send_packet` (`route.c:623-704`). `send_packet` calls `send_sptps_packet` and then `try_tx` on every packet. `try_tx` checks key state, UDP keepalive and PMTU timers (`net_packet.c:1481-1484`, `net_packet.c:1368-1409`). `sptps_send_record` → `send_record_priv_datagram` copies the payload into a stack VLA and encrypts it in place (`sptps.c:94-113`). `send_sptps_data` copies it once more behind the 12-byte ID header and calls `sendto` once per packet (`net_packet.c:906-942`).

**UDP to TUN.** `handle_incoming_vpn_data` calls `recvmmsg(..., MAX_MSG = 64, MSG_DONTWAIT)` into a static array of 64 packets (`net_packet.c:1735-1777`). Each packet is handled in turn: sender lookup, decrypt into a stack VLA (`sptps.c:561-566`), copy into a fresh stack `vpn_packet_t` (`net_packet.c:983-1034`), route, then one `write()` per packet to the TUN device (`linux/device.c:196-203`).

**Costs.** There is no GSO, GRO or virtio-net header; the TUN device is opened with plain `IFF_TUN` (`linux/device.c:80`). UDP sockets ask for 1 MiB `SO_RCVBUF`/`SO_SNDBUF` (`net_socket.c:42-43`, `net_socket.c:288-293`) and set `IP_PMTUDISC_DO` (`net_socket.c:308-312`). `logger()` always runs `vsnprintf` into a 1024-byte buffer and only then checks the debug level (`logger.c:124-137`, `logger.c:52`). Several `DEBUG_TRAFFIC` log calls sit on the per-packet path (`linux/device.c:185`, `linux/device.c:192`, `net_packet.c:290`, `net_packet.c:940`, `net_packet.c:1465`), so each packet pays for several string formats even at log level 0. Crypto is portable scalar C. Encryption, routing, logging and all I/O for every peer share one core.

## Performance Optimizations Checklist

### Threading

- [ ] **Multi-threaded processing** - Not supported: all packet processing runs in the single `select()` loop (`event.c:319-374`).
- [ ] **Multi-queue TUN / per-core sockets** - Not supported: TUNSETIFF uses `IFF_TUN` or `IFF_TAP|IFF_NO_PI` without `IFF_MULTI_QUEUE` (`linux/device.c:79-109`), and there is one UDP socket per listen address with only `SO_REUSEADDR` (`net_socket.c:285`).

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - `handle_incoming_vpn_data` uses `recvmmsg` when `HAVE_RECVMMSG` is set, and configure detects it on Linux (`net_packet.c:1735-1759`, `configure.ac:189`).
- [ ] **Batch UDP sends (sendmmsg)** - Not supported: each packet is sent with its own `sendto` (`net_packet.c:942`).
- [x] **Large batch sizes (64+)** - The `recvmmsg` batch is `MAX_MSG 64` (`net_packet.c:1736`). TUN reads and UDP sends are still one packet per call.

### Offloads

- [ ] **UDP GSO** - Not supported: there is no `UDP_SEGMENT` setsockopt anywhere in `src/` (`net_socket.c:280-345`).
- [ ] **UDP GRO** - Not supported: there is no `UDP_GRO` setsockopt, and `recvmmsg` buffers are one `MAXSIZE` packet each (`net_packet.c:1746-1749`).
- [ ] **TUN offload (virtio-net hdr)** - Not supported: there is no `IFF_VNET_HDR` or `TUNSETOFFLOAD` in `linux/device.c:79-109`.

### Buffers and Parsing

- [x] **Buffer pool reuse** - Partial: the 64 receive buffers are a static array reused across calls (`net_packet.c:1737-1741`), and other packet buffers are stack locals (`net_packet.c:1804`, `sptps.c:95`), but there is no general pool.
- [x] **Large UDP socket buffers (MB)** - `udp_rcvbuf` and `udp_sndbuf` default to 1 MiB and are applied with `SO_RCVBUF`/`SO_SNDBUF` (`net_socket.c:42-43`, `net_socket.c:288-293`).
- [x] **Zero-allocation parsing** - The hot path uses stack VLAs and static arrays with no `malloc` (`sptps.c:95`, `sptps.c:561`, `net_packet.c:983`), although it copies each packet two to three times and formats unused log strings (`logger.c:124-137`).

### MTU and Peers

- [x] **Path MTU discovery** - `try_mtu` sends exponentially spaced UDP probes, fixes the MTU after 20 probes and re-probes `maxmtu+1` periodically (`net_packet.c:1246-1353`). It seeds the search from `IP_MTU` (`net_packet.c:1149-1236`).
- [x] **Endpoint caching** - The confirmed UDP address is kept per node (`n->address`, `udp_confirmed`, `net_packet.c:637-645`), and up to 8 recent meta-connection addresses are saved in `cache/<node>` (`address_cache.c:107-111`, `address_cache.h:25`).

### Userspace TCP Stack

- [ ] **Userspace TCP/IP stack** - Not supported: packets go only to a kernel TUN/TAP or raw/multicast/fd device (`net_setup.c:1047-1077`), and there is no netstack code.

### Data Plane Compression

- [x] **Tunnel compression** - `Compression` (default 0) enables per-packet zlib levels 1-9 or LZO levels 10-11 in `compress_packet` (`net_setup.c:1021-1028`, `net_packet.c:209-241`).
- [x] **Configurable compression** - Each node chooses the algorithm and level it wants to receive with `Compression = 0..11`, and the level is announced in ANS_KEY (`net_setup.c:1021-1025`, `protocol_key.c:465-470`).

# Security

## Known Security Issues

None found for 1.1pre18 in the sources. `NEWS` lists CVE-2018-16737 and CVE-2018-16738 (oracle attacks on the legacy protocol) and CVE-2018-16758 (forcing a NULL UDP cipher in the legacy protocol) as fixed in 1.1pre17 (`NEWS:21-26`). This version includes those fixes. The rules did not allow checking external advisory databases, so advisories published after this release are not covered here (inferred limitation). The bundled OpenSSL is 3.6.0 (`deps/tinc/openssl/VERSION.dat:1-3`).

## Potential Security Concerns

- **Unsigned routing state.** Any authenticated member can announce ADD_SUBNET for any owner name. `add_subnet_h` looks up the owner by name and accepts it unless `StrictSubnets` or `TunnelServer` is set (`protocol_subnet.c:79`, `protocol_subnet.c:120`). With default settings, one compromised node can redirect traffic for other nodes' subnets. The traffic stays encrypted to the attacker's own key, not to the victim's.
- **Trust-on-first-use for indirect keys.** If a node lacks a peer's Ed25519 key, it sends REQ_PUBKEY through the mesh and saves whatever ANS_PUBKEY returns to the host file (`protocol_key.c:207-222`). An intermediate node can substitute its own key for nodes the receiver has not met before.
- **Non-constant-time tag comparison.** Poly1305 tags (`chacha-poly1305/chacha-poly1305.c:95`) and legacy HMACs (`openssl/digest.c:140`) are compared with `memcmp`. This could leak timing information to a network attacker (practical impact unknown, inferred).
- **Legacy protocol on by default.** The default build includes the 1.0 protocol (`configure.ac:222-228`), and `tinc init` creates an RSA key (`tincctl.c:2288-2290`). Peers without Ed25519 keys negotiate AES-256-CBC with a 4-byte HMAC tag and no forward secrecy (`net_setup.c:994`). Rollback is blocked only for peers whose Ed25519 key is already known (`protocol_auth.c:463-469`).
- **Cleartext identities.** Node names go out in plaintext at the start of each meta connection (`protocol_auth.c:175`), and node IDs, which are SHA-512 of the name, appear in every UDP header (`node.c:124`).
- **Sequence-number wrap and missing meta rekey.** `outseqno` is 32 bits and is not reset on rekey (`sptps.h:67`, `sptps.c:376-383`). TCP meta-connection sessions never rekey. After 2^32 records in one session, sequence numbers repeat and the replay window rejects them (`sptps.c:475-478`).
- **CPU cost of unknown senders.** For packets from unconfirmed addresses, `try_harder` tries `sptps_verify_datagram` (a full decrypt) against candidate nodes (`net_packet.c:1562-1610`). Full scans are limited to once per second. Decrypt failures and replay drops are logged at the default level for every packet (`sptps.c:463-478`, `sptps.c:565`, `logger.c:140-162`).
- **Root scripts.** `tinc-up`, `host-up` and `subnet-up` scripts run as the daemon user (`script.c`). Privileges are kept unless `-U` is given (`tincd.c:290-335`).
- **Stale `msg_namelen` in the recvmmsg path.** After a failed `recvmmsg` (num < 0), the next call reuses `mmsghdr` entries without resetting `msg_namelen` (`net_packet.c:1743-1761`). A kernel-shortened IPv4 length could then truncate later IPv6 source addresses (inferred).

## Security Features Checklist

### Network Security

- [x] **Handshake rate limiting** - `handle_new_meta_connection` tarpits bursts above `MaxConnectionBurst` (default 10) per host and globally (`net_socket.c:44`, `net_socket.c:680-718`), and SPTPS restarts are throttled to one every 10 s (`net_packet.c:338-341`).
- [ ] **Stateful packet filter** - Not supported: `route.c` forwards by subnet only and keeps no connection tracking (`route.c:623-704`).
- [ ] **Fine-grained ACLs** - Not supported: the only controls are per-node `Subnet` ownership with `StrictSubnets`, `Forwarding` and `DirectOnly` (`net_setup.c:555`, `net_setup.c:573-586`, `net_setup.c:922-924`), with no port or protocol rules.
- [ ] **Capability-based access** - Not supported: there are no tags, groups or certificate attributes, and authorization is the presence of `hosts/<name>` (`protocol_auth.c:444-450`).

### Identity & Authentication

- [x] **Identity validation** - Partial: peers must prove the Ed25519 key pinned in their host file (`sptps.c:327-330`, `protocol_auth.c:444-454`). But VPN addresses are not bound to keys unless `StrictSubnets` is set (`protocol_subnet.c:120`), and keys of indirect nodes can be learned unauthenticated (`protocol_key.c:207-222`).
- [ ] **Signed config updates** - Not supported: ADD_EDGE and ADD_SUBNET are plain text requests flooded without signatures (`protocol_subnet.c:45-140`, `protocol_edge.c:64`).
- [ ] **Control-server key pinning** - N/A: tinc has no control server. Every node is an equal peer (`graph.c:126`).

### Implementation

- [ ] **Memory-safe language** - Not supported: the daemon and its crypto are C (`src/tinc/src/*.c`).
- [x] **Privilege separation** - `tincd -U user` drops to an unprivileged user after the device and sockets are set up (`tincd.c:102-103`, `tincd.c:290-335`). It is a command-line option, off by default.
- [x] **Sandboxing** - `tincd -R` chroots into the network config directory (`tincd.c:76-77`, `tincd.c:319-325`). There is no seccomp or pledge code in `src/`.
- [x] **Audit logging** - At the default level 0, tincd logs unknown identities, rollback attempts, failed signatures, bad decrypts, replays and expired invitations (`protocol_auth.c:448`, `protocol_auth.c:466`, `protocol_auth.c:274`, `sptps.c:329`, `sptps.c:565`, `logger.c:162`).

# NAT Traversal

## How NAT Traversal Works

tinc needs at least one node that others can reach over TCP, found through an `Address` in its host file. Every NATed node keeps a meta connection to such a node (`autoconnect.c:168-193`). That mesh is the signalling channel. When node A wants to talk to node B, A starts SPTPS with REQ_KEY over the meta connections. B answers with ANS_KEY. Each intermediate node appends the UDP source address it has seen for the sender, which acts as server reflection (`protocol_key.c:442-450`). The receiver stores that reflexive address with `update_node_udp` (`protocol_key.c:492-497`). UDP_INFO messages spread observed addresses along relay paths (`protocol_misc.c:149-209`), and MTU_INFO spreads path MTU along the same paths (`protocol_misc.c:264-323`).

Both sides then send UDP probes every 2 seconds (`UDPDiscoveryInterval`), which opens the NAT on both ends. `choose_udp_address` rotates between the reflexive address and random edge addresses until a probe reply confirms one (`net_packet.c:637-678`, `net_packet.c:1102-1147`). Until then, packets travel over TCP meta connections or through a node's `nexthop` as a dynamic UDP relay (`net_packet.c:1403-1408`, `net_packet.c:865-898`). Confirmed paths are kept alive every 10 s (`net_packet.c:72`). Port prediction, STUN and NAT type detection are not implemented. UPnP-IGD support exists in `upnp.c`, but it needs `--enable-miniupnpc` and is not part of this build.

## NAT Traversal Checklist

### Discovery

- [ ] **No own public node needed** - The project runs no public nodes. A new mesh needs at least one node with a reachable `Address` for meta connections (`net_socket.c` outgoing connections, `autoconnect.c:27-73`).
- [x] **Public endpoint discovery (STUN or reflection)** - Server reflection: intermediate nodes append the observed UDP address to ANS_KEY (`protocol_key.c:442-446`) and UDP_INFO (`protocol_misc.c:149-209`). There is no STUN.
- [x] **Multiple discovery servers** - Every meta-connected node reflects addresses, and any number of `ConnectTo` nodes can be configured, with `AutoConnect` keeping 3 (`autoconnect.c:178-181`).
- [ ] **NAT type detection** - Not supported: there is no NAT classification code. `try_udp` only probes (`net_packet.c:1102-1147`).

### Port Mapping

- [x] **UPnP port mapping** - Partial: `upnp.c` maps TCP and UDP ports with miniupnpc `UPNP_AddPortMapping` (`upnp.c:99`), but only with `--enable-miniupnpc` (`m4/miniupnpc.m4:5-8`), which this build lacks (no miniupnpc in `deps/`).
- [ ] **NAT-PMP support** - Not supported: there is no NAT-PMP code in `src/`.
- [ ] **PCP support** - Not supported: there is no PCP code in `src/`.

### Hole Punching

- [x] **UDP hole punching** - Both peers learn each other's reflexive address over the meta mesh and probe it at the same time (`protocol_key.c:492-497`, `net_packet.c:1128-1146`).
- [ ] **Symmetric NAT handling** - Not supported: candidates are only the reflexive address and random edge addresses (`net_packet.c:647-677`), with no port prediction.
- [x] **Rendezvous coordination** - The meta-connection nodes that forward REQ_KEY/ANS_KEY and UDP_INFO act as rendezvous (`protocol_key.c:429-453`, `protocol_misc.c:149-209`).

### Fallback

- [x] **Relay fallback** - Traffic falls back to the `nexthop` over UDP or over TCP meta connections (`net_packet.c:866-898`, `net_packet.c:1403-1408`).
- [x] **Multiple relays** - Any node can relay, and `via`/`nexthop` come from the graph over all nodes (`graph.c:186-196`).
- [x] **Latency-based relay selection** - Partial: the BFS picks the fewest hops and breaks ties by edge weight, which is the measured connection setup time in milliseconds (`graph.c:180-188`, `protocol_auth.c:846`).
- [x] **TCP relay support** - Packets are relayed through TCP meta connections as `SPTPS_PACKET` or `PACKET` (`protocol_misc.c:84-129`, `net_packet.c:874-897`).

# Local Routing

## Peer Discovery on LANs

There is no broadcast or multicast peer discovery. Each node includes its local address (the local end of its meta connection) in the ADD_EDGE messages it floods (`protocol_edge.c:37-50`, `protocol_edge.c:131`). With `LocalDiscovery` on by default (`net_packet.c:70`), `try_udp` sends a second probe to the peer's advertised local address while UDP is not yet confirmed (`net_packet.c:1141-1145`, `net_packet.c:680-701`). The first address whose probe reply arrives becomes the peer's UDP address (`net_packet.c:1718-1720`).

## Routing Features

The router mode routes by announced `Subnet`s, which can be IPv4, IPv6 or MAC with an optional `#weight` (`subnet_parse.c:223-235`). The lookup prefers the longest prefix, then by weight, and skips unreachable owners, which gives failover between routers (`subnet_parse.c:131`, `subnet.c:138`). A `Subnet = 0.0.0.0/0` on an exit node makes it the default destination. Host routes are set by the `tinc-up`/`subnet-up` scripts, so tinc itself only routes what the kernel sends to the TUN device (inferred from `script.c` usage). Packets are forwarded hop by hop through intermediate nodes (`route.c:676-701`, `net_packet.c:1700-1705`). `Forwarding`, `DirectOnly`, `DecrementTTL` and `ClampMSS` (on by default) adjust that (`net_setup.c:573-603`). There is no DNS.

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - Not supported: there is no LAN broadcast or multicast probe. Local discovery uses addresses learned from ADD_EDGE (`net_packet.c:680-701`).
- [x] **Direct path advertisement** - ADD_EDGE carries the local address and port of each connection (`protocol_edge.c:43-49`).

### LAN Optimization

- [x] **Automatic LAN preference** - Partial: `LocalDiscovery` (default on, `net_packet.c:70`) probes the local address in parallel only until any UDP address is confirmed (`net_packet.c:1141-1145`). The first reply wins, with no explicit LAN priority.
- [x] **Trusted path mode** - Partial: only the legacy protocol accepts `Cipher = none` and `Digest = none` (`net_setup.c:978-979`, `net_setup.c:1008-1009`). SPTPS always encrypts.
- [x] **LAN-only mode** - Nodes need only `Address` entries reachable on the LAN, with no external service (`net_socket.c` outgoing connect, `address_cache.c:31-65`).

### Routing Features

- [x] **Subnet routes** - Each node announces `Subnet` entries from its host file (`net_setup.c:906-914`), and they are flooded with ADD_SUBNET (`protocol_subnet.c:45-140`).
- [x] **Full tunnel mode** - An exit node can own `Subnet = 0.0.0.0/0` or `::/0`, which `lookup_subnet_ipv4/6` matches for any destination (`subnet.c:153-190`). The OS default route is set in `tinc-up` (inferred).
- [x] **Split tunneling** - Only packets the kernel routes to the TUN device enter tinc, and only destinations with a matching subnet are forwarded (`route.c:631-645`).
- [x] **Route priorities** - `Subnet = prefix#weight` orders owners of the same prefix, and unreachable owners are skipped (`subnet.h:53`, `subnet_parse.c:131`, `subnet.c:138`).
- [x] **Multi-hop routing via peers** - The graph computes `nexthop`/`via` for each node, and intermediate nodes forward packets for others (`graph.c:126-200`, `net_packet.c:1700-1705`).
- [ ] **Built-in DNS** - Not supported: there is no DNS resolver or server in `src/`. Names are only node names in config files.

# Central Point of Failure

## What Happens When a ConnectTo Node Fails

tinc has no controller. The closest thing is the reachable node that NATed nodes connect to with `ConnectTo`. If it fails, its meta connections close and the graph is recomputed (`graph.c:126`). Nodes that still have a path through other meta connections stay reachable. Established UDP SPTPS sessions between those nodes continue, because keys live in the per-node `sptps` state and need no third party (`net_packet.c:574-623`). Nodes that lose every path to a peer mark it unreachable and stop sending to it (`net_packet.c:1469-1472`). `AutoConnect` then tries other known nodes, including direct connections to unreachable ones (`autoconnect.c:75-110`, `autoconnect.c:168-193`). A new meta connection for a NATed node still needs some reachable node.

## Mitigation Strategies

Give several nodes public `Address` entries and list them in `ConnectTo`. `AutoConnect` keeps 3 meta connections (`autoconnect.c:178-181`) and remembers working addresses in `cache/` (`address_cache.c:107-111`). Host files hold all keys locally, so restarts need no online service. `StrictSubnets` limits the damage a rogue member can do to routing (`protocol_subnet.c:120`).

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Per-pair SPTPS sessions and the meta connections between other nodes do not depend on the failed node (`net_packet.c:865-963`). The graph reroutes (`graph.c:126-200`).
- [x] **Local state caching** - Peer keys and addresses are kept in `hosts/` files, and recent addresses in `cache/<node>` (`address_cache.c:107-111`, `address_cache.c:219-225`).
- [ ] **Cached credentials** - N/A: there is no controller that issues credentials. Each node's own key files are its only credentials (`net_setup.c:865-884`).

### Redundancy

- [x] **Decentralized control plane** - Every tincd node forwards ADD_EDGE/ADD_SUBNET requests to its peers and computes the graph itself (`src/tinc/src/protocol_edge.c:211,298`, `src/tinc/src/graph.c:122-127`).
- [x] **Fully self-hostable** - Every role (bootstrap, reflection, relay) is an ordinary tincd node, and there are no external services (`net_setup.c`, `autoconnect.c`).
- [ ] **Controller redundancy** - N/A: the design has no controller (`graph.c:126`).
- [x] **Relay redundancy** - Any reachable node can relay, and the graph picks among all of them (`graph.c:186-196`).
- [x] **No single root of trust** - There is no CA. Each node trusts the keys in its own `hosts/` directory (`protocol_auth.c:444-454`), although any member can forge routing state without `StrictSubnets` (`protocol_subnet.c:120`).

# Authentication

## How Nodes Join and Authenticate

Nodes are admitted in one of two ways. The admin can copy host files (name, `Address`, `Subnet`, `Ed25519PublicKey`) between nodes by hand, using `tinc export`/`tinc import`. Or an existing node runs `tinc invite <name>`, which writes an invitation file and prints a URL holding a hash of the inviter's invitation key and an 18-byte random cookie (`invitation.c:280`, `invitation.c:443-519`). The new node runs `tinc join <url>`. It connects with an `ID ?<pubkey>` line, checks the inviter's key against the hash in the URL (`invitation.c:1295-1309`), and sends the cookie inside an SPTPS session labelled "tinc invitation" (`protocol_auth.c:362-394`). The inviter renames the invitation file atomically to make it single use. It rejects invitations older than `InvitationExpire` (default 1 week) (`protocol_auth.c:251-276`, `net_setup.c:698-700`). It then sends back the config, and the new node's Ed25519 public key is stored in `hosts/<name>` (`protocol_auth.c:178-217`). After that, every connection is authenticated by an SPTPS handshake signed with the pinned Ed25519 keys (`sptps.c:310-330`).

## Authentication Checklist

### Enrollment Methods

- [x] **Pre-authentication keys** - `tinc invite` creates a single-use, expiring cookie that a new node presents with `tinc join` to enroll without further approval (`invitation.c:447-519`, `protocol_auth.c:225-330`).
- [ ] **Certificate-based enrollment** - Not supported: there is no CA or certificate code. Keys are raw Ed25519 or RSA public keys in host files (`protocol_auth.c:452-454`).
- [ ] **OAuth/OIDC** - Not supported: there is no identity-provider code in `src/`.
- [ ] **Interactive login** - Not supported: there is no browser or interactive login flow. Enrollment is `tinc join` with a URL (`invitation.c:1122`).
- [x] **CLI authentication** - `tinc invite`, `tinc join`, `tinc import` and `tinc export` handle enrollment from the command line (`invitation.c:280`, `invitation.c:1122`, `tincctl.c`).

### Authorization

- [x] **Admin approval workflow** - Partial: there is no pending-then-approve flow. A peer is accepted only after an admin adds its `hosts/<name>` file by hand (`protocol_auth.c:444-450`) or creates an invitation for it (`invitation.c:280`).
- [ ] **Automated enrollment rules** - Not supported: there are no rules engines. Admission is a host file or a manually issued invitation (`protocol_auth.c:444-450`).
- [ ] **Ephemeral nodes** - Not supported: host files persist, and unreachable nodes are only marked unreachable in the graph (`graph.c:126-200`).
- [ ] **Node expiry** - Not supported: node keys have no expiry. Only invitations expire (`protocol_auth.c:273-276`).

### Identity

- [x] **Stable device identity** - The identity is the node name plus its Ed25519 key stored in the config directory, which survives restarts and address changes (`net_setup.c:865-875`, `protocol_auth.c:452-454`).
- [x] **Identity portability** - Copying the config directory (keys plus `hosts/`) moves the identity, since nothing is tied to hardware (`net_setup.c:840-875`).

# Platform Support

## Supported Platforms

The source has device drivers for Linux (`linux/device.c`), the BSDs and macOS (`bsd/device.c`, including utun and tunemu, `bsd/device.c:40-148`), Solaris (`solaris/device.c`) and Windows via TAP-Win32 (`mingw/device.c`). There are also user-mode devices: raw socket, multicast, UML, VDE, fd passing and dummy (`net_setup.c:1047-1077`). `README.android` describes cross-compiling the daemon with the Android NDK. There is no Android VPN-service app or iOS code in the repository. systemd units are provided (`systemd/tinc.service.in`, `systemd/tinc@.service.in`).

## Implementation Details

The project is C built with autotools (`configure.ac:16-17`). The default Linux build compiles in OpenSSL legacy support, zlib, LZO, readline and ncurses (for `tinc top`) (`configure.ac:234-247`). It compiles without jumbograms (`configure.ac:253-258`) and without miniupnpc (`m4/miniupnpc.m4:5-8`). The default hardening flags are `-fwrapv`, PIE and full RELRO (`configure.ac:145-163`). The configure script adds `-DFORTIFY_SOURCE=2` without the leading underscore, so that flag alone does not turn on glibc fortification (`configure.ac:147`; the nix toolchain may add its own hardening, inferred). The datapath runs entirely in user space through `/dev/net/tun`. Shell tests in `test/` cover SPTPS, invitations, the legacy protocol and namespace pings (`test/ns-ping.test`, `test/sptps-basic.test`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - `linux/device.c` is compiled when the host is Linux (`src/Makefile.am`: `if LINUX`).
- [x] **macOS** - `bsd/device.c` supports the macOS utun device and tun/tap (`bsd/device.c:40`, `bsd/device.c:74-148`).
- [x] **Windows** - `mingw/device.c` drives TAP-Win32, and `event.c` has a WSAWaitForMultipleEvents loop (`event.c:376-432`).
- [x] **FreeBSD/OpenBSD** - `bsd/device.c` handles tun/tap/tunifhead on the BSDs (`bsd/device.c:52-70`), and NEWS mentions FreeBSD and DragonFly auto-clone devices (`NEWS:15`).

### Mobile

- [ ] **iOS** - Not supported: there is no iOS code or app in the repository.
- [x] **Android** - Partial: `README.android` only documents cross-compiling the CLI daemon with the NDK (`README.android:1-25`), with no official VPNService app.

### Implementation

- [ ] **Kernel-mode datapath** - Not supported: all packets pass through userspace `read`/`write` on `/dev/net/tun` (`linux/device.c:147-221`).
- [ ] **Container support** - Not supported: the repository has no Dockerfile, image or Kubernetes manifests, only systemd units (`systemd/`).
