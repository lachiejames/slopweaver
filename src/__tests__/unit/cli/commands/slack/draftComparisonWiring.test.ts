/**
 * `draftComparisonWiring.ts` — the live voice-brief edge a comparison pass is briefed from, read off a throwaway home.
 * The Codex edge is not driven here: it routes a real model seat.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { liveDraftComparisonDeps } from "../../../../../cli/commands/slack/draftComparisonWiring.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const homes: string[] = [];

/** A throwaway home, removed after each test. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "draft-compare-wiring-"));
  homes.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("liveDraftComparisonDeps", () => {
  it("briefs a pass with no rules on an install that configured no voice", () => {
    const brief = liveDraftComparisonDeps().loadVoiceBrief({ home: home() });
    expect(unwrap(brief)).toEqual({ paragraphSpacing: false, rules: [], shape: null });
  });

  it("refuses to brief a pass off a profile that is there but corrupt", () => {
    const at = home();
    writeFileSync(join(at, "profile.json"), "{ not json");
    const brief = liveDraftComparisonDeps().loadVoiceBrief({ home: at });
    expect(unwrapErr(brief)[0]).toContain("is there but cannot be trusted (not JSON");
  });
});
