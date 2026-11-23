/*
 * The console and `handover currency` name the same proof kinds, in the same order and the same words.
 *
 * `site/lib/prProof.ts` restates them because a file under `site/` reads the reading's JSON rather than importing
 * `src/`; this file, in the lane that reaches both roots, is what binds the copy.
 */

import { describe, expect, it } from "vitest";

import { PROOF_KINDS, PROOF_KIND_WORDS as SOURCE_WORDS } from "../../../src/handover/proofKinds";
import { CURRENCY_PROOF_KINDS, PROOF_KIND_WORDS } from "../../lib/prProof";

describe("the console's proof kinds and the producer's agree", () => {
  it("on every kind, in order, and on how each is named", () => {
    expect(CURRENCY_PROOF_KINDS.length).toBeGreaterThan(0);
    expect([...CURRENCY_PROOF_KINDS]).toEqual([...PROOF_KINDS]);
    expect(PROOF_KIND_WORDS).toEqual(SOURCE_WORDS);
  });
});
