import { For } from "solid-js";
import { type FeatureMatrix, percent, type Score, scoreMatrix } from "../FeatureGrid/matrix";

interface ScoreCellProps {
  vpn: string;
  label: string;
  score: Score;
  bold?: boolean;
}

/** Red at 0 %, yellow at 50 %, green at 100 %. */
const ScoreCell = (props: ScoreCellProps) => {
  const value = percent(props.score);
  return (
    <div
      class={`flex h-8 items-center justify-center rounded text-gray-900 ${props.bold ? "font-bold" : ""}`}
      style={{ "background-color": `hsl(${Math.round(value * 1.2)} 70% 72%)` }}
      title={`${props.vpn} · ${props.label}: ${props.score.points}/${props.score.total}`}
    >
      {value}%
    </div>
  );
};

/**
 * Score of every VPN per category, computed from the matrix cells, sorted by the
 * shared-rows score (the one with equal denominators for all VPNs).
 */
export const ScoreHeatmap = (props: { matrix: FeatureMatrix }) => {
  const categories = [...props.matrix.categories.keys()];
  const scores = scoreMatrix(props.matrix).sort(
    (a, b) => percent(b.shared) - percent(a.shared) || percent(b.overall) - percent(a.overall),
  );
  return (
    <div class="mb-6 max-w-full overflow-x-auto">
      <div
        class="inline-grid gap-1 text-xs"
        style={{
          "grid-template-columns": `max-content repeat(${categories.length}, 4.75rem) 0.5rem repeat(2, 5.5rem)`,
        }}
      >
        <div />
        <For each={categories}>
          {(category) => (
            <div class="self-end pb-1 text-center font-semibold leading-tight">{category}</div>
          )}
        </For>
        <div />
        <div class="self-end pb-1 text-center font-semibold">Total</div>
        <div class="self-end pb-1 text-center font-semibold">Shared rows</div>
        <For each={scores}>
          {(row) => (
            <>
              <div class="self-center pr-2 text-right text-sm font-semibold">{row.vpn}</div>
              <For each={row.categories}>
                {(score, index) => (
                  <ScoreCell vpn={row.vpn} label={categories[index()]} score={score} />
                )}
              </For>
              <div />
              <ScoreCell vpn={row.vpn} label="Total" score={row.overall} bold />
              <ScoreCell vpn={row.vpn} label="Shared rows" score={row.shared} bold />
            </>
          )}
        </For>
      </div>
    </div>
  );
};
