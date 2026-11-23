/**
 * Whether a worktree being provisioned should get its FIRST built CLI, and what that attempt ended up doing.
 *
 * ## Why provisioning is the only place this can happen
 *
 * `bin/slopweaver` runs the built `dist-cli` when — and only when — that tree carries a build manifest, and
 * a checkout that has never built one runs every verb through `tsx` instead. Measured under a
 * one-minute load of 16: `handover list` 0.92s built against 1.49s under tsx, `catalog` 1.13s against 1.46s,
 * over 4,964 verb invocations that day. One of 72 worktrees had a build.
 *
 * The `post-merge` / `post-checkout` hooks cannot close that gap, and BOTH halves of why are measured rather
 * than argued. `git worktree add` fires `post-checkout` before the new tree has any `node_modules` at all, so
 * the hook cannot even boot — verbatim, from a throwaway worktree, `sh:
 * node_modules/.bin/tsx: No such file or directory`, exit status 127. And even with tsx in place,
 * `postCheckoutPlan` skips a move whose previous ref is the null OID, saying so in its own words: "there is
 * no previous commit to compare against — a new worktree installs through `cmux spawn`". Repro:
 *
 *   git worktree add --detach "$(mktemp -d)/probe" HEAD   # and read lefthook's own summary
 *
 * So the hooks KEEP a build current and provisioning CREATES the first one. Neither guard is weakened by
 * this: once provisioning has emitted, `lefthook.yml`'s `test -f dist-cli/.slopweaver-build.json` finds a
 * manifest and the hook it guards starts doing the job it was written for.
 */
import type { DiscardOutcome } from "./shell.js";

/** Whether to emit a built CLI for a worktree being provisioned, and the sentence that says why either way. */
export type DevBuildDecision =
  /** Emit it: this tree can run the emitter and nobody asked for it to be left out. */
  | { readonly emit: true }
  /** Leave it: something about the request or the target means no emit belongs here. */
  | { readonly emit: false; readonly why: string };

/** What one emit attempt ended up doing, ready to render as its clause of the provision report. */
export type DevBuildOutcome =
  /** The built CLI is there, and this provisioning is what put it there. */
  | { readonly did: "emitted" }
  /** No attempt was made, and this is the reason. */
  | { readonly did: "skipped"; readonly why: string }
  /**
   * The emit ran and failed. Provisioning SURVIVES this: a worktree with no built CLI is the state every
   * worktree was in before this existed, and refusing to open the session that would repair it trades a
   * performance default for an availability regression.
   *
   * `left` is what the failed emit's own cleanup managed to do, and it is here rather than inside `detail`
   * because it decides what is TRUE of the worktree afterwards — `shell.ts`'s `discardBrokenBuild` carries
   * the hazard a `kept` still leaves standing.
   */
  | { readonly did: "failed"; readonly detail: string; readonly left: DiscardOutcome };

/**
 * Decide whether provisioning emits a built CLI for one worktree.
 *
 * Explicit intent is read before capability, so a caller who passed `--no-dev-build` is told that is why —
 * never that their target looked incapable.
 *
 * @param enabled what the caller asked for, `--no-dev-build` being the only way to turn it off
 * @param deps what {@link import("./provision.js").WorktreeProvisionReport.deps} settled to, because a tree
 *   whose dependencies were skipped has no `tsx` to run the emitter with
 * @param supported whether the resolved target carries this repository's own emitter — `worktree create
 *   --repo` and `cmux spawn` both reach repositories that do not
 * @returns whether to emit, and why not when it does not
 */
export function devBuildDecision({
  enabled,
  deps,
  supported,
}: {
  enabled: boolean;
  deps: "installed" | "linked-shared" | "skipped";
  supported: boolean;
}): DevBuildDecision {
  if (!enabled) {
    return { emit: false, why: "--no-dev-build" };
  }
  if (deps === "skipped") {
    return { emit: false, why: "--no-install, so there is no tsx here to emit with" };
  }
  if (!supported) {
    return { emit: false, why: "this repository has no `slopweaver dev build` to emit with" };
  }
  return { emit: true };
}

/**
 * Render what the emit did as the clause the provision report prints about it.
 *
 * A failure names the command that repairs it, because the tree is now in the state it was always in and
 * the next session in it has no other way to know an attempt was made at all.
 *
 * "Runs from source" is EARNED, never assumed, and only a PROVEN absence earns it.
 * `shell.ts`'s `discardBrokenBuild` removes the UNSTAMPED built tree a failed emit leaves, and each thing it
 * can find instead gets its own sentence. One it cannot remove is runnable JavaScript that
 * `builtCli/guard.ts` will not refuse, because the guard reads a manifest the emitter had already cleared. A
 * STAMPED one it deliberately left alone is a tree this emit did not touch, so source is not what the
 * worktree is left on either. Printing the reassuring clause over either would be the report lying — and
 * each clause claims only what its own read established, never what `bin/slopweaver` will go on to do.
 *
 * @param outcome what the emit did
 * @param path the worktree it was attempted in, so a failure names a directory a reader can stand in
 * @returns one clause, guaranteed to carry no line break
 */
export function renderDevBuildOutcome({ outcome, path }: { outcome: DevBuildOutcome; path: string }): string {
  if (outcome.did === "emitted") {
    return "dist-cli emitted";
  }
  if (outcome.did === "skipped") {
    return `dist-cli skipped (${outcome.why})`;
  }
  if (outcome.left === "kept") {
    return `dist-cli FAILED: ${outcome.detail} — and its unstamped dist-cli could NOT be removed, so ${path}/dist-cli still holds JavaScript nothing guards; delete it by hand, then \`slopweaver dev build\``;
  }
  if (outcome.left === "unreadable") {
    return `dist-cli FAILED: ${outcome.detail} — and whether ${path}/dist-cli is still a stamped build could not be read at all, so it was left exactly as it stands; look at it before trusting either answer`;
  }
  if (outcome.left === "guarded") {
    // Says stamped and untouched, which is what the two reads established — never what the launcher will do
    // with it. `bin/slopweaver` wants a manifest AND an entrypoint, so a stamp alone does not settle that.
    return `dist-cli FAILED: ${outcome.detail} — the ${path}/dist-cli already there is still stamped, so this emit left it untouched; refresh it with \`slopweaver dev build\``;
  }
  return `dist-cli FAILED: ${outcome.detail} — this worktree runs from source; repair it with \`slopweaver dev build\` in ${path}`;
}
