// VPN Information and Metadata

export interface VpnInfoData {
  name: string;
  description: string;
  website: string;
  protocol: string;
  encryption: string;
  features: string[];
  useCases: string[];
}

// VPN information database
export const vpnInfoDatabase: Record<string, VpnInfoData> = {
  wireguard: {
    name: "WireGuard",
    description:
      "WireGuard is a modern, high-performance VPN that aims to be faster, simpler, leaner, and more useful than IPsec and OpenVPN. It uses state-of-the-art cryptography and is designed to be easy to implement and audit.",
    website: "https://www.wireguard.com/",
    protocol: "UDP",
    encryption: "ChaCha20, Poly1305, Curve25519, BLAKE2s, SipHash24",
    features: [
      "Minimal attack surface with ~4,000 lines of code",
      "Built-in roaming support",
      "Cryptokey routing",
      "Silent by default (no response to unauthenticated packets)",
      "Kernel-level implementation for high performance",
    ],
    useCases: [
      "High-performance point-to-point connections",
      "Mobile device VPN with seamless roaming",
      "Simple site-to-site tunnels",
      "Container and microservice networking",
    ],
  },
  openvpn: {
    name: "OpenVPN",
    description:
      "OpenVPN is a full-featured open-source SSL VPN solution that implements OSI layer 2 or 3 secure network extension using the SSL/TLS protocol. It is highly configurable and supports a wide variety of authentication methods.",
    website: "https://openvpn.net/",
    protocol: "UDP/TCP",
    encryption: "OpenSSL (AES, Blowfish, Camellia, etc.)",
    features: [
      "Cross-platform compatibility",
      "Highly configurable",
      "Plugin support for authentication",
      "Support for bridging and routing modes",
      "Compression support",
    ],
    useCases: [
      "Enterprise remote access",
      "Site-to-site connectivity",
      "Bypassing restrictive firewalls (TCP mode)",
      "Complex network topologies",
    ],
  },
  tinc: {
    name: "Tinc",
    description:
      "Tinc is a Virtual Private Network (VPN) daemon that uses tunneling and encryption to create a secure private network between hosts on the Internet. It supports mesh networking, allowing all hosts to connect directly to each other.",
    website: "https://www.tinc-vpn.org/",
    protocol: "UDP/TCP",
    encryption: "OpenSSL (RSA, AES, Blowfish, etc.)",
    features: [
      "Automatic full mesh routing",
      "Decentralized - no single point of failure",
      "Automatic key exchange",
      "NAT traversal",
      "IPv6 support",
    ],
    useCases: [
      "Mesh networks",
      "Connecting multiple sites without a central server",
      "Peer-to-peer networking",
      "Resilient network topologies",
    ],
  },
  tailscale: {
    name: "Tailscale",
    description:
      "Tailscale is a zero-config VPN built on WireGuard. It creates a secure mesh network between your devices using the WireGuard protocol, with easy setup and management through a coordination server.",
    website: "https://tailscale.com/",
    protocol: "UDP (WireGuard)",
    encryption: "WireGuard cryptography (ChaCha20, Poly1305, Curve25519)",
    features: [
      "Zero configuration required",
      "Automatic NAT traversal (DERP relays)",
      "Identity-based access control",
      "MagicDNS for easy device naming",
      "Subnet routing and exit nodes",
    ],
    useCases: [
      "Team and personal device connectivity",
      "Remote access to home/office networks",
      "Secure access to cloud resources",
      "Developer environments",
    ],
  },
  nebula: {
    name: "Nebula",
    description:
      "Nebula is a scalable overlay networking tool with a focus on performance, simplicity, and security. Developed by Slack, it allows users to seamlessly connect computers anywhere in the world.",
    website: "https://github.com/slackhq/nebula",
    protocol: "UDP",
    encryption: "Noise Protocol Framework (Curve25519, ChaCha20, Poly1305)",
    features: [
      "Certificate-based node authentication",
      "End-to-end encryption",
      "Decentralized mesh networking",
      "Firewall rules based on certificates",
      "Highly scalable architecture",
    ],
    useCases: [
      "Large-scale mesh networks",
      "Multi-cloud connectivity",
      "Zero-trust networking",
      "Container orchestration networking",
    ],
  },
  ipsec: {
    name: "IPsec",
    description:
      "IPsec (Internet Protocol Security) is a secure network protocol suite that authenticates and encrypts packets of data at the IP layer. It is commonly used for VPNs and is built into most operating systems.",
    website: "https://datatracker.ietf.org/wg/ipsec/about/",
    protocol: "UDP/IP (ESP, AH)",
    encryption: "AES, 3DES, various authentication algorithms",
    features: [
      "Native OS support",
      "Transport and tunnel modes",
      "IKEv1/IKEv2 key exchange",
      "Perfect forward secrecy",
      "Hardware acceleration support",
    ],
    useCases: [
      "Site-to-site VPN between routers",
      "Remote access with native clients",
      "Network-layer security",
      "Compliance requirements",
    ],
  },
  zerotier: {
    name: "ZeroTier",
    description:
      "ZeroTier is a smart programmable Ethernet switch for planet Earth. It creates virtual networks of almost unlimited size with end-to-end encryption and peer-to-peer connectivity.",
    website: "https://www.zerotier.com/",
    protocol: "UDP",
    encryption: "Curve25519, Salsa20/12, Poly1305",
    features: [
      "Layer 2 (Ethernet) virtualization",
      "SDN-like flow rules",
      "Automatic peer-to-peer connectivity",
      "Multipath support",
      "Built-in NAT traversal",
    ],
    useCases: [
      "Gaming LANs over the internet",
      "IoT device networking",
      "Distributed applications",
      "Virtual LANs for remote teams",
    ],
  },
  netbird: {
    name: "NetBird",
    description:
      "NetBird is an open-source platform that combines WireGuard VPN with centralized access control, offering a secure and easy-to-use solution for connecting devices and networks.",
    website: "https://netbird.io/",
    protocol: "UDP (WireGuard)",
    encryption: "WireGuard cryptography",
    features: [
      "Centralized management dashboard",
      "Access control policies",
      "SSO integration",
      "Automatic peer discovery",
      "Self-hosted or cloud options",
    ],
    useCases: [
      "Team remote access",
      "Secure access to private resources",
      "Multi-cloud networking",
      "Zero-trust network access",
    ],
  },
  headscale: {
    name: "Headscale",
    description:
      "Headscale is a self-hosted, open-source implementation of the Tailscale control server. It allows you to run your own Tailscale-compatible coordination server, enabling WireGuard-based mesh networking without relying on Tailscale's cloud infrastructure.",
    website: "https://headscale.net/",
    protocol: "UDP (WireGuard)",
    encryption: "WireGuard cryptography (ChaCha20, Poly1305, Curve25519)",
    features: [
      "Self-hosted Tailscale control server",
      "WireGuard-based encryption",
      "Automatic NAT traversal via DERP relays",
      "MagicDNS support",
      "Compatible with official Tailscale clients",
      "ACL and policy support",
    ],
    useCases: [
      "Self-hosted mesh VPN infrastructure",
      "Privacy-conscious organizations",
      "Air-gapped or restricted environments",
      "Replacing Tailscale cloud dependency",
    ],
  },
};

// Get VPN info by name (case-insensitive)
export function getVpnInfo(vpnName: string): VpnInfoData | null {
  const normalizedName = vpnName.toLowerCase().replace(/[\s_-]/g, "");

  // Try exact match first
  if (vpnInfoDatabase[normalizedName]) {
    return vpnInfoDatabase[normalizedName];
  }

  // Try partial match
  for (const [key, info] of Object.entries(vpnInfoDatabase)) {
    if (
      normalizedName.includes(key) ||
      key.includes(normalizedName) ||
      info.name
        .toLowerCase()
        .replace(/[\s_-]/g, "")
        .includes(normalizedName)
    ) {
      return info;
    }
  }

  return null;
}

// Get default info for unknown VPNs
export function getDefaultVpnInfo(vpnName: string): VpnInfoData {
  return {
    name: vpnName,
    description: `${vpnName} is a VPN solution being benchmarked in this test suite.`,
    website: "",
    protocol: "Unknown",
    encryption: "Unknown",
    features: [],
    useCases: [],
  };
}
