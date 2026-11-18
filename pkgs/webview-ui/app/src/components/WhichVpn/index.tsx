import { A } from "@solidjs/router";
import { For, Show, createMemo, createSignal } from "solid-js";
import { useAlias } from "@/src/AliasContext";
import {
  getFeatureMatrix,
  getMatrixAnalysis,
  matrixCellSources,
  matrixVpnDirs,
} from "@/src/analysisData";
import { impairmentPanel } from "@/src/impairment";
import { type PairResults, getPairResults } from "@/src/pairResults";
import { NonMeshNote, nonMeshTag } from "@/src/vpnKind";
import { type FeatureMatrix, parseFeatureMatrix } from "../FeatureGrid/matrix";
import { FeatureCard } from "./FeatureCard";
import { type ConditionInfo, MeasuredCard } from "./MeasuredCard";
import {
  CONDITION_LABELS,
  FEATURE_QUESTIONS,
  MEASURED_QUESTIONS,
  REQUIREMENTS,
} from "./questions";
import { unmetRequirements } from "./rank";
import { ReliabilityCard } from "./ReliabilityCard";

interface Features {
  alias: string;
  matrix: FeatureMatrix;
  columns: string[];
}

const allVpns = (results: PairResults | undefined, features?: Features) =>
  new Set([
    ...Object.values(results?.results ?? {}).flatMap((byVpn) =>
      Object.keys(byVpn),
    ),
    ...(features?.columns ?? []),
  ]);

export const WhichVpnPage = () => {
  const { currentAlias, availableAliases, comparisonData } = useAlias();
  const [required, setRequired] = createSignal<ReadonlySet<string>>(new Set());

  const results = createMemo(() => getPairResults(currentAlias()));

  // The selected run's own matrix, else the newest run that has one
  const features = createMemo((): Features | undefined => {
    const alias = [currentAlias(), ...availableAliases].find(
      (a) => getFeatureMatrix(a) !== undefined,
    );
    const markdown = alias === undefined ? undefined : getFeatureMatrix(alias);
    if (alias === undefined || markdown === undefined) {
      return undefined;
    }
    return {
      alias,
      matrix: parseFeatureMatrix(markdown),
      columns: matrixVpnDirs(alias),
    };
  });

  const ineligible = createMemo(() => {
    const feats = features();
    const requirements = REQUIREMENTS.filter((r) => required().has(r.feature));
    const unmet =
      feats === undefined
        ? new Map<string, string[]>()
        : unmetRequirements(feats.matrix, feats.columns, requirements);
    const reasons = new Map<string, string>();
    for (const vpn of allVpns(results(), feats)) {
      const tag = nonMeshTag(vpn);
      const labels = unmet.get(vpn);
      if (tag !== undefined) {
        reasons.set(vpn, `reference (${tag})`);
      } else if (
        requirements.length > 0 &&
        !(feats?.columns.includes(vpn) ?? false)
      ) {
        reasons.set(vpn, "not in the feature matrix");
      } else if (labels !== undefined) {
        reasons.set(vpn, `lacks ${labels.join(", ")}`);
      }
    }
    return reasons;
  });

  const conditions = createMemo(() => {
    const info: Record<string, ConditionInfo> = {};
    for (const condition of results()?.conditions ?? []) {
      const panel = impairmentPanel(comparisonData()[condition]?.tcSettings);
      info[condition] = {
        label: CONDITION_LABELS[condition] ?? condition,
        detail:
          panel === null
            ? "No emulated impairment."
            : `${panel.tiles.map((t) => `${t.label} ${t.value} ${t.detail}`).join(", ")}.`,
      };
    }
    return info;
  });

  const toggle = (feature: string, on: boolean) => {
    const next = new Set(required());
    if (on) {
      next.add(feature);
    } else {
      next.delete(feature);
    }
    setRequired(next);
  };

  return (
    <div class="max-w-6xl p-6">
      <h1 class="mb-2 text-2xl font-bold">Which VPN for …?</h1>
      <p class="mb-2 max-w-3xl text-sm text-gray-700">
        Every answer below is computed from this run's measurements and the
        feature matrix, without hand-picked winners. A VPN beats another only if
        it is better on every machine pair. The winner group is the best VPN
        plus every VPN it does not beat, so close results share the win.
      </p>
      <NonMeshNote />

      <fieldset class="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <legend class="px-1 font-semibold">Requirements</legend>
        <p class="mb-2 text-xs text-gray-600">
          A VPN that lacks a checked feature cannot win any card. ◐ in the
          feature matrix counts as present.
        </p>
        <div class="flex flex-wrap gap-4 text-sm">
          <For each={REQUIREMENTS}>
            {(requirement) => (
              <label class="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={required().has(requirement.feature)}
                  onChange={(e) =>
                    toggle(requirement.feature, e.currentTarget.checked)
                  }
                />
                {requirement.label}
              </label>
            )}
          </For>
        </div>
      </fieldset>

      <h2 class="mb-1 text-xl font-semibold">Measured in this run</h2>
      <p class="mb-3 text-sm text-gray-600">
        Each card ranks every network condition of the run separately. Open a
        condition for the numbers of every VPN and the range over its machine
        pairs. The headline names the VPN that wins the most conditions and
        where it does worst.
      </p>
      <Show
        when={results()}
        keyed
        fallback={
          <p class="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
            This run has no General/pair_results.json. Run{" "}
            <code>vpb compare</code> to create it.
          </p>
        }
      >
        {(run) => (
          <>
            <For each={MEASURED_QUESTIONS}>
              {(question) => (
                <MeasuredCard
                  question={question}
                  results={run}
                  ineligible={ineligible()}
                  conditions={conditions()}
                />
              )}
            </For>
            <ReliabilityCard
              results={run}
              ineligible={ineligible()}
              conditions={conditions()}
            />
          </>
        )}
      </Show>

      <h2 class="mb-1 text-xl font-semibold">From the source analysis</h2>
      <Show
        when={features()}
        keyed
        fallback={
          <p class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
            No run has a feature matrix yet. Run <code>vpb analyze</code> to
            create one.
          </p>
        }
      >
        {(feats) => (
          <>
            <p class="mb-3 text-sm text-gray-600">
              These cards do not depend on the network. They score rows of the{" "}
              <A class="underline" href="/feature-matrix">
                feature matrix
              </A>{" "}
              of run {feats.alias}
              <Show when={getMatrixAnalysis(feats.alias)} keyed>
                {(analysis) => (
                  <>
                    , written by {analysis.model} on {analysis.date}
                  </>
                )}
              </Show>
              . It describes the VPN versions of that run, which can differ from
              the versions measured above, and it is LLM output that may contain
              mistakes.
            </p>
            <For each={FEATURE_QUESTIONS}>
              {(question) => (
                <FeatureCard
                  question={question}
                  matrix={feats.matrix}
                  columns={feats.columns}
                  ineligible={ineligible()}
                  cellSource={matrixCellSources(feats.alias)}
                  alias={feats.alias}
                />
              )}
            </For>
          </>
        )}
      </Show>
    </div>
  );
};
