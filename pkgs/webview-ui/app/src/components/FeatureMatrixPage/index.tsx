import { For, Show, createMemo } from "solid-js";
import { useAlias } from "@/src/AliasContext";
import { getFeatureMatrix, getMatrixAnalysis } from "@/src/analysisData";
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

const MatrixDocument = (props: { markdown: string }) => {
  const matrix = createMemo(() => parseFeatureMatrix(props.markdown));
  const layout = createMemo(() => splitDocument(props.markdown));
  return (
    <>
      <For each={layout().preamble}>
        {(block) => renderBlock(matrix(), block)}
      </For>
      <FeatureGrid matrix={matrix()} />
      <For each={layout().sections}>
        {(section) => (
          <details
            open
            class="mb-4 rounded-lg border border-gray-200 bg-white p-4"
          >
            <summary class="cursor-pointer text-xl font-semibold">
              {section.title}
            </summary>
            <div class="mt-3">
              <For each={section.blocks}>
                {(block) => renderBlock(matrix(), block)}
              </For>
            </div>
          </details>
        )}
      </For>
    </>
  );
};

export const FeatureMatrixPage = () => {
  const { currentAlias } = useAlias();
  return (
    <div class="p-6">
      <Show when={getMatrixAnalysis(currentAlias())} keyed>
        {(analysis) => <FeatureMatrixDisclaimer analysis={analysis} />}
      </Show>
      <Show
        when={getFeatureMatrix(currentAlias())}
        fallback={
          <div class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
            <p class="font-medium">No source analysis for this run.</p>
            <p class="mt-1 text-sm">
              Run{" "}
              <code class="rounded bg-yellow-100 px-1">
                vpb analyze --alias {currentAlias()}
              </code>{" "}
              to prepare it.
            </p>
          </div>
        }
      >
        {(markdown) => <MatrixDocument markdown={markdown()} />}
      </Show>
    </div>
  );
};
