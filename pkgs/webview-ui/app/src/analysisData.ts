// LLM source analysis written per run by `vpb analyze`
// Path format: @/bench/<ALIAS>/<VPN>/overview.md and analysis.json,
// @/bench/<ALIAS>/General/feature_matrix.md and analysis.json

export interface VpnAnalysis {
  date: string;
  model: string;
  // Source input name to the analyzed revision, the traffic-carrying one first
  revs: Record<string, string>;
}

export interface MatrixAnalysis {
  date: string;
  model: string;
  // VPN dir name to its analyzed source revisions
  revs: Record<string, Record<string, string>>;
}

type ByAliasAndDir<T> = Record<string, Record<string, T>>;

function groupByAliasAndDir<T>(
  files: Record<string, unknown>,
): ByAliasAndDir<T> {
  const grouped: ByAliasAndDir<T> = {};
  for (const [path, content] of Object.entries(files)) {
    const [alias, dirName] = path.split("/").slice(-3, -1);
    grouped[alias] ??= {};
    grouped[alias][dirName] = content as T;
  }
  return grouped;
}

const overviews = groupByAliasAndDir<string>(
  import.meta.glob("@/bench/*/*/overview.md", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);

const analyses = groupByAliasAndDir<VpnAnalysis | MatrixAnalysis>(
  import.meta.glob("@/bench/*/*/analysis.json", {
    eager: true,
    import: "default",
  }),
);

const featureMatrices = groupByAliasAndDir<string>(
  import.meta.glob("@/bench/*/General/feature_matrix.md", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);

export function getVpnOverview(
  alias: string,
  vpnName: string,
): string | undefined {
  return overviews[alias]?.[vpnName];
}

export function getVpnAnalysis(
  alias: string,
  vpnName: string,
): VpnAnalysis | undefined {
  if (vpnName === "General") {
    return undefined;
  }
  return analyses[alias]?.[vpnName] as VpnAnalysis | undefined;
}

export function getFeatureMatrix(alias: string): string | undefined {
  return featureMatrices[alias]?.General;
}

export function getMatrixAnalysis(alias: string): MatrixAnalysis | undefined {
  return analyses[alias]?.General as MatrixAnalysis | undefined;
}
