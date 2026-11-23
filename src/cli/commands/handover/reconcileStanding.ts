/**
 * How `handover reconcile` reads a row the owner's standing-session ruling keeps open: a parked one is lifted to ready, so
 * the chair seats it again on sight. Split from `./reconcileRows.ts`, which ranks every row through
 * {@link rankedSectionOf}.
 */

import { type BoardModel } from "../../../handover/boardTypes.js";
import { standingSessionHolds } from "../../../handover/standingSession.js";

/**
 * The section a doc row ranks by, and whether the trunk-moved hold applies: its composed section and the hold as
 * measured, except a parked seat the owner's standing-session ruling still keeps, LIFTED to `RUN NOW` past that hold. The
 * ruling keeps it open between the owner's turns, so a park — an older checkout's close-done, a crash, a hand park past the
 * hatch — is a seat to put back, and the fill seats a ready row by a visible `cmux spawn`
 * ({@link standingSessionNeedsReseat}). The trunk-moved hold waits for a session to recheck a finding, and the
 * reseated seat is that session; a superseded chair and a repoless row stay blocked.
 *
 * @param trunkMoved whether the trunk moved under this row's evidence since it was asked
 * @returns the section and trunk-moved flag `standingOf` reads
 */
export function rankedSectionOf({
  model,
  nowIso,
  trunkMoved,
}: {
  model: BoardModel;
  nowIso: string;
  trunkMoved: boolean;
}): { readonly section: BoardModel["section"]; readonly trunkMoved: boolean } {
  if (standingSessionNeedsReseat({ model, nowIso })) {
    return { section: "RUN NOW", trunkMoved: false };
  }
  return { section: model.section, trunkMoved };
}

/**
 * Whether a row is a parked seat the owner's standing-session ruling still keeps open — one the chair seats again on sight
 * rather than leaving parked until somebody remembers it (`../../../handover/standingSession.ts`).
 *
 * Only a CLOSED seat qualifies: a run with no `parked` checkpoint still has its seat open, and lifting it would offer
 * the fill a second seat on a row already sitting. A finished, closed or abandoned run carries no disposition this
 * reads, so a standing row whose work is over is never respawned.
 *
 * @param model one composed board row
 * @param nowIso the instant the ruling's bound is judged against
 * @returns true when the row should read as ready to seat
 */
export function standingSessionNeedsReseat({ model, nowIso }: { model: BoardModel; nowIso: string }): boolean {
  const { run } = model;
  if (run.kind !== "active" && run.kind !== "waiting-on-owner") {
    return false;
  }
  const { parked, standingSession } = run;
  if (parked === undefined || standingSession === undefined) {
    return false;
  }
  return standingSessionHolds({ nowIso, ruling: standingSession });
}
