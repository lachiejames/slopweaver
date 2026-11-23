import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { candidateCatalog } from "../../../workstreams/candidateCatalog.js";
import { owedLists } from "../../../workstreams/candidateOwed.js";
import { parseCandidatesFile } from "../../../workstreams/candidates.js";
import type { DefinitionRow } from "../../../workstreams/definitions.js";
import { NO_PLACEMENT, placementNote } from "../../../workstreams/placement.js";
import type { CandidateState } from "../../../workstreams/reactionFold.js";
import { DONE_MILESTONE_ID } from "../../../workstreams/store/doneMilestoneId.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";
import { SYNTHETIC_STATED } from "../../statedCandidatesFixture.js";
import { validCandidates } from "./candidatesFixture.js";
import { registerWorkstreams } from "./registerWorkstreamsFixture.js";

const catalog = unwrap(
  candidateCatalog({ mined: unwrap(parseCandidatesFile({ value: validCandidates() })), stated: SYNTHETIC_STATED }),
);
const candidate = catalog.candidates.find((one) => one.id === "c-002")!;

/**
 * A standing word on the candidate, every field not named at `null`.
 *
 * @returns the state
 */
function standing({ over }: { over: Partial<CandidateState> }): CandidateState {
  return { ...NO_PLACEMENT, heard: null, promotedAs: null, reactedIso: null, reaction: null, via: null, ...over };
}

describe("owedLists", () => {
  it("owes a register entry for a yes the register does not hold, and nothing once it does", () => {
    const workstreams = registerWorkstreams();
    const yes = standing({ over: { reaction: "yes" } });
    expect(owedLists({ candidate, held: undefined, standing: undefined, state: yes, workstreams })).toEqual([
      "promotionOwed",
    ]);
    expect(owedLists({ candidate, held: "merge-gate", standing: undefined, state: yes, workstreams })).toEqual([]);
  });

  it("owes an ending for an abandoned word whose held workstream carries none", () => {
    const workstreams = registerWorkstreams();
    const abandoned = standing({ over: { reaction: "abandoned" } });
    expect(owedLists({ candidate, held: "old-thing", standing: undefined, state: abandoned, workstreams })).toEqual([
      "promotionOwed",
    ]);
    // A local entry has no timeline to carry an ending on, so it owes one just the same.
    expect(owedLists({ candidate, held: "the-tool", standing: undefined, state: abandoned, workstreams })).toEqual([
      "promotionOwed",
    ]);
  });

  it("owes a placing note until the workstream it names carries it", () => {
    const sameAs = standing({ over: { reaction: "same-as", sameAs: "merge-gate" } });
    const bare = registerWorkstreams();
    expect(owedLists({ candidate, held: undefined, standing: undefined, state: sameAs, workstreams: bare })).toEqual([
      "placementOwed",
    ]);
    const text = placementNote({ candidate, reason: null, word: "same-as" });
    const noted = bare.map((one): WorkstreamAggregate =>
      one.id === "merge-gate" ? { ...one, entries: [...one.entries, { ...one.entries[0]!, text }] } : one,
    );
    expect(owedLists({ candidate, held: undefined, standing: undefined, state: sameAs, workstreams: noted })).toEqual(
      [],
    );
  });

  it("owes a definition only on an outcome or standing workstream that has a done milestone to rename", () => {
    const yes = standing({ over: { reaction: "yes" } });
    const definition: DefinitionRow = {
      bySession: "acme-session",
      candidate: "c-002",
      iso: "2026-10-02T13:30:00.000Z",
      name: candidate.name,
      selection: { kind: "words", stretch: null, text: "every incident written up within a week" },
      via: "word",
    };
    const workstreams = registerWorkstreams();
    const doneless = workstreams.map((one): WorkstreamAggregate =>
      one.id === "merge-gate"
        ? { ...one, milestones: one.milestones.filter((milestone) => milestone.id !== DONE_MILESTONE_ID) }
        : one,
    );
    const owed = [
      { held: "merge-gate", over: workstreams },
      { held: "the-tool", over: workstreams },
      { held: "merge-gate", over: doneless },
    ].map(({ held, over }) => owedLists({ candidate, held, standing: definition, state: yes, workstreams: over }));
    expect(owed).toEqual([["definitionOwed"], [], []]);
  });

  it("files a yes since replaced by another word as a retraction", () => {
    const workstreams = registerWorkstreams();
    const notSure = standing({ over: { reaction: "not-sure" } });
    expect(owedLists({ candidate, held: "logs-scrub", standing: undefined, state: notSure, workstreams })).toEqual([
      "retractions",
    ]);
  });
});
