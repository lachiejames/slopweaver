/*
 * The console and the ledger name the same words for a candidate, and the voice relays the same subset of them.
 *
 * `site/lib/workstreamCandidatesTypes.ts` restates them because a file under `site/` reads the verb's JSON rather than
 * importing `src/`; this file, in the lane that reaches both roots, is what binds the copy.
 */

import { describe, expect, it } from "vitest";

import { REACTIONS, STANDALONE_REACTIONS } from "../../../src/workstreams/reactionWords";
import { CANDIDATE_REACTIONS, SPOKEN_REACTIONS } from "../../lib/workstreamCandidatesTypes";

describe("the console's candidate words and the ledger's agree", () => {
  it("on every word, in order", () => {
    expect(CANDIDATE_REACTIONS.length).toBeGreaterThan(0);
    expect([...CANDIDATE_REACTIONS]).toEqual([...REACTIONS]);
  });

  it("on the words the voice relays, which name no target", () => {
    expect([...SPOKEN_REACTIONS]).toEqual([...STANDALONE_REACTIONS]);
    expect(
      SPOKEN_REACTIONS.filter((word) => ["same-as", "milestone-of", "outcome-of", "superseded"].includes(word)),
    ).toEqual([]);
  });
});
