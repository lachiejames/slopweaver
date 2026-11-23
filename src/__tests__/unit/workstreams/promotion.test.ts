import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { candidateCatalog } from "../../../workstreams/candidateCatalog.js";
import { parseCandidatesFile, STORY_OWED } from "../../../workstreams/candidates.js";
import type { DefinitionRow } from "../../../workstreams/definitions.js";
import { closingFrom, NO_PLACEMENT, type Placement } from "../../../workstreams/placement.js";
import { firstRegister, planReactions } from "../../../workstreams/promotion.js";
import type { ReactionPick } from "../../../workstreams/reactionBatch.js";
import { typedWorkstreamDetail } from "../../../workstreams/store/decode.js";
import { DONE_MILESTONE_ID } from "../../../workstreams/store/doneMilestone.js";
import { judgeProposedAggregate } from "../../../workstreams/store/judge.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";
import { SYNTHETIC_STATED } from "../../statedCandidatesFixture.js";
import { validCandidates } from "./candidatesFixture.js";
import { registerWorkstreams } from "./registerWorkstreamsFixture.js";
import { countingMintId, mintedId, REGISTER_META } from "./storeRegisterFixture.js";

const file = unwrap(parseCandidatesFile({ value: validCandidates() }));
/** The one catalog every verb plans against: the owner's stated outcomes, then the fixture's mined candidates. */
const catalog = unwrap(candidateCatalog({ mined: file, stated: SYNTHETIC_STATED }));
const workstreams = registerWorkstreams();
const ANCHOR = "talk-call:x#turn_y";

/** Plan the owner's picks against the fixture register, with no earlier rows, relayed from a talk call. */
function plan({
  picks,
  reason,
  definitions = new Map(),
  placement = NO_PLACEMENT,
  titles = new Map(),
  over = workstreams,
}: {
  picks: readonly ReactionPick[];
  reason: string | null;
  definitions?: ReadonlyMap<string, DefinitionRow>;
  placement?: Placement;
  titles?: ReadonlyMap<string, string>;
  over?: readonly WorkstreamAggregate[];
}): ReturnType<typeof planReactions> {
  return planReactions({
    anchor: ANCHOR,
    bySession: "test",
    catalog,
    definitions,
    heard: "the owner's words",
    held: [],
    meta: REGISTER_META,
    mintId: countingMintId(),
    nowIso: "2026-10-02T13:00:00.000Z",
    picks,
    placement,
    reason,
    titles,
    via: "word",
    workstreams: over,
  });
}

/** The note a placing word leaves, dated the fixture's day, before it takes an id and a position. */
function note({ text }: { text: string }): {
  date: string;
  done: false;
  href: null;
  kind: "note";
  milestoneId: null;
  text: string;
} {
  return { date: "2026-10-02", done: false, href: null, kind: "note", milestoneId: null, text };
}

/** The fixture's c-002 cited evidence as the entries a new workstream starts with, ids minted from 1. */
const C002_ENTRIES = [
  {
    date: "2026-07-02",
    done: false,
    href: "https://example.slack.com/archives/C0SYNINCIDENTS/p1782000000000100",
    id: mintedId({ n: 1 }),
    kind: "raised",
    milestoneId: null,
    position: 0,
    text: "postmortems keep slipping",
  },
  {
    date: "2026-07-09",
    done: false,
    href: null,
    id: mintedId({ n: 2 }),
    kind: "discussion",
    milestoneId: null,
    position: 1,
    text: "we never write them [owner-turn:owner-turn-12.txt]",
  },
] as const;

describe("planReactions placing words", () => {
  it("keeps a done candidate as a closing workstream under the title it was given, with the owner's reason, and refuses a held one", () => {
    const planned = unwrap(
      plan({
        picks: [{ candidate: "c-002", reaction: "done" }],
        placement: { ...NO_PLACEMENT, reason: "moved on long ago" },
        reason: null,
        titles: new Map([["c-002", "Postmortems"]]),
      }),
    );
    expect(planned.added).toEqual([
      {
        detail: {
          closedOn: "2026-10-02",
          ending: null,
          holding: "not yet asked — the Workstreams seat checks it is still holding",
          people: [{ part: "leads on-call, so owns whether a postmortem gets written", slack: "U0SYNTESTAAA1" }],
          state: "done — moved on long ago (the owner marked it done on 2026-10-02, from the mined candidates)",
        },
        entries: C002_ENTRIES,
        id: "postmortems",
        kind: "closing",
        links: [],
        milestones: [],
        name: "Postmortems",
        outcome: "Every incident gets a written postmortem",
        status: null,
        workspace: "team",
      },
    ]);
    // Its evidence cites #incidents, which the register document does not name yet.
    expect(planned.channels).toEqual({ C0SYNINCIDENTS: "#incidents" });
    expect(planned.promoted).toEqual([{ as: "postmortems", candidate: "c-002" }]);
    const held = plan({ picks: [{ candidate: "c-001", reaction: "done" }], reason: null });
    expect(unwrapErr(held).message).toBe(
      "nothing recorded — c-001 is already on the register as merge-gate; marking that entry done is the seat's",
    );
  });

  it("never closes a done candidate before its own evidence, so a UTC day behind the owner's local one still stores", () => {
    const candidate = file.candidates.find((one) => one.id === "c-002")!;
    const mintId = countingMintId();
    const closing = closingFrom({
      candidate,
      id: "postmortems",
      mintId,
      nowIso: "2026-07-08T22:00:00.000Z",
      reason: null,
    });
    expect(typedWorkstreamDetail({ aggregate: closing }).kind).toBe("closing");
    expect(closing.detail["closedOn"]).toBe("2026-07-09");
    expect(unwrap(judgeProposedAggregate({ aggregate: closing })).id).toBe("postmortems");
    const later = closingFrom({
      candidate,
      id: "postmortems",
      mintId,
      nowIso: "2026-10-02T13:00:00.000Z",
      reason: null,
    });
    expect(later.detail["closedOn"]).toBe("2026-10-02");
  });

  it("files an outcome-of as a note on the workstream it names, and a milestone-of as a note and a milestone", () => {
    const outcome = unwrap(
      plan({
        picks: [{ candidate: "c-002", reaction: "outcome-of" }],
        placement: { ...NO_PLACEMENT, outcomeOf: "logs-scrub", reason: "a side product" },
        reason: null,
      }),
    );
    expect(outcome.placed).toEqual([{ as: "logs-scrub", candidate: "c-002", word: "outcome-of" }]);
    expect(outcome.marks.get("logs-scrub")).toEqual({
      milestones: [],
      notes: [
        note({
          text:
            'The owner filed mined candidate c-002 "Postmortems that happen" as an outcome of this workstream, not a ' +
            "workstream of its own: a side product",
        }),
      ],
    });
    const milestone = unwrap(
      plan({
        picks: [{ candidate: "c-002", reaction: "milestone-of" }],
        placement: { ...NO_PLACEMENT, milestoneOf: "deps" },
        reason: null,
      }),
    );
    expect(milestone.marks.get("deps")!.milestones).toEqual([
      { after: [], anchor: "mined candidate c-002", id: "c-002", name: "Postmortems that happen" },
    ]);
  });

  it("refuses a placing word naming no workstream, one not on the register, or one with no story", () => {
    const missing = plan({
      picks: [{ candidate: "c-002", reaction: "same-as" }],
      placement: { ...NO_PLACEMENT, sameAs: "nowhere" },
      reason: null,
    });
    expect(unwrapErr(missing).message).toBe("nothing recorded — --same-as nowhere is not a workstream on the register");
    const local = plan({
      picks: [{ candidate: "c-002", reaction: "milestone-of" }],
      placement: { ...NO_PLACEMENT, milestoneOf: "the-tool" },
      reason: null,
    });
    expect(unwrapErr(local).message).toBe(
      "nothing recorded — the-tool is a local entry, which has no timeline to file c-002 on",
    );
  });

  it("files an outcome-of on a closing workstream's story, and refuses a milestone-of inside one", () => {
    const outcome = unwrap(
      plan({
        picks: [{ candidate: "c-002", reaction: "outcome-of" }],
        placement: { ...NO_PLACEMENT, outcomeOf: "old-thing" },
        reason: null,
      }),
    );
    expect(outcome.marks.get("old-thing")).toEqual({
      milestones: [],
      notes: [
        note({
          text:
            'The owner filed mined candidate c-002 "Postmortems that happen" as an outcome of this workstream, not a ' +
            "workstream of its own",
        }),
      ],
    });
    const milestone = plan({
      picks: [{ candidate: "c-002", reaction: "milestone-of" }],
      placement: { ...NO_PLACEMENT, milestoneOf: "old-thing" },
      reason: null,
    });
    expect(unwrapErr(milestone).message).toBe(
      "nothing recorded — old-thing is a closing entry, which has no milestones to file c-002 inside",
    );
  });

  it("leaves the steer a yes answers as a note on the workstream, new or already held", () => {
    const planned = unwrap(
      plan({
        picks: [
          { candidate: "c-001", reaction: "yes" },
          { candidate: "c-002", reaction: "yes" },
        ],
        placement: { ...NO_PLACEMENT, steer: "the pool steer" },
        reason: null,
      }),
    );
    const steer = note({ text: "The owner accepted this as the steer they had already given: the pool steer" });
    expect([...planned.marks]).toEqual([
      ["merge-gate", { milestones: [], notes: [steer] }],
      ["postmortems-that-happen", { milestones: [], notes: [steer] }],
    ]);
  });
});

describe("planReactions", () => {
  it("ends the workstream an abandoned candidate is held under, adding none", () => {
    const planned = unwrap(
      plan({ picks: [{ candidate: "c-001", reaction: "abandoned" }], reason: "the tool was dropped" }),
    );
    expect(planned.ended).toEqual([{ as: "merge-gate", candidate: "c-001" }]);
    expect([...planned.endings]).toEqual([
      ["merge-gate", { anchor: ANCHOR, kind: "abandoned", on: "2026-10-02", reason: "the tool was dropped" }],
    ]);
    expect(planned.added).toEqual([]);
    expect(planned.rows.map((row) => [row.candidate, row.promotedAs, row.reason, row.heard])).toEqual([
      ["c-001", null, "the tool was dropped", "the owner's words"],
    ]);
  });

  it("adds one workstream per unheld yes, notes a held one, and writes a row for every word", () => {
    const planned = unwrap(
      plan({
        picks: [
          { candidate: "c-001", reaction: "yes" },
          { candidate: "c-002", reaction: "yes" },
          { candidate: "c-003", reaction: "no" },
        ],
        reason: null,
      }),
    );
    expect(planned.alreadyHeld).toEqual([{ as: "merge-gate", candidate: "c-001" }]);
    expect(planned.promoted).toEqual([{ as: "postmortems-that-happen", candidate: "c-002" }]);
    expect(planned.rows.map((row) => [row.candidate, row.reaction, row.promotedAs])).toEqual([
      ["c-001", "yes", null],
      ["c-002", "yes", "postmortems-that-happen"],
      ["c-003", "no", null],
    ]);
  });

  // The proof the cutover owes: a promoted yes is an aggregate the store accepts, its last milestone `done`, named the
  // candidate's outcome and anchored where it was said.
  it("promotes a yes as a standing workstream whose one milestone is done, named its outcome, at the owner's anchor", () => {
    const planned = unwrap(plan({ picks: [{ candidate: "c-002", reaction: "yes" }], reason: null }));
    const candidate = file.candidates.find((one) => one.id === "c-002")!;
    expect(planned.added).toEqual([
      {
        detail: {
          agreedBy: STORY_OWED,
          boardMembership: candidate.boardMembership,
          ending: null,
          feedback: [],
          initiative: null,
          numbers: STORY_OWED,
          people: [{ part: "leads on-call, so owns whether a postmortem gets written", slack: "U0SYNTESTAAA1" }],
          priority: null,
          skeptic: null,
          statusNote: "the owner's yes on 2026-10-02, from the mined candidates",
          tags: ["mined", "mined:c-002", "reliability-incidents"],
          team: STORY_OWED,
          waitingOn: null,
        },
        entries: C002_ENTRIES,
        id: "postmortems-that-happen",
        kind: "standing",
        links: [],
        milestones: [
          {
            after: [],
            anchor: ANCHOR,
            id: DONE_MILESTONE_ID,
            name: "Every incident gets a written postmortem",
            position: 0,
          },
        ],
        name: "Postmortems that happen",
        outcome: "Every incident gets a written postmortem",
        status: "discovery",
        workspace: "team",
      },
    ]);
    expect(unwrap(judgeProposedAggregate({ aggregate: planned.added[0]! })).milestones.at(-1)!.id).toBe(
      DONE_MILESTONE_ID,
    );
  });

  it("refuses the whole batch on an id no candidate carries", () => {
    const planned = plan({ picks: [{ candidate: "c-999", reaction: "yes" }], reason: null });
    expect(unwrapErr(planned).message).toBe("nothing recorded — no candidate has the id c-999");
  });

  it("names the done milestone of a new workstream the definition picked before the yes, with a dated note", () => {
    const definitions = new Map([["c-002", definition({ candidate: "c-002", text: "Postmortems are owned" })]]);
    const planned = unwrap(plan({ definitions, picks: [{ candidate: "c-002", reaction: "yes" }], reason: null }));
    const added = planned.added[0]!;
    expect([added.kind, added.outcome]).toEqual(["standing", "Postmortems are owned"]);
    expect(added.milestones).toEqual([
      { after: [], anchor: ANCHOR, id: DONE_MILESTONE_ID, name: "Postmortems are owned", position: 0 },
    ]);
    expect(added.entries.at(-1)).toEqual({
      date: "2026-10-01",
      done: false,
      href: null,
      id: mintedId({ n: 3 }),
      kind: "note",
      milestoneId: null,
      position: 2,
      text: 'Definition of done: "Postmortems are owned", in their own words',
    });
    expect(planned.updated.size).toBe(0);
  });

  it("carries a definition onto a held outcome's done milestone on a repeated yes, once, every id it held kept", () => {
    const definitions = new Map([["c-001", definition({ candidate: "c-001", text: "Main is never red" })]]);
    const planned = unwrap(plan({ definitions, picks: [{ candidate: "c-001", reaction: "yes" }], reason: null }));
    expect([...planned.updated.keys()]).toEqual(["merge-gate"]);
    const carried = planned.updated.get("merge-gate")!;
    const original = workstreams.find((one) => one.id === "merge-gate")!;
    expect(carried.outcome).toBe("Main is never red");
    expect(carried.milestones.at(-1)).toEqual({
      after: ["most-batches"],
      anchor: ANCHOR,
      id: DONE_MILESTONE_ID,
      name: "Main is never red",
      position: 1,
    });
    expect(carried.entries.slice(0, original.entries.length)).toEqual(original.entries);
    expect(carried.links).toEqual(original.links);
    const again = plan({
      definitions,
      over: workstreams.map((one) => (one.id === "merge-gate" ? carried : one)),
      picks: [{ candidate: "c-001", reaction: "yes" }],
      reason: null,
    });
    expect(unwrap(again).updated.size).toBe(0);
  });
});

describe("firstRegister", () => {
  it("is a register document naming where it came from, which the first yes's workstream then fills", () => {
    const first = firstRegister({ catalog });
    expect(first).toEqual({
      channels: {},
      grouping: {
        anchor: "workstreams candidates, mined 2026-10-02",
        builtFrom: "the owner's Slack messages and session transcripts",
        label: "Proposed from your words",
        why: "started by the first workstream you kept from the proposed candidates; no initiatives declared yet",
      },
      initiatives: [],
    });
    const planned = unwrap(
      planReactions({
        anchor: null,
        bySession: "test",
        catalog,
        definitions: new Map(),
        heard: null,
        held: [],
        meta: first,
        mintId: countingMintId(),
        nowIso: "2026-10-02T14:00:00.000Z",
        picks: [{ candidate: "c-001", reaction: "yes" }],
        reason: null,
        via: "console",
        workstreams: [],
      }),
    );
    expect(planned.promoted).toEqual([{ as: "merge-gate", candidate: "c-001" }]);
    // A press carries no anchor, so the done milestone is anchored on the candidate it came from.
    expect(planned.added.map((one) => [one.id, one.milestones.at(-1)!.anchor])).toEqual([
      ["merge-gate", "candidate:c-001"],
    ]);
  });

  it("starts from the stated outcomes before any mine, and keeping one makes it a standing workstream carrying its stated outcome", () => {
    const stated = unwrap(candidateCatalog({ mined: null, stated: SYNTHETIC_STATED }));
    const first = firstRegister({ catalog: stated });
    expect([first.grouping.anchor, first.grouping.builtFrom]).toEqual([
      "workstreams candidates, the owner's stated outcomes",
      "the outcomes the owner stated, offered as candidates",
    ]);
    const kept = SYNTHETIC_STATED[0]!;
    const planned = unwrap(
      planReactions({
        anchor: null,
        bySession: "test",
        catalog: stated,
        definitions: new Map(),
        heard: null,
        held: [],
        meta: first,
        mintId: countingMintId(),
        nowIso: "2026-11-04T09:00:00.000Z",
        picks: [{ candidate: kept.id, reaction: "yes" }],
        reason: null,
        via: "console",
        workstreams: [],
      }),
    );
    const workstream = unwrap(judgeProposedAggregate({ aggregate: planned.added[0]! }));
    expect([workstream.kind, workstream.name, workstream.outcome, workstream.detail["boardMembership"]]).toEqual([
      "standing",
      kept.name,
      kept.outcome,
      kept.boardMembership,
    ]);
  });
});

/** A definition row in their own words, picked the day before the fixture's reactions. */
function definition({ candidate, text }: { candidate: string; text: string }): DefinitionRow {
  const name = file.candidates.find((one) => one.id === candidate)!.name;
  return {
    bySession: "test",
    candidate,
    iso: "2026-10-01T09:00:00.000Z",
    name,
    selection: { kind: "words", stretch: null, text },
    via: "console",
  };
}
