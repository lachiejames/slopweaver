/**
 * The effectful half of the `post-merge` / `post-checkout` git hooks — the shell over
 * `./refMoveInstall.ts`'s decisions and `./install.ts`'s three install steps.
 *
 * `.git/hooks` is SHARED across every worktree of this repository, so this file runs in whichever checkout
 * the ref actually moved in — a linked worktree included. That is the intent rather than a hazard: a
 * worktree whose branch carries a different lockfile needs the same install a main checkout does. What
 * scopes the work is the CONTENT predicate in `./refMoveInstall.ts`, exactly the way
 * `../admit/mainCheckoutCommitGuard.ts`'s own predicate — not the hook's presence — scopes that refusal.
 *
 * The ONE checkout shape it refuses is a `--deps shared` worktree, whose `node_modules` is a symlink into
 * the plugin's shared tree (`../worktree/provision.ts`'s `linkShared`): installing there would write that
 * shared tree on behalf of one branch's lockfile, for every other worktree reading it.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";

import { withDepsLock } from "../worktree/depsLock.js";
import { parseNameOnly } from "./freshness.js";
import { type CheckoutInspectDeps, changedPathsBetween } from "./inspect.js";
import { runImmutableInstall, unshareExecInodes } from "./install.js";
import { recordInstallVerified } from "./installMark.js";
import {
  postCheckoutPlan,
  postMergePlan,
  type RefMoveComparison,
  type RefMoveHook,
  type RefMoveOutcome,
  type RefMovePlan,
  refMoveInstallDecision,
} from "./refMoveInstall.js";

/** Whether this checkout's `node_modules` is a symlink into a tree some other checkout owns. */
function hasSharedDeps({ cwd }: { cwd: string }): boolean {
  try {
    return lstatSync(join(cwd, "node_modules")).isSymbolicLink();
  } catch {
    return false; // no node_modules at all is not a shared one; the install below is what it needs
  }
}

/**
 * The plan for whichever hook is running, reading the refs a `post-merge` has to look up for itself.
 *
 * Exported because the built-CLI hook (`./refMoveBuildRun.ts`) decodes the SAME git arguments: two copies of
 * this decode would be two chances to get the `post-checkout` branch flag or the squash arm wrong.
 *
 * @param hook which git hook is running
 * @param args the arguments git passed this hook, in order to that hook, in order
 * @param cwd the checkout the ref moved in
 * @param deps the git read seam
 * @returns the comparison to take, or the skip and its reason
 */
export function planFor({
  hook,
  args,
  cwd,
  deps,
}: {
  hook: RefMoveHook;
  args: readonly string[];
  cwd: string;
  deps: CheckoutInspectDeps;
}): RefMovePlan {
  if (hook === "post-checkout") {
    return postCheckoutPlan({ branchFlag: args[2], newRef: args[1], previousRef: args[0] });
  }
  return postMergePlan({
    head: deps.git({ args: ["rev-parse", "HEAD"], cwd }),
    origHead: deps.git({ args: ["rev-parse", "ORIG_HEAD"], cwd }),
    squashFlag: args[0],
  });
}

/**
 * The repo-relative paths one comparison covers, or undefined when git could not take the diff.
 *
 * Exported for the reason {@link planFor} is: the built-CLI hook asks the same question of the same move.
 *
 * @param comparison what to diff
 * @param cwd the checkout the ref moved in
 * @param deps the git read seam
 * @returns the changed paths, or undefined when the diff could not be taken
 */
export function changedPathsFor({
  comparison,
  cwd,
  deps,
}: {
  comparison: RefMoveComparison;
  cwd: string;
  deps: CheckoutInspectDeps;
}): readonly string[] | undefined {
  if (comparison.against === "commits") {
    return changedPathsBetween({ cwd, deps, from: comparison.from, to: comparison.to });
  }
  const text = deps.git({ args: ["diff", "--cached", "--name-only", comparison.from], cwd });
  if (text === undefined) {
    return undefined;
  }
  return parseNameOnly({ text });
}

/** Install, mark, and unshare — the three steps `./install.ts` documents, reported as one outcome. */
function installNow({ cwd, why }: { cwd: string; why: string }): RefMoveOutcome {
  const failure = runImmutableInstall({ cwd });
  if (failure !== undefined) {
    return { detail: failure, did: "failed", why };
  }
  const unmarked = recordInstallVerified({ nowIso: new Date().toISOString(), root: cwd });
  if (unmarked !== undefined) {
    return {
      detail: `the install succeeded but its verified-install mark could not be written, so the freshness gauge will still read STALE: ${unmarked}`,
      did: "failed",
      why,
    };
  }
  return { detail: unshareTally({ cwd }), did: "installed", why };
}

/**
 * The unshare clause, with a thrown failure turned into text rather than a stack trace.
 *
 * `unshareExecInodes` walks a whole `node_modules` and hardlinks into the exec store, so a permission or
 * disk error there throws. Unhandled, that replaces the hook's single honest line with a tsx stack — and
 * "always exactly one line" is the property this whole feature is built on, so the failure is reported
 * INSIDE the line instead. The install itself already succeeded when this runs.
 */
function unshareTally({ cwd }: { cwd: string }): string {
  try {
    return unshareExecInodes({ root: cwd });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return `exec inodes: NOT UNSHARED — yarn's shared store may still own a native binary here: ${detail}`;
  }
}

/**
 * Decide and act for one hook invocation.
 *
 * @param hook which git hook is running
 * @param args git's own arguments to that hook, in order
 * @param cwd the checkout the ref moved in
 * @param deps the git read seam
 * @param install the install seam — {@link installNow} in production, a plain fake in a unit test, which is
 *   what lets the routing above be proved without spawning yarn
 * @returns what it did
 */
export function runRefMoveInstall({
  hook,
  args,
  cwd,
  deps,
  install = installNow,
}: {
  hook: RefMoveHook;
  args: readonly string[];
  cwd: string;
  deps: CheckoutInspectDeps;
  install?: (args: { cwd: string; why: string }) => RefMoveOutcome;
}): RefMoveOutcome {
  if (hasSharedDeps({ cwd })) {
    return { did: "skipped", why: "node_modules is a symlink into a shared tree other checkouts read" };
  }
  const plan = planFor({ args, cwd, deps, hook });
  if (plan.act === "skip") {
    return { did: "skipped", why: plan.why };
  }
  const changedPaths = changedPathsFor({ comparison: plan.comparison, cwd, deps });
  if (changedPaths === undefined) {
    return { did: "skipped", why: "git could not diff the move, so nothing here knows what it brought in" };
  }
  const decision = refMoveInstallDecision({ changedPaths });
  if (!decision.install) {
    return { did: "current", why: decision.why };
  }
  // Held through the install, mark and unshare, so a worktree's hook never writes the `node_modules` a provision, a
  // prune or a removal holds (`../worktree/depsLock.ts`); a lock it cannot take is a failure named, since the tree
  // is not proven to match its lockfile.
  const held = withDepsLock({ act: () => install({ cwd, why: decision.why }), waitMs: 0, worktree: cwd });
  if (held.isErr()) {
    return {
      detail: `another process holds this checkout's node_modules, so nothing was installed: ${held.error}`,
      did: "failed",
      why: decision.why,
    };
  }
  return held.value;
}
