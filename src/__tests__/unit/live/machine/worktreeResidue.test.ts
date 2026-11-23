/**
 * {@link worktreeResiduePlan} — which processes a closed fleet worktree left behind.
 *
 * Every snapshot here is a hand-built `ps` table: the planner is pure, and the class it exists for — an nx
 * daemon detached to launchd with its workers under it — is a shape, not a machine.
 */
import { describe, expect, it } from "vitest";

import {
  argvRootedIn,
  isNodeArgv,
  pathRootedIn,
  referencesHolding,
  residueCandidatePids,
  worktreeResiduePlan,
  worktreeRootOf,
} from "../../../../live/machine/worktreeResidue.js";
import type { ProcessRow } from "../../../../live/standing/processes.js";

const WORKTREE = "/Users/me/dev/acme-admin/.claude/worktrees/a-seat";
const NODE = "/Users/me/.nvm/versions/node/v22.0.0/bin/node";
const DAEMON_ARGV = `${NODE} ${WORKTREE}/node_modules/nx/src/daemon/server/start.js`;
const WORKER_ARGV = `${NODE} ${WORKTREE}/node_modules/nx/src/project-graph/plugins/isolation/plugin-worker.js`;

/** The stale-daemon shape: a daemon orphaned to launchd, a plugin worker under it, and an unrelated process. */
const SNAPSHOT: readonly ProcessRow[] = [
  { argv: "/sbin/launchd", pid: 1, ppid: 0 },
  { argv: DAEMON_ARGV, pid: 500, ppid: 1 },
  { argv: WORKER_ARGV, pid: 501, ppid: 500 },
  { argv: `${NODE} /Users/me/dev/other/server.js`, pid: 600, ppid: 1 },
  { argv: "/bin/zsh -l", pid: 700, ppid: 1 },
];

/** The daemon's cwd read as the worktree root, where nx starts it, and no protected chain. */
function plan({
  processes = SNAPSHOT,
  cwdByPid = new Map([[500, WORKTREE]]),
  protectedPids = new Set<number>(),
}: {
  processes?: readonly ProcessRow[];
  cwdByPid?: ReadonlyMap<number, string>;
  protectedPids?: ReadonlySet<number>;
} = {}): ReturnType<typeof worktreeResiduePlan> {
  return worktreeResiduePlan({ cwdByPid, processes, protectedPids, worktree: WORKTREE });
}

describe("worktreeResiduePlan", () => {
  it("reaps an orphaned nx daemon working in the worktree, its worker first", () => {
    const result = plan();

    expect(result.targets.map((target) => [target.rootPid, target.label])).toEqual([[500, "nx daemon"]]);
    expect(result.targets[0]!.treePids).toEqual([501, 500]);
    expect(result.targets[0]!.argvByPid).toEqual({ "500": DAEMON_ARGV, "501": WORKER_ARGV });
    expect(result.skipped).toEqual([]);
  });

  it("reaps an orphaned node process whose argv names nothing, placed by its cwd", () => {
    const processes: readonly ProcessRow[] = [{ argv: `${NODE} server.js`, pid: 800, ppid: 1 }];

    const result = plan({ cwdByPid: new Map([[800, `${WORKTREE}/apps/web`]]), processes });

    expect(result.targets.map((target) => [target.rootPid, target.label])).toEqual([[800, "node"]]);
  });

  it("matches a cwd lsof reports through the /private and .noindex spellings of the same tree", () => {
    const processes: readonly ProcessRow[] = [{ argv: `${NODE} server.js`, pid: 800, ppid: 1 }];
    const cwd = "/private/Users/me/dev/acme-admin/.claude/worktrees.noindex/a-seat";

    const result = plan({ cwdByPid: new Map([[800, cwd]]), processes });

    expect(result.targets.map((target) => target.rootPid)).toEqual([800]);
  });

  it("leaves a node process in the worktree whose parent is still running, and says why", () => {
    const processes: readonly ProcessRow[] = [
      { argv: "/bin/zsh -c yarn nx test", pid: 900, ppid: 400 },
      { argv: DAEMON_ARGV, pid: 901, ppid: 900 },
    ];

    const result = plan({ processes });

    expect(result.targets).toEqual([]);
    expect(result.skipped).toEqual([
      { label: "nx daemon", pid: 901, why: "its parent 900 is still running, so something live owns it" },
    ]);
  });

  it("never touches a daemon whose tree runs through this process's own parent chain", () => {
    const result = plan({ protectedPids: new Set([501]) });

    expect(result.targets).toEqual([]);
    expect(result.skipped).toEqual([
      { label: "nx daemon", pid: 500, why: "this process's own parent chain runs through it" },
    ]);
  });

  it("does not claim a sibling worktree whose name extends this one's", () => {
    const processes: readonly ProcessRow[] = [
      { argv: `${NODE} ${WORKTREE}-10/node_modules/nx/src/daemon/server/start.js`, pid: 500, ppid: 1 },
    ];

    expect(plan({ cwdByPid: new Map(), processes })).toEqual({ skipped: [], targets: [], worktree: WORKTREE });
  });

  it("ignores a non-node process rooted in the worktree", () => {
    const processes: readonly ProcessRow[] = [{ argv: `/bin/zsh ${WORKTREE}/scripts/x.sh`, pid: 500, ppid: 1 }];

    expect(plan({ processes })).toEqual({ skipped: [], targets: [], worktree: WORKTREE });
  });
});

describe("residueCandidatePids", () => {
  it("bounds the cwd read to orphaned node processes", () => {
    expect(residueCandidatePids({ processes: SNAPSHOT })).toEqual([500, 600]);
  });
});

describe("isNodeArgv", () => {
  it("reads the first token's basename, so a node path under a directory named node is not enough", () => {
    expect(isNodeArgv({ argv: `${NODE} x.js` })).toBe(true);
    expect(isNodeArgv({ argv: "node" })).toBe(true);
    expect(isNodeArgv({ argv: "/Users/me/node/bin/zsh" })).toBe(false);
    expect(isNodeArgv({ argv: "" })).toBe(false);
  });
});

describe("pathRootedIn / argvRootedIn", () => {
  it("counts the worktree itself and anything under it, and nothing beside it", () => {
    expect(pathRootedIn({ path: WORKTREE, root: WORKTREE })).toBe(true);
    expect(pathRootedIn({ path: `${WORKTREE}/a/b`, root: WORKTREE })).toBe(true);
    expect(pathRootedIn({ path: `${WORKTREE}x`, root: WORKTREE })).toBe(false);
  });

  it("reads a --flag=/path value as well as a bare path token", () => {
    expect(argvRootedIn({ argv: `${NODE} --cwd=${WORKTREE} run.js`, root: WORKTREE })).toBe(true);
    expect(argvRootedIn({ argv: `${NODE} run.js --verbose`, root: WORKTREE })).toBe(false);
  });
});

describe("worktreeRootOf", () => {
  const CHECKOUT = "/Users/me/dev/acme-admin";

  it("widens a seat's subdirectory to its worktree root, in the .noindex spelling", () => {
    expect(worktreeRootOf({ checkout: CHECKOUT, path: `${WORKTREE}/apps/web` })).toBe(
      "/Users/me/dev/acme-admin/.claude/worktrees.noindex/a-seat",
    );
  });

  it("answers nothing for the checkout, its worktrees directory, and a .. spelling that climbs back out", () => {
    expect(worktreeRootOf({ checkout: CHECKOUT, path: CHECKOUT })).toBe(undefined);
    expect(worktreeRootOf({ checkout: CHECKOUT, path: `${CHECKOUT}/.claude/worktrees` })).toBe(undefined);
    expect(worktreeRootOf({ checkout: CHECKOUT, path: `${WORKTREE}/../..` })).toBe(undefined);
    expect(worktreeRootOf({ checkout: CHECKOUT, path: "/Users/me/dev/other/.claude/worktrees/x" })).toBe(undefined);
  });
});

describe("referencesHolding", () => {
  const ROOT = "/Users/me/dev/acme-admin/.claude/worktrees.noindex/a-seat";

  it("counts a live path anywhere under the root, and nothing above or beside it", () => {
    const live = new Map<string, readonly string[]>([
      [`${ROOT}/apps/web`, ["live workspace workspace:2"]],
      ["/Users/me/dev/acme-admin", ["live workspace workspace:9"]],
      [`${ROOT}-10`, ["open session other"]],
    ]);

    expect(referencesHolding({ live, root: ROOT })).toEqual(["live workspace workspace:2"]);
  });
});

describe("worktreeResiduePlan — an argv match working elsewhere", () => {
  it("leaves an orphan that only NAMES the worktree, working elsewhere or with a cwd lsof did not return", () => {
    const BROWSER = `${NODE} ${WORKTREE}/node_modules/playwright-core/cli.js run-server`;
    const processes: readonly ProcessRow[] = [
      { argv: BROWSER, pid: 810, ppid: 1 },
      { argv: BROWSER, pid: 811, ppid: 1 },
    ];

    const result = plan({
      cwdByPid: new Map([[810, "/Users/me/.slopweaver/live/browser/sessions/s1/client"]]),
      processes,
    });

    expect(result.targets).toEqual([]);
    expect(result.skipped).toEqual([
      {
        label: "node",
        pid: 810,
        why: "it names the worktree but works in /Users/me/.slopweaver/live/browser/sessions/s1/client, so a seat elsewhere may use it",
      },
      { label: "node", pid: 811, why: "it names the worktree but its working directory could not be read" },
    ]);
  });
});
