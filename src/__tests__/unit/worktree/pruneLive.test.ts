/**
 * The join that decides what is PROTECTED — every live reference indexed by the path git prints, and every
 * open pull request of the owner's by the branch a tree has out, which holds only a warm tree — and the result lines
 * that report what an apply actually managed to do.
 */
import { describe, expect, it } from "vitest";

import { liveReferenceIndex } from "../../../cli/commands/worktree/core.js";
import {
  applyRefusal,
  heldForRemoval,
  heldReason,
  type LiveState,
  liveComplete,
  liveDeferrable,
  liveHoldsOn,
  liveStateFrom,
  openPullRequestsOn,
} from "../../../cli/commands/worktree/pruneLiveState.js";
import { EXIT_DEFERRED, EXIT_ERROR } from "../../../cli/exitCodes.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { CmuxErrors, cmuxDidNotAnswer } from "../../../cmux/errors.js";
import { err, ok } from "../../../lib/result.js";
import { GithubLiveErrors } from "../../../live/github/errors.js";
import type { SessionItem } from "../../../sessions/session.js";
import { liveReferencesTo } from "../../../worktree/location.js";
import { type PruneOutcome, renderOutcome } from "../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import { DISK_BUDGET_MS, measureCandidates } from "../../../worktree/pruneDisk.js";
import { deletionsOnlyIn } from "../../../worktree/pruneGit.js";
import { refusalLine } from "../../../worktree/pruneRefusal.js";

const session = (over: Partial<SessionItem> = {}): SessionItem => ({
  cwd: "/repo/.claude/worktrees/live",
  lastEventIso: "2026-08-28T02:00:00.000Z",
  sessionKey: "live",
  slug: "live",
  status: "open",
  ...over,
});

const workspace = (over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary => ({
  currentDirectory: "/repo/.claude/worktrees/live",
  description: undefined,
  latestConversationMessage: undefined,
  latestSubmittedAtIso: undefined,
  latestSubmittedMessage: undefined,
  pinned: false,
  selected: false,
  title: undefined,
  windowId: "W",
  workspaceId: "A",
  workspaceRef: "workspace:388",
  ...over,
});

describe("liveStateFrom and heldReason", () => {
  const NOW_MS = 1_800_000_000_000;
  const DAY_MS = 86_400_000;
  const TREE = "/repo/.claude/worktrees.noindex/live";
  const COLD = "/repo/.claude/worktrees.noindex/cold";
  const unreachable = err(
    CmuxErrors.callFailed({ cmuxCode: "timeout", message: "no reply", method: "workspace.list" }),
  );
  /** Every register read whole and empty, so each case below changes exactly one. */
  const readable = {
    cwds: ok(new Map<number, string>()),
    events: [],
    openHeads: ok([]),
    workspaces: ok([]),
  };

  it("holds every tree when the workspace list could not be read", () => {
    const live = liveStateFrom({ ...readable, workspaces: unreachable });
    expect(liveComplete({ live })).toBe(false);
    expect(heldReason({ live, path: COLD })).toBe(
      "live state could not be read (the live workspace list could not be read — cmux workspace.list failed " +
        "(timeout): no reply), so a tree in use is indistinguishable from a cold one",
    );
  });

  it("holds every tree when the session ledger could not be read whole, though the workspaces answered", () => {
    const live = liveStateFrom({ ...readable, events: null });
    expect(liveComplete({ live })).toBe(false);
    expect(heldReason({ live, path: COLD })).toBe(
      "live state could not be read (the session ledger could not be read whole), so a tree in use is " +
        "indistinguishable from a cold one",
    );
  });

  it("holds every tree when the owner's open pull requests could not be read, never reading it as none open", () => {
    const failed = err(GithubLiveErrors.readFailed({ message: "Bad credentials" }));
    const live = liveStateFrom({ ...readable, openHeads: failed });
    expect(liveComplete({ live })).toBe(false);
    expect(live.unreadable).toEqual(["their open pull requests could not be read — Bad credentials"]);
    expect(heldReason({ live, path: COLD })).toBe(
      "live state could not be read (their open pull requests could not be read — Bad credentials), so a tree " +
        "in use is indistinguishable from a cold one",
    );
  });

  it("holds every tree when the process table's working directories could not be read", () => {
    const live = liveStateFrom({ ...readable, cwds: err(["lsof could not read every live process's cwd"]) });
    expect(liveComplete({ live })).toBe(false);
    expect(heldReason({ live, path: COLD })).toBe(
      "live state could not be read (lsof could not read every live process's cwd), so a tree in use is " +
        "indistinguishable from a cold one",
    );
  });

  const deferrable = (over: Partial<Parameters<typeof liveStateFrom>[0]>): boolean =>
    liveDeferrable({ live: liveStateFrom({ ...readable, ...over }) });

  it("reads cmux's own timeout frame on the workspace list, and nothing else failing, as deferrable", () => {
    const live = liveStateFrom({ ...readable, workspaces: unreachable });
    expect(liveComplete({ live })).toBe(false);
    expect(liveDeferrable({ live })).toBe(true);
  });

  it("reads the client's own TIMEOUT on the workspace list as deferrable too", () => {
    const timedOut = err(CmuxErrors.timedOut({ method: "workspace.list", timeoutMs: 10_000 }));
    expect(deferrable({ workspaces: timedOut })).toBe(true);
  });

  it("reads a timeout on the inventory's window.list call as deferrable, the shape of a silent socket", () => {
    const timedOut = err(CmuxErrors.timedOut({ method: "window.list", timeoutMs: 15_000 }));
    expect(deferrable({ workspaces: timedOut })).toBe(true);
  });

  it("is not deferrable when the timeout came from a method the inventory never calls", () => {
    const elsewhere = err(CmuxErrors.timedOut({ method: "workspace.close", timeoutMs: 10_000 }));
    expect(deferrable({ workspaces: elsewhere })).toBe(false);
    const live = liveStateFrom({ ...readable, workspaces: elsewhere });
    expect(applyRefusal({ apply: true, live, verb: "worktree prune" })!.exitCode).toBe(EXIT_ERROR);
  });

  it("is not deferrable when cmux refused the call on any other code", () => {
    const refused = err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "no", method: "workspace.list" }));
    expect(deferrable({ workspaces: refused })).toBe(false);
  });

  it("is not deferrable when a cmux timeout comes with a second register failing", () => {
    expect(deferrable({ events: null, workspaces: unreachable })).toBe(false);
    expect(deferrable({ cwds: err(["lsof timed out"]), workspaces: unreachable })).toBe(false);
    const failed = err(GithubLiveErrors.readFailed({ message: "Bad credentials" }));
    expect(deferrable({ openHeads: failed, workspaces: unreachable })).toBe(false);
  });

  it("is not deferrable when only a non-cmux register failed, nor when every register read", () => {
    expect(deferrable({ events: null })).toBe(false);
    expect(deferrable({ cwds: err(["lsof timed out"]) })).toBe(false);
    expect(deferrable({})).toBe(false);
  });

  it("decides from the typed register failures alone, never from the display reasons", () => {
    const handBuilt: LiveState = {
      byBranch: new Map(),
      failed: { cwds: true, ledger: false, openHeads: false, workspaces: null },
      index: new Map(),
      unreadable: ["lsof timed out"],
    };
    expect(liveDeferrable({ live: handBuilt })).toBe(false);
    expect(applyRefusal({ apply: true, live: handBuilt, verb: "worktree prune" })).toEqual({
      exitCode: EXIT_ERROR,
      line:
        "worktree prune: refusing --apply while live state is unreadable (lsof timed out) — a tree in use is " +
        "indistinguishable from a cold one",
    });
  });

  it("stops an apply over a cmux timeout on EXIT_DEFERRED, saying nothing was removed", () => {
    const live = liveStateFrom({ ...readable, workspaces: unreachable });
    expect(applyRefusal({ apply: true, live, verb: "worktree prune" })).toEqual({
      exitCode: EXIT_DEFERRED,
      line:
        "worktree prune: deferring --apply, nothing removed: live state is unreadable (the live workspace list " +
        "could not be read — cmux workspace.list failed (timeout): no reply) — a tree in use is indistinguishable " +
        "from a cold one; run it again unchanged",
    });
  });

  it("stops an apply over any other unreadable register on EXIT_ERROR", () => {
    const live = liveStateFrom({ ...readable, events: null, workspaces: unreachable });
    expect(applyRefusal({ apply: true, live, verb: "worktree mirror-prune" })).toEqual({
      exitCode: EXIT_ERROR,
      line:
        "worktree mirror-prune: refusing --apply while live state is unreadable (the session ledger could not be " +
        "read whole; the live workspace list could not be read — cmux workspace.list failed (timeout): no reply) " +
        "— a tree in use is indistinguishable from a cold one",
    });
  });

  it("lets a plan go on over unreadable state, and an apply go on over complete state", () => {
    const unreadable = liveStateFrom({ ...readable, workspaces: unreachable });
    expect(applyRefusal({ apply: false, live: unreadable, verb: "worktree prune" })).toBe(null);
    expect(applyRefusal({ apply: true, live: liveStateFrom(readable), verb: "worktree prune" })).toBe(null);
  });

  it("names every register that failed, in one reason", () => {
    const live = liveStateFrom({ ...readable, cwds: err(["lsof timed out"]), events: null });
    expect(live.unreadable).toEqual(["the session ledger could not be read whole", "lsof timed out"]);
  });

  it("holds a tree a live workspace stands in, and lets a cold one go", () => {
    const live = liveStateFrom({ ...readable, workspaces: ok([workspace()]) });
    expect(liveComplete({ live })).toBe(true);
    expect(heldReason({ live, path: TREE })).toBe("taken since the scan — live workspace workspace:388");
    expect(heldReason({ live, path: COLD })).toBe(null);
  });

  it("holds a WARM tree whose branch has an open pull request of the owner's, naming the pull request", () => {
    const branch = "browser-act-screenshot-timeout-294-43";
    const live = liveStateFrom({
      ...readable,
      openHeads: ok([{ branch, number: 1697, repo: "lachiejames/slopweaver" }]),
    });
    expect(openPullRequestsOn({ branch, live })).toEqual(["open pull request lachiejames/slopweaver#1697"]);
    expect(openPullRequestsOn({ branch: "some-other-branch", live })).toEqual([]);
    const judged = { activityFloorMs: null, branch, live, nowMs: NOW_MS, olderThanMs: DAY_MS, path: COLD };
    expect(heldForRemoval({ ...judged, lastActivityMs: NOW_MS - 3_600_000 })).toBe(
      "taken since the scan — touched 1h ago, with open pull request lachiejames/slopweaver#1697 on its branch",
    );
    expect(heldForRemoval({ ...judged, lastActivityMs: NOW_MS - DAY_MS })).toBe(null);
  });

  it("holds a tree the scan judged past its activity floor that has been touched since, at removal", () => {
    const live = liveStateFrom(readable);
    const judged = { activityFloorMs: 2 * 3_600_000, branch: "pushed", live, nowMs: NOW_MS, olderThanMs: DAY_MS };
    expect(heldForRemoval({ ...judged, lastActivityMs: NOW_MS - 60_000, path: COLD })).toBe(
      "taken since the scan — touched 0h ago",
    );
    expect(heldForRemoval({ ...judged, lastActivityMs: NOW_MS - 2 * 3_600_000, path: COLD })).toBe(null);
    expect(heldForRemoval({ ...judged, lastActivityMs: null, path: COLD })).toBe(
      "taken since the scan — no activity timestamp could be read before removal",
    );
  });

  it("asks no activity floor of a verdict that carries none, such as a CLOSED row's", () => {
    const live = liveStateFrom(readable);
    expect(
      heldForRemoval({
        activityFloorMs: null,
        branch: "closed",
        lastActivityMs: NOW_MS - 60_000,
        live,
        nowMs: NOW_MS,
        olderThanMs: DAY_MS,
        path: COLD,
      }),
    ).toBe(null);
  });

  it("never holds a detached tree on a pull request, which has no branch to match", () => {
    const live = liveStateFrom({ ...readable, openHeads: ok([{ branch: "x", number: 1, repo: "o/r" }]) });
    expect(openPullRequestsOn({ branch: null, live })).toEqual([]);
  });

  it("holds a tree a live process works beneath, naming the pid and its cwd", () => {
    const live = liveStateFrom({ ...readable, cwds: ok(new Map([[4242, `${TREE}/apps/web`]])) });
    expect(heldReason({ live, path: TREE })).toBe(`taken since the scan — live process 4242 (cwd ${TREE}/apps/web)`);
    expect(heldReason({ live, path: COLD })).toBe(null);
  });

  it("does not hold a tree only because a process stands in a directory ABOVE it", () => {
    const live = liveStateFrom({ ...readable, cwds: ok(new Map([[1, "/repo"]])) });
    expect(liveHoldsOn({ live, path: COLD })).toEqual([]);
  });

  it("keeps a pull request out of the path holds, and names a path hold ahead of a warm pull request", () => {
    const live = liveStateFrom({
      ...readable,
      cwds: ok(new Map([[7, TREE]])),
      openHeads: ok([{ branch: "live", number: 9, repo: "o/r" }]),
    });
    expect(liveHoldsOn({ live, path: TREE })).toEqual([`live process 7 (cwd ${TREE})`]);
    expect(
      heldForRemoval({
        activityFloorMs: null,
        branch: "live",
        lastActivityMs: NOW_MS - 3_600_000,
        live,
        nowMs: NOW_MS,
        olderThanMs: DAY_MS,
        path: TREE,
      }),
    ).toBe(`taken since the scan — live process 7 (cwd ${TREE})`);
  });
});

describe("cmuxDidNotAnswer", () => {
  it("is true for the client's own TIMEOUT and for cmux's own timeout frame", () => {
    expect(cmuxDidNotAnswer({ error: CmuxErrors.timedOut({ method: "workspace.list", timeoutMs: 15_000 }) })).toBe(
      true,
    );
    const frame = CmuxErrors.callFailed({ cmuxCode: "timeout", message: "Retry in a moment.", method: "window.list" });
    expect(cmuxDidNotAnswer({ error: frame })).toBe(true);
  });

  it("is false for cmux refusing on another code, even one whose message says timeout", () => {
    const refused = CmuxErrors.callFailed({ cmuxCode: "internal_error", message: "timeout", method: "window.list" });
    expect(cmuxDidNotAnswer({ error: refused })).toBe(false);
  });
});

describe("liveReferenceIndex", () => {
  const none = new Map<number, string>();

  it("indexes an open session by its working directory", () => {
    const index = liveReferenceIndex({ cwds: none, sessions: [session()], workspaces: [] });
    expect(index.get("/repo/.claude/worktrees.noindex/live")).toEqual(["open session live"]);
  });

  it("ignores a CLOSED session — a closed chat is not holding its worktree", () => {
    const index = liveReferenceIndex({ cwds: none, sessions: [session({ status: "closed" })], workspaces: [] });
    expect(index.size).toBe(0);
  });

  it("collects a session, a workspace and a process pointing at the same path into one entry", () => {
    const index = liveReferenceIndex({
      cwds: new Map([[31, "/repo/.claude/worktrees/live"]]),
      sessions: [session()],
      workspaces: [workspace()],
    });
    expect(index.get("/repo/.claude/worktrees.noindex/live")).toEqual([
      "open session live",
      "live workspace workspace:388",
      "live process 31 (cwd /repo/.claude/worktrees/live)",
    ]);
  });

  it("names every pid sharing one cwd in one reference, so a reason never repeats a path per pid", () => {
    const index = liveReferenceIndex({
      cwds: new Map([
        [31, "/repo/.claude/worktrees/live"],
        [32, "/repo/.claude/worktrees/live"],
        [33, "/repo/.claude/worktrees/live/apps/web"],
      ]),
      sessions: [],
      workspaces: [],
    });
    expect(index.get("/repo/.claude/worktrees.noindex/live")).toEqual([
      "live processes 31, 32 (cwd /repo/.claude/worktrees/live)",
    ]);
    expect(index.get("/repo/.claude/worktrees.noindex/live/apps/web")).toEqual([
      "live process 33 (cwd /repo/.claude/worktrees/live/apps/web)",
    ]);
  });

  it("falls back to the session key when a session has no handover slug", () => {
    const index = liveReferenceIndex({ cwds: none, sessions: [session({ slug: undefined })], workspaces: [] });
    expect(index.get("/repo/.claude/worktrees.noindex/live")).toEqual(["open session live"]);
  });

  it("skips a session with no recorded directory rather than indexing an empty path", () => {
    expect(liveReferenceIndex({ cwds: none, sessions: [session({ cwd: undefined })], workspaces: [] }).size).toBe(0);
    expect(liveReferenceIndex({ cwds: none, sessions: [session({ cwd: "" })], workspaces: [] }).size).toBe(0);
  });

  it("normalises a trailing slash, so one directory is not two keys", () => {
    const index = liveReferenceIndex({
      cwds: none,
      sessions: [session({ cwd: "/repo/.claude/worktrees/live/" })],
      workspaces: [],
    });
    expect(index.get("/repo/.claude/worktrees.noindex/live")).toEqual(["open session live"]);
  });

  it("folds the worktrees alias and the physical .noindex spelling onto one key", () => {
    const index = liveReferenceIndex({
      cwds: none,
      sessions: [session({ cwd: "/repo/.claude/worktrees/live" })],
      workspaces: [workspace({ currentDirectory: "/private/repo/.claude/worktrees.noindex/live" })],
    });
    expect(index.get("/repo/.claude/worktrees.noindex/live")).toEqual([
      "open session live",
      "live workspace workspace:388",
    ]);
    expect(index.size).toBe(1);
  });
});

const outcome = (over: Partial<PruneOutcome> = {}): PruneOutcome => ({
  branch: "landed",
  branchDeleted: true,
  declined: null,
  failed: false,
  freedKib: 2_500_000,
  path: "/repo/.claude/worktrees/landed",
  salvagedTo: null,
  treeRemoved: true,
  ...over,
});

describe("renderOutcome", () => {
  it("reports a full removal with the gigabytes it freed", () => {
    expect(renderOutcome({ outcome: outcome() })).toBe("  landed — tree and branch removed, 2.5 GB");
  });

  it("omits the size entirely when the plan never measured this tree, rather than claiming 0.0 GB", () => {
    expect(renderOutcome({ outcome: outcome({ freedKib: 0 }) })).toBe("  landed — tree and branch removed");
  });

  it("reports a removal that could not finish as FAILED with what it left, never as removed or KEPT", () => {
    const line = renderOutcome({
      outcome: outcome({
        branchDeleted: false,
        declined: "error: failed to delete: Directory not empty — git has already dropped the registration",
        failed: true,
        freedKib: 0,
        treeRemoved: false,
      }),
    });
    expect(line).toBe(
      "  FAILED landed — the removal did not finish: error: failed to delete: Directory not empty — git has " +
        "already dropped the registration\n    /repo/.claude/worktrees/landed",
    );
  });

  it("says the branch was kept, and quotes git's reason, when git declined the delete", () => {
    const line = renderOutcome({ outcome: outcome({ branchDeleted: false, declined: "error: not fully merged" }) });
    expect(line).toBe("  landed — tree removed, branch kept (error: not fully merged), 2.5 GB");
  });

  it("reports a kept tree as KEPT, with git's own refusal and no gigabytes claimed", () => {
    const line = renderOutcome({
      outcome: outcome({ branchDeleted: false, declined: "contains modified files", freedKib: 0, treeRemoved: false }),
    });
    expect(line).toBe("  KEPT landed — git declined: contains modified files\n    /repo/.claude/worktrees/landed");
  });

  it("names a detached worktree rather than printing null", () => {
    expect(renderOutcome({ outcome: outcome({ branch: null, branchDeleted: false }) })).toBe(
      "  (detached) — tree removed, branch kept, 2.5 GB",
    );
  });
});

const candidate = ({ path }: { path: string }): PruneVerdict => ({
  branch: "landed",
  cls: "merged",
  deleteBranch: true,
  dropsDeps: false,
  diskKib: null,
  path,
  reason: "merged into the trunk, clean, unreferenced and cold",
});

describe("measureCandidates", () => {
  it("leaves every candidate unmeasured once the budget is already spent", () => {
    const measured = measureCandidates({
      budgetMs: 0,
      nowMs: () => 1_000,
      verdicts: [candidate({ path: "/a" }), candidate({ path: "/b" })],
    });
    expect(measured.map((verdict) => verdict.diskKib)).toEqual([null, null]);
  });

  it("keeps the candidates in the order it was given, so the plan reads the same either way", () => {
    const measured = measureCandidates({
      budgetMs: 0,
      nowMs: () => 1_000,
      verdicts: [candidate({ path: "/a" }), candidate({ path: "/b" }), candidate({ path: "/c" })],
    });
    expect(measured.map((verdict) => verdict.path)).toEqual(["/a", "/b", "/c"]);
  });

  it("stops measuring at the deadline rather than part-way through a fixed count", () => {
    let clock = 0;
    const measured = measureCandidates({
      budgetMs: 10,
      // The first read is the deadline; the next three are the per-candidate checks, crossing at the third.
      nowMs: () => {
        clock += 5;
        return clock;
      },
      verdicts: [
        candidate({ path: "/nonexistent-a" }),
        candidate({ path: "/nonexistent-b" }),
        candidate({ path: "/nonexistent-c" }),
      ],
    });
    expect(measured.map((verdict) => verdict.diskKib)).toEqual([null, null, null]);
  });

  it("declares a budget in whole seconds, not an unbounded pass", () => {
    expect(DISK_BUDGET_MS).toBe(300_000);
  });
});

describe("refusalLine", () => {
  it("takes the error, not the advice hint git prints after it", () => {
    const stderr = [
      "error: the branch 'landed' is not fully merged.",
      "hint: If you are sure you want to delete it, run 'git branch -D landed'.",
      'hint: Disable this message with "git config set advice.forceDeleteBranch false"',
    ].join("\n");
    expect(refusalLine({ stderr })).toBe("error: the branch 'landed' is not fully merged.");
  });

  it("takes a fatal as readily as an error", () => {
    expect(refusalLine({ stderr: "fatal: 'x' contains modified or untracked files" })).toBe(
      "fatal: 'x' contains modified or untracked files",
    );
  });

  it("falls back to the first line when git labelled nothing", () => {
    expect(refusalLine({ stderr: "  something unlabelled\nand more\n" })).toBe("something unlabelled");
  });

  it("returns an empty string when git said nothing at all", () => {
    expect(refusalLine({ stderr: "" })).toBe("");
    expect(refusalLine({ stderr: "\n  \n" })).toBe("");
  });
});

describe("deletionsOnlyIn", () => {
  it("recognises the shape an interrupted worktree removal leaves — every entry a deletion", () => {
    expect(deletionsOnlyIn({ text: " D LICENSE\n D bin/slopweaver\n D knip.json" })).toBe(true);
  });

  it("recognises a staged deletion as readily as an unstaged one", () => {
    expect(deletionsOnlyIn({ text: "D  LICENSE\n D knip.json" })).toBe(true);
  });

  it("says no when even one entry is a modification, which is real work", () => {
    expect(deletionsOnlyIn({ text: " D LICENSE\n M src/index.ts" })).toBe(false);
  });

  it("says no for a code that merely contains a D, whose index may hold the only copy of an edit", () => {
    expect(deletionsOnlyIn({ text: "MD LICENSE" })).toBe(false);
    expect(deletionsOnlyIn({ text: "AD notes.md" })).toBe(false);
    expect(deletionsOnlyIn({ text: "DU LICENSE" })).toBe(false);
    expect(deletionsOnlyIn({ text: "UD LICENSE" })).toBe(false);
    expect(deletionsOnlyIn({ text: " D LICENSE\nMD knip.json" })).toBe(false);
  });

  it("says no for untracked files, which a removal never produces", () => {
    expect(deletionsOnlyIn({ text: " D LICENSE\n?? scratch.txt" })).toBe(false);
  });

  it("says no for a clean tree and for an unreadable one, rather than vacuously true", () => {
    expect(deletionsOnlyIn({ text: "" })).toBe(false);
    expect(deletionsOnlyIn({ text: null })).toBe(false);
  });
});

describe("liveReferencesTo", () => {
  const live = liveReferenceIndex({
    cwds: new Map(),
    sessions: [],
    workspaces: [
      workspace({ currentDirectory: "/repo/.claude/worktrees/old-tree/apps/web", workspaceRef: "workspace:3" }),
      workspace({ currentDirectory: "/repo/.claude/worktrees/old-tree-2", workspaceRef: "workspace:4" }),
    ],
  });

  it("holds a tree a live workspace stands beneath, in a subdirectory of it", () => {
    expect(liveReferencesTo({ live, path: "/repo/.claude/worktrees.noindex/old-tree" })).toEqual([
      "live workspace workspace:3",
    ]);
  });

  it("does not hold a tree whose name is only a prefix of another tree's", () => {
    expect(liveReferencesTo({ live, path: "/repo/.claude/worktrees/old" })).toEqual([]);
  });

  it("holds a tree referenced at its own root, however its path is spelled", () => {
    expect(liveReferencesTo({ live, path: "/private/repo/.claude/worktrees/old-tree-2/" })).toEqual([
      "live workspace workspace:4",
    ]);
  });
});
