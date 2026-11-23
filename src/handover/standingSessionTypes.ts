/**
 * The machine-readable half of a STANDING-SESSION ruling — the shape a `ruling` event carries when the owner has said a
 * row's seat stays open between their turns, so its idle wait for the owner is the intended state rather than a park.
 *
 * The supervisor opens ONE dedicated session the owner talks to about one matter until a named day. A row that said
 * so only in prose was parked by `session close-done` between the owner's turns anyway, though a parked session
 * leaves the fleet and this is the one seat whose job is to wait. The words live on the ruling; this half is what lets close-done, `handover park` and the chair's
 * reconcile KNOW the seat stands, without parsing prose (`./standingSession.ts`).
 *
 * Its own leaf so `./ledger.ts`, the write schema and the decoder share one type and no import cycle.
 */

/** A standing session: optionally, the instant it stops standing. */
export interface StandingSession {
  /** When the seat stops standing, canonical UTC. Absent means until a later standing-session ruling ends it. */
  readonly untilIso?: string;
}
