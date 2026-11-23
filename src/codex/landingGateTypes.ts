/**
 * What this machine can be read to say about ONE PULL REQUEST's Codex loop.
 *
 * Its own module so the PURE half (`./landingGate.ts`) and the EFFECTFUL half (`./landingGateRun.ts`) share
 * one shape without the pure half importing anything that touches git or the filesystem — which is what keeps
 * the pure half unit-testable with plain values and no seam.
 *
 * The subject is the pull request, not the checkout the landing verb happens to be running in. See
 * `./landingGate.ts`'s header for why that distinction is the whole point of this pair.
 */

import type { ReviewLeftover } from "./reviewLeftovers.js";

/**
 * Everything a landing verb needs to know about one pull request's loop, read once.
 *
 * Every field describes the PULL REQUEST the read was asked about. `branch` and `headSha` are echoed back
 * rather than being the reader's own position, so `associateCodexLoop` can check that a reading answers for
 * the pull request in front of it — the one thing the pure half can still get wrong once the reader stopped
 * being tied to the current checkout.
 *
 * @internal — reached only through {@link LocalCodexLoopRead}; nothing outside this pair names the shape.
 */
export interface LocalCodexLoopEvidence {
  /** `owner/name` the read was asked to answer for, confirmed against at least one qualifying checkout. */
  readonly repository: string;
  /** The pull request's head branch, whose rows were read. */
  readonly branch: string;
  /** The pull request's head commit, whose tree the rows were judged against. */
  readonly headSha: string;
  /** The pull request's base commit, echoed back exactly as asked so the association can compare it too. */
  readonly baseSha: string | undefined;
  /**
   * The checkouts that answered — every repository root on this machine holding the pull request's head
   * commit that could change the verdict: the presser's own and every one some evidence names on the branch
   * (`./branchEvidenceRoots.ts`), or every holder when none of those does. Reported rather than collapsed to a
   * count so a refusal can name where it looked; a reader told only "nothing was found" cannot tell a missing
   * fetch from a missing pass.
   */
  readonly roots: readonly string[];
  /** What `assessCodexLoop` said about the pull request's branch. Empty means the floor is met. */
  readonly failures: readonly string[];
  /** The current `BROKEN` reviews past the second review pass, which the landing verbs raise as codex-loop-incomplete. */
  readonly leftovers: readonly ReviewLeftover[];
}

/**
 * A reading, or the reason there is none.
 *
 * `unreadable` is deliberately NOT an empty failure list: a machine whose git or ledger could not be read
 * has told us nothing, and the landing guard treats nothing as a refusal rather than as consent.
 */
export type LocalCodexLoopRead =
  | { readonly kind: "read"; readonly evidence: LocalCodexLoopEvidence }
  | { readonly kind: "unreadable"; readonly reason: string };
