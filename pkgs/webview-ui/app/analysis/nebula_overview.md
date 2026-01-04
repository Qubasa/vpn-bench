# Overview

Nebula is a scalable, open-source mesh VPN developed by Slack (now maintained by Defined Networking). It creates a peer-to-peer network overlay that enables direct communication between hosts regardless of their underlying network topology. Nebula uses a custom certificate-based PKI system for authentication and employs the Noise Protocol Framework for secure key exchange.

## Key Architecture Components

**Peer-to-peer mesh**: Every node can communicate directly with every other node after establishing encrypted tunnels. Data flows directly between peers without intermediary relay servers (unless required for NAT traversal).

**Lighthouse-assisted discovery**: Lightweight discovery servers (called "lighthouses") help nodes find each other's public IP addresses and ports. Lighthouses are only involved in the control plane - they do not relay data traffic under normal circumstances.

**Certificate-based PKI**: Nebula uses a custom X.509-like certificate format that defines network membership, assigned IP addresses, groups, and routing capabilities. All nodes must have certificates signed by a trusted Certificate Authority (CA).

**UDP-based transport**: All control and data plane traffic flows over encrypted UDP packets with a custom 16-byte wire protocol header.

**Multi-threaded packet processing**: On Linux, Nebula supports multi-queue TUN devices and SO_REUSEPORT for parallel packet processing across CPU cores.

# Protocol

Nebula uses a custom wire protocol exclusively over UDP. All communication - both control plane and data plane - happens through encrypted UDP packets.

## Control Plane

The control plane uses several message types defined in the Nebula header:
- **Handshake messages** - Noise Protocol IX handshake for tunnel establishment
- **Lighthouse messages** - Peer discovery queries and address advertisements
- **Control messages** - Relay management and coordination
- **Test messages** - Tunnel connectivity testing

Nodes periodically send HostUpdateNotification messages to configured lighthouses (default every 60 seconds) to advertise their current IP addresses. When connecting to a new peer, nodes send HostQuery messages to lighthouses to learn the target peer's addresses.

## Data Plane

Once a tunnel is established through the Noise IX handshake, all data packets flow directly between peers as encrypted UDP datagrams. Each packet has a 16-byte Nebula header containing version, message type, remote index, and a 64-bit message counter for replay protection.

The data plane operates at Layer 3 (IP), routing IP packets through the encrypted tunnel. Nebula performs stateful firewall checks with connection tracking on both inbound and outbound packets.

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary and only transport protocol
- [ ] **TCP fallback** - Not supported, UDP only
- [ ] **QUIC support** - Not supported
- [ ] **WebSocket support** - Not supported

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support (v1 and v2 certificates)
- [x] **IPv6 support** - Native IPv6 tunneling (v2 certificates only)
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6 (v2 certificates)

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing only (TUN device with IFF_TUN flag)
- [ ] **Layer 2 (Ethernet) mode** - Not supported, no TAP device support
- [ ] **Bridging support** - Cannot bridge non-VPN devices (Layer 3 only)

### Advanced
- [ ] **Multipath/bonding** - No support for aggregating multiple network paths
- [ ] **QoS/traffic shaping** - No built-in traffic prioritization
- [ ] **Multicast support** - No virtual multicast or broadcast support

# Encryption

Nebula implements the Noise Protocol Framework, specifically the **Noise IX** (Interactive with identity exchange) handshake pattern. This provides mutual authentication where both parties exchange and verify certificates during the handshake.

## Encryption Layer Details

**Key Exchange**: Nebula supports two elliptic curves determined by certificate type:
- **Curve25519** (default) - Used with v1 certificates
- **P-256 (NIST)** - Used with v2 certificates, with optional PKCS#11 HSM support

**Symmetric Ciphers**: Two AEAD cipher options are available:
- **AES-256-GCM** (default) - Hardware-accelerated on platforms with AES-NI
- **ChaCha20-Poly1305** - Better performance on platforms without AES-NI

All nodes in the network must use the same cipher configuration.

**Nonce Construction**: Encryption uses a 12-byte nonce composed of 4 zero bytes + an 8-byte message counter. The message counter starts at 2 and increments for each packet, providing replay protection.

**Replay Protection**: Nebula implements a 1024-packet sliding window bitmap to detect and reject replayed packets.

**Additional Authenticated Data**: The 16-byte Nebula header is used as AAD in the AEAD encryption, binding the ciphertext to the packet metadata.

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519/X25519 ECDH (default) or P-256
- [ ] **Perfect Forward Secrecy** - Handshake provides PFS, but no periodic rekeying for established tunnels
- [ ] **Post-quantum readiness** - No hybrid or PQ key exchange support
- [ ] **Key rotation** - No automatic periodic key refresh mechanism

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 and AES-256-GCM supported
- [x] **Hardware-accelerated crypto** - AES-NI support for AES-256-GCM
- [x] **Constant-time operations** - Uses vetted crypto libraries with timing attack resistance

### Protocol Security
- [x] **Replay protection** - 1024-packet sliding window with bitmap verification
- [x] **Noise Protocol or equivalent** - Noise IX handshake framework
- [x] **No cleartext metadata** - Headers and identities encrypted after handshake

# Performance

Nebula is written in Go and uses a goroutine-based concurrency model with optional multi-core support on Linux.

## Threading Model

**Single-threaded mode** (default on non-Linux platforms and Linux by default):
- One goroutine reads from TUN device
- One goroutine reads from UDP socket
- Additional goroutines handle handshakes, lighthouse queries, and timers

**Multi-threaded mode** (Linux only, configured via `routines` setting):
- Uses IFF_MULTI_QUEUE flag for TUN device, creating N file descriptors
- Uses SO_REUSEPORT for UDP socket, allowing N readers
- Each TUN reader goroutine is pinned to an OS thread via runtime.LockOSThread()
- Kernel load-balances incoming UDP packets across goroutines
- Reduces lock contention and enables true parallel packet processing

**Concurrency primitives**:
- HostMap uses sync.RWMutex for thread-safe peer lookups
- ConnectionState uses atomic counters for message sequence numbers
- Per-routine conntrack cache reduces lock contention on firewall checks

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Parallel packet handling across CPU cores (Linux only)
- [x] **Per-core packet queues** - Multi-queue TUN and SO_REUSEPORT UDP (Linux only)

### Packet I/O
- [x] **Batch UDP receives** - Uses `recvmmsg` with default 64 packets per syscall (Linux)
- [ ] **Batch UDP sends** - Does NOT use `sendmmsg`, individual sendto() per packet
- [x] **Large batch sizes** - 64 packets per receive batch, configurable

### UDP Offload
- [ ] **UDP GSO (Generic Segmentation Offload)** - Not implemented
- [ ] **UDP GRO (Generic Receive Offload)** - Not implemented

### Buffer Management
- [x] **Buffer pool reuse** - Pre-allocated buffers per goroutine, reused across packets
- [x] **Large UDP socket buffers** - Configurable read_buffer/write_buffer (defaults to system settings ~200KB)

### Userspace TCP Stack (optional)
- [ ] **Userspace TCP implementation** - Relies on kernel TCP for tunneled traffic
- [ ] **Large TCP RX/TX buffers** - Uses kernel defaults (~128KB)
- [ ] **Tuned congestion control** - Uses kernel TCP congestion control
- [ ] **Reordering tolerance** - Kernel TCP handles reordering

### Receive Path
- [ ] **TCP/packet coalescing on ingress** - No coalescing implemented
- [ ] **RX checksum offload** - Relies on kernel/hardware offload

### MTU Handling
- [x] **Conservative MTU** - Configurable MTU, default 1300 bytes for tunnel interface
- [x] **Path MTU discovery** - Supports PMTU discovery through ICMP handling

### Peer Management
- [x] **Lazy peer removal** - Peers remain in hostmap until timeout
- [x] **Endpoint caching** - Caches discovered endpoints in lighthouse addrMap
- [x] **Efficient keepalive timers** - Punchy keepalive system for NAT hole punching

### Packet Processing
- [x] **Zero-allocation parsing** - Pre-allocated buffers reduce allocations on hot path
- [ ] **Zero-copy filtering** - Some copying occurs during firewall processing

### State Synchronization
- [ ] **Delta updates** - Lighthouse updates send full address list
- [ ] **Compression** - No compression of control plane messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression
- [ ] **Configurable compression level** - Not applicable

# Security

Nebula has had relatively few security vulnerabilities. The most notable issue was discovered and patched in version 1.9.7.

## Known Security Issues

**CVE-2025 (v1.9.7 fix, October 2025)**: Nebula could incorrectly accept and process packets from an erroneous source IP when the sender's certificate was configured with unsafe_routes (cert v1/v2) or multiple IPs (cert v2). This allowed a potential IP spoofing attack where traffic could be accepted from unauthorized source addresses. Fixed by enforcing stricter source IP validation.

## Potential Security Concerns

**No Perfect Forward Secrecy for established tunnels**: While the Noise IX handshake provides PFS during key exchange, there is no periodic rekeying mechanism for long-lived tunnels. The message counter simply increments from 2 onwards indefinitely. Compromise of session keys exposes all tunnel traffic until the tunnel is torn down and re-established.

**RecvError packet amplification**: Unauthenticated packets can trigger RecvError responses, which could be used for network scanning or amplification attacks. Mitigated by setting `send_recv_error: never` or `private`.

**Roaming validation**: Hosts can roam to new addresses after authentication, protected only by `remote_allow_list`. An attacker on the same network could potentially attempt tunnel hijacking.

**Certificate blocklist distribution**: No automatic distribution mechanism exists. Revoked certificates may remain valid until manual config reload occurs across all nodes.

## Security Features Checklist

### Network Security
- [x] **Rate limiting** - Handshake rate limiting to prevent amplification attacks
- [x] **Stateful packet filter** - Connection tracking for stateful firewall rules
- [x] **Fine-grained ACLs** - Per-port, protocol, host, group, CIDR access control
- [x] **Capability-based access** - Group-based and CA-based rule matching

### Identity & Authentication
- [x] **Identity validation** - Certificate-based cryptographic verification during handshake
- [x] **Signed configuration updates** - Certificates signed by CA, hot-reloadable
- [x] **Certificate pinning** - CA pool and blocklist prevent unauthorized certificates

### Implementation
- [x] **Memory-safe language** - Written in Go (garbage collected, memory safe)
- [ ] **Privilege separation** - Runs as single process, typically requires root for TUN device
- [ ] **Sandboxing** - No process isolation or sandboxing implemented
- [x] **Audit logging** - Security events logged (handshakes, firewall drops, certificate errors)

# NAT Traversal

Nebula implements sophisticated NAT traversal through UDP hole punching coordinated by lighthouses, with relay fallback for difficult NAT scenarios.

## How NAT Traversal Works

**Discovery Phase**: When Node A wants to connect to Node B, it queries configured lighthouses for B's known addresses. The lighthouse has learned these addresses from:
1. HostUpdateNotification messages B sent (reported addresses)
2. The UDP source addresses B's packets arrived from (learned addresses)

**Hole Punching**: The lighthouse sends a HostPunchNotification to Node B, telling it to initiate punching to Node A's addresses. Both nodes send UDP packets to each other's addresses, creating NAT mappings.

**Punchy Configuration**: The `punchy` subsystem provides ongoing keepalive punching:
- `punchy.punch` - Continues punching to maintain NAT mappings
- `punchy.respond` - Responds to punch notifications for symmetric NAT
- `punchy.delay` - Delay before punch response (handles misbehaving NATs)

**Relay Fallback**: For symmetric NAT or double NAT scenarios where hole punching fails, Nebula uses relay tunnels. Nodes configured as relays (`am_relay: true`) can forward encrypted traffic between peers that cannot establish direct connections.

## NAT Traversal Checklist

### Discovery
- [x] **STUN support** - Lighthouse learns public addresses from UDP source IPs (STUN-like behavior)
- [x] **Multiple STUN servers** - Can configure multiple lighthouses for redundancy
- [ ] **NAT type detection** - No explicit NAT type detection, relies on hole punching attempts

### Port Mapping
- [ ] **UPnP port mapping** - Not supported
- [ ] **NAT-PMP support** - Not supported
- [ ] **PCP support** - Not supported

### Hole Punching
- [x] **UDP hole punching** - Bidirectional hole punching coordinated by lighthouse
- [x] **Symmetric NAT handling** - Punchy respond mode for symmetric NAT scenarios
- [x] **Rendezvous coordination** - Lighthouse-assisted punch notification system

### Fallback
- [x] **Relay fallback** - Encrypted relay tunnels when direct connection fails
- [x] **Multiple relay regions** - Can configure multiple relay nodes
- [ ] **Automatic relay selection** - Must manually configure which relays to use
- [ ] **TCP relay support** - Relay uses UDP only (no TCP relay option)

# Local Routing

Nebula does not have automatic LAN discovery. Peers discover each other exclusively through lighthouse queries or static host map entries, even if they are on the same local network.

## Peer Discovery on LANs

Nodes advertise their local IP addresses to lighthouses (filtered by `local_allow_list`). When a peer queries the lighthouse, it receives both public and private IPs for the target. The node will attempt to establish tunnels to all advertised addresses in parallel and use whichever connects first.

**Preferred Ranges**: The `preferred_ranges` configuration provides hints about local network ranges, which can speed up discovering the fastest path by prioritizing local addresses during connection attempts.

**Static Host Map**: For small networks or specific peering relationships, the static_host_map allows pre-configuring peer addresses, bypassing lighthouse queries entirely.

## Routing Features

**Unsafe Routes**: Nebula can route traffic to non-Nebula networks through gateway nodes. The gateway's certificate must include the routed subnet in its `UnsafeNetworks` field. Supports:
- ECMP (Equal-Cost Multi-Path) with weighted load balancing across multiple gateways
- Per-route MTU configuration
- Metric-based route selection

**System Route Table Integration**: On Linux, Nebula can inject routes into the system routing table, enabling advanced routing scenarios including full tunnel mode (0.0.0.0/0 unsafe route).

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No broadcast/multicast LAN announcements
- [x] **Direct path advertisement** - Nodes share local IPs through lighthouse
- [x] **Same-subnet detection** - Preferred ranges hint at local networks

### LAN Optimization
- [x] **Automatic LAN preference** - Preferred_ranges prioritizes local address attempts
- [ ] **Trusted path mode** - No option to skip encryption on trusted LANs
- [ ] **LAN-only mode** - No restriction to local network only

### Routing Features
- [x] **Subnet routes** - Unsafe routes to other networks through gateway peer
- [x] **Full tunnel mode** - 0.0.0.0/0 unsafe route supported
- [x] **Split tunneling** - Default mode (only tunnel VPN IPs, not all traffic)
- [x] **Route priorities** - ECMP weighted routing and metric-based selection

# Central Point of Failure

Lighthouses are **NOT** a single point of failure for data plane operations. However, they are critical for control plane peer discovery.

## What Happens When Lighthouse Fails

**Existing tunnels continue working**: Lighthouses are only involved in peer discovery and address updates. Once a tunnel is established, data flows directly between peers without lighthouse involvement.

**New connections fail discovery**: Attempts to connect to previously unknown peers will fail because there is no way to discover their addresses.

**Static host map still works**: Peers configured in static_host_map can be reached without lighthouse queries.

**Peer roaming may not update**: If a peer's IP address changes (mobile device, DHCP change), existing peers may not learn the new address without a functioning lighthouse.

## Mitigation Strategies

**Multiple lighthouses**: Configure multiple lighthouse nodes for redundancy. Nodes query all configured lighthouses and accept responses from any of them.

**Self-hosted lighthouses**: Run your own lighthouse infrastructure rather than relying on external services.

**Static host map**: For critical peering relationships, use static_host_map to bypass lighthouse dependency entirely.

**Lighthouse-less operation**: Small networks can operate with only static_host_map entries for all peers, eliminating lighthouse dependency completely.

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - Tunnels stay up without lighthouse
- [x] **Local state caching** - Lighthouse responses cached in addrMap
- [ ] **Cached credentials** - Certificates are local files, not fetched from lighthouse
- [x] **Graceful degradation** - Existing tunnels work, new discoveries fail

### Redundancy
- [x] **Self-hosted controller** - Can run own lighthouse infrastructure
- [x] **Controller redundancy** - Multiple lighthouses supported
- [x] **Relay redundancy** - Multiple relay servers can be configured
- [x] **No single root of trust** - Distributed lighthouse model, any trusted lighthouse works

### Efficiency
- [ ] **Delta/incremental updates** - HostUpdateNotification sends full address list
- [ ] **Long polling / push updates** - Polling-based updates on interval
- [x] **Configurable sync interval** - Lighthouse interval adjustable (default 60s)

# Authentication

Nodes authenticate and join the network through Nebula's certificate-based PKI system. There is no interactive enrollment - all authentication is based on pre-distributed certificates.

## Certificate-Based Authentication

**Certificate Generation**:
1. Administrator generates CA key pair using `nebula-cert ca`
2. For each node, administrator generates host certificate using `nebula-cert sign`
3. Host certificate includes: VPN IP(s), name, groups, unsafe routes, validity period
4. Host certificate is signed by CA private key

**Node Enrollment**:
1. Node receives three files: CA certificate, host certificate, host private key
2. Node starts with these files configured in `pki` section
3. During first handshake with any peer, mutual certificate verification occurs
4. Both peers verify the other's certificate is signed by trusted CA
5. Both peers check certificate validity period and blocklist
6. Tunnel established after successful mutual verification

**Certificate Management**:
- Certificates can be hot-reloaded with SIGHUP signal
- Blocklist updates can revoke compromised certificates
- No automatic renewal - certificates must be manually regenerated before expiry
- `pki.disconnect_invalid` option can force disconnection of expired certificates

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Certificate-based, supports headless/automated deployment
- [ ] **OAuth/OIDC** - Not supported
- [ ] **Interactive login** - No browser-based or interactive authentication
- [ ] **CLI authentication** - No interactive CLI auth flow

### Authorization
- [ ] **Admin approval workflow** - No built-in approval workflow
- [ ] **Automated enrollment rules** - No conditional authorization
- [ ] **Ephemeral nodes** - Certificate validity period provides time-limited authorization
- [x] **Node expiry** - Certificate NotBefore/NotAfter enforces expiration

### Identity
- [x] **Stable device identity** - Certificate public key provides persistent identity
- [x] **Identity portability** - Can copy certificate files to new device
- [ ] **Multi-user support** - One certificate per device, not per user

# Platform Support

Nebula supports a wide range of platforms with full userspace implementation for portability.

## Supported Platforms

**Desktop/Server**:
- Linux (x86_64, ARM, ARM64, MIPS, loong64)
- macOS (Intel and Apple Silicon)
- Windows (amd64, 386)
- FreeBSD, OpenBSD, NetBSD

**Mobile**:
- iOS (via Mobile Nebula app)
- Android (via Mobile Nebula app)

## Implementation Details

**Userspace Implementation**: Nebula runs entirely in userspace using TUN devices. It does not use kernel modules or require kernel modifications. This provides:
- Easy deployment across platforms
- No kernel version dependencies
- Simpler security model
- Lower performance compared to kernel implementations

**TUN Device**: Uses Layer 3 TUN devices (IFF_TUN flag on Linux) for IP packet routing. Does not support TAP devices or Layer 2 Ethernet frames.

**Windows Implementation**: Uses WinTun userspace driver on Windows for TUN device support.

**Container Support**: Works in containers with appropriate capabilities (NET_ADMIN). No specialized Kubernetes CNI plugin, but can run as sidecar or node-level daemon.

**Performance Optimizations**:
- Linux: Multi-queue TUN (IFF_MULTI_QUEUE) and SO_REUSEPORT for multi-core scaling
- Linux: recvmmsg batch packet reception
- All platforms: Buffer pooling and per-routine caching

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support with multi-core optimizations
- [x] **macOS** - Full support (userspace only)
- [x] **Windows** - Full support using WinTun driver
- [x] **FreeBSD/OpenBSD** - BSD support

### Mobile
- [x] **iOS** - Mobile app available
- [x] **Android** - Mobile app available

### Implementation
- [ ] **Kernel-mode datapath** - No kernel-mode packet processing
- [x] **Userspace implementation** - Runs entirely in userspace with TUN devices
- [x] **Container support** - Works in Docker/Kubernetes with NET_ADMIN capability
