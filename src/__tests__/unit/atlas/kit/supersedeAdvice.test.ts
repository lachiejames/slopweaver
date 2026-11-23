/**
 * The remedy a foreign schema version earns depends on its DIRECTION: only an OLDER generation earns the
 * platform's own reset line, and a NEWER one is told never to reset — that advice once archived every Vanta
 * entity an older binary simply could not parse yet.
 */
import { describe, expect, it } from "vitest";

import { supersedeAdvice } from "../../../../atlas/kit/supersedeAdvice.js";

const SPEC = {
  platform: "vanta",
  schemaVersion: 5,
  supersedeRemedy: "run: slopweaver atlas vanta reset --confirm archive",
};

describe("supersedeAdvice", () => {
  it("tells a build meeting a NEWER generation not to reset, and names the version and the restore verb", () => {
    expect(supersedeAdvice({ found: 6, spec: SPEC })).toBe(
      "this generation is NEWER than this build, not corrupt — use a build that writes version 6. " +
        "Do NOT reset: that archives a generation this build cannot read but a newer one can. " +
        "A checkout already current on its upstream means the writer is on an unmerged branch — a worktree " +
        "session ran that branch's own sync into this home — so retry after it lands. " +
        "If a reset already happened, run: slopweaver atlas vanta restore",
    );
  });

  it("prints the platform's own remedy verbatim for an OLDER generation", () => {
    expect(supersedeAdvice({ found: 4, spec: SPEC })).toBe(SPEC.supersedeRemedy);
  });
});
