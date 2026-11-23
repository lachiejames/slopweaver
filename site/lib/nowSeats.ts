/**
 * The now page's one question — what is each agent doing right now — as a pure join of two readings the
 * supervisor tick records in the same pass: `session watch` (every open seat and its signal) and
 * `handover reconcile` (which board row each seat is placed on, and where that row stands).
 *
 * Why a join rather than the signal alone. `session watch` raises `needs-input` on ANY
 * `agent.hook.Notification`, and Claude Code fires that hook when a finished turn has merely sat idle
 * (`src/cmux/sessionActivity.ts`, `attentionKindOf`). So the join places a stopped seat between turns or on no
 * row, never by a hook event.
 *
 * No seat is "asked you". A parked session leaves the fleet immediately. A seat whose row waits on the owner is parked, and `session close-done` closes it with
 * its checkpoint on the row and its question on the Queue — so the fleet page counts only WORKING seats, and a
 * waiting row is the Queue's to show, never a band here.
 *
 * A join that cannot be trusted is refused WHOLE, never half-made: a reconcile reading from another tick (by
 * label or by instant), one
 * that did not observe the fleet, one placing a seat twice, or one too old to carry a row's standing each
 * give the signal-only view, which says only working or stopped and names why the board was not joined.
 */
import type { Reading } from "../components/live/reading";
import type { Seat, Seats } from "../components/live/readNow";
import type { Placed, Reconcile } from "../components/live/readWorkstreams";

/** Every standing `src/handover/rowStanding.ts` composes; any other word refuses the join. */
const KNOWN_STANDINGS: ReadonlySet<string> = new Set(["ready", "in-flight", "waiting-on-owner", "paused", "blocked"]);

/**
 * How long after the seats a reconcile may be observed and still be the same tick's. A tick label is the
 * caller's own `--tick` word, so equal `by` alone does not prove one capture — the instants must agree too.
 * MEASURED on ticks 508–513: the reconcile landed 35s to 95s after the seats. Re-measure with
 * `slopweaver reading list | grep -E "session watch|handover reconcile"`.
 */
const SAME_TICK_WINDOW_MS = 10 * 60_000;

/** One seat, with the board placement the reconcile reading gave it when there is one. */
export interface JoinedNowSeat {
  readonly seat: Seat;
  readonly placement: Placed | undefined;
}

/** Why the board could not be joined to the seats, each a distinct thing a reader can check. */
export type NowJoinGap =
  | "no-reconcile"
  | "unreadable-instant"
  | "different-tick"
  | "fleet-not-observed"
  | "standing-missing"
  | "standing-unknown"
  | "duplicate-placement";

/** Every seat in exactly one of three bands, the board joined. */
export interface JoinedNowSeats {
  readonly kind: "joined";
  readonly working: readonly JoinedNowSeat[];
  readonly betweenTurns: readonly JoinedNowSeat[];
  readonly notOnBoard: readonly JoinedNowSeat[];
}

/** Every seat by its signal alone, because the board could not be joined — and why. */
export interface SignalOnlyNowSeats {
  readonly kind: "signal-only";
  readonly reason: NowJoinGap;
  readonly working: readonly Seat[];
  readonly stopped: readonly Seat[];
}

/** What the now page draws: the joined bands, or the signal-only fallback. */
export type NowSeatsView = JoinedNowSeats | SignalOnlyNowSeats;

/** The part of a reconcile reading the join reads — narrowed so a caller never builds a whole one to test it. */
export type ReconcilePlacements = Pick<Reconcile, "aligned" | "fleet" | "misaligned" | "unprioritised">;

/**
 * Each placed session's placement, or the gap that refuses the whole join.
 *
 * @returns the index, or the reason it cannot be built
 */
function placementIndex({
  reconcile,
}: {
  reconcile: ReconcilePlacements;
}):
  | { readonly kind: "index"; readonly bySession: ReadonlyMap<string, Placed> }
  | { readonly kind: "gap"; readonly reason: NowJoinGap } {
  const bySession = new Map<string, Placed>();
  for (const placed of [...reconcile.aligned, ...reconcile.misaligned, ...reconcile.unprioritised]) {
    if (placed.row.standing === undefined) {
      return { kind: "gap", reason: "standing-missing" };
    }
    if (!KNOWN_STANDINGS.has(placed.row.standing)) {
      return { kind: "gap", reason: "standing-unknown" };
    }
    if (bySession.has(placed.session)) {
      return { kind: "gap", reason: "duplicate-placement" };
    }
    bySession.set(placed.session, placed);
  }
  return { bySession, kind: "index" };
}

/**
 * The signal-only view: working, or stopped.
 *
 * @returns the view
 */
function signalOnly({ rows, reason }: { rows: readonly Seat[]; reason: NowJoinGap }): SignalOnlyNowSeats {
  return {
    kind: "signal-only",
    reason,
    stopped: rows.filter((seat) => seat.signal !== "working"),
    working: rows.filter((seat) => seat.signal === "working"),
  };
}

/**
 * The gap that refuses joining this reconcile reading to these seats, when there is one.
 *
 * @returns the gap, or `undefined` when the two readings are one tick's own pair — the same `by`, and the
 *   reconcile observed after the seats and inside `SAME_TICK_WINDOW_MS`
 */
function readingGap({
  seatReading,
  reconcileReading,
}: {
  seatReading: Reading<Seats>;
  reconcileReading: Reading<ReconcilePlacements>;
}): NowJoinGap | undefined {
  const reconcileMs = Date.parse(reconcileReading.observedAtIso);
  const seatMs = Date.parse(seatReading.observedAtIso);
  if (Number.isNaN(reconcileMs) || Number.isNaN(seatMs)) {
    return "unreadable-instant";
  }
  const lagMs = reconcileMs - seatMs;
  const sameInstant = lagMs >= 0 && lagMs <= SAME_TICK_WINDOW_MS;
  if (reconcileReading.by !== seatReading.by || !sameInstant) {
    return "different-tick";
  }
  if (reconcileReading.value.fleet !== "observed") {
    return "fleet-not-observed";
  }
  return undefined;
}

/**
 * Every open seat in exactly one band, in the seats reading's own order within each band.
 *
 * Precedence: a `working` signal is working; otherwise a placed seat is between turns, whatever its row's
 * standing; otherwise it is on no board row.
 *
 * @param seatReading the tick's `session watch` reading
 * @param reconcileReading the tick's `handover reconcile` reading, `undefined` while it is loading or unread
 * @returns the joined bands, or the signal-only view naming why the board was not joined
 */
export function nowSeatsOf({
  seatReading,
  reconcileReading,
}: {
  seatReading: Reading<Seats>;
  reconcileReading: Reading<ReconcilePlacements> | undefined;
}): NowSeatsView {
  const rows = seatReading.value.rows;
  if (reconcileReading === undefined) {
    return signalOnly({ reason: "no-reconcile", rows });
  }
  const gap = readingGap({ reconcileReading, seatReading });
  if (gap !== undefined) {
    return signalOnly({ reason: gap, rows });
  }
  const index = placementIndex({ reconcile: reconcileReading.value });
  if (index.kind === "gap") {
    return signalOnly({ reason: index.reason, rows });
  }
  const working: JoinedNowSeat[] = [];
  const betweenTurns: JoinedNowSeat[] = [];
  const notOnBoard: JoinedNowSeat[] = [];
  for (const seat of rows) {
    let placement: Placed | undefined;
    if (seat.workspaceRef !== undefined) {
      placement = index.bySession.get(seat.workspaceRef);
    }
    const joined = { placement, seat };
    if (seat.signal === "working") {
      working.push(joined);
    } else if (placement !== undefined) {
      betweenTurns.push(joined);
    } else {
      notOnBoard.push(joined);
    }
  }
  return { betweenTurns, kind: "joined", notOnBoard, working };
}

/**
 * The words for why the board was not joined, for a reader rather than a log.
 *
 * @returns one short clause
 */
export function joinGapWords({ reason }: { reason: NowJoinGap }): string {
  switch (reason) {
    case "no-reconcile": {
      return "the board reading is not available";
    }
    case "unreadable-instant": {
      return "the board reading or the seats carry an instant this page cannot read";
    }
    case "different-tick": {
      return "the board reading is from a different tick than the seats";
    }
    case "fleet-not-observed": {
      return "the board reading did not observe the live seats";
    }
    case "standing-missing": {
      return "the board reading is too old to say where each row stands";
    }
    case "standing-unknown": {
      return "the board reading names a row standing this page does not know";
    }
    case "duplicate-placement": {
      return "the board reading placed one seat on two rows";
    }
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/**
 * The one line saying why a board reading that IS held refused the join — the now page draws exactly this, so a gap
 * is always worded one way. A board reading still loading is a progress indicator there and one the route could not
 * measure a staleness mark, never a sentence.
 *
 * @returns the sentence
 */
export function boardGapLine({ reason }: { reason: NowJoinGap }): string {
  return `Not joined to the board: ${joinGapWords({ reason })}. Seats read working or stopped only.`;
}
