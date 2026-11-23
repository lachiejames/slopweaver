/**
 * The write half of "a committed proof folder cannot reach a pull request": every verb that captures proof
 * refuses an output path inside a git checkout, before it opens a browser, a terminal or a directory.
 *
 * This file is the pure decision over an already-canonical location; `outputGuardEffects.ts` resolves one.
 * The rule is containment, not a filename: a capture a checkout can see is one a commit can carry, whatever
 * it is called. One place inside a work tree is deliberately allowed: `$SLOPWEAVER_HOME` is itself a git
 * work tree but is never a pull request's head.
 */
import { isAbsolute, relative, sep } from "node:path";

/** An output path, canonicalised, and the facts the decision reads about it. */
export interface ProofOutputLocation {
  /** The output path with every existing ancestor's symlinks resolved. */
  readonly absolutePath: string;
  /** The top level of the git work tree containing it, canonicalised, or undefined outside every work tree. */
  readonly containingGitRoot: string | undefined;
  /** `$SLOPWEAVER_HOME`, canonicalised. */
  readonly stateHomeRoot: string;
}

/**
 * Pure: whether `child` is `parent` or lies beneath it.
 *
 * @param parent the directory that may contain it
 * @param child the path being placed
 * @returns true when `child` is at or under `parent`
 */
function isWithin({ parent, child }: { parent: string; child: string }): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Pure: why a capture may not be written at this location, or nothing when it may.
 *
 * Allowed: anywhere outside a work tree; anywhere under the state home whose own work tree is the home or an
 * ancestor of it (a checkout nested INSIDE the home is still a checkout).
 *
 * @param location the canonical output location
 * @returns the one-line reason the path is refused, or undefined when it is allowed
 */
export function proofOutputRefusal({ location }: { location: ProofOutputLocation }): string | undefined {
  const { absolutePath, containingGitRoot, stateHomeRoot } = location;
  if (containingGitRoot === undefined) {
    return undefined;
  }
  const nestedInHome =
    containingGitRoot !== stateHomeRoot && isWithin({ child: containingGitRoot, parent: stateHomeRoot });
  if (isWithin({ child: absolutePath, parent: stateHomeRoot }) && !nestedInHome) {
    return undefined;
  }
  return `${absolutePath} is inside the git checkout ${containingGitRoot}, where a commit can carry it into a pull request`;
}
