# Mesh VPN Feature Matrix

**Legend:** ✓ = supported (on by default or a normal config option) | ◐ = partial, opt-in experimental, or limited (see the overview) | ✗ = not supported | N/A = does not apply to this design | ? = unknown

---

## At a Glance

| Property | <VPN> |
| --- | --- |
| **Language** | |
| **License** | |
| **Default peer transport** | |
| **Data cipher (default)** | |
| **Handshake** | |
| **Default tunnel MTU** | |
| **Control-plane model** | |
| **Data-plane threading** | |

---

## Protocol

### Transport

| Feature | <VPN> |
| --- | --- |
| UDP transport | |
| Datagram encapsulation (no head-of-line blocking) | |
| TCP fallback | |
| QUIC support | |
| WebSocket support | |

### IP Support

| Feature | <VPN> |
| --- | --- |
| IPv4 support | |
| IPv6 support | |
| Dual-stack | |

### Network Layer Mode

| Feature | <VPN> |
| --- | --- |
| Layer 3 (IP) mode | |
| Layer 2 (Ethernet) mode | |
| Bridging support | |

### Advanced Protocol Features

| Feature | <VPN> |
| --- | --- |
| Multipath/bonding | |
| QoS/traffic shaping | |
| Multicast support | |

---

## Encryption

### Key Exchange

| Feature | <VPN> |
| --- | --- |
| Modern key exchange (Curve25519) | |
| Perfect Forward Secrecy | |
| Post-quantum readiness | |
| Key rotation | |

### Symmetric Encryption

| Feature | <VPN> |
| --- | --- |
| Authenticated encryption | |
| Hardware-accelerated crypto | |
| Constant-time operations | |

### Protocol Security

| Feature | <VPN> |
| --- | --- |
| Replay protection | |
| Noise Protocol | |
| No cleartext metadata | |
| End-to-end encryption through relays | |

---

## Performance

### Threading

| Feature | <VPN> |
| --- | --- |
| Multi-threaded processing | |
| Multi-queue TUN / per-core sockets | |

### Packet I/O

| Feature | <VPN> |
| --- | --- |
| Batch UDP receives (recvmmsg) | |
| Batch UDP sends (sendmmsg) | |
| Large batch sizes (64+) | |

### Offloads

| Feature | <VPN> |
| --- | --- |
| UDP GSO | |
| UDP GRO | |
| TUN offload (virtio-net hdr) | |

### Buffers and Parsing

| Feature | <VPN> |
| --- | --- |
| Buffer pool reuse | |
| Large UDP socket buffers (MB) | |
| Zero-allocation parsing | |

### MTU and Peers

| Feature | <VPN> |
| --- | --- |
| Path MTU discovery | |
| Endpoint caching | |

### Userspace TCP Stack

| Feature | <VPN> |
| --- | --- |
| Userspace TCP/IP stack | |

### Data Plane Compression

| Feature | <VPN> |
| --- | --- |
| Tunnel compression | |
| Configurable compression | |

---

## Security

### Network Security

| Feature | <VPN> |
| --- | --- |
| Handshake rate limiting | |
| Stateful packet filter | |
| Fine-grained ACLs | |
| Capability-based access | |

### Identity & Authentication

| Feature | <VPN> |
| --- | --- |
| Identity validation | |
| Signed config updates | |
| Control-server key pinning | |

### Implementation

| Feature | <VPN> |
| --- | --- |
| Memory-safe language | |
| Privilege separation | |
| Sandboxing | |
| Audit logging | |

---

## NAT Traversal

### Discovery

| Feature | <VPN> |
| --- | --- |
| No own public node needed | |
| Public endpoint discovery (STUN or reflection) | |
| Multiple discovery servers | |
| NAT type detection | |

### Port Mapping

| Feature | <VPN> |
| --- | --- |
| UPnP port mapping | |
| NAT-PMP support | |
| PCP support | |

### Hole Punching

| Feature | <VPN> |
| --- | --- |
| UDP hole punching | |
| Symmetric NAT handling | |
| Rendezvous coordination | |

### Fallback

| Feature | <VPN> |
| --- | --- |
| Relay fallback | |
| Multiple relays | |
| Latency-based relay selection | |
| TCP relay support | |

---

## Local Routing

### LAN Discovery

| Feature | <VPN> |
| --- | --- |
| Broadcast/multicast discovery | |
| Direct path advertisement | |

### LAN Optimization

| Feature | <VPN> |
| --- | --- |
| Automatic LAN preference | |
| Trusted path mode | |
| LAN-only mode | |

### Routing Features

| Feature | <VPN> |
| --- | --- |
| Subnet routes | |
| Full tunnel mode | |
| Split tunneling | |
| Route priorities | |
| Multi-hop routing via peers | |
| Built-in DNS | |

---

## Resilience

### Offline Operation (controller / lighthouse / bootstrap down)

| Feature | <VPN> |
| --- | --- |
| Existing connections survive | |
| Local state caching | |
| Cached credentials | |

### Redundancy

| Feature | <VPN> |
| --- | --- |
| Fully self-hostable | |
| Controller redundancy | |
| Relay redundancy | |
| No single root of trust | |

---

## Authentication

### Enrollment Methods

| Feature | <VPN> |
| --- | --- |
| Pre-authentication keys | |
| Certificate-based enrollment | |
| OAuth/OIDC | |
| Interactive login | |
| CLI authentication | |

### Authorization

| Feature | <VPN> |
| --- | --- |
| Admin approval workflow | |
| Automated enrollment rules | |
| Ephemeral nodes | |
| Node expiry | |

### Identity

| Feature | <VPN> |
| --- | --- |
| Stable device identity | |
| Identity portability | |

---

## Platform

### Desktop/Server

| Feature | <VPN> |
| --- | --- |
| Linux | |
| macOS | |
| Windows | |
| FreeBSD/OpenBSD | |

### Mobile

| Feature | <VPN> |
| --- | --- |
| iOS | |
| Android | |

### Implementation

| Feature | <VPN> |
| --- | --- |
| Kernel-mode datapath | |
| Container support | |

---

## Summary Statistics

Score = ✓ counts 1, ◐ counts 0.5, out of the rows that apply (N/A rows are excluded). Rows are unweighted, so a missing post-quantum handshake counts the same as missing NAT-PMP. Use the scores to compare breadth, not quality.

Because N/A rows are excluded, each VPN's **Total** has a different denominator. **Shared rows** scores every VPN on only the rows that apply to every VPN in this matrix, so it compares like with like. The scores below are computed from the cells above; hover a cell for the exact count.

<!-- feature-scores -->

---

## Caveats the Matrix Cannot Show

<!-- One bullet per VPN: `- **<VPN>:** ...` with the weaknesses and surprises the cells cannot express. Every claim must be backed by the overviews or the source. -->

---

## Key Takeaways

<!-- `### ` subsections comparing the VPNs of this run (performance, head-of-line blocking under loss, cryptography, NAT traversal, Layer 2, decentralization, enterprise features, memory-safe languages). Only name VPNs that are in this matrix. -->
