# Overview

Hyprspace is a small mesh VPN written in Go on top of libp2p. This version (v0.10.2+7, rev a5957e48) is the fork maintained by Max Headroom (privatevoid.net). It continues the original project by Alec Scott (`src/hyprspace/README.md`, "About the Fork" and "License"). The license is Apache 2.0 (`src/hyprspace/LICENSE`, `src/hyprspace/package.nix:40`). Each node has an Ed25519 libp2p identity. Its config file lists the peer IDs it trusts. The tunnel addresses are derived from those peer IDs. Hyprspace looks up the network addresses of its peers in the public libp2p/IPFS Kademlia DHT, through a delegated HTTP router and through peer exchange with other VPN members. It then opens a libp2p connection to each peer and sends every IP packet read from the TUN device as a 2-byte length prefix plus payload on one long-lived libp2p stream per peer (`src/hyprspace/cli/up.go:270-332`).

At a glance:

- **Language:** Go (`src/hyprspace/go.mod:1-5`). The binary is built with `CGO_ENABLED=0` (`src/hyprspace/package.nix:23`).
- **License:** Apache License 2.0 (`src/hyprspace/LICENSE`).
- **Default peer transport:** QUIC v1 over UDP port 8001 with TCP port 8001 as fallback (`src/hyprspace/cli/init.go:45-50`, `src/hyprspace/p2p/node.go:139-140`). libp2p dials QUIC first and delays TCP by 30 ms (private) or 250 ms (public) (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/net/swarm/dial_ranker.go:16-21,81-100`). A circuit-relay-v2 connection through another node is the last resort.
- **Data cipher (default):** TLS 1.3 `TLS_AES_128_GCM_SHA256` inside QUIC on CPUs with AES-GCM hardware. `TLS_CHACHA20_POLY1305_SHA256` is used otherwise, and `TLS_AES_256_GCM_SHA384` is also accepted (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/cipher_suite.go:26-33`, `deps/hyprspace/go-stdlib/crypto/tls/cipher_suites.go:371-376`). On the TCP fallback the same TLS 1.3 suites are used, or Noise with ChaChaPoly if the remote lacks TLS.
- **Handshake:** TLS 1.3 (libp2p TLS, `MinVersion: tls.VersionTLS13`) with X25519 ECDHE. Both sides authenticate with a self-signed ECDSA P-256 certificate that carries an extension signed by the Ed25519 host key (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:90-101,243`). Noise XX (25519, ChaChaPoly, SHA256) is the second security option on TCP (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/noise/handshake.go:27,46`).
- **Default tunnel MTU:** 1420, set by `tun.MTU(1420)` in `src/hyprspace/cli/up.go:88`.
- **Control-plane model:** lighthouse/bootstrap nodes. There is no controller. Peers are found through the public libp2p DHT, entered via hardcoded bootstrap nodes and the delegated router `https://p2p.privatevoid.net` (`src/hyprspace/p2p/node.go:178-199,257-262`).
- **Data-plane threading:** multi-threaded through Go goroutines. One goroutine reads the TUN device, one goroutine is spawned per outbound packet, and quic-go runs one run-loop goroutine per peer connection (`src/hyprspace/cli/up.go:216-266`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/connection.go:495-508`).

## Key Architecture Components

**Control plane.** Hyprspace has no central server. The trust list is the `peers` array in the local JSON config, with only `id`, `name` and `routes` per peer (`src/hyprspace/config/config.go:33-38`, `src/hyprspace/nixos/settings.nix:15-44`). The daemon exposes a local net/rpc server on `/run/hyprspace-rpc.<iface>.sock` for `status`, `peers` and `route` commands (`src/hyprspace/rpc/server.go:166-191`).

**Discovery.** `p2p.CreateNode` builds a Kademlia DHT in client mode with 20 static bootstrap multiaddrs. Some of these are project nodes and some are the public `bootstrap.libp2p.io` nodes (`src/hyprspace/p2p/node.go:178-199,223-246`). It adds an HTTP delegated router at `https://p2p.privatevoid.net` (`src/hyprspace/p2p/node.go:257-262`). `ParallelRouting` queries PeX, the DHT and the delegated router in parallel and merges the results (`src/hyprspace/p2p/routing.go:22-48`, `src/hyprspace/p2p/node.go:271-277`). `p2p.Discover` re-dials configured peers with a backoff from 1 s up to 60 s (`src/hyprspace/p2p/discover.go:17-56`). The PeX protocol `/hyprspace/pex/0.0.1` hands known peer addresses to other VPN members (`src/hyprspace/p2p/pex.go:26,37-71`).

**Transport.** libp2p v0.38.0 with only two transports, QUIC (quic-go v0.48.2) and TCP, set explicitly (`src/hyprspace/p2p/node.go:139-140`). Security is `libp2p.DefaultSecurity` (TLS first, then Noise) and the TCP muxer is yamux (`src/hyprspace/p2p/node.go:135,138`, `deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/defaults.go:30-39`). Port mapping, hole punching, circuit relay v2 (as client and server) and AutoNAT service are enabled (`src/hyprspace/p2p/node.go:137,141-169`).

**Data path.** The TUN device comes from `songgao/water` with `IFF_TUN|IFF_NO_PI` (`src/hyprspace/tun/tun_linux.go:15-35`, `deps/hyprspace/go-modules/github.com/songgao/water/syscalls_linux.go:32-40`). The main loop reads a packet, finds the destination peer in a `cidranger` trie, and passes the packet to `sendPacket`. `sendPacket` writes `uint16` length plus payload on the cached stream `/hyprspace/0.0.1` (`src/hyprspace/cli/up.go:216-332`, `src/hyprspace/p2p/node.go:52`). `streamHandler` reads length-prefixed packets from each inbound stream and writes them to the TUN device (`src/hyprspace/cli/up.go:393-430`). A separate "service network" uses a gVisor netstack to proxy TCP services over `/hyprspace/service/0.0.1` (`src/hyprspace/svc/network.go:84-134`).

**Identity.** `hyprspace init` generates an Ed25519 key (`src/hyprspace/cli/init.go:36`). The peer ID is the multihash of the public key. The IPv4 address is `100.64.x.y`, with the last two bytes built by XOR-folding the peer ID. The IPv6 address is in `fd00:6879:7072:7370:6163:6500::/96`, with the last 32 bits taken from a net ID built from the peer ID (`src/hyprspace/config/idhash.go:9-42`).

# Protocol

## Control Plane

No coordination server exists. Each node reads its own config at startup (`src/hyprspace/config/config.go:57-159`) and only accepts streams from peer IDs listed there (`src/hyprspace/cli/up.go:395-398`, `src/hyprspace/p2p/pex.go:39-49`, `src/hyprspace/svc/receiver.go:11-14`). Address discovery uses three sources in parallel (`src/hyprspace/p2p/routing.go:22-48`):

1. **PeX:** asks every connected VPN peer for the peerstore addresses of the other VPN peers (`src/hyprspace/p2p/pex.go:73-112,160-186`). PeX also runs on every connect or disconnect event of a VPN peer and stores the results with a 30 s TTL (`src/hyprspace/p2p/pex.go:114-158`).
2. **Kademlia DHT** in client mode, bootstrapped from the hardcoded list. The list can be extended with peers and bootstrap nodes from a local IPFS API set in `HYPRSPACE_IPFS_API` (`src/hyprspace/p2p/node.go:207-246`).
3. **Delegated HTTP routing** at `https://p2p.privatevoid.net`, with the node's key as identity (`src/hyprspace/p2p/node.go:257-262`).

After `FindPeer` returns its first result, the other sources get 500 ms to add addresses (`src/hyprspace/p2p/routing.go:40`). Configured peers are protected in the connection manager (`src/hyprspace/cli/up.go:129-131`). A ping service records RTT per peer in the peerstore for display (`src/hyprspace/p2p/metrics.go:16-52`). `SIGUSR1` trims connections, refreshes the DHT and forces rediscovery (`src/hyprspace/cli/up.go:344-348`). Routes can be added or removed at runtime through the RPC `Route` method (`src/hyprspace/rpc/server.go:59-155`).

## Data Plane

Outbound: `UpRun` allocates a fresh 1420-byte slice for every read from the TUN fd (`src/hyprspace/cli/up.go:217-219`). It checks the IP version nibble and drops packets to its own address. IPv6 TCP to the service network range `fd00:6879:7072:7370:7376::/80` goes to the gVisor netstack (`src/hyprspace/cli/up.go:231-257`). For other packets it calls `cfg.FindRouteForIP` and starts `go sendPacket(dst, packet, plen)` (`src/hyprspace/cli/up.go:261-266`). `sendPacket` looks up `activeStreams[dst]` and takes the per-stream mutex. It then writes the 2-byte little-endian length and the packet as two separate `Write` calls and pushes the write deadline out by 25 s (`src/hyprspace/cli/up.go:272-298`). If no stream exists, it opens one with `node.NewStream(ctx, dst, p2p.Protocol)` and caches it (`src/hyprspace/cli/up.go:301-331`). A failed open triggers `p2p.Rediscover()` (`src/hyprspace/cli/up.go:304`).

Inbound: `streamHandler` runs per incoming stream. It reads 2 bytes of length, loops until `size` bytes are read into a 1420-byte buffer, and writes the packet to the TUN device (`src/hyprspace/cli/up.go:399-428`).

Framing: the wire format is `[u16 LE length][IP packet]` repeated on one bidirectional QUIC stream (or yamux stream on TCP) per direction and peer. QUIC carries the stream in STREAM frames. Each QUIC packet is protected by TLS 1.3 derived AEAD keys and header protection (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/cipher_suite.go:39-66`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/header_protector.go:27-37`). The QUIC config sets a 15 s keepalive, 10 MB stream and 15 MB connection receive windows, and allows 256 incoming streams (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/transport/quicreuse/config.go:9-18`). Because every packet rides in one reliable ordered stream, a lost QUIC packet stalls all later tunnel packets to that peer until it is retransmitted.

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - Partial: UDP is used only as the carrier for QUIC v1, not as plain UDP encapsulation; the listeners are `/ip4/0.0.0.0/udp/8001/quic-v1` and `/ip6/::/udp/8001/quic-v1` (`src/hyprspace/cli/init.go:45-50`, `src/hyprspace/p2p/node.go:139`).
- [ ] **Datagram encapsulation (no head-of-line blocking)** - Packets are length-prefixed on one reliable ordered libp2p stream per peer (`src/hyprspace/cli/up.go:279-283`), and QUIC datagrams are not used for tunnel traffic.
- [x] **TCP fallback** - TCP is always enabled next to QUIC, and the default dial ranker dials TCP automatically 30/250 ms after QUIC (`src/hyprspace/p2p/node.go:140`, `deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/net/swarm/dial_ranker.go:16-21,62-64`).
- [x] **QUIC support** - QUIC (quic-go v0.48.2 through `libp2pquic.NewTransport`) is the preferred peer transport (`src/hyprspace/p2p/node.go:139`).
- [ ] **WebSocket support** - The explicit transport list contains only QUIC and TCP, so libp2p's default WebSocket transport is not added (`src/hyprspace/p2p/node.go:139-140`, `deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/defaults.go:155-161`).

### IP Support

- [x] **IPv4 support** - Each node gets a `/32` from `100.64.0.0/16` and the TUN loop routes IPv4 packets by destination (`src/hyprspace/cli/up.go:86,233-237`, `src/hyprspace/config/idhash.go:9-15`).
- [x] **IPv6 support** - Each node gets a `/128` inside `fd00:6879:7072:7370:6163:6500::/96`, and IPv6 packets are routed the same way (`src/hyprspace/cli/up.go:87,238-241`, `src/hyprspace/config/idhash.go:17-25`).
- [x] **Dual-stack** - Both addresses are assigned to the same `hyprspace` TUN interface at creation (`src/hyprspace/cli/up.go:84-89`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - The device is opened as `water.TUN` and only IPv4/IPv6 packets are forwarded (`src/hyprspace/tun/tun_linux.go:17-18`, `src/hyprspace/cli/up.go:231-257`).
- [ ] **Layer 2 (Ethernet) mode** - No TAP mode exists; `tun.New` always sets `DeviceType: water.TUN` (`src/hyprspace/tun/tun_linux.go:17-18`).
- [ ] **Bridging support** - Without Layer 2 frames there is nothing to bridge; the code has no bridge handling (`src/hyprspace/tun/tun_linux.go`).

### Advanced Protocol Features

- [ ] **Multipath/bonding** - One cached stream per peer carries all packets (`src/hyprspace/cli/up.go:47,272`), and libp2p picks a single best connection for new streams (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/net/swarm/swarm.go:594-645`).
- [ ] **QoS/traffic shaping** - The send path has no queues, classes or rate limits (`src/hyprspace/cli/up.go:270-332`).
- [ ] **Multicast support** - Packets are only forwarded when `FindRouteForIP` finds a unicast route to one peer, and nothing replicates multicast or broadcast (`src/hyprspace/cli/up.go:261-266`).

# Encryption

## Encryption Layer Details

Hyprspace adds no crypto of its own. All protection comes from the libp2p connection security.

**Handshake.** On the default QUIC path, quic-go runs a TLS 1.3 handshake through Go's `crypto/tls`. The libp2p TLS identity sets `MinVersion: tls.VersionTLS13`, requires a client certificate and disables session tickets (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:90-101`). Each side presents a fresh self-signed ECDSA P-256 certificate (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:243`). The certificate carries an extension with the Ed25519 host public key and a signature over the certificate key. `PubKeyFromCertChain` checks that signature, and `ConfigForPeer` rejects a key that does not match the expected peer ID (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:111-213`). The key exchange is ECDHE with Go's default curve list. Go 1.25.2 would put `X25519MLKEM768` first, but only when the `tlsmlkem` GODEBUG is on (`deps/hyprspace/go-stdlib/crypto/tls/defaults.go:17-25`). That setting defaults to `0` for modules that declare a Go version below 1.24 (`deps/hyprspace/go-stdlib/internal/godebugs/table.go:65`), and Hyprspace declares `go 1.22.0` (`src/hyprspace/go.mod:3`). So the effective key exchange is X25519 (inferred from the GODEBUG default mechanism; no `godebug` override is present in `src/hyprspace/go.mod`). On TCP the upgrader offers `/tls/1.0.0` first and `/noise` second (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/defaults.go:30-33`). Between two Hyprspace nodes TLS 1.3 is therefore chosen. Noise XX with `DH25519/ChaChaPoly/SHA256` is only used with peers that lack TLS (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/noise/handshake.go:27,46`).

**Key derivation and data cipher.** QUIC derives packet keys with HKDF from the TLS 1.3 traffic secrets. The AEAD is AES-128-GCM, AES-256-GCM or ChaCha20-Poly1305 depending on the negotiated suite, with a 12-byte nonce made by XOR of the IV and the packet number (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/cipher_suite.go:15-100`). Go prefers AES-GCM when `hasAESGCMHardwareSupport` is true, which on amd64 means AES-NI, PCLMULQDQ, SSE4.1 and SSSE3 (`deps/hyprspace/go-stdlib/crypto/tls/cipher_suites.go:371-376`). The assembly is in `deps/hyprspace/go-stdlib/crypto/internal/fips140/aes/gcm/gcm_amd64.s`. ChaCha20-Poly1305 comes from `golang.org/x/crypto/chacha20poly1305` (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/cipher_suite.go:10,57-66`).

**Nonce and replay handling.** QUIC packet numbers are never reused, and the receiver drops packets whose number was already seen via `IsPotentiallyDuplicate` (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/ackhandler/received_packet_handler.go:111-122`).

**Rekeying.** quic-go starts a QUIC key update after the first 100 packets and then every 100,000 packets sent or received (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/updatable_aead.go:17-23`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/protocol/params.go:167-168`). Each new connection runs a fresh ephemeral ECDHE.

**Private network option.** `HYPRSPACE_SWARM_KEY` loads a libp2p PSK (`src/hyprspace/p2p/node.go:113-125`). The QUIC transport refuses to start with a PSK ("QUIC doesn't support private networks yet"), and Hyprspace always adds QUIC. Setting the variable therefore makes `libp2p.New` fail (inferred from `deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/transport/quic/transport.go:75-79` and `src/hyprspace/p2p/node.go:139`; not run).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - TLS 1.3 ECDHE uses X25519 first in Go's default list (`deps/hyprspace/go-stdlib/crypto/tls/defaults.go:21-23`), and the Noise fallback uses `noise.DH25519` (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/noise/handshake.go:27`).
- [x] **Perfect Forward Secrecy** - Session keys come from ephemeral ECDHE in TLS 1.3 (`deps/hyprspace/go-stdlib/crypto/tls/handshake_client.go:177`, `deps/hyprspace/go-stdlib/crypto/tls/key_schedule.go:62-68`) or ephemeral Noise XX keys (`deps/hyprspace/go-modules/github.com/flynn/noise/state.go:405-406`, `deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/noise/handshake.go:39`), and the long-term Ed25519 key only signs.
- [ ] **Post-quantum readiness** - `X25519MLKEM768` exists in Go 1.25.2 but is off because `src/hyprspace/go.mod:3` declares `go 1.22.0` and `tlsmlkem` defaults to `0` below Go 1.24 (`src/hyprspace/go.mod:3`, `deps/hyprspace/go-stdlib/internal/godebugs/table.go:65`) (inferred from the GODEBUG mechanism).
- [x] **Key rotation** - quic-go performs QUIC key updates after 100 packets and then every 100,000 packets (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/updatable_aead.go:19-23`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/protocol/params.go:168`).

### Symmetric Encryption

- [x] **Authenticated encryption** - QUIC packets are sealed with AES-GCM or ChaCha20-Poly1305 AEADs (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/cipher_suite.go:26-66`).
- [x] **Hardware-accelerated crypto** - Go's AES-GCM uses AES-NI/PCLMULQDQ assembly on amd64 and AES/PMULL on arm64 (`deps/hyprspace/go-stdlib/crypto/internal/fips140/aes/gcm/gcm_amd64.s`, `deps/hyprspace/go-stdlib/crypto/tls/cipher_suites.go:371-376`).
- [x] **Constant-time operations** - All data-path crypto comes from Go's `crypto/aes`, `crypto/cipher` and `x/crypto/chacha20poly1305`, which are constant-time implementations (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/handshake/cipher_suite.go:5-10`).

### Protocol Security

- [x] **Replay protection** - quic-go drops duplicate packet numbers per encryption level (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/ackhandler/received_packet_handler.go:111-122`).
- [ ] **Noise Protocol** - The default QUIC path and TCP between Hyprspace nodes use TLS 1.3, because TLS is offered before Noise (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/defaults.go:30-33`). Noise XX is only a fallback for non-TLS peers.
- [x] **No cleartext metadata** - TLS 1.3 encrypts the certificates that carry the libp2p public key, and libp2p sets no SNI or peer ID in the ClientHello (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:90-101`). A passive observer sees QUIC connection IDs and, on TCP, only the multistream protocol name `/tls/1.0.0`.
- [x] **End-to-end encryption through relays** - Circuit-relay connections are upgraded with TLS/Noise end to end by `c.upgrader.Upgrade`, so the relay only forwards ciphertext (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/client/transport.go:77-86`).

# Performance

## Threading Model

**TUN to socket.** A single goroutine in `UpRun` loops on `tunDev.Iface.Read(packet)`. It does one `read()` per packet on the `water` fd, which is opened without `IFF_MULTI_QUEUE` or `IFF_VNET_HDR` (`src/hyprspace/cli/up.go:216-219`, `deps/hyprspace/go-modules/github.com/songgao/water/syscalls_linux.go:32-40`). Every iteration heap-allocates a new 1420-byte buffer (`src/hyprspace/cli/up.go:217`). It does a `cidranger` trie lookup, which allocates a result slice (`src/hyprspace/config/config.go:212-224`), and spawns a new goroutine `go sendPacket(...)` per packet (`src/hyprspace/cli/up.go:265`). The goroutines race for the per-stream mutex. Packets can therefore leave in a different order than they were read. The `activeStreams` map is read and written from these goroutines without any lock (`src/hyprspace/cli/up.go:272,294,328`). Each packet costs two `Write` calls on the libp2p stream: `binary.Write` of the length, then the payload (`src/hyprspace/cli/up.go:279-283`). The QUIC stream copies the data into its send buffer. The quic-go connection run loop `(*connection).run` packs STREAM frames, encrypts and hands packets to a separate send-queue goroutine (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/connection.go:495-508`). If the socket supports it, quic-go sends several packets in one `sendmsg` with `UDP_SEGMENT` (GSO) (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/connection.go:1907-1910,1946`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_helper_linux.go:66-90`). Otherwise it does one `WriteMsgUDP` per packet (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_oob.go:240-260`).

**Socket to TUN.** `(*Transport).listen` runs one goroutine per UDP socket. It calls `ReadPacket`, which uses `ipv4.PacketConn.ReadBatch` (Linux `recvmmsg`) with a batch of 8 into pooled 1452-byte buffers (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/transport.go:361-366`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_oob.go:138-174`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_helper_linux.go:24`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/buffer_pool.go:69-71`, `deps/hyprspace/go-modules/golang.org/x/net/internal/socket/mmsghdr_unix.go:115`). Packets are dispatched to the owning connection, whose run loop decrypts them and fills the stream receive buffer (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/connection.go:1350`). The Hyprspace `streamHandler` goroutine for that stream reads the length and payload into a reused 1420-byte buffer and does one `write()` to the TUN fd per packet (`src/hyprspace/cli/up.go:399-428`).

**Cores.** Encryption and decryption for one peer happen in that peer's single quic-go run loop, so a single peer pair is limited to about one core for crypto plus the TUN and socket goroutines (inferred from the quic-go connection design). Several peers can use several cores. quic-go asks for 7 MB UDP receive and send buffers and retries with `SO_RCVBUFFORCE`/`SO_SNDBUFFORCE` (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/protocol/params.go:5-9`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn.go:29-49`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_buffers.go:14-56`). Hyprspace runs as root under the NixOS unit, so the force variant can succeed (`src/hyprspace/nixos/default.nix:90-99`). QUIC starts at 1280-byte packets and runs DPLPMTUD up to 1452 bytes once DF is set (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/protocol/params.go:12`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/protocol/protocol.go:111`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/connection.go:783-785`).

## Performance Optimizations Checklist

### Threading

- [x] **Multi-threaded processing** - Partial: Go goroutines spread the work, but all crypto for one peer runs in that peer's single quic-go run loop (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/connection.go:495-508`); only traffic to several peers uses several cores for crypto.
- [ ] **Multi-queue TUN / per-core sockets** - `water` sets `IFF_MULTI_QUEUE` only if `MultiQueue` is set, which Hyprspace never does (`src/hyprspace/tun/tun_linux.go:17-20`, `deps/hyprspace/go-modules/github.com/songgao/water/syscalls_linux.go:38-40`), and quicreuse uses one UDP socket per listen address.

### Packet I/O

- [x] **Batch UDP receives (recvmmsg)** - quic-go's `oobConn.ReadPacket` calls `ReadBatch`, which uses `recvmmsg` on Linux (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_oob.go:174`, `deps/hyprspace/go-modules/golang.org/x/net/internal/socket/mmsghdr_unix.go:115`).
- [ ] **Batch UDP sends (sendmmsg)** - quic-go sends with one `WriteMsgUDP` per call and uses GSO instead of `sendmmsg` (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_oob.go:240-260`).
- [ ] **Large batch sizes (64+)** - The receive batch is 8 (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_helper_linux.go:24`), and TUN I/O is one packet per syscall (`src/hyprspace/cli/up.go:219,428`).

### Offloads

- [x] **UDP GSO** - quic-go probes `UDP_SEGMENT` and uses `sendPacketsWithGSO` unless `QUIC_GO_DISABLE_GSO` is set (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_helper_linux.go:66-90`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/connection.go:1907-1910`).
- [ ] **UDP GRO** - quic-go v0.48.2 never sets `UDP_GRO` (no reference in quic-go's socket setup `deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_oob.go:94-101` or in `deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_helper_linux.go`).
- [ ] **TUN offload (virtio-net hdr)** - `water` opens the TUN with `IFF_TUN|IFF_NO_PI` only, without `IFF_VNET_HDR` or `TUNSETOFFLOAD` (`deps/hyprspace/go-modules/github.com/songgao/water/syscalls_linux.go:32-40`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - Partial: quic-go takes UDP packet buffers from a `sync.Pool` (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/buffer_pool.go:69-71`), but Hyprspace allocates a new 1420-byte slice for every TUN read (`src/hyprspace/cli/up.go:217`).
- [x] **Large UDP socket buffers (MB)** - quic-go requests 7 MB receive and send buffers and retries with the `FORCE` variants on Linux (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/protocol/params.go:5-9`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/sys_conn_buffers.go:14-56`).
- [ ] **Zero-allocation parsing** - Each outbound packet allocates a buffer, a goroutine and a `cidranger` result slice, and `binary.Write` goes through an `io.Writer` interface (`src/hyprspace/cli/up.go:217,261-265,279`, `src/hyprspace/config/config.go:212-224`).

### MTU and Peers

- [x] **Path MTU discovery** - quic-go's MTU discoverer probes between 1280 and 1452 bytes once the handshake is confirmed and DF is set (`deps/hyprspace/go-modules/github.com/quic-go/quic-go/connection.go:783-785`, `deps/hyprspace/go-modules/github.com/quic-go/quic-go/internal/protocol/protocol.go:111`); the tunnel MTU itself stays fixed at 1420 (`src/hyprspace/cli/up.go:88`).
- [x] **Endpoint caching** - The libp2p peerstore keeps known addresses, the swarm reuses the best open connection, and Hyprspace caches one stream per peer (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/net/swarm/swarm.go:627-645`, `src/hyprspace/cli/up.go:328-331`).

### Userspace TCP Stack

- [x] **Userspace TCP/IP stack** - A gVisor netstack (copied from wireguard-go `tun/netstack`) terminates TCP only for the optional Service Network `fd00:6879:7072:7370:7376::/80`; the normal tunnel datapath does not use it (`src/hyprspace/netstack/tun.go:6-7,57-80`, `src/hyprspace/svc/network.go:84-124`, `src/hyprspace/cli/up.go:242-253`).

### Data Plane Compression

- [ ] **Tunnel compression** - Packets are written to the stream as-is with no compression step (`src/hyprspace/cli/up.go:279-283`).
- [ ] **Configurable compression** - No compression exists, so there is nothing to configure (`src/hyprspace/nixos/settings.nix:49-93`).

# Security

## Known Security Issues

None found. The source tree contains no security advisories or changelog entries about vulnerabilities. This analysis had no network access, so no advisory database was queried. Readers should check go-libp2p v0.38.0, quic-go v0.48.2, golang.org/x/crypto v0.31.0, gVisor 20230927 and Go 1.25.2 (`src/hyprspace/go.mod:10,18,128,144`, `deps/hyprspace/go-stdlib/internal/goversion/goversion.go:12`) against current advisories.

## Potential Security Concerns

- **Remote crash by a configured peer.** `streamHandler` trusts the 16-bit length from the wire and reads into `packet[plen:size]` with a 1420-byte buffer (`src/hyprspace/cli/up.go:399,410-415`). A length above 1420 causes a slice-bounds panic in that goroutine, which ends the whole daemon. Any listed peer can trigger it.
- **Framing desync.** The 2-byte length is read with a single `stream.Read(packetSize)` without checking that both bytes arrived (`src/hyprspace/cli/up.go:403`). A short read shifts the framing and corrupts the rest of the stream.
- **Data race on `activeStreams`.** The map is read and written from one goroutine per packet without a lock (`src/hyprspace/cli/up.go:265,272,294,328`). Concurrent map writes can make the Go runtime abort the process, and two goroutines can open duplicate streams.
- **No source address check.** Inbound packets are written to the TUN device without checking that the inner source IP belongs to the sending peer (`src/hyprspace/cli/up.go:428`). Any configured peer can spoof the tunnel address of another peer or of a routed subnet.
- **IPv4 address collisions.** The IPv4 address is only 16 bits XOR-folded from the peer ID (`src/hyprspace/config/idhash.go:9-15`). Two peers can get the same address. `FindRouteForIP` then only prints a warning and uses the first match (`src/hyprspace/config/config.go:212-224`).
- **Unlimited relay service.** The relay is started with `relay.WithLimit(nil)`, so relayed circuits have no duration or byte limit (`src/hyprspace/p2p/node.go:142`, `deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay/relay.go:431-439`). `AllowConnect` admits a circuit if either the source or the destination is a configured peer (`src/hyprspace/p2p/relay.go:19-23`). Unknown sources can therefore use the node's bandwidth to reach VPN peers.
- **Broken private-network option.** `HYPRSPACE_SWARM_KEY` ignores the error from `pnet.DecodeV1PSK` (`src/hyprspace/p2p/node.go:123`), and combined with the always-enabled QUIC transport it stops node creation (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/transport/quic/transport.go:75-79`) (inferred).
- **Metadata exposure to public infrastructure.** Each node joins the public IPFS DHT and sends signed requests to `https://p2p.privatevoid.net` (`src/hyprspace/p2p/node.go:178-199,257-262`). Third parties can learn which peer IDs are online and at which IP addresses.
- **Runs as root without hardening.** The NixOS unit has no `User=`, capability bounding or sandbox settings (`src/hyprspace/nixos/default.nix:90-99`). The RPC socket is created with umask `007` (`src/hyprspace/rpc/server.go:176`). Under `Group = "wheel"`, all wheel users can add or delete routes through it.

## Security Features Checklist

### Network Security

- [x] **Handshake rate limiting** - Partial: libp2p's default resource manager caps concurrent connections at 8 per IPv4 `/32` and per IPv6 `/56` (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/host/resource-manager/conn_limiter.go:30-45`), but there is no handshake rate limit and libp2p does not set quic-go's `VerifySourceAddress` (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/transport/quicreuse/`).
- [ ] **Stateful packet filter** - Inbound packets go straight to the TUN device with no connection tracking (`src/hyprspace/cli/up.go:428`).
- [ ] **Fine-grained ACLs** - Access control is only "peer ID is in the config list" (`src/hyprspace/cli/up.go:395-398`), with no port or protocol rules.
- [ ] **Capability-based access** - There are no tags, groups or attributes; `config.Peer` holds only ID and name (`src/hyprspace/config/config.go:33-38`).

### Identity & Authentication

- [x] **Identity validation** - The peer ID is the hash of the Ed25519 public key and is verified against the signed TLS certificate extension (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:111-213`), and tunnel addresses are derived from the peer ID (`src/hyprspace/config/idhash.go:9-25`).
- [ ] **Signed config updates** - Each node reads a local JSON file and nothing distributes or signs config (`src/hyprspace/config/config.go:57-67`).
- [ ] **Control-server key pinning** - N/A: Hyprspace has no controller. The bootstrap multiaddrs carry pinned peer IDs (`src/hyprspace/p2p/node.go:178-199`), and the delegated router uses plain WebPKI HTTPS (`src/hyprspace/p2p/node.go:248-262`).

### Implementation

- [x] **Memory-safe language** - The data path is Go with `CGO_ENABLED=0` (`src/hyprspace/package.nix:23`); out-of-bounds access panics instead of corrupting memory.
- [ ] **Privilege separation** - The daemon keeps root for its whole life. The NixOS unit sets only `Group = "wheel"` (`src/hyprspace/nixos/default.nix:90-99`), and the code never drops privileges.
- [ ] **Sandboxing** - There is no seccomp, chroot or systemd sandboxing in the code or the NixOS unit (`src/hyprspace/nixos/default.nix:90-99`).
- [x] **Audit logging** - Partial: connects and disconnects of VPN peers, failed stream opens and unknown service requests are printed (`src/hyprspace/cli/up.go:303,368-391`, `src/hyprspace/svc/receiver.go:31`), but streams from unlisted peers are reset silently (`src/hyprspace/cli/up.go:395-398`) and handshake failures stay at libp2p debug level.

# NAT Traversal

## How NAT Traversal Works

Everything comes from libp2p options set in `p2p.CreateNode` (`src/hyprspace/p2p/node.go:130-172`).

1. **Address discovery.** The identify protocol reports the address a remote peer saw (observed address, i.e. server reflection). The `ObservedAddrManager` turns these into candidate public addresses. `natEmitter` classifies UDP and TCP NAT behaviour as cone or symmetric when reachability is private (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/identify/id.go:215-223`, `deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/identify/nat_emitter.go:94-110`, `deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/identify/obsaddr.go:543`). AutoNAT probes reachability, and `EnableNATService` lets this node answer AutoNAT probes for others (`src/hyprspace/p2p/node.go:143`).
2. **Port mapping.** `libp2p.NATPortMap()` uses `libp2p/go-nat`, which tries UPnP IGD and NAT-PMP and picks the gateway that matches the default route (`src/hyprspace/p2p/node.go:137`, `deps/hyprspace/go-modules/github.com/libp2p/go-nat/nat.go:88-119`, `deps/hyprspace/go-modules/github.com/libp2p/go-nat/upnp.go`, `deps/hyprspace/go-modules/github.com/libp2p/go-nat/natpmp.go`).
3. **Relay reservation.** AutoRelay keeps up to two circuit-relay-v2 reservations. It starts after a 10 s boot delay (`src/hyprspace/p2p/node.go:144-169`). Hyprspace feeds it every connected peer until two relay addresses exist, and after that only configured VPN peers (`src/hyprspace/p2p/node.go:287-307`). Candidates are chosen at random (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/host/autorelay/relay_finder.go:693-707`). Every Hyprspace node also runs an unlimited relay service for configured peers (`src/hyprspace/p2p/node.go:142`, `src/hyprspace/p2p/relay.go:14-23`).
4. **Hole punching.** With `EnableHolePunching`, DCUtR runs over the relayed connection. It first tries a direct dial if a public address is known. Otherwise it exchanges observed addresses, measures RTT, waits RTT/2 and dials at the same time. It tries up to 3 times (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/holepunch/holepuncher.go:25,103-170`). QUIC dials reuse the listening UDP socket (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/transport/quicreuse/connmgr.go:43`), so the mapped port matches the advertised one.
5. **Relay data path.** Public IPFS relays grant limited reservations. Connections through them are marked `Limited` (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/client/dial.go:178-182`), and Hyprspace opens its packet stream without `WithAllowLimitedConn` (`src/hyprspace/cli/up.go:301`). Such relays therefore only coordinate the hole punch. VPN traffic can only be relayed through another Hyprspace node, whose relay sends no limit (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay/relay.go:642-644`) (inferred from these code paths).

## NAT Traversal Checklist

### Discovery

- [x] **No own public node needed** - The default build uses hardcoded bootstrap nodes run by the project and by libp2p, the public IPFS DHT and the project's delegated router (`src/hyprspace/p2p/node.go:178-199,257-262`); public IPFS relays can host the DCUtR rendezvous, although relayed data still needs a reachable Hyprspace node.
- [x] **Public endpoint discovery (STUN or reflection)** - Reflection: identify's observed addresses feed the `ObservedAddrManager`, and AutoNAT confirms reachability; no STUN is used (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/identify/id.go:215-223`).
- [x] **Multiple discovery servers** - 20 bootstrap multiaddrs, the DHT, the delegated router, PeX and optional IPFS API peers are queried in parallel (`src/hyprspace/p2p/node.go:178-277`, `src/hyprspace/p2p/routing.go:22-48`).
- [x] **NAT type detection** - identify's `natEmitter` classifies TCP and UDP NAT as cone or symmetric from observed addresses (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/identify/nat_emitter.go:94-110`).

### Port Mapping

- [x] **UPnP port mapping** - `libp2p.NATPortMap()` uses `go-nat`'s UPnP IGD client (`src/hyprspace/p2p/node.go:137`, `deps/hyprspace/go-modules/github.com/libp2p/go-nat/upnp.go`).
- [x] **NAT-PMP support** - `go-nat` also tries NAT-PMP through `jackpal/go-nat-pmp` (`deps/hyprspace/go-modules/github.com/libp2p/go-nat/natpmp.go`).
- [ ] **PCP support** - `go-nat` v0.2.0 implements only UPnP and NAT-PMP; it contains no PCP code (`deps/hyprspace/go-modules/github.com/libp2p/go-nat/`).

### Hole Punching

- [x] **UDP hole punching** - DCUtR coordinates a simultaneous QUIC dial after RTT/2 (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/holepunch/holepuncher.go:133-170`, `src/hyprspace/p2p/node.go:141`).
- [ ] **Symmetric NAT handling** - DCUtR only dials the exchanged observed addresses, with no port prediction or birthday probing (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/holepunch/holepuncher.go:175-200`).
- [x] **Rendezvous coordination** - The DCUtR exchange runs over the relayed connection through a circuit-relay node (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/protocol/holepunch/holepuncher.go:177-185`).

### Fallback

- [x] **Relay fallback** - If no direct path works, traffic uses a circuit-relay-v2 connection through a Hyprspace node running the unlimited relay service (`src/hyprspace/p2p/node.go:142-169`, `src/hyprspace/rpc/server.go:75-97` reports such routes as relayed).
- [x] **Multiple relays** - AutoRelay keeps two relay reservations (`autorelay.WithNumRelays(2)`, `src/hyprspace/p2p/node.go:167`), and every Hyprspace node can act as a relay.
- [ ] **Latency-based relay selection** - Relay candidates are shuffled at random (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/host/autorelay/relay_finder.go:702-706`).
- [x] **TCP relay support** - Relays are reached over any libp2p transport, including the TCP listener on port 8001 (`src/hyprspace/cli/init.go:45-50`, `src/hyprspace/p2p/node.go:140`).

# Local Routing

## Peer Discovery on LANs

Hyprspace does not enable libp2p mDNS. No `mdns` import exists in `src/hyprspace/`. LAN addresses still spread in two ways. The identify protocol advertises all listen addresses, including private ones. PeX copies every address in the peerstore to other VPN peers (`src/hyprspace/p2p/pex.go:56-66`). AutoRelay also keeps non-public addresses in the advertised set, so peers behind the same NAT can dial each other directly (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/host/autorelay/relay_finder.go:710-716`). The dial ranker dials private and public address groups in parallel. Private addresses get shorter delays (30 ms instead of 250 ms) (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/net/swarm/dial_ranker.go:16-28,81-100`). For new streams the swarm prefers unlimited and direct connections, but it does not prefer LAN over WAN (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/net/swarm/swarm.go:594-624`). The packet stream stays on whichever connection it was opened on until a write fails (`src/hyprspace/cli/up.go:272-298`).

## Routing Features

Routes are configured locally per peer as `routes: [{net: CIDR}]` (`src/hyprspace/config/config.go:113-124`, `src/hyprspace/nixos/settings.nix:30-42`). They can also be changed at runtime with `hyprspace route add|del` through RPC (`src/hyprspace/rpc/server.go:111-150`, `src/hyprspace/cli/route.go:23-53`). Each route is installed as a kernel route on the TUN device with metric 3000 (`src/hyprspace/tun/tun_linux.go:68-77`). `RecursionGater` refuses to dial a peer at an address that would itself be routed into the tunnel to that peer (`src/hyprspace/p2p/routing.go:66-80`). Lookup is longest-prefix in a `cidranger` trie. Overlapping identical routes only produce a warning, and the first match wins (`src/hyprspace/config/config.go:212-224`). The receiving peer writes packets to its TUN device. The kernel then forwards them if IP forwarding is enabled (inferred; Hyprspace does not configure forwarding or NAT). A built-in DNS server answers `<name>.hyprspace.`, `<peerid>.hyprspace.` and `<service>.<name>.hyprspace.` on a loopback address derived from the interface name. It registers itself with systemd-resolved over D-Bus (`src/hyprspace/dns/server.go:111-232`).

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - libp2p mDNS is not enabled; `CreateNode` sets no discovery option besides DHT, delegated routing and PeX (`src/hyprspace/p2p/node.go:130-277`).
- [x] **Direct path advertisement** - identify advertises private listen addresses, and PeX shares all peerstore addresses of VPN peers (`src/hyprspace/p2p/pex.go:56-66`).

### LAN Optimization

- [x] **Automatic LAN preference** - Partial: private addresses are dialed with shorter delays (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/net/swarm/dial_ranker.go:16-28`), but private and public groups race in parallel, and connection choice does not prefer LAN (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/net/swarm/swarm.go:594-624`).
- [ ] **Trusted path mode** - Every libp2p connection is secured by TLS or Noise, with no option to skip encryption (`src/hyprspace/p2p/node.go:135`).
- [ ] **LAN-only mode** - A peer entry has no address field (`src/hyprspace/config/config.go:33-38`) and mDNS is off, so without the DHT, the delegated router or a local IPFS API (`HYPRSPACE_IPFS_API`, `src/hyprspace/p2p/node.go:207-220`) peers cannot find each other.

### Routing Features

- [x] **Subnet routes** - Per-peer `routes` send a CIDR to that peer, configured on the sending side rather than advertised by the router (`src/hyprspace/config/config.go:113-124`, `src/hyprspace/tun/tun_linux.go:68-77`).
- [x] **Full tunnel mode** - Partial: a `0.0.0.0/0` route to a peer can be configured, but it is installed with metric 3000 behind the existing default route (`src/hyprspace/tun/tun_linux.go:76`), no bypass route protects the underlay, and the exit node must set up forwarding and NAT itself.
- [x] **Split tunneling** - Only the per-peer built-in addresses and the configured routes go into the TUN device (`src/hyprspace/cli/up.go:93-108`).
- [ ] **Route priorities** - Duplicate routes only print a warning and the first trie match is used, with no failover (`src/hyprspace/config/config.go:217-224`).
- [ ] **Multi-hop routing via peers** - There is no routing protocol, and each route targets one peer directly (`src/hyprspace/config/config.go:47-50`); forwarding through other nodes is only libp2p circuit relay.
- [x] **Built-in DNS** - `MagicDnsServer` resolves peer names and IDs under `.hyprspace.` and registers with systemd-resolved (`src/hyprspace/dns/server.go:111-232`).

# Central Point of Failure

## What Happens When the Bootstrap Nodes Fail

Hyprspace has no controller. Its external dependencies are the hardcoded bootstrap nodes (project nodes on 152.67.75.145, 95.216.8.12, 152.67.73.164, 37.27.11.202, plus `bootstrap.libp2p.io`), the public IPFS DHT and the delegated router `p2p.privatevoid.net` (`src/hyprspace/p2p/node.go:178-199,257-262`). Established QUIC or TCP connections between peers do not pass through these nodes. They stay up through QUIC keepalives every 15 s, and the connection manager protects them (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/transport/quicreuse/config.go:14`, `src/hyprspace/cli/up.go:129-131`). If the bootstrap nodes and delegated router are unreachable, new discovery depends on PeX through VPN peers that are still connected (`src/hyprspace/p2p/pex.go:114-158`). A node that restarts in that state has no addresses for its peers, because the peerstore lives only in memory (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/defaults.go:62-69`). `Discover` then keeps calling `dht.Bootstrap` every 10 s (`src/hyprspace/p2p/discover.go:43-48`). Relayed paths also fail if the relaying Hyprspace node goes down. AutoRelay then has to find another candidate.

## Mitigation Strategies

Use many peers: PeX lets any connected VPN member supply addresses for the others (`src/hyprspace/p2p/pex.go:56-66`). Run a local IPFS node and point `HYPRSPACE_IPFS_API` at its HTTP API. Hyprspace then imports its swarm peers and bootstrap list (`src/hyprspace/p2p/node.go:54-109,207-246`). Keep at least one Hyprspace node publicly reachable so that it can relay without limits (`src/hyprspace/p2p/node.go:142`). The hardcoded bootstrap list and delegated router URL cannot be changed without patching the code.

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - Peer connections are direct or relayed through VPN nodes and do not involve the bootstrap nodes; VPN peers are protected in the connection manager (`src/hyprspace/cli/up.go:129-131`).
- [ ] **Local state caching** - Peer addresses live only in the in-memory `pstoremem` peerstore and are lost on restart (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/defaults.go:62-69`); the config file stores only peer IDs.
- [ ] **Cached credentials** - N/A: there is no controller that issues credentials; the node key and peer list are local config (`src/hyprspace/config/config.go:57-83`).

### Redundancy

- [x] **Decentralized control plane** - Partial: membership is the local `peers` list in each node's config (`src/hyprspace/config/config.go:33-38`), but nodes find each other through the libp2p DHT entered via hardcoded bootstrap nodes (`src/hyprspace/p2p/node.go:178-199`).
- [x] **Fully self-hostable** - Partial: relays are ordinary Hyprspace nodes and extra discovery can come from an own IPFS node via `HYPRSPACE_IPFS_API` (`src/hyprspace/p2p/node.go:207-246`), but the hardcoded bootstrap list and the `p2p.privatevoid.net` router are always used and cannot be replaced by config (`src/hyprspace/p2p/node.go:178-199,257-262`).
- [ ] **Controller redundancy** - N/A: Hyprspace has no controller; discovery already uses 20 bootstrap multiaddrs (`src/hyprspace/p2p/node.go:178-199`).
- [x] **Relay redundancy** - AutoRelay holds two reservations at once (`src/hyprspace/p2p/node.go:167`), and any Hyprspace node can relay.
- [x] **No single root of trust** - Each node trusts only the peer IDs in its own config; there is no CA or central key (`src/hyprspace/config/config.go:104-144`, `src/hyprspace/cli/up.go:395-398`).

# Authentication

## How Nodes Join and Authenticate

`hyprspace init` creates `/etc/hyprspace/<iface>.json` with a new Ed25519 private key and default listen addresses. It prints a `{name, id}` snippet for the other peers (`src/hyprspace/cli/init.go:25-80`). The operator of every other node pastes that snippet into its own `peers` list. With NixOS the operator sets `services.hyprspace.settings.peers` and an optional `privateKeyFile` (`src/hyprspace/nixos/default.nix:25-35,82-88`). Authentication happens on every libp2p connection: TLS 1.3 proves possession of the key that hashes to the peer ID (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:111-213`). The Hyprspace protocol handlers then accept only listed peer IDs (`src/hyprspace/cli/up.go:395-398`, `src/hyprspace/p2p/pex.go:39-49`, `src/hyprspace/svc/receiver.go:11-14`). Other libp2p nodes can still connect for DHT, identify and relay purposes. They cannot send tunnel packets.

## Authentication Checklist

### Enrollment Methods

- [ ] **Pre-authentication keys** - There is no join secret. The libp2p PSK from `HYPRSPACE_SWARM_KEY` is a network-wide transport key, not an enrollment key, and it conflicts with QUIC (`src/hyprspace/p2p/node.go:113-125`).
- [ ] **Certificate-based enrollment** - The TLS certificates are self-signed per connection, and no CA admits nodes (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:243`).
- [ ] **OAuth/OIDC** - No identity provider integration exists in `src/hyprspace/`.
- [ ] **Interactive login** - There is no login flow; the only commands are `init`, `up`, `status`, `peers` and `route` (`src/hyprspace/cli/root.go:23-38`).
- [ ] **CLI authentication** - `hyprspace init` only generates a local key (`src/hyprspace/cli/init.go:36-53`); joining means editing the config of every other peer, with no enrollment step.

### Authorization

- [x] **Admin approval workflow** - Partial: a node is admitted only when each peer's operator adds its peer ID to the local config (`src/hyprspace/config/config.go:104-144`), but there is no request queue or approval tool.
- [ ] **Automated enrollment rules** - Admission is an explicit peer ID list with no rules (`src/hyprspace/cli/up.go:395-398`).
- [ ] **Ephemeral nodes** - Peers stay in the config until removed by hand (`src/hyprspace/config/config.go:102-144`).
- [ ] **Node expiry** - Ed25519 identities have no expiry; the TLS certificates are regenerated per process and are not credentials (`deps/hyprspace/go-modules/github.com/libp2p/go-libp2p/p2p/security/tls/crypto.go:70-101`).

### Identity

- [x] **Stable device identity** - The peer ID and the derived tunnel addresses come from the private key in the config file and survive restarts and underlay address changes (`src/hyprspace/config/config.go:71-89`).
- [x] **Identity portability** - Copying the `privateKey` string (or `privateKeyFile`) to another machine moves the peer ID and its addresses (`src/hyprspace/config/config.go:71-81`, `src/hyprspace/nixos/default.nix:63-67`).

# Platform Support

## Supported Platforms

Only Linux builds and runs in this version. `src/hyprspace/package.nix` lists Linux and Darwin (`src/hyprspace/package.nix:45`), and the flake lists both (`src/hyprspace/flake.nix:15-20`). But `src/hyprspace/tun/options.go` calls `tun.addRoute` and `tun.delRoute` (`src/hyprspace/tun/options.go:35,42`), which exist only in `src/hyprspace/tun/tun_linux.go` (`src/hyprspace/tun/tun_linux.go:68-90`). `src/hyprspace/tun/tun_darwin.go` and `src/hyprspace/tun/tun_windows.go` do not define them, so the `tun` package does not compile on macOS or Windows (inferred from the missing methods; not compiled). Hercules CI builds only `x86_64-linux` and `aarch64-linux` (`src/hyprspace/flake.nix:24-27`). The daemon also uses `vishvananda/netlink` in `src/hyprspace/p2p/routing.go` and `src/hyprspace/dns/server.go`, and systemd-resolved over D-Bus for DNS (`src/hyprspace/p2p/routing.go:55-64`, `src/hyprspace/dns/server.go:199-232`).

## Implementation Details

The binary is a static Go program (`CGO_ENABLED=0`, `src/hyprspace/package.nix:23`). Its main dependencies are go-libp2p v0.38.0, go-libp2p-kad-dht v0.28.0, quic-go v0.48.2, songgao/water for the TUN device, vishvananda/netlink for address, MTU and route setup, gVisor for the service netstack and miekg/dns (`src/hyprspace/go.mod:7-19`). It was built with the Go 1.25.2 standard library (`deps/hyprspace/go-stdlib`). The config schema is generated from `src/hyprspace/nixos/settings.nix` at build time (`src/hyprspace/package.nix:33-35`, `src/hyprspace/dev/generate-schemas.nix:18-23`). Deployment is a NixOS module that runs `hyprspace up` as a root systemd service (`src/hyprspace/nixos/default.nix:75-102`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - Full support through `src/hyprspace/tun/tun_linux.go` with netlink address, MTU and route setup and a NixOS module (`src/hyprspace/tun/tun_linux.go`, `src/hyprspace/nixos/default.nix`).
- [ ] **macOS** - `src/hyprspace/tun/tun_darwin.go` lacks `addRoute`/`delRoute`, which `src/hyprspace/tun/options.go:35,42` call, so the package does not build on Darwin (`src/hyprspace/tun/tun_darwin.go`) (inferred, not compiled).
- [ ] **Windows** - `src/hyprspace/tun/tun_windows.go` also lacks `addRoute`/`delRoute`, so the Windows build fails the same way (`src/hyprspace/tun/tun_windows.go`, `src/hyprspace/tun/options.go:35,42`) (inferred, not compiled).
- [ ] **FreeBSD/OpenBSD** - No `tun` implementation exists for BSD (`src/hyprspace/tun/`); only `src/hyprspace/tun/tun_linux.go`, `src/hyprspace/tun/tun_darwin.go` and `src/hyprspace/tun/tun_windows.go` are present.

### Mobile

- [ ] **iOS** - No iOS code or app exists in the repository (`src/hyprspace/`).
- [ ] **Android** - No Android code or app exists in the repository (`src/hyprspace/`).

### Implementation

- [ ] **Kernel-mode datapath** - All packet processing runs in the userspace Go daemon through a TUN fd (`src/hyprspace/cli/up.go:216-266`).
- [ ] **Container support** - The repository has no Dockerfile, OCI image or Kubernetes manifests, only a Nix package and NixOS module (`src/hyprspace/package.nix`, `src/hyprspace/nixos/default.nix`).
