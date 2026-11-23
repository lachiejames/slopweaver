/*
 * What the Pull requests page and its badge stand on once the population is read: the ONE rule for printing a count,
 * whether the latest read answered, and what an empty list draws — an explanation rather than a confident zero
 * (an explanation beats nothing), each read's own reason quoted apart from the console's words.
 */
import { describe, expect, it } from "vitest";

import type { SyncState } from "../../components/live/LandingSync";
import type { LandingReading } from "../../components/live/readLanding";
import type { LiveState } from "../../lib/liveState";
import { prViewCounts } from "../../lib/prViews";
import {
  type EmptyLatest,
  emptyLatestOf,
  landingLatestOf,
  pullRequestCountOf,
  pullRequestEmptyDrawOf,
} from "../../lib/pullRequestEmptyDraw";
import { type PullRequestPopulation, pullRequestPopulationOf } from "../../lib/pullRequestPopulation";
import { ACME_PLACER } from "../organisationFixture";
import {
  acmeCensus,
  acmeRow,
  landingReading,
  NOW_MS,
  openPr,
  WITH_DRAFTS,
  WITHOUT_DRAFTS,
} from "./landingReadingFixture";

const populationOf = ({ reading }: { reading: LandingReading }): PullRequestPopulation =>
  pullRequestPopulationOf({ context: "work", nowMs: NOW_MS, placer: ACME_PLACER, reading });

const EVERYTHING = { key: "all", label: "Everything" } as const;
const DRAFTS = { key: "draft", label: "Drafts" } as const;
const CURRENT = { phase: "current" } as const;

describe("pullRequestCountOf — the one rule the badge and the page's selector both print by", () => {
  const COUNTED_READING = landingReading({
    census: acmeCensus({ prs: [openPr({ number: 1 })] }),
    rows: [acmeRow({ number: 1 })],
    selection: WITH_DRAFTS,
  });
  const live = {
    fixture: undefined,
    observedAtIso: COUNTED_READING.observedAtIso,
    phase: "ready",
    stampedByRoute: true,
    value: COUNTED_READING,
  } as const;

  /** What the selector prints per state under the rule: every count, Everything first. */
  const selectorCounts = ({ state }: { state: LiveState<LandingReading> }): readonly (number | undefined)[] => {
    const population = populationOf({ reading: COUNTED_READING });
    const counted = pullRequestCountOf({ latest: emptyLatestOf({ state, subject: "your pull requests" }), population });
    return prViewCounts({ measured: counted.phase === "counted", picked: new Set(), rows: population.rows }).map(
      (each) => each.count,
    );
  };

  it("counts a current reading of a measured population, the badge and Everything alike", () => {
    const population = populationOf({ reading: COUNTED_READING });
    expect(population.phase).toBe("measured");
    expect(
      pullRequestCountOf({ latest: emptyLatestOf({ state: live, subject: "your pull requests" }), population }),
    ).toStrictEqual({
      count: {
        count: 1,
        title:
          "your open pull requests in this context, drafts included: the cards the Pull requests page lists under Everything",
      },
      phase: "counted",
    });
    expect(selectorCounts({ state: live })[0]).toBe(1);
  });

  it("prints no count on either over a measured population retained across a failed read", () => {
    const retained: LiveState<LandingReading> = { ...live, stale: { why: "GitHub answered 502" } };
    const population = populationOf({ reading: COUNTED_READING });
    expect(population.phase).toBe("measured");
    expect(
      pullRequestCountOf({ latest: emptyLatestOf({ state: retained, subject: "your pull requests" }), population }),
    ).toStrictEqual({
      phase: "withheld",
      why: [{ lead: "the latest read of your pull requests failed", why: "GitHub answered 502" }],
    });
    const counts = selectorCounts({ state: retained });
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.filter((count) => count !== undefined)).toEqual([]);
  });

  it("prints no count on either over a reading handed over while it is read again", () => {
    const refreshing: LiveState<LandingReading> = { ...live, refreshing: true };
    const counts = selectorCounts({ state: refreshing });
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.filter((count) => count !== undefined)).toEqual([]);
  });

  it("prints no count over a current reading whose population is not measured, with the population's reason", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 })] }),
        rows: [acmeRow({ number: 1 })],
        selection: WITHOUT_DRAFTS,
      }),
    });
    expect(pullRequestCountOf({ latest: CURRENT, population })).toStrictEqual({
      phase: "withheld",
      why: "the reading shown was taken without drafts, so it cannot count every open pull request of yours",
    });
  });
});

describe("landingLatestOf — a failed refresh of the console's own withholds like a failed read", () => {
  const ZERO_READING = landingReading({ census: acmeCensus({ prs: [] }), rows: [], selection: WITH_DRAFTS });
  const live = {
    fixture: undefined,
    observedAtIso: ZERO_READING.observedAtIso,
    phase: "ready",
    stampedByRoute: true,
    value: ZERO_READING,
  } as const;
  const failed: SyncState = {
    atIso: "2026-11-03T20:58:00.000Z",
    auto: "due",
    phase: "failed",
    why: "github landing exited 1",
  };

  it("over a measured zero: no badge count, no view counts, and an explanation rather than the designed zero", () => {
    const population = populationOf({ reading: ZERO_READING });
    expect(population.phase).toBe("measured");
    const latest = landingLatestOf({ state: live, sync: failed });
    const why = [{ lead: "the console's latest refresh of your pull requests failed", why: "github landing exited 1" }];
    expect(latest).toStrictEqual({ phase: "not-current", why });
    const counted = pullRequestCountOf({ latest, population });
    expect(counted).toStrictEqual({ phase: "withheld", why });
    const counts = prViewCounts({ measured: counted.phase === "counted", picked: new Set(), rows: population.rows });
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.filter((each) => each.count !== undefined)).toEqual([]);
    expect(pullRequestEmptyDrawOf({ latest, population, view: EVERYTHING, viewedCount: 0 })).toStrictEqual({
      detail: undefined,
      kind: "explanation",
      quoted: [
        {
          lead: "Not a count of zero: the console's latest refresh of your pull requests failed",
          why: "github landing exited 1",
        },
      ],
      title: "This reading cannot show there is nothing under Everything.",
    });
  });

  it("is current over the same reading while the refresh is idle, taking, or taken", () => {
    const others: readonly SyncState[] = [
      { phase: "idle" },
      { auto: "due", phase: "taking", startedAtIso: "2026-11-03T20:58:00.000Z" },
      { atIso: "2026-11-03T20:58:00.000Z", auto: "due", phase: "taken", tookMs: 900 },
    ];
    expect(others.map((sync) => landingLatestOf({ state: live, sync }))).toStrictEqual([CURRENT, CURRENT, CURRENT]);
  });

  it("keeps the reading's own failure first when both failed", () => {
    expect(landingLatestOf({ state: { ...live, stale: { why: "GitHub answered 502" } }, sync: failed })).toStrictEqual({
      phase: "not-current",
      why: [{ lead: "the latest read of your pull requests failed", why: "GitHub answered 502" }],
    });
  });
});

describe("emptyLatestOf", () => {
  const ready = {
    fixture: undefined,
    observedAtIso: "2026-11-03T20:50:00.000Z",
    phase: "ready",
    stampedByRoute: true,
    value: 0,
  } as const;

  it("is current only for a ready reading neither stale nor being replaced", () => {
    const states: readonly LiveState<number>[] = [
      ready,
      { ...ready, stale: { why: "GitHub answered 502" } },
      { ...ready, refreshing: true },
      { phase: "not-measured", why: "no reading recorded" },
      { phase: "loading" },
    ];
    expect(states.map((state) => emptyLatestOf({ state, subject: "your pull requests" }))).toStrictEqual([
      { phase: "current" },
      {
        phase: "not-current",
        why: [{ lead: "the latest read of your pull requests failed", why: "GitHub answered 502" }],
      },
      { phase: "not-current", why: "your pull requests are being read again" },
      { phase: "not-current", why: [{ lead: "your pull requests could not be read", why: "no reading recorded" }] },
      { phase: "not-current", why: "your pull requests are still being read" },
    ]);
  });
});

describe("pullRequestEmptyDrawOf", () => {
  const measuredZero = populationOf({
    reading: landingReading({ census: acmeCensus({ prs: [] }), rows: [], selection: WITH_DRAFTS }),
  });

  it("draws nothing extra while the state holds a card", () => {
    expect(
      pullRequestEmptyDrawOf({ latest: CURRENT, population: measuredZero, view: EVERYTHING, viewedCount: 1 }),
    ).toStrictEqual({ kind: "none" });
  });

  it("explains an empty list while GitHub lists five of the owner's open, naming GitHub's count, never a zero", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [1, 2, 3, 4, 5].map((number) => openPr({ number })) }),
        rows: [],
        selection: WITH_DRAFTS,
      }),
    });
    expect(pullRequestEmptyDrawOf({ latest: CURRENT, population, view: EVERYTHING, viewedCount: 0 })).toStrictEqual({
      detail:
        "Not a count of zero: the reading shown does not reconcile with GitHub's open list: GitHub lists 5 of your open pull requests here that none of its rows carries.",
      kind: "explanation",
      quoted: [],
      title: "GitHub lists 5 of your open pull requests in this context, and this reading shows none under Everything.",
    });
  });

  it("draws the designed empty state over a current, complete reading of nothing open", () => {
    expect(
      pullRequestEmptyDrawOf({ latest: CURRENT, population: measuredZero, view: EVERYTHING, viewedCount: 0 }),
    ).toStrictEqual({
      appearsWhen: "A pull request appears here when the latest GitHub reading places it under Everything.",
      kind: "designed",
      title: "Pull requests under Everything will appear here.",
    });
  });

  it("explains a complete zero whose latest read failed, since the zero it shows is not proof of now", () => {
    const stack = "Error: GitHub answered 502\n    at fetchLanding (/srv/app/landing.ts:40:7)";
    const latest: EmptyLatest = {
      phase: "not-current",
      why: [{ lead: "the latest read of your pull requests failed", why: stack }],
    };
    // The raw message is never set inside the sentence: it is the quoted reason's own field, byte for byte.
    expect(
      pullRequestEmptyDrawOf({ latest, population: measuredZero, view: EVERYTHING, viewedCount: 0 }),
    ).toStrictEqual({
      detail: undefined,
      kind: "explanation",
      quoted: [{ lead: "Not a count of zero: the latest read of your pull requests failed", why: stack }],
      title: "This reading cannot show there is nothing under Everything.",
    });
  });

  it("quotes each repository whose open list did not read on its own line, only the first led by the zero", () => {
    const population = populationOf({
      reading: landingReading({
        census: [
          { kind: "unread", repo: "acme/acme-admin", why: "HTTP 429 Too Many Requests" },
          { kind: "unread", repo: "acme/website", why: "GitHub answered 502" },
        ],
        rows: [],
        selection: { ...WITH_DRAFTS, repos: ["acme/acme-admin", "acme/website"] },
      }),
    });
    const draw = pullRequestEmptyDrawOf({ latest: CURRENT, population, view: EVERYTHING, viewedCount: 0 });
    expect(draw).toStrictEqual({
      detail: undefined,
      kind: "explanation",
      quoted: [
        {
          lead: "Not a count of zero: GitHub's open list for acme/acme-admin could not be read",
          why: "HTTP 429 Too Many Requests",
        },
        { lead: "GitHub's open list for acme/website could not be read", why: "GitHub answered 502" },
      ],
      title: "This reading cannot show there is nothing under Everything.",
    });
  });

  it("draws the designed empty state for a filter that holds nothing over a counted population", () => {
    const population = populationOf({
      reading: landingReading({
        census: acmeCensus({ prs: [openPr({ number: 1 })] }),
        rows: [acmeRow({ number: 1 })],
        selection: WITH_DRAFTS,
      }),
    });
    expect(population.phase).toBe("measured");
    expect(pullRequestEmptyDrawOf({ latest: CURRENT, population, view: DRAFTS, viewedCount: 0 })).toStrictEqual({
      appearsWhen: "A pull request appears here when the latest GitHub reading places it under Drafts.",
      kind: "designed",
      title: "Pull requests under Drafts will appear here.",
    });
  });
});
