/**
 * The machine-readable half of an EXPLICIT STEER ruling — the shape a `ruling` event carries when the owner's words
 * override the standing rules for one row's instance.
 *
 * The rule: a special request that overrides the other rules is expected to happen, and when it will not, the
 * session says so early and names the uncertainty. The words live on the ruling; this half is what lets a reader KNOW the ruling is one, without parsing prose, and what
 * `./steerRisk.ts` reads to watch the deliverable. Why it is a field and not a phrase match:
 * `docs/doctrine-rationale/explicit-steer.md`.
 *
 * Its own leaf so `./ledger.ts`, the write schema and the decoder share one type and no import cycle.
 */

/** An explicit steer: optionally, the instant the owner named for the deliverable. */
export interface ExplicitSteer {
  /** When the owner said it must exist, canonical UTC. Absent when no instant was named. */
  readonly deliverByIso?: string;
}

/**
 * A session NAMED the uncertainty on this row's deliverable — `handover risk` — or said it has passed. The owner is told
 * early when a deliverable might not land. It is a fact ABOUT the row that moves no phase: a seat still working says it might not make it without stopping. The
 * latest one stands; `./steerRisk.ts` reads it beside the run's own holds.
 */
export interface SteerRiskEvent {
  readonly kind: "steer-risk";
  readonly atIso: string;
  readonly standing: "at-risk" | "cleared";
  readonly why: string;
}
