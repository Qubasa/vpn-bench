import { For, Show, createMemo } from "solid-js";
import type { PairResults } from "@/src/pairResults";
import { vpnKind } from "@/src/vpnKind";
import type { Extra, MeasuredQuestion } from "./questions";
import {
  type ConditionRanking,
  type Leader,
  type Standing,
  leaders,
  metricValues,
  pairProblem,
  rankCondition,
} from "./rank";
import { Card, Caveats, VpnName, WinnerNames, formatNumber } from "./shared";

export interface ConditionInfo {
  label: string;
  /** The emulated impairment, from tc_settings.json. */
  detail: string;
}

interface MeasuredCardProps {
  question: MeasuredQuestion;
  results: PairResults;
  ineligible: ReadonlyMap<string, string>;
  conditions: Readonly<Record<string, ConditionInfo>>;
}

const GRID = "minmax(11rem, 1fr) 2fr minmax(12rem, 1fr)";

export const MeasuredCard = (props: MeasuredCardProps) => {
  const q = () => props.question;
  const conditions = () => {
    const only = q().conditions;
    return only === undefined
      ? props.results.conditions
      : props.results.conditions.filter((c) => only.includes(c));
  };
  const rankings = createMemo(() =>
    conditions().map((condition) =>
      rankCondition(
        condition,
        props.results.results[condition] ?? {},
        q().rule,
        props.ineligible,
      ),
    ),
  );
  const top = createMemo(() => leaders(rankings(), q().rule.better));
  const label = (condition: string) =>
    props.conditions[condition]?.label ?? condition;
  const value = (v: number | undefined) =>
    v === undefined ? "–" : formatNumber(v, q().digits);

  const weakness = (leader: Leader) => {
    const weak = leader.weakest;
    if (weak === undefined) {
      return `${leader.vpn} is in the winner group under every condition.`;
    }
    if (weak.factor === undefined) {
      return `${leader.vpn} is weakest at ${label(weak.condition)}: ${weak.excluded}.`;
    }
    const gap =
      q().rule.better === "higher"
        ? `${Math.round(100 / weak.factor)} % of the best`
        : `${formatNumber(weak.factor, 1)}× the best`;
    return `${leader.vpn} is weakest at ${label(weak.condition)} (${gap}).`;
  };

  const extraMean = (condition: string, vpn: string, extra: Extra) => {
    const pairs = props.results.results[condition]?.[vpn]?.[extra.test];
    const values =
      pairs === undefined || pairProblem(pairs) !== undefined
        ? undefined
        : metricValues(pairs, extra.metric);
    return values === undefined
      ? "–"
      : formatNumber(
          values.reduce((sum, v) => sum + v, 0) / values.length,
          extra.digits,
        );
  };

  const range = (entry: Standing) =>
    entry.values === undefined
      ? "–"
      : `${value(Math.min(...entry.values))}–${value(Math.max(...entry.values))}`;

  const references = (ranking: ConditionRanking) =>
    ranking.standings.filter((s) => vpnKind(s.vpn) !== "mesh");

  const measured = () =>
    rankings().some((r) => r.standings.some((s) => s.values !== undefined));

  return (
    <Card title={q().title} question={q().question}>
      <Show
        when={top().length > 0}
        fallback={
          <p class="mb-3 font-medium">
            {measured()
              ? "No mesh VPN delivered a usable result in this run."
              : "This run did not measure it."}
          </p>
        }
      >
        <p class="mb-1">
          {rankings().length > 1 ? "Winner across conditions: " : "Winner: "}
          <WinnerNames vpns={top().map((l) => l.vpn)} />
          <Show when={rankings().length > 1}>
            , in the winner group under {top()[0].wins} of {rankings().length}{" "}
            conditions.
          </Show>
        </p>
        <Show when={rankings().length > 1}>
          <ul class="mb-3 text-sm text-gray-700">
            <For each={top()}>{(leader) => <li>{weakness(leader)}</li>}</For>
          </ul>
        </Show>
      </Show>

      <div class="text-sm">
        <div
          class="grid gap-2 border-b border-gray-300 pb-1 pl-5 font-semibold text-gray-600"
          style={{ "grid-template-columns": GRID }}
        >
          <span>Condition</span>
          <span>Winner group</span>
          <span>Reference ({q().unit})</span>
        </div>
        <For each={rankings()}>
          {(ranking) => (
            <details class="border-b border-gray-100">
              <summary class="cursor-pointer py-1">
                <span
                  class="inline-grid w-[calc(100%-1.5rem)] gap-2 align-top"
                  style={{ "grid-template-columns": GRID }}
                >
                  <span title={props.conditions[ranking.condition]?.detail}>
                    {label(ranking.condition)}
                  </span>
                  <span>
                    <WinnerNames
                      vpns={ranking.standings
                        .filter((s) => s.winner)
                        .map((s) => s.vpn)}
                    />
                  </span>
                  <span class="text-gray-500">
                    {references(ranking)
                      .map((s) => `${s.vpn} ${value(s.mean)}`)
                      .join(" · ") || "–"}
                  </span>
                </span>
              </summary>
              <p class="mb-1 ml-5 text-xs text-gray-500">
                {props.conditions[ranking.condition]?.detail}
              </p>
              <table class="mb-3 ml-5 text-sm">
                <thead>
                  <tr class="text-left text-gray-500">
                    <th class="pr-4 font-medium">VPN</th>
                    <th class="pr-4 text-right font-medium">
                      Mean ({q().unit})
                    </th>
                    <th class="pr-4 text-right font-medium">Pair range</th>
                    <For each={q().extras}>
                      {(extra) => (
                        <th class="pr-4 text-right font-medium">
                          {extra.label}
                        </th>
                      )}
                    </For>
                    <th class="font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={ranking.standings}>
                    {(entry) => (
                      <tr classList={{ "font-semibold": entry.winner }}>
                        <td class="pr-4">
                          <VpnName vpn={entry.vpn} />
                        </td>
                        <td class="pr-4 text-right">{value(entry.mean)}</td>
                        <td class="pr-4 text-right text-gray-500">
                          {range(entry)}
                        </td>
                        <For each={q().extras}>
                          {(extra) => (
                            <td class="pr-4 text-right text-gray-600">
                              {extraMean(ranking.condition, entry.vpn, extra)}
                            </td>
                          )}
                        </For>
                        <td class="font-normal text-gray-600">
                          {entry.winner
                            ? "winner group"
                            : entry.excluded ?? "beaten on every pair"}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </details>
          )}
        </For>
      </div>
      <Caveats
        items={[
          ...q().caveats,
          `Each VPN ran between the same three machine pairs. A TCP pair without a byte for ${props.results.stall_seconds} s or more counts as stalled, and a VPN that failed or stalled on any pair cannot win that condition.`,
        ]}
      />
    </Card>
  );
};
