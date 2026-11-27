/*
 * `codex extend` over a real state home, a real run journal and a real checkout: the pinned supervisor records one
 * extension scoped to the run's journalled branch and repository; a seat, a never-started run, a checkout on another
 * branch and a damaged register line that may be this run's each record nothing, while a damaged line naming
 * another run is set aside. The witness is the register on disk, read back.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { runCodexExtendOver } from "../../../../../cli/commands/codex/extendRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { resolveGitCommonDir } from "../../../../../codex/gitDiff.js";
import { PASS_EXTENSION_LOCK_KEY, readPassExtensions } from "../../../../../codex/passExtensionStore.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import { writeSupervisorPin } from "../../../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";
import { removeScratch, scratchRepo } from "./fallbackBranchFixture.js";

const CHAIR_ID = "4c829e9d-d903-49b4-b446-6bb88b198511";
const SEAT_ID = "297eb49e-d49c-4c40-94f1-c112b29a020d";
const RUN = "acme-parser";

const homes: string[] = [];

afterEach(() => {
  removeScratch();
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/**
 * A home pinned to the chair, holding run {@link RUN}'s journal: started on `branch`, launched in `worktree`.
 *
 * @param branch the branch the journal's `started` names, or none for a run never started
 * @param worktree the checkout the journal's `launched` names
 * @returns the home
 */
function pinnedHome({ branch, worktree }: { branch: string | undefined; worktree: string }): string {
  const home = mkdtempSync(join(tmpdir(), "sw-extend-"));
  homes.push(home);
  writeSupervisorPin({
    home,
    record: {
      pinnedAtIso: "2026-11-27T00:00:00.000Z",
      session: { host: "claude-code", id: CHAIR_ID },
      workspaceId: "806BA6F7-871B-4A34-97FF-B35915EE6FB7",
      workspaceRef: "workspace:374",
    },
  });
  const runsDir = stateHomePaths({ home }).runs;
  mkdirSync(runsDir, { recursive: true });
  if (branch !== undefined) {
    unwrap(
      appendRunEvent({
        event: { atIso: "2026-11-27T00:10:00.000Z", branch, docHash: "h".repeat(64), kind: "started" },
        runsDir,
        slug: RUN,
      }),
    );
    unwrap(
      appendRunEvent({
        event: {
          atIso: "2026-11-27T00:11:00.000Z",
          host: "claude-code",
          kind: "launched",
          pid: undefined,
          sessionId: SEAT_ID,
          worktree,
        },
        runsDir,
        slug: RUN,
      }),
    );
  }
  return home;
}

/** The verb's argv: `slopweaver codex extend` and then `rest`. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "codex", "extend", ...rest];
}

const DIFF = "a".repeat(64);
const NEXT_DIFF = "b".repeat(64);
const CHAIR = { CLAUDE_CODE_SESSION_ID: CHAIR_ID };

/** The grant's flags for one diff, the run's lane and reason fixed. */
function grantFor({ diff }: { diff: string }): readonly string[] {
  return ["--run", RUN, "--lane", "general", "--diff", diff, "--reason", "the fix moved the parser"];
}

const GRANT = grantFor({ diff: DIFF });

describe("codex extend", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("records one extension for the pinned supervisor, scoped to the exact diff, journalled branch and repository", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: "feature", worktree: repo });
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_OK);
    const read = unwrap(readPassExtensions({ home }));
    expect(read.unreadable).toEqual([]);
    expect(read.rows.map(({ atIso: _at, id: _id, repoRoot: _root, ...row }) => row)).toEqual([
      {
        after: undefined,
        branch: "feature",
        diffSha256: DIFF,
        gitCommonDir: unwrap(resolveGitCommonDir({ cwd: repo })),
        grantedBy: { host: "claude-code", id: CHAIR_ID },
        lane: "general",
        reason: "the fix moved the parser",
        run: RUN,
        schemaVersion: 1,
      },
    ]);
  });

  it("refuses a second extension for the run's lane that does not name the first", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: "feature", worktree: repo });
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_OK);
    const second = argv({ rest: [...grantFor({ diff: NEXT_DIFF }), "--home", home] });
    expect(runCodexExtendOver({ argv: second, env: CHAIR })).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home })).rows.length).toBe(1);
  });

  it("refuses a second extension placed in another repository with --repo that does not name the first", () => {
    const repo = scratchRepo();
    const elsewhere = scratchRepo();
    const home = pinnedHome({ branch: "feature", worktree: repo });
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_OK);
    const second = argv({ rest: [...grantFor({ diff: NEXT_DIFF }), "--repo", elsewhere, "--home", home] });
    expect(runCodexExtendOver({ argv: second, env: CHAIR })).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home })).rows.map((row) => row.diffSha256)).toEqual([DIFF]);
  });

  it("records a second extension that names the first with --after, and refuses one naming any other id", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: "feature", worktree: repo });
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_OK);
    const first = unwrap(readPassExtensions({ home })).rows[0]!;
    const wrong = argv({ rest: [...grantFor({ diff: NEXT_DIFF }), "--after", "not-the-first", "--home", home] });
    expect(runCodexExtendOver({ argv: wrong, env: CHAIR })).toBe(EXIT_ERROR);
    const right = argv({ rest: [...grantFor({ diff: NEXT_DIFF }), "--after", first.id, "--home", home] });
    expect(runCodexExtendOver({ argv: right, env: CHAIR })).toBe(EXIT_OK);
    expect(unwrap(readPassExtensions({ home })).rows.map((row) => [row.diffSha256, row.after])).toEqual([
      [DIFF, undefined],
      [NEXT_DIFF, first.id],
    ]);
  });

  it("refuses --after on a run's first extension, and a second row for a diff already approved", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: "feature", worktree: repo });
    const early = argv({ rest: [...GRANT, "--after", "anything", "--home", home] });
    expect(runCodexExtendOver({ argv: early, env: CHAIR })).toBe(EXIT_ERROR);
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_OK);
    const first = unwrap(readPassExtensions({ home })).rows[0]!;
    const again = argv({ rest: [...GRANT, "--after", first.id, "--home", home] });
    expect(runCodexExtendOver({ argv: again, env: CHAIR })).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home })).rows.length).toBe(1);
  });

  it("refuses while another grant holds the register's lock, and releases its own lock after recording", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: "feature", worktree: repo });
    const held = unwrap(acquireOperationLock({ home, key: PASS_EXTENSION_LOCK_KEY, nowIso: new Date().toISOString() }));
    const blocked = runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR });
    expect(blocked).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home }))).toEqual({ rows: [], unreadable: [] });
    held.release();
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_OK);
    expect(unwrap(readPassExtensions({ home })).rows.length).toBe(1);
    const after = unwrap(
      acquireOperationLock({ home, key: PASS_EXTENSION_LOCK_KEY, nowIso: new Date().toISOString() }),
    );
    expect(after.stillHeld()).toBe(true);
    after.release();
  });

  it("refuses a seat and records nothing", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: "feature", worktree: repo });
    const code = runCodexExtendOver({
      argv: argv({ rest: [...GRANT, "--home", home] }),
      env: { CLAUDE_CODE_SESSION_ID: SEAT_ID },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home }))).toEqual({ rows: [], unreadable: [] });
  });

  it("refuses a run that was never started, since it names no branch", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: undefined, worktree: repo });
    const code = runCodexExtendOver({
      argv: argv({ rest: [...GRANT, "--repo", repo, "--home", home] }),
      env: { CLAUDE_CODE_SESSION_ID: CHAIR_ID },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home })).rows).toEqual([]);
  });

  it("refuses a checkout that does not have the run's branch out", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: "elsewhere", worktree: repo });
    const code = runCodexExtendOver({
      argv: argv({ rest: [...GRANT, "--home", home] }),
      env: { CLAUDE_CODE_SESSION_ID: CHAIR_ID },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home })).rows).toEqual([]);
  });

  /** A home pinned to the chair whose register holds one damaged line, `line`. */
  function damagedHome({ line, repo }: { line: string; repo: string }): string {
    const home = pinnedHome({ branch: "feature", worktree: repo });
    const path = stateHomePaths({ home }).codexPassExtensionsJsonl;
    mkdirSync(join(path, ".."), { recursive: true });
    appendFileSync(path, `${line}\n`);
    return home;
  }

  it("refuses a grant over a register line that will not parse, since it may be this run's earlier one", () => {
    const home = damagedHome({ line: "{not json", repo: scratchRepo() });
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home })).rows).toEqual([]);
  });

  it("refuses a grant over a damaged line that names this run", () => {
    const home = damagedHome({ line: JSON.stringify({ lane: "x", run: RUN }), repo: scratchRepo() });
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_ERROR);
    expect(unwrap(readPassExtensions({ home })).rows).toEqual([]);
  });

  it("sets aside a damaged line that names another run and records the grant beside it", () => {
    const home = damagedHome({ line: JSON.stringify({ lane: "x", run: "acme-other" }), repo: scratchRepo() });
    expect(runCodexExtendOver({ argv: argv({ rest: [...GRANT, "--home", home] }), env: CHAIR })).toBe(EXIT_OK);
    const read = unwrap(readPassExtensions({ home }));
    expect(read.rows.map((row) => row.diffSha256)).toEqual([DIFF]);
    expect(read.unreadable.map((line) => line.run)).toEqual(["acme-other"]);
  });

  it("refuses an unknown lane, a missing reason and a short diff as usage, before reading anything", () => {
    const usage = [
      ["--run", RUN, "--lane", "unbounded", "--diff", DIFF, "--reason", "x"],
      ["--run", RUN, "--lane", "general", "--diff", DIFF],
      ["--run", RUN, "--lane", "general", "--reason", "x"],
      ["--run", RUN, "--lane", "general", "--diff", DIFF.slice(0, 12), "--reason", "x"],
    ].map((rest) => runCodexExtendOver({ argv: argv({ rest }), env: CHAIR }));
    expect(usage).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
  });

  it("lists an empty register as success, and a damaged one as an error", () => {
    const repo = scratchRepo();
    const home = pinnedHome({ branch: "feature", worktree: repo });
    expect(runCodexExtendOver({ argv: argv({ rest: ["--list", "--home", home] }), env: {} })).toBe(EXIT_OK);
    const path = stateHomePaths({ home }).codexPassExtensionsJsonl;
    mkdirSync(join(path, ".."), { recursive: true });
    appendFileSync(path, "{not json\n");
    expect(runCodexExtendOver({ argv: argv({ rest: ["--list", "--home", home] }), env: {} })).toBe(EXIT_ERROR);
  });
});
