/**
 * The patch id of what a branch contributes to its base, read out of `git patch-id --verbatim`'s output. No
 * description publishes it any more; `github push` prints it so a session can record what its own evidence was
 * gathered against.
 */
import { describe, expect, it } from "vitest";

import { patchIdFrom } from "../../../../outbound/github/proof.js";

// The anchor reader and its verdict went with the C3 shape, which publishes no grade and no anchor.
// deleted-with-code: stripProofAnchors, GoldAnchorVerdict

/** A real `git patch-id --verbatim` id from the scratch-repo measurement, and a different one. */
const PATCH_A = "5e1877358e8c58c6bdc46b92483800474b4b1b32";
const PATCH_B = "125bcbe66eb79fdcbefa5c1e748a26e7b6c4f967";

describe("patchIdFrom", () => {
  it("reads the id out of git's `<patch-id> <commit-id>` line", () => {
    expect(patchIdFrom({ output: `${PATCH_A} 0000000000000000000000000000000000000000\n` })).toBe(PATCH_A);
  });

  it("takes the FIRST line when git printed several patches", () => {
    expect(patchIdFrom({ output: `${PATCH_A} 000\n${PATCH_B} 111\n` })).toBe(PATCH_A);
  });

  it("lowercases, so a case difference never reads as a different diff", () => {
    expect(patchIdFrom({ output: PATCH_A.toUpperCase() })).toBe(PATCH_A);
  });

  it("reads a sha256 repository's 64-character id", () => {
    const sha256 = "a".repeat(64);
    expect(patchIdFrom({ output: `${sha256} 0000` })).toBe(sha256);
  });

  it("returns null for the empty output an empty diff produces", () => {
    expect(patchIdFrom({ output: "" })).toBe(null);
  });

  it("returns null rather than an id for a truncated 39-character token", () => {
    expect(patchIdFrom({ output: PATCH_A.slice(0, 39) })).toBe(null);
  });

  it("returns null for output that is not a patch id at all", () => {
    expect(patchIdFrom({ output: "fatal: not a git repository" })).toBe(null);
  });

  it("never takes the commit id in the second column when the first token is not a patch id", () => {
    expect(patchIdFrom({ output: `not-an-id ${PATCH_B}` })).toBe(null);
  });

  it("reads past the leading whitespace and blank line git output can open with", () => {
    expect(patchIdFrom({ output: `\n  ${PATCH_B} 0000000000000000000000000000000000000000\n` })).toBe(PATCH_B);
  });

  it("returns null for a token between the two real lengths, so neither hash family is padded into", () => {
    expect(patchIdFrom({ output: "b".repeat(41) })).toBe(null);
  });
});
