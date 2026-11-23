/**
 * Readers for the workstreams page: `handover reconcile --json` exactly as the supervisor tick recorded it.
 *
 * Every field here is one the verb prints under the name it prints it by (`src/handover/reconcile.ts`'s
 * `Reconciliation`, `src/supervisor/outcomes/coverage.ts`'s `OutcomeCoverage`, the intake report the run
 * folds in). The page ranks nothing and judges nothing: `aligned`, `misaligned`, `starving`, `held`,
 * `standing`, `stale` and `uncovered` are the verb's own words, read back. A field the page's claim rests on
 * that is missing refuses the WHOLE reading rather than rendering a partial board, because a board that
 * looks complete while a row is missing is the one failure this surface cannot have (docs/console.md).
 *
 * `standing`, `held` and `fleet` are why the page can GROUP without judging. Before they existed the tile
 * drew the verb's top band as a table and called every unattended row in it starving — and once all five such rows read as "nobody is on this" while that same reading recorded every one of them as
 * `"ready": false`. Deriving a section name here from `ready` and a priority would rebuild exactly that: the
 * grouping has to be the producer's. Check it with `slopweaver handover reconcile --json | jq '[.starving[]
 * | {id, standing, ready}]'`, where every entry must read `ready` — `src/handover/reconcile.ts`'s header
 * owns the anchor and the command that reads that tick's own kept document.
 *
 * **Those three are the exception to the refuse-the-whole-reading rule, and {@link Reconcile.held} carries
 * why.** The distinction is not how important a field is but what its absence MEANS: a missing `headline` is
 * a malformed document, while a missing `held` is a document from an older build of the same verb, and one
 * shared `$SLOPWEAVER_HOME` guarantees a steady supply of those. So a reading without them still draws
 * everything both vintages agree on, and the tile states what it cannot split rather than showing nothing.
 *
 * The exception is exactly that wide and no wider: an ABSENT `held` is a vintage, a `held` that will not
 * READ is a defect, and {@link HeldRead} is the type that keeps the page from reporting the second as the
 * first. Every row inside a present `held` must carry its own `standing`, because the alternative is a
 * grouping word the producer never wrote.
 */
import { type Bag, bags, bool, isBag, num, str, strings, sub } from "../../lib/bag";
import { type Reading, readingOf } from "./reading";
import { reconcileHoldsOf } from "./readReconcileHolds";
import type { HeldRow, Intake, Outcome, Placed, RankedRow, Reconcile } from "./readWorkstreamsTypes";

export type {
  HeldRow,
  Intake,
  IntakeRead,
  IntakeUnavailable,
  Outcome,
  Placed,
  RankedRow,
  Reconcile,
} from "./readWorkstreamsTypes";
export {
  type FleetClaim,
  fleetClaim,
  heldByStanding,
  type PartitionClaim,
  partitionClaim,
  readyFold,
  type Seat,
  SHOWN,
  seatsOf,
  starvingWords,
} from "./readWorkstreamsViews";

/**
 * One ranked row off the document.
 *
 * @returns the row, or `undefined` when a field the page's claim rests on is missing
 */
function rowOf({ bag }: { bag: Bag }): RankedRow | undefined {
  const id = str({ bag, key: "id" });
  const kind = str({ bag, key: "kind" });
  const label = str({ bag, key: "label" });
  const priority = str({ bag, key: "priority" });
  const waitingHours = num({ bag, key: "waitingHours" });
  const groomed = bool({ bag, key: "groomed" });
  const ready = bool({ bag, key: "ready" });
  const standing = str({ bag, key: "standing" });
  if (
    id === undefined ||
    kind === undefined ||
    label === undefined ||
    priority === undefined ||
    waitingHours === undefined ||
    groomed === undefined ||
    ready === undefined
  ) {
    return undefined;
  }
  return {
    groomed,
    id,
    kind,
    label,
    openedIso: str({ bag, key: "openedIso" }),
    priority,
    ready,
    standing,
    waitingHours,
  };
}

/** The document key {@link heldOf} reads, named once because its PRESENCE is what decides the outcome. */
const HELD_KEY = "held";

/**
 * The `held` list in the three outcomes the page has to tell apart.
 *
 * Every other list here has two — it read, or the document is malformed — and collapsing `held` into those
 * two is what a reviewer caught: `rowsOf` answers `undefined` for an absent KEY and for a row inside it that
 * would not decode, so a document carrying a held row with no `id` would have been drawn as "an older
 * producer" with a reassuring note under it. Absence is a vintage; a list that will not read is a defect,
 * and the page must not report the second as the first.
 */
type HeldRead =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly rows: readonly HeldRow[] }
  | { readonly kind: "malformed" };

/**
 * Every ranked row under `key`, or `undefined` when the list is absent or one row will not read.
 *
 * @returns the rows
 */
function rowsOf({ bag, key }: { bag: Bag; key: string }): readonly RankedRow[] | undefined {
  const held = bags({ bag, key });
  if (held === undefined) {
    return undefined;
  }
  const out: RankedRow[] = [];
  for (const one of held) {
    const row = rowOf({ bag: one });
    if (row === undefined) {
      return undefined;
    }
    out.push(row);
  }
  return out;
}

/**
 * Read `held`, keeping an absent key and an unreadable one apart.
 *
 * `standing` is REQUIRED of a row in here, unlike the same field anywhere else on the document: `held` is
 * itself the field only a build that publishes `standing` writes, so a held row without one is a malformed
 * document rather than an older vintage, and accepting it would leave {@link heldByStanding} inventing a
 * group name the producer never used — the one thing this page may not do.
 *
 * @returns which of the three outcomes the document is in
 */
function heldOf({ bag }: { bag: Bag }): HeldRead {
  // The KEY's presence decides which of the three this is, not `bags`'s answer: `bags` returns `undefined`
  // for an absent key AND for a `held` that is `null`, an object, or an array with a non-object in it, so
  // reading its answer alone would report each of those malformed documents as an older producer — the same
  // conflation one level up from the one this type exists to end.
  if (!(HELD_KEY in bag)) {
    return { kind: "absent" };
  }
  const list = bags({ bag, key: HELD_KEY });
  if (list === undefined) {
    return { kind: "malformed" };
  }
  const rows: HeldRow[] = [];
  for (const one of list) {
    const row = rowOf({ bag: one });
    if (row === undefined) {
      return { kind: "malformed" };
    }
    const standing = row.standing;
    if (standing === undefined) {
      return { kind: "malformed" };
    }
    rows.push({ ...row, standing });
  }
  return { kind: "read", rows };
}

/**
 * One placed session off the document.
 *
 * @returns the placement, or `undefined`
 */
function placedOf({ bag }: { bag: Bag }): Placed | undefined {
  const session = str({ bag, key: "session" });
  const rank = num({ bag, key: "rank" });
  const rowBag = sub({ bag, key: "row" });
  if (session === undefined || rank === undefined || rowBag === undefined) {
    return undefined;
  }
  const row = rowOf({ bag: rowBag });
  if (row === undefined) {
    return undefined;
  }
  return { rank, row, session };
}

/**
 * Every placement under `key`, or `undefined` when the list is absent or one will not read.
 *
 * @returns the placements
 */
function placementsOf({ bag, key }: { bag: Bag; key: string }): readonly Placed[] | undefined {
  const held = bags({ bag, key });
  if (held === undefined) {
    return undefined;
  }
  const out: Placed[] = [];
  for (const one of held) {
    const placed = placedOf({ bag: one });
    if (placed === undefined) {
      return undefined;
    }
    out.push(placed);
  }
  return out;
}

/**
 * One kept outcome off the document, as the reconciliation projected it from the owner's Workstreams register.
 *
 * @returns the outcome, or `undefined`
 */
function outcomeOf({ bag }: { bag: Bag }): Outcome | undefined {
  const id = str({ bag, key: "id" });
  const title = str({ bag, key: "title" });
  const anchor = str({ bag, key: "anchor" });
  const rows = num({ bag, key: "rows" });
  const live = placementsOf({ bag, key: "live" });
  const unspawned = rowsOf({ bag, key: "unspawned" });
  if (
    id === undefined ||
    title === undefined ||
    anchor === undefined ||
    rows === undefined ||
    live === undefined ||
    unspawned === undefined
  ) {
    return undefined;
  }
  return { anchor, id, live, rows, title, unspawned };
}

/**
 * Whether the document's `outcomeSource` vouches for exactly `rows` outcomes read off the owner's Workstreams register: an
 * `absent` source (no register yet) carries its kind alone and no rows, a `present` one its `count` and exactly that
 * many. A document with no source at all predates the one source, so its outcomes came from somewhere else and it does
 * not read — the supervisor's own reader (`src/supervisor/outcomes/reconciledOutcomes.ts`) refuses it the same way.
 *
 * @param rows how many outcome rows the document carries
 * @returns whether the source is one reconcile writes and agrees with the rows
 */
function outcomeSourceVouches({ bag, rows }: { bag: Bag; rows: number }): boolean {
  const source = sub({ bag, key: "outcomeSource" });
  if (source === undefined) {
    return false;
  }
  const kind = str({ bag: source, key: "kind" });
  const keys = Object.keys(source).toSorted().join(",");
  if (kind === "absent") {
    return keys === "kind" && rows === 0;
  }
  const count = num({ bag: source, key: "count" });
  return kind === "present" && keys === "count,kind" && count === rows;
}

/**
 * The intake half, from the run's `intake` object and its top-level `intakeClause` — either arm the verb prints.
 *
 * @returns the intake, or `undefined`
 */
function intakeOf({ bag }: { bag: Bag }): Intake | undefined {
  const clause = str({ bag, key: "intakeClause" });
  const intake = sub({ bag, key: "intake" });
  if (clause === undefined || intake === undefined) {
    return undefined;
  }
  const kind = str({ bag: intake, key: "kind" });
  if (kind === "unavailable") {
    const why = str({ bag: intake, key: "why" });
    if (why === undefined) {
      return undefined;
    }
    return { clause, kind, why };
  }
  if (kind !== "read") {
    return undefined;
  }
  const finding = sub({ bag: intake, key: "finding" });
  const inbound = sub({ bag: intake, key: "inbound" });
  if (finding === undefined || inbound === undefined) {
    return undefined;
  }
  const sinceIso = str({ bag: finding, key: "sinceIso" });
  const witnessed = num({ bag: finding, key: "witnessed" });
  const unwitnessed = bags({ bag: finding, key: "unwitnessed" });
  const inGrace = num({ bag: finding, key: "inGrace" });
  const markedNoAsk = num({ bag: finding, key: "markedNoAsk" });
  const inboundRead = num({ bag: inbound, key: "read" });
  const inboundAnswered = num({ bag: inbound, key: "answered" });
  const unanswered = bags({ bag: inbound, key: "unanswered" });
  if (
    sinceIso === undefined ||
    witnessed === undefined ||
    unwitnessed === undefined ||
    inGrace === undefined ||
    markedNoAsk === undefined ||
    inboundRead === undefined ||
    inboundAnswered === undefined ||
    unanswered === undefined
  ) {
    return undefined;
  }
  return {
    clause,
    inGrace,
    kind,
    inboundAnswered,
    inboundRead,
    inboundUnanswered: unanswered.length,
    markedNoAsk,
    sinceIso,
    unwitnessed: unwitnessed.length,
    witnessed,
  };
}

/**
 * Project `handover reconcile --json` into the page's shape.
 *
 * @returns the reconciliation, or `undefined` when the payload is not one or a field will not read
 */
export function readReconcile(payload: unknown): Reconcile | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const headline = str({ bag: payload, key: "headline" });
  const rankedCount = num({ bag: payload, key: "rankedCount" });
  const source = str({ bag: payload, key: "source" });
  const fleet = str({ bag: payload, key: "fleet" });
  const top = rowsOf({ bag: payload, key: "top" });
  const aligned = placementsOf({ bag: payload, key: "aligned" });
  const misaligned = placementsOf({ bag: payload, key: "misaligned" });
  const unprioritised = placementsOf({ bag: payload, key: "unprioritised" });
  const unregistered = strings({ bag: payload, key: "unregistered" });
  const starving = rowsOf({ bag: payload, key: "starving" });
  const held = heldOf({ bag: payload });
  const ungroomed = num({ bag: payload, key: "ungroomed" });
  const staleAsks = rowsOf({ bag: payload, key: "staleAsks" });
  const ready = rowsOf({ bag: payload, key: "ready" });
  const outcomeBags = bags({ bag: payload, key: "outcomes" });
  const uncoveredOutcomes = strings({ bag: payload, key: "uncoveredOutcomes" });
  const intake = intakeOf({ bag: payload });
  const holds = reconcileHoldsOf({ bag: payload });
  if (held.kind === "malformed") {
    return undefined;
  }
  if (
    headline === undefined ||
    rankedCount === undefined ||
    source === undefined ||
    top === undefined ||
    aligned === undefined ||
    misaligned === undefined ||
    unprioritised === undefined ||
    unregistered === undefined ||
    starving === undefined ||
    ungroomed === undefined ||
    staleAsks === undefined ||
    ready === undefined ||
    outcomeBags === undefined ||
    uncoveredOutcomes === undefined ||
    intake === undefined
  ) {
    return undefined;
  }
  const outcomes: Outcome[] = [];
  for (const one of outcomeBags) {
    const outcome = outcomeOf({ bag: one });
    if (outcome === undefined) {
      return undefined;
    }
    outcomes.push(outcome);
  }
  if (!outcomeSourceVouches({ bag: payload, rows: outcomes.length })) {
    return undefined;
  }
  const heldRows = held.kind === "read" ? held.rows : undefined;
  return {
    aligned,
    fleet,
    headline,
    held: heldRows,
    holds,
    intake,
    misaligned,
    outcomes,
    rankedCount,
    ready,
    source,
    staleAsks,
    starving,
    top,
    uncoveredOutcomes,
    ungroomed,
    unprioritised,
    unregistered,
  };
}

/**
 * The last recorded reading of `handover reconcile`.
 *
 * @returns the reading, or `undefined`
 */
export function readReconcileReading(payload: unknown): Reading<Reconcile> | undefined {
  return readingOf({ payload, read: readReconcile });
}
