/*
 * The relay's candidate-ruling and check-in-verdict arguments, refused when half a pair or not the owner's (split out of
 * `talkToolRun.test.ts` to keep that file under the size ratchet).
 */
import { describe, expect, it } from "vitest";

import { candidateRulingOf, checkInVerdictOf } from "../../components/voice/talkToolRunArgs";

describe("candidateRulingOf", () => {
  it("takes neither or both, and refuses half a pair, an id that is not one, a word not the owner's, or a check-in beside it", () => {
    expect(candidateRulingOf({ args: { say: "x" } })).toEqual({ ruling: undefined });
    expect(candidateRulingOf({ args: { candidate: "c-101", reaction: "yes" } })).toEqual({
      ruling: { candidate: "c-101", reaction: "yes" },
    });
    expect(candidateRulingOf({ args: { reaction: "no" } })).toEqual({
      why: "candidate must be the id of the workstream candidate you read the owner, such as c-105, beside reaction",
    });
    expect(candidateRulingOf({ args: { candidate: "C 105", reaction: "no" } })).toEqual({
      why: "candidate must be the id of the workstream candidate you read the owner, such as c-105, beside reaction",
    });
    expect(candidateRulingOf({ args: { candidate: "c-105", reaction: "maybe" } })).toEqual({
      why: "reaction must be one of yes, no, sort-of, not-sure, lets-talk, done, abandoned, beside candidate",
    });
    expect(candidateRulingOf({ args: { candidate: "c-105", check_in: "act:ev-2", reaction: "no" } })).toEqual({
      why: "a relay carries one ruling: candidate with reaction, or check_in with covers, never both",
    });
  });
});

describe("checkInVerdictOf", () => {
  it("refuses half a verdict, a key that is not an act, and a reach outside the two", () => {
    expect(checkInVerdictOf({ args: { check_in: "act:ev-2" } })).toEqual({
      why: "covers must be rule or this, beside check_in",
    });
    expect(checkInVerdictOf({ args: { covers: "this" } })).toEqual({
      why: "check_in must be the act:<id> key of the check-in you read the owner, beside covers",
    });
    expect(checkInVerdictOf({ args: { check_in: "ask:a-row", covers: "rule" } })).toEqual({
      why: "check_in must be the act:<id> key of the check-in you read the owner, beside covers",
    });
    expect(checkInVerdictOf({ args: { check_in: "act:ev-2", covers: "all" } })).toEqual({
      why: "covers must be rule or this, beside check_in",
    });
  });
});
