/**
 * The one rule deciding which list a `supervisor tick close` renders: the one an earlier close of the same tick
 * staged, the seat's own, or a fresh one. Pure, so both inputs a close accepts — a bare close that refreshes the owner's
 * list, and a close handed `--your-list` — read the same table and cannot drift apart.
 *
 * A staged list survives ONLY once this close has committed a stage (`close-state.json` exists, `done: []`
 * included, since a stage may have been interrupted after its side effect): a resumed close must render the list
 * its committed stages were decided against. Before that, a staged list is only what a REFUSED close rendered,
 * and keeping it froze the tick on a list that could only grow staler.
 *
 * MEASURED: two ticks staged a list; a run's question was answered afterwards; every bare close after that
 * re-rendered the earlier list, so the answered question stayed on the page as "somebody is stopped waiting on you"
 * and the page's packed-enumeration rule refused it on every try. Reproduce on any seat: a tick's `run.json` `nowIso` predates a run's `answered` event while the tick holds no
 * `close-state.json`.
 *
 * ## The committed list is bound by digest, not by path
 *
 * The close state records the staged list's sha256 (`listSha256`), or `null` when the committed close rendered the
 * seat's own list and staged nothing. A resume reuses the staged file only when its bytes still hash to that digest;
 * a file replaced between attempts — rewritten, or a hard link to something else — is refused, never rendered as the
 * list the close decided on.
 *
 * A `null` record bound nothing, so a resume over it stages a fresh list exactly as an uncommitted close does, and
 * the commit then records that list's digest in place of the `null` (`tickCloseCommit.ts`), binding every later
 * resume to it. Holding the resume on the seat's list instead binds nothing real — the seat's list is never digested
 * — and strands the close once that list ages past the render's staleness door, or when the overrun route hands
 * `--your-list` back. The residue, stated: a `null` close resumed past `snapshots-resolved`
 * publishes a page from a list it never promotes to the seat, exactly as before the digest existed.
 */

/**
 * The way back from a refused resume, named in every refusal: removing the close state restarts the close, which
 * `form.before.json` keeps proposing the same form and `tick-recorded` keeps from appending twice (`../../../supervisor/tickPlan.ts`).
 */
const RESTART_ROUTE = " — restore that list to resume, or remove close-state.json to restart the close";

/** What a close does with the tick's staged list. */
export type StagedListDecision =
  | { readonly kind: "replace" }
  | { readonly kind: "reuse"; readonly listSha256: string }
  | { readonly kind: "refuse"; readonly reason: string };

/**
 * Decide whether a close reuses the tick's staged list, replaces it, or refuses.
 *
 * `replace` leaves the effect to the caller: run the refresh child on a bare close, or validate and copy the
 * handed list. Every other decision holds for either input — once a list is bound, the list is the one it saw.
 *
 * @param recordedListSha256 the close state's list digest: `undefined` with no close state (nothing committed),
 *   `null` when the committed close rendered the seat's list and so bound none, else the staged bytes' digest
 * @param stagedListSha256 the digest of the regular file at `tick-<n>/run.json` now, `undefined` when there is none
 * @returns the decision; a refusal's reason carries both short digests when they disagree
 */
export function stagedListDecision({
  recordedListSha256,
  stagedListSha256,
}: {
  recordedListSha256: string | null | undefined;
  stagedListSha256: string | undefined;
}): StagedListDecision {
  if (recordedListSha256 == null) {
    return { kind: "replace" };
  }
  if (stagedListSha256 === undefined) {
    return {
      kind: "refuse",
      reason: `this close already committed a stage against a list that is no longer staged${RESTART_ROUTE}`,
    };
  }
  if (stagedListSha256 !== recordedListSha256) {
    return {
      kind: "refuse",
      reason:
        `this close already committed a stage against the list with sha256 ${recordedListSha256.slice(0, 12)}, ` +
        `and the list staged now is ${stagedListSha256.slice(0, 12)}${RESTART_ROUTE}`,
    };
  }
  return { kind: "reuse", listSha256: recordedListSha256 };
}
