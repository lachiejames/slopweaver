/**
 * Which governed verb a blocked mutating `gh` call should be pointed at, if any — the GitHub half of
 * `./rawTools.ts`'s routing, split out along that seam so the classifier and its cover table read together.
 */

import type { RouteCategory } from "./rawToolsRoute.js";

/**
 * `gh <group> <sub>` combinations the shipped `github` manifest actually has a governed verb for.
 *
 * MEASURED, not assumed — a list that claimed `close`/`reopen`/`comment`/`review`/`lock`/`unlock` as covered
 * when `slopweaver github pr` has no update path for any of them (`prFormEditSchema` only touches the
 * description/title/proof fields) pointed a block message at `/slopweaver:github` for six operations it cannot
 * perform — worse than the generic fallback this file's own design constraint warns against, since it
 * actively misdirects rather than merely staying silent. `create` (`github stack push`) and `edit` (`pr update`'s
 * title/description path) are two of the three genuinely covered; `repo edit` is the third, through the
 * governed edge `slopweaver github repo` gives the repository description — the field that would otherwise be
 * the one manual step nobody could take through the door after a README rewrite.
 */
const GITHUB_COMMAND_COVERS: Readonly<Record<string, readonly string[]>> = {
  pr: ["create", "edit"],
  repo: ["edit"],
};

/**
 * `gh pr edit` flags that request a reviewer. `pr edit` is otherwise listed as covered in
 * {@link GITHUB_COMMAND_COVERS} for its title/description path (`github pr update`) — but that path never
 * touches reviewers, so pointing this specific shape at the generic hint would repeat the exact false-
 * coverage mistake `GITHUB_COMMAND_COVERS`'s own doc comment warns about. `--add-reviewer` is the only one
 * checked: this classifier has no verb for REMOVING a reviewer, so that shape still falls through to the
 * generic "other-github-write" hint rather than naming a verb that cannot do the job.
 */
const GH_PR_EDIT_ADD_REVIEWER_FLAGS = new Set(["--add-reviewer"]);

/**
 * `gh pr edit --base <ref>` — retargeting a pull request. `pr edit` is listed as covered in
 * {@link GITHUB_COMMAND_COVERS} for its title/description path (`github pr update`), but that path has no
 * `base` field: changing a base is a different pull request, not a description edit. Before `github pr
 * retarget` existed, this shape fell through to the generic covered hint and pointed a blocked base
 * retarget at a verb that cannot retarget — a misdirection that went unnoticed because the door was missing
 * entirely. Checked the same way
 * {@link GH_PR_EDIT_ADD_REVIEWER_FLAGS} is: this is the only base-changing flag `gh pr edit` has, no short form.
 */
const GH_PR_EDIT_RETARGET_FLAGS = new Set(["--base"]);

/**
 * Classify a blocked `gh` call by whether the shipped GitHub command actually covers it.
 *
 * @param group the first non-flag token after `gh`, such as `pr`
 * @param sub the second non-flag token, such as `reopen`
 * @param rest every token after `gh`, flags included, read for the flags that pick a narrower verb
 * @returns the route category whose hint names the governed verb, or the generic one when none covers it
 */
export function githubWriteCategory({
  group,
  sub,
  rest,
}: {
  group: string | undefined;
  sub: string | undefined;
  rest: readonly string[];
}): RouteCategory {
  // `split` always returns at least one element, so `[0]` is the whole token when it has no `=`.
  const flagNames = rest.map((token) => token.split("=")[0]!);
  if (group === "pr" && sub === "edit" && flagNames.some((flag) => GH_PR_EDIT_ADD_REVIEWER_FLAGS.has(flag))) {
    return "supported-github-write-review-request";
  }
  if (group === "pr" && sub === "edit" && flagNames.some((flag) => GH_PR_EDIT_RETARGET_FLAGS.has(flag))) {
    return "supported-github-write-retarget";
  }
  // `gh run rerun --failed` is exactly what `github rerun` does (a seat reached for it under
  // the raw break-glass for want of a verb). A whole-run or `--job` re-run is not, and keeps the generic hint.
  if (group === "run" && sub === "rerun" && flagNames.includes("--failed")) {
    return "supported-github-write-rerun";
  }
  // `gh pr reopen` is the second half of the close-and-reopen `github cycle` does with a merge-ref check first
  // (a reopen without one re-runs the stale merge).
  if (group === "pr" && sub === "reopen") {
    return "supported-github-write-cycle";
  }
  const covered = group !== undefined && sub !== undefined && GITHUB_COMMAND_COVERS[group]?.includes(sub) === true;
  return covered ? "supported-github-write" : "other-github-write";
}
