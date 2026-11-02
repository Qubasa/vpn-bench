import featureMatrixMd from "@/analysis/feature_matrix.md?raw";
import { FeatureGrid } from "../FeatureGrid";
import { MarkdownContent } from "../MarkdownContent";
import { FeatureMatrixDisclaimer } from "../LlmDisclaimer";

export const FeatureMatrixPage = () => (
  <div class="p-6">
    <FeatureMatrixDisclaimer />
    <FeatureGrid />
    <MarkdownContent content={featureMatrixMd} />
  </div>
);
