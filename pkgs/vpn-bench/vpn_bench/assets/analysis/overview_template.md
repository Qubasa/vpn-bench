# Overview

<!-- What the VPN is, who makes it, and the one-paragraph picture of how it works. -->

## Key Architecture Components

<!-- Bold-labelled paragraphs, one per component (control plane, discovery, transport, data path, identity). -->

# Protocol

## Control Plane

## Data Plane

## Protocol Features Checklist

### Transport

- [ ] **UDP transport** - 
- [ ] **Datagram encapsulation (no head-of-line blocking)** - 
- [ ] **TCP fallback** - 
- [ ] **QUIC support** - 
- [ ] **WebSocket support** - 

### IP Support

- [ ] **IPv4 support** - 
- [ ] **IPv6 support** - 
- [ ] **Dual-stack** - 

### Network Layer Mode

- [ ] **Layer 3 (IP) mode** - 
- [ ] **Layer 2 (Ethernet) mode** - 
- [ ] **Bridging support** - 

### Advanced Protocol Features

- [ ] **Multipath/bonding** - 
- [ ] **QoS/traffic shaping** - 
- [ ] **Multicast support** - 

# Encryption

## Encryption Layer Details

<!-- Handshake construction, key derivation, data cipher and alternatives, nonce and replay handling, rekeying. -->

## Encryption Checklist

### Key Exchange

- [ ] **Modern key exchange (Curve25519)** - 
- [ ] **Perfect Forward Secrecy** - 
- [ ] **Post-quantum readiness** - 
- [ ] **Key rotation** - 

### Symmetric Encryption

- [ ] **Authenticated encryption** - 
- [ ] **Hardware-accelerated crypto** - 
- [ ] **Constant-time operations** - 

### Protocol Security

- [ ] **Replay protection** - 
- [ ] **Noise Protocol** - 
- [ ] **No cleartext metadata** - 
- [ ] **End-to-end encryption through relays** - 

# Performance

## Threading Model

<!-- How packets move from the TUN device to the socket and back on Linux with the default build: threads, batching, offloads, copies, buffer sizes. Name the functions. -->

## Performance Optimizations Checklist

### Threading

- [ ] **Multi-threaded processing** - 
- [ ] **Multi-queue TUN / per-core sockets** - 

### Packet I/O

- [ ] **Batch UDP receives (recvmmsg)** - 
- [ ] **Batch UDP sends (sendmmsg)** - 
- [ ] **Large batch sizes (64+)** - 

### Offloads

- [ ] **UDP GSO** - 
- [ ] **UDP GRO** - 
- [ ] **TUN offload (virtio-net hdr)** - 

### Buffers and Parsing

- [ ] **Buffer pool reuse** - 
- [ ] **Large UDP socket buffers (MB)** - 
- [ ] **Zero-allocation parsing** - 

### MTU and Peers

- [ ] **Path MTU discovery** - 
- [ ] **Endpoint caching** - 

### Userspace TCP Stack

- [ ] **Userspace TCP/IP stack** - 

### Data Plane Compression

- [ ] **Tunnel compression** - 
- [ ] **Configurable compression** - 

# Security

## Known Security Issues

<!-- Published CVEs and advisories that affect this version. Say "none found" if there are none. -->

## Potential Security Concerns

<!-- Weaknesses found in the source, each with file:line evidence and why it matters. -->

## Security Features Checklist

### Network Security

- [ ] **Handshake rate limiting** - 
- [ ] **Stateful packet filter** - 
- [ ] **Fine-grained ACLs** - 
- [ ] **Capability-based access** - 

### Identity & Authentication

- [ ] **Identity validation** - 
- [ ] **Signed config updates** - 
- [ ] **Control-server key pinning** - 

### Implementation

- [ ] **Memory-safe language** - 
- [ ] **Privilege separation** - 
- [ ] **Sandboxing** - 
- [ ] **Audit logging** - 

# NAT Traversal

## How NAT Traversal Works

## NAT Traversal Checklist

### Discovery

- [ ] **No own public node needed** - 
- [ ] **Public endpoint discovery (STUN or reflection)** - 
- [ ] **Multiple discovery servers** - 
- [ ] **NAT type detection** - 

### Port Mapping

- [ ] **UPnP port mapping** - 
- [ ] **NAT-PMP support** - 
- [ ] **PCP support** - 

### Hole Punching

- [ ] **UDP hole punching** - 
- [ ] **Symmetric NAT handling** - 
- [ ] **Rendezvous coordination** - 

### Fallback

- [ ] **Relay fallback** - 
- [ ] **Multiple relays** - 
- [ ] **Latency-based relay selection** - 
- [ ] **TCP relay support** - 

# Local Routing

## Peer Discovery on LANs

## Routing Features

## Local Routing Checklist

### LAN Discovery

- [ ] **Broadcast/multicast discovery** - 
- [ ] **Direct path advertisement** - 

### LAN Optimization

- [ ] **Automatic LAN preference** - 
- [ ] **Trusted path mode** - 
- [ ] **LAN-only mode** - 

### Routing Features

- [ ] **Subnet routes** - 
- [ ] **Full tunnel mode** - 
- [ ] **Split tunneling** - 
- [ ] **Route priorities** - 
- [ ] **Multi-hop routing via peers** - 
- [ ] **Built-in DNS** - 

# Central Point of Failure

## What Happens When the Controller Fails

<!-- Use the project's own name for the controller, lighthouse or bootstrap node in this heading. -->

## Mitigation Strategies

## Resilience Checklist

### Offline Operation (controller / lighthouse / bootstrap down)

- [ ] **Existing connections survive** - 
- [ ] **Local state caching** - 
- [ ] **Cached credentials** - 

### Redundancy

- [ ] **Decentralized control plane** - 
- [ ] **Fully self-hostable** - 
- [ ] **Controller redundancy** - 
- [ ] **Relay redundancy** - 
- [ ] **No single root of trust** - 

# Authentication

## How Nodes Join and Authenticate

## Authentication Checklist

### Enrollment Methods

- [ ] **Pre-authentication keys** - 
- [ ] **Certificate-based enrollment** - 
- [ ] **OAuth/OIDC** - 
- [ ] **Interactive login** - 
- [ ] **CLI authentication** - 

### Authorization

- [ ] **Admin approval workflow** - 
- [ ] **Automated enrollment rules** - 
- [ ] **Ephemeral nodes** - 
- [ ] **Node expiry** - 

### Identity

- [ ] **Stable device identity** - 
- [ ] **Identity portability** - 

# Platform Support

## Supported Platforms

## Implementation Details

## Platform Checklist

### Desktop/Server

- [ ] **Linux** - 
- [ ] **macOS** - 
- [ ] **Windows** - 
- [ ] **FreeBSD/OpenBSD** - 

### Mobile

- [ ] **iOS** - 
- [ ] **Android** - 

### Implementation

- [ ] **Kernel-mode datapath** - 
- [ ] **Container support** - 
