import knownIssuesFile from "@/analysis/known_issues.json";
import type { TestId } from "@/src/pairResults";
import type { MeasuredRule, Requirement } from "./rank";

export interface Extra {
  test: TestId;
  metric: string;
  label: string;
  digits: number;
}

export interface MeasuredQuestion {
  title: string;
  question: string;
  rule: MeasuredRule;
  unit: string;
  digits: number;
  /** Only these conditions are compared; all conditions of the run when absent. */
  conditions?: readonly string[];
  /** Further means shown next to the ranked value. */
  extras: readonly Extra[];
  caveats: readonly string[];
}

export interface FeatureGroup {
  title: string;
  /** Exact row names in feature_matrix.md. */
  rows: readonly string[];
}

export interface FeatureQuestion {
  title: string;
  question: string;
  groups: readonly FeatureGroup[];
  /** Verified critical issues from analysis/known_issues.json rule a VPN out. */
  security: boolean;
  caveats: readonly string[];
}

export interface KnownIssue {
  vpn: string;
  severity: "critical";
  title: string;
  summary: string;
  checked: string;
  source: string;
}

export const KNOWN_ISSUES: readonly KnownIssue[] = knownIssuesFile.issues.map(
  (issue) => {
    if (issue.severity !== "critical") {
      throw new Error(
        `known_issues.json: unknown severity "${issue.severity}"`,
      );
    }
    return { ...issue, severity: issue.severity };
  },
);

export const TEST_LABELS: Readonly<Record<TestId, string>> = {
  tcp: "TCP",
  parallel_tcp: "parallel TCP",
  udp: "UDP",
  ping: "ping",
  qperf: "QUIC",
  video: "video stream",
  nix_cache: "Nix cache",
};

/** What a reader can relate to; the measured numbers come from tc_settings.json. */
export const CONDITION_LABELS: Readonly<Record<string, string>> = {
  baseline: "Good network",
  low_impairment: "Slight delay and loss",
  medium_impairment: "Medium delay and loss",
  high_impairment: "Long delay, more loss",
  congestion_impairment: "Congested uplink",
  reorder_impairment: "Packets out of order",
};

export const MEASURED_QUESTIONS: readonly MeasuredQuestion[] = [
  {
    title: "Big transfers",
    question: "Which VPN moves large files fastest?",
    rule: {
      test: "tcp",
      metric: "mbps",
      better: "higher",
      gates: [
        {
          test: "parallel_tcp",
          reason: "parallel transfers failed or stalled",
        },
      ],
    },
    unit: "Mbit/s",
    digits: 0,
    extras: [],
    caveats: [
      "Ranked by single-stream TCP throughput, the mean of both directions of a bidirectional iperf3 run.",
      "A VPN whose parallel transfers (three pairs at once) fail or stall cannot win that condition.",
    ],
  },
  {
    title: "Calls, gaming and SSH",
    question: "Which VPN adds the least delay?",
    rule: {
      test: "ping",
      metric: "rtt_ms",
      better: "lower",
      gates: [
        {
          test: "video",
          reason: "the video stream lost packets",
          limit: { metric: "packets_dropped", max: 0 },
        },
      ],
    },
    unit: "ms",
    digits: 2,
    extras: [
      { test: "ping", metric: "jitter_ms", label: "Jitter (ms)", digits: 2 },
      {
        test: "ping",
        metric: "loss_percent",
        label: "Ping loss (%)",
        digits: 1,
      },
      { test: "video", metric: "quality", label: "Video quality", digits: 0 },
    ],
    caveats: [
      "Ranked by the mean ping round-trip time. The direct link (Internal) shows the delay without a VPN.",
      "A VPN whose RIST video stream lost packets after retransmission cannot win that condition.",
    ],
  },
  {
    title: "Many small downloads",
    question: "Which VPN fetches many small files fastest?",
    rule: { test: "nix_cache", metric: "seconds", better: "lower", gates: [] },
    unit: "s",
    digits: 1,
    extras: [],
    caveats: [
      "Ranked by the mean time to copy the Firefox closure, many store paths, from a Nix binary cache on another host.",
      "A timeout counts as a failure.",
    ],
  },
  {
    title: "Weak hardware",
    question: "Which VPN needs the least CPU for the data it moves?",
    rule: {
      test: "tcp",
      metric: "host_cpu_percent_per_100_mbps",
      better: "lower",
      gates: [],
    },
    unit: "% CPU per 100 Mbit/s",
    digits: 2,
    conditions: ["baseline"],
    extras: [],
    caveats: [
      "Host CPU during the TCP test, the mean of client and server, divided by the data moved in both directions.",
      "Compared on the good network only. Every impaired condition turns GRO off, so CPU is not comparable across conditions.",
    ],
  },
];

export const FEATURE_QUESTIONS: readonly FeatureQuestion[] = [
  {
    title: "Getting through NAT and firewalls",
    question: "Which VPN connects peers behind NAT and restrictive firewalls?",
    groups: [
      {
        title: "NAT traversal",
        rows: [
          "UDP hole punching",
          "Symmetric NAT handling",
          "Public endpoint discovery (STUN or reflection)",
          "NAT type detection",
          "UPnP port mapping",
          "NAT-PMP support",
          "PCP support",
          "Relay fallback",
        ],
      },
      {
        title: "Restrictive firewalls",
        rows: [
          "TCP fallback",
          "TCP relay support",
          "WebSocket support",
          "No cleartext metadata",
        ],
      },
    ],
    security: false,
    caveats: [
      "The matrix has no rows yet for TLS on port 443, outbound HTTP or SOCKS proxies, CDN-friendly transports or DPI obfuscation, so this card does not judge censorship resistance.",
    ],
  },
  {
    title: "Decentralization",
    question: "Which VPN keeps working without a central server?",
    groups: [
      {
        title: "No central point",
        rows: [
          "Decentralized control plane",
          "No single root of trust",
          "No own public node needed",
          "Fully self-hostable",
          "Relay redundancy",
          "Multi-hop routing via peers",
          "Local state caching",
        ],
      },
    ],
    security: false,
    caveats: [],
  },
  {
    title: "Security",
    question: "Which VPN protects traffic best and limits the damage of a bug?",
    groups: [
      {
        title: "Protects traffic",
        rows: [
          "Perfect Forward Secrecy",
          "Key rotation",
          "Replay protection",
          "Modern key exchange (Curve25519)",
          "Constant-time operations",
          "No cleartext metadata",
          "End-to-end encryption through relays",
          "Handshake rate limiting",
          "Identity validation",
          "Post-quantum readiness",
        ],
      },
      {
        title: "Limits damage",
        rows: ["Memory-safe language", "Privilege separation", "Sandboxing"],
      },
    ],
    security: true,
    caveats: [
      "A verified critical vulnerability rules a VPN out.",
      "Potential concerns that the source analysis lists are not verified and do not change the ranking.",
    ],
  },
  {
    title: "Enterprise readiness",
    question: "Which VPN fits an organization with many users and devices?",
    groups: [
      {
        title: "Access control",
        rows: [
          "Fine-grained ACLs",
          "Capability-based access",
          "Stateful packet filter",
        ],
      },
      {
        title: "Joining and leaving",
        rows: [
          "OAuth/OIDC",
          "Pre-authentication keys",
          "Admin approval workflow",
          "Automated enrollment rules",
          "Ephemeral nodes",
          "Node expiry",
          "Certificate-based enrollment",
        ],
      },
      {
        title: "Operations",
        rows: [
          "Audit logging",
          "Controller redundancy",
          "Signed config updates",
          "Built-in DNS",
        ],
      },
      {
        title: "Platforms",
        rows: ["Windows", "macOS", "iOS", "Android", "Container support"],
      },
    ],
    security: false,
    caveats: ["N/A rows leave the total, so scores are shares, not counts."],
  },
];

export const REQUIREMENTS: readonly Requirement[] = [
  { label: "Windows", feature: "Windows" },
  { label: "macOS", feature: "macOS" },
  { label: "iOS", feature: "iOS" },
  { label: "Android", feature: "Android" },
  { label: "No own public server", feature: "No own public node needed" },
  { label: "Fully self-hostable", feature: "Fully self-hostable" },
  { label: "Layer 2 (Ethernet)", feature: "Layer 2 (Ethernet) mode" },
];
