/**
 * The merge guard — the last unguarded mutation, brought through the door.
 *
 * ## The failure this exists to catch
 *
 * Measured. One pull request added the latest-record collapse to `distil`, the only verb that
 * spends tokens. A second — unrelated GitHub work — removed all 394 lines of it, including a whole
 * 198-line test file, and named `distil` nowhere in its diff summary or its description. It reached `main`
 * with a clean-looking diff and a green CI run, and a human found it days later.
 *
 * The mechanism is worth stating because it is invisible and repeatable: the second was squashed with
 * `git reset --soft main`, which keeps YOUR tree and moves HEAD to the named parent. `main` had advanced to
 * the first while the branch was in flight, so every file the first had added was recorded as a DELETION.
 *
 * ## Why the obvious controls do not work
 *
 * - **Branch protection's "require branches up to date"** does not catch it. The branch was reset ONTO
 *   `main`, so it WAS up to date. This is not a guess — it is what the recorded mechanism means.
 * - **A green test suite** does not catch it, because the guard test was deleted in the same commit. A test
 *   protects only code it still exists beside; deleting it is a total, silent bypass.
 * - **The orchestration board** does not catch it. The owning doc said `status: done` throughout while its
 *   probe was failing, and probes are never re-evaluated once a doc is done.
 *
 * ## What DOES work, and needs no judgement
 *
 * Every orchestration doc's `doneWhen` probes already encode *what must stay true*. Evaluating them against
 * the post-merge tree turns "did this PR quietly undo something?" into arithmetic. The second deleted the exact
 * symbol another doc's `present:` probe asserts, so a probe sweep would have refused it outright — no
 * heuristic, no allowlist, no model.
 *
 * This module is the PURE half: it takes facts a caller measured and returns findings. It reads no files,
 * runs no git and calls no model — the doctrine forbids the last of those, and the first two are what make
 * it testable with inline fixtures.
 */

/**
 * Why a merge was flagged. Each kind is decidable from the supplied facts alone.
 *
 * `docs-budget` is the one exception to "decidable here": its findings arrive pre-built from
 * `../../cli/commands/github/mergeCore.js`'s `docsBudgetFindingsFromSweep`, because deciding them needs the
 * always-on-docs ratchets from `../../canon/alwaysOnDocs.js` rather than anything this module already reads.
 */
export type MergeFindingKind =
  | "probe-regression"
  | "reverts-main"
  | "base-moved"
  | "base-unresolved"
  | "unmentioned-test-deletion"
  | "unmentioned-deletion"
  | "docs-budget";

/** How a path changed in this pull request. */
export type DiffStatus = "added" | "deleted" | "modified";

/** One path's change, as a caller measured it from the diff. */
export interface DiffPath {
  readonly path: string;
  readonly status: DiffStatus;
  /** Lines removed. Present for `modified` too — a revert usually reads as a large modification. */
  readonly deleted: number;
}

/**
 * One path whose proposed content is a blob the base branch's OWN history once held and no longer does.
 *
 * It carries the commit that match was found at, because the finding is only legible with it: the operator
 * has to look at what that commit did to decide whether restoring its predecessor is the change they meant.
 */
export interface RevertedPath {
  readonly path: string;
  /** The base commit whose content for this path `head` is proposing to restore. */
  readonly restoresBaseCommit: string;
}

/** A doc probe that passes on the base branch and would fail once this pull request lands. */
export interface ProbeRegression {
  /** The doc that declared the probe. */
  readonly slug: string;
  /** The probe as written, e.g. `present: src/x.ts#sym`. */
  readonly probe: string;
}

/** One reason this merge should not proceed unacknowledged. */
export interface MergeFinding {
  readonly kind: MergeFindingKind;
  /** The path the finding is about, or the doc slug for a probe regression. */
  readonly subject: string;
  /** What the caller has to answer for, in one sentence. */
  readonly detail: string;
}

/**
 * The path segments a description could plausibly name a file by: the whole path, its basename, and — only
 * when it carries topic meaning — the directory holding it.
 *
 * The parent directory is included because that is how a pull-request body actually refers to an area:
 * "the distil path", not `src/cli/commands/distil/run.ts`. Without it every real description would read as
 * unmentioned and the guard would cry wolf until someone turned it off.
 *
 * **But a TOP-LEVEL directory is structure, not topic, and using it was a real defect.** Measured against a
 * reconstructed incident: `src/thing.ts` yielded the alias `src`, so a description saying only "adds
 * src/feature.ts" matched *every file in the repository* and the deletion went unreported. The parent is
 * therefore offered only when it is not itself the first segment of the path — `distil` in
 * `src/cli/commands/distil/run.ts` qualifies; `src` in `src/thing.ts` does not.
 *
 * @param path the repo-relative path
 * @returns the strings whose presence in a description counts as naming this path
 */
export function pathAliases({ path }: { path: string }): readonly string[] {
  const parts = path.split("/").filter((part) => part.length > 0);
  const basename = parts.at(-1);
  const aliases = [path];
  if (basename !== undefined) {
    aliases.push(basename);
  }
  // `>= 3` is what makes the parent a real directory rather than the tree's root: two parts means the parent
  // IS the first segment, and a first segment is `src`/`docs`/`eval` — structure every path shares.
  const parent = parts.length >= 3 ? parts.at(-2) : undefined;
  if (parent !== undefined) {
    aliases.push(parent);
  }
  return aliases;
}

/**
 * Whether a pull-request description names a path in any form a reader would accept.
 *
 * Case-insensitive, because a description writes prose rather than paths.
 *
 * @param description the pull request's body text
 * @param path the repo-relative path
 * @returns true when the description mentions the path, its file name, or its directory
 */
export function describesPath({ description, path }: { description: string; path: string }): boolean {
  const haystack = description.toLowerCase();
  return pathAliases({ path }).some((alias) => haystack.includes(alias.toLowerCase()));
}

/** Whether a repo-relative path is a test file this repo would run. */
function isTestPath({ path }: { path: string }): boolean {
  return path.endsWith(".test.ts");
}

/**
 * Findings for paths the BASE branch has that this branch never saw — the base moved underneath it.
 *
 * ## What this replaced, and why, because the first version was a lie
 *
 * This began as a `resurrected-deletion` rule: "a branch cannot legitimately delete a file it never saw",
 * intended to catch the `git reset --soft base` squash that silently reverted a merged pull request here.
 * Two measurements killed that framing.
 *
 * First, it cannot catch the case it was built for. `reset --soft` moves HEAD onto base's tip, so the
 * merge-base BECOMES that tip and nothing was "gained after the fork" — the set is empty by construction.
 *
 * Second, and worse, it fired on the OPPOSITE and entirely innocent case. Run against this guard's own pull
 * request: base had gained ten files while the branch was in flight, and every one was reported as a deletion
 * "almost certainly unintended". They were nothing of the sort — GitHub's own diff showed zero deletions,
 * because a merge is computed from the merge base and would have preserved every file. A guard against silent
 * reverts that invents ten of them is worse than no guard, since the real findings sit in the same list.
 *
 * So the finding says what is actually true: the branch predates work now on base. Merging is SAFE — git
 * keeps base's files. What is not safe is trusting this diff or a CI run computed against a moved target,
 * and the remedy is a rebase.
 *
 * @param baseAhead paths base holds that head does not, measured from the two tips directly
 * @returns one finding per path, in the order supplied
 */
export function baseMovedFindings({ baseAhead }: { baseAhead: readonly string[] }): readonly MergeFinding[] {
  return baseAhead.map((path) => ({
    detail:
      "the base branch gained this after your branch forked, so your branch has never seen it. Merging keeps " +
      "it — this is staleness, not a deletion — but your diff and any CI run were computed against a base " +
      "that has moved, so neither describes what would actually land",
    kind: "base-moved" as const,
    subject: path,
  }));
}

/**
 * Findings for paths whose proposed content is a blob the base branch's OWN history once held and no longer
 * does — merging restores an older version of that file.
 *
 * This is the case {@link baseMovedFindings} cannot see: a `git reset --soft base` squash makes the new
 * commit's parent base's own tip, so nothing reads as "gained after the fork" and `baseAhead` is empty by
 * construction (see that function's own header). But the squashed commit's TREE is the branch's old,
 * pre-fork tree, so any file base modified after the fork reappears in the diff as the branch reverting it —
 * and unlike a deletion, a modest content change can sail under `unmentionedDeletions`' line-count threshold
 * or be excused by a description that happens to name the path for an unrelated reason. Reported regardless
 * of whether the description mentions the path, because "the description names it" does not make discarding
 * base's own change on that file any safer.
 *
 * ## The detail states the MEASUREMENT, because the previous one stated something nobody measured
 *
 * It used to read "this file's content on your branch is byte-identical to what it was at your fork point,
 * but the base branch has changed it since". Neither half is what the caller measures, and on a cleanly
 * rebased branch BOTH are false — measured against a pull request whose fork point
 * was `origin/main` itself: the branch was not identical to its fork point (it removed 75 lines from
 * `src/cli/commands/sessionStart/core.ts`) and the base had not touched that file since the fork. What was
 * actually true is what the finding now says — base's history held exactly the proposed content at one named
 * commit, and base's tip holds something else today.
 *
 * **A `reset --soft` revert and a deliberate one are the same graph.** After either, head's parent IS base's
 * tip, so no merge-base-relative test can separate them; the discriminating fact — that the branch's tree
 * predates base's change — is what the squash destroyed. The finding therefore reports the measurement and
 * names the commit, so the operator can look at that commit and decide in one step, rather than being told a
 * conclusion the caller never established.
 *
 * @param reverted the paths, each with the base commit whose content it restores
 * @returns one finding per path, in the order supplied
 */
export function revertsMainFindings({ reverted }: { reverted: readonly RevertedPath[] }): readonly MergeFinding[] {
  return reverted.map((entry) => ({
    detail:
      `the base branch held exactly this proposed content at ${entry.restoresBaseCommit} and holds something ` +
      "different at its tip, so merging restores the older version. That is either a deliberate revert or " +
      "the signature of a squash carrying a stale tree onto a moved base — read that commit and say which",
    kind: "reverts-main" as const,
    subject: entry.path,
  }));
}

/**
 * Findings for deletions the description never accounts for.
 *
 * A deleted test is reported separately and always, because a test removed alongside the code it guarded is
 * exactly how a revert stops being visible — that is not a stylistic preference, it is the measured failure.
 *
 * @param diff every changed path
 * @param description the pull request's body text
 * @param deletionThreshold the number of removed lines above which a MODIFIED file also has to be named
 * @returns one finding per unmentioned deletion, in diff order
 */
export function unmentionedDeletions({
  diff,
  description,
  deletionThreshold,
}: {
  diff: readonly DiffPath[];
  description: string;
  deletionThreshold: number;
}): readonly MergeFinding[] {
  const findings: MergeFinding[] = [];
  for (const entry of diff) {
    if (describesPath({ description, path: entry.path })) {
      continue;
    }
    if (entry.status === "deleted" && isTestPath({ path: entry.path })) {
      findings.push({
        detail:
          "a test file is deleted and the description does not mention it. A test removed beside the code " +
          "it guarded is how a revert becomes invisible — say why it went",
        kind: "unmentioned-test-deletion",
        subject: entry.path,
      });
      continue;
    }
    if (entry.status === "deleted" || entry.deleted >= deletionThreshold) {
      findings.push({
        detail: `${String(entry.deleted)} line(s) removed from a path the description never names`,
        kind: "unmentioned-deletion",
        subject: entry.path,
      });
    }
  }
  return findings;
}

/**
 * Findings for orchestration probes that pass today and would fail once this lands.
 *
 * This is the half that needs no judgement at all. A doc's `doneWhen` is a standing claim about the
 * repository, so a probe going from pass to fail IS the definition of quietly undoing shipped work.
 *
 * @param regressions probes the caller measured as passing on base and failing on the merged tree
 * @returns one finding per regression, in the order supplied
 */
export function probeRegressionFindings({
  regressions,
}: {
  regressions: readonly ProbeRegression[];
}): readonly MergeFinding[] {
  return regressions.map((regression) => ({
    detail: `merging this would break a probe that passes today: \`${regression.probe}\``,
    kind: "probe-regression" as const,
    subject: regression.slug,
  }));
}

/**
 * Every reason this pull request should not merge without an explicit acknowledgement.
 *
 * Pure by construction: the caller measures the diff, the base history and the probe outcomes, and this
 * decides. Ordering is stable — probe regressions first because they are the only findings that are
 * categorically not a matter of opinion, then a proven content revert, then the squash staleness signature,
 * then the description mismatches.
 *
 * @param diff every changed path, with its removed-line count
 * @param description the pull request's body text
 * @param baseAhead paths base holds that head does not
 * @param reverted the paths whose proposed content the base branch's history once held, with that commit
 * @param regressions probes passing on base that would fail once merged
 * @param deletionThreshold removed lines above which a modified, unnamed file is also reported
 * @returns every finding, most categorical first; empty when the merge is accounted for
 */
export function mergeGuardFindings({
  diff,
  description,
  baseAhead,
  reverted,
  regressions,
  deletionThreshold,
}: {
  diff: readonly DiffPath[];
  description: string;
  baseAhead: readonly string[];
  reverted: readonly RevertedPath[];
  regressions: readonly ProbeRegression[];
  deletionThreshold: number;
}): readonly MergeFinding[] {
  return [
    ...probeRegressionFindings({ regressions }),
    ...revertsMainFindings({ reverted }),
    ...baseMovedFindings({ baseAhead }),
    ...unmentionedDeletions({ deletionThreshold, description, diff }),
  ];
}
