/**
 * The `ruling` run event's shape, beside the types of the halves it may carry. `./ledger.ts` names it in
 * `RunEvent`, the way it names `./parkedEvent.ts`'s events; the decoder is `./rulingLineDecode.ts` and the write
 * schema `./rulingEventSchema.ts`.
 */
import type { AttachUploadRuling } from "./attachUploadRulingTypes.js";
import type { ExplicitSteer } from "./explicitSteerTypes.js";
import type { RulingGate } from "./rulingGateTypes.js";
import type { StandingSession } from "./standingSessionTypes.js";

/**
 * The owner ruled on this row — their words, and where they said them, in the register every reader already
 * reads.
 *
 * The ruling is derived from state, the way the board derives everything else, rather than written into the
 * row document, which is a lossier form of state tracking.
 *
 * MEASURED, which is why the kind exists at all: of **333 `answered` events across 241 runs**,
 * 45 declared a ruling in so many words and **39 sat on a row whose own text had nowhere to carry it** —
 * `handover answer` journals the ruling and never touches the document, so every audit, sweep and fresh
 * session that reads the ROW read a decided row as undecided. Reproduce by counting `answered` events
 * under `~/.slopweaver/runs/*.jsonl` and checking each row's front-matter for `ruling:`.
 *
 * Both `ruling` and `anchor` are load-bearing, so a line missing either decodes to nothing rather than to
 * an event with an empty half: words with nowhere to check them are a claim, and an anchor with no words
 * says nothing about what the owner decided. Same pair rule `../handover/askRow.ts` already applies to the
 * front-matter form.
 */
export interface RulingEvent {
  readonly kind: "ruling";
  readonly atIso: string;
  /** What the owner said, as the session that heard it recorded it. Attributable, never authenticated. */
  readonly ruling: string;
  /** Where the owner said it — a transcript pointer, a permalink, or a file. */
  readonly anchor: string;
  /**
   * When the owner DECIDED it, when that is not when this line was written.
   *
   * Two instants rather than one because a backfill writes today's line about a decision the owner made weeks
   * ago, and `./derivedRowState.ts` picks the CURRENT ruling by decision time. Ordering by `atIso` alone
   * would let a backfilled older ruling supersede one the owner gave since. Optional because journals
   * written before this field exists must keep decoding, and a reader falls back to `atIso`.
   */
  readonly decidedIso?: string;
  /**
   * The `answered` event this ruling was reconstructed from — present ONLY on a backfilled ruling.
   *
   * It carries two properties at once. It is the provenance: the row's own journal already holds that
   * event, so the words are checkable against it rather than taken on the backfill's word. And it is
   * what keeps a reconstructed ruling from becoming PERMISSION — `./askRow.ts`'s `findingRulingState`
   * clears a team-facing door only on a ruling recorded because the owner ruled on that finding, never on one
   * a migration derived from an answer to a different question.
   */
  readonly backfilledFrom?: string;
  /**
   * The machine-readable half of this ruling — the verbs it GATES, so the ruling refuses them at run
   * time instead of waiting for a session to remember it (`./rulingGateTypes.ts`).
   *
   * Never present on a reconstruction: `./rulingBackfill.ts` rebuilds free-text answers and has no gate
   * to rebuild, so a `backfilledFrom` line carrying one is refused rather than decoded. That is the
   * mirror of the property `backfilledFrom` already buys — a backfill can manufacture neither a
   * permission nor a refusal.
   */
  readonly gate?: RulingGate;
  /**
   * The gate ids this ruling LIFTS, on this row.
   *
   * A release is itself a ruling, carrying the owner's words and an anchor, because that is what a release is:
   * the owner saying the constraint is over. Silence is never a release — a later ruling with no gate does
   * NOT clear an earlier one, since the common case is the owner saying something else about the same row.
   */
  readonly gateReleases?: readonly string[];
  /**
   * Present when this ruling is an EXPLICIT STEER — the owner's words override the standing rules and memories for
   * this row's instance (`docs/doctrine-rationale/explicit-steer.md`). Its
   * `deliverByIso` is the instant the owner named, when they named one. A steered row is what `./steerRisk.ts`
   * watches, so a deliverable at risk reaches the owner early rather than at the deadline.
   *
   * Never on a reconstruction, for the reason `gate` is not: a backfill can manufacture no override.
   */
  readonly explicitSteer?: ExplicitSteer;
  /**
   * Present when this ruling makes the row's seat a STANDING SESSION — it stays open between the owner's turns, so
   * close-done never parks it and the chair reseats it on sight (`./standingSessionTypes.ts`). Never on a
   * reconstruction, for the reason `gate` is not.
   */
  readonly standingSession?: StandingSession;
  /**
   * Present when this ruling decides whether `github attach upload` may send a picture or a recording off this
   * machine (`./attachUploadRuling.ts`). Attach upload is CLOSED until the latest such ruling on the install
   * permits it. Never on a reconstruction, for the reason `gate` is not: a backfill can permit nothing.
   */
  readonly attachUpload?: AttachUploadRuling;
}
