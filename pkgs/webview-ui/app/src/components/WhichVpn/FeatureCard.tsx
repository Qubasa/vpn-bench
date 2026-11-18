import { For, Show, createMemo } from "solid-js";
import {
  type CellSourceLookup,
  getVpnOverview,
  potentialSecurityConcerns,
} from "@/src/analysisData";
import { MatrixCell } from "../FeatureGrid/MatrixCell";
import { type FeatureMatrix, type Score, percent } from "../FeatureGrid/matrix";
import { type FeatureQuestion, KNOWN_ISSUES } from "./questions";
import { matrixRows, rankFeatures } from "./rank";
import { Card, Caveats, VpnName, WinnerNames, formatNumber } from "./shared";

interface FeatureCardProps {
  question: FeatureQuestion;
  matrix: FeatureMatrix;
  /** VPN directory of every matrix column. */
  columns: readonly string[];
  ineligible: ReadonlyMap<string, string>;
  cellSource: CellSourceLookup;
  /** Run whose source analysis the matrix comes from. */
  alias: string;
}

const scoreText = (score: Score) =>
  `${formatNumber(score.points, score.points % 1 === 0 ? 0 : 1)} / ${score.total}`;

const SecurityFindings = (props: {
  columns: readonly string[];
  alias: string;
}) => {
  const issues = () =>
    KNOWN_ISSUES.filter((issue) => props.columns.includes(issue.vpn));
  const concerns = () =>
    props.columns.map((vpn) => ({
      vpn,
      titles: potentialSecurityConcerns(getVpnOverview(props.alias, vpn) ?? ""),
    }));
  return (
    <>
      <For each={issues()}>
        {(issue) => (
          <div class="mt-3 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            <p class="font-semibold">
              {issue.vpn}: {issue.title} (verified, {issue.severity})
            </p>
            <p>{issue.summary}</p>
            <p class="text-xs">
              Checked at {issue.checked}. Source: {issue.source}.
            </p>
          </div>
        )}
      </For>
      <details class="mt-3 text-sm">
        <summary class="cursor-pointer text-gray-600">
          Potential concerns from the LLM source analysis (unverified)
        </summary>
        <For each={concerns()}>
          {(entry) => (
            <details class="ml-4 mt-1">
              <summary class="cursor-pointer">
                <VpnName vpn={entry.vpn} />: {entry.titles.length} concerns
              </summary>
              <ul class="ml-6 list-disc text-gray-500">
                <For each={entry.titles}>{(title) => <li>{title}</li>}</For>
              </ul>
            </details>
          )}
        </For>
      </details>
    </>
  );
};

export const FeatureCard = (props: FeatureCardProps) => {
  const q = () => props.question;
  const ineligible = createMemo(() => {
    if (!q().security) {
      return props.ineligible;
    }
    const reasons = new Map(props.ineligible);
    for (const issue of KNOWN_ISSUES) {
      if (!reasons.has(issue.vpn)) {
        reasons.set(
          issue.vpn,
          `${issue.severity} vulnerability: ${issue.title}`,
        );
      }
    }
    return reasons;
  });
  const standings = createMemo(() =>
    rankFeatures(
      props.matrix,
      props.columns,
      q().groups.map((g) => g.rows),
      ineligible(),
    ),
  );
  const rows = () => q().groups.flatMap((g) => g.rows);
  const cells = createMemo(() => matrixRows(props.matrix, rows()));

  return (
    <Card title={q().title} question={q().question}>
      <p class="mb-3">
        Winner:{" "}
        <WinnerNames
          vpns={standings()
            .filter((s) => s.winner)
            .map((s) => s.vpn)}
        />
      </p>
      <table class="text-sm">
        <thead>
          <tr class="border-b border-gray-300 text-left text-gray-600">
            <th class="pr-4 font-semibold">VPN</th>
            <For each={q().groups}>
              {(group) => (
                <th class="pr-4 text-right font-semibold">{group.title}</th>
              )}
            </For>
            <th class="pr-4 text-right font-semibold">Score</th>
            <th class="font-semibold">Note</th>
          </tr>
        </thead>
        <tbody>
          <For each={standings()}>
            {(entry) => (
              <tr
                class="border-b border-gray-100"
                classList={{ "font-semibold": entry.winner }}
              >
                <td class="pr-4">
                  <VpnName vpn={entry.vpn} />
                </td>
                <For each={entry.groups}>
                  {(score) => (
                    <td class="pr-4 text-right">{scoreText(score)}</td>
                  )}
                </For>
                <td class="pr-4 text-right">
                  {entry.overall.total === 0
                    ? "–"
                    : `${percent(entry.overall)} %`}
                </td>
                <td class="font-normal text-gray-600">
                  {entry.winner ? "winner" : entry.excluded ?? ""}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <details class="mt-3 text-sm">
        <summary class="cursor-pointer text-gray-600">
          The {rows().length} feature matrix rows behind the score
        </summary>
        <div
          class="mt-2 inline-grid gap-1 text-xs"
          style={{
            "grid-template-columns": `max-content repeat(${props.columns.length}, 2.75rem)`,
          }}
        >
          <div />
          <For each={props.columns}>
            {(vpn) => (
              <div class="flex items-end justify-center pb-1">
                <span
                  style={{
                    "writing-mode": "vertical-rl",
                    transform: "rotate(180deg)",
                  }}
                >
                  <VpnName vpn={vpn} />
                </span>
              </div>
            )}
          </For>
          <For each={rows()}>
            {(feature, row) => (
              <>
                <div class="self-center pr-2 text-right">{feature}</div>
                <For each={props.columns}>
                  {(vpn, column) => (
                    <MatrixCell
                      cell={cells()[row()][column()]}
                      label={`${vpn} · ${feature}`}
                      source={props.cellSource(feature, column())}
                    />
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      </details>
      <Show when={q().security}>
        <SecurityFindings columns={props.columns} alias={props.alias} />
      </Show>
      <Caveats
        items={[
          ...q().caveats,
          "Score: ✓ = 1, ◐ = ½, ✗ = 0 per row; N/A and ? leave the total. The highest share wins and equal shares tie.",
        ]}
      />
    </Card>
  );
};
