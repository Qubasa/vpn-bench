import type { GridGroup } from "./spec";

export type Cell = "yes" | "partial" | "no" | "na" | "unknown";

export interface FeatureMatrix {
  vpns: readonly string[];
  rows: ReadonlyMap<string, readonly Cell[]>;
  /** `## ` heading of the document → cells of the feature rows under it. */
  categories: ReadonlyMap<string, readonly (readonly Cell[])[]>;
}

const SYMBOLS: Readonly<Record<string, Cell>> = {
  "✓": "yes",
  "◐": "partial",
  "✗": "no",
  "N/A": "na",
  "?": "unknown",
};

/**
 * Collects every `| Feature | <vpn> | ... |` table of feature_matrix.md into one lookup.
 * Throws on anything that would silently mislabel a tile: differing VPN headers,
 * duplicate feature names, wrong cell counts or unknown symbols.
 */
export const parseFeatureMatrix = (markdown: string): FeatureMatrix => {
  let vpns: string[] | undefined;
  let inTable = false;
  let category = "";
  const rows = new Map<string, Cell[]>();
  const categories = new Map<string, Cell[][]>();

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      category = line.slice(3).trim();
    }
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    const [first, ...rest] = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    if (first === "Feature") {
      if (vpns && rest.join("|") !== vpns.join("|")) {
        throw new Error(`feature_matrix.md: VPN header differs: ${line}`);
      }
      vpns = rest;
      inTable = true;
      continue;
    }
    if (!inTable || !vpns || first.startsWith("---")) {
      continue;
    }
    if (rest.length !== vpns.length) {
      throw new Error(
        `feature_matrix.md: "${first}" has ${rest.length} cells, expected ${vpns.length}`,
      );
    }
    if (rows.has(first)) {
      throw new Error(`feature_matrix.md: duplicate feature "${first}"`);
    }
    const cells = rest.map((symbol) => {
      const cell = SYMBOLS[symbol];
      if (!cell) {
        throw new Error(
          `feature_matrix.md: unknown symbol "${symbol}" in "${first}"`,
        );
      }
      return cell;
    });
    rows.set(first, cells);
    categories.set(category, [...(categories.get(category) ?? []), cells]);
  }

  if (!vpns) {
    throw new Error("feature_matrix.md: no | Feature | table found");
  }
  return { vpns, rows, categories };
};

export interface Score {
  points: number;
  total: number;
}

export interface VpnScores {
  vpn: string;
  categories: readonly Score[];
  overall: Score;
  /** Only rows where no VPN is N/A or unknown, so every VPN has the same denominator. */
  shared: Score;
}

const POINTS: Readonly<Partial<Record<Cell, number>>> = {
  yes: 1,
  partial: 0.5,
  no: 0,
};

/** Rounded half up; points are multiples of 0.5, so `points * 100` is exact. */
export const percent = (score: Score): number =>
  Math.round((score.points * 100) / score.total);

/** ✓ = 1, ◐ = 0.5, ✗ = 0; N/A and ? leave the denominator. */
export const scoreMatrix = (matrix: FeatureMatrix): VpnScores[] => {
  const sharedRows = [...matrix.rows.values()].filter((cells) =>
    cells.every((cell) => POINTS[cell] !== undefined),
  );
  const tally = (
    rowCells: Iterable<readonly Cell[]>,
    column: number,
  ): Score => {
    const score = { points: 0, total: 0 };
    for (const cells of rowCells) {
      const points = POINTS[cells[column]];
      if (points !== undefined) {
        score.points += points;
        score.total += 1;
      }
    }
    return score;
  };
  return matrix.vpns.map((vpn, column) => ({
    vpn,
    categories: [...matrix.categories.values()].map((rowCells) =>
      tally(rowCells, column),
    ),
    overall: tally(matrix.rows.values(), column),
    shared: tally(sharedRows, column),
  }));
};

export interface ResolvedColumn {
  label: string;
  feature: string;
  cells: readonly Cell[];
}

export interface ResolvedGroup {
  title: string;
  columns: readonly ResolvedColumn[];
}

/** Looks up every declared column in the matrix; a renamed or removed row throws. */
export const resolveGrid = (
  matrix: FeatureMatrix,
  groups: readonly GridGroup[],
): ResolvedGroup[] =>
  groups.map((group) => ({
    title: group.title,
    columns: group.columns.map((column) => {
      const cells = matrix.rows.get(column.feature);
      if (!cells) {
        throw new Error(
          `feature grid: no row "${column.feature}" in feature_matrix.md`,
        );
      }
      return { ...column, cells };
    }),
  }));
