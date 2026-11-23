import { describe, expect, it } from "vitest";

import { candidateVerdictOf } from "../../../cli/commands/talk/relayCandidateArgs.js";
import {
  type CandidateRulingOutcome,
  candidateRulingField,
  candidateRulingLine,
  recordCandidateRuling,
} from "../../../cli/commands/talk/relayCandidateRuling.js";
import { TAIL_UNSTATED_HOLD } from "../../../talk/relayCutHold.js";
import { inMemoryWorkstreamStore } from "../../workstreamStoreFake.js";
import { countingMintId } from "../workstreams/storeRegisterFixture.js";

const DRAFT = { anchor: "talk:t", heard: "no", turnId: "a0000088-0000-4000-8000-000000000095" } as const;
/** The register seam, which neither case here reaches: one carries no ruling, the other is held before any read. */
const REGISTER = { mintId: countingMintId(), store: inMemoryWorkstreamStore({ nowIso: "2026-10-03T05:10:00.000Z" }) };

describe("candidateVerdictOf", () => {
  it("reads a candidate and the owner's word as one verdict", () => {
    const problems: string[] = [];
    const verdict = candidateVerdictOf({ candidate: "c-105", checkIn: false, problems, reaction: "no" });
    expect(verdict).toEqual({ candidate: "c-105", reaction: "no" });
    expect(problems).toEqual([]);
  });

  it("is absent when neither flag is given", () => {
    const problems: string[] = [];
    expect(candidateVerdictOf({ candidate: undefined, checkIn: false, problems, reaction: undefined })).toBe(undefined);
    expect(problems).toEqual([]);
  });

  it("refuses an id the candidates file would refuse, a trailing newline included", () => {
    const problems: string[] = [];
    const id = `${"a".repeat(80)}\n`;
    expect(candidateVerdictOf({ candidate: id, checkIn: false, problems, reaction: "no" })).toBe(undefined);
    expect(problems).toEqual([`--candidate is a candidate id such as c-105, got ${id}`]);
  });

  it("refuses one flag without the other, a word the owner has not given, and a check-in ruling beside it", () => {
    const alone: string[] = [];
    candidateVerdictOf({ candidate: "c-105", checkIn: false, problems: alone, reaction: undefined });
    expect(alone).toEqual([
      "--candidate and --reaction go together: the candidate read to the owner, and the owner's word on it",
    ]);
    const word: string[] = [];
    candidateVerdictOf({ candidate: "c-105", checkIn: false, problems: word, reaction: "maybe" });
    expect(word[0]).toContain("--reaction must be one of");
    const both: string[] = [];
    candidateVerdictOf({ candidate: "c-105", checkIn: true, problems: both, reaction: "no" });
    expect(both).toEqual([
      "talk relay carries one ruling per turn: --candidate with --reaction, or --covers, never both",
    ]);
  });
});

describe("the candidate ruling the relay reports", () => {
  const recorded: CandidateRulingOutcome = {
    kind: "recorded",
    ruling: { candidate: "c-105", promotionOwed: null, reaction: "no", written: true },
  };
  const refused: CandidateRulingOutcome = { candidate: "c-105", kind: "refused", reaction: "no", why: "busy" };

  it("is absent from the document and the operator's lines when the relay carried none", async () => {
    expect(candidateRulingField({ outcome: undefined })).toBe(null);
    expect(candidateRulingLine({ outcome: undefined })).toBe(undefined);
    expect(
      await recordCandidateRuling({
        ...REGISTER,
        args: { candidateVerdict: undefined },
        draft: DRAFT,
        hold: undefined,
        home: "/nowhere",
        nowIso: "2026-10-03T05:10:00.000Z",
      }),
    ).toBe(undefined);
  });

  // A relay made while the owner was still speaking closed or promoted the candidate.
  it("refuses a held relay's ruling with the hold's reason, before the candidates file is read", async () => {
    expect(
      await recordCandidateRuling({
        ...REGISTER,
        args: { candidateVerdict: { candidate: "c-105", reaction: "no" } },
        draft: DRAFT,
        hold: TAIL_UNSTATED_HOLD,
        home: "/nowhere",
        nowIso: "2026-10-03T05:10:00.000Z",
      }),
    ).toEqual({ candidate: "c-105", kind: "refused", reaction: "no", why: TAIL_UNSTATED_HOLD });
  });

  it("says recorded with whether this run wrote it, or not recorded with why", () => {
    expect(candidateRulingField({ outcome: recorded })).toEqual({
      candidate: "c-105",
      promotionOwed: null,
      reaction: "no",
      recorded: true,
      written: true,
    });
    expect(candidateRulingField({ outcome: refused })).toEqual({
      candidate: "c-105",
      reaction: "no",
      recorded: false,
      why: "busy",
    });
    expect(candidateRulingLine({ outcome: recorded })).toBe("  candidate c-105 now carries the owner's ruling: no");
    expect(candidateRulingLine({ outcome: refused })).toBe("  c-105 still open, no ruling recorded — busy");
  });
});
