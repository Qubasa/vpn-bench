import type {
  PairResult,
  PairResults,
  TestId,
  VpnTests,
} from "@/src/pairResults";
import {
  type Cell,
  type FeatureMatrix,
  type Score,
  scoreCells,
} from "../FeatureGrid/matrix";

export type Better = "higher" | "lower";

export interface Gate {
  test: TestId;
  /** Why a VPN that does not pass this test cannot win. */
  reason: string;
  /** Every pair must keep this metric at or below `max`. */
  limit?: { metric: string; max: number };
}

export interface MeasuredRule {
  test: TestId;
  metric: string;
  better: Better;
  gates: readonly Gate[];
}

export interface Standing {
  vpn: string;
  /** One value per machine pair, when every pair delivered one. */
  values: number[] | undefined;
  mean: number | undefined;
  /** Why the VPN cannot win, if it cannot. */
  excluded: string | undefined;
  winner: boolean;
}

export interface ConditionRanking {
  condition: string;
  /** Winners first, then the other VPNs by mean, then those without a value. */
  standings: Standing[];
  /** Mean of the best VPN that can win. */
  best: number | undefined;
}

interface Measured {
  vpn: string;
  values: readonly number[];
}

const average = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Flips lower-is-better values so that larger is always better. */
const sign = (better: Better): number => (better === "higher" ? 1 : -1);

/**
 * The thesis noise rule: A beats B only if every pair of A is better than every
 * pair of B. The winner group is the VPN with the best mean plus every VPN that
 * it does not beat.
 */
export function winnerGroup(
  entries: readonly Measured[],
  better: Better,
): Set<string> {
  const s = sign(better);
  let best: Measured | undefined;
  for (const entry of entries) {
    if (
      best === undefined ||
      s * average(entry.values) > s * average(best.values)
    ) {
      best = entry;
    }
  }
  if (best === undefined) {
    return new Set();
  }
  const bestWorstPair = Math.min(...best.values.map((value) => s * value));
  return new Set(
    entries
      .filter(
        (entry) =>
          Math.max(...entry.values.map((value) => s * value)) >= bestWorstPair,
      )
      .map((entry) => entry.vpn),
  );
}

/** Undefined when every pair delivered, else what went wrong. */
export function pairProblem(
  pairs: readonly PairResult[] | undefined,
): string | undefined {
  if (pairs === undefined || pairs.length === 0) {
    return "not measured";
  }
  const failed = pairs.filter((pair) => pair.status === "failed").length;
  const stalled = pairs.filter((pair) => pair.status === "stalled").length;
  const problems = [
    failed > 0 ? `failed on ${failed}` : "",
    stalled > 0 ? `stalled on ${stalled}` : "",
  ].filter((problem) => problem !== "");
  return problems.length === 0
    ? undefined
    : `${problems.join(", ")} of ${pairs.length} pairs`;
}

function gateProblem(tests: VpnTests, gate: Gate): string | undefined {
  const pairs = tests[gate.test];
  if (pairs === undefined || pairProblem(pairs) !== undefined) {
    return gate.reason;
  }
  const limit = gate.limit;
  const overLimit =
    limit !== undefined &&
    pairs.some((pair) => (pair.metrics[limit.metric] ?? Infinity) > limit.max);
  return overLimit ? gate.reason : undefined;
}

/** The metric of every pair, or undefined if a pair lacks it. */
export function metricValues(
  pairs: readonly PairResult[],
  metric: string,
): number[] | undefined {
  const values: number[] = [];
  for (const pair of pairs) {
    const value = pair.metrics[metric];
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  return values;
}

function standing(
  vpn: string,
  tests: VpnTests,
  rule: MeasuredRule,
  ineligible: ReadonlyMap<string, string>,
): Standing {
  const pairs = tests[rule.test];
  const problem = pairProblem(pairs);
  const values =
    problem === undefined && pairs !== undefined
      ? metricValues(pairs, rule.metric)
      : undefined;
  let excluded = ineligible.get(vpn) ?? problem;
  if (excluded === undefined && values === undefined) {
    excluded = "not measured";
  }
  for (const gate of rule.gates) {
    excluded ??= gateProblem(tests, gate);
  }
  return {
    vpn,
    values,
    mean: values === undefined ? undefined : average(values),
    excluded,
    winner: false,
  };
}

/** Ranks every VPN of one condition; ineligible VPNs keep their values for reference. */
export function rankCondition(
  condition: string,
  vpns: Readonly<Record<string, VpnTests>>,
  rule: MeasuredRule,
  ineligible: ReadonlyMap<string, string>,
): ConditionRanking {
  const standings = Object.entries(vpns).map(([vpn, tests]) =>
    standing(vpn, tests, rule, ineligible),
  );
  const candidates: Measured[] = [];
  for (const entry of standings) {
    if (entry.excluded === undefined && entry.values !== undefined) {
      candidates.push({ vpn: entry.vpn, values: entry.values });
    }
  }
  const winners = winnerGroup(candidates, rule.better);
  const s = sign(rule.better);
  let best: number | undefined;
  for (const entry of standings) {
    entry.winner = winners.has(entry.vpn);
    if (entry.excluded === undefined && entry.mean !== undefined) {
      best =
        best === undefined
          ? entry.mean
          : s * Math.max(s * best, s * entry.mean);
    }
  }
  const order = (entry: Standing): number =>
    entry.winner
      ? 0
      : entry.excluded === undefined
        ? 1
        : entry.mean === undefined
          ? 3
          : 2;
  standings.sort(
    (a, b) =>
      order(a) - order(b) ||
      s * ((b.mean ?? 0) - (a.mean ?? 0)) ||
      a.vpn.localeCompare(b.vpn),
  );
  return { condition, standings, best };
}

export interface Weakness {
  condition: string;
  /** How many times worse than the best VPN of that condition, at least 1. */
  factor: number | undefined;
  /** Why the VPN could not win that condition. */
  excluded: string | undefined;
}

export interface Leader {
  vpn: string;
  wins: number;
  /** The condition where the VPN did worst, undefined if it won every one. */
  weakest: Weakness | undefined;
}

function weakest(
  vpn: string,
  rankings: readonly ConditionRanking[],
  better: Better,
): Weakness | undefined {
  let worst: Weakness | undefined;
  for (const ranking of rankings) {
    const entry = ranking.standings.find((s) => s.vpn === vpn);
    if (entry?.winner) {
      continue;
    }
    if (
      entry === undefined ||
      entry.excluded !== undefined ||
      entry.mean === undefined ||
      ranking.best === undefined
    ) {
      return {
        condition: ranking.condition,
        factor: undefined,
        excluded: entry?.excluded ?? "not measured",
      };
    }
    const factor =
      better === "higher"
        ? ranking.best / entry.mean
        : entry.mean / ranking.best;
    if (worst?.factor === undefined || factor > worst.factor) {
      worst = { condition: ranking.condition, factor, excluded: undefined };
    }
  }
  return worst;
}

/** The VPNs in the winner group of the most conditions; a tie stays a tie. */
export function leaders(
  rankings: readonly ConditionRanking[],
  better: Better,
): Leader[] {
  const wins = new Map<string, number>();
  for (const ranking of rankings) {
    for (const entry of ranking.standings) {
      if (entry.winner) {
        wins.set(entry.vpn, (wins.get(entry.vpn) ?? 0) + 1);
      }
    }
  }
  const most = Math.max(0, ...wins.values());
  return [...wins]
    .filter(([, count]) => count === most)
    .map(([vpn, count]) => ({
      vpn,
      wins: count,
      weakest: weakest(vpn, rankings, better),
    }))
    .sort((a, b) => a.vpn.localeCompare(b.vpn));
}

export interface Failure {
  test: TestId;
  conditions: string[];
  /** Failed in every condition that ran this test. */
  always: boolean;
}

export interface Reliability {
  vpn: string;
  passed: number;
  total: number;
  failures: Failure[];
  excluded: string | undefined;
  winner: boolean;
}

/**
 * Counts the tests every VPN passed in every condition. A test passes when every
 * pair delivered without stalling. A VPN without a result for a test that others
 * ran in that condition fails it.
 */
export function rankReliability(
  results: PairResults,
  ineligible: ReadonlyMap<string, string>,
): Reliability[] {
  const vpns = new Set<string>();
  const testRuns = new Map<TestId, number>();
  for (const condition of results.conditions) {
    const byVpn = results.results[condition] ?? {};
    const tests = new Set<TestId>();
    for (const [vpn, vpnTests] of Object.entries(byVpn)) {
      vpns.add(vpn);
      for (const test of Object.keys(vpnTests) as TestId[]) {
        tests.add(test);
      }
    }
    for (const test of tests) {
      testRuns.set(test, (testRuns.get(test) ?? 0) + 1);
    }
  }

  const rows = [...vpns].sort().map((vpn): Reliability => {
    const failed = new Map<TestId, string[]>();
    for (const condition of results.conditions) {
      const byVpn = results.results[condition] ?? {};
      const tests = new Set(
        Object.values(byVpn).flatMap((t) => Object.keys(t) as TestId[]),
      );
      for (const test of tests) {
        if (pairProblem(byVpn[vpn]?.[test]) !== undefined) {
          failed.set(test, [...(failed.get(test) ?? []), condition]);
        }
      }
    }
    const total = [...testRuns.values()].reduce((sum, n) => sum + n, 0);
    const failures = [...failed].map(([test, conditions]) => ({
      test,
      conditions,
      always: conditions.length === testRuns.get(test),
    }));
    const failedCount = failures.reduce(
      (sum, f) => sum + f.conditions.length,
      0,
    );
    return {
      vpn,
      passed: total - failedCount,
      total,
      failures,
      excluded: ineligible.get(vpn),
      winner: false,
    };
  });

  const most = Math.max(
    ...rows.filter((r) => r.excluded === undefined).map((r) => r.passed),
  );
  for (const row of rows) {
    row.winner = row.excluded === undefined && row.passed === most;
  }
  return rows.sort(
    (a, b) =>
      Number(b.winner) - Number(a.winner) ||
      Number(a.excluded !== undefined) - Number(b.excluded !== undefined) ||
      b.passed - a.passed ||
      a.vpn.localeCompare(b.vpn),
  );
}

export interface FeatureStanding {
  vpn: string;
  groups: Score[];
  overall: Score;
  excluded: string | undefined;
  winner: boolean;
}

/** Looks up matrix rows by name; a renamed or removed row throws. */
export function matrixRows(
  matrix: FeatureMatrix,
  features: readonly string[],
): (readonly Cell[])[] {
  return features.map((feature) => {
    const cells = matrix.rows.get(feature);
    if (cells === undefined) {
      throw new Error(`feature_matrix.md has no row "${feature}"`);
    }
    return cells;
  });
}

/** points / total of a against b, without rounding; an empty score counts as 0. */
const compareScores = (a: Score, b: Score): number =>
  (a.total === 0 ? 0 : a.points) * (b.total === 0 ? 1 : b.total) -
  (b.total === 0 ? 0 : b.points) * (a.total === 0 ? 1 : a.total);

/**
 * Scores every matrix column over the given row groups. The VPNs with the highest
 * overall share win; equal shares tie.
 */
export function rankFeatures(
  matrix: FeatureMatrix,
  columns: readonly string[],
  groups: readonly (readonly string[])[],
  ineligible: ReadonlyMap<string, string>,
): FeatureStanding[] {
  const groupRows = groups.map((features) => matrixRows(matrix, features));
  const standings = columns.map((vpn, column): FeatureStanding => {
    const groupScores = groupRows.map((rows) =>
      scoreCells(rows.map((cells) => cells[column])),
    );
    return {
      vpn,
      groups: groupScores,
      overall: scoreCells(groupRows.flat().map((cells) => cells[column])),
      excluded: ineligible.get(vpn),
      winner: false,
    };
  });
  let best: Score | undefined;
  for (const entry of standings) {
    if (
      entry.excluded === undefined &&
      (best === undefined || compareScores(entry.overall, best) > 0)
    ) {
      best = entry.overall;
    }
  }
  for (const entry of standings) {
    entry.winner =
      best !== undefined &&
      entry.excluded === undefined &&
      compareScores(entry.overall, best) === 0;
  }
  return standings.sort(
    (a, b) =>
      Number(b.winner) - Number(a.winner) ||
      Number(a.excluded !== undefined) - Number(b.excluded !== undefined) ||
      compareScores(b.overall, a.overall) ||
      a.vpn.localeCompare(b.vpn),
  );
}

export interface Requirement {
  label: string;
  /** Matrix row; ✓ and ◐ meet the requirement. */
  feature: string;
}

/** VPN directory → labels of the requirements its matrix column does not meet. */
export function unmetRequirements(
  matrix: FeatureMatrix,
  columns: readonly string[],
  requirements: readonly Requirement[],
): Map<string, string[]> {
  const rows = matrixRows(
    matrix,
    requirements.map((r) => r.feature),
  );
  const unmet = new Map<string, string[]>();
  columns.forEach((vpn, column) => {
    const labels = requirements
      .filter((_, i) => !["yes", "partial"].includes(rows[i][column]))
      .map((r) => r.label);
    if (labels.length > 0) {
      unmet.set(vpn, labels);
    }
  });
  return unmet;
}
