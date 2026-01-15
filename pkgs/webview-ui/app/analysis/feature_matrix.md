# Mesh VPN Feature Matrix

A comprehensive comparison of mesh VPN solutions across protocol, encryption, performance, security, NAT traversal, routing, resilience, authentication, and platform support features.

**Legend:** ✓ = Supported | ✗ = Not Supported | ? = Unknown/Partial

---

## Protocol Features

### Transport

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| UDP transport | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |
| TCP fallback | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ |
| QUIC support | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| WebSocket support | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |

### IP Support

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| IPv4 support | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |
| IPv6 support | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dual-stack | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |

### Network Layer Mode

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Layer 3 (IP) mode | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Layer 2 (Ethernet) mode | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |
| Bridging support | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |

### Advanced Protocol Features

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Multipath/bonding | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| QoS/traffic shaping | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Multicast support | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |

---

## Encryption

### Key Exchange

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Modern key exchange (Curve25519) | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Perfect Forward Secrecy | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ |
| Post-quantum readiness | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Key rotation | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |

### Symmetric Encryption

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Authenticated encryption | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hardware-accelerated crypto | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ |
| Constant-time operations | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Protocol Security

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Replay protection | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Noise Protocol | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| No cleartext metadata | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ |

---

## Performance

### Threading

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Multi-threaded processing | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| Per-core packet queues | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |

### Packet I/O

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Batch UDP receives (recvmmsg) | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Batch UDP sends (sendmmsg) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Large batch sizes (64+) | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |

### UDP Offload

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| UDP GSO | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| UDP GRO | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Buffer Management

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Buffer pool reuse | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Large UDP socket buffers (MB) | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |

### Userspace TCP Stack

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Userspace TCP implementation | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Large TCP RX/TX buffers | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Tuned congestion control | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Reordering tolerance | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### MTU Handling

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Conservative MTU | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Path MTU discovery | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |

### Peer Management

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Lazy peer removal | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Endpoint caching | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Efficient keepalive timers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Packet Processing

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Zero-allocation parsing | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Zero-copy filtering | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Data Plane Compression

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Tunnel compression | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Configurable compression | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |

---

## Security

### Network Security

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Rate limiting | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Stateful packet filter | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Fine-grained ACLs | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Capability-based access | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |

### Identity & Authentication

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Identity validation | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Signed config updates | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Certificate pinning | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |

### Implementation

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Memory-safe language | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ |
| Privilege separation | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ |
| Sandboxing | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Audit logging | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ |

---

## NAT Traversal

### Discovery

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| STUN support | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Multiple STUN servers | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| NAT type detection | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

### Port Mapping

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| UPnP port mapping | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |
| NAT-PMP support | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| PCP support | ✗ | ✓ | ? | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Hole Punching

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| UDP hole punching | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Symmetric NAT handling | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Rendezvous coordination | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |

### Fallback

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Relay fallback | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ |
| Multiple relay regions | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Automatic relay selection | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| TCP relay support | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |

---

## Local Routing

### LAN Discovery

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Broadcast/multicast discovery | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ |
| Direct path advertisement | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Same-subnet detection | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |

### LAN Optimization

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Automatic LAN preference | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Trusted path mode | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| LAN-only mode | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Routing Features

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Subnet routes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Full tunnel mode | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Split tunneling | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Route priorities | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

---

## Resilience / Central Point of Failure

### Offline Operation

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Existing connections survive | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Local state caching | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cached credentials | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Graceful degradation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Redundancy

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Self-hosted controller | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Controller redundancy | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Relay redundancy | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| No single root of trust | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |

---

## Authentication

### Enrollment Methods

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Pre-authentication keys | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| OAuth/OIDC | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Interactive login | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ |
| CLI authentication | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ |

### Authorization

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Admin approval workflow | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Automated enrollment rules | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Ephemeral nodes | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Node expiry | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |

### Identity

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Stable device identity | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Identity portability | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Multi-user support | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## Platform Support

### Desktop/Server

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Linux | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| macOS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ? | ✓ | ✓ |
| Windows | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ? | ✓ | ✓ |
| FreeBSD/OpenBSD | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ |

### Mobile

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| iOS | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ |
| Android | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |

### Implementation

| Feature | EasyTier | Tailscale | Hyprspace | Mycelium | Nebula | Tinc | VpnCloud | Yggdrasil | ZeroTier |
|---------|----------|-----------|-----------|----------|--------|------|----------|-----------|----------|
| Kernel-mode datapath | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Userspace implementation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Container support | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Summary Statistics

| VPN | Protocol | Encryption | Performance | Security | NAT | Routing | Resilience | Auth | Platform | **Total** |
|-----|----------|------------|-------------|----------|-----|---------|------------|------|----------|-----------|
| **EasyTier** | 12/14 | 3/12 | 9/28 | 4/15 | 10/16 | 9/13 | 7/11 | 5/12 | 8/10 | **67/131** |
| **Tailscale** | 10/14 | 8/12 | 24/28 | 7/15 | 16/16 | 8/13 | 8/11 | 10/12 | 10/10 | **101/131** |
| **Hyprspace** | 9/14 | 7/12 | 7/28 | 3/15 | 13/16 | 8/13 | 7/11 | 2/12 | 5/10 | **61/131** |
| **Mycelium** | 4/14 | 5/12 | 4/28 | 2/15 | 4/16 | 6/13 | 7/11 | 2/12 | 7/10 | **41/131** |
| **Nebula** | 6/14 | 7/12 | 12/28 | 10/15 | 8/16 | 8/13 | 8/11 | 3/12 | 9/10 | **71/131** |
| **Tinc** | 9/14 | 8/12 | 9/28 | 4/15 | 4/16 | 9/13 | 10/11 | 5/12 | 7/10 | **65/131** |
| **VpnCloud** | 9/14 | 8/12 | 5/28 | 4/15 | 5/16 | 4/13 | 7/11 | 3/12 | 3/10 | **48/131** |
| **Yggdrasil** | 6/14 | 7/12 | 6/28 | 3/15 | 1/16 | 3/13 | 8/11 | 3/12 | 9/10 | **46/131** |
| **ZeroTier** | 10/14 | 6/12 | 10/28 | 10/15 | 12/16 | 7/13 | 8/11 | 8/12 | 10/10 | **81/131** |

---

## Key Takeaways

### Best for Performance
**Tailscale** leads with extensive optimizations: UDP batching (recvmmsg/sendmmsg), GSO/GRO offload, 7MB socket buffers, gVisor userspace TCP stack with tuned congestion control, and comprehensive buffer pooling.

### Best for NAT Traversal
**Tailscale** has the most complete NAT traversal with STUN, UPnP/NAT-PMP/PCP, UDP hole punching, and DERP relay fallback. **EasyTier** and **Hyprspace** also offer good NAT traversal via libp2p or custom implementations.

### Best for Layer 2 / Bridging
**ZeroTier**, **Tinc**, and **VpnCloud** support Layer 2 (Ethernet) mode and bridging non-VPN devices onto the network.

### Best for Decentralization
**Mycelium**, **Yggdrasil**, **Tinc**, and **VpnCloud** have no mandatory central controller. **EasyTier** and **Hyprspace** are also mostly decentralized.

### Best for Enterprise Features
**Tailscale** and **ZeroTier** offer OAuth/OIDC, admin approval workflows, automated enrollment rules, ephemeral nodes, and fine-grained ACLs.

### Most Lightweight / Simple
**Mycelium** and **Yggdrasil** are designed for simplicity with no IPv4 support (IPv6 overlay only) and minimal configuration requirements.

### Written in Memory-Safe Languages
- **Rust**: EasyTier, Mycelium, VpnCloud
- **Go**: Tailscale, Hyprspace, Nebula, Yggdrasil
- **C/C++**: Tinc, ZeroTier (not memory-safe)
