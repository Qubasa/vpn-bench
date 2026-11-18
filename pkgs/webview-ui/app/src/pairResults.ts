// Written by `vpb compare` (generate_pair_results in pkgs/vpn-bench/vpn_bench/comparison.py)
// Path format: @/bench/<ALIAS>/General/pair_results.json

export type TestId =
  | "tcp"
  | "parallel_tcp"
  | "udp"
  | "ping"
  | "qperf"
  | "video"
  | "nix_cache";

export type PairStatus = "ok" | "failed" | "stalled";

export interface PairResult {
  pair: string;
  status: PairStatus;
  metrics: Partial<Record<string, number>>;
}

/** Test → one result per machine pair that ran it. */
export type VpnTests = Partial<Record<TestId, PairResult[]>>;

export interface PairResults {
  stall_seconds: number;
  conditions: string[];
  /** Condition (TC profile) → VPN → tests. */
  results: Record<string, Record<string, VpnTests>>;
}

interface PairResultsFile {
  status: "success";
  data: PairResults;
}

const files = import.meta.glob<PairResultsFile>(
  "@/bench/*/General/pair_results.json",
  { eager: true, import: "default" },
);

const byAlias = new Map(
  Object.entries(files).map(([path, file]) => [
    path.split("/").slice(-3, -2)[0],
    file.data,
  ]),
);

export function getPairResults(alias: string): PairResults | undefined {
  return byAlias.get(alias);
}
