// LLM source analysis written per run by `vpb analyze`
// Path format: @/bench/<ALIAS>/<VPN>/overview.md, analysis.json and citations.json,
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

export interface VpnCitations {
  // Citation as written in overview.md to its URL at the analyzed revision
  links: Record<string, string>;
  // Checklist item or At a Glance fact to its citations, the main evidence first
  items: Record<string, string[]>;
}

export interface CellSource {
  citation: string;
  url: string;
}

/** Main evidence of a matrix row in a VPN column, if that cell is backed by a citation. */
export type CellSourceLookup = (
  feature: string,
  column: number,
) => CellSource | undefined;

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

const citations = groupByAliasAndDir<VpnCitations>(
  import.meta.glob("@/bench/*/*/citations.json", {
    eager: true,
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

export function getVpnCitations(
  alias: string,
  vpnName: string,
): VpnCitations | undefined {
  return citations[alias]?.[vpnName];
}

/**
 * Matrix columns follow the key order of the matrix analysis `revs`, which
 * `vpb analyze` writes sorted by VPN directory, the order the matrix uses.
 * Matrix row names are overview item names, At a Glance rows in bold.
 */
export function matrixCellSources(alias: string): CellSourceLookup {
  const vpns = Object.keys(getMatrixAnalysis(alias)?.revs ?? {});
  const columns = vpns.map((vpn) => getVpnCitations(alias, vpn));
  return (feature, column) => {
    const cited = columns[column];
    const citation = cited?.items[feature.replaceAll("**", "")]?.[0];
    if (cited === undefined || citation === undefined) {
      return undefined;
    }
    const url = cited.links[citation];
    return url === undefined ? undefined : { citation, url };
  };
}
