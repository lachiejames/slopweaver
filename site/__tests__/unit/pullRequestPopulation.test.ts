/*
 * The Pull requests badge and the page's Everything list count ONE population, drafts included, because a badge and
 * a list counting two different things is a defect. A number is printed only over a reading that read drafts and
 * reconciles with GitHub's own open list; otherwise no number, and an empty list explains itself rather than
 * claiming zero, since an explanation beats nothing.
 */
import { describe, expect, it } from "vitest";

import type { LandingReading } from "../../components/live/readLanding";
import { prRowsForView } from "../../lib/prViews";
import { pullRequestCountOf } from "../../lib/pullRequestEmptyDraw";
import {
  type PullRequestPopulation,
  pullRequestPopulationOf,
  badgeRedrawAtOf as redrawAtOf,
} from "../../lib/pullRequestPopulation";
import { ACME_PLACER, FIXTURE_SELF_REPOSITORY } from "../organisationFixture";
import {
  acmeCensus,
  acmeRow,
  landingReading,
  NOW_MS,
  openPr,
  uncensusedRow,
  WITH_DRAFTS,
  WITHOUT_DRAFTS,
} from "./landingReadingFixture";

const populationOf = ({ reading }: { reading: LandingReading }): PullRequestPopulation =>
  pullRequestPopulationOf({ context: "work", nowMs: NOW_MS, placer: ACME_PLACER, reading });

/** The fields a not-measured population says itself with, so one assertion names all three. */
const unmeasured = ({ population }: { population: PullRequestPopulation }): readonly unknown[] => {
  const held = population as Extract<PullRequestPopulation, { phase: "not-measured" }>;
  return [held.phase, held.gap, held.why];
};

const CURRENT = { phase: "current" } as const;

describe("pullRequestPopulationOf", () => {
  it("counts the rows Everything lists, a draft included, as the badge's number", () => {
    const rows = [acmeRow({ number: 1 }), acmeRow({ action: "draft", number: 2 })];
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ draft: true, number: 2 })] }),
        rows,
        selection: WITH_DRAFTS,
      }),
    });
    expect(population.phase).toBe("measured");
    const measured = population as Extract<PullRequestPopulation, { phase: "measured" }>;
    expect(measured.count).toStrictEqual({
      count: 2,
      title:
        "your open pull requests in this context, drafts included: the cards the Pull requests page lists under Everything",
    });
    const everything = prRowsForView({ picked: new Set(), priorities: new Map(), rows: measured.rows, view: "all" });
    expect(everything.length).toBe(measured.count.count);
    expect(measured.rows.map((row) => row.number)).toStrictEqual([1, 2]);
  });

  it("prints no number over a reading taken without drafts, its rows still drawn", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ draft: true, number: 2 })] }),
        rows: [acmeRow({ number: 1 })],
        selection: WITHOUT_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "drafts-excluded",
      "the reading shown was taken without drafts, so it cannot count every open pull request of yours",
    ]);
    expect(population.rows.map((row) => row.number)).toStrictEqual([1]);
  });

  it("keeps the census's own reason and still names the drafts gap when a reading records no selection", () => {
    const population = populationOf({
      reading: landingReading({ census: acmeCensus({ prs: [] }), rows: [], selection: undefined }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "drafts-excluded",
      "this reading records no repository selection, so its census cannot be checked against one and no count is claimed",
    ]);
  });

  it("keeps an unread census's reason with no gap, since a fresh reading is the census's repair", () => {
    const population = populationOf({
      reading: landingReading({
        census: [{ kind: "unread", repo: "acme/acme-admin", why: "GitHub answered 502" }],
        rows: [acmeRow({ number: 1 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      undefined,
      [
        {
          lead: "GitHub's open list for acme/acme-admin could not be read",
          subject: "GitHub's open list for acme/acme-admin",
          why: "GitHub answered 502",
        },
      ],
    ]);
  });

  it("prints no number when GitHub lists an open pull request of the owner's that no row carries", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ number: 2 })] }),
        rows: [acmeRow({ number: 1 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "rows-short",
      "the reading shown does not reconcile with GitHub's open list: GitHub lists 1 of your open pull requests here that none of its rows carries",
    ]);
  });

  it("prints no number when a row is one GitHub no longer lists open", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 })] }),
        rows: [acmeRow({ number: 1 }), acmeRow({ number: 3 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "rows-short",
      "the reading shown does not reconcile with GitHub's open list: 1 of its rows GitHub no longer lists open",
    ]);
  });

  it("prints no number over a census with no entry for a repository the reading was taken over", () => {
    const population = populationOf({
      reading: landingReading({ census: [], rows: [acmeRow({ number: 1 })], selection: WITH_DRAFTS }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      undefined,
      "this reading was taken over acme/acme-admin but its census does not count it, so no count is claimed",
    ]);
  });

  it("prints no number when one pull request is drawn as two rows, though the census's join by key matches", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 })] }),
        rows: [acmeRow({ number: 1 }), acmeRow({ number: 1 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "rows-short",
      "the reading shown does not reconcile with GitHub's open list: 1 of its rows repeat a pull request another row already carries",
    ]);
    expect(pullRequestCountOf({ latest: CURRENT, population }).phase).toBe("withheld");
    expect(population.rows.length).toBe(2);
  });

  it("prints no number for a row in a repository the census holds no entry for, outside the reading's selection", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 })] }),
        rows: [acmeRow({ number: 1 }), uncensusedRow({ number: 7 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "rows-short",
      "the reading shown does not reconcile with GitHub's open list: 1 of its rows are in a repository whose open list it did not read",
    ]);
    expect(population.rows.length).toBe(2);
  });

  it("prints no number for a row GitHub lists open but by an author the reading was not taken over", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 }), { ...openPr({ number: 4 }), author: "wile-e" }] }),
        rows: [acmeRow({ number: 1 }), acmeRow({ number: 4 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "rows-short",
      "the reading shown does not reconcile with GitHub's open list: 1 of its rows are by an author the reading was not taken over",
    ]);
  });

  it("names every way the rows differ at once, in one sentence", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ number: 2 })] }),
        rows: [acmeRow({ number: 1 }), acmeRow({ number: 1 }), acmeRow({ number: 3 }), uncensusedRow({ number: 7 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "rows-short",
      "the reading shown does not reconcile with GitHub's open list: 1 of its rows repeat a pull request another row already carries, and GitHub lists 1 of your open pull requests here that none of its rows carries, and 1 of its rows GitHub no longer lists open, and 1 of its rows are in a repository whose open list it did not read",
    ]);
  });

  it("counts an exact match, whatever order the rows come in", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ draft: true, number: 2 }), openPr({ number: 3 })] }),
        rows: [acmeRow({ number: 3 }), acmeRow({ action: "draft", number: 2 }), acmeRow({ number: 1 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(population.phase).toBe("measured");
    const measured = population as Extract<PullRequestPopulation, { phase: "measured" }>;
    expect(measured.count.count).toBe(3);
  });

  it("prints no number over a census older than the landing cadence", () => {
    const old = "2026-11-03T20:29:00.000Z";
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 })], startedAtIso: old }),
        observedAtIso: old,
        rows: [acmeRow({ number: 1 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      undefined,
      "the reading it counts is 31 minutes old, past the 30-minute landing cadence",
    ]);
  });

  it("names the rows-short gap over an old reading too, read off its own contents and not its age", () => {
    const old = "2026-11-03T20:29:00.000Z";
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 }), openPr({ number: 2 })], startedAtIso: old }),
        observedAtIso: old,
        rows: [acmeRow({ number: 1 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(unmeasured({ population })).toStrictEqual([
      "not-measured",
      "rows-short",
      "the reading shown does not reconcile with GitHub's open list: GitHub lists 1 of your open pull requests here that none of its rows carries",
    ]);
    // The age still withholds the census's own count on the page.
    expect(population.picture.kind).toBe("unavailable");
  });
});

describe("badgeRedrawAtOf — the badge's display-only deadline", () => {
  const badgeRedrawAtOf = ({ reading, nowMs }: { reading: LandingReading; nowMs: number }): number | undefined =>
    redrawAtOf({ context: "work", nowMs, placer: ACME_PLACER, reading });
  const reading = landingReading({
    census: acmeCensus({ prs: [openPr({ number: 1 })] }),
    rows: [acmeRow({ number: 1 })],
    selection: WITH_DRAFTS,
  });
  /** Thirty minutes and a millisecond past the census's read at FRESH_ISO. */
  const CUTOFF = Date.parse("2026-11-03T21:20:00.001Z");

  it("is the first millisecond the count is withheld for age: counted just before it, withheld at it", () => {
    expect(badgeRedrawAtOf({ nowMs: NOW_MS, reading })).toBe(CUTOFF);
    const at = ({ nowMs }: { nowMs: number }): string =>
      pullRequestPopulationOf({ context: "work", nowMs, placer: ACME_PLACER, reading }).phase;
    expect([at({ nowMs: CUTOFF - 1 }), at({ nowMs: CUTOFF })]).toStrictEqual(["measured", "not-measured"]);
  });

  it("asks for no further redraw once the clock has reached it", () => {
    expect([
      badgeRedrawAtOf({ nowMs: CUTOFF - 1, reading }),
      badgeRedrawAtOf({ nowMs: CUTOFF, reading }),
      badgeRedrawAtOf({ nowMs: CUTOFF + 60_000, reading }),
    ]).toStrictEqual([CUTOFF, undefined, undefined]);
  });

  it("ages from the census's own read, not the reading's record time", () => {
    const census = acmeCensus({ prs: [openPr({ number: 1 })], startedAtIso: "2026-11-03T20:45:00.000Z" });
    const earlier = landingReading({ census, rows: [acmeRow({ number: 1 })], selection: WITH_DRAFTS });
    expect(badgeRedrawAtOf({ nowMs: NOW_MS, reading: earlier })).toBe(Date.parse("2026-11-03T21:15:00.001Z"));
  });

  it("ages from this context's repositories only: an old read of a repository it does not show moves neither the count nor the deadline", () => {
    const elsewhere = {
      kind: "read",
      pullRequests: [],
      repo: FIXTURE_SELF_REPOSITORY,
      startedAtIso: "2026-11-03T20:00:00.000Z",
      totalCount: 0,
      viewer: "octocat",
    } as const;
    const census = [...acmeCensus({ prs: [openPr({ number: 1 })] }), elsewhere];
    const mixed = landingReading({
      census,
      rows: [acmeRow({ number: 1 })],
      selection: { ...WITH_DRAFTS, repos: [...WITH_DRAFTS.repos, FIXTURE_SELF_REPOSITORY] },
    });
    const population = populationOf({ reading: mixed });
    expect(population.phase).toBe("measured");
    const measured = population as Extract<PullRequestPopulation, { phase: "measured" }>;
    expect(measured.count.count).toBe(1);
    expect(badgeRedrawAtOf({ nowMs: NOW_MS, reading: mixed })).toBe(CUTOFF);
  });

  it("asks for none over a reading whose instant cannot be read, whose count is withheld already", () => {
    const unreadable = landingReading({
      census: acmeCensus({ prs: [openPr({ number: 1 })], startedAtIso: "not an instant" }),
      observedAtIso: "not an instant",
      rows: [acmeRow({ number: 1 })],
      selection: WITH_DRAFTS,
    });
    expect(badgeRedrawAtOf({ nowMs: NOW_MS, reading: unreadable })).toBe(undefined);
  });
});
