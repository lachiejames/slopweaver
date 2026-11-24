/**
 * The pure half of deciding whether a NUMBERLESS create reservation is stale.
 *
 * A create whose POST failed without a response leaves `{locus, reservedIso}` on disk and nothing else. The
 * question "did that create land anyway?" has exactly one answer GitHub will give: the pull requests on the
 * branch pair, in any state. This module turns that list into a verdict and renders the lines that report it;
 * `./reservation.ts` makes the call and acts.
 *
 * It lives here rather than in `./core.ts` because that file is frozen at its recorded code-line count by the
 * file-size ratchet, and a pure decision is worth more in a file a test can open than in one nobody may grow.
 */
import type { WrittenPr } from "../../../corpus/github/write.js";

/**
 * GitHub's `pulls.list` head filter, which wants `owner:ref` and silently ignores a bare ref — so an
 * unqualified head lists the WHOLE repository and every absence check reads as ambiguous.
 *
 * A head that already names its repository (a fork's branch) is passed through untouched.
 *
 * @param head the head ref as the caller wrote it
 * @param owner the repository owner a bare ref is qualified against
 * @returns the `owner:ref` form GitHub's filter accepts
 */
export function qualifiedHeadRef({ head, owner }: { head: string; owner: string }): string {
  if (head.includes(":")) {
    return head;
  }
  return `${owner}:${head}`;
}

/** What GitHub's own list of pull requests on a branch pair says about a numberless reservation. */
export type AbsenceVerdict =
  | { readonly kind: "absent" }
  | { readonly kind: "single"; readonly pr: WrittenPr }
  | { readonly kind: "ambiguous"; readonly count: number };

/**
 * Read a branch-pair listing as a verdict on the reservation that named it.
 *
 * `absent` is the whole point: zero pull requests on the pair means the create never landed, so the
 * reservation guards nothing. `single` is the other side of the same hole — the create DID land and its
 * number can be recovered. `ambiguous` is two or more, which `../../../outbound/github/prLedger.ts`'s own
 * header has always ruled indeterminate: there is no way to say which of them this reservation meant, and
 * releasing on a guess is the one mistake that opens a duplicate pull request.
 *
 * The listing it reads is CAPPED at two results, so an `ambiguous` count is a floor rather than a total —
 * which is why {@link ambiguousPairLine} says "at least".
 *
 * @param candidates the pull requests GitHub reports on the base/head pair, in any state
 * @returns which of the three states the listing describes
 */
export function absenceVerdictFor({ candidates }: { candidates: readonly WrittenPr[] }): AbsenceVerdict {
  if (candidates.length === 0) {
    return { kind: "absent" };
  }
  const only = candidates[0];
  if (candidates.length === 1 && only !== undefined) {
    return { kind: "single", pr: only };
  }
  return { count: candidates.length, kind: "ambiguous" };
}

/**
 * The line printed when a reservation is released because GitHub has no pull request on its branch pair.
 *
 * @param locus the branch locus being released
 * @returns one operator-facing line
 */
export function releasedOnAbsenceLine({ locus }: { locus: string }): string {
  return (
    `releasing the reservation for ${locus}: GitHub reports no pull request on these branches in any state, ` +
    "so the create that claimed it never landed."
  );
}

/**
 * The line printed when the create DID land and its number is recovered onto the record.
 *
 * @param locus the branch locus
 * @param number the pull-request number recovered from GitHub
 * @returns one operator-facing line
 */
export function backfilledNumberLine({ locus, number }: { locus: string; number: number }): string {
  return (
    `recovered #${String(number)} onto the reservation for ${locus}: the create landed and only its response ` +
    "was lost."
  );
}

/**
 * The line printed when the branch pair carries more than one pull request, so no verdict is available.
 *
 * The count is a FLOOR, never a total: `listPrsVia` asks for `per_page: 2`, so a pair carrying seven pull
 * requests reports two, and a line stating two as the total would be a number nothing measured.
 *
 * @param count how many the capped listing returned, which is a lower bound on the real total
 * @param locus the branch locus
 * @returns one operator-facing line
 */
export function ambiguousPairLine({ count, locus }: { count: number; locus: string }): string {
  return (
    `leaving the reservation for ${locus} standing: GitHub reports at least ${String(count)} pull requests on ` +
    "these branches — the listing stops at two — so which one it named cannot be decided here. Read them back " +
    "and use `github pr release-reservation`."
  );
}

/**
 * The line printed when the verifying read itself failed, so absence was never established.
 *
 * @param locus the branch locus
 * @param message the provider failure's own message
 * @returns one operator-facing line
 */
export function absenceReadFailedLine({ locus, message }: { locus: string; message: string }): string {
  return (
    `leaving the reservation for ${locus} standing: could not read the pull requests on these branches ` +
    `(${message}), so nothing here proves the create did not land.`
  );
}

/**
 * The line printed when the recorded number names a DIFFERENT pull request on the repository now at this
 * address, or none at all — a repository renamed away left its address to a successor, whose numbers restart.
 *
 * Neither is proof the branch pair is free: a 404 can mean access rather than absence, and the successor may
 * hold its own pull request on these branches. So the line says what is read next, never that it released.
 *
 * @param locus the branch locus
 * @param number the recorded pull-request number
 * @param found whether GitHub answered with another pull request or with not-found, or the record carries no
 *   node id to compare, so no read of the number could tell which pull request it meant
 * @returns one operator-facing line
 */
export function foreignRecordedNumberLine({
  found,
  locus,
  number,
}: {
  found: "another-pull-request" | "not-found" | "unbound";
  locus: string;
  number: number;
}): string {
  if (found === "unbound") {
    return (
      `the reservation for ${locus} records #${String(number)} without its node id, so which pull request it meant ` +
      "cannot be told: the branch pair is read instead."
    );
  }
  const what =
    found === "not-found"
      ? `GitHub has no #${String(number)} on the repository now at this address`
      : `#${String(number)} on the repository now at this address is a different pull request from the one recorded`;
  return `the reservation for ${locus} names a pull request that is not this repository's: ${what}, so the branch pair is read instead.`;
}

/**
 * The line printed when a pull request occupying the locus is no longer open, so a fresh create is allowed.
 *
 * One spelling for both settling paths — the recorded number's own read and the branch-pair listing reach the
 * identical conclusion about an identical fact, and two copies of this sentence would drift.
 *
 * @param locus the branch locus being released
 * @param number the pull request that occupied it
 * @param state the state GitHub reports for it — `closed` or `merged`, never `open`
 * @returns one operator-facing line
 */
export function releasedOnClosedLine({
  locus,
  number,
  state,
}: {
  locus: string;
  number: number;
  state: string;
}): string {
  return (
    `releasing the reservation for ${locus}: #${String(number)} is ${state} there and no longer blocks a ` +
    "fresh create for these branches."
  );
}
