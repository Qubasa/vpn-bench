import { For, Show, createMemo } from "solid-js";
import type { PairResults } from "@/src/pairResults";
import type { ConditionInfo } from "./MeasuredCard";
import { TEST_LABELS } from "./questions";
import { type Failure, rankReliability } from "./rank";
import { Card, Caveats, VpnName, WinnerNames } from "./shared";

export const ReliabilityCard = (props: {
  results: PairResults;
  ineligible: ReadonlyMap<string, string>;
  conditions: Readonly<Record<string, ConditionInfo>>;
}) => {
  const rows = createMemo(() =>
    rankReliability(props.results, props.ineligible),
  );
  const winners = () => rows().filter((row) => row.winner);
  const label = (condition: string) =>
    props.conditions[condition]?.label ?? condition;
  const always = (failures: Failure[]) =>
    failures
      .filter((f) => f.always)
      .map((f) => TEST_LABELS[f.test])
      .join(", ") || "–";
  const sometimes = (failures: Failure[]) =>
    failures
      .filter((f) => !f.always)
      .map(
        (f) => `${TEST_LABELS[f.test]} (${f.conditions.map(label).join(", ")})`,
      )
      .join("; ") || "–";

  return (
    <Card
      title="Does everything work?"
      question="Which VPN passes every test under every condition?"
    >
      <p class="mb-3">
        Winner: <WinnerNames vpns={winners().map((row) => row.vpn)} />
        <Show when={winners()[0]} keyed>
          {(row) => (
            <>
              , with {row.passed} of {row.total} tests passed.
            </>
          )}
        </Show>
      </p>
      <table class="text-sm">
        <thead>
          <tr class="border-b border-gray-300 text-left text-gray-600">
            <th class="pr-4 font-semibold">VPN</th>
            <th class="pr-4 text-right font-semibold">Passed</th>
            <th class="pr-4 font-semibold">Always fails</th>
            <th class="pr-4 font-semibold">Sometimes fails</th>
            <th class="font-semibold">Note</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(row) => (
              <tr
                class="border-b border-gray-100 align-top"
                classList={{ "font-semibold": row.winner }}
              >
                <td class="pr-4">
                  <VpnName vpn={row.vpn} />
                </td>
                <td class="pr-4 text-right">
                  {row.passed} / {row.total}
                </td>
                <td class="pr-4 text-rose-700">{always(row.failures)}</td>
                <td class="pr-4 text-gray-700">{sometimes(row.failures)}</td>
                <td class="font-normal text-gray-600">
                  {row.winner ? "winner" : row.excluded ?? ""}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Caveats
        items={[
          `A test passes under a condition when every machine pair delivered a result and no TCP pair went ${props.results.stall_seconds} s or more without a byte. A missing result counts as a failure.`,
          "The most passed tests win and equal counts tie. The noise rule does not apply to counts.",
        ]}
      />
    </Card>
  );
};
