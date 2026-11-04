import { For } from "solid-js";
import type { CellSourceLookup } from "@/src/analysisData";
import { MatrixCell } from "../FeatureGrid/MatrixCell";
import type { FeatureMatrix } from "../FeatureGrid/matrix";

interface FeatureTilesProps {
  matrix: FeatureMatrix;
  features: readonly string[];
  cellSource: CellSourceLookup;
}

/** One feature table of the matrix as tiles: a row per feature, a column per VPN. */
export const FeatureTiles = (props: FeatureTilesProps) => (
  <div class="mb-6 max-w-full overflow-x-auto">
    <div
      class="inline-grid gap-1 text-xs"
      style={{
        "grid-template-columns": `16rem repeat(${props.matrix.vpns.length}, 4.75rem)`,
      }}
    >
      <div />
      <For each={props.matrix.vpns}>
        {(vpn) => (
          <div class="self-end pb-1 text-center font-semibold leading-tight">
            {vpn}
          </div>
        )}
      </For>
      <For each={props.features}>
        {(feature) => (
          <>
            <div class="self-center pr-2 text-right text-sm leading-tight">
              {feature}
            </div>
            <For each={props.matrix.rows.get(feature)}>
              {(cell, column) => (
                <MatrixCell
                  cell={cell}
                  label={`${props.matrix.vpns[column()]} · ${feature}`}
                  source={props.cellSource(feature, column())}
                />
              )}
            </For>
          </>
        )}
      </For>
    </div>
  </div>
);
