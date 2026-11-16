# Overview

ZeroTier One 1.16.0 is a virtual Ethernet switch built by ZeroTier, Inc. (`src/zerotierone/version.h`, copyright headers in `src/zerotierone/node/Node.cpp:5`). Each node has a long-term Curve25519/Ed25519 identity. The node's 40-bit ZeroTier address is a memory-hard hash of the public key (`src/zerotierone/node/Identity.cpp:104-118`). A node joins a virtual network by its 64-bit network ID. The first 40 bits of that ID are the address of the network controller (`src/zerotierone/node/Network.hpp:83-86`). The controller signs the network configuration and the membership certificates (`src/zerotierone/node/Network.cpp:1134-1138`). Four ZeroTier-run root servers in a built-in "planet" file give address lookup (WHOIS), NAT rendezvous and relaying (`src/zerotierone/node/Topology.cpp:21`). Ethernet frames read from a Linux TAP device are wrapped in ZeroTier packets, encrypted with a static per-peer key, and sent over UDP. Peers send directly when they can and through a root when they cannot.

At a glance:

- **Language:** C++17 for the core, service and OS glue (`src/zerotierone/make-linux.mk:87-88`). Rust only for the OIDC/SSO helper `zeroidc`, which the x86_64 Linux build links (`src/zerotierone/make-linux.mk:133,310-317`, `src/zerotierone/rustybits/zeroidc/Cargo.toml`).
- **License:** MPL-2.0 for `node/`, `osdep/`, `service/` and the rest of the tree, except `ext/` and `nonfree/` (`src/zerotierone/LICENSE.txt:1`, `src/zerotierone/LICENSE-MPL.txt`). The network controller in `nonfree/` uses a commercial source-available license (`src/zerotierone/LICENSE.txt:3`, `src/zerotierone/RELEASE-NOTES.md:6-9`). The default build leaves it out. The benchmark builds peers without it and builds only the controller node with `ZT_NONFREE=1` (inferred from the deployment's package expression, not from `sources/`).
- **Default peer transport:** Direct UDP on port 9993, plus a random secondary port and a third port for UPnP/NAT-PMP (`src/zerotierone/service/OneService.cpp:1184-1246`). If no direct path exists, UDP goes through the lowest-latency root (`src/zerotierone/node/Switch.cpp:1081-1090`). After 60 s with no UDP received from a global address, the node also tunnels through a ZeroTier-run TCP relay at `204.80.128.1/443` (`src/zerotierone/service/OneService.cpp:151,158,3954-4010`).
- **Data cipher (default):** AES-256-GMAC-SIV for peers with protocol version 12 or newer (`src/zerotierone/node/Packet.cpp:1089-1110`, `src/zerotierone/node/Peer.hpp:657-660`). Alternatives: Salsa20/12 with Poly1305 for older peers, Poly1305-only authentication for HELLO, and no crypto at all on configured trusted paths (`src/zerotierone/node/Packet.hpp:90-117`).
- **Handshake:** No session handshake. Each pair of nodes runs custom static-static Curve25519 ECDH. The shared secret is hashed with SHA-512 into a 48-byte key (`src/zerotierone/node/ECC.cpp:2450-2464`). Two AES keys are derived from it with KBKDF-HMAC-SHA384 (`src/zerotierone/node/Peer.cpp:60-69`). HELLO carries the full public identity.
- **Default tunnel MTU:** 2800 bytes (`ZT_DEFAULT_MTU`, `src/zerotierone/node/Constants.hpp:290`). The controller sets it in the network config (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp:1846`, `src/zerotierone/node/NetworkConfig.cpp:394`) and the node applies it to the TAP with `SIOCSIFMTU` (`src/zerotierone/osdep/LinuxEthernetTap.cpp:295-296`). Packets larger than the 1432-byte physical MTU are split into ZeroTier fragments (`src/zerotierone/include/ZeroTierOne.h:98`, `src/zerotierone/node/Switch.cpp:1101-1145`).
- **Control-plane model:** central server (one network controller per network), plus lighthouse/bootstrap-style root nodes for discovery and relay (`src/zerotierone/node/Network.hpp:83-86`, `src/zerotierone/node/Topology.cpp:21-58`).
- **Data-plane threading:** multi-threaded, one thread per direction: a TAP reader thread encrypts and sends, and the main poll thread receives and decrypts. Opt-in `multicoreEnabled` adds more TAP reader threads and post-decrypt TAP writer threads (`src/zerotierone/service/OneService.cpp:2893-2915`).

## Key Architecture Components

**Control plane (network controller).** The controller is an ordinary ZeroTier node that answers `NETWORK_CONFIG_REQUEST` packets. It returns a signed network config with IPs, routes, rules, MTU, capabilities, tags and a certificate of membership (COM). Nodes check the signature against the controller identity (`src/zerotierone/node/Network.cpp:1134-1138`). The reference controller (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp`) keeps its data as JSON files (`FileDB`). Private networks are the default, so an admin must authorize each member (`src/zerotierone/nonfree/controller/DB.cpp:26-27`).

**Discovery (roots and moons).** The built-in planet lists four roots. Each root has an IPv4 and an IPv6 endpoint on UDP 9993 (`src/zerotierone/node/Topology.cpp:21-58`). Nodes send HELLO to roots, resolve unknown addresses with WHOIS (`src/zerotierone/node/Switch.cpp:914-933`) and learn their public endpoint from the `OK(HELLO)` reply (`src/zerotierone/node/IncomingPacket.cpp:468-475,516`). Users can add "moons" (extra signed root sets) with `zerotier-idtool initmoon/genmoon` (`src/zerotierone/one.cpp:1566-1595`) or replace the planet file (`src/zerotierone/service/OneService.cpp:3763-3765`).

**Transport.** `Binder` opens one UDP socket per local interface address and port and pins it to its device with `SO_BINDTODEVICE` (`src/zerotierone/osdep/Binder.hpp:452-462`). All sockets are polled by one `select()` loop in `Phy` (`src/zerotierone/osdep/Phy.hpp:1045-1102`). A fallback TCP tunnel to a fixed ZeroTier relay wraps packets in fake TLS 1.2 record headers (`src/zerotierone/service/OneService.cpp:3973-3982`).

**Data path.** `Switch::onLocalEthernet` turns a TAP frame into a `VERB_FRAME` packet (`src/zerotierone/node/Switch.cpp:546-550`). `Switch::_sendViaSpecificPath` encrypts and fragments it (`src/zerotierone/node/Switch.cpp:1101-1145`). On receive, `Switch::onRemotePacket` reassembles fragments, relays packets addressed to other nodes, or decodes local ones (`src/zerotierone/node/Switch.cpp:64-264`). `IncomingPacket::tryDecode` authenticates and dispatches by verb (`src/zerotierone/node/IncomingPacket.cpp:38-164`).

**Identity.** `identity.secret` holds a Curve25519 key for ECDH and an Ed25519 key for signatures (`src/zerotierone/node/ECC.hpp:59-62`). The address is the last 5 bytes of a 2 MiB memory-hard hash of the public keys, and the hash's first byte must be below 17 (`src/zerotierone/node/Identity.cpp:25-26,104-118`). The node creates its identity on first start and keeps it on disk (`src/zerotierone/node/Node.cpp:95`, `src/zerotierone/service/OneService.cpp:3757-3761`).

# Protocol

## Control Plane

A node joins with `zerotier-cli join <nwid>` (`src/zerotierone/one.cpp:838-846`). The node finds the controller address in the top 40 bits of the network ID (`src/zerotierone/node/Network.hpp:83-86`), gets the controller's identity through a root WHOIS, and sends `NETWORK_CONFIG_REQUEST` with metadata such as version, rule limits and OS/arch (`src/zerotierone/node/Network.cpp:1419-1434`). The controller answers with config chunks signed by its Ed25519 key. The node verifies them and passes them on to other members ("viral" propagation, `src/zerotierone/node/Network.cpp:1132-1154`). The node caches the config in `networks.d/<nwid>.conf` and loads it again at start-up (`src/zerotierone/node/Network.cpp:682-707,1259-1262`).

Peers exchange COMs, capabilities and tags with `NETWORK_CREDENTIALS`. A member accepts frames from another member only if their COMs agree within a time delta (`src/zerotierone/node/CertificateOfMembership.cpp:46-72`, `src/zerotierone/node/Membership.hpp:223`). Peer liveness uses `HELLO` and `ECHO` heartbeats: paths are pinged every 14 s and expire after about 4 minutes (`src/zerotierone/node/Constants.hpp:374-389`). Nodes advertise their interface addresses and reflected public addresses with `PUSH_DIRECT_PATHS` (`src/zerotierone/node/Peer.cpp:208-257`). Roots introduce two peers to each other with `RENDEZVOUS` when they relay traffic between them (`src/zerotierone/node/Switch.cpp:174-192`, `src/zerotierone/node/Peer.cpp:294-424`).

## Data Plane

The wire header is 28 bytes: 8-byte packet ID/IV, 5-byte destination address, 5-byte source address, 1 flags byte (cipher suite, fragmented bit, 3-bit hop count), an 8-byte MAC and 1 verb byte (`src/zerotierone/node/Packet.hpp:169-175`). A unicast frame is `VERB_FRAME`: network ID, ethertype and the Ethernet payload. Bridged frames use `VERB_EXT_FRAME`, which also carries both MAC addresses (`src/zerotierone/node/Switch.cpp:546-561`). Packets larger than the path MTU (default 1432) are split into a head and up to 6 fragments. Each fragment has a 16-byte header (`src/zerotierone/node/Packet.hpp:192-198`, `src/zerotierone/node/Constants.hpp:295`). With the default 2800-byte TAP MTU, a full-size frame becomes two UDP datagrams.

Relays forward packets without decrypting them. They increment the hop counter, up to 3 hops (`src/zerotierone/node/Switch.cpp:163-195`, `src/zerotierone/node/Constants.hpp:337`). The receiver masks the hop bits out of the authenticated data (`src/zerotierone/node/Packet.cpp:1210-1213`). Fragments are reassembled in a 32-entry ring keyed by packet ID (`src/zerotierone/node/Switch.hpp:233-244`, `src/zerotierone/node/Constants.hpp:300`). Unicast frames are not compressed. Only multicast frames and some control messages are LZ4-compressed (`src/zerotierone/node/OutboundMulticast.cpp:68`, `src/zerotierone/node/Peer.cpp:249`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - All peer traffic goes over UDP sockets bound by `Binder` and sent with `Phy::udpSend` (`src/zerotierone/osdep/Binder.hpp:452`, `src/zerotierone/osdep/Phy.hpp:480-494`).
- [x] **Datagram encapsulation (no head-of-line blocking)** - Each Ethernet frame is its own ZeroTier packet, sent as one UDP datagram or as a few independent fragments; no reliable stream is involved (`src/zerotierone/node/Switch.cpp:1101-1145`).
- [x] **TCP fallback** - When no UDP has arrived from a global address for 60 s, the node opens a TCP tunnel to the ZeroTier relay `204.80.128.1/443` by itself; `allowTcpFallbackRelay` defaults to true (`src/zerotierone/service/OneService.cpp:151,158,2876,3954-4005`).
- [ ] **QUIC support** - No QUIC code exists in `src/zerotierone/node`, `src/zerotierone/osdep` or `src/zerotierone/service`; the only transports are UDP and the fallback TCP tunnel (`src/zerotierone/service/OneService.cpp:3952-4032`).
- [ ] **WebSocket support** - The TCP fallback uses fake TLS record headers over raw TCP, not WebSocket (`src/zerotierone/service/OneService.cpp:3973-3982`).

### IP Support

- [x] **IPv4 support** - The TAP carries any ethertype, and the switch parses IPv4 for flow IDs and turns ARP into multicast lookups (`src/zerotierone/node/Switch.cpp:295-320,355-366`).
- [x] **IPv6 support** - IPv6 frames are carried and parsed, and NDP emulation exists for the ZeroTier RFC4193 and 6PLANE address schemes (`src/zerotierone/node/Switch.cpp:322-349,374-498`).
- [x] **Dual-stack** - One TAP interface can hold IPv4 and IPv6 managed addresses at once (`src/zerotierone/osdep/LinuxEthernetTap.cpp:424-441,456-487`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - Partial: there is no pure IP/TUN mode. IP runs over the emulated Ethernet, with controller-assigned IPs and managed routes that the node installs in the OS (`src/zerotierone/osdep/LinuxEthernetTap.cpp:209`, `src/zerotierone/service/OneService.cpp:3021-3194`).
- [x] **Layer 2 (Ethernet) mode** - The device is a Linux TAP (`IFF_TAP | IFF_NO_PI`) and peers exchange full Ethernet frames (`src/zerotierone/osdep/LinuxEthernetTap.cpp:209`, `src/zerotierone/node/Switch.cpp:553-560`).
- [x] **Bridging support** - Nodes the controller marks as active bridges may send frames from other MAC addresses, and remote MACs are learned as bridge routes (`src/zerotierone/node/Switch.cpp:272-279,563-627`).

### Advanced Protocol Features

- [x] **Multipath/bonding** - `Bond` provides active-backup, broadcast, balance-rr, balance-xor and balance-aware policies, set with `defaultBondingPolicy` or custom policies in `local.conf` (`src/zerotierone/node/Bond.hpp:35-62`, `src/zerotierone/service/OneService.cpp:2750-2805`).
- [ ] **QoS/traffic shaping** - A rules `PRIORITY` action and an fq-codel style queue exist, but `Network::qosEnabled()` always returns false, so the queue is never used (`src/zerotierone/node/Network.hpp:327-330`, `src/zerotierone/node/Switch.cpp:630-635`).
- [x] **Multicast support** - Multicast and broadcast frames are replicated to subscribers learned through `MULTICAST_LIKE`/`MULTICAST_GATHER`, up to `multicastLimit` (`src/zerotierone/node/Switch.cpp:351-522`, `src/zerotierone/node/Multicaster.cpp:184-187`).

# Encryption

## Encryption Layer Details

**Key agreement.** No handshake runs per session. When a node first learns a peer's identity, the `Peer` constructor runs static-static Curve25519 between the two long-term keys (`src/zerotierone/node/Peer.cpp:60-62`). `ECC::agree` uses curve25519-donna style `crypto_scalarmult` and stretches the 32-byte secret with SHA-512 into 48 bytes (`src/zerotierone/node/ECC.cpp:652-675,2450-2464`). Two AES-256 keys K0 and K1 are derived from it with KBKDF-HMAC-SHA384 and labels '0' and '1' (`src/zerotierone/node/Peer.cpp:64-69`, `src/zerotierone/node/SHA512.cpp:246-267`). The same key pair is used for as long as both identities exist.

**Data cipher (AES-GMAC-SIV).** `Packet::armor` picks AES-GMAC-SIV whenever the peer supports protocol 12 or newer (`src/zerotierone/node/Packet.cpp:1089-1110`, `src/zerotierone/node/Peer.hpp:657-660`). GMAC under K0 covers 11 bytes of header AAD (destination, source, flags) and the plaintext, with the random 64-bit packet ID as nonce (`src/zerotierone/node/AES.hpp:346-389`). The 128-bit GMAC result is folded to 64 bits, joined with the packet ID, and encrypted with K1. The result is the opaque IV/MAC that replaces the packet ID and the MAC field on the wire. It also serves as the AES-CTR IV under K1 (`src/zerotierone/node/AES.hpp:394-419`, `src/zerotierone/node/Packet.cpp:1103-1109`). Decryption reverses this and compares the folded GMAC with the decrypted 64-bit tag (`src/zerotierone/node/AES.hpp:475-534`). The effective authenticator is therefore 64 bits.

**Legacy and special suites.** Peers older than protocol 12 get Salsa20/12 with a per-packet mangled key, and Poly1305 truncated to 8 bytes (`src/zerotierone/node/Packet.cpp:1111-1148`). HELLO is sent with suite 0: Poly1305 only, payload in the clear, apart from a Salsa20-encrypted tail that holds the moon list (`src/zerotierone/node/Peer.cpp:426-465`). With `encryptedHelloEnabled` (default false, `src/zerotierone/service/OneService.cpp:2891`), HELLO gets an "extended armor" pass: AES-CTR under an ephemeral Curve25519 key agreed with the recipient's static key (`src/zerotierone/node/Packet.cpp:1150-1163,1171-1191`). Trusted paths from `local.conf` use suite 2 with no encryption and no MAC (`src/zerotierone/node/IncomingPacket.cpp:45-57`, `src/zerotierone/service/OneService.cpp:1569-1581`).

**Nonce and replay handling.** Packet IDs are 64 random bits (`src/zerotierone/node/Packet.hpp:1073`). GMAC-SIV tolerates nonce reuse by design. The receiver keeps no counter and no window, so a captured packet replayed later passes authentication again. Only `OK`/`ERROR` replies are checked against recently sent packet IDs (`src/zerotierone/node/IncomingPacket.cpp:555`, `src/zerotierone/node/Node.hpp:224-227`).

**Rekeying.** None. The per-peer key is computed once in the `Peer` constructor and only changes if an identity changes.

**Implementations.** All data-path crypto is in-tree, not from OpenSSL. `src/zerotierone/node/AES.cpp`/`src/zerotierone/node/AES_aesni.cpp` use AES-NI and PCLMULQDQ for GMAC (`src/zerotierone/node/AES_aesni.cpp:31-34,251-256`), and VAES-256/512 for CTR when the CPU has it (`src/zerotierone/node/AES_aesni.cpp:424-438`). The choice is made at runtime through CPUID (`src/zerotierone/node/AES.cpp:115,169,220`, `src/zerotierone/node/Utils.cpp:151-165`). ARMv8 Crypto Extensions are used on arm64 (`src/zerotierone/node/AES_armcrypto.cpp`, `src/zerotierone/node/AES.cpp:227`). The fallback is table-based software AES (`src/zerotierone/node/AES.cpp:261-326`). x86_64 builds also link SSE assembly for Salsa20/12 and Ed25519 (`src/zerotierone/make-linux.mk:127-131,379-386`). OpenSSL 3.6.0 (`deps/zerotierone/openssl`) is linked only for the Rust `zeroidc` HTTPS/OIDC client (`src/zerotierone/make-linux.mk:316`).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Session keys come from Curve25519 ECDH between the two node identities (`src/zerotierone/node/ECC.cpp:2450-2464`, `src/zerotierone/node/Peer.cpp:60`).
- [ ] **Perfect Forward Secrecy** - Data keys come only from the static identity keys; the ephemeral key exists only for the opt-in HELLO wrapping, so a leaked `identity.secret` decrypts all recorded traffic (`src/zerotierone/node/Peer.cpp:60-69`, `src/zerotierone/node/Packet.cpp:1150-1163`).
- [ ] **Post-quantum readiness** - No KEM or hybrid code exists; the only asymmetric primitives are Curve25519/Ed25519, or NIST P-384 in a FIPS build (`src/zerotierone/node/ECC.hpp:22-62`).
- [ ] **Key rotation** - The per-peer AES keys are set once in the `Peer` constructor and never refreshed (`src/zerotierone/node/Peer.cpp:59-70`).

### Symmetric Encryption

- [x] **Authenticated encryption** - Data packets use AES-GMAC-SIV (or Salsa20/12-Poly1305 for old peers), and the MAC is checked before any payload is processed (`src/zerotierone/node/Packet.cpp:1089-1110,1196-1259`).
- [x] **Hardware-accelerated crypto** - AES-NI with PCLMULQDQ GHASH and VAES-256/512 CTR, chosen at runtime by CPUID (`src/zerotierone/node/AES_aesni.cpp:59,107,424-438`, `src/zerotierone/node/Utils.cpp:151-165`).
- [x] **Constant-time operations** - Partial: AES-NI, ARMv8-CE and the donna-style Curve25519 ladder with `swap_conditional` are constant-time, but the software AES fallback uses T-table lookups, and Poly1305 tags are compared with a plain `!=` on aligned builds (`src/zerotierone/node/ECC.cpp:512-565`, `src/zerotierone/node/AES.cpp:281-326`, `src/zerotierone/node/Packet.cpp:1231`).

### Protocol Security

- [ ] **Replay protection** - There is no packet counter or sliding window; packet IDs are random and the receiver only checks that the MAC is valid (`src/zerotierone/node/Packet.hpp:1073`, `src/zerotierone/node/IncomingPacket.cpp:63-71`).
- [ ] **Noise Protocol** - The key agreement is a custom static-static ECDH plus KBKDF, not a Noise pattern (`src/zerotierone/node/Peer.cpp:60-69`).
- [ ] **No cleartext metadata** - Every packet carries the 40-bit source and destination addresses in clear (`src/zerotierone/node/Packet.hpp:170-171`), and HELLO carries the full public identity unless `encryptedHelloEnabled` is set (default false, `src/zerotierone/service/OneService.cpp:2891`, `src/zerotierone/node/Peer.cpp:435,462`).
- [x] **End-to-end encryption through relays** - Roots and other relays forward the encrypted packet and only increment the hop count; they hold no peer keys (`src/zerotierone/node/Switch.cpp:163-195`).

# Performance

## Threading Model

The default Linux build with default `local.conf` (`multicoreEnabled=false`, `concurrency=1`, `src/zerotierone/service/OneService.cpp:2894-2909`) uses two packet threads, one per direction.

**TAP to socket (transmit).** `LinuxEthernetTap` starts one reader thread per `concurrency`, so one thread by default (`src/zerotierone/osdep/LinuxEthernetTap.cpp:221-222`). The thread blocks in `select()` on the TAP fd and a shutdown pipe, then calls `read()` once per frame into a 16 KiB stack buffer (`src/zerotierone/osdep/LinuxEthernetTap.cpp:55,237,312-351`). For each frame it calls `OneServiceImpl::tapFrameHandler`, then `Node::processVirtualNetworkFrame`, then `Switch::onLocalEthernet` (`src/zerotierone/service/OneService.cpp:4117-4120`, `src/zerotierone/node/Node.cpp:214-231`). That function computes a flow ID from the L4 ports, runs the rules engine (`Network::filterOutgoingPacket`) and copies the frame into a stack `Packet` buffer of `7 * 1432` bytes (`src/zerotierone/node/Switch.cpp:293-349,538-550`). QoS is off, so `aqm_enqueue` calls `Switch::send`, then `_trySend` and `Peer::getAppropriatePath`. These take the peer's `_paths_m` and `_bond_m` mutexes (`src/zerotierone/node/Switch.cpp:630-634,893-900,1061-1099`, `src/zerotierone/node/Peer.cpp:261-292`). `_sendViaSpecificPath` encrypts in place with two passes, GMAC then CTR (`src/zerotierone/node/Packet.cpp:1095-1101`). It sends the head and copies each further fragment into a `Packet::Fragment` (`src/zerotierone/node/Switch.cpp:1110-1143`). Every datagram is a separate `sendto()` from `Phy::udpSend` (`src/zerotierone/osdep/Phy.hpp:480-494`). Encryption and sending therefore run on the TAP reader thread.

**Socket to TAP (receive).** The main thread runs `OneServiceImpl::run`. It loops over `Phy::poll` (a `select()` across all UDP, TCP and control sockets), the background tasks and housekeeping (`src/zerotierone/service/OneService.cpp:1302-1435`). A readable UDP socket is drained with `recvmmsg(..., 128, MSG_WAITFORONE)` into a stack array of 128 x 1500-byte buffers, for up to 1024 rounds (`src/zerotierone/osdep/Phy.hpp:1047-1084`). Each datagram goes through `phyOnDatagram`, `Node::processWirePacket` and `Switch::onRemotePacket` (`src/zerotierone/service/OneService.cpp:3211-3221`, `src/zerotierone/node/Node.cpp:207-212`). That function looks up the `Path` under the global `Topology::_paths_m` mutex (`src/zerotierone/node/Topology.hpp:94-101`). It copies the datagram into an `IncomingPacket`, or into the fragment ring, and reassembles (`src/zerotierone/node/Switch.cpp:104-256`). `tryDecode` decrypts and authenticates in place (`src/zerotierone/node/IncomingPacket.cpp:63-71`). `_doFRAME` filters the frame and hands it to `PacketMultiplexer::putFrame`. With multicore off, that calls `Node::putFrame` directly (`src/zerotierone/node/IncomingPacket.cpp:846`, `src/zerotierone/node/PacketMultiplexer.cpp:31-34`). `LinuxEthernetTap::put` copies the payload behind a new 14-byte Ethernet header in a stack buffer and calls `write()` on the non-blocking TAP fd. The return value is ignored (`src/zerotierone/osdep/LinuxEthernetTap.cpp:303,503-514`).

**Batching, offloads, buffers.** Receive is batched (128 per `recvmmsg`). Send is not, since there is one `sendto()` per datagram. TAP I/O is one frame per syscall. The TAP is opened without `IFF_VNET_HDR` or `IFF_MULTI_QUEUE`, and no `UDP_SEGMENT`/`UDP_GRO` option is set (`src/zerotierone/osdep/LinuxEthernetTap.cpp:209`, `src/zerotierone/osdep/Phy.hpp:334-411`). Sockets ask for 1 MiB `SO_RCVBUF`/`SO_SNDBUF` and step down in 4 KiB steps until the kernel accepts (`src/zerotierone/node/Constants.hpp:744`, `src/zerotierone/osdep/Phy.hpp:343-357`). `IP_MTU_DISCOVER` is set to 0, so the kernel may fragment outer packets (`src/zerotierone/osdep/Phy.hpp:397-400`). Each packet is copied about three times per direction: socket or TAP buffer, packet object, fragment or TAP output buffer. Prometheus counters are updated per packet (`src/zerotierone/node/Peer.cpp:99-101`, `src/zerotierone/osdep/Phy.hpp:490-491`).

**Opt-in multicore.** With `multicoreEnabled=true` on Linux or FreeBSD, `concurrency` (default 2 on machines with 4 or more cores) sets the number of TAP reader threads. All of them read the same TAP fd and encrypt in parallel (`src/zerotierone/service/OneService.cpp:2894-2904`, `src/zerotierone/osdep/LinuxEthernetTap.cpp:221-354`). The same number of post-decode threads takes decrypted frames from per-flow queues and writes them to the TAP. Frames are copied into recycled `PacketRecord` objects (`src/zerotierone/node/PacketMultiplexer.cpp:37-59,62-115`). Decryption still runs only on the single poll thread. Optional CPU pinning uses `pthread_setaffinity_np` (`src/zerotierone/osdep/LinuxEthernetTap.cpp:223-235`).

## Performance Optimizations Checklist

### Threading

- [x] **Multi-threaded processing** - Partial: by default encryption runs on the TAP thread and decryption on the poll thread, so at most one core per direction; opt-in `multicoreEnabled` adds parallel TX encryption, but RX decryption stays single-threaded (`src/zerotierone/service/OneService.cpp:2894-2915`, `src/zerotierone/node/PacketMultiplexer.cpp:62-115`).
- [ ] **Multi-queue TUN / per-core sockets** - One TAP fd without `IFF_MULTI_QUEUE`; UDP sockets exist per interface and port, not per core, and one `select()` loop serves them all (`src/zerotierone/osdep/LinuxEthernetTap.cpp:209`, `src/zerotierone/osdep/Phy.hpp:1045-1102`).

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - On Linux, `Phy::poll` drains UDP sockets with `recvmmsg` and `MSG_WAITFORONE` (`src/zerotierone/osdep/Phy.hpp:1047-1068`).
- [ ] **Batch UDP sends (sendmmsg)** - `Phy::udpSend` calls `sendto()` once per datagram (`src/zerotierone/osdep/Phy.hpp:480-494`).
- [x] **Large batch sizes (64+)** - The `recvmmsg` window is 128 messages (`RECVMMSG_WINDOW_SIZE`, `src/zerotierone/osdep/Phy.hpp:1048`).

### Offloads

- [ ] **UDP GSO** - No `UDP_SEGMENT` option is set anywhere in `osdep/` or `service/` (`src/zerotierone/osdep/Phy.hpp:334-411`).
- [ ] **UDP GRO** - No `UDP_GRO` option; receive buffers are 1500 bytes per message (`src/zerotierone/osdep/Phy.hpp:1049`).
- [ ] **TUN offload (virtio-net hdr)** - The TAP flags are only `IFF_TAP | IFF_NO_PI`, with no `TUNSETOFFLOAD` (`src/zerotierone/osdep/LinuxEthernetTap.cpp:209-213`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - Partial: the default path uses fixed stack buffers (recvmmsg array, `Packet` objects, TAP buffers) instead of a pool; a recycled `PacketRecord` free list exists only with opt-in multicore (`src/zerotierone/osdep/Phy.hpp:1050-1054`, `src/zerotierone/node/PacketMultiplexer.cpp:37-45`).
- [x] **Large UDP socket buffers (MB)** - `ZT_UDP_DESIRED_BUF_SIZE` of 1048576 bytes is requested for both `SO_RCVBUF` and `SO_SNDBUF` on every bound socket (`src/zerotierone/node/Constants.hpp:744`, `src/zerotierone/osdep/Binder.hpp:452`, `src/zerotierone/osdep/Phy.hpp:343-357`).
- [x] **Zero-allocation parsing** - Headers are read in place from stack `Buffer` objects through fixed offsets and `at<T>()`; heap allocation happens only for new paths or peers, not per packet (inferred for all verb branches) (`src/zerotierone/node/Switch.cpp:156-157,244`, `src/zerotierone/node/Topology.hpp:94-101`).

### MTU and Peers

- [ ] **Path MTU discovery** - No PMTU probing exists; the physical MTU is a fixed 1432 or a per-network value from `local.conf`, and ZeroTier fragments above it (`src/zerotierone/include/ZeroTierOne.h:98`, `src/zerotierone/node/Switch.cpp:1103-1109`, `src/zerotierone/service/OneService.cpp:1581`).
- [x] **Endpoint caching** - Each peer keeps up to 64 paths ranked by latency and scope; `peers.d` stores path hints that are tried again after restart (`src/zerotierone/node/Peer.cpp:261-292`, `src/zerotierone/node/Peer.hpp:585-596`, `src/zerotierone/node/Topology.cpp:107,499`).

### Userspace TCP Stack

- [ ] **Userspace TCP/IP stack** - The Linux service uses the kernel stack through a TAP; no netstack is linked in the default build (`src/zerotierone/make-linux.mk:29-35`, `src/zerotierone/osdep/LinuxEthernetTap.cpp:140-213`).

### Data Plane Compression

- [x] **Tunnel compression** - Partial: LZ4 is used for multicast frames and some control messages; unicast `FRAME` packets are never compressed (`src/zerotierone/node/OutboundMulticast.cpp:68`, `src/zerotierone/node/Packet.cpp:1276-1294`, `src/zerotierone/node/Switch.cpp:546-550`).
- [ ] **Configurable compression** - LZ4 at acceleration 1 is hard-coded, with no setting to change the algorithm or level (`src/zerotierone/node/Packet.cpp:1283`).

# Security

## Known Security Issues

No advisory or CVE that affects 1.16.0 is listed in the shipped `RELEASE-NOTES.md` or `SECURITY.md` (`src/zerotierone/RELEASE-NOTES.md:4-60`, `src/zerotierone/SECURITY.md`). Per the analysis rules, no web database was checked, so this means "none found in the source tree". `SECURITY.md` lists 1.16.x and 1.14.x as supported. The 1.16.0 release notes only mention dependency bumps in the Rust helper, for example `openssl` 0.10.72, `tokio` 1.43.1 and `ring` 0.17.13 (`src/zerotierone/RELEASE-NOTES.md:43-58`). The vendored crates are newer: `openssl-0.10.73`, `tokio-1.47.1`, `ring-0.17.14` (`src/zerotierone/rustybits/Cargo.lock:1814-1815,2418-2419,3281-3282`).

## Potential Security Concerns

- **No forward secrecy and no rekeying.** Traffic keys come from static identity keys only and live as long as both identities do (`src/zerotierone/node/Peer.cpp:60-69`). Anyone who steals an `identity.secret` can decrypt all recorded traffic of that node.
- **No replay protection.** The receiver accepts any packet with a valid MAC. Packet IDs are random (`src/zerotierone/node/Packet.hpp:1073`) and are not tracked. An on-path attacker can replay old frames into the TAP device. Upper layers such as TCP then have to drop them.
- **64-bit authenticators.** GMAC-SIV folds the 128-bit GMAC to 64 bits (`src/zerotierone/node/AES.hpp:405`). Poly1305 is cut to 8 bytes (`src/zerotierone/node/Packet.cpp:1127-1129`). That gives a lower forgery margin than a 128-bit AEAD tag.
- **Cleartext identity metadata.** Every header shows source and destination ZeroTier addresses. HELLO shows the full public key by default (`src/zerotierone/node/Packet.hpp:170-171`, `src/zerotierone/service/OneService.cpp:2891`). A passive observer can link flows to node identities and network membership.
- **Legacy cipher downgrade surface.** The cipher is chosen from the peer's self-reported protocol version (`src/zerotierone/node/Peer.hpp:657-660`). Salsa20/12-Poly1305 is still accepted on receive (`src/zerotierone/node/Packet.cpp:1218-1259`).
- **Non-constant-time fallback.** On CPUs without AES-NI or ARMv8-CE, AES runs on T-tables (`src/zerotierone/node/AES.cpp:261-326`), which leak through cache timing. `CPUIDRegisters` sets `avx` from CPUID.1:ECX bit 25, which is the AES-NI bit, not AVX. VAES dispatch also skips any XGETBV check (`src/zerotierone/node/Utils.cpp:152,164`).
- **Hard-coded third-party TCP relay.** When UDP looks blocked, traffic goes to `204.80.128.1:443` by default (`src/zerotierone/service/OneService.cpp:151,2876`). The payload stays encrypted, but ZeroTier, Inc. sees endpoint metadata.
- **Management API on all interfaces.** The HTTP control plane binds `0.0.0.0` and `::` on the primary port (`src/zerotierone/service/OneService.cpp:2624,2643`). Most paths are limited to loopback and `allowManagementFrom`, but `/metrics` accepts the auth or metrics token from any source address. Tokens are compared with `std::string ==` (`src/zerotierone/service/OneService.cpp:1866-1892,1928`).
- **Opportunistic forwarding by ordinary members.** A non-root node relays packets for other destinations if the arriving path recently carried trusted traffic, up to 3 hops (`src/zerotierone/node/Switch.cpp:82,166`, `src/zerotierone/node/Path.hpp:226-229`). A network member can use another member as a reflector.
- **Detached thread per self-addressed frame.** Frames addressed to the node's own MAC, and NDP-emulated replies, each start a new `std::thread` (`src/zerotierone/node/Switch.cpp:495,530`). A local process can generate many threads this way.
- **Memory-unsafe parsing surface.** All wire parsing (packet verbs, dictionaries, world updates, LZ4) is C++ that relies on `Buffer` bounds-checking exceptions (`src/zerotierone/node/Buffer.hpp`, `src/zerotierone/node/IncomingPacket.cpp:160-163`).

## Security Features Checklist

### Network Security

- [x] **Handshake rate limiting** - Identity validation for unknown HELLOs is rate-gated per source IP hash, and WHOIS, ECHO, credential and path-push messages have per-peer rate gates (`src/zerotierone/node/Node.hpp:243-251`, `src/zerotierone/node/IncomingPacket.cpp:443-446`, `src/zerotierone/node/Constants.hpp:614-629`).
- [ ] **Stateful packet filter** - The rules engine is stateless; it can match TCP flag bits but keeps no connection table (`src/zerotierone/include/ZeroTierOne.h:208-288,744-771`).
- [x] **Fine-grained ACLs** - Controller rules match IP protocol, port ranges, ethertype, ICMP type, MAC/IP addresses, frame size and more, and run on both sender and receiver (`src/zerotierone/include/ZeroTierOne.h:744-771`, `src/zerotierone/node/Switch.cpp:538`).
- [x] **Capability-based access** - Signed Capabilities and Tags let rules match on tag values and sender/receiver tags (`src/zerotierone/node/Capability.cpp:20-48`, `src/zerotierone/node/Tag.cpp:20-33`, `src/zerotierone/include/ZeroTierOne.h:764-770`).

### Identity & Authentication

- [x] **Identity validation** - The address must match a memory-hard hash of the public key with a proof-of-work prefix, and this is checked before a new peer is learned (`src/zerotierone/node/Identity.cpp:104-118`, `src/zerotierone/node/IncomingPacket.cpp:456-459`).
- [x] **Signed config updates** - Network config chunks, COMs, capabilities, tags and planet/moon updates are Ed25519-signed and verified (`src/zerotierone/node/Network.cpp:1134-1139`, `src/zerotierone/node/CertificateOfMembership.cpp:114-133`, `src/zerotierone/node/World.hpp:167-176`).
- [x] **Control-server key pinning** - The controller address is part of the network ID, and the address is bound to the controller's key by the identity hash, so another key cannot pose as the controller (`src/zerotierone/node/Network.hpp:83-86`, `src/zerotierone/node/Network.cpp:1134`).

### Implementation

- [ ] **Memory-safe language** - The data path is C++ (`src/zerotierone/node/Switch.cpp`, `src/zerotierone/node/Packet.cpp`, `src/zerotierone/make-linux.mk:87-88`); only the optional OIDC helper is Rust (`src/zerotierone/rustybits/zeroidc/Cargo.toml`).
- [x] **Privilege separation** - On Linux the daemon switches to the `zerotier-one` user and keeps only `CAP_NET_ADMIN`, `CAP_NET_RAW` and `CAP_NET_BIND_SERVICE`, but only if that user exists and the kernel supports ambient capabilities (`src/zerotierone/one.cpp:1764-1830,2377-2381`).
- [ ] **Sandboxing** - No seccomp, chroot or namespace code exists in `src/zerotierone/one.cpp`, `src/zerotierone/service` or `src/zerotierone/osdep`.
- [x] **Audit logging** - Partial: authentication failures, dropped HELLOs, filter drops and credential rejections go only to a controller-configured remote trace target; local printing is compiled out unless `ZT_TRACE` is set (`src/zerotierone/node/Trace.cpp:9,30-42,319-339`).

# NAT Traversal

## How NAT Traversal Works

**Endpoint discovery by reflection.** Each `OK(HELLO)` reply contains the address the sender saw the HELLO come from (`src/zerotierone/node/IncomingPacket.cpp:516`). `SelfAwareness::iam` records it per reporter and scope. A change reported by a trusted root resets the paths in that scope (`src/zerotierone/node/SelfAwareness.cpp:53-96`).

**Advertising.** Members that trust each other send `PUSH_DIRECT_PATHS` with all local interface addresses, UPnP/NAT-PMP mapped addresses and reflected addresses. This happens every 15 s without a direct path and every 120 s with one (`src/zerotierone/node/Peer.cpp:208-257`, `src/zerotierone/node/Constants.hpp:564-569`, `src/zerotierone/service/OneService.cpp:1370-1381`).

**Rendezvous and hole punching.** When a root relays a packet between two peers, it sends `RENDEZVOUS` to both sides, at most once every 30 s per pair (`src/zerotierone/node/Switch.cpp:174-192,1051-1056`, `src/zerotierone/node/Constants.hpp:538`). Each message holds the best endpoint of the other peer, chosen by scope and quality (`src/zerotierone/node/Peer.cpp:294-424`). A node accepts `RENDEZVOUS` only from upstream roots or moons. It first sends a 4-byte junk packet with TTL 2 to open its own NAT, then sends an ECHO or HELLO to the given endpoint (`src/zerotierone/node/IncomingPacket.cpp:709-732`). A reply on that path turns it into a known path (`src/zerotierone/node/Peer.cpp:135-177`).

**Port mapping and port diversity.** The service binds a random secondary port, and changes it after two ping periods offline. This works around NATs that break on one port (`src/zerotierone/service/OneService.cpp:1210-1228,1339-1354`). A third port is mapped through NAT-PMP, then UPnP, using the bundled libnatpmp and miniupnpc (`src/zerotierone/osdep/PortMapper.cpp:81-284`, `src/zerotierone/make-linux.mk:42-58`).

**Fallback.** Without a direct path, packets go through the root with the best `relayQuality`, which is latency scaled by time since last receive (`src/zerotierone/node/Topology.cpp:143-179`, `src/zerotierone/node/Peer.hpp:350-361`). If no UDP from a global address arrives for 60 s, the TCP relay is used as well (`src/zerotierone/service/OneService.cpp:3954-4010`). The release notes mention network-specific relays, but the code that would select them is commented out in `Topology::getUpstreamPeer` (`src/zerotierone/node/Topology.cpp:149-157`).

## NAT Traversal Checklist

### Discovery

- [x] **No own public node needed** - The default planet contains four ZeroTier-run roots that give rendezvous and relay to nodes that are all behind NAT (`src/zerotierone/node/Topology.cpp:21-58`).
- [x] **Public endpoint discovery (STUN or reflection)** - Server reflection: every `OK(HELLO)` echoes the observed source address, which `SelfAwareness::iam` stores (`src/zerotierone/node/IncomingPacket.cpp:468-475,516`, `src/zerotierone/node/SelfAwareness.cpp:53-96`).
- [x] **Multiple discovery servers** - Four roots in the default planet, plus optional moons (`src/zerotierone/node/Topology.cpp:21`, `src/zerotierone/service/OneService.cpp:1283-1290`).
- [ ] **NAT type detection** - `SelfAwareness` only collects reported surface addresses and does not classify NAT behavior (`src/zerotierone/node/SelfAwareness.cpp:98-111`).

### Port Mapping

- [x] **UPnP port mapping** - `PortMapper` uses the bundled miniupnpc for `UPNP_AddPortMapping`; `portMappingEnabled` defaults to true (`src/zerotierone/osdep/PortMapper.cpp:206-284`, `src/zerotierone/service/OneService.cpp:2890`).
- [x] **NAT-PMP support** - `PortMapper` tries NAT-PMP first with libnatpmp (`src/zerotierone/osdep/PortMapper.cpp:81-179`).
- [ ] **PCP support** - Only the NAT-PMP and UPnP-IGD code paths exist in `src/zerotierone/osdep/PortMapper.cpp:81-284`.

### Hole Punching

- [x] **UDP hole punching** - The root sends `RENDEZVOUS` to both peers, which send a low-TTL junk packet and then contact each other at the same time (`src/zerotierone/node/Peer.cpp:383-423`, `src/zerotierone/node/IncomingPacket.cpp:718-724`).
- [ ] **Symmetric NAT handling** - No port prediction; the only aids are the randomized secondary port and UPnP/NAT-PMP mapping (`src/zerotierone/service/OneService.cpp:1221-1246`).
- [x] **Rendezvous coordination** - Roots coordinate through `Peer::introduce` when they relay traffic between two peers (`src/zerotierone/node/Switch.cpp:176-190`, `src/zerotierone/node/Peer.cpp:294`).

### Fallback

- [x] **Relay fallback** - `Switch::_trySend` sends through the best upstream root when no direct path is alive (`src/zerotierone/node/Switch.cpp:1081-1090`).
- [x] **Multiple relays** - Any root or moon can relay, and members also forward over trusted paths (`src/zerotierone/node/Topology.cpp:160-176`, `src/zerotierone/node/Switch.cpp:163-195`).
- [x] **Latency-based relay selection** - `getUpstreamPeer` picks the root with the lowest `relayQuality`, which is latency-based (`src/zerotierone/node/Topology.cpp:143-179`, `src/zerotierone/node/Peer.hpp:350-361`).
- [x] **TCP relay support** - Built-in TCP fallback to `tcpFallbackRelay`, default `204.80.128.1/443`, IPv4 only (`src/zerotierone/service/OneService.cpp:151,2881,3954-3958`).

# Local Routing

## Peer Discovery on LANs

Version 1.16.0 has no broadcast or multicast LAN discovery. Protocol 13 dropped LAN announcement parsing (`src/zerotierone/node/Packet.hpp:58-62`), and no beacon handling remains in `Switch`. Peers find LAN endpoints through `PUSH_DIRECT_PATHS`, which lists the node's interface addresses (`RR->node->directPaths()`, `src/zerotierone/node/Peer.cpp:214-216`), and through root `RENDEZVOUS`, which picks the best shared address scope. Private scope is tried first (`src/zerotierone/node/Peer.cpp:370-381`).

## Routing Features

Path choice prefers LAN paths. `Path::quality` multiplies latency by `(MAX_SCOPE - scope + 1)`, so a private-scope path weighs 4x less than a global one (`src/zerotierone/node/Path.hpp:293-298`, `src/zerotierone/node/InetAddress.hpp:56-63`). The controller pushes managed routes that the node installs in the OS. Full-tunnel and global routes need `allowDefault`/`allowGlobal`, which default to false (`src/zerotierone/service/OneService.cpp:308-311`). Route metrics are present in the API but marked "not currently used" (`src/zerotierone/include/ZeroTierOne.h:954-956`). DNS settings from the controller are ignored on Linux, and a warning is printed (`src/zerotierone/osdep/LinuxEthernetTap.hpp:55-57`). Trusted physical paths can skip encryption entirely (`src/zerotierone/service/OneService.cpp:1569-1581`).

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - No LAN beacon or broadcast discovery exists; protocol 13 removed LAN announcement parsing (`src/zerotierone/node/Packet.hpp:62`).
- [x] **Direct path advertisement** - `PUSH_DIRECT_PATHS` carries local interface and reflected addresses to trusted peers (`src/zerotierone/node/Peer.cpp:208-257`).

### LAN Optimization

- [x] **Automatic LAN preference** - The path quality metric scales latency by IP scope, so private LAN paths win over global ones (`src/zerotierone/node/Path.hpp:293-298`).
- [x] **Trusted path mode** - `physical.<cidr>.trustedPathId` in `local.conf` enables cipher suite 2, which has no encryption and no MAC (`src/zerotierone/service/OneService.cpp:1569-1581`, `src/zerotierone/node/IncomingPacket.cpp:45-57`).
- [ ] **LAN-only mode** - New peers need a root for WHOIS and rendezvous, and members need the controller for config; with no LAN discovery, a fresh offline LAN cannot form a network (`src/zerotierone/node/Switch.cpp:914-933`, `src/zerotierone/node/IncomingPacket.cpp:155-157`).

### Routing Features

- [x] **Subnet routes** - The controller can push managed routes with a `via` member, which the node installs as OS routes (`src/zerotierone/include/ZeroTierOne.h:941-956`, `src/zerotierone/service/OneService.cpp:3021`).
- [x] **Full tunnel mode** - A default route through a member works when the client sets `allowDefault` (`src/zerotierone/service/OneService.cpp:310,376-381`).
- [x] **Split tunneling** - By default only managed (non-global, non-default) routes go through ZeroTier (`src/zerotierone/service/OneService.cpp:308-311`).
- [ ] **Route priorities** - The route `metric` field is documented as not used, and there is no failover between gateways (`src/zerotierone/include/ZeroTierOne.h:954-956`).
- [ ] **Multi-hop routing via peers** - No routing protocol exists; members forward only opportunistically over trusted paths, and gateway routing is done by the OS (`src/zerotierone/node/Switch.cpp:163-195`).
- [ ] **Built-in DNS** - There is no resolver for peer names, and on Linux even controller-pushed DNS servers are ignored (`src/zerotierone/osdep/LinuxEthernetTap.hpp:55-57`).

# Central Point of Failure

## What Happens When the Network Controller or Roots Fail

**Controller down.** Members keep their last signed config and COM from `networks.d` (`src/zerotierone/node/Network.cpp:682-707`). COMs are compared by their time delta relative to each other, not against the clock, so members with old certificates keep accepting each other (`src/zerotierone/node/CertificateOfMembership.cpp:46-72`). Existing traffic keeps flowing. New members cannot join, config and rule changes do not spread, and revocations stop. SSO members whose `authenticationExpiryTime` passes cannot renew (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp:1731-1762`).

**Roots down.** Direct paths between peers stay up, because peers send HELLO/ECHO to each other (`src/zerotierone/node/Constants.hpp:374-389`). Relaying, WHOIS for unknown addresses, rendezvous for new pairs and endpoint reflection from roots all stop. Peers whose NAT blocks a direct path lose contact. Cached peers in `peers.d` give identities and path hints after a restart (`src/zerotierone/node/Topology.cpp:102-120`, `src/zerotierone/node/Peer.hpp:585-596`).

## Mitigation Strategies

- Moons (`zerotier-idtool initmoon/genmoon`, `zerotier-cli orbit`) add self-hosted roots that do discovery and relay for one's own nodes (`src/zerotierone/one.cpp:1566-1595`, `src/zerotierone/service/OneService.cpp:1283-1290`). The release notes call moons deprecated (`src/zerotierone/RELEASE-NOTES.md:14`).
- A replacement `planet` file in the home directory swaps out the default roots entirely (`src/zerotierone/service/OneService.cpp:3763-3765`).
- The controller can run on one's own host. Its README suggests cold standby by copying `controller.d` to a backup host (`src/zerotierone/nonfree/controller/README.md`).
- The four default roots are spread across different IPv4 and IPv6 endpoints (`src/zerotierone/node/Topology.cpp:21`).

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Direct paths and cached configs keep working without controller or roots (`src/zerotierone/node/Network.cpp:682-707`, `src/zerotierone/node/Peer.cpp:261-292`).
- [x] **Local state caching** - `peers.d`, `networks.d`, `planet` and `moons.d` are stored on disk and loaded again (`src/zerotierone/service/OneService.cpp:3755-3780`).
- [x] **Cached credentials** - The signed network config and COM are cached and remain valid relative to other members (`src/zerotierone/node/Network.cpp:685-693`, `src/zerotierone/node/CertificateOfMembership.cpp:46-72`).

### Redundancy

- [ ] **Decentralized control plane** - Each network ID embeds its controller's address, and that controller signs the network config and membership certificates (`src/zerotierone/node/Network.hpp:83-86`, `src/zerotierone/node/Network.cpp:1134-1138`).
- [x] **Fully self-hostable** - The controller (source-available `nonfree/`), moons or a custom planet, and relaying all run on own hosts; only the default TCP fallback relay code is not in the tree (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp`, `src/zerotierone/one.cpp:1566-1595`).
- [ ] **Controller redundancy** - Each network is bound to one controller address inside its network ID, and no active-active controller code exists for the file-based controller (`src/zerotierone/node/Network.hpp:83-86`).
- [x] **Relay redundancy** - Four roots plus any moons, chosen by latency (`src/zerotierone/node/Topology.cpp:21,143-179`).
- [ ] **No single root of trust** - The controller key alone authorizes members and signs configs, and one planet key signs root updates (`src/zerotierone/node/Network.cpp:1134-1138`, `src/zerotierone/node/World.hpp:167-176`).

# Authentication

## How Nodes Join and Authenticate

A node creates its identity on first start (`src/zerotierone/node/Node.cpp:95`) and runs `zerotier-cli join <nwid>`, which POSTs to the local API (`src/zerotierone/one.cpp:838-846`). The node then asks the controller for a config. The controller authorizes the member if any of these holds (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp:1680-1716`):

- the member record is marked `authorized` (admin approval);
- the network is public (`private=false`);
- the request carries a valid `token:` from the network's `authTokens`.

The 1.16.0 client never sends that token: `Network::requestConfiguration` adds no `ZT_NETWORKCONFIG_REQUEST_METADATA_KEY_AUTH` field (`src/zerotierone/node/Network.cpp:1422-1434`). For SSO networks, the controller replies `NC_ERROR_AUTHENTICATION_REQUIRED` with OIDC parameters. The client's Rust `zeroidc` module then builds a browser login URL (`src/zerotierone/service/OneService.cpp:414-431`). SSO data only comes from the PostgreSQL-backed controllers (`CV1`/`CV2`). The file-based `DB::getSSOAuthInfo` returns an empty `AuthInfo` (`src/zerotierone/nonfree/controller/DB.hpp:128-131`, `src/zerotierone/nonfree/controller/CV1.cpp:346`). Once authorized, the member gets a signed COM. Peers check COMs against each other before they accept frames.

## Authentication Checklist

### Enrollment Methods

- [ ] **Pre-authentication keys** - The controller checks `authTokens`, but no client in this tree sends the auth metadata key, so the feature is unreachable from ZeroTier One (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp:1691-1707`, `src/zerotierone/node/Network.cpp:1422-1434`).
- [ ] **Certificate-based enrollment** - The COM is issued after authorization; no CA-signed certificate admits a node (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp:1679-1688,1803-1812,2258-2260`).
- [x] **OAuth/OIDC** - Partial: the client links `zeroidc` (openidconnect 3.5) on x86_64/arm64, but only the PostgreSQL controllers (hosted service or central build) give SSO data, not the self-hosted file controller (`src/zerotierone/make-linux.mk:310-317`, `src/zerotierone/nonfree/controller/DB.hpp:128-131`).
- [x] **Interactive login** - Partial: the same SSO browser flow through `zeroidc_get_auth_url`, only with an SSO-capable controller (`src/zerotierone/service/OneService.cpp:414-431`).
- [x] **CLI authentication** - `zerotier-cli join <nwid>` starts enrollment (`src/zerotierone/one.cpp:838-846`).

### Authorization

- [x] **Admin approval workflow** - Networks are private by default, and members stay unauthorized until an admin sets `authorized` (`src/zerotierone/nonfree/controller/DB.cpp:26-27`, `src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp:1680-1685`).
- [x] **Automated enrollment rules** - Partial: the only automatic rule is a public network that admits everyone; token admission exists on the controller but no client uses it (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp:1685-1707`).
- [ ] **Ephemeral nodes** - No code removes members automatically when they go offline; the service only deletes stale `peers.d` cache files after 30 days (`src/zerotierone/service/OneService.cpp:1427-1430`).
- [x] **Node expiry** - Partial: only SSO members expire through `authenticationExpiryTime`; ordinary authorized members never expire (`src/zerotierone/nonfree/controller/EmbeddedNetworkController.cpp:1731-1762`).

### Identity

- [x] **Stable device identity** - The identity is kept in `identity.secret`/`identity.public` and does not change with IP address (`src/zerotierone/service/OneService.cpp:3757-3761`).
- [x] **Identity portability** - The identity is a plain file loaded from the home directory, so copying `identity.secret` moves the ZeroTier address; nothing binds it to hardware (`src/zerotierone/service/OneService.cpp:3757-3761`, `src/zerotierone/node/Identity.hpp:209-213`).

# Platform Support

## Supported Platforms

The tree has build files and TAP drivers for these platforms (`src/zerotierone/make-linux.mk`, `src/zerotierone/osdep/`):

- Linux: `make-linux.mk`, `LinuxEthernetTap`;
- macOS: `make-mac.mk`, `MacEthernetTap`, `MacKextEthernetTap`;
- Windows: `windows/`, `WindowsEthernetTap`;
- FreeBSD and OpenBSD: `make-bsd.mk`, `BSDEthernetTap`;
- NetBSD: `make-netbsd.mk`, `NetBSDEthernetTap`.

Android is supported through the JNI SDK in `src/zerotierone/java`. `src/zerotierone/node/Constants.hpp` has iOS platform names for the core library (`src/zerotierone/node/Constants.hpp:208,223-227`). The official mobile apps live outside this repository (inferred). The repository also ships Docker release files (`src/zerotierone/Dockerfile.release`, `src/zerotierone/entrypoint.sh.release`, `src/zerotierone/README.docker.md`).

## Implementation Details

The core (`src/zerotierone/node`) is a portable C++ library behind the C API in `src/zerotierone/include/ZeroTierOne.h`. `src/zerotierone/service/OneService.cpp` adds the OS glue: sockets, TAP, routes, the HTTP API and port mapping. On Linux, the TAP and routes go through `LinuxEthernetTap` and `LinuxNetLink` unless `ZT_EXTOSDEP=1` (`src/zerotierone/make-linux.mk:29-35`). The benchmark binary is the default x86_64 Linux build. It uses `-O3`, x64 Salsa20/12 and Ed25519 assembly, the SSO helper linked against OpenSSL, and the bundled miniupnpc and libnatpmp (`src/zerotierone/make-linux.mk:42-58,85-90,127-133,310-317,379-386`). The `lzo` and `zlib` sources under `deps/` are build inputs of the package, but the Makefiles do not link them (`src/zerotierone/make-linux.mk`, inferred from absence).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - `make-linux.mk` with `LinuxEthernetTap`/`LinuxNetLink` is the benchmarked build (`src/zerotierone/make-linux.mk:33-34`).
- [x] **macOS** - `make-mac.mk` with `MacEthernetTap` and `MacKextEthernetTap` (`src/zerotierone/osdep/MacEthernetTap.cpp`).
- [x] **Windows** - Visual Studio solution and TAP driver in `windows/`, plus `WindowsEthernetTap` (`src/zerotierone/osdep/WindowsEthernetTap.cpp`).
- [x] **FreeBSD/OpenBSD** - `make-bsd.mk` builds `BSDEthernetTap`, which has FreeBSD code and OpenBSD-specific branches (`src/zerotierone/make-bsd.mk:19`, `src/zerotierone/osdep/BSDEthernetTap.cpp:153,375-390`).

### Mobile

- [x] **iOS** - The core has iOS platform targets (`src/zerotierone/node/Constants.hpp:223-227`); the official iOS app lives in a separate ZeroTier repository (inferred).
- [x] **Android** - The JNI SDK binding is in `src/zerotierone/java/jni/com_zerotierone_sdk_Node.cpp`, and the official Android app is separate (inferred).

### Implementation

- [ ] **Kernel-mode datapath** - All encryption and switching happen in the userspace daemon; the kernel only supplies the TAP device (`src/zerotierone/osdep/LinuxEthernetTap.cpp:140-213`).
- [x] **Container support** - An official Docker release image and entrypoint ship in the repository (`src/zerotierone/Dockerfile.release`, `src/zerotierone/entrypoint.sh.release`).
