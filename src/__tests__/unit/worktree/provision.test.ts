import { describe, expect, it } from "vitest";
import { err, unwrap, unwrapErr } from "../../../lib/result.js";
import type { DepsFacts } from "../../../worktree/deps.js";
import { type WorktreeError, WorktreeErrors } from "../../../worktree/errors.js";
import {
  defaultRequest,
  provisionWorktree,
  renderProvisionReport,
  type WorktreeProvisionDeps,
  type WorktreeRequest,
} from "../../../worktree/provision.js";
import type { RecycleClaim } from "../../../worktree/recyclePool.js";
import type { DevBuildFailure } from "../../../worktree/shell.js";

/** What every recorder below writes into, so an assertion is about calls made, not about a mock. */
interface Calls {
  created: string[];
  installed: string[];
  built: string[];
  devBuilt: string[];
  linked: string[];
  privatised: string[];
  marked: string[];
  claimed: string[];
  discarded: string[];
  /** Every seam in the order it fired, so ordering is proved by ONE list rather than inferred from six. */
  order: string[];
}

const SHARED_ROOT = "/plugin/cli-deps/node_modules";

/** What the pool answers when nothing is in it — the default, so every case not about recycling installs from empty. */
const EMPTY_POOL: RecycleClaim = { detail: "the recycle pool is empty", kind: "skipped", reason: "pool-empty" };

/** A tree that is present, own and current, with a lockfile matching the shared one. */
const INSTALLED: DepsFacts = {
  installStateMs: 3_000,
  verifiedAtMs: undefined,
  linkTarget: undefined,
  lockfileMs: 2_000,
  lockfileText: "lock-a",
  manifestMs: 1_000,
  present: true,
  sharedLockfileText: "lock-a",
};

/** Fake seams that record what they were asked to do and answer with whatever the test set up. */
function fakeDeps({
  calls,
  worktrees = [],
  facts = INSTALLED,
  installFailure,
  markFailure,
  buildFailure,
  devBuildFailure,
  supportsDevBuild = true,
  createThrows,
  recycled = EMPTY_POOL,
  retryFailure,
  discardFailure,
  holdRefusal,
}: {
  calls: Calls;
  worktrees?: readonly { path: string; branch: string | null }[];
  facts?: DepsFacts;
  installFailure?: string;
  markFailure?: string;
  buildFailure?: string;
  devBuildFailure?: DevBuildFailure;
  supportsDevBuild?: boolean;
  createThrows?: string;
  recycled?: RecycleClaim;
  retryFailure?: string;
  discardFailure?: string;
  holdRefusal?: WorktreeError;
}): WorktreeProvisionDeps {
  return {
    build: ({ cwd }) => {
      calls.built.push(cwd);
      calls.order.push("build");
      return buildFailure;
    },
    create: ({ path }) => {
      calls.created.push(path);
      calls.order.push("create");
      if (createThrows !== undefined) {
        throw new Error(createThrows);
      }
    },
    devBuild: ({ cwd }) => {
      calls.devBuilt.push(cwd);
      calls.order.push("devBuild");
      return devBuildFailure;
    },
    claimRecycled: ({ path }) => {
      calls.claimed.push(path);
      calls.order.push("claimRecycled");
      return recycled;
    },
    discardRecycled: ({ path }) => {
      calls.discarded.push(path);
      calls.order.push("discardRecycled");
      return discardFailure;
    },
    holdOwnTree: ({ act }) => {
      if (holdRefusal !== undefined) {
        calls.order.push("hold-refused");
        return err(holdRefusal);
      }
      calls.order.push("hold");
      const held = act();
      calls.order.push("release");
      return held;
    },
    install: ({ cwd }) => {
      calls.installed.push(cwd);
      calls.order.push("install");
      return calls.installed.length === 1 ? installFailure : retryFailure;
    },
    linkShared: ({ path }) => {
      calls.linked.push(path);
      calls.order.push("linkShared");
    },
    privatiseExecInodes: ({ root }) => {
      calls.privatised.push(root);
      calls.order.push("privatiseExecInodes");
      return { applied: true, execStore: "scratch-exec-store", outcomes: [], root };
    },
    readDepsFacts: () => facts,
    recordInstallVerified: ({ root }) => {
      calls.marked.push(root);
      calls.order.push("recordInstallVerified");
      return markFailure;
    },
    sharedRoot: () => SHARED_ROOT,
    supportsDevBuild: () => supportsDevBuild,
    worktrees: () => worktrees,
  };
}

/** A fresh, empty recorder. */
function newCalls(): Calls {
  return {
    built: [],
    claimed: [],
    created: [],
    discarded: [],
    devBuilt: [],
    installed: [],
    linked: [],
    marked: [],
    order: [],
    privatised: [],
  };
}

const REQUEST: WorktreeRequest = defaultRequest({ repoRoot: "/repo", slug: "a-slug" });

describe("provisionWorktree", () => {
  it("marks the install as verified, so the next read does not call the tree it just installed stale", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: REQUEST }));

    expect(report.deps).toBe("installed");
    expect(calls.marked).toEqual(["/repo/.claude/worktrees.noindex/a-slug"]);
  });

  it("fails the provision when the install ran but its mark could not be written", () => {
    const calls = newCalls();
    const error = unwrapErr(
      provisionWorktree({ deps: fakeDeps({ calls, markFailure: "EACCES: permission denied" }), request: REQUEST }),
    );

    expect(error.code).toBe("INSTALL_FAILED");
    expect(error.message).toContain("the install succeeded but its verified-install mark could not be written");
    expect(calls.privatised).toEqual([]);
  });

  it("does not mark a worktree that linked the shared tree instead of installing one", () => {
    const calls = newCalls();
    unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, deps: "shared" } }));

    expect(calls.marked).toEqual([]);
  });

  it("creates the conventional path and installs the worktree's own tree by default", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: REQUEST }));

    expect(report.path).toBe("/repo/.claude/worktrees.noindex/a-slug");
    expect(report.created).toBe(true);
    expect(report.deps).toBe("installed");
    expect(calls.installed).toEqual(["/repo/.claude/worktrees.noindex/a-slug"]);
    expect(calls.linked).toEqual([]);
  });

  it("reuses a worktree that already holds the branch, wherever it lives, and still installs there", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, worktrees: [{ branch: "a-slug", path: "/elsewhere/old-name" }] });
    const report = unwrap(provisionWorktree({ deps, request: REQUEST }));

    expect(report.created).toBe(false);
    expect(report.path).toBe("/elsewhere/old-name");
    expect(calls.created).toEqual([]);
    expect(calls.installed).toEqual(["/elsewhere/old-name"]);
  });

  it("reuses a worktree already registered at the path, whatever branch that one holds", () => {
    const calls = newCalls();
    const deps = fakeDeps({
      calls,
      worktrees: [{ branch: "local-15786", path: "/repo/.claude/worktrees/a-slug" }],
    });
    const report = unwrap(provisionWorktree({ deps, request: REQUEST }));

    expect(report.created).toBe(false);
    expect(report.branch).toBe("local-15786");
  });

  it("honours an explicit path a caller already decided, instead of the conventional one", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls });
    unwrap(provisionWorktree({ deps, request: { ...REQUEST, path: "/somewhere/else" } }));

    expect(calls.created).toEqual(["/somewhere/else"]);
  });

  it("skips the install entirely when the caller asked it to", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, install: false } }));

    expect(report.deps).toBe("skipped");
    expect(calls.installed).toEqual([]);
    expect(calls.linked).toEqual([]);
  });

  it("links the shared tree when asked and the lockfiles are identical", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, deps: "shared" } }));

    expect(report.deps).toBe("linked-shared");
    expect(calls.linked).toEqual(["/repo/.claude/worktrees.noindex/a-slug"]);
    expect(calls.installed).toEqual([]);
  });

  it("refuses the shared tree when the lockfiles differ, and links nothing", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, facts: { ...INSTALLED, sharedLockfileText: "lock-b" } });
    const error = unwrapErr(provisionWorktree({ deps, request: { ...REQUEST, deps: "shared" } }));

    expect(error.code).toBe("SHARED_DEPS_MISMATCH");
    expect(error.message).toContain(SHARED_ROOT);
    expect(calls.linked).toEqual([]);
  });

  it("reports a failed install as INSTALL_FAILED and never goes on to build", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, installFailure: "YN0028: lockfile would have been modified" });
    const error = unwrapErr(provisionWorktree({ deps, request: { ...REQUEST, build: true } }));

    expect(error.code).toBe("INSTALL_FAILED");
    expect(error.message).toContain("YN0028");
    expect(calls.built).toEqual([]);
  });

  it("reports a failed build as its own step", () => {
    const calls = newCalls();
    const deps = fakeDeps({ buildFailure: "TS2307", calls });
    const error = unwrapErr(provisionWorktree({ deps, request: { ...REQUEST, build: true } }));

    expect(error.code).toBe("INSTALL_FAILED");
    expect(error.message).toContain("yarn build");
  });

  it("turns a git refusal into GIT_FAILED rather than throwing out of the verb", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, createThrows: "already exists" });
    const error = unwrapErr(provisionWorktree({ deps, request: REQUEST }));

    expect(error.code).toBe("GIT_FAILED");
    expect(error.message).toContain("already exists");
  });

  it("runs the build only when it was asked for", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, build: true } }));

    expect(report.built).toBe(true);
    expect(calls.built).toEqual(["/repo/.claude/worktrees.noindex/a-slug"]);
  });

  it("emits the built CLI by default, so the worktree's own verbs stop booting tsx", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: REQUEST }));

    expect(report.devBuild).toEqual({ did: "emitted" });
    expect(calls.devBuilt).toEqual(["/repo/.claude/worktrees.noindex/a-slug"]);
  });

  it("emits LAST, after the install, its mark and the inode privatisation", () => {
    const calls = newCalls();
    unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, build: true } }));

    expect(calls.order).toEqual([
      "create",
      "hold",
      "claimRecycled",
      "install",
      "recordInstallVerified",
      "privatiseExecInodes",
      "release",
      "build",
      "devBuild",
    ]);
  });

  it("skips the emit when --no-dev-build was passed, and says that is why", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, devBuild: false } }));

    expect(report.devBuild).toEqual({ did: "skipped", why: "--no-dev-build" });
    expect(calls.devBuilt).toEqual([]);
  });

  it("skips the emit when the install was skipped, because there is no tsx here to run it", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, install: false } }));

    expect(report.devBuild).toEqual({ did: "skipped", why: "--no-install, so there is no tsx here to emit with" });
    expect(calls.devBuilt).toEqual([]);
  });

  it("skips the emit in a repository that carries no emitter, rather than running something else", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, supportsDevBuild: false });
    const report = unwrap(provisionWorktree({ deps, request: REQUEST }));

    expect(report.devBuild).toEqual({
      did: "skipped",
      why: "this repository has no `slopweaver dev build` to emit with",
    });
    expect(calls.devBuilt).toEqual([]);
  });

  it("still emits for a worktree that linked the shared tree, which writes nothing into that tree", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, deps: "shared" } }));

    expect(report.devBuild).toEqual({ did: "emitted" });
    expect(calls.devBuilt).toEqual(["/repo/.claude/worktrees.noindex/a-slug"]);
  });

  it("survives a failed emit and reports it, because a worktree without one still works", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, devBuildFailure: { detail: "smoke run exited 1", left: "removed" } });
    const report = unwrap(provisionWorktree({ deps, request: REQUEST }));

    expect(report.devBuild).toEqual({ detail: "smoke run exited 1", did: "failed", left: "removed" });
    expect(report.deps).toBe("installed");
  });

  it("never reaches the emit when the install failed", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, installFailure: "YN0028: lockfile would have been modified" });
    const error = unwrapErr(provisionWorktree({ deps, request: REQUEST }));

    expect(error.code).toBe("INSTALL_FAILED");
    expect(calls.devBuilt).toEqual([]);
  });

  it("never reaches the emit when the shared lockfiles disagree", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, facts: { ...INSTALLED, sharedLockfileText: "lock-b" } });
    const error = unwrapErr(provisionWorktree({ deps, request: { ...REQUEST, deps: "shared" } }));

    expect(error.code).toBe("SHARED_DEPS_MISMATCH");
    expect(calls.devBuilt).toEqual([]);
  });

  it("never reaches the emit when the optional tsc build failed, which is still fatal", () => {
    const calls = newCalls();
    const deps = fakeDeps({ buildFailure: "TS2307", calls });
    const error = unwrapErr(provisionWorktree({ deps, request: { ...REQUEST, build: true } }));

    expect(error.code).toBe("INSTALL_FAILED");
    expect(calls.devBuilt).toEqual([]);
  });
});

describe("provisionWorktree from a recycled tree", () => {
  const CLAIMED: RecycleClaim = { from: "/pool/0/old-seat-1791608371016-66700", kind: "claimed" };

  it("claims before the install, then runs the unchanged mark, privatisation and emit over it", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls, recycled: CLAIMED }), request: REQUEST }));

    expect(report.recycled).toEqual(CLAIMED);
    expect(calls.order).toEqual([
      "create",
      "hold",
      "claimRecycled",
      "install",
      "recordInstallVerified",
      "privatiseExecInodes",
      "release",
      "devBuild",
    ]);
    expect(renderProvisionReport({ report })[2]).toBe(
      "  recycled: started from /pool/0/old-seat-1791608371016-66700, reconciled by yarn",
    );
  });

  it("throws the recycled tree away and installs once more from empty when the install over it fails", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, installFailure: "YN0001: broken tree", recycled: CLAIMED });
    const report = unwrap(provisionWorktree({ deps, request: REQUEST }));

    expect(report.recycled).toEqual({ from: "/pool/0/old-seat-1791608371016-66700", kind: "fresh-after-discard" });
    expect(renderProvisionReport({ report })[2]).toBe(
      "  recycled: the install over /pool/0/old-seat-1791608371016-66700 failed, so it was discarded and the install rerun empty",
    );
    expect(calls.order).toEqual([
      "create",
      "hold",
      "claimRecycled",
      "install",
      "discardRecycled",
      "install",
      "recordInstallVerified",
      "privatiseExecInodes",
      "release",
      "devBuild",
    ]);
  });

  it("fails with both installs' output when the retry from empty fails too", () => {
    const calls = newCalls();
    const deps = fakeDeps({
      calls,
      installFailure: "YN0001: first",
      recycled: CLAIMED,
      retryFailure: "YN0001: second",
    });
    const error = unwrapErr(provisionWorktree({ deps, request: REQUEST }));

    expect(error.code).toBe("INSTALL_FAILED");
    expect(error.message).toContain("YN0001: second");
    expect(error.message).toContain("first over the recycled tree /pool/0/old-seat-1791608371016-66700: YN0001: first");
    expect(calls.marked).toEqual([]);
  });

  it("fails without a retry when the recycled tree cannot be moved aside, rather than installing over it twice", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, discardFailure: "EXDEV", installFailure: "YN0001: first", recycled: CLAIMED });
    const error = unwrapErr(provisionWorktree({ deps, request: REQUEST }));

    expect(error.code).toBe("RECYCLE_FAILED");
    expect(error.message).toContain("could not be moved aside for a clean install (EXDEV)");
    expect(calls.installed).toEqual(["/repo/.claude/worktrees.noindex/a-slug"]);
  });

  it("never retries or discards when the install failed over an EMPTY tree", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, installFailure: "YN0028: lockfile would have been modified" });
    unwrapErr(provisionWorktree({ deps, request: REQUEST }));

    expect(calls.discarded).toEqual([]);
    expect(calls.installed).toEqual(["/repo/.claude/worktrees.noindex/a-slug"]);
  });

  it("never claims for the shared tree or a request that installs nothing", () => {
    const calls = newCalls();
    const shared = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, deps: "shared" } }));
    const none = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, install: false } }));

    expect(shared.recycled).toBe(undefined);
    expect(none.recycled).toBe(undefined);
    expect(calls.claimed).toEqual([]);
  });

  it("claims, installs, marks and privatises nothing when another process holds the tree's deps lock", () => {
    const calls = newCalls();
    const holdRefusal = WorktreeErrors.installFailed({ detail: "held by pid 4242", step: "install" });
    const error = unwrapErr(provisionWorktree({ deps: fakeDeps({ calls, holdRefusal }), request: REQUEST }));

    expect(error).toEqual(holdRefusal);
    expect(calls.order).toEqual(["create", "hold-refused"]);
  });
});

describe("defaultRequest", () => {
  it("is the owner's v1 rule: install on, own tree, no tsc build — plus the built CLI, which is on", () => {
    expect(REQUEST.install).toBe(true);
    expect(REQUEST.deps).toBe("own");
    expect(REQUEST.build).toBe(false);
    expect(REQUEST.devBuild).toBe(true);
    expect(REQUEST.branch).toBe("a-slug");
    expect(REQUEST.path).toBe("/repo/.claude/worktrees.noindex/a-slug");
  });
});

describe("renderProvisionReport", () => {
  it("leads with what happened to the worktree, then its deps and both of its builds", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: REQUEST }));
    const lines = renderProvisionReport({ report });

    expect(lines[0]).toBe("created /repo/.claude/worktrees.noindex/a-slug on a-slug");
    expect(lines[1]).toContain("own tree, current");
    expect(lines[2]).toBe("  recycled: none (pool-empty), installed from empty — the recycle pool is empty");
    expect(lines[3]).toContain("exec inodes: 0 native binary(ies) relinked off yarn's shared store");
    expect(lines[4]).toBe("  build: dist-cli emitted; tsc skipped (no verb here needs it; pass --build to run it)");
  });

  it("names the repair command on the line, when the emit failed", () => {
    const calls = newCalls();
    const deps = fakeDeps({ calls, devBuildFailure: { detail: "esbuild: EACCES", left: "removed" } });
    const report = unwrap(provisionWorktree({ deps, request: REQUEST }));

    expect(renderProvisionReport({ report })[4]).toBe(
      "  build: dist-cli FAILED: esbuild: EACCES — this worktree runs from source; repair it with " +
        "`slopweaver dev build` in /repo/.claude/worktrees.noindex/a-slug; " +
        "tsc skipped (no verb here needs it; pass --build to run it)",
    );
  });

  it("says tsc ran when it did, without confusing it with the built CLI", () => {
    const calls = newCalls();
    const report = unwrap(provisionWorktree({ deps: fakeDeps({ calls }), request: { ...REQUEST, build: true } }));

    expect(renderProvisionReport({ report })[4]).toBe("  build: dist-cli emitted; tsc ran (`yarn build`)");
  });
});
