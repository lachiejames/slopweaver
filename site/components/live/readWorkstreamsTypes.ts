/**
 * The shapes the workstreams page reads `handover reconcile --json` into. A sibling of `./readWorkstreams.ts`, under
 * every rule its module doc states: every field is the verb's, under the name the verb prints it by.
 */
import type { ReconcileHolds } from "./readReconcileHolds";

/** One ranked board row, as `handover rank` places it. */
export interface RankedRow {
  readonly id: string;
  readonly kind: string;
  /** The verb's one line for a reader scanning the ranked list — an ask's label is the ask itself. */
  readonly label: string;
  readonly priority: string;
  /** When the row started waiting, when the verb knows — absent for an ordinary doc row. */
  readonly openedIso: string | undefined;
  readonly waitingHours: number;
  /** Whether the row's POSITION means anything: somebody stated a priority, or it carries when it opened. */
  readonly groomed: boolean;
  /** Whether it could be picked up right now — the verb's own derivation from {@link RankedRow.standing}. */
  readonly ready: boolean;
  /**
   * Where the row stands, in the verb's word: `ready`, `in-flight`, `waiting-on-owner`, `paused` or
   * `blocked`. This is what lets the page group without judging — the grouping below is the producer's
   * grouping, read back, never a section name the page recomputed off `ready` and a priority.
   *
   * OPTIONAL, and `undefined` means one thing only: the reading was taken by a build older than the field.
   * See {@link Reconcile.held} for why that is a degrade rather than a refusal.
   */
  readonly standing: string | undefined;
}

/**
 * A ranked row inside `held`, where the producer's own {@link RankedRow.standing} is guaranteed present.
 *
 * The narrowing is the whole point: `standing` is what the page groups by, so a type that could not carry
 * one would force a label the producer never wrote. `heldOf` in `./readWorkstreams.ts` is the only thing that mints these.
 */
export type HeldRow = RankedRow & { readonly standing: string };

/** One live session placed against the ranked board. */
export interface Placed {
  readonly session: string;
  /** The row's 1-based position in the ranked list. */
  readonly rank: number;
  readonly row: RankedRow;
}

/** One of the owner's kept outcomes (an entry on the owner's Workstreams register) and how much of the fleet is on it. */
export interface Outcome {
  readonly id: string;
  readonly title: string;
  /** The anchor on the register row, so a reader can check the owner said it. */
  readonly anchor: string;
  /** Every row under it, ready or not. */
  readonly rows: number;
  readonly live: readonly Placed[];
  /** READY rows under it that no live session is on. */
  readonly unspawned: readonly RankedRow[];
}

/**
 * The owner-intake half of the reconciliation, as the verb's own two-armed report: read, with the counts, or
 * `unavailable` with the verb's reason. The second arm is a first-class outcome (`src/supervisor/intake.ts`):
 * a machine with no supervisor pin, a pin naming a dead session, or a transcript that could not be walked
 * prints "not checked", and a page that refused the whole reading on it would blank the fleet tile for a
 * fact about the intake half alone.
 */
export type Intake = IntakeRead | IntakeUnavailable;

/** The intake was not read; `why` is the verb's own sentence for it. */
export interface IntakeUnavailable {
  readonly kind: "unavailable";
  readonly clause: string;
  readonly why: string;
}

/** The intake was read: were the owner's turns witnessed, and were other sessions answered. */
export interface IntakeRead {
  readonly kind: "read";
  /** The verb's own sentence for all of it. */
  readonly clause: string;
  readonly sinceIso: string;
  readonly witnessed: number;
  readonly unwitnessed: number;
  readonly inGrace: number;
  readonly markedNoAsk: number;
  readonly inboundRead: number;
  readonly inboundAnswered: number;
  readonly inboundUnanswered: number;
}

/** What comparing the fleet against the board found, in the verb's own fields. */
export interface Reconcile {
  /** The whole finding in one sentence — the verb's own, above the fold. */
  readonly headline: string;
  readonly rankedCount: number;
  /** Where the live sessions were read from — `cmux`. */
  readonly source: string;
  /**
   * Whether the verb OBSERVED the fleet or fell back to the board's own open runs — `observed` or
   * `unavailable`. The page says which, because an unobserved read cannot tell a living session from a
   * journal nobody closed, and the whole complaint this tile answers was not knowing whether it reflects
   * reality. `undefined` means the reading predates the field.
   */
  readonly fleet: string | undefined;
  /** The top band of the ranked board, most urgent first. */
  readonly top: readonly RankedRow[];
  /** Sessions working a top-band row. */
  readonly aligned: readonly Placed[];
  /** Sessions working a groomed row that is NOT in the top band. */
  readonly misaligned: readonly Placed[];
  /** Sessions working a row nobody has placed — a finding about the board, not the session. */
  readonly unprioritised: readonly Placed[];
  /** Sessions working something no row on the board claims. */
  readonly unregistered: readonly string[];
  /**
   * Top-band rows nobody is working. A NEW reading means READY ones, the rows a reader may start right now;
   * an OLD one means merely groomed ones, which is the defect this whole change was about. {@link
   * Reconcile.held} being present is what distinguishes the two, and is the only thing the page may turn on.
   */
  readonly starving: readonly RankedRow[];
  /**
   * Every ranked row nobody is on that nobody CAN be on: parked on the owner, paused, blocked, or a retired
   * supervisor chair. `ready`, `held` and the seated rows COVER the whole ranked board, which is what lets
   * the tile claim it draws every row rather than a selection of them. Cover, not partition: a `RUN NOW`
   * row a live session is already on is both ready and seated, so the three are exhaustive but the first and
   * the last overlap on exactly that case. Both claims are conditional on every ranked row carrying its own
   * id, and `src/handover/reconcile.ts`'s own `held` states what a duplicate one breaks in each direction.
   *
   * **OPTIONAL, and that is a mechanism rather than a leniency.** Every checkout on this machine writes
   * into one `$SLOPWEAVER_HOME`, so the readings ledger is written by as many vintages of the verb as there
   * are seats, and the supervisor tick that records this document runs from whichever seat holds the pin.
   * MEASURED while building this: a tick on the previous build overwrote a reading taken by the new one
   * inside a minute, and a reader that refused the whole document blanked all three tiles — strictly worse
   * than the stale band it replaced. Ask which vintage wrote the standing reading with `slopweaver reading
   * last --producer "handover reconcile" --json | jq '{by, recordedAtIso, held: (.document|has("held"))}'`,
   * and run it again after another seat ticks. So `undefined` here means "an older producer", the page
   * draws what that vintage can support and SAYS what it cannot, and the next current tick restores it.
   */
  readonly held: readonly HeldRow[] | undefined;
  /** How many live rows carry no stated position at all. */
  readonly ungroomed: number;
  /** Open asks waiting longer than the verb's stale bound. */
  readonly staleAsks: readonly RankedRow[];
  /** EVERY row that could be picked up right now, ranked. */
  readonly ready: readonly RankedRow[];
  readonly outcomes: readonly Outcome[];
  /** Outcomes with an unspawned ready row and no live session — the ones a tick has to answer for. */
  readonly uncoveredOutcomes: readonly string[];
  readonly intake: Intake;
  /**
   * The rows no spawn may be offered for, by the verb's own four lists — `absent` on a reading from a build before
   * them, the same vintage rule as {@link Reconcile.held}, and `malformed` carried rather than refusing the reading,
   * since only the doctrine panel reads them; `./readReconcileHolds.ts` carries it.
   */
  readonly holds: ReconcileHolds;
}
