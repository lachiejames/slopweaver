/*
 * The pull-request page's `read_page` reading: the count the voice reads out is the count the page draws, so a voice saying six open pull requests over a page drawing 38 is a defect.
 */
import { describe, expect, it } from "vitest";

import type { Landing, LandingRow } from "../../components/live/readLanding";
import type { Reviewers } from "../../components/live/readReviewers";
import { PAGE_READ_MAX_BYTES, pageRead } from "../../lib/pageVoice";
import { ownerWordOn } from "../../lib/prNeedsOwner";
import { type CensusPicture, censusPictureOf } from "../../lib/pullRequestCensus";
import { pullRequestsForVoice } from "../../lib/pullRequestsVoice";
import { ACME_PLACER, FIXTURE_SELF_REPOSITORY } from "../organisationFixture";
import { landingRow, WAIT } from "./landingRowFixture";

/** A row of this build's own repository, the one the organisation fixture places in `self`. */
function row({ action, number }: { action: string; number: number }): LandingRow {
  return {
    ...landingRow({ action, number }),
    repoSlug: FIXTURE_SELF_REPOSITORY,
    url: `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/${String(number)}`,
  };
}

const ACTIONS = ["press", "blocked-on", "draft", "conflicting", "unknown", "answer-threads"];
const ROWS: LandingRow[] = Array.from({ length: 38 }, (_, index) =>
  row({ action: ACTIONS[index % ACTIONS.length], number: 1120 + index }),
);

const LANDING: Landing = {
  advisoryRedBypassed: undefined,
  byAction: [
    { action: "press", count: 7 },
    { action: "answer-threads", count: 6 },
    { action: "blocked-on", count: 7 },
    { action: "conflicting", count: 6 },
    { action: "unknown", count: 6 },
    { action: "draft", count: 6 },
  ],
  people: new Map(),
  ready: 7,
  residue: ["one read the verb could not take"],
  rows: ROWS,
  selection: { author: "@me", includeDrafts: true, repos: [FIXTURE_SELF_REPOSITORY] },
  total: 38,
  // GitHub's own open list: the 38 rows, and 400 by other authors — the acme-admin-sized tail the voice must
  // carry as a count and a few numbers, never as a list.
  census: [
    {
      kind: "read",
      pullRequests: [
        ...ROWS.map((each) => ({
          author: each.authorLogin,
          isDraft: false,
          number: each.number,
          title: each.title,
          url: each.url,
        })),
        ...Array.from({ length: 400 }, (_, index) => ({
          author: "renovate",
          isDraft: false,
          number: 2000 + index,
          title: `a bump with a long enough title to weigh something ${String(index)}`,
          url: `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/${String(2000 + index)}`,
        })),
      ],
      repo: FIXTURE_SELF_REPOSITORY,
      startedAtIso: "2026-09-26T13:00:00.000Z",
      totalCount: 438,
      viewer: "octocat",
    },
  ],
};

/** The page's headline over {@link LANDING}, as `PrList` computes it. */
const CENSUS: CensusPicture = censusPictureOf({
  census: LANDING.census,
  drawn: ROWS,
  context: "slopweaver",
  placer: ACME_PLACER,
  rows: ROWS,
  selection: LANDING.selection,
});

/** The selector on Everything, counting every row. */
const EVERYTHING = { count: 38, key: "all", label: "Everything" } as const;

/** A suggestion on every row, and one pick — the heaviest reviewer reading 38 rows can carry. */
const REVIEWERS: Reviewers = {
  observedAtIso: "2026-09-24T19:20:43.085Z",
  people: new Map([["U0QUINN", { handle: undefined, name: "Quinn" }]]),
  readingId: "r1",
  registerAsks: 5,
  rows: ROWS.map((each) => ({
    hook: each.number === 1121 ? "picked" : "nobody-asked",
    number: each.number,
    picked: each.number === 1121 ? { atIso: "2026-09-24T20:00:00.000Z", reviewer: "U0QUINN" } : undefined,
    primary: undefined,
    repoSlug: each.repoSlug,
    suggestion: {
      alternatives: [],
      primary: {
        basis: "you asked them on 2 earlier pull requests owned by @acme/dx — history, not ownership",
        reviewer: "U0QUINN",
        tier: "team-history",
      },
    },
  })),
};

/** The reading over every row on Everything, with whatever a case changes. */
const voiceOf = (over: Partial<Parameters<typeof pullRequestsForVoice>[0]> = {}) =>
  pullRequestsForVoice({
    census: CENSUS,
    hiddenByContext: 0,
    landing: LANDING,
    open: undefined,
    placer: ACME_PLACER,
    readyHere: 7,
    reviewers: undefined,
    rows: ROWS,
    stale: [],
    view: EVERYTHING,
    ...over,
  });

describe("pullRequestsForVoice", () => {
  it("leads with every reading drawn over a failed read, and with none when all are current", () => {
    const stale = [
      { reading: "your pull requests", readingFromIso: "2026-10-10T14:40:00.000Z", why: "github landing exited 1" },
      { reading: "the reviewer suggestions", readingFromIso: "2026-10-10T14:38:00.000Z", why: "the route timed out" },
    ];
    expect(Object.keys(voiceOf({ stale }))[0]).toBe("stale");
    expect(voiceOf({ stale }).stale).toStrictEqual(stale);
    expect(voiceOf().stale).toStrictEqual([]);
  });

  it("carries the mark the page draws beside a row from outside the organisation, drawn or open", () => {
    const outside: LandingRow = {
      ...row({ action: "press", number: 9 }),
      repoSlug: "someone/elsewhere",
      url: "https://github.com/someone/elsewhere/pull/9",
    };
    const inside = row({ action: "press", number: 10 });
    const both = [outside, inside];
    const shows = voiceOf({ landing: { ...LANDING, rows: both }, open: outside, readyHere: 0, rows: both });
    expect(shows.open!.mark!.label).toBe("placed by default: no workspace");
    expect(shows.rows.find((entry) => entry.pr === "someone/elsewhere#9")!.mark!.label).toBe(
      "placed by default: no workspace",
    );
    expect(shows.rows.find((entry) => entry.pr === `${FIXTURE_SELF_REPOSITORY}#10`)!.mark).toBe(undefined);
  });

  it("reads a waiting row out as its five facts, and says nothing about a wait on a row that has none", () => {
    const shows = voiceOf();
    expect(shows.rows.find((entry) => entry.next === "blocked-on")!.wait).toBe(WAIT.sentence);
    expect(shows.rows.find((entry) => entry.next === "press")!.wait).toBe(undefined);
  });

  it("says who each row is on the hook with and what is suggested", () => {
    const shows = voiceOf({ reviewers: REVIEWERS });
    expect(
      shows.rows.filter((each) => each.pr.endsWith("#1120") || each.pr.endsWith("#1121")).map((each) => each.suggested),
    ).toEqual([
      "Quinn: you asked them on 2 earlier pull requests owned by @acme/dx — history, not ownership",
      "the owner picked Quinn, no ask seen since",
    ]);
  });

  it("suggests nobody on a row a channel post still holds, and the suggestion returns at red — as the page does", () => {
    const suggestedAt = (tone: "green" | "red"): string | undefined => {
      const share = {
        badge: "b",
        asOfIso: "2026-09-24T00:00:00.000Z",
        channel: "#dev-team",
        permalink: "https://acme.slack.com/archives/C0SYN000002/p1790508621312739",
        postedAtIso: "2026-09-24T00:00:00.000Z",
        replies: 0,
        seen: "s",
        tone,
        why: "w",
      };
      const shown = ROWS.map((each) => (each.number === 1120 ? { ...each, channelShare: share } : each));
      return voiceOf({ reviewers: REVIEWERS, rows: shown }).rows.find((each) => each.pr.endsWith("#1120"))!.suggested;
    };
    expect([suggestedAt("green"), suggestedAt("red")]).toEqual([
      undefined,
      "Quinn: you asked them on 2 earlier pull requests owned by @acme/dx — history, not ownership",
    ]);
  });

  it("reads a pick the owner approved over the verb's 'only your word is missing', on a row and in the open panel", () => {
    const shows = voiceOf({ open: ROWS.find((each) => each.number === 1121)!, reviewers: REVIEWERS });
    const waitOn = (number: number): string | undefined =>
      shows.rows.find((each) => each.pr.endsWith(`#${String(number)}`))!.wait;
    const picked =
      "you picked Quinn; no ask to them is seen since the pick; your queue holds any ask waiting on your yes";
    expect([waitOn(1121), shows.open!.wait, waitOn(1127)]).toEqual([picked, picked, WAIT.sentence]);
  });

  it("reads out 38 open, the state on screen with its count, and every drawn card in draw order", () => {
    const shows = voiceOf();
    expect(shows.openOnGithub).toEqual({
      authorFilter: "@me",
      closedSince: 0,
      notPlaced: 0,
      open: 38,
      otherAuthors: 400,
      placed: 38,
      repos: [FIXTURE_SELF_REPOSITORY],
      why: [],
    });
    expect(shows.rowsInReading).toBe(38);
    expect(shows.readyToPress).toBe(7);
    expect(shows.view).toEqual({ count: 38, key: "all", label: "Everything" });
    expect(shows.drawn).toBe(38);
    expect(shows.rows.map((each) => each.pr)).toEqual(
      ROWS.map((each) => `${FIXTURE_SELF_REPOSITORY}#${String(each.number)}`),
    );
    expect(shows.rows[0]).toEqual({
      author: "octocat",
      ci: "green",
      hook: "not known who was asked: the verb did not say why",
      mark: undefined,
      next: "press",
      pr: `${FIXTURE_SELF_REPOSITORY}#1120`,
      suggested: undefined,
      title: "pull request 1120",
      wait: undefined,
    });
    expect(shows.residue).toEqual(["one read the verb could not take"]);
  });

  it("reads only the cards a narrower state draws, under that state's own words and count", () => {
    const ci = [row({ action: "spawn-ci", number: 7 })];
    const shows = voiceOf({ rows: ci, view: { count: 1, key: "spawn-ci", label: "Waiting on CI" } });
    expect([shows.view.label, shows.view.count, shows.drawn]).toEqual(["Waiting on CI", 1, 1]);
    expect(shows.rows.map((each) => each.pr)).toEqual([`${FIXTURE_SELF_REPOSITORY}#7`]);
  });

  it("names the open PR with every fact its panel prints", () => {
    const open = ROWS.find((each) => each.number === 1147)!;
    const shows = voiceOf({ hiddenByContext: 2, open });
    expect(shows.hiddenByContext).toBe(2);
    expect(shows.open).toEqual({
      author: "octocat",
      blockedOn: [],
      boardRow: "declared",
      branch: "branch-1147 → main",
      checksNotGreen: ["lint: FAILURE, required"],
      ci: "green",
      codeRabbitThreadsOpen: 1,
      dispatchWhy: undefined,
      draft: false,
      humanThreadsOpen: 2,
      mark: undefined,
      next: "conflicting",
      nextDetail: "detail 1147",
      pr: `${FIXTURE_SELF_REPOSITORY}#1147`,
      tests: ["undrafted: pass, not a draft"],
      title: "pull request 1147",
      url: `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/1147`,
      verdict: undefined,
      wait: undefined,
      waitingOn: ["reviewer (3 open)"],
    });
  });

  it("says what a red open PR is red on, and each failing check's requirement, unknown included", () => {
    const open: LandingRow = {
      ...ROWS.find((each) => each.number === 1147)!,
      ci: "red",
      ciFailure: { kind: "red", required: undefined },
      failingChecks: [
        { name: "Advisory local browser E2E (billing)", required: false, state: "FAILURE", url: undefined },
        { name: "e2e", required: undefined, state: "FAILURE", url: undefined },
      ],
    };
    const shows = voiceOf({ open });
    expect([shows.open!.ci, shows.open!.checksNotGreen]).toStrictEqual([
      "red · requirement unknown",
      ["Advisory local browser E2E (billing): FAILURE, advisory", "e2e: FAILURE, requirement unknown"],
    ]);
  });

  it("says NOT MEASURED in the count's place when the reading carries no census, never the rows' total", () => {
    const shows = voiceOf({
      census: censusPictureOf({
        census: undefined,
        context: "slopweaver",
        drawn: ROWS,
        placer: ACME_PLACER,
        rows: ROWS,
        selection: LANDING.selection,
      }),
    });
    expect(shows.openOnGithub).toEqual({
      notMeasured: "this reading predates the verb recording GitHub's own open count, so no count is claimed",
    });
  });

  it("fits 38 rows, an open PR and 400 unplaced inside read_page's cap, uncut", () => {
    const shows = voiceOf({ open: ROWS[27], reviewers: REVIEWERS });
    const read = pageRead({
      maxBytes: PAGE_READ_MAX_BYTES,
      view: { open: "pr:acme.widgets.1147", openBy: undefined, path: "/pull-requests", shows, title: "Pull requests" },
    });
    expect(read.truncated).toBe(undefined);
    expect(read.open).toBe("pr:acme.widgets.1147");
    expect(read.shows).toEqual(shows);
  });
});

/*
 * A card waiting on the owner's word wears the page's one accent, by the Queue's own rule: the Queue owns the asking
 * (this page has no Needs-you section), so the card only marks it.
 */
describe("the card accent", () => {
  it("withdraws a naming row the owner already picked a reviewer for, and keeps a picked refusal as a refusal", () => {
    const picked = { reviewer: "U01ARI" };
    const naming = row({ action: "blocked-on", number: 1121 });
    expect(ownerWordOn({ picked, row: naming })).toBe(undefined);
    expect(ownerWordOn({ picked: undefined, row: naming })).toBe("naming");
    expect(ownerWordOn({ picked, row: { ...naming, verdict: "needs-owner-judgment" } })).toBe("judgment");
    expect(ownerWordOn({ picked: undefined, row: row({ action: "press", number: 1120 }) })).toBe(undefined);
  });
});
