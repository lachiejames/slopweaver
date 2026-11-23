/**
 * The definition of done as a milestone: authored at promotion, renamed in place by a redefinition, and waited on by a
 * milestone placed before it — the store's answer to a promoted candidate that used to start with none.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { DefinitionRow } from "../../../../workstreams/definitions.js";
import {
  DONE_MILESTONE_ID,
  placeBeforeDone,
  promotedDoneMilestone,
  redefineDone,
} from "../../../../workstreams/store/doneMilestone.js";
import { WorkstreamStoreErrors } from "../../../../workstreams/store/errors.js";
import { STORE_INTEGER_MAX } from "../../../../workstreams/store/storable.js";
import type { WorkstreamAggregate } from "../../../../workstreams/store/types.js";
import { aggregateProblems } from "../../../../workstreams/store/validation.js";
import { acmeOutcome } from "../../../workstreamStoreFixtures.js";

const CANDIDATE = { id: "acme-onboarding", outcome: "every acme team onboarded" };

/** A definition the owner gave in their own words. */
const DEFINITION: DefinitionRow = {
  bySession: "session-fixture",
  candidate: "acme-onboarding",
  iso: "2026-11-07T04:33:00.000Z",
  name: "Acme onboarding",
  selection: { kind: "words", stretch: null, text: "three acme teams live on the platform" },
  via: "console",
};

const NOTE_ID = "00000000-0000-4000-8000-0000000000d1";
const NOTE_ID_2 = "00000000-0000-4000-8000-0000000000d4";

/**
 * `acmeOutcome` with its final milestone as the definition of done.
 *
 * @returns the aggregate
 */
function withDone(): WorkstreamAggregate {
  const base = acmeOutcome();
  return {
    ...base,
    milestones: base.milestones.map((one) => (one.id === "rollout" ? { ...one, id: DONE_MILESTONE_ID } : one)),
  };
}

describe("promotedDoneMilestone", () => {
  it("names it the definition the owner picked and anchors it where they said yes", () => {
    expect(
      unwrap(promotedDoneMilestone({ candidate: CANDIDATE, definition: DEFINITION, reactionAnchor: "talk:fixture#9" })),
    ).toEqual({
      after: [],
      anchor: "talk:fixture#9",
      id: "done",
      name: "three acme teams live on the platform",
      position: 0,
    });
  });

  it("falls to the candidate's outcome with no definition, and to the candidate itself for a press with no anchor", () => {
    expect(unwrap(promotedDoneMilestone({ candidate: CANDIDATE, definition: null, reactionAnchor: null }))).toEqual({
      after: [],
      anchor: "candidate:acme-onboarding",
      id: "done",
      name: "every acme team onboarded",
      position: 0,
    });
  });

  it("makes a promoted outcome workstream the store accepts", () => {
    const done = unwrap(promotedDoneMilestone({ candidate: CANDIDATE, definition: null, reactionAnchor: null }));
    const aggregate = acmeOutcome({ entries: [], milestones: [done] });

    expect(aggregateProblems({ aggregate, knownWorkstreamIds: new Set([aggregate.id]) })).toEqual([]);
  });

  it("refuses an anchor the store cannot hold, and a blank one", () => {
    const nul = unwrapErr(promotedDoneMilestone({ candidate: CANDIDATE, definition: null, reactionAnchor: "\u0000" }));
    const blank = unwrapErr(promotedDoneMilestone({ candidate: CANDIDATE, definition: null, reactionAnchor: " " }));

    expect([nul.problems, blank.problems]).toEqual([
      ["acme-onboarding milestone done.anchor carries U+0000 or a lone surrogate"],
      ["acme-onboarding milestone done needs a name and the anchor where the owner named it"],
    ]);
  });
});

describe("redefineDone", () => {
  it("renames done in place, keeps its id and edges, sets the outcome and appends one note", () => {
    const redefined = unwrap(
      redefineDone({ aggregate: withDone(), anchor: "talk:fixture#10", definition: DEFINITION, entryId: NOTE_ID }),
    );

    expect(redefined.milestones.map((one) => [one.id, one.name, one.anchor, one.after])).toEqual([
      ["scope", "Scope agreed", "talk:fixture#1", []],
      ["pilot", "Pilot live", "talk:fixture#2", []],
      ["done", "three acme teams live on the platform", "talk:fixture#10", ["pilot", "scope"]],
    ]);
    expect(redefined.outcome).toBe("three acme teams live on the platform");
    expect(redefined.entries.at(-1)).toEqual({
      date: "2026-11-07",
      done: false,
      href: null,
      id: NOTE_ID,
      kind: "note",
      milestoneId: null,
      position: 2,
      text: 'Definition of done: "three acme teams live on the platform", in their own words',
    });
  });

  it("appends nothing on a retry, even after a later entry", () => {
    const once = unwrap(
      redefineDone({ aggregate: withDone(), anchor: "talk:fixture#10", definition: DEFINITION, entryId: NOTE_ID }),
    );
    const later: WorkstreamAggregate = {
      ...once,
      entries: [
        ...once.entries,
        {
          date: "2026-11-08",
          done: false,
          href: null,
          id: "00000000-0000-4000-8000-0000000000d2",
          kind: "note",
          milestoneId: null,
          position: 3,
          text: "pilot widened",
        },
      ],
    };
    const again = unwrap(
      redefineDone({
        aggregate: later,
        anchor: "talk:fixture#10",
        definition: DEFINITION,
        entryId: "00000000-0000-4000-8000-0000000000d3",
      }),
    );

    expect(again).toBe(later);
  });

  it("refuses an aggregate whose last milestone is not done, and one with no done at all", () => {
    const notLast = withDone();
    const reordered = {
      ...notLast,
      milestones: notLast.milestones.map((one) => (one.id === "scope" ? { ...one, position: 9 } : one)),
    };

    expect([
      unwrapErr(redefineDone({ aggregate: acmeOutcome(), anchor: "a", definition: DEFINITION, entryId: NOTE_ID })),
      unwrapErr(redefineDone({ aggregate: reordered, anchor: "a", definition: DEFINITION, entryId: NOTE_ID })),
    ]).toEqual([
      WorkstreamStoreErrors.invalid({ problems: ["acme-onboarding carries 0 milestones with the id done, not one"] }),
      WorkstreamStoreErrors.invalid({
        problems: ["acme-onboarding's done milestone is not its last, so it is not the definition of done"],
      }),
    ]);
  });

  it("answers a later definition with a second note, and a retry of it with nothing", () => {
    const first = unwrap(
      redefineDone({ aggregate: withDone(), anchor: "talk:fixture#10", definition: DEFINITION, entryId: NOTE_ID }),
    );
    const later: DefinitionRow = {
      ...DEFINITION,
      selection: { kind: "words", stretch: null, text: "five acme teams" },
    };
    const second = unwrap(
      redefineDone({ aggregate: first, anchor: "talk:fixture#11", definition: later, entryId: NOTE_ID_2 }),
    );
    const retried = unwrap(
      redefineDone({
        aggregate: second,
        anchor: "talk:fixture#11",
        definition: later,
        entryId: "00000000-0000-4000-8000-0000000000d3",
      }),
    );

    expect(second.entries.slice(-2).map((one) => [one.id, one.position, one.text])).toEqual([
      [NOTE_ID, 2, 'Definition of done: "three acme teams live on the platform", in their own words'],
      [NOTE_ID_2, 3, 'Definition of done: "five acme teams", in their own words'],
    ]);
    expect(retried).toBe(second);
  });

  it("refuses a note past the largest position the store holds", () => {
    const base = withDone();
    const full = { ...base, entries: base.entries.map((one) => ({ ...one, position: STORE_INTEGER_MAX })) };

    expect(
      unwrapErr(redefineDone({ aggregate: full, anchor: "a", definition: DEFINITION, entryId: NOTE_ID })).problems,
    ).toEqual(["acme-onboarding's entries already reach the largest position the store holds"]);
  });
});

describe("placeBeforeDone", () => {
  it("refuses an aggregate with no definition of done to place before", () => {
    expect(
      unwrapErr(
        placeBeforeDone({
          aggregate: acmeOutcome(),
          milestone: { after: [], anchor: "a", id: "billing", name: "Billing live" },
        }),
      ).problems,
    ).toEqual(["acme-onboarding carries 0 milestones with the id done, not one"]);
  });

  it("places the milestone immediately before done, re-deals positions from 0, and makes done wait on it", () => {
    const placed = unwrap(
      placeBeforeDone({
        aggregate: withDone(),
        milestone: { after: ["scope"], anchor: "talk:fixture#11", id: "billing", name: "Billing live" },
      }),
    );

    expect(placed.milestones.map((one) => [one.id, one.position, one.after])).toEqual([
      ["scope", 0, []],
      ["pilot", 1, []],
      ["billing", 2, ["scope"]],
      ["done", 3, ["billing", "pilot", "scope"]],
    ]);
    expect(aggregateProblems({ aggregate: placed, knownWorkstreamIds: new Set([placed.id]) })).toEqual([]);
  });

  it("refuses a milestone id the workstream already carries", () => {
    expect(
      unwrapErr(
        placeBeforeDone({
          aggregate: withDone(),
          milestone: { after: [], anchor: "a", id: "pilot", name: "Pilot again" },
        }),
      ),
    ).toEqual(
      WorkstreamStoreErrors.invalid({ problems: ["acme-onboarding already carries a milestone with the id pilot"] }),
    );
  });

  it("refuses a milestone that would wait on done, which would wait on it in turn", () => {
    const promoted = acmeOutcome({
      entries: [],
      milestones: [unwrap(promotedDoneMilestone({ candidate: CANDIDATE, definition: null, reactionAnchor: null }))],
    });

    expect(
      unwrapErr(
        placeBeforeDone({
          aggregate: promoted,
          milestone: { after: ["done"], anchor: "talk:fixture#11", id: "billing", name: "Billing live" },
        }),
      ).problems,
    ).toEqual(["billing would wait on done, which waits on it; a milestone placed before done cannot follow it"]);
  });

  it("refuses whatever else the store would, judged by the store's own rules", () => {
    const error = unwrapErr(
      placeBeforeDone({
        aggregate: withDone(),
        milestone: { after: ["nowhere"], anchor: "talk:fixture#12", id: "billing", name: "Billing live" },
      }),
    );

    expect(error.code).toBe("WORKSTREAM_INVALID");
    expect(error.problems.length).toBeGreaterThan(0);
    expect(error.message).toContain("nowhere");
  });
});
