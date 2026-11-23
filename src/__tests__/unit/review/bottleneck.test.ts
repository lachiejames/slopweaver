/**
 * The cause ladder, the two ages and the histogram — `../../../review/bottleneck.ts`.
 *
 * Every case here is about a row that fails SEVERAL tests at once, because a single-failure row proves
 * nothing about a tie break and the tie break is the whole argument of the module.
 */
import { describe, expect, it } from "vitest";

import {
  type BottleneckCause,
  bottleneckBars,
  bottleneckReport,
  bottleneckRow,
  CAUSE_LADDER,
} from "../../../review/bottleneck.js";
import type { LandingTest, LandingTestId, LandingVerdict } from "../../../review/landing.js";
import { landingRowFake } from "../../landingRowFake.js";

/** Every one of the six tests passing, which is what a case then spoils one field of. */
const ALL_PASS: Readonly<Record<LandingTestId, LandingVerdict>> = {
  "ci-green": "pass",
  "codeowners-satisfied": "pass",
  mergeable: "pass",
  "queue-available": "pass",
  "threads-clear": "pass",
  undrafted: "pass",
};

/**
 * The six tests, in the row's own order, with the named ones spoiled.
 *
 * @param over the tests this case is about
 * @returns all six, each carrying a `why` naming its own id so a detail assertion is falsifiable
 */
function six(over: Partial<Record<LandingTestId, LandingVerdict>> = {}): readonly LandingTest[] {
  const verdicts = { ...ALL_PASS, ...over };
  const ids: readonly LandingTestId[] = [
    "undrafted",
    "ci-green",
    "mergeable",
    "threads-clear",
    "codeowners-satisfied",
    "queue-available",
  ];
  return ids.map((id) => ({ id, verdict: verdicts[id], why: `${id} said ${verdicts[id]}` }));
}

describe("bottleneckRow", () => {
  it("ranks a draft above its own red CI, so ten drafts read as one mechanism and not ten CI problems", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({ ci: "red", tests: six({ "ci-green": "fail", undrafted: "fail" }) }),
    });

    expect(row.cause).toBe("draft");
    expect(row.detail).toBe("it is still a draft, so no sweep lists it and no dispatch verdict names it");
    expect(row.alsoFailing).toEqual(["undrafted", "ci-green"]);
  });

  it("ranks a conflict above the draft it also is, because the rebase has to happen either way", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({ tests: six({ mergeable: "fail", undrafted: "fail" }) }),
    });

    expect(row.cause).toBe("conflicting");
    expect(row.alsoFailing).toEqual(["undrafted", "mergeable"]);
  });

  it("ranks a queued row above every failure on it, since nothing here is owed", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({
        queue: { kind: "queued", position: 2, state: "MERGEABLE" },
        tests: six({ mergeable: "fail", undrafted: "fail" }),
      }),
    });

    expect(row.cause).toBe("queued");
    expect(row.detail).toBe("GitHub holds entry 2 for it, state MERGEABLE — nothing here to do");
  });

  it("names the code owner GitHub is still holding it for", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({
        blockedOn: ["@acme/platform"],
        tests: six({ "codeowners-satisfied": "fail" }),
      }),
    });

    expect(row.cause).toBe("review-owed");
    expect(row.detail).toBe("GitHub still holds a code-owner request out to @acme/platform");
  });

  it("carries the test's own sentence when the review owed names nobody — a BLOCKED, undecided merge", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({ blockedOn: [], tests: six({ "codeowners-satisfied": "fail" }) }),
    });

    expect(row.cause).toBe("review-owed");
    expect(row.detail).toBe("codeowners-satisfied said fail");
  });

  it("ranks a reviewer thread above the red CI on the same row, because answering is ours to do", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({ ci: "red", tests: six({ "ci-green": "fail", "threads-clear": "fail" }) }),
    });

    expect(row.cause).toBe("threads-open");
    expect(row.detail).toBe("a reviewer thread is waiting on us");
    expect(row.alsoFailing).toEqual(["ci-green", "threads-clear"]);
  });

  it("carries the `ci-green` arm's own sentence when CI is the cause, rather than restating it", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({ ci: "red", tests: six({ "ci-green": "fail" }) }),
    });

    expect(row.cause).toBe("ci-red");
    expect(row.detail).toBe("ci-green said fail");
  });

  it("calls a row whose checks are still running `ci-running` rather than red or clear", () => {
    const row = bottleneckRow({ nowIso: "2026-09-20T00:00:00.000Z", row: landingRowFake({ ci: "running" }) });

    expect(row.cause).toBe("ci-running");
    expect(row.alsoFailing).toEqual([]);
  });

  it("counts a test this read could not answer apart from one anybody can fix", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({ tests: six({ "queue-available": "unknown", "threads-clear": "unknown" }) }),
    });

    expect(row.cause).toBe("unread");
    expect(row.detail).toBe("this read could not answer threads-clear, queue-available");
  });

  it("calls a row that passes every test clear, and carries the act it is waiting for", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({ actionDetail: "press 'Merge when ready'", tests: six() }),
    });

    expect(row.cause).toBe("clear");
    expect(row.detail).toBe("press 'Merge when ready'");
  });

  it("measures the wait from createdAt and the idle time from updatedAt, and they disagree", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({
        createdAtIso: "2026-09-13T00:00:00.000Z",
        tests: six(),
        updatedAtIso: "2026-09-19T20:00:00.000Z",
      }),
    });

    expect(row.openHours).toBe(168);
    expect(row.idleHours).toBe(4);
  });

  it("answers zero hours rather than a negative age when the read's clock sits behind GitHub's stamp", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-01T00:00:00.000Z",
      row: landingRowFake({ createdAtIso: "2026-09-13T00:00:00.000Z", tests: six() }),
    });

    expect(row.openHours).toBe(0);
  });

  it("carries the board row when a doc declared this branch, and the base distance beside it", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({
        baseDistance: { kind: "read", value: { aheadBy: 1, behindBy: 324, status: "BEHIND" } },
        boardRow: { kind: "row", slug: "some-run-291-1", status: "in-flight" },
        tests: six(),
      }),
    });

    expect(row.seat).toEqual({ kind: "row", slug: "some-run-291-1", status: "in-flight" });
    expect(row.behindBy).toBe(324);
  });

  it("leaves behindBy undefined when the read did not measure the base distance", () => {
    const row = bottleneckRow({
      nowIso: "2026-09-20T00:00:00.000Z",
      row: landingRowFake({ baseDistance: { kind: "unread", why: "not asked" }, tests: six() }),
    });

    expect(row.behindBy).toBe(undefined);
  });
});

describe("CAUSE_LADDER", () => {
  it("ranks every cause exactly once, so none falls through to `clear`", () => {
    expect(CAUSE_LADDER.length).toBeGreaterThan(0);
    expect(new Set(CAUSE_LADDER).size).toBe(CAUSE_LADDER.length);
    const expected: readonly BottleneckCause[] = [
      "queued",
      "conflicting",
      "draft",
      "review-owed",
      "threads-open",
      "ci-red",
      "ci-running",
      "unread",
      "clear",
    ];
    expect(CAUSE_LADDER).toEqual(expected);
  });
});

describe("bottleneckBars", () => {
  it("puts the biggest cause first and breaks a tie on the ladder rather than on the name", () => {
    const rows = [
      bottleneckRow({
        nowIso: "2026-09-20T00:00:00.000Z",
        row: landingRowFake({ number: 1, tests: six({ undrafted: "fail" }) }),
      }),
      bottleneckRow({
        nowIso: "2026-09-20T00:00:00.000Z",
        row: landingRowFake({ number: 2, tests: six({ undrafted: "fail" }) }),
      }),
      bottleneckRow({
        nowIso: "2026-09-20T00:00:00.000Z",
        row: landingRowFake({ ci: "red", number: 3, tests: six({ "ci-green": "fail" }) }),
      }),
      bottleneckRow({
        nowIso: "2026-09-20T00:00:00.000Z",
        row: landingRowFake({ number: 4, tests: six({ mergeable: "fail" }) }),
      }),
    ];

    const bars = bottleneckBars({ rows });

    expect(bars.map((bar) => bar.cause)).toEqual(["draft", "conflicting", "ci-red"]);
    expect(bars[0]!.count).toBe(2);
  });

  it("orders a bar's own numbers oldest first and reports that oldest wait", () => {
    const rows = [
      bottleneckRow({
        nowIso: "2026-09-20T00:00:00.000Z",
        row: landingRowFake({ createdAtIso: "2026-09-19T00:00:00.000Z", number: 5, tests: six({ undrafted: "fail" }) }),
      }),
      bottleneckRow({
        nowIso: "2026-09-20T00:00:00.000Z",
        row: landingRowFake({ createdAtIso: "2026-09-10T00:00:00.000Z", number: 6, tests: six({ undrafted: "fail" }) }),
      }),
    ];

    const bars = bottleneckBars({ rows });

    expect(bars[0]!.numbers).toEqual([6, 5]);
    expect(bars[0]!.oldestOpenHours).toBe(240);
  });

  it("omits a cause no row fell to, rather than printing an empty bar", () => {
    const bars = bottleneckBars({
      rows: [bottleneckRow({ nowIso: "2026-09-20T00:00:00.000Z", row: landingRowFake({ tests: six() }) })],
    });

    expect(bars.map((bar) => bar.cause)).toEqual(["clear"]);
  });

  it("answers an empty fleet with no bars at all", () => {
    expect(bottleneckBars({ rows: [] })).toEqual([]);
  });
});

describe("bottleneckReport", () => {
  it("states the undeclared-branch residue rather than reporting a seat absence it cannot establish", () => {
    const report = bottleneckReport({
      nowIso: "2026-09-20T00:00:00.000Z",
      rows: [landingRowFake({ tests: six() }), landingRowFake({ number: 2, tests: six() })],
    });

    expect(report.residue).toEqual([
      "2 of 2 row(s) are stated by no handover row, so whether a seat ended without landing is UNKNOWN for " +
        "them — the board join is a declared `branch:` or a run's recorded one and nothing else",
    ]);
  });

  it("states the unread residue beside the bar, so an unanswerable test is not read as a fixable cause", () => {
    const report = bottleneckReport({
      nowIso: "2026-09-20T00:00:00.000Z",
      rows: [
        landingRowFake({
          boardRow: { kind: "row", slug: "run", status: "in-flight" },
          tests: six({ "queue-available": "unknown" }),
        }),
      ],
    });

    expect(report.residue).toEqual([
      "1 row(s) fell to `unread`: a test this read could not answer is not a cause anybody can fix, and is " +
        "counted apart from one that is",
    ]);
    expect(report.bars.map((bar) => bar.cause)).toEqual(["unread"]);
  });

  it("carries every row measured, keyed to the pull request a reader would open", () => {
    const report = bottleneckReport({
      nowIso: "2026-09-20T00:00:00.000Z",
      rows: [landingRowFake({ tests: six({ undrafted: "fail" }) })],
    });

    expect(report.rows.length).toBe(1);
    expect(report.rows[0]!.number).toBe(16_378);
    expect(report.rows[0]!.url).toBe("https://github.com/acme/widgets/pull/16378");
    expect(report.rows[0]!.authorLogin).toBe("octocat");
    expect(report.rows[0]!.cause).toBe("draft");
  });

  it("answers an empty fleet with no rows, no bars and no residue", () => {
    expect(bottleneckReport({ nowIso: "2026-09-20T00:00:00.000Z", rows: [] })).toEqual({
      bars: [],
      residue: [],
      rows: [],
    });
  });
});
