import featureMatrixMd from "@/analysis/feature_matrix.md?raw";
import { For } from "solid-js";
import { FeatureGrid } from "../FeatureGrid";
import { type FeatureMatrix, parseFeatureMatrix } from "../FeatureGrid/matrix";
import { FeatureMatrixDisclaimer } from "../LlmDisclaimer";
import { MarkdownContent } from "../MarkdownContent";
import { type Block, splitDocument } from "./document";
import { FeatureTiles } from "./FeatureTiles";
import { ScoreHeatmap } from "./ScoreHeatmap";

const renderBlock = (matrix: FeatureMatrix, block: Block) => {
  switch (block.kind) {
    case "markdown":
      return <MarkdownContent content={block.text} />;
    case "features":
      return <FeatureTiles matrix={matrix} features={block.features} />;
    case "scores":
      return <ScoreHeatmap matrix={matrix} />;
  }
};

export const FeatureMatrixPage = () => {
  const matrix = parseFeatureMatrix(featureMatrixMd);
  const layout = splitDocument(featureMatrixMd);
  return (
    <div class="p-6">
      <FeatureMatrixDisclaimer />
      <For each={layout.preamble}>{(block) => renderBlock(matrix, block)}</For>
      <FeatureGrid matrix={matrix} />
      <For each={layout.sections}>
        {(section) => (
          <details open class="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <summary class="cursor-pointer text-xl font-semibold">{section.title}</summary>
            <div class="mt-3">
              <For each={section.blocks}>{(block) => renderBlock(matrix, block)}</For>
            </div>
          </details>
        )}
      </For>
    </div>
  );
};
