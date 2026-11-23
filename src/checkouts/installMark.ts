/**
 * The mark that records a `yarn install --immutable` HAVING RUN, because yarn itself records only a change.
 *
 * ## The defect this closes
 *
 * `../checkouts/freshness.ts` decides whether `node_modules` matches the lockfile by comparing mtimes, and
 * the installed side of that comparison was `node_modules/.yarn-state.yml`. That file's mtime is when the
 * installed tree last CHANGED — not when an install last proved the tree correct. Yarn 4's node-modules
 * linker writes nothing at all when the tree already matches, so an install that succeeds and changes
 * nothing leaves the mark exactly where it was.
 *
 * The consequence is a verdict that no install can clear. Once anything moves `yarn.lock`'s or
 * `package.json`'s mtime past the state file without changing what gets installed — a fast-forward that
 * rewrites a lockfile to content the tree already satisfies, a branch switch and back — the gauge reads
 * STALE, names `yarn install --immutable` as the fix, and reads STALE again the moment that install
 * finishes. MEASURED on this repository; reproduce it in one command:
 *
 * ```bash
 * touch yarn.lock package.json && stat -f %m node_modules/.yarn-state.yml && \
 *   yarn install --immutable >/dev/null && stat -f %m node_modules/.yarn-state.yml
 * ```
 *
 * Both stats print the same number, and `.yarn/install-state.gz` does not move either — so there is no
 * yarn-written artifact a verifying install stamps, and no sharper choice of yarn file would have worked.
 *
 * ## Why a mark of our own rather than touching yarn's
 *
 * Touching `.yarn-state.yml` would make yarn's own file assert something yarn did not: that mtime would then
 * mean two different things depending on who wrote it last. This file is Slopweaver's own record of one
 * checkable fact — at instant T, `yarn install --immutable` exited 0 in this tree — and it lives INSIDE
 * `node_modules` so that removing the tree removes the claim about it.
 *
 * It is never evidence on its own: `never-installed` still keys on yarn's state file alone, so a mark beside
 * a tree yarn never wrote is not an installed tree.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** The mark's filename, inside `node_modules` so it cannot outlive the tree it describes. */
const INSTALL_VERIFIED_FILENAME = ".slopweaver-install-verified";

/**
 * The mark's absolute path for one checkout or worktree.
 *
 * @param root the checkout or worktree that holds the `node_modules`
 * @returns the path the mark is written to and read from
 */
export function installVerifiedPath({ root }: { root: string }): string {
  return join(root, "node_modules", INSTALL_VERIFIED_FILENAME);
}

/**
 * Record that a yarn install has just succeeded in this tree.
 *
 * Called only after an install that exited 0 — `--immutable` on a main checkout, plain `yarn install` in a
 * worktree; the fact recorded is the same either way. The write is what the gauge reads back, so a failure
 * to write it must be reported rather than swallowed: a silently missing mark is the false-STALE loop
 * returning by another route.
 *
 * @param root the checkout or worktree that was just installed
 * @param nowIso the instant to record, passed in so the caller owns the clock
 * @returns the failure detail, or `undefined` when the mark was written
 */
export function recordInstallVerified({ root, nowIso }: { root: string; nowIso: string }): string | undefined {
  const path = installVerifiedPath({ root });
  try {
    writeFileSync(
      path,
      `# Written by \`slopweaver\` when a yarn install last succeeded in this tree.\n` +
        `# Yarn writes nothing when an install changes nothing, so this file is what says the install RAN.\n` +
        `# Removing it is fine; the next verified install writes it again.\n${nowIso}\n`,
      "utf8",
    );
    return undefined;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
