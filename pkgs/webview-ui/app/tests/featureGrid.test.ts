import featureMatrixMd from "@/analysis/feature_matrix.md?raw";
import { describe, expect, it } from "vitest";
import { parseFeatureMatrix, resolveGrid } from "@/src/components/FeatureGrid/matrix";
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
});
