/*
 * Placing a run for `codex extend`, over a real run journal and a real checkout: the branch comes from the
 * journal's `started`, the checkout from its latest `launched` or `--repo`, and each failure names which check
 * fired.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { placeRun } from "../../../../../cli/commands/codex/extendPlacement.js";
import { resolveGitCommonDir } from "../../../../../codex/gitDiff.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";
import { removeScratch, scratchRepo } from "./fallbackBranchFixture.js";

const RUN = "acme-parser";
const homes: string[] = [];

afterEach(() => {
  removeScratch();
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/**
 * A home holding run {@link RUN}'s journal: started on `branch` when one is given, launched in `worktree` when one is.
 *
 * @param branch the branch the journal's `started` names
 * @param worktree the checkout the journal's `launched` names
 * @returns the home
 */
function journalHome({ branch, worktree }: { branch?: string; worktree?: string }): string {
  const home = mkdtempSync(join(tmpdir(), "sw-place-"));
  homes.push(home);
  const runsDir = stateHomePaths({ home }).runs;
  mkdirSync(runsDir, { recursive: true });
  if (branch !== undefined) {
    const started = { atIso: "2026-11-27T00:10:00.000Z", branch, docHash: "h".repeat(64), kind: "started" } as const;
    unwrap(appendRunEvent({ event: started, runsDir, slug: RUN }));
  }
  if (worktree !== undefined) {
    const launched = {
      atIso: "2026-11-27T00:11:00.000Z",
      host: "claude-code",
      kind: "launched",
      pid: undefined,
      sessionId: "297eb49e-0000-4c40-94f1-c112b29a020d",
      worktree,
    } as const;
    unwrap(appendRunEvent({ event: launched, runsDir, slug: RUN }));
  }
  return home;
}

describe("placeRun", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("places a started run on its journalled branch in its launched checkout", () => {
    const repo = scratchRepo();
    const placed = unwrap(
      placeRun({ home: journalHome({ branch: "feature", worktree: repo }), repo: undefined, run: RUN }),
    );
    expect(placed.branch).toBe("feature");
    expect(placed.gitCommonDir).toBe(unwrap(resolveGitCommonDir({ cwd: repo })));
  });

  it("takes --repo when the journal names no launched worktree", () => {
    const repo = scratchRepo();
    const placed = unwrap(placeRun({ home: journalHome({ branch: "feature" }), repo, run: RUN }));
    expect(placed.branch).toBe("feature");
  });

  it("names each failed check by its code", () => {
    const repo = scratchRepo();
    const codes = [
      placeRun({ home: journalHome({ worktree: repo }), repo: undefined, run: RUN }),
      placeRun({ home: journalHome({ branch: "feature" }), repo: undefined, run: RUN }),
      placeRun({ home: journalHome({ branch: "elsewhere", worktree: repo }), repo: undefined, run: RUN }),
    ].map((placed) => unwrapErr(placed).code);
    expect(codes).toEqual(["NEVER_STARTED", "NO_WORKTREE", "BRANCH_NOT_OUT"]);
  });
});
