/**
 * Which register docs the push currently running `register-hygiene` is actually about.
 *
 * The policy lives in the module header of `registerHygiene.ts`, under "Findings are BLOCKING only when
 * they are about the push actually happening". That section is the "module header" each JSDoc below
 * points at. This module holds only the repository and branch comparison the section describes.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { HandoverDoc } from "../handover/doc.js";

/**
 * A path's canonical form for repository-identity comparisons: symlinks resolved, falling back to a lexical
 * resolve when the path cannot be realpath'd (e.g. it does not exist).
 *
 * The same fix `../outbound/github/probeSweep.js`'s `canonical` carries for the identical reason: `os.tmpdir()`
 * on macOS answers a symlink, and `git rev-parse --show-toplevel` answers the realpath, so comparing the two
 * unresolved would silently fail to recognise the same repository.
 */
function canonical({ path }: { path: string }): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

/**
 * Whether a doc's `looksShipped` finding is about the push actually happening — see the module header's
 * "Findings are BLOCKING only when..." section for why this exists and what it deliberately does not exempt.
 *
 * Every branch that returns `true` does so because there is not enough information to say the doc is
 * UNRELATED, never because there is positive evidence it IS related — an absence never buys the exemption.
 */
function relevantToPush({
  doc,
  currentRepo,
  currentBranch,
}: {
  doc: HandoverDoc;
  currentRepo: string | undefined;
  currentBranch: string | undefined;
}): boolean {
  if (currentRepo === undefined || doc.repo === undefined) {
    return true;
  }
  if (canonical({ path: doc.repo }) !== canonical({ path: currentRepo })) {
    return false;
  }
  if (currentBranch === undefined || doc.branch === undefined) {
    return true;
  }
  return doc.branch === currentBranch;
}

/**
 * The paths of docs whose `looksShipped` finding must not fail the push currently running this gate.
 *
 * @param docs every doc the register holds
 * @param currentRepo the repository the push is happening in, or `undefined` when it could not be determined
 * @param currentBranch the branch being pushed, or `undefined` when it could not be determined (e.g. detached
 *   HEAD) — either absence keeps every doc blocking, the original register-wide behaviour
 * @returns the paths to exempt
 */
export function pushExemptPaths({
  docs,
  currentRepo,
  currentBranch,
}: {
  docs: readonly HandoverDoc[];
  currentRepo: string | undefined;
  currentBranch: string | undefined;
}): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const doc of docs) {
    if (!relevantToPush({ currentBranch, currentRepo, doc })) {
      paths.add(doc.path);
    }
  }
  return paths;
}
