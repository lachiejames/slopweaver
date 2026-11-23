/**
 * What `cmux spawn` writes once a seat is open: the run journal's `dispatched` line (what clears a park) — for a
 * spawn that succeeded, and for one that failed with its seat left open, which must still record it so `handover
 * wake` does not reseat beside it. The session ledger's row is the seam's (`unit/sessionHarness/recordingHarness.test.ts`).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordSeatLeftOpen, recordSpawn } from "../../../../../cli/commands/cmux/spawnRecord.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import type { SpawnPlan } from "../../../../../cmux/plan.js";
import { runJournalPath } from "../../../../../handover/runStore.js";
import { readSessionLogText } from "../../../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const PLAN: SpawnPlan = {
  baseBranch: undefined,
  branch: "a-branch",
  cwd: "/tmp/repo",
  driver: "claude",
  host: "claude-code",
  model: undefined,
  pickupCommand: "/slopweaver:pickup a-doc — a pickup line long enough to clear the corroboration floor",
  repoRoot: "/tmp/repo",
  respondingToHandle: undefined,
  sessionName: undefined,
  slug: "a-doc",
  spawnedAt: "2026-08-17T00:00:00.000Z",
  template: "code",
  workspaceName: "a-doc",
  workspaceTitle: "a-doc",
  worktreeExists: true,
};

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home, removed after each test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "spawn-record-"));
  homes.push(home);
  return home;
}

/** Every line of a JSONL file, parsed. */
function jsonLines({ text }: { text: string }): readonly Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The run journal's lines for {@link PLAN}'s slug under `home`. */
function journalLines({ home }: { home: string }): readonly Record<string, unknown>[] {
  const path = runJournalPath({ runsDir: stateHomePaths({ home }).runs, slug: PLAN.slug });
  return jsonLines({ text: readFileSync(path, "utf8") });
}

describe("recordSpawn", () => {
  it("writes the dispatched line naming the workspace, and leaves the session row to the seam", () => {
    const home = freshHome();
    recordSpawn({
      home,
      plan: PLAN,
      spawned: { surfaceRef: "surface:7", workspaceRef: "workspace:42" },
    });

    const dispatched = journalLines({ home }).filter((line) => line["kind"] === "dispatched");
    expect(dispatched.map((line) => line["target"])).toEqual(["workspace:42"]);
    // The recording launcher (`sessionHarness/recordingHarness.ts`) is the one writer of the session row now.
    expect(readSessionLogText({ home })).toBe("");
  });
});

describe("recordSeatLeftOpen", () => {
  it("records the dispatch for a seat left open and exits non-zero", () => {
    const home = freshHome();
    const exitCode = recordSeatLeftOpen({
      failure: {
        pickupSubmissionUnproven: true,
        reason: "nothing saw the pickup submitted",
        surfaceRef: "surface:9",
        workspaceId: "9B2E-FORTY-THREE",
        workspaceRef: "workspace:43",
      },
      home,
      plan: PLAN,
    });

    expect(exitCode).toBe(EXIT_ERROR);
    const dispatched = journalLines({ home }).filter((line) => line["kind"] === "dispatched");
    expect(dispatched.map((line) => line["target"])).toEqual(["workspace:43"]);
    expect(readSessionLogText({ home })).toBe("");
  });
});
