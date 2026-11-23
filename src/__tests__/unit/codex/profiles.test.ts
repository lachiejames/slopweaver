import { describe, expect, it } from "vitest";
import { CODEX_PASS_IDS, passProfile } from "../../../codex/profiles.js";

/**
 * s-03 from the self-review: retiring the tool-use veto left every review profile still declaring
 * `supplied-diff-only`. Nothing read that field, but it was a live contract stating a guarantee the code had
 * stopped providing — and a consumer trusting it would treat an off-diff verdict as diff-only grounded.
 */
describe("the review profiles describe the access they actually get", () => {
  it("no profile still claims supplied-diff-only", () => {
    expect(CODEX_PASS_IDS.map((pass) => passProfile({ pass }).toolPolicy)).not.toContain("supplied-diff-only");
  });

  it("review passes declare that the repo and web are reachable, because they are", () => {
    for (const pass of ["r1", "r2", "r3"] as const) {
      expect(passProfile({ pass }).toolPolicy).toBe("diff-first-repo-and-web-allowed");
    }
  });

  it("planning passes are unchanged — they could always investigate the repo", () => {
    for (const pass of ["p1", "p2", "p3"] as const) {
      expect(passProfile({ pass }).toolPolicy).toBe("repo-investigation-allowed");
    }
  });
});
