import featureMatrixMd from "@/analysis/feature_matrix.md?raw";
import { MarkdownContent } from "../MarkdownContent";

export const FeatureMatrixPage = () => (
  <div class="p-6">
    <MarkdownContent content={featureMatrixMd} />
  </div>
);
