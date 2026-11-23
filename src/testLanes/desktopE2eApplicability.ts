/**
 * Whether the console's browser lane (`yarn test:e2e`, `src/__tests__/e2e/`) has anything to prove on a change — the
 * pure half of `./desktopE2e.entry.ts`.
 *
 * The Ubuntu layer runs on every pull request that
 * changes code and in the merge queue, and a pull request that only touches markdown outside `site/` passes it as
 * NOT APPLICABLE rather than skipping it. The job still runs and still succeeds: `ci.yml`'s `build` fails a skipped
 * leg, and a skipped check run reads as passing to branch protection, so a skip is the one shape this must never take.
 * Markdown outside `site/` is not inert: shipped code reads `skills/`, `.claude/rules/`,
 * `AGENTS.md`, `README.md` and more at run time, and `catalog trees` draws two of them on `/docs/build/modules`. A list of READ roots can never be shown complete, so the exemption is an ALLOWLIST: only
 * prose under `docs/` passes as not applicable, minus the `docs/` files code reads (`RUNTIME_READ_DOCS`, found by
 * `grep -rnE "\"docs/|join\([^)]*\"docs\"" src site/lib site/components site/app --exclude-dir=__tests__
 * --exclude-dir=devLint --exclude-dir=canon`). Every other markdown change runs the lane.
 *
 * Every doubt resolves toward RUNNING: an empty path list, an event this module does not know, or a diff that could
 * not be read is applicable. A not-applicable pass is only ever the verdict of a path list read in full.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

/** The one directory whose markdown is prose for people, never read by shipped code bar `RUNTIME_READ_DOCS`. */
const PROSE_ROOT = "docs/";

/** The `docs/` paths shipped code reads: the recurring-failure register (`reflect`), and the main-checkouts page. */
const RUNTIME_READ_DOCS: readonly string[] = ["docs/recurring-failure-register", "docs/main-checkouts.md"];

/** The extensions a markdown-only change consists of. */
const MARKDOWN = /\.(md|mdx)$/i;

/** The line a not-applicable run prints, and the step summary carries. */
export const NOT_APPLICABLE_LINE = "desktop-e2e: not applicable — only prose under docs/ changed";

/**
 * Whether one changed path is prose no shipped code reads.
 *
 * @param path a repository-relative path
 * @returns true for markdown under `docs/` outside `RUNTIME_READ_DOCS`
 */
function isInertProse({ path }: { path: string }): boolean {
  return MARKDOWN.test(path) && path.startsWith(PROSE_ROOT) && !RUNTIME_READ_DOCS.some((read) => path.startsWith(read));
}

/**
 * Whether a change touching these paths could change what the console draws.
 *
 * @param paths the changed paths, repository-relative, as `git diff --name-only` prints them
 * @returns false only when every path is inert prose under `docs/`; an empty list is applicable
 */
export function desktopE2eApplicable({ paths }: { paths: readonly string[] }): boolean {
  if (paths.length === 0) {
    return true;
  }
  return paths.some((path) => !isInertProse({ path }));
}

/** The part of a `pull_request` event this lane reads. */
const PullRequestEvent = z.object({ pull_request: z.object({ base: z.object({ sha: z.string().min(1) }) }) });

/** The part of a `merge_group` event this lane reads. */
const MergeGroupEvent = z.object({ merge_group: z.object({ base_sha: z.string().min(1) }) });

/**
 * The commit a run's changes are measured against, read off the GitHub event that started it.
 *
 * A `pull_request` names its base, a `merge_group` names the tip of the branch the entry is tested against. Any other
 * event — a push to `main`, a local run — has no base to compare with, so the lane runs whole.
 *
 * @param eventName `GITHUB_EVENT_NAME`, `undefined` off CI
 * @param event the parsed `GITHUB_EVENT_PATH` document, `undefined` off CI
 * @returns the base commit, `undefined` when the run has none and so runs whole, or why the event did not read
 */
export function desktopE2eBase({
  eventName,
  event,
}: {
  eventName: string | undefined;
  event: unknown;
}): Result<string | undefined> {
  if (eventName === "pull_request") {
    const parsed = PullRequestEvent.safeParse(event);
    return parsed.success
      ? ok(parsed.data.pull_request.base.sha)
      : err(["a pull_request event carried no pull_request.base.sha"]);
  }
  if (eventName === "merge_group") {
    const parsed = MergeGroupEvent.safeParse(event);
    return parsed.success
      ? ok(parsed.data.merge_group.base_sha)
      : err(["a merge_group event carried no merge_group.base_sha"]);
  }
  return ok(undefined);
}
