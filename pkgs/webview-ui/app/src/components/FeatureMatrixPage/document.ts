import type { CellSourceLookup } from "@/src/analysisData";

export type Block =
  | { kind: "markdown"; text: string }
  | { kind: "features"; features: readonly string[] }
  | { kind: "scores" };

export interface DocumentSection {
  title: string;
  blocks: readonly Block[];
}

export interface MatrixDocument {
  /** Everything before the first `## ` heading. */
  preamble: readonly Block[];
  sections: readonly DocumentSection[];
}

/** Placeholder line in feature_matrix.md where the computed score heatmap goes. */
export const SCORES_MARKER = "<!-- feature-scores -->";

/**
 * Splits feature_matrix.md at its `## ` headings. Inside a section, every
 * `| Feature |` table becomes a tile block, the scores marker becomes the heatmap,
 * and all other lines stay markdown. `---` rules are dropped, since sections are
 * drawn as separate cards.
 */
export const splitDocument = (markdown: string): MatrixDocument => {
  const preamble: Block[] = [];
  const sections: { title: string; blocks: Block[] }[] = [];
  let blocks = preamble;
  let text: string[] = [];
  let features: string[] | undefined;

  const flushText = () => {
    if (text.some((line) => line.trim() !== "")) {
      blocks.push({ kind: "markdown", text: text.join("\n") });
    }
    text = [];
  };

  for (const line of markdown.split("\n")) {
    if (features) {
      if (line.startsWith("|")) {
        const name = line.split("|")[1].trim();
        if (!name.startsWith("---")) {
          features.push(name);
        }
        continue;
      }
      blocks.push({ kind: "features", features });
      features = undefined;
    }
    if (line.startsWith("## ")) {
      flushText();
      blocks = [];
      sections.push({ title: line.slice(3).trim(), blocks });
    } else if (line.startsWith("| Feature |")) {
      flushText();
      features = [];
    } else if (line.trim() === SCORES_MARKER) {
      flushText();
      blocks.push({ kind: "scores" });
    } else if (line.trim() !== "---") {
      text.push(line);
    }
  }
  if (features) {
    blocks.push({ kind: "features", features });
  }
  flushText();
  return { preamble, sections };
};

const PROPERTY_HEADER = "| Property |";

const linkPropertyRow = (
  line: string,
  cellSource: CellSourceLookup,
): string => {
  const [name, ...values] = line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (name.startsWith("---")) {
    return line;
  }
  const linked = values.map((value, column) => {
    const source = cellSource(name, column);
    return source ? `[${value}](<${source.url}> "${source.citation}")` : value;
  });
  return `| ${[name, ...linked].join(" | ")} |`;
};

/**
 * Turns every VPN cell of the At a Glance (`| Property |`) table into a markdown
 * link to the evidence of that fact; other lines stay as they are.
 */
export const linkPropertyCells = (
  markdown: string,
  cellSource: CellSourceLookup,
): string => {
  let inTable = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith(PROPERTY_HEADER)) {
        inTable = true;
        return line;
      }
      inTable &&= line.startsWith("|");
      return inTable ? linkPropertyRow(line, cellSource) : line;
    })
    .join("\n");
};
