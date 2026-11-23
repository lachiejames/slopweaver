/**
 * THE IDLE-CAPACITY GATE — a tick that read NO machine hold and left a placed, ready p0–p2 doc or ask with no seat
 * on it cannot be RECORDED without spawning it, taking it off the board, or naming it in a reason.
 *
 * ## The thing it makes impossible
 *
 * A CPU panel at 89% idle showed the fleet leaving capacity on the table. Six consecutive ticks spawned
 * NOTHING at 1-minute load 4 to 10 against a hold of 22, while the reconciliation each of them read carried
 * 31 groomed ready doc rows at p1/p2 with nobody on them. `./outcomes/sweepGate.ts` passed every one of those
 * ticks, and it was not wrong by its own predicate: it judges OUTCOMES, and an outcome with one live seat is
 * covered however many ready rows sit under it (one outcome read 9 live and 97 unspawned), while
 * seven of the 31 rows sat under no outcome at all. The two outcomes that WERE uncovered carried a
 * hold-rationale copied verbatim from tick to tick. Reproduce the hole with
 * `src/__tests__/unit/supervisor/idleCapacityReplay.test.ts`, which replays the last of those ticks' own draft.
 *
 * So this gate judges ROWS, which is what the incident was about. It is the sweep gate's complement one level
 * down, and the load-dispatch gate's (`./loadDispatchGate.ts`) complement on the other side of `hold`.
 *
 * ## The predicate, exactly
 *
 * It refuses when ALL of these hold:
 *
 * 1. the tick's capacity reading says the machine was NOT holding — ANY hold is clean here, a boots-only or
 *    disk-only one included, which is deliberately unlike the load-dispatch gate: that gate asks whether there is an
 *    anomaly to investigate, this one asks whether a spawn was allowed, and `hold: true` holds every spawn;
 * 2. the plan gauge, when it was read, still names a plan the next all-models spawn routes to — a gauge
 *    reading `nextAllModels: null` is Ceiling A measured, and a gate may never demand a spawn nothing can take;
 * 3. and the reconciliation's `ready` list carries a doc or ask row that is GROOMED (a stated position, the
 *    same rule `../handover/reconcile.ts` applies before calling anything misaligned) at p0, p1 or p2, that no
 *    seat is on, that this tick did not spawn onto with a completed `{kind:"handover"}` action, and that no
 *    `hold-rationale` judgement names as `{kind:"handover", id:<slug>}`.
 *
 * **Every such row must be answered, and there is no wildcard.** A blanket subject is exactly the copied
 * every-tick rationale the incident was. A row the fleet keeps deferring belongs off `RUN NOW`, which is the
 * grooming the owner wants anyway.
 *
 * ## Asks are owed exactly as docs are
 *
 * MEASURED: 28 ready landing rows on the owner's pull requests
 * sat unseated, 25 with no run journal at all, and every tick passed — because condition 3 read `kind ===
 * "doc"` and every row `github landing --register` writes is a `kind: ask` `--dispatch` row. The live
 * reconcile then carried ZERO groomed ready p0–p2 docs and 435 ready p0–p2 asks, so the gate owed nothing
 * on any tick. Reproduce over any reading under `$SLOPWEAVER_HOME/readings/handover-reconcile/`:
 * `jq '[.ready[] | select(.groomed and (.priority != "p3")) | .kind] | group_by(.) | map({(.[0]): length}) | add'`.
 *
 * An ask in `ready` is seat work by construction: one waiting on the owner's word with a whole problem, options and
 * lean is placed WAITING ON OWNER instead (`../handover/registeredAsk.ts`), and every ask is groomed (it
 * carries `askedIso`). `--dispatch` is a register-time relaxation and persists no field, so `kind` is the only
 * thing a reconciliation row could be judged on — a landing slug grammar would leave every other ready
 * dispatch ask invisible. Below a measured seat ceiling the board's rank (landing rows first within p1,
 * `../handover/rank.ts`) decides which of them the free seats are owed to.
 *
 * ## When the tick MEASURED how many working seats the plans carry, the gate fills to that number
 *
 * Only six agents running in a fleet the owner expected to run about twenty is the gap this closes. A capacity capture carrying `workingSeatCeiling` (`slopweaver fleet ceiling`,
 * `../capacity/seatCeiling.ts`) is the N "the first N the free seats could take" always needed: how many seats
 * may be WORKING at the burn the fleet measured until each plan resets. With N measured and `working` seats in
 * the tick's watch, the first `N − working` unseated rows in rank order each need a completed spawn or must
 * leave `ready` — and a `hold-rationale` answers one only when it names the `machine` ceiling, because below N
 * the Claude plans are by measurement not what binds. A spawn of a lower row does not answer a higher one. At
 * or above N the tick is clean. An UNMEASURABLE N runs the predicate above unchanged and carries its reason, so
 * no tick claims a number nobody measured; a capture with no `workingSeatCeiling` key judges exactly as before.
 * That half is `./idleCapacitySeats.ts`'s.
 *
 * ## When the tick read its CEILINGS, the predicate is every ceiling's, and a reason names one
 *
 * Plan usage left on the table across Claude, Codex and machine resources is what this closes. A capacity capture carrying `ceilings` (`../capacity/ceilings.ts`) replaces
 * conditions 1 and 2 with `admissionOf` (`./idleCapacityCeilings.ts`): the machine held, or every route through a plan measured spent,
 * is clean; a route with headroom is free capacity, bound by the LOWEST unused ceiling on it. And condition 3's
 * hold-rationale must then name that ceiling too — subject `{kind:"handover", id:<slug>}` AND a
 * `relatedSubjects` entry `{kind:"ceiling", id:<binding ceiling>}`. Still per row, still no wildcard: a reason
 * naming only the ceiling answers no row, and one naming `claude:plan-one` does not answer a tick bound by the
 * machine. A capture with no `ceilings` key runs the machine-only predicate above exactly, so every ledger row
 * and fixture from before ceilings existed judges as it always did.
 *
 * ## A gate that cannot SEE refuses too — but capacity is read FIRST
 *
 * A capacity observation that is not `read`/`partial`, or carries no `hold` or `load1`, and a reconciliation
 * with no `ready` list or placement list, are readings this tick never took: `unreadable`, for the reason
 * every sibling gate gives. A hold is judged before the reconciliation is decoded, so a held tick is clean
 * over any reconciliation — its answer is already determined, and nothing unseen is being called clean. An
 * EMPTY `ready` list is a real board state (nothing startable) and is clean, as the sweep gate's empty
 * `outcomes` is when its `outcomeSource` says no register exists yet. An unreadable GAUGE neither clears nor
 * refuses: it is not this gate's primary input, and making it one would be a new way to wedge the chair.
 *
 * Pure — the draft's own values and the reconciliation in, a verdict out. No filesystem, no clock, no env;
 * `../cli/commands/supervisor/tickRecordGates.ts` renders the refusal and the recorder reads the hatch.
 */

import type { CeilingsReading } from "../capacity/ceilings.js";
import { asBoardPriority, type BoardPriority } from "../handover/rowKind.js";
import { isRecord } from "../lib/parsers.js";
import { admittedCeilingOf } from "./idleCapacityCeilings.js";
import { owedScopeOf, refusalSeatFieldsOf, seatFillOf } from "./idleCapacitySeats.js";

/**
 * One placed, ready doc or ask row the tick neither sat on, spawned onto, nor named.
 *
 * @internal — the element type of {@link IdleCapacityVerdict}'s refused arm; a caller reads the verdict.
 */
export interface IdleRow {
  readonly id: string;
  readonly priority: BoardPriority;
}

/** Why a tick is being refused for idle measured capacity, or that it is not. */
export type IdleCapacityVerdict =
  /** Nothing to answer for: the machine or the plans held, or every candidate row is answered. */
  | { readonly kind: "clean" }
  /** The gate could not judge, and says which input it could not read. */
  | { readonly kind: "unreadable"; readonly why: string }
  /** Capacity was free and these rows were left with no seat, no spawn and no reason. */
  | {
      readonly kind: "refused";
      /** Every unanswered row, in the reconciliation's own rank order. */
      readonly rows: readonly IdleRow[];
      /** The 1-minute load at the reading that said the machine could take more. */
      readonly load1: number;
      /** Completed `spawned` actions whose subject names a workspace rather than a row — they answer nothing here. */
      readonly workspaceSpawns: number;
      /**
       * The ceiling a reason must name, and the whole reading it came from — both `null` on a capture that
       * carried no ceilings, where a row-only reason still answers.
       */
      readonly bindingCeilingId: string | null;
      readonly ceilings: CeilingsReading | null;
      /** Seats the tick's watch saw working — `null` unless the capture measured a seat ceiling. */
      readonly workingSeats: number | null;
      /** The measured working-seat ceiling the tick filled to, or `null` when none was measured. */
      readonly workingSeatCeiling: number | null;
      /** `workingSeatCeiling − workingSeats`: how many ranked rows were owed a seat, or `null`. */
      readonly seatsOwed: number | null;
      /** Why the capture's seat ceiling could not be measured, when it says so — the legacy arm then judged. */
      readonly ceilingMeasurementProblem: string | null;
    };

/** The judgement kind that answers for a row by narrating it. */
const HOLD_RATIONALE = "hold-rationale";

/** The subject kind that names a board row by its slug. */
const HANDOVER = "handover";

/** The subject kind that names one of `../capacity/ceilings.ts`'s ceilings by id. */
const CEILING = "ceiling";

/** The bands a free seat is owed to. p3 is the board's "when there is nothing else" band. */
const OWED_PRIORITIES: ReadonlySet<BoardPriority> = new Set(["p0", "p1", "p2"]);

/**
 * The row kinds a free seat is owed to — both authored kinds, never a `tag` (a tag with no listener is a no-op
 * by design, AGENTS.md rule 2, so it must never create seat demand). See the module header's § "Asks are owed
 * exactly as docs are" for why an ask joined.
 */
const OWED_KINDS: ReadonlySet<string> = new Set(["doc", "ask"]);

/** The three reconciliation lists a seated row appears in, as `{ session, row, rank }`. */
const PLACEMENT_LISTS = ["aligned", "misaligned", "unprioritised"] as const;

/** A string field on a record, or `undefined` when it is absent or not a string. */
function str({ key, on }: { key: string; on: Record<string, unknown> }): string | undefined {
  const value = on[key];
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

/** A decode of one reconciliation list, or the reason it could not be read — the same shape as {@link CapacityReading}. */
export type ListReading<T> =
  { readonly kind: "read"; readonly value: T } | { readonly kind: "unreadable"; readonly why: string };

/** What the tick's capacity observation says about spawning, or the reason it says nothing. */
type CapacityReading =
  | { readonly kind: "free"; readonly load1: number }
  | { readonly kind: "held" }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Decode the capacity slice of a tick draft's sources.
 *
 * Built to the same shape as its two siblings rather than sharing a decoder with them, for the reason
 * `./loadDispatchGate.ts#holdReadingOf` gives: the gates read one observation for different purposes, and a
 * shared decoder would let a change made for one silently change the others.
 */
function capacityReadingOf({ sources }: { sources: unknown }): CapacityReading {
  if (!isRecord(sources) || !isRecord(sources["capacity"])) {
    return { kind: "unreadable", why: "the draft carries no capacity observation at all" };
  }
  const capacity = sources["capacity"];
  const status = str({ key: "status", on: capacity });
  if (status !== "read" && status !== "partial") {
    let named = "malformed";
    if (status !== undefined && status !== "") {
      named = status;
    }
    return {
      kind: "unreadable",
      why: `the draft's capacity observation is "${named}", so this tick never read whether the machine could take another session`,
    };
  }
  const facts = capacity["facts"];
  if (!isRecord(facts) || typeof facts["hold"] !== "boolean") {
    return { kind: "unreadable", why: "the draft's capacity observation carries no `hold` reading" };
  }
  if (facts["hold"]) {
    return { kind: "held" };
  }
  const load1 = facts["load1"];
  if (typeof load1 !== "number") {
    return { kind: "unreadable", why: "the draft's capacity observation carries no `load1` reading" };
  }
  return { kind: "free", load1 };
}

/**
 * The reconciliation's ready rows that a free seat is owed to: groomed docs and asks at p0–p2, in rank order.
 *
 * Every entry is decoded, not only the ones that survive the filter, so a malformed entry anywhere is an
 * `unreadable` reconciliation rather than a row silently dropped from the comparison.
 */
function owedRowsOf({ reconciliation }: { reconciliation: unknown }): ListReading<readonly IdleRow[]> {
  if (!isRecord(reconciliation) || !Array.isArray(reconciliation["ready"])) {
    return {
      kind: "unreadable",
      why: "the reconciliation carries no `ready` list — re-run `slopweaver handover reconcile --json` with this checkout",
    };
  }
  const owed: IdleRow[] = [];
  for (const [index, entry] of reconciliation["ready"].entries()) {
    const malformed = `the reconciliation's ready[${String(index)}] is not a board row with a string id and kind, a p0–p3 priority and a boolean groomed`;
    if (!isRecord(entry)) {
      return { kind: "unreadable", why: malformed };
    }
    const id = str({ key: "id", on: entry });
    const kind = str({ key: "kind", on: entry });
    const priority = asBoardPriority({ value: str({ key: "priority", on: entry }) });
    const groomed = entry["groomed"];
    if (id === undefined || kind === undefined || priority === undefined || typeof groomed !== "boolean") {
      return { kind: "unreadable", why: malformed };
    }
    if (OWED_KINDS.has(kind) && groomed && OWED_PRIORITIES.has(priority)) {
      owed.push({ id, priority });
    }
  }
  return { kind: "read", value: owed };
}

/** The row id one placement entry seats a session on, or undefined when the entry carries none. */
function placedRowId({ item }: { item: unknown }): string | undefined {
  if (!isRecord(item) || !isRecord(item["row"])) {
    return undefined;
  }
  return str({ key: "id", on: item["row"] });
}

/**
 * Every row id a live seat is on, read off the three placement lists. Shared with `./recipeFailureGate.ts`, so the
 * two gates can never disagree about which rows a seat is on.
 *
 * @param reconciliation the `handover reconcile --json` document the tick read
 * @returns the seated ids, or which placement list would not read
 */
export function seatedRowIdsOf({ reconciliation }: { reconciliation: unknown }): ListReading<ReadonlySet<string>> {
  const seated = new Set<string>();
  if (!isRecord(reconciliation)) {
    return { kind: "unreadable", why: "the reconciliation is not a JSON object" };
  }
  for (const list of PLACEMENT_LISTS) {
    const placed = reconciliation[list];
    if (!Array.isArray(placed)) {
      return {
        kind: "unreadable",
        why: `the reconciliation carries no \`${list}\` placement, so which ready rows already have a seat cannot be read`,
      };
    }
    for (const [index, item] of placed.entries()) {
      const id = placedRowId({ item });
      if (id === undefined) {
        return { kind: "unreadable", why: `the reconciliation's ${list}[${String(index)}] carries no row id` };
      }
      seated.add(id);
    }
  }
  return { kind: "read", value: seated };
}

/**
 * The rows this tick spawned onto, and how many completed spawns named a workspace instead of a row.
 *
 * Only a COMPLETED spawn answers a row — a `cmux spawn` that failed seated nobody, the load gate's own lesson — and only one whose subject names the row. MEASURED over 300 ticks:
 * 121 of 186 `spawned` actions carried `{kind:"session", id:"workspace:N"}`, which names no row, so the
 * refusal counts them rather than letting a tick that did fill be refused without saying why.
 *
 * Shared with `./recipeFailureGate.ts`, which asks the same question of a different set of rows.
 *
 * @param actions the draft's actions
 * @returns the row ids completed spawns named, and the count that named a workspace instead
 */
export function spawnedRowsOf({ actions }: { actions: unknown }): {
  readonly rowIds: ReadonlySet<string>;
  readonly workspaceSpawns: number;
} {
  const rowIds = new Set<string>();
  let workspaceSpawns = 0;
  if (!Array.isArray(actions)) {
    return { rowIds, workspaceSpawns };
  }
  for (const action of actions) {
    if (!isRecord(action) || action["kind"] !== "spawned" || action["outcome"] !== "completed") {
      continue;
    }
    const subject = action["subject"];
    if (!isRecord(subject)) {
      continue;
    }
    const id = str({ key: "id", on: subject });
    if (subject["kind"] === HANDOVER && id !== undefined) {
      rowIds.add(id);
      continue;
    }
    if (subject["kind"] === "session") {
      workspaceSpawns += 1;
    }
  }
  return { rowIds, workspaceSpawns };
}

/** Whether a judgement's `relatedSubjects` names this ceiling. */
function namesCeiling({ judgement, ceilingId }: { judgement: Record<string, unknown>; ceilingId: string }): boolean {
  const related = judgement["relatedSubjects"];
  if (!Array.isArray(related)) {
    return false;
  }
  return related.some(
    (subject) => isRecord(subject) && subject["kind"] === CEILING && str({ key: "id", on: subject }) === ceilingId,
  );
}

/**
 * Every row id this tick named in a hold rationale — the narrate half of the way out. With `ceilingId`, only a
 * rationale that ALSO names that ceiling in its `relatedSubjects` counts: the row-plus-ceiling pair, never a
 * ceiling alone. Shared with `./recipeFailureGate.ts`, which passes `ceilingId: null`.
 *
 * @param judgements the draft's judgements
 * @param ceilingId the ceiling a rationale must also name, or `null` when naming the row is enough
 * @returns the row ids a qualifying hold-rationale names
 */
export function namedRowIdsOf({
  judgements,
  ceilingId,
}: {
  judgements: unknown;
  ceilingId: string | null;
}): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(judgements)) {
    return ids;
  }
  for (const judgement of judgements) {
    if (!isRecord(judgement) || judgement["kind"] !== HOLD_RATIONALE || !isRecord(judgement["subject"])) {
      continue;
    }
    const subject = judgement["subject"];
    const id = str({ key: "id", on: subject });
    if (subject["kind"] !== HANDOVER || id === undefined) {
      continue;
    }
    if (ceilingId === null || namesCeiling({ ceilingId, judgement })) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Judge one tick against the ready docs and asks it left with measured capacity free.
 *
 * @param sources the draft's source observations, of which the capacity (its ceilings and seat ceiling), the
 *   gauge and, below a measured seat ceiling, the watch are read
 * @param actions what the tick did — a completed `spawned` action on `{kind:"handover"}` answers its row
 * @param judgements what the tick concluded — a `hold-rationale` on `{kind:"handover"}` answers its row, and
 *   once the tick read ceilings only one that also names the binding `{kind:"ceiling"}` in `relatedSubjects`;
 *   below a measured seat ceiling, only one naming the `machine` ceiling
 * @param reconciliation the `handover reconcile --json` document this tick already read
 * @returns the verdict the recorder acts on
 */
export function judgeIdleCapacity({
  sources,
  actions,
  judgements,
  reconciliation,
}: {
  sources: unknown;
  actions: unknown;
  judgements: unknown;
  reconciliation: unknown;
}): IdleCapacityVerdict {
  const capacity = capacityReadingOf({ sources });
  if (capacity.kind === "unreadable") {
    return { kind: "unreadable", why: capacity.why };
  }
  const admitted = admittedCeilingOf({ held: capacity.kind === "held", sources });
  if (admitted.kind === "decided") {
    return admitted.verdict;
  }
  // `admittedCeilingOf` already decided every held tick; this narrows `capacity` to the arm carrying `load1`.
  if (capacity.kind === "held") {
    return { kind: "clean" };
  }
  const { bindingCeilingId } = admitted;
  const seats = seatFillOf({ sources });
  if (seats.kind === "decided") {
    return seats.verdict;
  }
  const owed = owedRowsOf({ reconciliation });
  if (owed.kind === "unreadable") {
    return owed;
  }
  const seated = seatedRowIdsOf({ reconciliation });
  if (seated.kind === "unreadable") {
    return seated;
  }
  const spawned = spawnedRowsOf({ actions });
  const scope = owedScopeOf({
    bindingCeilingId,
    seats,
    unseated: owed.value.filter((row) => !seated.value.has(row.id)),
  });
  const named = namedRowIdsOf({ ceilingId: scope.ceilingId, judgements });
  const rows = scope.rows.filter((row) => !spawned.rowIds.has(row.id) && !named.has(row.id));
  if (rows.length === 0) {
    return { kind: "clean" };
  }
  return {
    ...refusalSeatFieldsOf({ seats }),
    bindingCeilingId,
    ceilings: admitted.ceilings,
    kind: "refused",
    load1: capacity.load1,
    rows,
    workspaceSpawns: spawned.workspaceSpawns,
  };
}
