# Overview

WireGuard is a point-to-point VPN protocol by Jason A. Donenfeld. The benchmarked build is the in-kernel implementation shipped with Linux 6.12.57 (`src/linux/drivers/net/wireguard/`), configured by the `wg` tool from wireguard-tools v1.0.20250521. The benchmark builds a static full mesh with the NixOS `networking.wireguard` module, which creates a `wireguard` link and pushes keys, endpoints and AllowedIPs into the kernel with `wg` (inferred: the NixOS module is not part of `sources/`). Each node is a `wireguard` network device. A packet routed to that device is matched by destination address against the AllowedIPs trie, which picks the peer (`wg_xmit`, `src/linux/drivers/net/wireguard/device.c:153`). The packet is then encrypted with that peer's current ChaCha20-Poly1305 session key and sent as one UDP datagram to the peer's endpoint (`src/linux/drivers/net/wireguard/socket.c:85`). Session keys come from a 1-RTT Noise_IKpsk2 handshake over X25519, BLAKE2s and ChaCha20-Poly1305 (`src/linux/drivers/net/wireguard/noise.c:20-28`). There is no controller, discovery service or relay. Everything a node knows about its peers is set by an administrator over generic netlink (`src/linux/drivers/net/wireguard/netlink.c:610-622`).

At a glance:

- **Language:** C (Linux kernel module, `wg` tool). wg-quick is a bash script (`src/wireguard-tools/src/wg-quick/linux.bash`). The benchmark does not use it (inferred).
- **License:** GPL-2.0 (SPDX headers such as `src/linux/drivers/net/wireguard/device.c:1`, `MODULE_LICENSE("GPL v2")` at `src/linux/drivers/net/wireguard/main.c:73`, and `src/wireguard-tools/COPYING`). Some shared crypto files are `GPL-2.0 OR MIT` (`src/linux/arch/x86/crypto/curve25519-x86_64.c:1`).
- **Default peer transport:** plain UDP. There is one kernel UDP socket per address family on the listen port (`wg_socket_init`, `src/linux/drivers/net/wireguard/socket.c:349-417`). There is no fallback transport.
- **Data cipher (default):** ChaCha20-Poly1305 with a 64-bit counter nonce (`chacha20poly1305_encrypt_sg_inplace`, `src/linux/drivers/net/wireguard/send.c:216`). There are no alternatives. Cookie replies use XChaCha20-Poly1305 (`src/linux/drivers/net/wireguard/cookie.c:193`).
- **Handshake:** Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s, with an optional per-peer preshared key (`src/linux/drivers/net/wireguard/noise.c:28`).
- **Default tunnel MTU:** 1420. `wg_setup` sets `dev->mtu = ETH_DATA_LEN - overhead`, where overhead is 32 bytes of WireGuard header and tag, 8 bytes UDP and 40 bytes IPv6 (`src/linux/drivers/net/wireguard/device.c:280-296`). wg-quick would instead set the route MTU minus 80 (`src/wireguard-tools/src/wg-quick/linux.bash:125-141`).
- **Control-plane model:** fully distributed. Peers are configured statically, with no server of any kind (`src/wireguard-tools/src/config.c:446-495`, `src/linux/drivers/net/wireguard/netlink.c:583-595`).
- **Data-plane threading:** multi-threaded in the kernel. Per-CPU encrypt and decrypt workers are fed round-robin (`src/linux/drivers/net/wireguard/queueing.h:173-176`). Per-peer serial TX work and a threaded per-peer NAPI context restore packet order.

## Key Architecture Components

**Control plane.** There is none at runtime. The `wg` tool parses a config file or command line (`src/wireguard-tools/src/config.c:468-489`) and sends one `WG_CMD_SET_DEVICE` generic-netlink message (`kernel_set_device`, `src/wireguard-tools/src/ipc-linux.h:142-151`). The kernel applies it in `wg_set_device` and `set_peer` (`src/linux/drivers/net/wireguard/netlink.c:357-490`). Both commands need `CAP_NET_ADMIN` in the owning user namespace (`GENL_UNS_ADMIN_PERM`, `src/linux/drivers/net/wireguard/netlink.c:616,620`).

**Discovery.** Endpoints are configured statically (`WGPEER_A_ENDPOINT`, `src/linux/drivers/net/wireguard/netlink.c:436-447`). The `wg` tool resolves host names once at configuration time, with optional retries (`parse_endpoint`, `src/wireguard-tools/src/config.c:195-260`). After that, the kernel "roams": any authenticated handshake or data packet updates the peer's endpoint to the packet's source address (`src/linux/drivers/net/wireguard/receive.c:150,172,343`).

**Transport.** Kernel UDP tunnel sockets are created with `udp_sock_create` and `setup_udp_tunnel_sock`, with `wg_receive` as the `encap_rcv` hook (`src/linux/drivers/net/wireguard/socket.c:353-357,387-408`). Packets go out through `udp_tunnel_xmit_skb` and `udp_tunnel6_xmit_skb` (`src/linux/drivers/net/wireguard/socket.c:85,152`).

**Data path.** On send, `wg_xmit` runs, then the staged queue, the per-CPU `wg_packet_encrypt_worker`, the per-peer `wg_packet_tx_worker` and finally the UDP socket. On receive, `wg_receive` runs, then `wg_packet_consume_data`, the per-CPU `wg_packet_decrypt_worker`, the per-peer NAPI poll `wg_packet_rx_poll` and finally `napi_gro_receive` (`src/linux/drivers/net/wireguard/send.c`, `src/linux/drivers/net/wireguard/receive.c`).

**Identity.** A node is a Curve25519 key pair. The peer table is keyed by public key (`wg_pubkey_hashtable_lookup`, `src/linux/drivers/net/wireguard/noise.c:617`). AllowedIPs ties inner source addresses to a key: after decryption, the packet's source IP must map back to the same peer (`src/linux/drivers/net/wireguard/receive.c:404-409`).

# Protocol

## Control Plane

WireGuard has no control protocol between nodes. The only messages on the wire are handshake initiation (type 1, 148 bytes), handshake response (type 2, 92 bytes), cookie reply (type 3, 64 bytes) and transport data (type 4) (`src/linux/drivers/net/wireguard/messages.h:56-110`). The receive path accepts handshake messages only at their exact length (`validate_header_len`, `src/linux/drivers/net/wireguard/receive.c:28-45`).

Configuration enters the kernel only through generic netlink. `set_peer` adds or updates a peer by public key, sets its endpoint, AllowedIPs, preshared key and persistent-keepalive interval, or removes it (`src/linux/drivers/net/wireguard/netlink.c:357-490`). `WGDEVICE_F_REPLACE_PEERS` and `WGPEER_F_REPLACE_ALLOWEDIPS` let a tool swap the full state atomically per message (`src/linux/include/uapi/linux/wireguard.h:147,166`).

Handshakes start on demand. The first packet queued for a peer without a valid key triggers `wg_packet_send_queued_handshake_initiation` (`src/linux/drivers/net/wireguard/send.c:413`). Initiations are limited to one per `REKEY_TIMEOUT` (5 s) per peer (`src/linux/drivers/net/wireguard/send.c:25-27`). They are retried with up to 333 ms of jitter and abandoned after 18 retries (`src/linux/drivers/net/wireguard/timers.c:41-77`, `src/linux/drivers/net/wireguard/messages.h:43-50`). Handshake packets carry DSCP AF41 (`HANDSHAKE_DSCP`, `src/linux/drivers/net/wireguard/messages.h:126`).

Persistent keepalive is off by default. Peers are zero-allocated (`src/linux/drivers/net/wireguard/peer.c:33`). When set, it sends an empty authenticated packet after N idle seconds (`src/linux/drivers/net/wireguard/timers.c:135-142,212-217`). A passive keepalive is sent 10 s after receiving data if nothing was sent back (`src/linux/drivers/net/wireguard/timers.c:154-163`).

## Data Plane

A transport packet is a 16-byte header plus the encrypted inner IP packet and a 16-byte Poly1305 tag. The header holds a 4-byte type, the 4-byte receiver index and an 8-byte little-endian counter (`struct message_data`, `src/linux/drivers/net/wireguard/messages.h:105-110`). Plaintext is zero-padded to a multiple of 16 bytes, capped at the MTU (`calculate_skb_padding`, `src/linux/drivers/net/wireguard/send.c:141-160`). The receiver index is a random 32-bit value chosen per session (`src/linux/drivers/net/wireguard/peerlookup.c:132`). It lets the receiver find the keypair without trial decryption (`wg_index_hashtable_lookup`, `src/linux/drivers/net/wireguard/receive.c:516-519`).

The inner packet's ECN bits are copied to the outer header, but the outer TOS is otherwise 0, so inner DSCP does not leak (`src/linux/drivers/net/wireguard/send.c:375-378`). The outer packet goes out with `df = 0` and `skb->ignore_df = 1` (`src/linux/drivers/net/wireguard/socket.c:84-87`). The underlay may therefore fragment it. Only IPv4 and IPv6 inner packets are accepted (`wg_check_packet_protocol`, `src/linux/drivers/net/wireguard/queueing.h:70-74`). The device is `ARPHRD_NONE` with `IFF_POINTOPOINT | IFF_NOARP` (`src/linux/drivers/net/wireguard/device.c:289-290`).

## Protocol Features Checklist

### Transport

- [x] **UDP transport** - All peer traffic is UDP over kernel UDP tunnel sockets created in `wg_socket_init` (`src/linux/drivers/net/wireguard/socket.c:387-408`).
- [x] **Datagram encapsulation (no head-of-line blocking)** - Each inner packet is encrypted into its own UDP datagram and sent with `udp_tunnel_xmit_skb` (`src/linux/drivers/net/wireguard/send.c:249-254`, `src/linux/drivers/net/wireguard/socket.c:85`).
- [ ] **TCP fallback** - No TCP code exists in the driver; `wg_socket_send_skb_to_peer` only knows UDP over IPv4 or IPv6 (`src/linux/drivers/net/wireguard/socket.c:168-187`).
- [ ] **QUIC support** - No QUIC transport; the only peer transport is the UDP socket pair (`src/linux/drivers/net/wireguard/socket.c:349-417`).
- [ ] **WebSocket support** - No WebSocket transport in the kernel driver or in wireguard-tools (`src/linux/drivers/net/wireguard/socket.c`).

### IP Support

- [x] **IPv4 support** - IPv4 inner packets are routed through the `root4` AllowedIPs trie (`wg_allowedips_lookup_dst`, `src/linux/drivers/net/wireguard/allowedips.c:356-360`).
- [x] **IPv6 support** - IPv6 inner packets use the `root6` trie (`src/linux/drivers/net/wireguard/allowedips.c:361-362`).
- [x] **Dual-stack** - One device carries both families, and a peer's AllowedIPs can mix them (`wg_allowedips_insert_v4` and `wg_allowedips_insert_v6`, `src/linux/drivers/net/wireguard/allowedips.c:281-301`); the underlay also uses both an IPv4 and an IPv6 socket (`src/linux/drivers/net/wireguard/socket.c:387-408`).

### Network Layer Mode

- [x] **Layer 3 (IP) mode** - The device is an `ARPHRD_NONE` point-to-point IP interface (`src/linux/drivers/net/wireguard/device.c:289-290`).
- [ ] **Layer 2 (Ethernet) mode** - Non-IP frames are rejected with `-EPROTONOSUPPORT` (`src/linux/drivers/net/wireguard/device.c:147-150`).
- [ ] **Bridging support** - There is no Ethernet header (`hard_header_len = 0`, `addr_len = 0`, `src/linux/drivers/net/wireguard/device.c:285-286`), so the device cannot join an L2 bridge.

### Advanced Protocol Features

- [ ] **Multipath/bonding** - Each peer has a single `struct endpoint`, replaced on roaming (`wg_socket_set_peer_endpoint`, `src/linux/drivers/net/wireguard/socket.c:273-297`).
- [ ] **QoS/traffic shaping** - No queues or rate limits for tunnel traffic; the device is `IFF_NO_QUEUE` (`src/linux/drivers/net/wireguard/device.c:291`) and only handshakes get a fixed DSCP (`src/linux/drivers/net/wireguard/messages.h:126`).
- [ ] **Multicast support** - Destination lookup returns at most one peer per packet (`lookup`, `src/linux/drivers/net/wireguard/allowedips.c:127-148`), so multicast is never replicated to several peers.

# Encryption

## Encryption Layer Details

**Handshake.** The handshake is Noise_IKpsk2: `<- s`, `-> e, es, s, ss, {t}`, `<- e, ee, se, psk, {}` (`src/linux/drivers/net/wireguard/noise.c:20-26`). Hash and chaining key start from BLAKE2s over the protocol name and the identifier "WireGuard v1 zx2c4 Jason@zx2c4.com" (`wg_noise_init`, `src/linux/drivers/net/wireguard/noise.c:34-44`).

The initiator generates an ephemeral X25519 key and mixes in `es`. It encrypts its own static public key, mixes in the precomputed `ss`, and encrypts a TAI64N timestamp (`wg_noise_handshake_create_initiation`, `src/linux/drivers/net/wireguard/noise.c:516-581`). The responder decrypts the static key and looks up the peer by public key. It rejects the initiation if the timestamp is not newer than the last one seen (replay) or if the last initiation was under 20 ms ago (flood, `INITIATIONS_PER_SECOND = 50`) (`src/linux/drivers/net/wireguard/noise.c:632-640`). The response adds a fresh ephemeral key, `ee`, `se` and the preshared key (`src/linux/drivers/net/wireguard/noise.c:667-725`). An unset PSK is all zeros (`src/linux/drivers/net/wireguard/noise.c:65-72`).

**Key derivation.** `kdf` is HKDF built on HMAC-BLAKE2s (`src/linux/drivers/net/wireguard/noise.c:340-390`). `derive_keys` splits the final chaining key into one sending and one receiving 32-byte key (`src/linux/drivers/net/wireguard/noise.c:392-402`). Ephemeral secrets, chaining keys and temporary keys are wiped with `memzero_explicit` (`src/linux/drivers/net/wireguard/noise.c:806-811`). Keypairs are freed with `kfree_sensitive` (`src/linux/drivers/net/wireguard/noise.c:114`).

**Data cipher.** The data cipher is ChaCha20-Poly1305 from the kernel crypto library, run in place over the skb's scatterlist (`chacha20poly1305_crypt_sg_inplace`, `src/linux/lib/crypto/chacha20poly1305.c:208-330`). The 64-bit packet counter is the nonce (`b.iv[1] = cpu_to_le64(nonce)`, `src/linux/lib/crypto/chacha20poly1305.c:241-242`). The tag check uses `crypto_memneq` (`src/linux/lib/crypto/chacha20poly1305.c:311`). On x86_64, ChaCha20 dispatches to SSSE3, AVX2 or AVX-512VL code, picked by CPUID at module init (`src/linux/arch/x86/crypto/chacha_glue.c:48-122,280-295`). Poly1305 uses AVX, AVX2 or AVX-512, with AVX-512 skipped on Skylake-X (`src/linux/arch/x86/crypto/poly1305_glue.c:260-273`). X25519 uses the formally verified BMI2/ADX code when the CPU has it (`src/linux/arch/x86/crypto/curve25519-x86_64.c:1594-1603,1703-1704`). BLAKE2s uses SSSE3 or AVX-512 (`src/linux/arch/x86/crypto/blake2s-glue.c:59-69`). These arch modules default to enabled whenever the library is used (`default CRYPTO_LIB_CHACHA_INTERNAL`, `src/linux/arch/x86/crypto/Kconfig:352-358,422-428,5-11`). That the NixOS kernel keeps this default is inferred. SIMD is skipped for inputs of 64 bytes or less and when the FPU is not usable (`src/linux/arch/x86/crypto/chacha_glue.c:145-147`).

**Nonces and replay.** Sending nonces come from an atomic per-keypair counter, `atomic64_inc_return(&keypair->sending_counter) - 1` (`src/linux/drivers/net/wireguard/send.c:379-382`). The receiver checks counters in `counter_validate` after decryption, in per-peer order. This is an RFC 6479 bitmap window of 8192 bits minus one word (`src/linux/drivers/net/wireguard/receive.c:294-331`, `src/linux/drivers/net/wireguard/messages.h:34-38`).

**Rekeying.** The initiator starts a new handshake after `REKEY_AFTER_TIME` (120 s) or after 2^60 messages (`keep_key_fresh`, `src/linux/drivers/net/wireguard/send.c:124-139`). Keys are rejected after 180 s (`src/linux/drivers/net/wireguard/send.c:365-367`, `src/linux/drivers/net/wireguard/receive.c:252-256`). All key material is zeroed after 540 s without a new handshake (`src/linux/drivers/net/wireguard/timers.c:105-133,203-207`). The previous, current and next keypairs overlap, so packets in flight across a rekey still decrypt. The responder may not send with a new key until the first data packet confirms it (`add_new_keypair`, `src/linux/drivers/net/wireguard/noise.c:198-251`; `wg_noise_received_with_keypair`, `src/linux/drivers/net/wireguard/noise.c:253-291`). Keys are also cleared on suspend and expired on VM fork (`src/linux/drivers/net/wireguard/device.c:64-111`).

## Encryption Checklist

### Key Exchange

- [x] **Modern key exchange (Curve25519)** - Every DH in the handshake is `curve25519()` in `mix_dh` (`src/linux/drivers/net/wireguard/noise.c:404-417`).
- [x] **Perfect Forward Secrecy** - Session keys depend on fresh ephemeral keys from `curve25519_generate_secret` via `ee`, `es` and `se` (`src/linux/drivers/net/wireguard/noise.c:541,697-704`), and the ephemeral secret is wiped after the session starts (`handshake_zero`, `src/linux/drivers/net/wireguard/noise.c:78-86,841`).
- [x] **Post-quantum readiness** - Partial: there is no post-quantum KEM, but an optional 32-byte preshared key is mixed into the key schedule (`mix_psk`, `src/linux/drivers/net/wireguard/noise.c:442-452,707,778`), so traffic stays safe against a later break of X25519 only if a PSK was distributed out of band; it is all zeros when unset.
- [x] **Key rotation** - `keep_key_fresh` re-handshakes after 120 s or 2^60 messages (`src/linux/drivers/net/wireguard/send.c:124-139`), and keys expire after 180 s (`src/linux/drivers/net/wireguard/messages.h:45-46`).

### Symmetric Encryption

- [x] **Authenticated encryption** - Data packets use ChaCha20-Poly1305 via `chacha20poly1305_encrypt_sg_inplace` and `chacha20poly1305_decrypt_sg_inplace` (`src/linux/drivers/net/wireguard/send.c:216`, `src/linux/drivers/net/wireguard/receive.c:278`).
- [x] **Hardware-accelerated crypto** - The x86_64 kernel library uses SSSE3, AVX2 or AVX-512VL ChaCha20 and AVX2 or AVX-512 Poly1305 (`src/linux/arch/x86/crypto/chacha_glue.c:280-295`, `src/linux/arch/x86/crypto/poly1305_glue.c:260-273`); there is no AES path because the cipher is fixed.
- [x] **Constant-time operations** - MAC and tag checks use `crypto_memneq` (`src/linux/lib/crypto/chacha20poly1305.c:311`, `src/linux/drivers/net/wireguard/cookie.c:132`), and X25519 uses the verified constant-time HACL*/Vale code on x86_64 (`src/linux/arch/x86/crypto/curve25519-x86_64.c:1-4`); ChaCha20 and Poly1305 have no table lookups (inferred from the ARX design).

### Protocol Security

- [x] **Replay protection** - Data counters pass an 8192-bit sliding window in `counter_validate` (`src/linux/drivers/net/wireguard/receive.c:294-331`), and initiations need a strictly newer TAI64N timestamp (`src/linux/drivers/net/wireguard/noise.c:633-640`).
- [x] **Noise Protocol** - The handshake is `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` (`src/linux/drivers/net/wireguard/noise.c:28`).
- [x] **No cleartext metadata** - The initiator's static key is sent encrypted (`encrypted_static`, `src/linux/drivers/net/wireguard/messages.h:84`) and data packets carry only a random 32-bit index and a counter (`src/linux/drivers/net/wireguard/messages.h:105-110`); mac1 is keyed by a hash of the responder's public key (`src/linux/drivers/net/wireguard/cookie.c:51-53,75-81`), so an observer can only confirm a key they already know.
- [ ] **End-to-end encryption through relays** - WireGuard has no relay; a peer that forwards for others (a hub with wide AllowedIPs) decrypts to plaintext in `napi_gro_receive` (`src/linux/drivers/net/wireguard/receive.c:411`) and re-encrypts for the next hop.

# Performance

## Threading Model

All data-plane work runs in the kernel. No packet crosses into user space, and the driver makes no system calls.

**Transmit.** The stack calls `wg_xmit` directly in the sender's context. The device is `IFF_NO_QUEUE` and `lltx`, so all CPUs can enter it at once without a qdisc or TX lock (`src/linux/drivers/net/wireguard/device.c:291-292`). `wg_xmit` looks up the peer by destination address. It splits GSO super-packets with `skb_gso_segment` (`src/linux/drivers/net/wireguard/device.c:176-187`) and appends them to the peer's staged queue. That queue holds at most 128 packets; older ones are dropped first (`MAX_STAGED_PACKETS`, `src/linux/drivers/net/wireguard/device.c:211-215`). `wg_packet_send_staged_packets` takes the whole staged list, assigns consecutive nonces and hands the list over as one unit (`src/linux/drivers/net/wireguard/send.c:342-389`). `wg_queue_enqueue_per_device_and_peer` puts the list on the peer's lock-free MPSC `tx_queue` for ordering. It also puts the list on the device-wide `encrypt_queue` `ptr_ring` (1024 entries). It then queues the per-CPU encrypt work item on the next online CPU, round-robin (`src/linux/drivers/net/wireguard/queueing.h:157-178`, `src/linux/drivers/net/wireguard/device.c:348-349`).

`wg_packet_encrypt_worker` runs on the `wg-crypt-<if>` workqueue (`WQ_CPU_INTENSIVE`, `src/linux/drivers/net/wireguard/device.c:343-344`). It encrypts each skb in place: `skb_cow_data` makes room for padding and the tag, `skb_cow_head` adds header room, and ChaCha20-Poly1305 runs over the scatterlist (`encrypt_packet`, `src/linux/drivers/net/wireguard/send.c:162-219`). It then marks the list CRYPTED and queues the peer's `transmit_packet_work` on that peer's fixed serial CPU (`wg_queue_enqueue_per_peer_tx`, `src/linux/drivers/net/wireguard/queueing.h:180-191`). `wg_packet_tx_worker` drains `tx_queue` in order and stops at the first packet that is not yet encrypted. It sends each skb with `wg_socket_send_skb_to_peer`, then `send4`/`send6` and `udp_tunnel_xmit_skb` (`src/linux/drivers/net/wireguard/send.c:242-285`). The route is cached per peer in a `dst_cache` (`src/linux/drivers/net/wireguard/socket.c:48-81`).

**Receive.** The UDP layer calls `wg_receive` as the socket's `encap_rcv` hook in softirq, so packets never queue on the socket (`src/linux/drivers/net/wireguard/socket.c:316-332,353-357`). `prepare_skb_header` validates the UDP and WireGuard headers in place (`src/linux/drivers/net/wireguard/receive.c:47-90`). For data, `wg_packet_consume_data` finds the keypair by receiver index. It enqueues the skb on the peer's `rx_queue` and on the device `decrypt_queue`, again round-robin over CPUs (`src/linux/drivers/net/wireguard/receive.c:509-540`). `wg_packet_decrypt_worker` decrypts in place and schedules the peer's NAPI instance (`src/linux/drivers/net/wireguard/receive.c:493-507`, `src/linux/drivers/net/wireguard/queueing.h:193-203`). NAPI is threaded: `dev_set_threaded(dev, true)` at `src/linux/drivers/net/wireguard/device.c:367` creates one NAPI per peer (`src/linux/drivers/net/wireguard/peer.c:56-58`). `wg_packet_rx_poll` takes packets in order and checks the replay window. It updates the endpoint, checks the source address against AllowedIPs and hands the packet to `napi_gro_receive`. The packet is marked `CHECKSUM_UNNECESSARY`, since Poly1305 already covered it (`src/linux/drivers/net/wireguard/receive.c:335-491`).

**Handshakes.** Handshake messages go to a separate 4096-entry ring and are processed by per-CPU `wg-kex-<if>` workers, away from the data path (`src/linux/drivers/net/wireguard/receive.c:549-572`, `src/linux/drivers/net/wireguard/device.c:333-346`).

**Copies, buffers, offloads.** Data is not copied. The skb from the stack is encrypted in place and sent. On receive, the skb from the NIC is decrypted in place and passed up. `skb_cow_data` copies only when the skb is shared or not writable (inferred from its kernel semantics). Queue sizes are 1024 per crypt ring and per-peer queue (`MAX_QUEUED_PACKETS`, `src/linux/drivers/net/wireguard/messages.h:53`, `src/linux/drivers/net/wireguard/queueing.c:74`). The socket send buffer is set to `INT_MAX` (`set_sock_opts`, `src/linux/drivers/net/wireguard/socket.c:342-347`). There is no outer UDP GSO or GRO: segmentation happens before encryption, and the tunnel socket registers no `gro_receive` (`src/linux/net/ipv4/udp_tunnel_core.c:79`). Each datagram crosses the IP stack on its own.

**Single-peer limits.** Encryption and decryption spread over all online CPUs. A given peer's TX send loop and its NAPI receive loop each run on one CPU at a time (`serial_work_cpu`, `src/linux/drivers/net/wireguard/queueing.h:105-118,188`; per-peer NAPI, `src/linux/drivers/net/wireguard/peer.c:57`). In a two-node benchmark, those two loops are the serial parts.

## Performance Optimizations Checklist

### Threading

- [x] **Multi-threaded processing** - Encryption and decryption run on per-CPU workers of the `wg-crypt` workqueue, fed round-robin with `wg_cpumask_next_online` and `queue_work_on` (`src/linux/drivers/net/wireguard/queueing.h:125-132,173-176`).
- [x] **Multi-queue TUN / per-core sockets** - Partial: there is no TUN and only one UDP socket per family (`src/linux/drivers/net/wireguard/socket.c:387-408`), but the `lltx`/`IFF_NO_QUEUE` device lets `wg_xmit` run on every CPU at once (`src/linux/drivers/net/wireguard/device.c:291-292`) and `encap_rcv` runs in softirq on whichever CPU received the packet.

### Packet I/O

- [ ] **Batch UDP receives (recvmmsg)** - No batching: the in-kernel equivalent hands each received datagram to the driver one skb at a time through the `encap_rcv` hook (`src/linux/drivers/net/wireguard/socket.c:316-332`).
- [ ] **Batch UDP sends (sendmmsg)** - No batching: each encrypted skb goes to `udp_tunnel_xmit_skb` on its own (`src/linux/drivers/net/wireguard/send.c:249-254`, `src/linux/drivers/net/wireguard/socket.c:85`).
- [x] **Large batch sizes (64+)** - Partial: there is no socket or TUN batching, but up to 128 staged packets move as one list into encryption (`src/linux/drivers/net/wireguard/send.c:349-388`, `src/linux/drivers/net/wireguard/messages.h:52`) and each NAPI poll drains up to its budget (`src/linux/drivers/net/wireguard/receive.c:483-488`); the UDP send is still per packet.

### Offloads

- [ ] **UDP GSO** - Packets are segmented before encryption in `wg_xmit` (`src/linux/drivers/net/wireguard/device.c:176-187`) and each datagram is sent separately with `udp_tunnel_xmit_skb` (`src/linux/net/ipv4/udp_tunnel_core.c:154-174`); `UDP_SEGMENT` is not used.
- [ ] **UDP GRO** - The tunnel socket config sets no `gro_receive` (`src/linux/drivers/net/wireguard/socket.c:353-357`, `src/linux/net/ipv4/udp_tunnel_core.c:79`), so outer datagrams are not coalesced.
- [x] **TUN offload (virtio-net hdr)** - There is no TUN, but the in-kernel equivalent is present: the netdev advertises `NETIF_F_SG | NETIF_F_GSO | NETIF_F_GSO_SOFTWARE | NETIF_F_HW_CSUM` so the stack hands it TSO super-packets (`src/linux/drivers/net/wireguard/device.c:277-295`), and decrypted packets are coalesced with `napi_gro_receive` (`src/linux/drivers/net/wireguard/receive.c:411`).

### Buffers and Parsing

- [x] **Buffer pool reuse** - The skb handed over by the stack or the NIC is encrypted or decrypted in place and reused end to end (`src/linux/drivers/net/wireguard/send.c:162-219`, `src/linux/drivers/net/wireguard/receive.c:242-292`); skbs come from the kernel slab caches (inferred).
- [x] **Large UDP socket buffers (MB)** - `set_sock_opts` sets `sk_sndbuf = INT_MAX` (`src/linux/drivers/net/wireguard/socket.c:345`); there is no receive buffer to size because `encap_rcv` consumes packets before the socket queue.
- [x] **Zero-allocation parsing** - `prepare_skb_header` and `validate_header_len` parse in place with `pskb_may_pull` and pointer casts (`src/linux/drivers/net/wireguard/receive.c:28-90`).

### MTU and Peers

- [ ] **Path MTU discovery** - No probing; outer packets are sent with `df = 0` and `ignore_df = 1` (`src/linux/drivers/net/wireguard/socket.c:84-87`), and the inner MTU is a fixed 1420 (`src/linux/drivers/net/wireguard/device.c:296`).
- [x] **Endpoint caching** - Each peer keeps its last authenticated source endpoint and a cached route (`wg_socket_set_peer_endpoint` and `dst_cache`, `src/linux/drivers/net/wireguard/socket.c:48-81,273-297`).

### Userspace TCP Stack

- [ ] **Userspace TCP/IP stack** - None; decrypted packets go straight into the kernel stack through `napi_gro_receive` (`src/linux/drivers/net/wireguard/receive.c:411`).

### Data Plane Compression

- [ ] **Tunnel compression** - No compression; the inner packet is only padded and encrypted (`encrypt_packet`, `src/linux/drivers/net/wireguard/send.c:162-219`).
- [ ] **Configurable compression** - No compression exists, so nothing to configure (`src/linux/drivers/net/wireguard/send.c:162-219`).

# Security

## Known Security Issues

None found. The sources contain no advisory files, and no web lookup was allowed. Nothing in the analysed WireGuard driver or wireguard-tools code marks a known unfixed issue for this version.

## Potential Security Concerns

- **Private key readable over netlink.** `WG_CMD_GET_DEVICE` returns the static private key to any caller with `CAP_NET_ADMIN` in the device's user namespace (`src/linux/drivers/net/wireguard/netlink.c:240-243,616`). A container or user namespace with that capability over the interface can read the node identity.
- **mac1 confirms the responder key.** mac1 is a BLAKE2s MAC keyed by `HASH("mac1----" || responder_public_key)` (`src/linux/drivers/net/wireguard/cookie.c:28-53,75-81`). A passive observer who has a candidate public key can test whether an initiation targets that node. Keys are not leaked in clear, but they are not hidden from a party that already holds them.
- **No post-quantum protection by default.** Without a configured PSK, `mix_psk` mixes 32 zero bytes (`src/linux/drivers/net/wireguard/noise.c:70-72,707`). Recorded traffic then depends only on X25519.
- **Clock-dependent replay check.** Initiation replay protection compares TAI64N wall-clock timestamps (`src/linux/drivers/net/wireguard/noise.c:497-514,633-640`). The responder keeps the newest timestamp per peer. If an initiator's clock jumps back, its initiations are rejected until its clock passes the stored value. If the stored value was set from a future clock, the peer cannot connect until the responder clears state, for example by reconfiguring or reloading the module (inferred).
- **Endpoint follows the latest authenticated packet.** `wg_packet_consume_data_done` updates the endpoint after the replay check (`src/linux/drivers/net/wireguard/receive.c:343,461-474`). An on-path attacker who forwards a fresh captured packet from another address before the original arrives can redirect a peer's outbound traffic until the real peer sends again. The traffic stays encrypted (inferred from the order of checks).
- **Failures are silent by default.** Invalid MACs, failed handshakes and AllowedIPs violations are logged only with `net_dbg_ratelimited` or `pr_debug` (`src/linux/drivers/net/wireguard/receive.c:129-131,146-147,415-418`). Default logs show no attacks or misconfigurations.
- **Outer fragmentation.** Outer packets may be fragmented (`ignore_df`, `src/linux/drivers/net/wireguard/socket.c:84`). Paths that drop fragments then lose large packets without notice, because there is no PMTU probing.

## Security Features Checklist

### Network Security

- [x] **Handshake rate limiting** - Under load (512 or more queued handshakes) a valid mac2 cookie is required (`src/linux/drivers/net/wireguard/receive.c:112-132`), cookie holders are limited to 20 handshakes/s with a burst of 5 per source IPv4 address or IPv6 /64 (`src/linux/drivers/net/wireguard/ratelimiter.c:34-39,84-156`), and each peer accepts at most 50 initiations/s (`src/linux/drivers/net/wireguard/noise.c:635-640`).
- [ ] **Stateful packet filter** - No conntrack in the driver; the only receive filter is the AllowedIPs source check (`src/linux/drivers/net/wireguard/receive.c:404-409`).
- [ ] **Fine-grained ACLs** - AllowedIPs are bare IP prefixes with no port or protocol fields (`WGALLOWEDIP_A_*`, `src/linux/include/uapi/linux/wireguard.h`; `set_allowedip`, `src/linux/drivers/net/wireguard/netlink.c`).
- [ ] **Capability-based access** - Policy is only public key plus IP prefixes; there are no tags or groups (`struct wg_peer` and `allowedips`, `src/linux/drivers/net/wireguard/allowedips.c:281-301`).

### Identity & Authentication

- [x] **Identity validation** - A peer is admitted only if its handshake proves the configured static key (`wg_pubkey_hashtable_lookup` then `ss`, `src/linux/drivers/net/wireguard/noise.c:616-625`), and every decrypted packet's inner source must map back to that same key in AllowedIPs (`src/linux/drivers/net/wireguard/receive.c:404-409`).
- [ ] **Signed config updates** - Configuration is pushed locally over netlink with no signature (`wg_set_device`, `src/linux/drivers/net/wireguard/netlink.c:493-608`).
- [ ] **Control-server key pinning** - N/A: there is no control server; peers are configured statically (`src/linux/drivers/net/wireguard/netlink.c:357-490`).

### Implementation

- [ ] **Memory-safe language** - The data path is C in the Linux kernel (`src/linux/drivers/net/wireguard`).
- [ ] **Privilege separation** - The data path runs in the kernel and configuration needs `CAP_NET_ADMIN` (`src/linux/drivers/net/wireguard/netlink.c:616,620`); the only isolation aid is that the UDP socket stays in the creating namespace while the device can move to another (`src/linux/drivers/net/wireguard/socket.c:376-381`).
- [ ] **Sandboxing** - No seccomp, pledge or similar in the driver or in the `wg` tool (`src/wireguard-tools/src/wg.c`).
- [x] **Audit logging** - Partial: invalid MACs, failed handshakes, AllowedIPs violations and handshake give-ups are logged only through `net_dbg_ratelimited` and `pr_debug` (`src/linux/drivers/net/wireguard/receive.c:129-131,415-418`, `src/linux/drivers/net/wireguard/timers.c:47-49`), which need dynamic debug or `CONFIG_WIREGUARD_DEBUG` (`src/linux/drivers/net/wireguard/Makefile:2`).

# NAT Traversal

## How NAT Traversal Works

Kernel WireGuard has no NAT traversal protocol. It has three mechanisms that make NAT workable when at least one side is reachable:

1. **Roaming.** The responder learns the initiator's public address and port from each authenticated handshake or data packet and replies there (`wg_socket_set_peer_endpoint_from_skb`, `src/linux/drivers/net/wireguard/receive.c:150,172,343`). A node behind NAT can therefore connect to a peer with a known public endpoint. Its own `Endpoint` setting for itself is not needed.
2. **Persistent keepalive.** An opt-in per-peer interval sends an empty authenticated packet whenever the link has been idle for N seconds. This keeps NAT and firewall state alive (`src/linux/drivers/net/wireguard/timers.c:135-142,212-217`, `src/linux/drivers/net/wireguard/netlink.c:469-480`).
3. **Source address reset.** When a handshake fails, the cached source address is cleared so the route is chosen again (`wg_socket_clear_peer_endpoint_src`, `src/linux/drivers/net/wireguard/timers.c:70-75,98-102`).

There is no STUN, no port mapping and no relay. Two peers that are both behind NAT can talk only if their endpoints are learned out of band and both sides send at the same time. wireguard-tools ships an example of such a rendezvous (`src/wireguard-tools/contrib/nat-hole-punching/`), but its README says it "should never be used, ever". The tools do not build or install it. Host names in `Endpoint` are resolved once by `wg` (`src/wireguard-tools/src/config.c:195-260`). `contrib/reresolve-dns` is a cron script that re-runs `wg set ... endpoint` (`src/wireguard-tools/contrib/reresolve-dns/README`). The benchmark's static full mesh gives every node a reachable endpoint (inferred), so none of this is exercised.

## NAT Traversal Checklist

### Discovery

- [ ] **No own public node needed** - At least one side of each peer pair needs a reachable, configured endpoint; without one `wg_xmit` fails with `-EDESTADDRREQ` (`src/linux/drivers/net/wireguard/device.c:165-171`).
- [ ] **Public endpoint discovery (STUN or reflection)** - No STUN or reflection; a node never learns its own public address, only the peer's source address on receive (`src/linux/drivers/net/wireguard/receive.c:343`).
- [ ] **Multiple discovery servers** - There are no discovery servers; endpoints are static netlink attributes (`src/linux/drivers/net/wireguard/netlink.c:436-447`).
- [ ] **NAT type detection** - No NAT classification code in the driver or tools (`src/linux/drivers/net/wireguard/socket.c`, `src/wireguard-tools/src/`).

### Port Mapping

- [ ] **UPnP port mapping** - Not implemented; the only sockets are the two UDP tunnel sockets (`src/linux/drivers/net/wireguard/socket.c:349-417`).
- [ ] **NAT-PMP support** - Not implemented (`src/linux/drivers/net/wireguard/socket.c:349-417`).
- [ ] **PCP support** - Not implemented (`src/linux/drivers/net/wireguard/socket.c:349-417`).

### Hole Punching

- [ ] **UDP hole punching** - The driver has no coordinated simultaneous open; the only example lives in `src/wireguard-tools/contrib/nat-hole-punching/` and its README says it must never be used.
- [ ] **Symmetric NAT handling** - No port prediction or similar; a peer has exactly one endpoint (`src/linux/drivers/net/wireguard/socket.c:273-297`).
- [ ] **Rendezvous coordination** - No rendezvous server or peer protocol; message types are only handshake, cookie and data (`src/linux/drivers/net/wireguard/messages.h:56-62`).

### Fallback

- [ ] **Relay fallback** - No relay; packets for a peer without a working endpoint are dropped or held in the staged queue (`src/linux/drivers/net/wireguard/device.c:165-171`, `src/linux/drivers/net/wireguard/timers.c:46-62`).
- [ ] **Multiple relays** - No relays exist (`src/linux/drivers/net/wireguard/messages.h:56-62`).
- [ ] **Latency-based relay selection** - No relays and no latency measurement (`src/linux/drivers/net/wireguard/messages.h:56-62`).
- [ ] **TCP relay support** - No TCP and no relays (`src/linux/drivers/net/wireguard/socket.c:168-187`).

# Local Routing

## Peer Discovery on LANs

There is none. A peer's endpoint is whatever the administrator configured, later replaced by the source address of the latest authenticated packet (`src/linux/drivers/net/wireguard/receive.c:343`). The driver sends no broadcast or multicast, and the tunnel sockets disable multicast loopback (`src/linux/net/ipv4/udp_tunnel_core.c:66-67`). If the configured endpoint is a LAN address, traffic stays on the LAN. Nothing chooses between a LAN path and a WAN path.

## Routing Features

Routing is "cryptokey routing". On send, the longest-prefix match in the AllowedIPs trie selects the peer (`wg_allowedips_lookup_dst`, `src/linux/drivers/net/wireguard/allowedips.c:356-363`). On receive, the same trie must map the inner source back to the peer that decrypted the packet (`src/linux/drivers/net/wireguard/receive.c:404-409`). Each prefix belongs to exactly one peer. Inserting a prefix that another peer already has moves it (`src/linux/drivers/net/wireguard/allowedips.c:199-203`). Kernel routes that send traffic into the interface are set outside the driver. The NixOS module or wg-quick installs them (`add_route`, `src/wireguard-tools/src/wg-quick/linux.bash:167-180`). For a default route, wg-quick sets an fwmark on the tunnel socket and adds `not fwmark` and `suppress_prefixlength 0` policy rules, so encrypted packets do not loop (`add_default`, `src/wireguard-tools/src/wg-quick/linux.bash:212-225`; fwmark applied in `send4`, `src/linux/drivers/net/wireguard/socket.c:27,36`). wg-quick's `DNS=` only writes upstream resolvers into resolvconf (`set_dns`, `src/wireguard-tools/src/wg-quick/linux.bash:154-160`).

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - The driver sends only to configured or learned unicast endpoints (`src/linux/drivers/net/wireguard/socket.c:168-187`).
- [ ] **Direct path advertisement** - No message type carries endpoints (`src/linux/drivers/net/wireguard/messages.h:56-62`).

### LAN Optimization

- [ ] **Automatic LAN preference** - One endpoint per peer, replaced by the latest authenticated source with no path comparison (`src/linux/drivers/net/wireguard/socket.c:273-297`).
- [ ] **Trusted path mode** - Every data packet is encrypted; `wg_packet_send_staged_packets` has no plaintext path (`src/linux/drivers/net/wireguard/send.c:342-389`).
- [x] **LAN-only mode** - Nothing contacts an outside service; a static config with LAN endpoints works offline (`src/linux/drivers/net/wireguard/netlink.c:436-447`).

### Routing Features

- [x] **Subnet routes** - A peer's AllowedIPs may hold any prefix, so a subnet behind a node is reachable once it is configured on the other peers (`wg_allowedips_insert_v4`, `src/linux/drivers/net/wireguard/allowedips.c:281-290`); nothing is advertised automatically.
- [x] **Full tunnel mode** - AllowedIPs `0.0.0.0/0` or `::/0` routes everything to one peer, and wg-quick adds the fwmark policy rules (`src/wireguard-tools/src/wg-quick/linux.bash:212-225`).
- [x] **Split tunneling** - Only destinations inside AllowedIPs (and the kernel routes pointing at the device) enter the tunnel (`src/linux/drivers/net/wireguard/device.c:153-163`).
- [ ] **Route priorities** - Each prefix maps to exactly one peer, and a duplicate insert moves it (`src/linux/drivers/net/wireguard/allowedips.c:199-203`); there is no failover.
- [ ] **Multi-hop routing via peers** - No routing protocol; forwarding through a hub works only with static AllowedIPs and kernel IP forwarding (`src/linux/drivers/net/wireguard/allowedips.c:356-374`).
- [ ] **Built-in DNS** - No name resolution for peers; wg-quick `DNS=` only sets upstream resolvers (`src/wireguard-tools/src/wg-quick/linux.bash:154-160`).

# Central Point of Failure

## What Happens When the Controller Fails

WireGuard has no controller, lighthouse or bootstrap node. Each node's kernel holds its full peer list, keys and AllowedIPs, written once by `wg` (`src/linux/drivers/net/wireguard/netlink.c:357-490`). Handshakes are pairwise and need only the two peers (`src/linux/drivers/net/wireguard/noise.c:516-861`). In the benchmark's full mesh, losing a node affects only the traffic to that node (inferred). In a hub-and-spoke setup, the hub is a single point of failure for spoke-to-spoke traffic, because it forwards at the IP layer (inferred).

## Mitigation Strategies

There is nothing to mitigate at the protocol level. Operational options are:

- Give peers DNS names and re-resolve them (`src/wireguard-tools/contrib/reresolve-dns/README`).
- Rely on roaming for peers whose address changes (`src/linux/drivers/net/wireguard/receive.c:343`).
- Avoid hubs by building a full mesh, as the benchmark does.

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [x] **Existing connections survive** - There is no controller; tunnels depend only on the two peers and rekey between themselves every 120 s (`src/linux/drivers/net/wireguard/send.c:124-139`).
- [x] **Local state caching** - The whole peer map is local configuration (`wg setconf` format parsed in `src/wireguard-tools/src/config.c:468-489`) and lives in the kernel until changed (`src/linux/drivers/net/wireguard/peer.c:21-69`).
- [ ] **Cached credentials** - N/A: there is no controller that issues credentials; static keys are configured locally (`src/linux/drivers/net/wireguard/netlink.c:543-569`).

### Redundancy

- [x] **Decentralized control plane** - All peers, keys and allowed IPs are set locally by the administrator over generic netlink, with no server of any kind (`src/linux/drivers/net/wireguard/netlink.c:610-622`).
- [x] **Fully self-hostable** - No external component exists; kernel module and `wg` tool are all there is (`src/linux/drivers/net/wireguard/main.c:20-61`).
- [ ] **Controller redundancy** - N/A: there is no controller (`src/linux/drivers/net/wireguard/netlink.c:610-622`).
- [ ] **Relay redundancy** - No relays exist (`src/linux/drivers/net/wireguard/messages.h:56-62`).
- [x] **No single root of trust** - Trust is pairwise between static keys (`src/linux/drivers/net/wireguard/noise.c:616-625`); there is no CA, and stealing one node's key lets an attacker impersonate only that node.

# Authentication

## How Nodes Join and Authenticate

There is no join step. An administrator generates a key pair with `wg genkey`, which reads `getrandom` (`src/wireguard-tools/src/genkey.c:48-49`), and `wg pubkey`. The public key, AllowedIPs and an optional endpoint are then added on every peer that should talk to the new node (`set_peer`, `src/linux/drivers/net/wireguard/netlink.c:357-490`). In the benchmark, NixOS does this for every node pair at deploy time (inferred).

At runtime, the handshake authenticates both static keys. The responder decrypts the initiator's static key and drops the initiation silently unless that key is a configured peer (`src/linux/drivers/net/wireguard/noise.c:611-619`). The initiator proves its key through `ss` and the responder through `se` (`src/linux/drivers/net/wireguard/noise.c:560-562,702-704`). An optional per-pair PSK adds a symmetric secret on top (`src/linux/drivers/net/wireguard/noise.c:707`). Removing a node means deleting its public key from every peer (`WGPEER_F_REMOVE_ME`, `src/linux/drivers/net/wireguard/netlink.c:424-425`).

## Authentication Checklist

### Enrollment Methods

- [ ] **Pre-authentication keys** - No enrollment secret; the optional PSK is a per-peer-pair key mixed into the handshake, not a join token (`src/linux/drivers/net/wireguard/noise.c:442-452`).
- [ ] **Certificate-based enrollment** - No certificates; peers are raw Curve25519 public keys (`src/linux/drivers/net/wireguard/netlink.c:33-35`).
- [ ] **OAuth/OIDC** - Not implemented; no network service exists to log in to (`src/linux/drivers/net/wireguard/netlink.c:610-622`).
- [ ] **Interactive login** - Not implemented (`src/wireguard-tools/src/wg.c`).
- [ ] **CLI authentication** - No enrollment step; `wg set` only writes static peer config into the local kernel (`src/wireguard-tools/src/set.c`, `src/wireguard-tools/src/ipc-linux.h:142-151`).

### Authorization

- [x] **Admin approval workflow** - Partial: there is no pending-then-approve flow; a node can talk to a peer only after an admin hand-adds its public key to that peer (`set_peer`, `src/linux/drivers/net/wireguard/netlink.c:384-400`), and unknown keys are dropped (`src/linux/drivers/net/wireguard/noise.c:617-619`).
- [ ] **Automated enrollment rules** - No rule engine; peers come only from explicit netlink configuration (`src/linux/drivers/net/wireguard/netlink.c:357-490`).
- [ ] **Ephemeral nodes** - Peers are never removed automatically; idle peers only lose session keys after 540 s (`src/linux/drivers/net/wireguard/timers.c:105-133`).
- [ ] **Node expiry** - Static keys never expire; only session keys do (`src/linux/drivers/net/wireguard/messages.h:45-46`).

### Identity

- [x] **Stable device identity** - The identity is the static Curve25519 key, independent of address, and roaming keeps sessions across IP changes (`src/linux/drivers/net/wireguard/noise.c:294-303`, `src/linux/drivers/net/wireguard/receive.c:343`).
- [x] **Identity portability** - The identity is just the 32-byte private key, which can be set on any host (`WGDEVICE_A_PRIVATE_KEY`, `src/linux/drivers/net/wireguard/netlink.c:543-569`).

# Platform Support

## Supported Platforms

The benchmarked datapath is the Linux kernel module. wireguard-tools states support for "Linux, OpenBSD, FreeBSD, macOS, Windows, and Android" (`src/wireguard-tools/README.md:7-8`). It has a backend for each:

- Linux: generic netlink (`src/wireguard-tools/src/ipc-linux.h`).
- FreeBSD: nvlist ioctl to the FreeBSD kernel driver (`src/wireguard-tools/src/ipc-freebsd.h:56-83`).
- OpenBSD: ioctl to the OpenBSD kernel driver (`src/wireguard-tools/src/ipc-openbsd.h:93-103`).
- Windows: `DeviceIoControl` to the WireGuard NT driver (`src/wireguard-tools/src/ipc-windows.h:26,233,445`).
- Userspace implementations: a UAPI Unix socket (`src/wireguard-tools/src/ipc-uapi-unix.h:18-44`).

wg-quick has Linux, macOS, FreeBSD, OpenBSD and Android front ends (`src/wireguard-tools/src/wg-quick/`). On macOS it starts `wireguard-go` on a utun device (`src/wireguard-tools/src/wg-quick/darwin.bash:126`).

## Implementation Details

The Linux driver is about 6,000 lines of C (`src/linux/drivers/net/wireguard/`). It uses the kernel crypto library (`src/linux/lib/crypto/`) with x86_64 SIMD back ends (`src/linux/arch/x86/crypto/`). It registers an rtnetlink link type `wireguard` (`src/linux/drivers/net/wireguard/device.c:403-408`) and the generic-netlink family `wireguard` version 1 (`src/linux/include/uapi/linux/wireguard.h:135`). Interfaces are namespace-aware. The UDP socket stays in the namespace where the device was created, even when the device is moved (`creating_net`, `src/linux/drivers/net/wireguard/device.c:316,410-429`). wireguard-tools is plain C, with bash for wg-quick. Its only packaged dependency in `sources/deps/` is bash (`deps/wireguard-tools/bash-interactive`).

## Platform Checklist

### Desktop/Server

- [x] **Linux** - In-tree kernel module (`src/linux/drivers/net/wireguard/main.c:20-78`) plus the netlink backend of `wg` (`src/wireguard-tools/src/ipc-linux.h:142-151`).
- [x] **macOS** - wireguard-tools supports macOS with wg-quick starting `wireguard-go` on utun (`src/wireguard-tools/src/wg-quick/darwin.bash:126`, `src/wireguard-tools/README.md:7-8`).
- [x] **Windows** - `wg` drives the WireGuard NT kernel driver through `DeviceIoControl` (`src/wireguard-tools/src/ipc-windows.h:26,233,445`).
- [x] **FreeBSD/OpenBSD** - `wg` has ioctl backends for both kernel implementations (`src/wireguard-tools/src/ipc-freebsd.h:56-83`, `src/wireguard-tools/src/ipc-openbsd.h:93-103`) and wg-quick ports (`src/wireguard-tools/src/wg-quick/freebsd.bash`, `src/wireguard-tools/src/wg-quick/openbsd.bash`).

### Mobile

- [x] **iOS** - No iOS code is in the analysed sources (`src/wireguard-tools/README.md:7-8`, `src/wireguard-tools/src/wg-quick`); an official WireGuard iOS app exists in a separate project repository (inferred).
- [x] **Android** - wireguard-tools ships an Android wg-quick (`src/wireguard-tools/src/wg-quick/android.c:1-6`) and lists Android as supported (`src/wireguard-tools/README.md:7-8`).

### Implementation

- [x] **Kernel-mode datapath** - Encryption, decryption and routing run in the Linux kernel module (`src/linux/drivers/net/wireguard/send.c`, `src/linux/drivers/net/wireguard/receive.c`).
- [ ] **Container support** - No official image or Kubernetes integration in the sources; the driver only supports network namespaces (`src/linux/drivers/net/wireguard/device.c:410-429`).
