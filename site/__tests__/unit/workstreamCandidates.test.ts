import { describe, expect, it } from "vitest";

import { readWorkstreamCandidates } from "../../lib/workstreamCandidates";
import {
  answeredLine,
  candidateHeading,
  candidatePeriod,
  candidatesSummary,
  definePress,
  oneAtATime,
  openingFew,
  partitionCandidates,
  placingPress,
  provenanceLine,
  standingChoice,
  steerWords,
} from "../../lib/workstreamCandidatesPage";
import { type CandidateRowView, type CandidatesView, PRESS_REACTIONS } from "../../lib/workstreamCandidatesTypes";
import { shortDate } from "../../lib/workstreamTiles";

/** One candidate as `workstreams candidates --json` prints it, with every field `candidatesDocument` writes. */
const printed = ({
  id,
  n,
  theme,
  evidenceCount,
  reaction = null,
  registerId = null,
}: {
  id: string;
  n: number;
  theme: string;
  evidenceCount: number;
  reaction?: string | null;
  registerId?: string | null;
}): Record<string, unknown> => ({
  coveredBy: null,
  definition: null,
  heard: null,
  doneOptions: [],
  evidence: [
    { anchor: null, date: "2026-08-01", href: "https://example.test/m/1", quote: "nothing should merge red" },
    { anchor: "owner-turn:owner-turn-12.txt", date: "2026-08-05", href: null, quote: "we never write them" },
  ],
  evidenceCount,
  first: "2026-08-01",
  id,
  inRegister: null,
  last: "2026-09-10",
  loopIn: [],
  milestoneOf: null,
  n,
  name: `Candidate ${id}`,
  outcome: `The outcome of ${id}`,
  outcomeOf: null,
  owner: null,
  owningTeam: null,
  people: ["Ari"],
  priorSteers: [],
  promotedAs: null,
  proposal: null,
  reactedIso: reaction === null ? null : "2026-10-02T13:05:00.000Z",
  reaction,
  reason: null,
  registerId,
  sameAs: null,
  stalled: null,
  steer: null,
  supersededBy: null,
  theme,
  title: null,
  via: reaction === null ? null : "console",
  whoFirst: null,
  workspace: "work",
});

/** Every word's count at zero, the shape the verb prints. */
const ZERO = {
  abandoned: 0,
  done: 0,
  "lets-talk": 0,
  "milestone-of": 0,
  no: 0,
  "not-sure": 0,
  "outcome-of": 0,
  "same-as": 0,
  "sort-of": 0,
  superseded: 0,
  unanswered: 0,
  yes: 0,
};

/** A whole document. */
const documentOf = ({ candidates }: { candidates: readonly Record<string, unknown>[] }): Record<string, unknown> => ({
  candidates,
  counts: { ...ZERO, no: 1, unanswered: 1, yes: 1 },
  definitionOwed: [],
  mined: {
    minedFrom: "the owner's Slack messages and session transcripts",
    minedIso: "2026-10-02T13:00:00.000Z",
    minedSources: [{ recordsRead: 412, source: "notion" }],
  },
  placementOwed: [],
  promotionOwed: [],
  proposalOwed: ["p-001"],
  proposals: [
    {
      anchor: "talk:fcc6cb0d-40a4#EUlOCBz7",
      bySession: "s",
      from: null,
      id: "p-001",
      iso: "2026-10-03T04:20:00.000Z",
      minedAs: null,
      relation: "own",
      title: "Human PR review friction",
      via: "word",
      why: null,
    },
  ],
  register: [{ id: "merge-gate", kind: "standing", name: "Nothing merges red" }],
  registerExists: true,
  retractions: [],
  schemaVersion: 1,
  storyOwed: ["postmortems-that-happen"],
});

const three = [
  printed({ evidenceCount: 30, id: "c-001", n: 1, reaction: "yes", registerId: "merge-gate", theme: "ci-testing" }),
  printed({ evidenceCount: 8, id: "c-002", n: 2, reaction: "no", theme: "reliability" }),
  printed({ evidenceCount: 5, id: "c-003", n: 3, theme: "security" }),
];

/** A view built through the reader, so the ranking tests start from what the page really holds. */
const viewOf = ({ candidates }: { candidates: readonly Record<string, unknown>[] }): CandidatesView =>
  readWorkstreamCandidates({ payload: documentOf({ candidates }) })!;

/** One candidate read through the reader, with fields laid over the printed one. */
const readOne = (over: Record<string, unknown>): CandidateRowView =>
  viewOf({ candidates: [{ ...printed({ evidenceCount: 3, id: "c-002", n: 2, theme: "reliability" }), ...over }] })
    .candidates[0];

describe("readWorkstreamCandidates", () => {
  it("reads every field the section draws, a null word as unanswered and the anchor beside a missing link", () => {
    const view = viewOf({ candidates: three });
    expect(view.candidates.map((one) => [one.id, one.reaction, one.registerId])).toEqual([
      ["c-001", "yes", "merge-gate"],
      ["c-002", "no", null],
      ["c-003", null, null],
    ]);
    expect(view.candidates[0].evidence).toEqual([
      { anchor: null, date: "2026-08-01", href: "https://example.test/m/1", quote: "nothing should merge red" },
      { anchor: "owner-turn:owner-turn-12.txt", date: "2026-08-05", href: null, quote: "we never write them" },
    ]);
    expect(view.counts).toEqual({ ...ZERO, no: 1, unanswered: 1, yes: 1 });
    expect(view.storyOwed).toEqual(["postmortems-that-happen"]);
    expect(view.register).toEqual([{ id: "merge-gate", kind: "standing", name: "Nothing merges red" }]);
    expect(view.proposals).toEqual([
      { from: null, id: "p-001", minedAs: null, relation: "own", title: "Human PR review friction", why: null },
    ]);
    expect(view.proposalOwed).toEqual(["p-001"]);
  });

  it("reads every one of the owner's words, and only the six that one press records are buttons", () => {
    const placed = readOne({ milestoneOf: "pool-e2e", reaction: "milestone-of", reason: "half of the pool work" });
    expect([placed.reaction, placed.milestoneOf, placed.reason]).toEqual([
      "milestone-of",
      "pool-e2e",
      "half of the pool work",
    ]);
    expect(PRESS_REACTIONS).toEqual(["yes", "no", "sort-of", "not-sure", "lets-talk", "done"]);
  });

  it("refuses a word outside the owner's own rather than drawing no button selected", () => {
    const odd = printed({ evidenceCount: 1, id: "c-009", n: 9, reaction: "maybe", theme: "x" });
    expect(readWorkstreamCandidates({ payload: documentOf({ candidates: [odd] }) })).toBe(undefined);
  });

  it("refuses a candidate missing a field, a count missing a word, and another schema version", () => {
    const { evidenceCount: _dropped, ...noCount } = printed({ evidenceCount: 1, id: "c-009", n: 9, theme: "x" });
    expect(readWorkstreamCandidates({ payload: documentOf({ candidates: [noCount] }) })).toBe(undefined);
    const { title: _untitled, ...noTitle } = printed({ evidenceCount: 1, id: "c-009", n: 9, theme: "x" });
    expect(readWorkstreamCandidates({ payload: documentOf({ candidates: [noTitle] }) })).toBe(undefined);
    const { done: _noDone, ...shortCounts } = ZERO;
    expect(readWorkstreamCandidates({ payload: { ...documentOf({ candidates: three }), counts: shortCounts } })).toBe(
      undefined,
    );
    expect(readWorkstreamCandidates({ payload: { ...documentOf({ candidates: three }), schemaVersion: 2 } })).toBe(
      undefined,
    );
    const { register: _noRegister, ...unregistered } = documentOf({ candidates: three });
    expect(readWorkstreamCandidates({ payload: unregistered })).toBe(undefined);
    expect(readWorkstreamCandidates({ payload: [] })).toBe(undefined);
  });

  it("refuses evidence whose link is neither a string nor null", () => {
    const bad = {
      ...printed({ evidenceCount: 1, id: "c-009", n: 9, theme: "x" }),
      evidence: [{ anchor: null, date: "2026-08-01", href: 7, quote: "q" }],
    };
    expect(readWorkstreamCandidates({ payload: documentOf({ candidates: [bad] }) })).toBe(undefined);
  });

  it("reads the definitions of done with their stretch, the stall, the people owed a conversation and the pick", () => {
    const one = readOne({
      definition: {
        iso: "2026-10-02T13:10:00.000Z",
        selection: {
          kind: "option",
          lens: "people",
          optionId: "owned-and-read",
          stretch: null,
          text: "Each postmortem has a named owner",
          tradeoff: "slower to reach",
        },
      },
      doneOptions: [
        {
          id: "written-within-a-week",
          lens: "result",
          stretch: "the on-call lead quotes one in standup",
          text: "Written within a week",
          tradeoff: "fast, owns nothing",
        },
        { id: "owned-and-read", lens: "adoption", stretch: null, text: "Teammates write their own", tradeoff: "slow" },
      ],
      loopIn: [
        {
          draftId: "d-17",
          draftState: "held",
          name: "Ari",
          opener: "Could we agree who owns writing each one?",
          slack: "U0SYNTESTAAA1",
          why: "leads on-call",
        },
      ],
      stalled: { since: "2026-07-09", what: "no postmortem written since the July incident" },
    });
    expect(one.doneOptions.map((option) => [option.id, option.lens, option.stretch])).toEqual([
      ["written-within-a-week", "result", "the on-call lead quotes one in standup"],
      ["owned-and-read", "adoption", null],
    ]);
    expect(one.definition).toEqual({
      kind: "option",
      lens: "people",
      optionId: "owned-and-read",
      stretch: null,
      text: "Each postmortem has a named owner",
      tradeoff: "slower to reach",
    });
    expect(one.loopIn[0].draftState).toBe("held");
    expect(one.stalled).toEqual({ since: "2026-07-09", what: "no postmortem written since the July incident" });
  });

  it("reads their own words with a stretch, and all of the options with the one that leads", () => {
    const words = readOne({
      definition: {
        iso: "2026-10-02T13:10:00.000Z",
        selection: { kind: "words", stretch: "someone else says so", text: "someone owns each one" },
      },
    });
    expect(words.definition).toEqual({ kind: "words", stretch: "someone else says so", text: "someone owns each one" });
    const all = readOne({
      definition: {
        iso: "2026-10-02T13:10:00.000Z",
        selection: {
          first: null,
          kind: "all",
          options: [{ lens: "result", optionId: "a", stretch: null, text: "A", tradeoff: "ta" }],
          text: "A",
        },
      },
    });
    expect(all.definition).toEqual({
      first: null,
      kind: "all",
      options: [{ lens: "result", optionId: "a", stretch: null, text: "A", tradeoff: "ta" }],
      text: "A",
    });
  });

  it("reads the owner's title, who first, the owning team and the earlier steers, dated", () => {
    const one = readOne({
      owningTeam: { name: "platform team", why: "they run the load tests" },
      priorSteers: [{ anchor: "talk:92ec0898-9951", date: "2026-10-02", text: "ratchet everything to 300 lines" }],
      title: "Know about a bug the moment it happens",
      whoFirst: { iso: "2026-10-03T04:30:00.000Z", people: ["Jasper", "Quinn"], team: null },
    });
    expect([candidateHeading({ candidate: one }), one.owningTeam, one.whoFirst]).toEqual([
      "Know about a bug the moment it happens",
      { name: "platform team", why: "they run the load tests" },
      { people: ["Jasper", "Quinn"], team: null },
    ]);
    expect(steerWords({ steer: one.priorSteers[0] })).toBe(
      "2026-10-02: ratchet everything to 300 lines [talk:92ec0898-9951]",
    );
    expect(candidateHeading({ candidate: readOne({}) })).toBe("Candidate c-002");
  });

  it("refuses a lens, a draft state, a selection kind or a relation outside the verb's own", () => {
    const base = printed({ evidenceCount: 1, id: "c-009", n: 9, theme: "x" });
    const badLens = { ...base, doneOptions: [{ id: "a", lens: "vibes", stretch: null, text: "t", tradeoff: "o" }] };
    const badDraft = {
      ...base,
      loopIn: [{ draftId: null, draftState: "sent", name: "A", opener: "o", slack: "U1", why: "w" }],
    };
    const badKind = {
      ...base,
      definition: { iso: "2026-10-02T13:10:00.000Z", selection: { kind: "vote", text: "t" } },
    };
    expect(readWorkstreamCandidates({ payload: documentOf({ candidates: [badLens] }) })).toBe(undefined);
    expect(readWorkstreamCandidates({ payload: documentOf({ candidates: [badDraft] }) })).toBe(undefined);
    expect(readWorkstreamCandidates({ payload: documentOf({ candidates: [badKind] }) })).toBe(undefined);
    const document = documentOf({ candidates: [base] });
    const badRelation = {
      ...document,
      proposals: [{ from: null, id: "p-1", minedAs: null, relation: "x", title: "t", why: null }],
    };
    expect(readWorkstreamCandidates({ payload: badRelation })).toBe(undefined);
    const { registerExists: _gone, ...noFlag } = document;
    expect(readWorkstreamCandidates({ payload: noFlag })).toBe(undefined);
  });
});

describe("partitionCandidates and openingFew", () => {
  it("ranks the ones waiting on a word by evidence, most first, and keeps the answered in rank order", () => {
    const view = viewOf({
      candidates: [
        printed({ evidenceCount: 2, id: "c-003", n: 3, theme: "x" }),
        printed({ evidenceCount: 1, id: "c-001", n: 1, reaction: "yes", theme: "x" }),
        printed({ evidenceCount: 9, id: "c-004", n: 4, theme: "x" }),
        printed({ evidenceCount: 2, id: "c-002", n: 2, theme: "x" }),
      ],
    });
    const parts = partitionCandidates({ candidates: view.candidates });
    expect(parts.unanswered.map((one) => one.id)).toEqual(["c-004", "c-002", "c-003"]);
    expect(parts.answered.map((one) => one.id)).toEqual(["c-001"]);
  });

  it("opens on a few and counts the rest behind the one link, never the whole mined list", () => {
    const many = Array.from({ length: 70 }, (_, index) =>
      printed({ evidenceCount: 70 - index, id: `c-${String(index + 1)}`, n: index + 1, theme: "x" }),
    );
    const { unanswered } = partitionCandidates({ candidates: viewOf({ candidates: many }).candidates });
    const opening = openingFew({ showAll: false, unanswered });
    expect([opening.shown.length, opening.behind, opening.shown[0].id]).toEqual([3, 67, "c-1"]);
    expect(openingFew({ showAll: true, unanswered }).behind).toBe(0);
    expect(openingFew({ showAll: false, unanswered: unanswered.slice(0, 2) }).behind).toBe(0);
  });
});

describe("oneAtATime", () => {
  const list = viewOf({ candidates: three }).candidates;

  it("clamps into the list and never wraps", () => {
    expect(oneAtATime({ at: 0, list })).toEqual({ candidate: list[0], hasNext: true, hasPrev: false, index: 0 });
    expect(oneAtATime({ at: 7, list })).toEqual({ candidate: list[2], hasNext: false, hasPrev: true, index: 2 });
    expect(oneAtATime({ at: -1, list })!.index).toBe(0);
  });

  it("answers null for nothing left", () => {
    expect(oneAtATime({ at: 0, list: [] })).toBe(null);
  });
});

describe("definePress", () => {
  const candidate = readOne({});

  it("presses all of the options, with or without the one that leads", () => {
    expect(definePress({ candidate, choice: { first: null, kind: "all" }, word: "yes" })).toEqual({
      slots: { candidate: "c-002" },
      slug: "workstream-define-all",
    });
    expect(definePress({ candidate, choice: { first: "owned-and-read", kind: "all" }, word: null })).toEqual({
      slots: { candidate: "c-002", option: "owned-and-read" },
      slug: "workstream-define-all-first",
    });
  });

  it("presses nothing for a not-mine or for what already stands", () => {
    expect(definePress({ candidate, choice: { first: null, kind: "all" }, word: "no" })).toBe(null);
    const standing = readOne({
      definition: {
        iso: "2026-10-02T13:10:00.000Z",
        selection: {
          kind: "option",
          lens: "people",
          optionId: "owned-and-read",
          stretch: null,
          text: "Each postmortem has a named owner",
          tradeoff: "slower to reach",
        },
      },
    });
    const choice = standingChoice({ candidate: standing })!;
    expect([choice, definePress({ candidate: standing, choice, word: "yes" })]).toEqual([
      { kind: "option", optionId: "owned-and-read" },
      null,
    ]);
  });

  it("opens on no choice when what stands is in the owner's own words, which the page shows but never re-records", () => {
    const standing = readOne({
      definition: { iso: "2026-10-02T13:10:00.000Z", selection: { kind: "words", stretch: null, text: "caught" } },
    });
    expect([standing.definition, standingChoice({ candidate: standing })]).toEqual([
      { kind: "words", stretch: null, text: "caught" },
      null,
    ]);
  });
});

describe("placingPress", () => {
  const candidate = readOne({});

  it("names the register entry a placing word lands on, and presses nothing without one", () => {
    expect(placingPress({ candidate, choice: { kind: "outcome-of", target: "merge-gate" } })).toEqual({
      slots: { candidate: "c-002", target: "merge-gate" },
      slug: "workstream-outcome-of",
    });
    expect(placingPress({ candidate, choice: { kind: "same-as", target: "" } })).toBe(null);
    expect(
      placingPress({ candidate, choice: { kind: "accept-steer", steer: "2026-10-02: ratchet [talk:x]" } }),
    ).toEqual({
      slots: { candidate: "c-002", steer: "2026-10-02: ratchet [talk:x]" },
      slug: "workstream-accept-steer",
    });
    expect(placingPress({ candidate, choice: { kind: "accept-steer", steer: "" } })).toBe(null);
  });

  it("records a not-mine by the register entry that covers it, and nothing without one", () => {
    expect([
      placingPress({ candidate, choice: { coveredBy: "merge-gate", kind: "not-mine" } }),
      placingPress({ candidate, choice: { coveredBy: "", kind: "not-mine" } }),
    ]).toEqual([{ slots: { candidate: "c-002", target: "merge-gate" }, slug: "workstream-not-mine-covered" }, null]);
  });
});

describe("answeredLine", () => {
  it("says the word and everything it names", () => {
    expect(
      [
        readOne({ milestoneOf: "pool-e2e", reaction: "milestone-of" }),
        readOne({ reaction: "superseded", supersededBy: "the pool rewrite" }),
        readOne({ coveredBy: "merge-gate", owner: "the platform team", reaction: "no" }),
        readOne({ reaction: "no", reason: "I'm not driving it" }),
        readOne({ reaction: "yes", steer: "ratchet everything to three hundred lines" }),
        readOne({ heard: "not a workstream, it's a bug fix", reaction: "no" }),
        readOne({ heard: "the tool was dropped", reaction: "abandoned", reason: "the tool was dropped" }),
        readOne({}),
      ].map((candidate) => answeredLine({ candidate })),
    ).toEqual([
      "milestone of pool-e2e",
      "superseded by the pool rewrite",
      "not mine · the platform team's · covered by merge-gate",
      'not mine · "I\'m not driving it"',
      'accepted · answers "ratchet everything to three hundred lines"',
      'not mine · "not a workstream, it\'s a bug fix"',
      'abandoned · "the tool was dropped"',
      "unanswered",
    ]);
  });
});

describe("candidatesSummary", () => {
  it("names unanswered always, a word once the owner has used it, and only the debts the seat has", () => {
    expect(candidatesSummary({ view: viewOf({ candidates: three }) })).toBe(
      "3 candidates, 1 unanswered: 1 accepted · 1 not mine. The seat owes 1 proposal to mine, 1 story.",
    );
  });

  it("says the seat owes nothing when it owes nothing, and pluralises each debt", () => {
    const clear = { ...viewOf({ candidates: three }), proposalOwed: [], storyOwed: [] };
    expect(candidatesSummary({ view: clear })).toBe(
      "3 candidates, 1 unanswered: 1 accepted · 1 not mine. The seat owes nothing.",
    );
    const owing = {
      ...clear,
      counts: { ...ZERO, unanswered: 3 },
      definitionOwed: ["c-001"],
      placementOwed: ["c-002", "c-003"],
      promotionOwed: ["c-002"],
      retractions: ["c-001", "c-003"],
      storyOwed: ["a", "b"],
    };
    expect(candidatesSummary({ view: owing })).toBe(
      "3 candidates, 3 unanswered. The seat owes 1 promotion, 1 definition, 2 placements, 2 stories, 2 retractions.",
    );
  });
});

describe("candidatePeriod", () => {
  it("spans first to last, and is one date when they are the same day", () => {
    expect(candidatePeriod({ candidate: readOne({}) })).toBe("2026-08-01 to 2026-09-10");
    expect(candidatePeriod({ candidate: readOne({ first: "2026-06-01", last: "2026-06-01" }) })).toBe("2026-06-01");
  });
});

describe("the mined provenance", () => {
  it("reads a mine's provenance, and an explicit null before any mine", () => {
    expect(viewOf({ candidates: three }).mined).toEqual({
      minedFrom: "the owner's Slack messages and session transcripts",
      minedIso: "2026-10-02T13:00:00.000Z",
      minedSources: [{ recordsRead: 412, source: "notion" }],
    });
    const unmined = readWorkstreamCandidates({ payload: { ...documentOf({ candidates: three }), mined: null } })!;
    expect(unmined.mined).toBe(null);
    expect(unmined.candidates.length).toBe(3);
  });

  it("refuses a document with no mined field, or a mined object missing a field", () => {
    const { mined: _dropped, ...noMined } = documentOf({ candidates: three });
    expect(readWorkstreamCandidates({ payload: noMined })).toBe(undefined);
    const halfMined = {
      ...documentOf({ candidates: three }),
      mined: { minedFrom: "x", minedSources: [] },
    };
    expect(readWorkstreamCandidates({ payload: halfMined })).toBe(undefined);
  });

  it("says the proposals are the owner's own words, and names the mine when there was one", () => {
    const unmined = readWorkstreamCandidates({ payload: { ...documentOf({ candidates: three }), mined: null } })!;
    expect(provenanceLine({ view: unmined })).toBe(
      "Proposed from your words: the outcomes you have stated. Keep each you still want; nothing is kept until you do.",
    );
    expect(provenanceLine({ view: viewOf({ candidates: three }) })).toBe(
      `Proposed from your words: the outcomes you have stated, then mined from the owner's Slack messages and session transcripts on ${shortDate({ date: "2026-10-02" })} (notion 412 records), ranked by how much of your own words back each.`,
    );
  });
});
