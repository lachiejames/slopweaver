/**
 * WHERE A ROW STANDS — the one field that says whether the fleet's attention is the thing it is missing.
 *
 * ## Why a boolean could not carry this
 *
 * `./rank.ts`'s `BoardRow` used to answer availability with `ready` alone, and `ready` is exactly one board
 * section: `RUN NOW`. A row with an open run composes to `IN FLIGHT` instead, so `ready` and "has an open
 * RUN" cannot both hold — and a top band filtered on `ready` reports an aligned fleet of zero for ever,
 * while one that ignores availability reports a starving band of five for ever. Both numbers are artefacts
 * of the filter rather than findings about the fleet, and the repository has now measured each
 * one: `../supervisor/outcomes/coverage.ts`'s `belongs` carries the first, and this module's own reason is
 * the second.
 *
 * A LIVE SEAT is not an open run, and conflating the two is the trap on the way out. Standing comes off the
 * board's sections; a seat comes off cmux matching a workspace to a row id. So a `RUN NOW` row a session is
 * already sitting on is `ready` AND seated — genuinely both — which is why `./reconcile.ts` says its three
 * lists COVER the board rather than partition it.
 *
 * MEASURED on one supervisor tick's reading (the live check is `slopweaver handover reconcile
 * --json | jq '[.starving[] | {id, standing}]'`, every entry `ready`; `./reconcile.ts`'s header owns the
 * anchor and the second command, which reads that tick's own kept document): that document records all five
 * of its own starving top rows as `"ready": false`. Not one of them was work anybody could pick up, and the
 * page reported all five to the owner as top rows with nobody on them, a page the owner found unreadable and
 * could not trust to reflect reality.
 *
 * So the row carries WHICH of those it is, and `ready` becomes one standing rather than a second source of
 * the same fact. A reader — and the page — can then say where each item is, what is ready and what is held,
 * without computing anything for itself.
 */

import type { BoardSection } from "./boardTypes.js";

/**
 * The five standings a live board row can be in, and what each one means to a reader.
 *
 * Every live section maps onto exactly one of these. The CLOSED sections (`DONE`, `CLOSED — NOT SHIPPED`)
 * never reach here: `../cli/commands/handover/reconcileRows.ts` drops them before a row is built.
 */
export type RowStanding =
  /** A run is open on it — the board's `IN FLIGHT`. Whether a SEAT is on it is a separate, observed fact. */
  | "in-flight"
  /** It could be picked up right now — the board's `RUN NOW`, and what `cmux spawn` would accept. */
  | "ready"
  /** It is parked on the owner's own word. The owner's move, never the fleet's. */
  | "waiting-on-owner"
  /** It is parked on a named person. A pause is a state, not a countdown, and nothing here can expire it. */
  | "paused"
  /** Nothing can start it: a dependency, a contradiction, a shipped-but-unconfirmed row, a retired chair, no `repo:`. */
  | "blocked";

/**
 * Which standing a composed board section puts a row in.
 *
 * `superseded` outranks the section, and that is one of two places this is not a pure rename of the board's
 * own word: a `role: supervisor` doc the pinned chair has already replaced still sits in `RUN NOW`, because
 * nothing ever recorded its ending, and a fill that read one as ready SPAWNED A SECOND CHAIR
 * (`./supervisorSupersession.ts` carries the incident). It is blocked, not ready.
 *
 * `repoless` is the other, and it demotes ONLY `RUN NOW`. `ready` means `cmux spawn` would accept the row, and
 * a row naming no `repo:` is one it refuses outright — *"names no `repo:`, so there is nowhere to open a
 * worktree in"* (`../cli/commands/cmux/spawnPreflight.ts`). MEASURED: 253 of the 458 ask rows the
 * reconciliation called ready named no repo, and a fill had spawned four of them straight into that refusal
 * (repro: `slopweaver handover reconcile --json | jq '.repolessRows | length'`). An `IN FLIGHT` row stays in
 * flight: somebody already opened its run, so whether a spawn could seat it is no longer the question.
 * `slopweaver handover set-repo` is the fix a reader is pointed at.
 *
 * `trunkMoved` is the third, and it too demotes ONLY `RUN NOW`: a ready finding whose evidence the trunk has
 * changed since it was asked is held until a session reads the commits and settles it or rechecks it
 * (`./trunkMoved.ts` carries the case of six rows seated in one hour, each already answered).
 *
 * `disconnected` is the fourth, and it too demotes ONLY `RUN NOW`: a row DECLARING it needs an integration this
 * install stores no credential for is not work a seat can do, so it is held and kept on the board until the
 * integration is connected (`./integrationNeeds.ts` carries the rule).
 *
 * @param section the row's composed board section
 * @param superseded whether a later supervisor chair has already replaced this one
 * @param repoless whether the row names no `repo:`, so no verb can open a worktree for it
 * @param trunkMoved whether the trunk changed what this ready finding's evidence names since it was asked
 * @param disconnected whether the row needs an integration this install is not connected to
 * @returns the standing
 */
export function standingOf({
  section,
  superseded,
  repoless,
  trunkMoved,
  disconnected,
}: {
  section: BoardSection;
  superseded: boolean;
  repoless: boolean;
  trunkMoved: boolean;
  disconnected: boolean;
}): RowStanding {
  if (superseded) {
    return "blocked";
  }
  if (section === "RUN NOW") {
    return repoless || trunkMoved || disconnected ? "blocked" : "ready";
  }
  if (section === "IN FLIGHT") {
    return "in-flight";
  }
  if (section === "WAITING ON OWNER") {
    return "waiting-on-owner";
  }
  if (section === "PAUSED") {
    return "paused";
  }
  // CONTRADICTION, LOOKS SHIPPED, NOT YET and AWAITING SHIP all mean the same thing to a reader deciding
  // what to pick up: not this. Each keeps its own board section on the row for anyone who wants the reason.
  return "blocked";
}
