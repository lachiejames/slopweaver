/**
 * The gold anchor `github push` prints for the head it just sent: the commit and the patch id a session records
 * beside its own proof. A C3 description never carries it (`AGENTS.md` rule 7), so it is printed, not written.
 *
 * Split out of `./pushRun.ts`, which calls only `printGoldAnchor` once a push has been verified.
 */
import type { GithubPushPlan } from "../../../admit/githubPush.js";
import type { GithubPushDeps } from "./pushPrimitives.js";

/**
 * Print the gold anchor for the head just sent, for the session to record beside its proof.
 *
 * This is where the author is standing when they need it, and both values come from the head that was just
 * sent. `patchId` is the one that makes a later rebase free: it identifies what the branch CONTRIBUTES to its
 * base, which a rebase onto a base the branch does not overlap leaves untouched, while the head SHA the gate
 * compares first moves every time. `merge-base(base, head)...head` is the same value CI recomputes as
 * `HEAD^1..HEAD` over GitHub's merge commit — the two forms were compared and agree.
 *
 * Best-effort by construction: a measurement that fails prints why and still offers the commit, because a
 * push that worked must not be reported as a failure over an anchor the author can also gather by hand.
 *
 * @param plan the verified push, whose local SHA is the anchor's commit
 * @param baseSha the base the freshness check measured, which the patch id is diffed against
 */
export function printGoldAnchor({
  plan,
  baseSha,
  deps,
}: {
  plan: GithubPushPlan;
  baseSha: string | undefined;
  deps: GithubPushDeps;
}): void {
  const patch = measuredPatchAnchor({ baseSha, deps, head: plan.localSha, repoRoot: plan.repoRoot });
  const goldAnchor = "patchId" in patch ? { commit: plan.localSha, patchId: patch.patchId } : { commit: plan.localSha };
  deps.out({ line: "" });
  deps.out({ line: "gold anchor for this head (record it beside the proof; no description carries it):" });
  deps.out({ line: `  ${JSON.stringify({ goldAnchor })}` });
  if ("unavailable" in patch) {
    deps.out({ line: `  no patchId: ${patch.unavailable}` });
  }
}

/**
 * The patch id of what `head` contributes to `baseSha`, or the reason there is none, so every branch says
 * something. `github stack push` reads it too, for the commit its amend just made.
 *
 * @param baseSha the base the contribution is diffed against; absent when it could not be measured
 * @param deps the push driver, whose optional `readPatchId` edge does the measuring
 * @param head the commit whose contribution is fingerprinted
 * @param repoRoot the checkout the measurement runs in
 * @returns the patch id, or why there is none
 */
function measuredPatchAnchor({
  baseSha,
  deps,
  head,
  repoRoot,
}: {
  baseSha: string | undefined;
  deps: Pick<GithubPushDeps, "readPatchId">;
  head: string;
  repoRoot: string;
}): { readonly patchId: string } | { readonly unavailable: string } {
  if (baseSha === undefined) {
    return { unavailable: "base freshness could not be measured, so there is no base to diff against" };
  }
  const measure = deps.readPatchId;
  if (measure === undefined) {
    return { unavailable: "this push driver cannot measure a patch id" };
  }
  const measured = measure({ base: baseSha, cwd: repoRoot, head });
  if (measured.isErr()) {
    return { unavailable: measured.error };
  }
  if (measured.value === null) {
    return { unavailable: "this branch contributes no diff to its base" };
  }
  return { patchId: measured.value };
}
