import gridSpec from "@/analysis/feature_grid.json";
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

/** Tile columns, shared with the thesis figure renderer through analysis/feature_grid.json. */
export const GRID: readonly GridGroup[] = gridSpec.groups;

export const CELL_STYLES: Readonly<
  Record<Cell, { symbol: string; label: string; class: string }>
> = {
  yes: { symbol: "✓", label: "Yes", class: "bg-green-400 text-green-950" },
  no: { symbol: "✗", label: "No", class: "bg-rose-400 text-rose-950" },
  partial: {
    symbol: "◐",
    label: "Partial",
    class: "bg-amber-400 text-amber-950",
  },
  unknown: {
    symbol: "?",
    label: "Unknown",
    class: "bg-amber-400 text-amber-950",
  },
  na: { symbol: "", label: "n/a", class: "bg-gray-200 text-gray-500" },
};
