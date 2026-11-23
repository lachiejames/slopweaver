import { describe, expect, it } from "vitest";

import type { BeliefProposal, VoiceUnit } from "../../../knowledge/voice/types.js";
import {
  countWords,
  foldRecordings,
  nextBatch,
  parseProposalLine,
  proposalId,
  reviewedUnitIds,
  type VoiceRecording,
  voiceUnitId,
} from "../../../knowledge/voice/unit.js";

/** One recording, varying only what a test cares about. */
function recording({
  text,
  source = "archive-turn",
  locator = "/tmp/owner-turn-one.txt",
  instantIso,
}: {
  text: string;
  source?: VoiceRecording["source"];
  locator?: string;
  instantIso?: string;
}): VoiceRecording {
  return { locator, source, text, ...(instantIso === undefined ? {} : { instantIso }) };
}

/** One unit, for the batching tests, which do not care where it came from. */
function unit({ id, occurrences }: { id: string; occurrences: number }): VoiceUnit {
  return {
    id,
    locator: "/tmp/x.txt",
    occurrences,
    source: "archive-turn",
    text: id,
    words: 1,
    wrapped: true,
  };
}

describe("voiceUnitId", () => {
  it("is the same for the same bytes", () => {
    expect(voiceUnitId({ text: "do we ever build up that gold" })).toBe(
      voiceUnitId({ text: "do we ever build up that gold" }),
    );
  });

  it("differs on casing, unlike a lesson id, because two wordings of the owner's are two wordings", () => {
    expect(voiceUnitId({ text: "Do we ever build up that gold" })).not.toBe(
      voiceUnitId({ text: "do we ever build up that gold" }),
    );
  });

  it("differs on spacing, for the same reason", () => {
    expect(voiceUnitId({ text: "a  b" })).not.toBe(voiceUnitId({ text: "a b" }));
  });
});

describe("proposalId", () => {
  it("merges two casings of one claim on one unit", () => {
    expect(proposalId({ claim: "Gold Is Built", unitId: "u-1" })).toBe(
      proposalId({ claim: "gold  is built", unitId: "u-1" }),
    );
  });

  it("keeps one claim read out of two different things the owner said apart", () => {
    expect(proposalId({ claim: "gold is built", unitId: "u-1" })).not.toBe(
      proposalId({ claim: "gold is built", unitId: "u-2" }),
    );
  });
});

describe("foldRecordings", () => {
  it("collapses identical bytes and counts every occurrence", () => {
    const folded = foldRecordings({
      recordings: [
        recording({ locator: "/a", text: "the same words" }),
        recording({ locator: "/b", text: "the same words" }),
        recording({ locator: "/c", text: "the same words" }),
      ],
    });
    expect(folded.length).toBe(1);
    expect(folded[0]!.occurrences).toBe(3);
  });

  it("keeps the FIRST recording's locator and source, so attribution is deterministic", () => {
    const folded = foldRecordings({
      recordings: [
        recording({ locator: "tick-1#turn-1", source: "tick-ledger", text: "the same words" }),
        recording({ locator: "/scratch/owner-turn-x.txt", source: "scratch-turn", text: "the same words" }),
      ],
    });
    expect(folded[0]!.source).toBe("tick-ledger");
    expect(folded[0]!.locator).toBe("tick-1#turn-1");
  });

  it("never lets a later copy contribute an instant the first recording did not have", () => {
    const folded = foldRecordings({
      recordings: [
        recording({ text: "the same words" }),
        recording({ instantIso: "2026-09-07T01:00:00.000Z", source: "tick-ledger", text: "the same words" }),
      ],
    });
    expect(folded[0]!.instantIso).toBeUndefined();
  });

  it("marks a turn file wrapped and a tick turn not, because only one of them is the owner's words alone", () => {
    const folded = foldRecordings({
      recordings: [
        recording({ source: "tick-ledger", text: "the owner's stripped turn" }),
        recording({ source: "archive-turn", text: "a supervisor's file around the owner's turn" }),
        recording({ source: "scratch-turn", text: "a scratch copy of one" }),
      ],
    });
    expect(folded.map((entry) => entry.wrapped)).toEqual([false, true, true]);
  });

  it("drops a recording that is only whitespace", () => {
    expect(foldRecordings({ recordings: [recording({ text: "   \n  " })] })).toEqual([]);
  });

  it("trims the unit's own edges but never inside the owner's words", () => {
    const folded = foldRecordings({ recordings: [recording({ text: "  the owner said   two things  " })] });
    expect(folded[0]!.text).toBe("the owner said   two things");
  });
});

describe("countWords", () => {
  it("counts whitespace-separated runs", () => {
    expect(countWords({ text: "one two  three\nfour" })).toBe(4);
  });

  it("counts an empty string as zero rather than one", () => {
    expect(countWords({ text: "   " })).toBe(0);
  });
});

describe("reviewedUnitIds", () => {
  it("counts an explicit nothing exactly as it counts a proposal", () => {
    const rows: readonly BeliefProposal[] = [
      { kind: "none", reviewedAtIso: "2026-09-12T00:00:00.000Z", run: "r", unitId: "u-1", why: "no claim in it" },
      {
        claim: "a claim",
        domain: "datadog",
        held: "stated-confident",
        kind: "proposed",
        proposalId: "p-1",
        quote: "the owner's words",
        reviewedAtIso: "2026-09-12T00:00:00.000Z",
        run: "r",
        unitId: "u-2",
      },
    ];
    expect([...reviewedUnitIds({ proposals: rows })].toSorted()).toEqual(["u-1", "u-2"]);
  });
});

describe("nextBatch", () => {
  it("hands over the most-repeated unreviewed units first", () => {
    const batch = nextBatch({
      reviewed: new Set(),
      size: 2,
      units: [
        unit({ id: "u-a", occurrences: 1 }),
        unit({ id: "u-b", occurrences: 9 }),
        unit({ id: "u-c", occurrences: 5 }),
      ],
    });
    expect(batch.map((entry) => entry.id)).toEqual(["u-b", "u-c"]);
  });

  it("skips a unit the queue has already answered, which is what lets a repeat run make progress", () => {
    const units = [unit({ id: "u-a", occurrences: 9 }), unit({ id: "u-b", occurrences: 5 })];
    expect(nextBatch({ reviewed: new Set(["u-a"]), size: 5, units }).map((entry) => entry.id)).toEqual(["u-b"]);
  });

  it("breaks a tie on the id, so two runs over the same units produce the same batch", () => {
    const units = [unit({ id: "u-z", occurrences: 3 }), unit({ id: "u-a", occurrences: 3 })];
    expect(nextBatch({ reviewed: new Set(), size: 2, units }).map((entry) => entry.id)).toEqual(["u-a", "u-z"]);
  });

  it("returns nothing when everything is reviewed", () => {
    expect(nextBatch({ reviewed: new Set(["u-a"]), size: 5, units: [unit({ id: "u-a", occurrences: 1 })] })).toEqual(
      [],
    );
  });
});

describe("parseProposalLine", () => {
  it("round-trips a proposed row", () => {
    const row: BeliefProposal = {
      claim: "the gold tier is being built up as the corpus grows",
      domain: "slopweaver-corpus",
      held: "stated-uncertain",
      kind: "proposed",
      proposalId: "p-abc",
      quote: "do we ever build up that gold",
      reviewedAtIso: "2026-09-12T00:00:00.000Z",
      run: "half-kept-ledger-a",
      unitId: "u-abc",
    };
    expect(parseProposalLine({ line: JSON.stringify(row) })).toEqual(row);
  });

  it("round-trips a nothing-proposed row", () => {
    const row: BeliefProposal = {
      kind: "none",
      reviewedAtIso: "2026-09-12T00:00:00.000Z",
      run: "half-kept-ledger-a",
      unitId: "u-abc",
      why: "a scheduling instruction, no claim about how anything works",
    };
    expect(parseProposalLine({ line: JSON.stringify(row) })).toEqual(row);
  });

  it("refuses a hold outside the vocabulary", () => {
    const line = JSON.stringify({
      claim: "c",
      domain: "d",
      held: "pretty sure",
      kind: "proposed",
      proposalId: "p",
      quote: "q",
      reviewedAtIso: "i",
      run: "r",
      unitId: "u",
    });
    expect(parseProposalLine({ line })).toBeUndefined();
  });

  it("refuses a nothing-proposed row with no reason, so a skip cannot masquerade as a review", () => {
    const line = JSON.stringify({ kind: "none", reviewedAtIso: "i", run: "r", unitId: "u" });
    expect(parseProposalLine({ line })).toBeUndefined();
  });

  it("refuses a line that is not JSON", () => {
    expect(parseProposalLine({ line: "{not json" })).toBeUndefined();
  });

  it("refuses an unknown kind", () => {
    expect(
      parseProposalLine({ line: JSON.stringify({ kind: "maybe", reviewedAtIso: "i", run: "r", unitId: "u" }) }),
    ).toBeUndefined();
  });
});
