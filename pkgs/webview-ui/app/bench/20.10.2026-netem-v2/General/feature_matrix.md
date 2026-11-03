# Mesh VPN Feature Matrix

**Legend:** ✓ = supported (on by default or a normal config option) | ◐ = partial, opt-in experimental, or limited (see the overview) | ✗ = not supported | N/A = does not apply to this design | ? = unknown

---

## At a Glance

| Property | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Language** | Rust | Go | Go | Rust | Go | C | Rust | C (Linux kernel module) | Go | C++ (Rust only in the SSO helper) |
| **License** | LGPL-3.0 | BSD-3-Clause (Tailscale and Headscale) | Apache-2.0 | Apache-2.0 | MIT | GPL-2.0-or-later with OpenSSL exception | GPL-3.0-or-later | GPL-2.0 | LGPL-3.0 with linking exception | MPL-2.0; controller in nonfree/ is source-available |
| **Default peer transport** | TCP first, UDP for hole-punched links; relay through other nodes | WireGuard over UDP; DERP relay over TLS on TCP 443 | QUIC over UDP 8001; TCP 8001 fallback; libp2p circuit relay | TCP or QUIC per configured peer, TCP for LAN peers; routed via other nodes | UDP; optional Nebula relay node; no TCP | SPTPS over UDP 655; TCP meta connection and relaying through nodes | UDP 3210; no fallback (WebSocket proxy by hand) | UDP; no fallback | TLS over TCP for multicast peers, any configured URI scheme; no fallback | UDP 9993; relay via roots; TCP relay on 443 after 60 s without UDP |
| **Data cipher (default)** | AES-128-GCM; AES-256-GCM, ChaCha20-Poly1305, XOR, none | ChaCha20-Poly1305; no alternatives | AES-128-GCM (TLS 1.3 in QUIC); ChaCha20-Poly1305, AES-256-GCM | AES-256-GCM; no alternatives | AES-256-GCM; ChaCha20-Poly1305 | ChaCha20-Poly1305; legacy AES-256-CBC with HMAC-SHA256 | Negotiated per pair, usually AES-128-GCM; AES-256-GCM, ChaCha20-Poly1305, plain | ChaCha20-Poly1305; no alternatives | XSalsa20-Poly1305 end to end; TLS 1.3 per hop on tls:// | AES-256-GMAC-SIV; Salsa20/12-Poly1305 for old peers, none on trusted paths |
| **Handshake** | None: plaintext exchange, keys hashed from the network secret | Noise IKpsk2 with X25519 (WireGuard); Noise IK to Headscale | TLS 1.3 with X25519 (libp2p); Noise XX on TCP as second option | Static-static X25519 without KDF; TLS 1.3 on QUIC hops | Noise IX with X25519 (or P-256), certificates as payload | SPTPS: Ed25519-signed ephemeral X25519, TLS-style PRF | Custom signed 3-message exchange with ephemeral X25519, no KDF | Noise IKpsk2 with X25519 | Custom Ed25519-signed ephemeral X25519 box with key ratchet | Static-static Curve25519 plus KBKDF; no session handshake |
| **Default tunnel MTU** | 1380 flag, 1360 on the TUN with encryption (config.rs, virtual_nic.rs) | 1280 (tstun/mtu.go) | 1420 (cli/up.go) | 1400 (tun/linux.rs LINK_MTU) | 1300 (overlay/tun.go DefaultMTU) | Not set by tincd, kernel TUN default 1500; per-peer PMTU | Underlay MTU minus 73, 1427 on 1500 (device.rs) | 1420 (device.c wg_setup) | 65535 (defaults_linux.go DefaultIfMTU) | 2800, fragmented to 1432 on the wire (Constants.hpp) |
| **Control-plane model** | fully distributed | central server | lighthouse/bootstrap nodes (public libp2p DHT) | fully distributed | lighthouse/bootstrap nodes | fully distributed | fully distributed | fully distributed (static config) | fully distributed | central server (controller) plus root nodes |
| **Data-plane threading** | multi-threaded, 2 Tokio workers, one task per direction | multi-threaded, one crypto worker per CPU | multi-threaded, one quic-go loop per peer | multi-threaded, one encrypt and one decrypt task | multi-threaded, TUN and UDP reader per routine (default 1) | single-threaded select() loop | single-threaded epoll loop | multi-threaded, per-CPU kernel workqueue | multi-threaded, one actor per session | multi-threaded, one thread per direction (opt-in multicore) |

---

## Protocol

### Transport

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UDP transport | ✓ | ✓ | ◐ | ◐ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ |
| Datagram encapsulation (no head-of-line blocking) | ◐ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| TCP fallback | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| QUIC support | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| WebSocket support | ✓ | ◐ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ |

### IP Support

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IPv4 support | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| IPv6 support | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dual-stack | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |

### Network Layer Mode

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Layer 3 (IP) mode | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ |
| Layer 2 (Ethernet) mode | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Bridging support | ✗ | ◐ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |

### Advanced Protocol Features

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multipath/bonding | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| QoS/traffic shaping | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ◐ | ✗ |
| Multicast support | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |

---

## Encryption

### Key Exchange

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Modern key exchange (Curve25519) | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Perfect Forward Secrecy | ◐ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Post-quantum readiness | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ |
| Key rotation | ◐ | ✓ | ✓ | ◐ | ◐ | ✓ | ✓ | ✓ | ✓ | ✗ |

### Symmetric Encryption

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Authenticated encryption | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hardware-accelerated crypto | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ |
| Constant-time operations | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ |

### Protocol Security

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Replay protection | ◐ | ✓ | ✓ | ◐ | ✓ | ✓ | ◐ | ✓ | ✓ | ✗ |
| Noise Protocol | ◐ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| No cleartext metadata | ✗ | ◐ | ✓ | ◐ | ✗ | ✗ | ◐ | ✓ | ◐ | ✗ |
| End-to-end encryption through relays | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |

---

## Performance

### Threading

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multi-threaded processing | ◐ | ✓ | ◐ | ◐ | ✓ | ✗ | ✗ | ✓ | ◐ | ◐ |
| Multi-queue TUN / per-core sockets | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ◐ | ✗ | ✗ |

### Packet I/O

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Batch UDP receives (recvmmsg) | ◐ | ✓ | ✓ | ◐ | ✓ | ✓ | ✗ | ✗ | ◐ | ✓ |
| Batch UDP sends (sendmmsg) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Large batch sizes (64+) | ◐ | ✓ | ✗ | ◐ | ✓ | ✓ | ✗ | ◐ | ✓ | ✓ |

### Offloads

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UDP GSO | ◐ | ✓ | ✓ | ◐ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ |
| UDP GRO | ✗ | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| TUN offload (virtio-net hdr) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |

### Buffers and Parsing

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Buffer pool reuse | ◐ | ✓ | ◐ | ✗ | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ |
| Large UDP socket buffers (MB) | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ |
| Zero-allocation parsing | ✓ | ◐ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |

### MTU and Peers

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Path MTU discovery | ✗ | ◐ | ✓ | ◐ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Endpoint caching | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ◐ | ✓ | ✗ | ✓ |

### Userspace TCP Stack

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Userspace TCP/IP stack | ✓ | ✓ | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Data Plane Compression

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tunnel compression | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ◐ |
| Configurable compression | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |

---

## Security

### Network Security

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Handshake rate limiting | ✗ | ✓ | ◐ | ◐ | ✗ | ✓ | ✗ | ✓ | ◐ | ✓ |
| Stateful packet filter | ✓ | ◐ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Fine-grained ACLs | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Capability-based access | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |

### Identity & Authentication

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identity validation | ✗ | ◐ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ |
| Signed config updates | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Control-server key pinning | N/A | ✗ | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ✓ |

### Implementation

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Memory-safe language | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ |
| Privilege separation | ✗ | ✗ | ✗ | ◐ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Sandboxing | ✗ | ✗ | ✗ | ◐ | ✗ | ✓ | ◐ | ✗ | ◐ | ✗ |
| Audit logging | ◐ | ◐ | ◐ | ◐ | ◐ | ✓ | ✓ | ◐ | ◐ | ◐ |

---

## NAT Traversal

### Discovery

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| No own public node needed | ✓ | ◐ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ | ✓ |
| Public endpoint discovery (STUN or reflection) | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Multiple discovery servers | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| NAT type detection | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Port Mapping

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UPnP port mapping | ✗ | ✓ | ✓ | ✗ | ✗ | ◐ | ✓ | ✗ | ✗ | ✓ |
| NAT-PMP support | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| PCP support | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Hole Punching

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UDP hole punching | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Symmetric NAT handling | ✓ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Rendezvous coordination | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |

### Fallback

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Relay fallback | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| Multiple relays | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| Latency-based relay selection | ✓ | ✓ | ✗ | ✓ | ✗ | ◐ | ✗ | ✗ | ✓ | ✓ |
| TCP relay support | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ◐ | ✗ | ✓ | ✓ |

---

## Local Routing

### LAN Discovery

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Broadcast/multicast discovery | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Direct path advertisement | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✗ | ◐ | ✓ |

### LAN Optimization

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Automatic LAN preference | ✓ | ✓ | ◐ | ✓ | ◐ | ◐ | ✗ | ✗ | ✓ | ✓ |
| Trusted path mode | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ◐ | ✗ | ✗ | ✓ |
| LAN-only mode | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✗ |

### Routing Features

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Subnet routes | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ |
| Full tunnel mode | ✓ | ✓ | ◐ | ✗ | ◐ | ✓ | ◐ | ✓ | ✗ | ✓ |
| Split tunneling | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Route priorities | ◐ | ✓ | ✗ | ✗ | ✓ | ✓ | ◐ | ✗ | ✗ | ✗ |
| Multi-hop routing via peers | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Built-in DNS | ✓ | ✓ | ✓ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## Resilience

### Offline Operation (controller / lighthouse / bootstrap down)

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Existing connections survive | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Local state caching | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ |
| Cached credentials | N/A | ✓ | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ✓ |

### Redundancy

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fully self-hostable | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Controller redundancy | N/A | ✗ | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ✗ |
| Relay redundancy | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| No single root of trust | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |

---

## Authentication

### Enrollment Methods

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pre-authentication keys | ✓ | ✓ | ✗ | ◐ | ✗ | ✓ | ✓ | ✗ | ◐ | ✗ |
| Certificate-based enrollment | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| OAuth/OIDC | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ |
| Interactive login | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ |
| CLI authentication | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |

### Authorization

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin approval workflow | ✗ | ✓ | ◐ | ✗ | ◐ | ◐ | ◐ | ◐ | ◐ | ✓ |
| Automated enrollment rules | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ |
| Ephemeral nodes | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Node expiry | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ |

### Identity

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stable device identity | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Identity portability | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Platform

### Desktop/Server

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Linux | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| macOS | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| Windows | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| FreeBSD/OpenBSD | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |

### Mobile

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iOS | ◐ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| Android | ✓ | ✓ | ✗ | ✓ | ✓ | ◐ | ✗ | ✓ | ✓ | ✓ |

### Implementation

| Feature | EasyTier | Tailscale / Headscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | WireGuard | Yggdrasil | ZeroTier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kernel-mode datapath | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Container support | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |

---

## Summary Statistics

Score = ✓ counts 1, ◐ counts 0.5, out of the rows that apply (N/A rows are excluded). Rows are unweighted, so a missing post-quantum handshake counts the same as missing NAT-PMP. Use the scores to compare breadth, not quality.

Because N/A rows are excluded, each VPN's **Total** has a different denominator. **Shared rows** scores every VPN on only the rows that apply to every VPN in this matrix, so it compares like with like. The scores below are computed from the cells above; hover a cell for the exact count.

<!-- feature-scores -->

---

## Caveats the Matrix Cannot Show

- **EasyTier:** There is no key exchange. The data keys and the admission digest are hashed from the shared network secret with Rust's non-cryptographic `DefaultHasher`, and the digest travels in clear in every handshake, so a passive observer can replay it to join (`peer_conn.rs:274-282`). Packets without the `ENCRYPTED` flag skip decryption, so plaintext can be injected (`ring_aes_gcm.rs:54-58`). All nodes share one static AES-GCM key with random nonces and no replay check. Every node relays for unrelated networks by default (`relay_network_whitelist = "*"`). This revision has no iOS app; iOS devices can join only through the WireGuard VPN portal with the third-party WireGuard client.
- **Tailscale / Headscale:** With no policy file, Headscale allows all traffic between all nodes. The example config uses Tailscale Inc.'s public DERP and STUN servers, so a self-hosted tailnet still relays through a third party. The client does not pin Headscale's Noise key and accepts `http://` server URLs. Pre-auth keys are stored in clear in the database. Headscale offers no Tailnet Lock, so a compromised server can inject peers. `tailscaled` runs as root with no sandbox.
- **Hyprspace:** Any configured peer can crash the daemon by sending a length field above 1420 (`cli/up.go:399,410-415`), and the `activeStreams` map is used from many goroutines without a lock. Inbound packets are not checked against the sender's address, and IPv4 addresses are only 16 bits folded from the peer ID, so they can collide. Every node joins the public IPFS DHT and queries `p2p.privatevoid.net`, which shows third parties which peer IDs are online and where. The macOS and Windows TUN code does not build.
- **Mycelium:** The overlay is IPv6-only (`400::/7`). The end-to-end key is the raw static X25519 output with no KDF, shared by both directions, with random nonces and no end-to-end replay check. The ◐ for forward secrecy, key rotation and replay protection comes only from QUIC hop links. Plain TCP links, used for every LAN-discovered peer, expose overlay addresses and public keys. Routing updates are unsigned, QUIC server certificates are not verified, and any host that reaches port 9651 becomes a peer. The public nodes are preset only in the shipped systemd unit; the bare daemon starts with no peers.
- **Nebula:** Noise IX sends the initiator's certificate (name, networks, groups) in clear in the first message. Handshakes have no rate limit or cookie and run on the same goroutine that decrypts data. An unauthenticated `recv_error` packet from a spoofed source closes a tunnel. Keys are renewed only when the certificate changes. Multi-queue TUN and per-routine sockets need `routines` > 1, which is not the default. Whoever holds the CA key controls the network.
- **Tinc:** All packet work runs in one `select()` loop, and the default SPTPS cipher is portable C without SIMD. The legacy 1.0 protocol stays enabled, so peers without Ed25519 keys fall back to AES-256-CBC with a 4-byte HMAC and no forward secrecy. Without `StrictSubnets`, any member can announce subnets for other nodes, and keys of indirect nodes are learned trust-on-first-use. The ✓ for privilege separation and sandboxing needs `-U` and `-R`, which are off by default. UPnP code exists but is not compiled into this build.
- **VpnCloud:** One epoll loop handles one packet per wakeup. There is no relay and no automatic TCP fallback. In password mode, the wizard default, every node derives one key with 4096 PBKDF2 rounds and a fixed salt, so captured handshakes allow offline password guessing. A replayed ping makes a node send pongs for up to 120 s, and a trusted peer can crash a node with a malformed ECDH key. Decrypted packets are not checked against the sender's claims. Only Linux builds.
- **WireGuard:** The kernel module has no discovery, NAT traversal, relay or roaming beyond the last source address: every peer and endpoint is configured by hand. There is no PMTU probing, and outer packets may be fragmented. Handshake failures and AllowedIPs violations are logged only at debug level. The batch-syscall rows are ✗ because the kernel hands each skb to the UDP layer one at a time, but it also pays no per-packet syscall cost.
- **Yggdrasil:** The overlay is IPv6-only (`200::/7`) with no exit node, and every link is a reliable stream (TCP, TLS or one QUIC stream). A single malformed multicast beacon on the local link can crash the daemon (`multicast/advertisement.go:36-37`), and multicast is on by default. Link authentication can be replayed, and `/64` subnet lookups match only 48 key bits, which an attacker can brute-force with about 2^50 key generations. The default TUN MTU is 65535.
- **ZeroTier:** Traffic keys come from static identity keys, with no forward secrecy, no rekeying, no replay window and 64-bit authentication tags. Packet headers show both ZeroTier addresses, and HELLO shows the full public key by default. The automatic TCP fallback goes to ZeroTier Inc.'s relay at `204.80.128.1:443`. The network controller lives in `nonfree/` under a source-available license, each network has exactly one controller, and the management HTTP port listens on all interfaces.

---

## Key Takeaways

### Performance

Only Tailscale (wireguard-go) has the full set of Linux I/O optimizations: `recvmmsg`/`sendmmsg` with 128-packet batches, UDP GSO and GRO, TUN TSO/GRO through `IFF_VNET_HDR`, 7 MiB socket buffers and one crypto worker per CPU. Kernel WireGuard gets TSO super-packets and per-CPU crypto workers but sends each UDP datagram separately. Yggdrasil reuses wireguard-go's TUN offload, but its links are TCP streams. Tinc and VpnCloud run all packet work on one thread. EasyTier, Mycelium and ZeroTier (without `multicoreEnabled`) encrypt on at most one core per direction. Nebula spreads work across cores only with `routines` > 1. Hyprspace allocates a buffer and starts a goroutine for every outgoing packet.

### Head-of-line blocking under loss

Tailscale, Nebula, Tinc, VpnCloud, WireGuard and ZeroTier send each inner packet as its own UDP datagram, so one lost datagram delays only that packet. Hyprspace sends all traffic to a peer on one QUIC stream, Mycelium uses TCP or a single QUIC stream, and Yggdrasil uses TCP, TLS or a single QUIC stream. In these three a lost segment stalls every inner flow until it is retransmitted, and inner TCP runs over a reliable outer stream. EasyTier prefers TCP for direct links and uses UDP datagrams only on links that hole punching creates.

### Cryptography

WireGuard, Tailscale and Nebula use Noise handshakes. WireGuard, Tailscale, Hyprspace, Tinc, VpnCloud and Yggdrasil derive session keys from ephemeral X25519 and re-key automatically. ZeroTier and Mycelium encrypt end to end with keys derived from static identity keys, and EasyTier hashes all keys from the network secret, so a leaked secret decrypts recorded traffic. ZeroTier has no replay protection at all, and EasyTier and Mycelium have it only on optional hop transports. Mycelium and VpnCloud use raw X25519 output as the AEAD key without a KDF. No VPN here offers a post-quantum key exchange; WireGuard's optional preshared key is the only hedge.

### NAT traversal

EasyTier has the widest NAT toolkit: STUN, NAT type detection, port prediction and an 84-socket birthday spray for symmetric NAT, plus a project-run public server. Tailscale combines STUN, UPnP, NAT-PMP and PCP with DERP relays over TCP 443. ZeroTier uses four company-run roots for rendezvous and relay, UPnP and NAT-PMP, and a TCP relay. Hyprspace relies on libp2p (DCUtR hole punching, AutoNAT, UPnP and NAT-PMP, public bootstrap nodes). Nebula and Tinc punch holes through nodes the operator runs, and VpnCloud through gossip, but VpnCloud has no relay. WireGuard, Yggdrasil and Mycelium do no hole punching; Yggdrasil and Mycelium instead route through other mesh nodes.

### Layer 2

Only Tinc (switch and hub modes), VpnCloud (TAP mode) and ZeroTier (always Ethernet) carry Ethernet frames, broadcast and multicast, and can bridge LAN devices into the overlay. ZeroTier also limits bridging to members the controller marks as bridges. Tailscale's experimental TAP mode strips the Ethernet header, so only IP crosses the tunnel. All other VPNs here are Layer 3 only.

### Decentralization

EasyTier, Mycelium, Tinc, VpnCloud, WireGuard and Yggdrasil have no controller. Nebula and Hyprspace depend on lighthouse or bootstrap nodes only for discovery. Headscale and the ZeroTier controller are central servers, and neither supports more than one active controller. Hyprspace, Mycelium, Tinc, VpnCloud, WireGuard and Yggdrasil have no single root of trust. The Nebula CA key, the Headscale database, the ZeroTier controller key and the EasyTier network secret each take over the whole network if compromised. In EasyTier, Mycelium, Tinc and Yggdrasil, ordinary nodes forward traffic for others through a routing protocol.

### Enterprise features

Tailscale with Headscale is the only stack with OIDC login, pre-auth keys, ephemeral nodes, node expiry, tag and group ACLs, HA subnet routers and built-in DNS together. ZeroTier adds signed network configs, capabilities and tags, admin approval and bonding, but SSO works only with a PostgreSQL controller. Nebula ties firewall rules to certificate groups, expires certificates and tracks connections. EasyTier has stateful ACLs with groups and rate limits. Hyprspace, Mycelium, Tinc, VpnCloud, WireGuard and Yggdrasil have no port or protocol ACLs.

### Memory-safe languages

EasyTier, Mycelium and VpnCloud are Rust. Tailscale, Headscale, Hyprspace, Nebula and Yggdrasil are Go. Tinc and WireGuard are C, and ZeroTier is C++. Memory safety turns parsing bugs into crashes instead of memory corruption, but the crashes remain: a length field crashes Hyprspace, a multicast beacon crashes Yggdrasil, and a malformed ECDH key crashes VpnCloud.
