import featureMatrixMd from "@/analysis/feature_matrix.md?raw";
import { describe, expect, it } from "vitest";
import {
  parseFeatureMatrix,
  percent,
  resolveGrid,
  scoreMatrix,
} from "@/src/components/FeatureGrid/matrix";
import { splitDocument } from "@/src/components/FeatureMatrixPage/document";
import { GRID } from "@/src/components/FeatureGrid/spec";

const table = (header: string, ...rows: string[]): string =>
  [`| Feature | ${header} |`, "| --- | --- | --- |", ...rows].join("\n");

describe("feature grid", () => {
  it("resolves every declared column against the shipped feature matrix", () => {
    const matrix = parseFeatureMatrix(featureMatrixMd);
    const groups = resolveGrid(matrix, GRID);
    for (const column of groups.flatMap((group) => group.columns)) {
      expect(column.cells).toHaveLength(matrix.vpns.length);
    }
  });

  it("reads all symbols across tables separated by prose", () => {
    const matrix = parseFeatureMatrix(
      [table("A | B", "| UDP | ✓ | ◐ |"), "", "text", table("A | B", "| QUIC | N/A | ? |")].join(
        "\n",
      ),
    );
    expect(matrix.vpns).toEqual(["A", "B"]);
    expect(matrix.rows.get("UDP")).toEqual(["yes", "partial"]);
    expect(matrix.rows.get("QUIC")).toEqual(["na", "unknown"]);
  });

  it("rejects an unknown symbol", () => {
    expect(() => parseFeatureMatrix(table("A | B", "| UDP | ✓ | yes |"))).toThrow(
      /unknown symbol "yes"/,
    );
  });

  it("rejects tables whose VPN columns differ", () => {
    const markdown = [table("A | B", "| UDP | ✓ | ✗ |"), "", table("B | A", "| QUIC | ✓ | ✗ |")];
    expect(() => parseFeatureMatrix(markdown.join("\n"))).toThrow(/VPN header differs/);
  });

  it("rejects a declared column that is missing from the matrix", () => {
    const matrix = parseFeatureMatrix(table("A | B", "| UDP | ✓ | ✗ |"));
    expect(() =>
      resolveGrid(matrix, [{ title: "T", columns: [{ label: "Q", feature: "QUIC" }] }]),
    ).toThrow(/no row "QUIC"/);
  });

  it("scores per category, overall and on shared rows, leaving N/A and ? out", () => {
    const markdown = [
      "## Protocol",
      table("A | B", "| UDP | ✓ | ◐ |", "| QUIC | N/A | ✓ |"),
      "## Platform",
      table("A | B", "| iOS | ✗ | ? |", "| Android | ✓ | ✓ |"),
    ].join("\n");
    const [a, b] = scoreMatrix(parseFeatureMatrix(markdown));
    expect(a.categories).toEqual([
      { points: 1, total: 1 },
      { points: 1, total: 2 },
    ]);
    expect(a.overall).toEqual({ points: 2, total: 3 });
    expect(b.overall).toEqual({ points: 2.5, total: 3 });
    expect(a.shared).toEqual({ points: 2, total: 2 });
    expect(b.shared).toEqual({ points: 1.5, total: 2 });
  });

  it("rounds percentages half up", () => {
    expect(percent({ points: 57.5, total: 100 })).toBe(58);
    expect(percent({ points: 46.5, total: 100 })).toBe(47);
  });

  it("shows every matrix row exactly once and one score heatmap", () => {
    const matrix = parseFeatureMatrix(featureMatrixMd);
    const layout = splitDocument(featureMatrixMd);
    const blocks = [...layout.preamble, ...layout.sections.flatMap((section) => section.blocks)];
    const shown = blocks.flatMap((block) => (block.kind === "features" ? block.features : []));
    expect(shown).toEqual([...matrix.rows.keys()]);
    expect(blocks.filter((block) => block.kind === "scores")).toHaveLength(1);
  });
});
