/**
 * What `github bottleneck` prints, and the one thing its `--json` document must not omit.
 *
 * The bar scale is asserted against the LARGEST bar rather than the total, because the shape of a backlog
 * with one dominant cause is the whole reason the histogram exists.
 */
import { describe, expect, it } from "vitest";

import { bottleneckDocument, bottleneckLines } from "../../../../../cli/commands/github/bottleneckReport.js";
import { bottleneckReport } from "../../../../../review/bottleneck.js";
import type { LandingRow, LandingTest, LandingTestId, LandingVerdict } from "../../../../../review/landing.js";
import { landingRowFake } from "../../../../landingRowFake.js";

/** Every one of the six tests passing, which is what a case then spoils one field of. */
const ALL_PASS: Readonly<Record<LandingTestId, LandingVerdict>> = {
  "ci-green": "pass",
  "codeowners-satisfied": "pass",
  mergeable: "pass",
  "queue-available": "pass",
  "threads-clear": "pass",
  undrafted: "pass",
};

/** The six tests with the named ones spoiled. */
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

/** One draft, aged, with a base distance — the shape 15 of 24 real rows had. */
function draft({ number, openedIso }: { number: number; openedIso: string }): LandingRow {
  return landingRowFake({
    authorLogin: "acme-renovate",
    baseDistance: { kind: "read", value: { aheadBy: 1, behindBy: 283, status: "BEHIND" } },
    createdAtIso: openedIso,
    number,
    tests: six({ undrafted: "fail" }),
    updatedAtIso: openedIso,
  });
}

describe("bottleneckLines", () => {
  it("leads with the count and the number of distinct causes", () => {
    const report = bottleneckReport({
      nowIso: "2026-09-20T00:00:00.000Z",
      rows: [
        draft({ number: 1, openedIso: "2026-09-14T00:00:00.000Z" }),
        landingRowFake({ number: 2, tests: six({ mergeable: "fail" }) }),
      ],
    });

    expect(bottleneckLines({ report })[0]).toBe("2 open pull request(s), 2 distinct cause(s)");
  });

  it("scales the bars against the biggest one, so a dominant cause is visibly dominant", () => {
    const report = bottleneckReport({
      nowIso: "2026-09-20T00:00:00.000Z",
      rows: [
        draft({ number: 1, openedIso: "2026-09-14T00:00:00.000Z" }),
        draft({ number: 2, openedIso: "2026-09-15T00:00:00.000Z" }),
        draft({ number: 3, openedIso: "2026-09-16T00:00:00.000Z" }),
        draft({ number: 4, openedIso: "2026-09-17T00:00:00.000Z" }),
        landingRowFake({ number: 5, tests: six({ mergeable: "fail" }) }),
      ],
    });

    const lines = bottleneckLines({ report });

    expect(lines[2]).toBe("  draft         ######################## " + "  4  oldest 144h open");
    expect(lines[3]).toBe("  conflicting   ######                   " + "  1  oldest 456h open");
  });

  it("prints both ages, labelled, under the bar the row fell to", () => {
    const report = bottleneckReport({
      nowIso: "2026-09-20T00:00:00.000Z",
      rows: [draft({ number: 662, openedIso: "2026-09-14T00:00:00.000Z" })],
    });

    expect(bottleneckLines({ report })).toContain(
      "    #662 144h open, 144h idle, behind 283 — acme-renovate — it is still a draft, so no sweep " +
        "lists it and no dispatch verdict names it",
    );
  });

  it("says `behind ?` rather than a number when the read did not measure the distance", () => {
    const report = bottleneckReport({
      nowIso: "2026-09-20T00:00:00.000Z",
      rows: [
        landingRowFake({
          baseDistance: { kind: "unread", why: "not asked" },
          number: 9,
          tests: six({ mergeable: "fail" }),
        }),
      ],
    });

    expect(bottleneckLines({ report }).some((line) => line.includes("behind ?"))).toBe(true);
  });

  it("closes on the residue rather than opening with it", () => {
    const lines = bottleneckLines({
      report: bottleneckReport({
        nowIso: "2026-09-20T00:00:00.000Z",
        rows: [draft({ number: 1, openedIso: "2026-09-14T00:00:00.000Z" })],
      }),
    });

    expect(lines.at(-1)).toBe(
      "residue: 1 of 1 row(s) are stated by no handover row, so whether a seat ended without landing is " +
        "UNKNOWN for them — the board join is a declared `branch:` or a run's recorded one and nothing else",
    );
  });

  it("says so in one line when the selection matched nothing, rather than printing an empty histogram", () => {
    expect(bottleneckLines({ report: bottleneckReport({ nowIso: "2026-09-20T00:00:00.000Z", rows: [] }) })).toEqual([
      "no open pull requests matched this selection",
    ]);
  });
});

describe("bottleneckDocument", () => {
  it("carries the selection beside the answer, so a histogram is never read without knowing about drafts", () => {
    const document = bottleneckDocument({
      author: "someone",
      includedDrafts: true,
      nowIso: "2026-09-20T00:00:00.000Z",
      report: bottleneckReport({
        nowIso: "2026-09-20T00:00:00.000Z",
        rows: [draft({ number: 662, openedIso: "2026-09-14T00:00:00.000Z" })],
      }),
      repos: ["lachiejames/slopweaver"],
    });

    expect(document.repos).toEqual(["lachiejames/slopweaver"]);
    expect(document.author).toBe("someone");
    expect(document.includedDrafts).toBe(true);
    expect(document.nowIso).toBe("2026-09-20T00:00:00.000Z");
    expect(document.bars).toEqual([{ cause: "draft", count: 1, numbers: [662], oldestOpenHours: 144 }]);
    expect(document.rows[0]!.number).toBe(662);
  });
});
