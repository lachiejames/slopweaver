/**
 * `runDirectory.ts`: which directory a run is judged in, read from paths as text.
 */
import { describe, expect, it } from "vitest";

import { ownsScriptNames } from "../../../admit/runDirectory.js";

describe("ownsScriptNames", () => {
  it("claims a slopweaver directory and an unknown or relative one", () => {
    expect(ownsScriptNames({ cwd: "/Users/x/dev/personal/slopweaver/.claude/worktrees.noindex/w" })).toBe(true);
    expect(ownsScriptNames({ cwd: undefined })).toBe(true);
    expect(ownsScriptNames({ cwd: "desktop" })).toBe(true);
  });

  it("leaves another project's scripts to it", () => {
    expect(ownsScriptNames({ cwd: "/Users/x/dev/acme-admin" })).toBe(false);
    expect(ownsScriptNames({ cwd: "/tmp/slopweaver-notes" })).toBe(false);
  });
});
