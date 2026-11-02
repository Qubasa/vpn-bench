import type { Cell } from "./matrix";

export interface GridColumn {
  /** Short header shown above the tiles. */
  label: string;
  /** Exact row name in feature_matrix.md. */
  feature: string;
}

export interface GridGroup {
  title: string;
  columns: readonly GridColumn[];
}

export const GRID: readonly GridGroup[] = [
  {
    title: "Everyday use",
    columns: [
      { label: "Decentralized", feature: "No single root of trust" },
      { label: "Self-hostable", feature: "Fully self-hostable" },
      { label: "No public IP", feature: "UDP hole punching" },
      { label: "Auto relay", feature: "Relay fallback" },
      { label: "Works if UDP blocked", feature: "TCP fallback" },
      { label: "WebSocket", feature: "WebSocket support" },
      { label: "Uses IP", feature: "Layer 3 (IP) mode" },
      { label: "Layer 2", feature: "Layer 2 (Ethernet) mode" },
      { label: "UDP inner", feature: "Datagram encapsulation (no head-of-line blocking)" },
      { label: "Android", feature: "Android" },
      { label: "iOS", feature: "iOS" },
    ],
  },
  {
    title: "Security",
    columns: [
      { label: "Forward secrecy", feature: "Perfect Forward Secrecy" },
      { label: "Key rotation", feature: "Key rotation" },
      { label: "Replay protection", feature: "Replay protection" },
      { label: "Memory-safe", feature: "Memory-safe language" },
      { label: "ACLs", feature: "Fine-grained ACLs" },
    ],
  },
  {
    title: "Performance & routing",
    columns: [
      { label: "Multi-core", feature: "Multi-threaded processing" },
      { label: "Batched UDP I/O", feature: "Batch UDP receives (recvmmsg)" },
      { label: "Multi-hop", feature: "Multi-hop routing via peers" },
      { label: "Built-in DNS", feature: "Built-in DNS" },
    ],
  },
];

export const CELL_STYLES: Readonly<
  Record<Cell, { symbol: string; label: string; class: string }>
> = {
  yes: { symbol: "✓", label: "Yes", class: "bg-green-400 text-green-950" },
  no: { symbol: "✗", label: "No", class: "bg-rose-400 text-rose-950" },
  partial: { symbol: "◐", label: "Partial", class: "bg-amber-400 text-amber-950" },
  unknown: { symbol: "?", label: "Unknown", class: "bg-amber-400 text-amber-950" },
  na: { symbol: "", label: "n/a", class: "bg-gray-200 text-gray-500" },
};
