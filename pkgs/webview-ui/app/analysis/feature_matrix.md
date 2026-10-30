# Mesh VPN Feature Matrix

> **Note on the tincr column.** The tincr column describes commit `63f4e588` (2026-10-28). The benchmarks ran the older revision `b234dc79` (2026-04-20, `tincd 0.1.0 (Rust) protocol 17.7`); see the note at the top of `tincr_overview.md`. For `b234dc79` these tincr cells change: Language "Rust" (RustCrypto ChaCha20-Poly1305 with AVX2 fixed at build time, no OpenSSL); Data cipher "ChaCha20-Poly1305 (SPTPS), no cipher choice"; Handshake "SPTPS: ephemeral X25519 + Ed25519"; Data-plane threading "Single-threaded"; Post-quantum readiness ✗; Multi-threaded processing ✗; Multi-queue TUN / per-core sockets ✗; Android ◐ (fd device backend, no app). The scores become Encryption 8/11, Performance 12/16, Platform 2.5/8 and Total 59.5/97 (61%). The tincr caveat about sharding and the Key Takeaways statements about tincr's shards and ML-KEM-768 option do not apply to `b234dc79`.

A comparison of mesh VPN solutions across protocol, encryption, performance, security, NAT traversal, routing, resilience, authentication, and platform support. Every cell was checked against the source code in `~/Projects/meshvpns`; the per-VPN overview documents contain the details behind each value.

**Legend:** ✓ = supported (on by default or a normal config option) | ◐ = partial, opt-in experimental, or limited (see the overview) | ✗ = not supported | N/A = does not apply to this design | ? = unknown

**Conventions:**
- Performance rows are judged on Linux with the default build, since that is what the benchmarks run. Linux-only syscalls (`recvmmsg`, GSO/GRO, multi-queue TUN) count as ✓ when they are used there.
- NetBird uses kernel WireGuard on Linux when the module is available, so its per-packet socket and TUN rows are N/A: the kernel handles packets without per-packet syscalls. Its userspace fallback (a wireguard-go fork) has batching, GSO/GRO, TUN offloads and 7 MiB socket buffers.
- The Tailscale column describes the self-hosted Headscale setup. Where Tailscale SaaS differs (Tailnet Lock, peer relays, managed controller HA), the overview says so.
- Controller rows are N/A for designs that have no controller.

---

## At a Glance

| Property | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Language** | Rust | Go | Go | Rust | Go | Go (Linux datapath: kernel WireGuard) | C | Rust (OpenSSL for the AEAD) | Rust | Go | C++ |
| **License** | LGPL-3.0 | BSD-3-Clause | Apache-2.0 | Apache-2.0 | MIT | BSD-3-Clause client, AGPL-3.0 servers | GPL-2.0+ | GPL-2.0+ | GPL-3.0 | LGPL-3.0 (+ linking exception) | MPL-2.0 (controller: source-available, non-commercial) |
| **Default peer transport** | TCP stream (direct links try TCP first; `udp://` opt-in) | WireGuard over UDP; DERP (TLS/TCP) fallback | One QUIC stream per peer; TCP+yamux or circuit relay fallback | TCP stream (QUIC datagrams opt-in) | UDP | Kernel WireGuard over UDP via ICE; relay (QUIC or WebSocket) fallback | UDP after probing; TCP meta connection fallback | UDP after probing; TCP meta connection fallback | UDP; manual `ws://` proxy | TLS over TCP (LAN multicast); static peers tcp/tls/quic/ws | UDP; root relay; TCP proxy after 60 s |
| **Data cipher (default)** | AES-128-GCM, one static key per network | ChaCha20-Poly1305 | AES-128-GCM via TLS 1.3 (ChaCha20 without AES-NI) | AES-256-GCM, static per peer pair | AES-256-GCM (alt. ChaCha20-Poly1305) | ChaCha20-Poly1305 | ChaCha20-Poly1305 (SPTPS) | ChaCha20-Poly1305 via OpenSSL (opt-in AES-256-GCM) | AES-GCM or ChaCha20, picked by startup benchmark | XSalsa20-Poly1305 (nacl/box) | AES-256-GMAC-SIV (legacy Salsa20/12-Poly1305) |
| **Handshake** | None: plaintext hash of network secret | WireGuard Noise_IKpsk2 (X25519) | TLS 1.3 (X25519); Noise XX on TCP fallback | None: static-static X25519, no KDF | Noise IX (X25519) + CA-signed cert | WireGuard Noise_IKpsk2 (X25519); opt-in Rosenpass PQ PSK | SPTPS: ephemeral X25519 + Ed25519 | SPTPS: ephemeral X25519 + Ed25519; opt-in X25519+ML-KEM-768 | Custom: ephemeral X25519 + Ed25519, rekey every 120 s | Custom ratchet: ephemeral X25519 + Ed25519 | None: static-static X25519 per peer pair |
| **Default tunnel MTU** | 1380 (TUN 1360 with encryption) | 1280 | 1420 | 1400 | 1300 | 1280 | Not set (OS default 1500) + per-peer PMTU | Not set (OS default 1500) + per-peer PMTU | Underlay − 73 (1427 on 1500) | 65535 | 2800 (2 UDP datagrams per full frame) |
| **Control-plane model** | Fully distributed (optional public shared nodes) | Central server + DERP relays | DHT bootstrap nodes | Fully distributed (optional public nodes) | Self-hosted lighthouses + CA | Central management + signal servers + relays | Fully distributed | Fully distributed | Fully distributed | Fully distributed (spanning tree) | Controller per network + root servers |
| **Data-plane threading** | Tokio, but ~1 core per direction | NumCPU crypto workers | Goroutines; per-peer crypto in one QUIC connection | 1 encrypt + 1 decrypt task | 1 goroutine per direction; `routines: N` (Linux, opt-in) | Kernel WireGuard per-CPU workers | Single-threaded | Up to 4 shards on Linux; one peer's RX stays on one core | Single-threaded | Parallel across sessions; one session is serial | Single-threaded RX; opt-in multicore TX (Linux/FreeBSD) |

---

## Protocol

### Transport

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UDP transport | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Datagram encapsulation (no head-of-line blocking) | ◐ | ✓ | ✗ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| TCP fallback | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ |
| QUIC support | ✓ | ✗ | ✓ | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✓ | ✗ |
| WebSocket support | ✓ | ◐ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ |

### IP Support

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IPv4 support | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| IPv6 support | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dual-stack | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |

### Network Layer Mode

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Layer 3 (IP) mode | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Layer 2 (Ethernet) mode | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Bridging support | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |

### Advanced Protocol Features

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multipath/bonding | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ◐ | ✓ |
| QoS/traffic shaping | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Multicast support | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |

---

## Encryption

### Key Exchange

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Modern key exchange (Curve25519) | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Perfect Forward Secrecy | ◐ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Post-quantum readiness | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ◐ | ✗ | ✗ | ✗ |
| Key rotation | ✗ | ✓ | ◐ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |

### Symmetric Encryption

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Authenticated encryption | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hardware-accelerated crypto | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✗ | ✓ | ✓ | ◐ | ✓ |
| Constant-time operations | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ |

### Protocol Security

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Replay protection | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✗ |
| Noise Protocol | ◐ | ✓ | ◐ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| No cleartext metadata | ✗ | ◐ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| End-to-end encryption through relays | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Performance

### Threading

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multi-threaded processing | ◐ | ✓ | ◐ | ◐ | ◐ | ✓ | ✗ | ✓ | ✗ | ◐ | ◐ |
| Multi-queue TUN / per-core sockets | ✗ | ✗ | ✗ | ✗ | ◐ | N/A | ✗ | ✓ | ✗ | ✗ | ✗ |

### Packet I/O

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Batch UDP receives (recvmmsg) | ◐ | ✓ | ◐ | ◐ | ✓ | N/A | ✓ | ✓ | ✗ | ◐ | ✓ |
| Batch UDP sends (sendmmsg) | ✗ | ✓ | ✗ | ✗ | ✗ | N/A | ✗ | ✓ | ✗ | ✗ | ✗ |
| Large batch sizes (64+) | ◐ | ✓ | ✗ | ✗ | ✓ | N/A | ✓ | ✓ | ✗ | ◐ | ✓ |

### Offloads

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UDP GSO | ◐ | ✓ | ✓ | ◐ | ✗ | N/A | ✗ | ✓ | ✗ | ◐ | ✗ |
| UDP GRO | ✗ | ✓ | ✗ | ◐ | ✗ | N/A | ✗ | ✗ | ✗ | ✗ | ✗ |
| TUN offload (virtio-net hdr) | ✗ | ✓ | ✗ | ✗ | ✗ | N/A | ✗ | ✓ | ✗ | ◐ | ✗ |

### Buffers and Parsing

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Buffer pool reuse | ◐ | ✓ | ◐ | ✗ | ✓ | N/A | ◐ | ✓ | ✓ | ✓ | ◐ |
| Large UDP socket buffers (MB) | ✗ | ✓ | ✓ | ✗ | ✗ | N/A | ✓ | ✓ | ✗ | ◐ | ✓ |
| Zero-allocation parsing | ◐ | ✓ | ✗ | ✗ | ✓ | N/A | ✓ | ✓ | ✓ | ✗ | ✓ |

### MTU and Peers

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Path MTU discovery | ✗ | ◐ | ◐ | ◐ | ✗ | ✗ | ✓ | ✓ | ✗ | ◐ | ✗ |
| Endpoint caching | ✓ | ✓ | ◐ | ✗ | ✓ | ◐ | ✓ | ✓ | ◐ | ◐ | ✓ |

### Userspace TCP Stack

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Userspace TCP/IP stack | ◐ | ◐ | ◐ | ✗ | ◐ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Data Plane Compression

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tunnel compression | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ◐ |
| Configurable compression | ✗ | N/A | N/A | ✗ | N/A | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |

---

## Security

### Network Security

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Handshake rate limiting | ✗ | ✓ | ✓ | ◐ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Stateful packet filter | ✓ | ◐ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Fine-grained ACLs | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Capability-based access | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |

### Identity & Authentication

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identity validation | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Signed config updates | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Control-server key pinning | ✗ | ✗ | ✗ | N/A | ✓ | ✗ | N/A | N/A | N/A | N/A | ✓ |

### Implementation

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Memory-safe language | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ |
| Privilege separation | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ◐ | ◐ |
| Sandboxing | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ◐ | ◐ | ◐ | ◐ | ✗ |
| Audit logging | ◐ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ◐ |

---

## NAT Traversal

### Discovery

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public endpoint discovery (STUN or reflection) | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ◐ | ✗ | ✓ |
| Multiple discovery servers | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | N/A | N/A | ✗ | ✗ | ✓ |
| NAT type detection | ✓ | ✓ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Port Mapping

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UPnP port mapping | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ◐ | ✓ | ✓ | ✗ | ✓ |
| NAT-PMP support | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| PCP support | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |

### Hole Punching

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UDP hole punching | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Symmetric NAT handling | ✓ | ◐ | ✗ | ✗ | ◐ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Rendezvous coordination | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |

### Fallback

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Relay fallback | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✗ | ✓ |
| Multiple relays | ◐ | ✓ | ◐ | ✓ | ◐ | ◐ | N/A | N/A | ✗ | N/A | ✓ |
| Latency-based relay selection | ✓ | ✓ | ✗ | ✓ | ◐ | ◐ | ◐ | ◐ | ✗ | N/A | ✓ |
| TCP relay support | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ |

---

## Local Routing

### LAN Discovery

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Broadcast/multicast discovery | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Direct path advertisement | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ |

### LAN Optimization

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Automatic LAN preference | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ | ◐ | ✗ | ◐ | ✓ |
| Trusted path mode | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✓ |
| LAN-only mode | ✗ | ✗ | ✗ | ◐ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Routing Features

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Subnet routes | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ |
| Full tunnel mode | ✓ | ✓ | ◐ | ◐ | ✓ | ✓ | ✓ | ✓ | ◐ | ✗ | ✓ |
| Split tunneling | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | ✓ | ✓ | ✗ | N/A | ✓ |
| Route priorities | ◐ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ◐ | ✗ | ✗ |
| Multi-hop routing via peers | ✓ | ✗ | ◐ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Built-in DNS | ✓ | ✓ | ✓ | ✗ | ◐ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |

---

## Resilience

### Offline Operation (controller / lighthouse / bootstrap down)

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Existing connections survive | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Local state caching | ✗ | ✗ | ◐ | ✗ | ◐ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Cached credentials | N/A | ✓ | N/A | N/A | ✓ | ◐ | N/A | N/A | N/A | N/A | ◐ |

### Redundancy

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fully self-hostable | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Controller redundancy | N/A | ✗ | N/A | N/A | ✓ | ✗ | N/A | N/A | N/A | N/A | ◐ |
| Relay redundancy | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| No single root of trust | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |

---

## Authentication

### Enrollment Methods

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pre-authentication keys | ✓ | ✓ | ✗ | ◐ | ✗ | ✓ | ✓ | ✓ | ✓ | N/A | ◐ |
| Certificate-based enrollment | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | N/A | ✗ |
| OAuth/OIDC | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | N/A | ◐ |
| Interactive login | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | N/A | ◐ |
| CLI authentication | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | N/A | N/A | ✓ |

### Authorization

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin approval workflow | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Automated enrollment rules | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ |
| Ephemeral nodes | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Node expiry | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ |

### Identity

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stable device identity | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Identity portability | N/A | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ |

---

## Platform

### Desktop/Server

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Linux | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| macOS | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Windows | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| FreeBSD/OpenBSD | ◐ | ✓ | ✗ | ✗ | ✓ | ◐ | ✓ | ✗ | ✗ | ✓ | ✓ |

### Mobile

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iOS | ◐ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| Android | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ◐ | ✓ | ✗ | ✓ | ✓ |

### Implementation

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | NetBird | Tinc | tincr | VpnCloud | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kernel-mode datapath | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Container support | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |

---

## Summary Statistics

Score = ✓ counts 1, ◐ counts 0.5, out of the rows that apply (N/A rows are excluded). Rows are unweighted, so a missing post-quantum handshake counts the same as missing NAT-PMP. Use the scores to compare breadth, not quality. NetBird's performance score covers only 6 rows, because its kernel WireGuard datapath makes the socket and TUN rows N/A.

| VPN | Protocol | Encryption | Performance | Security | NAT Traversal | Local Routing | Resilience | Authentication | Platform | **Total** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **EasyTier** | 11.5/14 | 5.5/11 | 5.5/16 | 4.5/11 | 9.5/13 | 7.5/11 | 4/5 | 2.5/10 | 6/8 | **56.5/99** (57%) |
| **Tailscale / Headscale** | 7.5/14 | 9.5/11 | 12/15 | 5/11 | 12.5/13 | 7/11 | 4/7 | 9/11 | 7/8 | **73.5/101** (73%) |
| **Hyprspace** | 7/14 | 9/11 | 5/15 | 3/11 | 9/13 | 5.5/11 | 4/5 | 2/11 | 1/8 | **45.5/99** (46%) |
| **Mycelium** | 4.5/14 | 4.5/11 | 2.5/16 | 3/10 | 4/13 | 5/10 | 4/5 | 2.5/11 | 6/8 | **36/98** (37%) |
| **Nebula** | 6/14 | 8/11 | 6.5/15 | 7/11 | 6.5/13 | 7/11 | 5.5/7 | 4/11 | 7/8 | **57.5/101** (57%) |
| **NetBird** | 7/14 | 10.5/11 | 2/6 | 7/11 | 10.5/13 | 7/11 | 3.5/7 | 9/11 | 7.5/8 | **64/92** (70%) |
| **Tinc** | 10/14 | 7/11 | 8.5/16 | 3.5/10 | 5/11 | 6.5/11 | 5/5 | 4/11 | 4.5/8 | **54/97** (56%) |
| **tincr** | 10/14 | 8.5/11 | 14/16 | 4.5/10 | 6.5/11 | 7.5/11 | 5/5 | 4/11 | 3/8 | **63/97** (65%) |
| **VpnCloud** | 10.5/14 | 8.5/11 | 2.5/16 | 4.5/10 | 4.5/13 | 3.5/11 | 3/5 | 3/10 | 1/8 | **41/98** (42%) |
| **Yggdrasil** | 5.5/14 | 7.5/11 | 5/16 | 3/10 | 1/11 | 3.5/10 | 4/5 | 2/6 | 7/8 | **38.5/91** (42%) |
| **ZeroTier** | 10/14 | 4.5/11 | 6.5/16 | 7/11 | 10/13 | 6/11 | 5/7 | 6/11 | 7/8 | **62/102** (61%) |

---

## Caveats the Matrix Cannot Show

- **EasyTier:** There is no key exchange. The handshake sends a fast, non-cryptographic hash of the network secret in plaintext, and every node in a network shares one static AES key. A receiver also accepts packets with the "encrypted" flag cleared, so anyone who has seen the hash can inject traffic. Public shared nodes see network names, peer IDs, virtual IPs and subnets. Every node relays for other networks unless `--private-mode` is set.
- **Tailscale / Headscale:** On Linux with a kernel TUN device, tunneled TCP runs in the host kernel. The gVisor netstack tuning (Reno, large buffers, RACK off) only applies to Tailscale's own services and to userspace-networking mode. The DERP fallback carries packets in a TLS/TCP stream, so it suffers head-of-line blocking. Peer relays and Tailnet Lock exist only in the SaaS, and the control server's key is not pinned.
- **Hyprspace:** All traffic to a peer travels in one reliable QUIC stream, so one lost packet stalls everything to that peer. A goroutine per packet can also reorder packets locally. Any trusted peer can crash the daemon with a frame longer than 1420 bytes, and source IPs of received packets are not checked. Setting a swarm key makes startup fail. The macOS and Windows builds do not compile.
- **Mycelium:** There is no handshake, no forward secrecy and no replay protection. Every packet uses a random nonce under one fixed AES-GCM key, which reaches the safe limit of 2^32 packets after about 14 hours at 1 Gbit/s. Route announcements are unsigned. The default TCP links carry overlay addresses and node IDs in cleartext. QUIC links likely tear down on full-size packets because the datagram is 10 bytes too large.
- **Nebula:** There is no handshake rate limiting and no automatic rekeying. The Noise IX handshake sends the initiator's certificate in cleartext. Multi-core scaling needs `routines > 1` and only works on Linux. Hole-punching helpers (`punchy`) are off by default.
- **NetBird:** Benchmark results depend on whether the kernel WireGuard module was used or the userspace fallback (log line "using userspace bind mode"), so record which one ran. The relay is often the first path that connects. If its WebSocket dial wins, packets run over TCP with head-of-line blocking. The management server is the only root of trust: the network map is unsigned and its key is not pinned. The local daemon socket is world-writable (mode 0666) with no caller check. In the open-source build, peer approval is a stub and the overlay is IPv4-only.
- **Tinc:** One thread does everything, and the SPTPS cipher is portable C with no SIMD. Builds without legacy protocol support never rekey, and they use a 32-bit sequence number as the nonce, which risks nonce reuse on very long sessions (inferred from the code). Any authenticated node can announce edges and subnets unless `StrictSubnets` is set.
- **tincr:** Sharding steers packets by sender, so all traffic from one peer is decrypted on one core. Worker threads only encrypt large TCP bursts, so UDP and small packets stay on the main thread. Default x86_64 builds need a Haswell-or-newer CPU (x86-64-v3) and crash with SIGILL on older ones. The interface MTU stays at 1500, so it relies on PMTU discovery and MSS clamping. Until UDP is confirmed, data rides the TCP meta connection. Like Tinc, any member can announce edges and subnets for the whole mesh unless `StrictSubnets` is set.
- **VpnCloud:** It is single-threaded with at least three syscalls per packet and runs on Linux only. The replay check is a time window, so exact duplicates are accepted. Any trusted peer can claim any subnet, and the ws-proxy server is an unauthenticated open relay. The last commit is from March 2024.
- **Yggdrasil:** Replay protection uses a strict counter, so every reordered packet is dropped. The default MTU is 65535. On tcp and ws links, source and destination public keys travel in cleartext. The link handshake signature can be replayed, and TLS certificates are not verified.
- **ZeroTier:** There is no forward secrecy and no replay window. With the 2800-byte default MTU, every full frame is split into two UDP datagrams by ZeroTier itself. Receiving and decrypting always run on one thread. The network controller is source-available under a non-commercial license and is not in default builds.

---

## Key Takeaways

### Best for Performance
**NetBird** runs kernel WireGuard on Linux, with per-CPU crypto workers and no per-packet syscalls. Among the userspace VPNs, **Tailscale** parallelizes crypto across all cores by default and uses `sendmmsg`, UDP GSO/GRO and TUN offloads. **tincr** has the most complete Linux fast path: `recvmmsg`, UDP GSO, TUN offloads and a multi-queue TUN with up to 4 shards. It still decrypts one peer's traffic on a single core. **Nebula** scales across cores with `routines > 1` on Linux, but that is opt-in. Every other VPN uses roughly one core per direction, and Tinc, VpnCloud and ZeroTier's receive path are single-threaded.

### Head-of-Line Blocking Under Packet Loss
**Hyprspace**, **Yggdrasil**, **Mycelium** and **EasyTier** (with default TCP links) carry tunneled packets inside a reliable ordered stream. Expect them to degrade more under loss than the datagram-based VPNs: Tailscale, NetBird, Nebula, Tinc, tincr, VpnCloud and ZeroTier.

### Strongest Cryptography
**Tailscale** and **NetBird** (WireGuard), **Tinc** and **tincr** (SPTPS) and **Yggdrasil** combine ephemeral key exchange, rekeying and replay protection. **VpnCloud** does too, but its replay check is only a time window. **NetBird** (Rosenpass) and **tincr** (ML-KEM-768 hybrid) are the only ones with an opt-in post-quantum option. **Nebula** has forward secrecy but never rekeys. **EasyTier** has no key exchange at all, and **Mycelium** and **ZeroTier** use static per-peer keys without forward secrecy or replay protection.

### Best for NAT Traversal
**Tailscale** has the most complete NAT traversal: STUN, UPnP/NAT-PMP/PCP, hole punching and DERP relays. **NetBird** is close behind, with ICE, UPnP/NAT-PMP/PCP and its own relay. **EasyTier** is the only one with port prediction for symmetric NATs. **ZeroTier** combines UPnP/NAT-PMP with relaying through its root servers.

### Best for Layer 2 / Bridging
**ZeroTier**, **Tinc**, **tincr** and **VpnCloud** support Layer 2 (Ethernet) mode and bridging non-VPN devices onto the network.

### Best for Decentralization
**EasyTier**, **Mycelium**, **Tinc**, **tincr**, **VpnCloud** and **Yggdrasil** need no controller. Of these, **EasyTier**, **Mycelium**, **Tinc**, **tincr** and **Yggdrasil** also route traffic through ordinary peers over multiple hops.

### Best for Enterprise Features
**Tailscale / Headscale** offers OIDC, admin approval, ephemeral nodes, node expiry and tag-based ACLs. **NetBird** offers OIDC, setup keys with auto-groups, ephemeral peers, login expiry, posture checks and group-based ACLs; peer approval is a stub in the open-source build. **ZeroTier** offers comparable features only together with its hosted controller (ZeroTier Central).

### Written in Memory-Safe Languages
- **Rust**: EasyTier, Mycelium, tincr (OpenSSL in C for the AEAD), VpnCloud
- **Go**: Tailscale, Hyprspace, Nebula, NetBird (Linux datapath is kernel WireGuard in C), Yggdrasil
- **C/C++**: Tinc, ZeroTier (not memory-safe)

### Not in This Matrix
Kernel WireGuard (a point-to-point baseline with no mesh features) and gVisor (a userspace TCP/IP stack used as a library, not a VPN) have their own overview documents.
