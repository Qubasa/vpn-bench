import { describe, expect, it } from "vitest";
import type { PairResult, PairResults, VpnTests } from "@/src/pairResults";
import { parseFeatureMatrix } from "@/src/components/FeatureGrid/matrix";
import {
  type MeasuredRule,
  leaders,
  rankCondition,
  rankFeatures,
  rankReliability,
  unmetRequirements,
  winnerGroup,
} from "@/src/components/WhichVpn/rank";
import {
  FEATURE_QUESTIONS,
  REQUIREMENTS,
} from "@/src/components/WhichVpn/questions";

const ok = (...values: number[]): PairResult[] =>
  values.map((value, i) => ({
    pair: String(i),
    status: "ok",
    metrics: { mbps: value },
  }));

const tcp = (pairs: PairResult[], parallel = ok(1, 1, 1)): VpnTests => ({
  tcp: pairs,
  parallel_tcp: parallel,
});

const RULE: MeasuredRule = {
  test: "tcp",
  metric: "mbps",
  better: "higher",
  gates: [{ test: "parallel_tcp", reason: "parallel failed" }],
};

const none = new Map<string, string>();

describe("winnerGroup", () => {
  it("keeps every VPN whose pair range reaches the best VPN's worst pair", () => {
    const group = winnerGroup(
      [
        { vpn: "A", values: [100, 90, 95] },
        { vpn: "B", values: [80, 91, 85] },
        { vpn: "C", values: [89, 70, 60] },
      ],
      "higher",
    );
    expect([...group].sort()).toEqual(["A", "B"]);
  });

  it("flips the comparison when lower is better", () => {
    const group = winnerGroup(
      [
        { vpn: "A", values: [1, 2] },
        { vpn: "B", values: [2.5, 3] },
        { vpn: "C", values: [2, 4] },
      ],
      "lower",
    );
    expect([...group].sort()).toEqual(["A", "C"]);
  });
});

describe("rankCondition", () => {
  it("rules out failed, stalled, gated and ineligible VPNs but keeps their values", () => {
    const stalled: PairResult = {
      pair: "2",
      status: "stalled",
      metrics: { mbps: 999 },
    };
    const ranking = rankCondition(
      "baseline",
      {
        Fast: tcp(ok(500, 510, 505)),
        Stalls: tcp([...ok(900, 900), stalled]),
        NoParallel: tcp(ok(800, 800, 800), [
          { pair: "0", status: "failed", metrics: {} },
        ]),
        Internal: tcp(ok(950, 950, 950)),
      },
      RULE,
      new Map([["Internal", "reference"]]),
    );
    const byVpn = new Map(ranking.standings.map((s) => [s.vpn, s]));
    expect(ranking.standings.filter((s) => s.winner).map((s) => s.vpn)).toEqual(
      ["Fast"],
    );
    expect(byVpn.get("Stalls")?.excluded).toBe("stalled on 1 of 3 pairs");
    expect(byVpn.get("NoParallel")?.excluded).toBe("parallel failed");
    expect(byVpn.get("Internal")?.excluded).toBe("reference");
    expect(byVpn.get("Internal")?.mean).toBe(950);
    expect(ranking.best).toBe(505);
  });

  it("fails a gate whose metric exceeds its limit on any pair", () => {
    const video = (dropped: number): PairResult => ({
      pair: "0",
      status: "ok",
      metrics: { packets_dropped: dropped },
    });
    const ranking = rankCondition(
      "baseline",
      {
        Clean: { tcp: ok(1), video: [video(0)] },
        Lossy: { tcp: ok(2), video: [video(3)] },
      },
      {
        ...RULE,
        gates: [
          {
            test: "video",
            reason: "lost packets",
            limit: { metric: "packets_dropped", max: 0 },
          },
        ],
      },
      none,
    );
    expect(ranking.standings.map((s) => [s.vpn, s.winner, s.excluded])).toEqual(
      [
        ["Clean", true, undefined],
        ["Lossy", false, "lost packets"],
      ],
    );
  });
});

describe("leaders", () => {
  const conditions = {
    good: { A: tcp(ok(100, 100)), B: tcp(ok(50, 50)) },
    bad: { A: tcp(ok(10, 10)), B: tcp(ok(40, 40)) },
    worse: {
      A: tcp([{ pair: "0", status: "failed", metrics: {} }]),
      B: tcp(ok(5, 5)),
    },
  };
  const rankings = Object.entries(conditions).map(([condition, vpns]) =>
    rankCondition(condition, vpns, RULE, none),
  );

  it("names the most frequent winner and the condition it fails", () => {
    expect(leaders(rankings, "higher")).toEqual([
      {
        vpn: "B",
        wins: 2,
        weakest: { condition: "good", factor: 2, excluded: undefined },
      },
    ]);
  });

  it("keeps a tie and reports an excluded condition as the weakest", () => {
    const tie = leaders(rankings.slice(0, 2), "higher");
    expect(tie.map((l) => l.vpn)).toEqual(["A", "B"]);
    const withFailure = leaders([rankings[0], rankings[2]], "higher");
    expect(withFailure.map((l) => [l.vpn, l.weakest])).toEqual([
      [
        "A",
        {
          condition: "worse",
          factor: undefined,
          excluded: "failed on 1 of 1 pairs",
        },
      ],
      ["B", { condition: "good", factor: 2, excluded: undefined }],
    ]);
  });
});

describe("rankReliability", () => {
  it("counts a missing test as a failure and separates always from sometimes", () => {
    const results: PairResults = {
      stall_seconds: 5,
      conditions: ["good", "bad"],
      results: {
        good: {
          A: { tcp: ok(1), udp: ok(1) },
          B: { tcp: ok(1) },
        },
        bad: {
          A: {
            tcp: [{ pair: "0", status: "stalled", metrics: {} }],
            udp: ok(1),
          },
          B: { tcp: ok(1), udp: ok(1) },
        },
      },
    };
    const rows = rankReliability(results, none);
    expect(rows.map((r) => [r.vpn, r.passed, r.total, r.winner])).toEqual([
      ["A", 3, 4, true],
      ["B", 3, 4, true],
    ]);
    expect(rows[1].failures).toEqual([
      { test: "udp", conditions: ["good"], always: false },
    ]);
  });
});

describe("feature questions", () => {
  const matrix = parseFeatureMatrix(
    [
      "| Feature | A | B | C |",
      "| --- | --- | --- | --- |",
      "| One | ✓ | ◐ | ✓ |",
      "| Two | N/A | ✓ | ✗ |",
      "| Three | ✓ | ✗ | ◐ |",
    ].join("\n"),
  );

  it("ranks by share with N/A out of the total and lets ineligible VPNs not win", () => {
    const standings = rankFeatures(
      matrix,
      ["A", "B", "C"],
      [["One", "Two"], ["Three"]],
      new Map([["A", "critical vulnerability"]]),
    );
    expect(
      standings.map((s) => [
        s.vpn,
        s.overall.points,
        s.overall.total,
        s.winner,
      ]),
    ).toEqual([
      ["B", 1.5, 3, true],
      ["C", 1.5, 3, true],
      ["A", 2, 2, false],
    ]);
  });

  it("treats ◐ as meeting a requirement and ✗ as missing it", () => {
    expect(
      unmetRequirements(
        matrix,
        ["A", "B", "C"],
        [
          { label: "two", feature: "Two" },
          { label: "three", feature: "Three" },
        ],
      ),
    ).toEqual(
      new Map([
        ["A", ["two"]],
        ["B", ["three"]],
        ["C", ["two"]],
      ]),
    );
  });
});

const runMatrices = Object.entries(
  import.meta.glob<string>("@/bench/*/General/feature_matrix.md", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);

describe.each(runMatrices)("feature matrix %s", (_path, markdown) => {
  it("has every row the cards and requirements name", () => {
    const parsed = parseFeatureMatrix(markdown);
    const rows = [
      ...FEATURE_QUESTIONS.flatMap((q) => q.groups.flatMap((g) => g.rows)),
      ...REQUIREMENTS.map((r) => r.feature),
    ];
    expect(rows.filter((row) => !parsed.rows.has(row))).toEqual([]);
  });
});
