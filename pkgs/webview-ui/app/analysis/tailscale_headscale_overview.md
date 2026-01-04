# Overview

**Tailscale** is a mesh VPN solution consisting of two main components:

1. **Tailscale Client** (tailscaled): The open-source VPN client daemon written in Go that runs on end-user devices. It handles WireGuard-based peer-to-peer networking, NAT traversal, packet processing, and encryption. The client can work with any TS2021-compatible control plane.

2. **Control Plane**: Coordinates the mesh network by managing node registration, key distribution, policy enforcement, and endpoint coordination. Two implementations exist:
   - **Tailscale Control Server** (commercial/cloud): The official commercial control plane operated by Tailscale Inc. Provides additional enterprise features, web dashboard, and managed infrastructure.
   - **Headscale** (open-source/self-hosted): An open-source, self-hosted implementation of the Tailscale control server. Allows users to operate their own control plane while using the Tailscale client.

**Key Architecture Components:**

**Tailscale Client:**
- **tailscaled** (cmd/tailscaled/tailscaled.go): Main client daemon running continuously on the system
- **WireGuard Engine** (wgengine/userspace.go): Manages WireGuard interface via wireguard-go userspace implementation, routing, DNS, and peer configuration
- **MagicSock** (wgengine/magicsock/magicsock.go): UDP socket that actively manages endpoints and performs NAT traversal
- **Control Client** (control/controlclient/client.go): Maintains communication with the control server
- **Local Backend** (ipn/ipnlocal/local.go): Orchestrates all components and handles state management
- **Netstack (gVisor)** (wgengine/netstack/netstack.go): Userspace TCP/IP stack with aggressive tuning for performance

**Headscale Control Server:**
- **Control Plane Server** (hscontrol/app.go): Main HTTP/gRPC server handling node registration and coordination
- **State Management** (hscontrol/state/state.go): Central coordinator for database, policy, IP allocation, DERP
- **NodeStore** (hscontrol/state/node_store.go): In-memory cache with copy-on-write semantics for performance
- **Policy Manager** (hscontrol/policy/v2/policy.go): ACL evaluation and enforcement
- **Mapper** (hscontrol/mapper/mapper.go): Converts internal state to Tailscale protocol format

**Important Distinction:** Headscale is **control plane only**. All VPN data traffic flows directly between Tailscale clients using WireGuard, never touching the Headscale server. Headscale only handles registration, authentication, key distribution, and policy management.

# Protocol

The Tailscale ecosystem uses two distinct protocol layers:

**Control Plane (Tailscale Client ↔ Control Server):**

The **TS2021 protocol** (Noise-based encryption) secures communication between clients and control servers (both Tailscale and Headscale):

- **Transport**: WebSocket upgrade to `/ts2021` endpoint
- **Encryption**: Noise Protocol Framework (IK pattern) with Curve25519, ChaCha20-Poly1305, and BLAKE2s
- **Message Framing**: Maximum 4096 bytes per frame with 3-byte header
- **HTTP/2 over Noise**: After handshake, HTTP/2 is served over the encrypted Noise connection

**Communication Flow:**
1. Client initiates WebSocket connection to control server
2. Noise handshake establishes encrypted channel with early payload challenge
3. HTTP/2 runs over Noise connection
4. Client sends MapRequest via long-polling to `/machine/map`
5. Server responds with MapResponse containing network configuration
6. Keep-alive interval: 50 seconds

**MapRequest/MapResponse Protocol:**
- **MapRequest**: Contains node endpoints, hostinfo, capabilities, network information (NAT type, available endpoints), TKA (Tailscale Key Authority) head hash
- **MapResponse**: Contains peer list, DERP map, DNS configuration, packet filters, ACL rules
- **Delta Updates**: Only changed peers sent (PeersChanged/PeersRemoved fields)
- **Compression**: Optional Zstd compression for large responses

**Data Plane (Peer-to-Peer Traffic):**

All actual VPN traffic uses **WireGuard** protocol:

- **Primary Transport**: UDP on ephemeral ports
- **WireGuard Implementation**: wireguard-go (userspace implementation in Go)
- **Encryption**: ChaCha20-Poly1305 (WireGuard standard)
- **Key Exchange**: Curve25519 (WireGuard standard)
- **TCP Fallback**: Not supported natively by WireGuard
- **DERP Relay Fallback**: When direct UDP fails, encrypted WireGuard packets are relayed over DERP
  - DERP supports both TCP and WebSocket transports
  - DERP relay is encrypted (WireGuard packets remain encrypted inside DERP tunnel)

**Protocol Support:**
- **UDP**: Primary transport for WireGuard tunnels
- **TCP**: Via DERP relay servers (WireGuard packets encapsulated in TCP)
- **WebSocket**: DERP supports WebSocket for restrictive firewalls
- **QUIC**: Supported for DERP connections, but requires ~1350 byte MTU (often fails on constrained networks)
- **IPv4**: Full support for both control and data plane
- **IPv6**: Full support for both control and data plane

## Protocol Features Checklist

### Transport
- [x] **UDP transport** - Primary WireGuard transport protocol
- [x] **TCP fallback** - Works through restrictive firewalls via DERP relay over TCP
- [x] **QUIC support** - DERP-over-QUIC supported (requires adequate MTU ~1350 bytes)
- [x] **WebSocket support** - DERP relay supports WebSocket for HTTP-compatible tunneling

### IP Support
- [x] **IPv4 support** - Full IPv4 tunnel traffic support
- [x] **IPv6 support** - Native IPv6 tunneling supported
- [x] **Dual-stack** - Simultaneous IPv4 and IPv6 operation

### Network Layer Mode
- [x] **Layer 3 (IP) mode** - IP packet routing only (WireGuard operates at Layer 3)
- [ ] **Layer 2 (Ethernet) mode** - No Ethernet frame tunneling capability
- [ ] **Bridging support** - Cannot bridge non-VPN devices onto network

### Advanced
- [ ] **Multipath/bonding** - No aggregation of multiple network paths (single best path selected)
- [ ] **QoS/traffic shaping** - No priority queues or traffic class support
- [ ] **Multicast support** - No virtual multicast/broadcast (Layer 3 only)

# Encryption

**Control Plane Encryption (TS2021 Protocol):**

The Noise Protocol Framework secures all communication between Tailscale clients and control servers:

- **Protocol**: Noise IK (Interactive Handshake) pattern
- **Key Exchange**: Curve25519 (X25519 ECDH)
- **Symmetric Encryption**: ChaCha20-Poly1305 (authenticated encryption)
- **Hash Function**: BLAKE2s
- **Perfect Forward Secrecy**: Yes, via Noise protocol ephemeral keys
- **Early Payload**: Challenge-response in initial handshake prevents server spoofing
- **Handshake Hash**: Binds subsequent messages to connection (prevents replay attacks)

**Key Types:**

1. **MachineKey** (Curve25519):
   - Long-term machine identity key
   - Persisted to disk with `privkey:` prefix
   - Used for control plane authentication
   - Never sent to peers (only to control server)
   - Constant-time comparison to prevent timing attacks

2. **NodeKey** (Curve25519):
   - Session key for WireGuard tunnels
   - Distributed to peers via control server
   - Can be rotated independently of MachineKey
   - Used for peer-to-peer WireGuard encryption

3. **DiscoKey** (Curve25519):
   - Discovery/endpoint probing key
   - Used for NAT traversal and endpoint discovery
   - Published to peers for "Call-Me-Maybe" protocol

**Data Plane Encryption (WireGuard):**

All peer-to-peer traffic encrypted by WireGuard:

- **Protocol**: WireGuard (Noise_IKpsk2 pattern)
- **Key Exchange**: Curve25519
- **Symmetric Encryption**: ChaCha20-Poly1305
- **Key Distribution**: Control server distributes peer public keys in MapResponse
- **Perfect Forward Secrecy**: Yes, WireGuard rotates keys every ~2 minutes
- **Replay Protection**: 64-bit counter prevents replay attacks
- **Per-Peer Configuration**: Each peer has separate WireGuard tunnel with independent keys

**Key Rotation:**

- **WireGuard Automatic Rotation**: Keys automatically rotated by WireGuard protocol (~2 minutes)
- **NodeKey Manual Rotation**: NodeKey can be manually rotated via client commands
- **MachineKey Rotation**: Requires re-registration (not automatic)
- **No Auto-Rotation Policy**: Enterprise automatic key rotation not implemented in open-source

**Hardware Acceleration:**

- **AES-NI**: Not used (ChaCha20 preferred)
- **ChaCha20 Optimization**: Uses optimized implementations (including SIMD when available)
- **Constant-Time Operations**: All cryptographic operations use constant-time algorithms to prevent timing attacks

## Encryption Checklist

### Key Exchange
- [x] **Modern key exchange** - Curve25519/X25519 ECDH used throughout
- [x] **Perfect Forward Secrecy** - Ephemeral session keys (Noise protocol + WireGuard automatic rotation)
- [ ] **Post-quantum readiness** - No hybrid or post-quantum key exchange currently implemented
- [x] **Key rotation** - WireGuard automatic key rotation (~2 minutes), manual NodeKey rotation supported

### Symmetric Encryption
- [x] **Authenticated encryption** - ChaCha20-Poly1305 for both control and data plane
- [ ] **Hardware-accelerated crypto** - ChaCha20 doesn't use AES-NI (but has optimized SIMD implementations)
- [x] **Constant-time operations** - Timing attack resistant (constant-time key comparison implemented)

### Protocol Security
- [x] **Replay protection** - 64-bit counter/nonce verification in WireGuard, handshake hash binding in Noise
- [x] **Noise Protocol or equivalent** - Full Noise IK implementation for control plane, WireGuard (Noise_IKpsk2) for data plane
- [x] **No cleartext metadata** - Control plane encrypted via Noise, data plane via WireGuard (encrypted headers/identities)

# Performance

**Threading Model:**

Both Tailscale client and Headscale use **Go's goroutine model** for concurrent operation across multiple CPU cores.

**Tailscale Client Threading:**

The client uses extensive parallelism with careful synchronization:

- **WireGuard Device**: Runs in separate goroutines for packet processing (managed by wireguard-go)
- **Control Client**: Dedicated long-polling goroutine for map updates
- **MagicSock**: Separate read/write goroutines for UDP socket operations
- **Network Monitor**: Background goroutine listening for system network changes
- **Router**: Asynchronous OS routing table updates
- **Netstack (gVisor)**: Userspace TCP/IP stack with per-connection goroutines

**Concurrency Patterns:**
- `sync.Mutex` for shared state protection in userspaceEngine
- `atomic` types for lock-free reads on endpoints
- `sync.Pool` for efficient buffer reuse in UDP operations
- Event bus for inter-component communication
- Per-endpoint heartbeat timer management

**Headscale Control Server Threading:**

The control server is designed for multi-core scalability:

- **Copy-on-Write NodeStore**: Lock-free reads using `atomic.Pointer`, writes are batched
- **Worker Pools**: Configurable parallel workers for MapResponse generation
- **Concurrent Map Access**: `xsync.Map` for thread-safe maps in batcher
- `sync.WaitGroup` for client stream management
- `sync.Mutex` and `deadlock.Mutex` (optional) for thread safety
- **Deadlock Detection**: Optional via `HEADSCALE_DEBUG_DEADLOCK` environment variable

**Synchronization Points:**
- MapResponse updates trigger WireGuard configuration changes
- Endpoint changes trigger immediate magicsock updates
- Network changes detected by netmon.Monitor trigger re-evaluation
- Batched writes to reduce expensive peer recalculations (Headscale)

## Performance Optimizations Checklist

### Threading
- [x] **Multi-threaded processing** - Go goroutines provide parallel packet handling across CPU cores
- [x] **Per-core packet queues** - wireguard-go uses per-peer queues to reduce lock contention

### Packet I/O
- [x] **Batch UDP receives** - Uses `recvmmsg` on Linux for receiving multiple packets per syscall
- [x] **Batch UDP sends** - Uses `sendmmsg` on Linux for sending multiple packets per syscall
- [x] **Large batch sizes** - Ideal batch size of 128 packets per batch

### UDP Offload
- [x] **UDP GSO (Generic Segmentation Offload)** - Kernel segments outgoing packets (up to 64 packets per GSO segment)
- [x] **UDP GRO (Generic Receive Offload)** - Kernel coalesces incoming packets before delivery

### Buffer Management
- [x] **Buffer pool reuse** - `sync.Pool` reuses allocated buffers to reduce GC pressure
- [x] **Large UDP socket buffers** - 7 MB socket buffers (vs ~200 KB kernel default)

### Userspace TCP Stack (optional)
- [x] **Userspace TCP implementation** - gVisor netstack for tunneled traffic (optional, not all deployments)
- [x] **Large TCP RX/TX buffers** - 8 MB RX / 6 MB TX buffers in netstack (vs ~128 KB kernel default)
- [x] **Tuned congestion control** - Reno over CUBIC, RACK disabled to prevent spurious retransmits under reordering
- [x] **Reordering tolerance** - Handles 5%+ packet reordering without spurious retransmits

### Receive Path
- [x] **TCP/packet coalescing on ingress** - GRO coalesces TCP segments before processing
- [x] **RX checksum offload** - Skips redundant checksum validation (RXChecksumValidated = true)

### MTU Handling
- [x] **Conservative MTU** - Uses safe 1280 byte MTU (IPv6 minimum) to avoid fragmentation
- [x] **Path MTU discovery** - MTU probing discovers optimal path MTU per peer

### Peer Management
- [x] **Lazy peer removal** - Delays removing inactive peers for 5 minutes to reduce config churn
- [x] **Endpoint caching** - Caches best endpoints to minimize probe overhead
- [x] **Efficient keepalive timers** - Per-endpoint heartbeat management with batched processing

### Packet Processing
- [x] **Zero-allocation parsing** - Parses packets without heap allocations on hot paths (packet.Parsed struct)
- [x] **Zero-copy filtering** - Filters packets without copying data (stateful filter with LRU cache)

### State Synchronization
- [x] **Delta updates** - Only changed peers sent in MapResponse (PeersChanged/PeersRemoved)
- [x] **Compression** - Zstd compression for control plane MapResponse messages

### Data Plane Compression
- [ ] **Tunnel compression** - No data packet compression (WireGuard encrypted traffic is incompressible)
- [ ] **Configurable compression level** - N/A (compression disabled for encrypted tunnels)

**Performance Results:**

Under adverse network conditions (5% reordering, 2% packet loss), Tailscale achieves **41 Mbps** vs raw WireGuard's **9 Mbps** and direct connection's **30 Mbps**. This counterintuitive performance gain is due to:

1. **128-packet batching** (+50%): Reduces syscall overhead
2. **7 MB socket buffers** (+100%): Absorbs reordering before TCP sees it
3. **8 MB TCP buffers + SACK** (+80%): Prevents window collapse
4. **RACK disabled + Reno CC** (+40%): Prevents false retransmit
5. **GSO/GRO** (+20%): Reduced CPU overhead
6. **Combined Effect**: 9 Mbps → 41 Mbps (+355%)

The userspace gVisor TCP stack with aggressive tuning absorbs packet loss/reordering so completely that the VPN overhead becomes negligible while kernel TCP experiences congestion collapse.

# Security

**Positive Security Aspects:**

1. **Strong Encryption**:
   - Noise Protocol for control plane
   - WireGuard for data plane
   - Perfect forward secrecy via ephemeral keys
   - ChaCha20-Poly1305 authenticated encryption throughout

2. **Key Management**:
   - Curve25519 for all key operations
   - Constant-time comparison prevents timing attacks
   - Machine key never sent to peers (only to control server)
   - Separate identity keys (MachineKey) from session keys (NodeKey)

3. **Protocol Security**:
   - Early Noise payload with challenge prevents server spoofing
   - Unique machine key per client
   - Handshake hash prevents replay attacks
   - WireGuard replay protection via 64-bit counter

4. **Network Security**:
   - Stateful packet filter with connection tracking (512-flow LRU cache)
   - Capability-based access control (fine-grained per-port/protocol ACLs)
   - ACL-based peer visibility filtering

5. **Authentication**:
   - PKCE support for OAuth/OIDC
   - Machine key verification
   - Per-session node keys
   - Email verification for OIDC (configurable)
   - Node expiry enforcement (nodes cannot extend their own expiry)

6. **Implementation Security**:
   - Memory-safe language (Go) for both client and Headscale
   - CSRF protection for OIDC flows (state/nonce cookies)

**Known Security Issues:**

No severe publicly disclosed CVEs for Tailscale client or Headscale at the time of this analysis. The codebase is relatively young (Tailscale: 2020, Headscale: 2020) and has not had major security incidents.

**Potential Security Concerns:**

1. **NAT Traversal Side Channels**:
   - Direct IP exposure through endpoint exchange (ISP/home IPs visible to peers)
   - DERP region leaks location information
   - No circuit-level privacy like Tor
   - Clock skew in heartbeat timing could leak information

2. **Relay Server Trust**:
   - DERP servers can observe encrypted packet metadata (but cannot decrypt)
   - DERP region selection reveals location preference
   - Embedded DERP verification can be disabled (should be enabled in production)

3. **Control Server Trust** (Critical):
   - Control server has **full control** over the mesh network
   - Can push malicious peer keys, ACL changes, or route configurations
   - Can perform MITM by distributing attacker-controlled keys
   - **Headscale users must secure their control server** as it is the root of trust
   - Compromised control server = compromised network

4. **DNS Privacy**:
   - MagicDNS queries go through Tailscale infrastructure (encrypted but visible to control server)
   - Server sees query patterns

5. **Endpoint Selection**:
   - No randomization in endpoint selection (observable pattern)
   - Could leak usage patterns to network observers

6. **Headscale-Specific Concerns**:
   - Database credentials stored in config file (supports file-based secrets via `oidc_client_secret_path`)
   - API key storage (should verify hashing implementation)
   - No visible rate limiting on registration endpoints (potential brute-force on pre-auth keys)
   - Debug environment variables expose functionality (should be disabled in production)
   - DERP WebSocket accepts all origins (wildcard) - requires proper reverse proxy protection

7. **Missing Security Features** (vs. Enterprise):
   - No device posture checks
   - No hardware attestation (TPM)
   - No automatic key rotation policy
   - No security event audit logging (basic logging only)

## Security Features Checklist

### Network Security
- [ ] **Rate limiting** - No visible rate limiting in Headscale (potential DoS/amplification risk)
- [x] **Stateful packet filter** - Connection tracking for ACLs (512-flow LRU cache)
- [x] **Fine-grained ACLs** - Per-port/protocol access control with capability-based rules
- [x] **Capability-based access** - Beyond simple allow/deny (source IP capabilities)

### Identity & Authentication
- [ ] **Identity validation** - No proof-of-work or cryptographic challenge for registration (basic key validation only)
- [x] **Signed configuration updates** - MapResponse cryptographically protected via Noise channel
- [x] **Certificate pinning** - MachineKey-based authentication prevents MITM on control plane

### Implementation
- [x] **Memory-safe language** - Go for both Tailscale client and Headscale
- [ ] **Privilege separation** - tailscaled runs as root/admin (required for TUN interface and routing)
- [ ] **Sandboxing** - No process isolation (tailscaled runs with elevated privileges)
- [ ] **Audit logging** - Basic logging only, no comprehensive security event logging

# NAT Traversal

**STUN (Session Traversal Utilities for NAT):**

The Tailscale client uses STUN to discover public endpoints:

- **netcheck Package**: Probes network conditions and performs STUN queries
- **STUN Protocol**: Generates binding requests and parses responses to discover public IP:port
- **Multiple STUN Servers**: Uses multiple DERP servers as STUN servers for redundancy
- **NAT Type Detection**: Identifies NAT behavior (cone, symmetric, etc.) to inform hole-punching strategy

**Port Mapping Protocols:**

Tailscale attempts multiple port mapping protocols for NAT traversal:

- **UPnP** (Universal Plug and Play): Automatic router port forwarding
- **NAT-PMP** (NAT Port Mapping Protocol): Apple/BSD port mapping protocol
- **PCP** (Port Control Protocol): RFC 6887 standard port control

These protocols attempt to create explicit port mappings on the NAT device for more reliable connectivity.

**Discovery Protocol (Disco):**

Tailscale implements a custom discovery protocol for endpoint coordination:

- **Disco Keys**: Each node publishes a discovery key to peers
- **Call-Me-Maybe**: Peers send disco pings to discover each other's endpoints
- **Active Probing**: Tests connectivity via disco pings to multiple candidate endpoints
- **Best Address Selection**: Chooses endpoint based on latency and packet loss
- **Heartbeats**: Periodic keepalives maintain NAT mapping state

**UDP Hole Punching:**

The endpoint module manages aggressive hole-punching:

- **Multiple Candidate Endpoints**: Tracks all possible endpoints per peer (IPv4, IPv6, local, STUN-discovered)
- **Simultaneous Probing**: Tests all candidate endpoints in parallel
- **MTU Probing**: Discovers path MTU to optimize packet size
- **Symmetric NAT Handling**: Works with per-destination port randomization (though success rate varies)

**DERP (Designated Encrypted Relay for Packets):**

When direct connections fail, DERP provides reliable fallback:

- **Relay Protocol**: Encrypted relay for WireGuard packets when direct path unavailable
- **Multiple Regions**: Geographic redundancy with multiple DERP regions
- **Automatic Region Selection**: Chooses lowest-latency region based on periodic probes
- **TCP and WebSocket Support**: DERP relay works over TCP when UDP is blocked
- **Client Pools**: Maintains connection pool to active DERP regions for fast failover

**Headscale DERP Support:**

Headscale can operate embedded DERP servers or use external relays:

- **Embedded DERP Server**: Can run DERP server alongside control plane
- **Embedded STUN Server**: Provides STUN for NAT discovery
- **External DERP Maps**: Can use Tailscale's public DERP or custom DERP infrastructure
- **Client Verification**: Optional verification for DERP access (should be enabled)
- **WebSocket Support**: DERP supports WebSocket for HTTP-compatible environments

## NAT Traversal Checklist

### Discovery
- [x] **STUN support** - Discovers public IP/port via STUN servers (uses DERP servers as STUN)
- [x] **Multiple STUN servers** - Redundancy for NAT detection (multiple DERP regions)
- [x] **NAT type detection** - Identifies NAT behavior (netcheck package)

### Port Mapping
- [x] **UPnP port mapping** - Automatic router port forwarding
- [x] **NAT-PMP support** - Apple/BSD port mapping protocol
- [x] **PCP support** - Port Control Protocol (RFC 6887)

### Hole Punching
- [x] **UDP hole punching** - Direct peer-to-peer through NAT via disco protocol
- [x] **Symmetric NAT handling** - Works with per-destination port randomization (success varies)
- [x] **Rendezvous coordination** - Server-assisted hole punching via control plane endpoint exchange

### Fallback
- [x] **Relay fallback** - Encrypted DERP relay when direct connection fails
- [x] **Multiple relay regions** - Geographic redundancy for DERP relays
- [x] **Automatic relay selection** - Chooses lowest latency DERP region
- [x] **TCP relay support** - DERP relay over TCP (and WebSocket) when UDP blocked

# Local Routing

**LAN Discovery Mechanism:**

Peers discover each other's local endpoints through the control server:

1. **Endpoint Reporting**: Each node reports all its network interfaces and endpoints in MapRequest to control server
2. **Endpoint Distribution**: Control server distributes full endpoint list to authorized peers in MapResponse
3. **Endpoint Types Shared**:
   - Local LAN IPv4/IPv6 addresses
   - STUN-discovered public endpoints
   - DERP region preference
4. **Call-Me-Maybe Protocol**: When peers receive endpoint updates, they send disco pings to all candidate endpoints including LAN addresses

**LAN Detection:**

- **Same-Subnet Detection**: Client compares peer endpoints with local network interfaces to identify same-subnet peers
- **Direct Path Testing**: Disco protocol actively probes all endpoints including local IPs
- **No Broadcast/Multicast**: Does not use broadcast or multicast for discovery (all coordination via control server)

**LAN Optimization:**

Once local peers are identified:

- **Automatic LAN Preference**: MagicSock prefers direct local paths over WAN paths (lower latency wins)
- **Path Selection**: Prioritizes:
  1. Direct local LAN IPv4/IPv6 (lowest latency)
  2. Direct WAN IPv4/IPv6 (medium latency)
  3. DERP relay (fallback)
- **Encryption Still Required**: **All LAN traffic is still WireGuard-encrypted** - no trusted path mode
- **No LAN-Only Mode**: Cannot restrict to local network only (always connects to control server)

**Routing Features:**

The combined Tailscale/Headscale system supports advanced routing:

- **Subnet Routes**: Nodes can advertise routes to other networks (requires approval)
- **Primary Routes**: High-availability route selection when multiple nodes advertise same subnet
- **Exit Node Routes**: Route all traffic (0.0.0.0/0, ::/0) through a designated peer
- **Route Priorities**: Support for failover between multiple subnet routers
- **AllowedIPs Calculation**: Combines node IP addresses, approved subnet routes, and exit routes into WireGuard AllowedIPs configuration

**Split Tunneling:**

- **Selective Routing**: Only Tailscale IP ranges and approved subnet routes go through VPN
- **Default Route Override**: Exit node mode routes all traffic through VPN
- **Per-Peer Routes**: WireGuard AllowedIPs configured per-peer based on what each peer advertises

## Local Routing Checklist

### LAN Discovery
- [ ] **Broadcast/multicast discovery** - No LAN broadcast/multicast (uses control server for endpoint exchange)
- [x] **Direct path advertisement** - Peers share all reachable endpoints via control server
- [x] **Same-subnet detection** - Identifies peers on same network by comparing endpoints

### LAN Optimization
- [x] **Automatic LAN preference** - Prefers local paths over WAN (latency-based selection)
- [ ] **Trusted path mode** - No option to skip encryption on LANs (all traffic encrypted via WireGuard)
- [ ] **LAN-only mode** - Cannot restrict to local network (requires control server connectivity)

### Routing Features
- [x] **Subnet routes** - Route traffic for other networks through peer (requires approval)
- [x] **Full tunnel mode** - Route all traffic through a peer (exit node functionality)
- [x] **Split tunneling** - Selective routing through VPN (default mode)
- [x] **Route priorities** - HA/failover route selection (primary routes)

# Central Point of Failure

**Yes, the control server is a single point of failure**, but with important mitigations:

**When Control Server is Down:**

- **Existing Connections Continue**: ✅ WireGuard tunnels remain active (keys already distributed)
- **Direct P2P Works**: ✅ Peer-to-peer connections continue if endpoints are known
- **DERP Relay May Work**: ✅ DERP relays can continue if they're separate from control server
- **No New Registrations**: ❌ Nodes cannot register or re-authenticate
- **No Policy Updates**: ❌ ACL changes don't propagate
- **No Endpoint Updates**: ❌ Clients cannot discover new peer endpoints or handle network changes
- **No New Peers**: ❌ Cannot add new devices to network

**Mitigation Factors:**

1. **Local State Caching**:
   - Tailscale client caches full network map locally (persisted to disk)
   - Peer information, endpoints, and keys remain available
   - Direct connections work based on cached endpoints

2. **WireGuard Independence**:
   - WireGuard tunnels persist until key expiry (typically not an issue for short outages)
   - Encryption keys already distributed, no control server needed for ongoing traffic

3. **DERP Separation**:
   - DERP relays can be separate infrastructure from control server
   - If DERP servers remain online, relay connectivity continues
   - Headscale embedded DERP fails with control server (should use external DERP for redundancy)

4. **Graceful Degradation**:
   - Existing connections gracefully continue during control server outage
   - Client retries connection to control server with exponential backoff
   - Clear behavior: network frozen in last-known state

**Node Expiry Risk:**

- **Configurable Expiry**: Nodes have expiry timestamps enforced by control server
- **Expired Nodes**: Marked as unauthorized, peers stop accepting their traffic
- **Ephemeral Nodes**: Automatically cleaned up after inactivity timeout
- **Long Outage Risk**: If control server down during expiry, nodes may lose connectivity

**Headscale-Specific Considerations:**

- **Self-Hosted Control**: You control availability (can run HA setup)
- **No Controller Redundancy**: Headscale does not support active-active or failover (single instance only)
- **Database Dependency**: PostgreSQL/SQLite must be available
- **No Multi-Region**: Cannot distribute control server across regions

**Recommendations for High Availability:**

1. **External DERP Servers**: Use separate DERP infrastructure (not embedded)
2. **Monitoring**: Monitor control server and DERP relay availability
3. **Backup Strategy**: Regular database backups for Headscale
4. **Long Expiry**: Configure long node expiry (90+ days) to survive extended outages
5. **Regional DERP**: Deploy DERP relays in multiple regions for redundancy

## Resilience Checklist

### Offline Operation
- [x] **Existing connections survive** - WireGuard tunnels stay up without controller
- [x] **Local state caching** - Persists peer/config information to disk
- [x] **Cached credentials** - MachineKey persists, authentication survives restart
- [x] **Graceful degradation** - Clear behavior: network frozen in last-known state

### Redundancy
- [x] **Self-hosted controller** - Can run own control plane (Headscale)
- [ ] **Controller redundancy** - Multiple controllers NOT supported (single Headscale instance only)
- [x] **Relay redundancy** - Multiple DERP relay servers supported (configure external relays)
- [ ] **No single root of trust** - Control server is single root of trust (can push malicious configs)

### Efficiency
- [x] **Delta/incremental updates** - Only changed peers sent (PeersChanged/PeersRemoved)
- [x] **Long polling / push updates** - Efficient change notification via WebSocket long-polling
- [x] **Configurable sync interval** - Adjustable update frequency (50s keep-alive default)

# Authentication

**Enrollment Methods:**

The combined Tailscale/Headscale system supports multiple authentication methods:

**1. Pre-Authentication Keys (AuthKey):**

- **Headless Enrollment**: Ideal for servers, containers, and automated deployments
- **Reusable or Ephemeral**: Keys can be one-time or multi-use
- **Auto-Tagging**: Keys can automatically apply tags to nodes for policy assignment
- **Auto-Approval**: Can auto-approve subnet routes and exit nodes
- **Created via**: CLI/API in Headscale, web dashboard in Tailscale cloud
- **Use Case**: `tailscale up --authkey=tskey-auth-xxx`

**2. OAuth/OIDC (OpenID Connect):**

- **Full OAuth2/OIDC Flow**: Standards-compliant SSO integration
- **PKCE Support**: Both S256 and plain methods for secure public clients
- **Domain Filtering**: Restrict by email domain (e.g., @company.com)
- **Group Filtering**: Filter by OIDC groups (Tailscale cloud only, not Headscale)
- **User Filtering**: Allowlist specific users
- **Email Verification**: Optional requirement for verified emails
- **IdP Support**: Works with any OIDC provider (Google, Okta, Azure AD, Keycloak, etc.)
- **Headscale OIDC**: Fully supported with profile updates from IdP

**3. Interactive/Web Authentication:**

- **Browser-Based Flow**: Client opens browser for authentication
- **Registration Cache**: Temporary cache with expiration for registration flow
- **Manual Approval**: Admin can approve nodes via CLI/API (Headscale) or dashboard (Tailscale)
- **Auth Code Exchange**: Server provides auth code, client completes registration

**Authorization Workflow:**

1. **Node Registration**:
   - Node sends registration request with MachineKey
   - Authentication method determines approval (auto-approve or manual)
   - Server assigns Tailscale IP from available pool

2. **Admin Approval** (if required):
   - Headscale: `headscale nodes register --key <key>`
   - Tailscale cloud: Approve via web dashboard
   - Can require manual approval for security

3. **Auto-Approval** (if configured):
   - Pre-auth keys enable automatic approval
   - Auto-approvers in ACL policy can approve routes/exit nodes
   - Tagged devices auto-approved based on key tags

4. **Node Expiry**:
   - Nodes have configurable expiry time
   - Expired nodes marked as unauthorized
   - Nodes **cannot extend their own expiry** (security feature)
   - Headscale: Manual re-approval required

**Identity Models:**

- **User-Owned Nodes**: Ownership defined by UserID (traditional model)
- **Tagged Nodes**: Ownership defined by tags, not user (service accounts)
- **Mutually Exclusive**: Node is either user-owned OR tagged, not both
- **TaggedDevices User**: Special protocol user for tagged devices

**Key Management:**

- **MachineKey**: Generated on first run, persisted to disk, identifies machine to control server
- **NodeKey**: Generated per session, distributed to peers for WireGuard tunnels
- **Key Validation**: MachineKey must match node association (prevents key reuse attacks)
- **Stable Identity**: MachineKey provides persistent device identity across restarts

## Authentication Checklist

### Enrollment Methods
- [x] **Pre-authentication keys** - Headless/automated enrollment via reusable or ephemeral keys
- [x] **OAuth/OIDC** - SSO integration with domain/user filtering (group filtering Tailscale cloud only)
- [x] **Interactive login** - Browser-based authentication flow
- [x] **CLI authentication** - Command-line auth flow supported

### Authorization
- [x] **Admin approval workflow** - Manual device authorization by admin (Headscale CLI/Tailscale dashboard)
- [x] **Automated enrollment rules** - Conditional automatic authorization via pre-auth keys and auto-approvers
- [x] **Ephemeral nodes** - Auto-cleanup of temporary devices after inactivity
- [x] **Node expiry** - Time-limited authorization with enforcement (nodes cannot self-extend)

### Identity
- [x] **Stable device identity** - MachineKey persistent across restarts
- [ ] **Identity portability** - Cannot move MachineKey between devices (re-registration required)
- [x] **Multi-user support** - Multiple users per device supported (user-owned vs tagged model)

# Platform Support

**Tailscale Client Platform Support:**

The Tailscale client (tailscaled) supports extensive platform coverage:

**Desktop/Server Operating Systems:**
- **Linux**: Full support (kernel WireGuard or userspace wireguard-go)
- **macOS**: Full support (userspace wireguard-go, network extension)
- **Windows**: Full support (userspace wireguard-go, WinTun driver)
- **FreeBSD**: Full support (userspace wireguard-go)
- **OpenBSD**: Full support (userspace wireguard-go)

**Mobile Operating Systems:**
- **iOS**: Full support via iOS app (Network Extension framework)
- **Android**: Full support via Android app (VpnService API)

**Specialized Platforms:**
- **Docker/Containers**: Full support via containerboot
- **Kubernetes**: Operator support (k8s-operator)
- **Synology NAS**: Package available
- **QNAP NAS**: Package available
- **Other**: Various embedded Linux devices

**Implementation Details:**

**Kernel vs. Userspace WireGuard:**

- **Linux**:
  - Prefers kernel WireGuard module if available (better performance)
  - Falls back to wireguard-go userspace if kernel module not available
  - Can force userspace via environment variable

- **All Other Platforms**:
  - Uses wireguard-go userspace implementation
  - Pure Go implementation (no kernel dependencies)

**TUN Interface:**

- **Linux**: Uses `/dev/net/tun` device
- **macOS**: Uses utun device (userspace tunnel)
- **Windows**: Uses WinTun driver (userspace tunnel)
- **FreeBSD/OpenBSD**: Uses tun device

**Privilege Requirements:**

- **Linux**: Runs as root (required for TUN device and routing table)
- **macOS**: Runs with admin privileges (required for network extension)
- **Windows**: Runs as SYSTEM (required for WinTun and routing)
- **iOS/Android**: Uses OS VPN APIs (user grants VPN permission)

**Netstack Integration:**

- **gVisor Netstack**: Optional userspace TCP/IP stack
- **Use Cases**:
  - Subnet routing (intercept and forward traffic)
  - Exit nodes (full tunnel mode)
  - Taildrop file sharing
  - Tailscale SSH
  - Enhanced performance under packet loss
- **Platforms**: Available on all platforms (Go-based, portable)

**Container Support:**

- **containerboot**: Special mode for ephemeral containers
- **Kubernetes Operator**: Manages Tailscale sidecar containers
- **Docker**: Can run tailscaled in privileged container
- **Network Namespaces**: Supports Linux network namespaces

**Headscale Platform Support:**

Headscale control server is much simpler (control plane only):

- **Linux**: Primary deployment target (amd64, arm64)
- **macOS**: Development/testing (not recommended for production)
- **Windows**: Not officially supported (Go builds possible but untested)
- **Docker**: Official Docker images available
- **Kubernetes**: Can deploy via standard K8s deployment

**Database Support (Headscale):**
- **SQLite**: Embedded database (default, good for small deployments)
- **PostgreSQL**: External database (recommended for production, better performance)

## Platform Checklist

### Desktop/Server
- [x] **Linux** - Full support (kernel WireGuard or userspace wireguard-go)
- [x] **macOS** - Full support (userspace wireguard-go)
- [x] **Windows** - Full support (userspace wireguard-go + WinTun)
- [x] **FreeBSD/OpenBSD** - BSD support (userspace wireguard-go)

### Mobile
- [x] **iOS** - Mobile app via Network Extension
- [x] **Android** - Mobile app via VpnService API

### Implementation
- [x] **Kernel-mode datapath** - Linux kernel WireGuard support (optional)
- [x] **Userspace implementation** - wireguard-go runs entirely in userspace (all platforms)
- [x] **Container support** - Docker/Kubernetes integration via containerboot and k8s-operator
