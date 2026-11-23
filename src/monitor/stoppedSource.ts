/**
 * The stopped-row monitors' shell: ONE read of the recipe definitions, their run stamps and the slot ledger, and
 * ONE read of the repairs register, shared per pass by `recipe-stopped`, `recipe-repairing` and
 * `corpus-sync-stopped`, and not taken at all by a pass that runs none of them.
 */
import { ok } from "#lib/result.js";

import { liveRepairRows, readRepairTakes, repairingRows, repairingTakeIsos } from "../live/automation/repairTake.js";
import { readSilentRecipeRows } from "../live/automation/silentRowReader.js";
import type { SilentRow } from "../live/automation/silentRows.js";

import { evaluateCorpusSyncStopped, evaluateRecipeRepairing, evaluateRecipeStopped } from "./evaluateStopped.js";
import { readClosedByOwner } from "./heldKeys.js";
import { monitorDefinition } from "./registry.js";
import type { MonitorId, MonitorReading } from "./types.js";

/** One of the three monitors a stopped row can reach. */
type StoppedMonitorId = "recipe-stopped" | "corpus-sync-stopped" | "recipe-repairing";

/** The repairs register as a pass reads it: which stops are taken, and what stopped it reading the whole of it. */
interface RepairsReading {
  readonly taken: ReadonlyMap<string, string>;
  /** Recipe id → when the take repairing it was recorded. */
  readonly takenIso: ReadonlyMap<string, string>;
  /** Why the register, or a row it names, did not read whole — absent when it did. */
  readonly problem: string | undefined;
}

/**
 * Read the repairs register and each row it names, into which stopped recipe each live seat has taken.
 *
 * An unreadable register reads as NOTHING taken, which keeps every stop on the loud card: the failure falls to
 * the side the owner's rule says must never be silent.
 *
 * Only the takes for a recipe stopped NOW have their row read: the register only grows, and a take for a recipe
 * that fires again says nothing about this pass.
 *
 * @param home the Slopweaver home
 * @param stopped the recipe ids stopped this pass
 * @returns the taken map and any problem reading it
 */
export function readRepairs({ home, stopped }: { home: string; stopped: ReadonlySet<string> }): RepairsReading {
  const register = readRepairTakes({ home });
  if (register.isErr()) {
    return { problem: register.error.message, taken: new Map(), takenIso: new Map() };
  }
  const takes = register.value.takes.filter((take) => stopped.has(take.recipeId));
  const { live, problems } = liveRepairRows({ home, takes });
  const unparsed =
    register.value.unparsed.length === 0
      ? []
      : [`repairs register line(s) ${register.value.unparsed.join(", ")} did not read`];
  const all = [...unparsed, ...problems];
  return {
    problem: all.length === 0 ? undefined : all.join("; "),
    taken: repairingRows({ liveRows: live, takes }),
    takenIso: repairingTakeIsos({ liveRows: live, takes }),
  };
}

/**
 * Who owns each stopped row: the live seat that took its repair, else the holder running its current firing under a
 * live lease. A held firing IS a seat on the row, so "no seat has it" is false of it and its stop goes to
 * `recipe-repairing`'s notice instead of the loud card and the sweep's repair row. MEASURED: the sweep
 * registered a repair for `bump-fix-slopweaver` and `slack-owed-daily` while two automations seats held both
 * firings; each settled succeeded minutes later. A take wins as a pair — its row and its instant — because it is the
 * explicit act; a firing that settles, expires or loses its holder owns nothing on the next pass. Ownership is keyed
 * by recipe id and definitions may share one, so a hold owns an id only when EVERY stopped row carrying it is held:
 * one held duplicate must not silence another whose firing nobody holds.
 *
 * @param rows the stopped rows this pass
 * @param repairTaken recipe id → the row slug a live repair take names
 * @param repairTakenIso recipe id → when that take was recorded
 * @returns the owner of every owned row, and the instant each was taken
 */
export function mergeHeldStops({
  rows,
  repairTaken,
  repairTakenIso,
}: {
  rows: readonly SilentRow[];
  repairTaken: ReadonlyMap<string, string>;
  repairTakenIso: ReadonlyMap<string, string>;
}): { readonly taken: ReadonlyMap<string, string>; readonly takenIso: ReadonlyMap<string, string> } {
  const taken = new Map(repairTaken);
  const takenIso = new Map(repairTakenIso);
  const unheld = new Set(rows.filter((row) => row.currentSlotHold === null).map((row) => row.recipeId));
  for (const row of rows) {
    if (row.currentSlotHold === null || repairTaken.has(row.recipeId) || unheld.has(row.recipeId)) {
      continue;
    }
    if (!taken.has(row.recipeId)) {
      taken.set(row.recipeId, row.currentSlotHold.holder);
      takenIso.set(row.recipeId, row.currentSlotHold.startedAtIso);
    }
  }
  return { taken, takenIso };
}

/**
 * Evaluate one of the three stopped-row monitors off the pass's shared reads.
 *
 * Three answers are `unmeasurable` rather than `clear`, because each is a way of not having looked: run stamps
 * that will not open, a definition file that will not parse (the row it holds may be the silent one), and no
 * definition on disk at all — a renamed or emptied directory must not read as every row posting, and settle
 * every open card on the way. A roster that parsed but whose rows are all disabled or held IS a real answer:
 * the owner retired them, and nothing live has stopped.
 */
function readStoppedRows({
  reading,
  monitorId,
  evaluate,
  repairs,
}: {
  reading: ReturnType<typeof readSilentRecipeRows>;
  monitorId: StoppedMonitorId;
  evaluate: (options: {
    rows: readonly SilentRow[];
    taken: ReadonlyMap<string, string>;
    takenIso: ReadonlyMap<string, string>;
  }) => MonitorReading;
  repairs: RepairsReading;
}): MonitorReading {
  const judged = readStoppedRowsTaken({
    evaluate: (rows) =>
      evaluate({ rows, ...mergeHeldStops({ repairTaken: repairs.taken, repairTakenIso: repairs.takenIso, rows }) }),
    monitorId,
    reading,
  });
  if (monitorId !== "recipe-repairing" || repairs.problem === undefined) {
    return judged;
  }
  // Only the notice monitor reads the register as its SUBJECT; the loud two fall to "untaken", which is loud.
  if (judged.state === "firing") {
    return { ...judged, blindSpot: repairs.problem };
  }
  return { because: repairs.problem, monitorId, state: "unmeasurable" };
}

/** {@link readStoppedRows}' shared half: the stamps, the definitions and the rows, before the register is weighed. */
function readStoppedRowsTaken({
  reading,
  monitorId,
  evaluate,
}: {
  reading: ReturnType<typeof readSilentRecipeRows>;
  monitorId: StoppedMonitorId;
  evaluate: (rows: readonly SilentRow[]) => MonitorReading;
}): MonitorReading {
  if (reading.isErr()) {
    const because = `the recipe run stamps could not be read: ${reading.error.join("; ")}`;
    return { because, monitorId, state: "unmeasurable" };
  }
  const { definitions, rejected, silent } = reading.value;
  if (rejected.length > 0) {
    const because = `${String(rejected.length)} recipe definition file(s) could not be parsed, so a stopped row may be invisible — ${rejected.join("; ")}`;
    const seen = evaluate(silent);
    if (seen.state === "firing") {
      return { ...seen, blindSpot: because };
    }
    return { because, monitorId, state: "unmeasurable" };
  }
  if (definitions === 0) {
    const because = "no recipe definition is on disk under this home, so there is no standing row to watch";
    return { because, monitorId, state: "unmeasurable" };
  }
  return evaluate(silent);
}

/**
 * The three stopped-row monitors' reads, in the registry's order, each a thunk sharing one memoised read of the
 * rows and one of the repairs register. `recipe-stopped` and `recipe-repairing`, fired every supervisor tick, also
 * read the hand register for the sets the owner closed themselves, and hold those (`./heldKeys.ts` § `readClosedByOwner`).
 *
 * @param home the Slopweaver home
 * @param nowIso the instant the recipe calculus judges at
 * @returns one read per stopped-row monitor
 */
export function stoppedRowReads({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): readonly { readonly id: MonitorId; readonly read: () => MonitorReading }[] {
  let stoppedRows: ReturnType<typeof readSilentRecipeRows> | undefined;
  const stopped = (): ReturnType<typeof readSilentRecipeRows> => {
    if (stoppedRows !== undefined) {
      return stoppedRows;
    }
    stoppedRows = readSilentRecipeRows({ home, nowIso });
    return stoppedRows;
  };
  let repairsRead: RepairsReading | undefined;
  const repairs = (): RepairsReading => {
    if (repairsRead !== undefined) {
      return repairsRead;
    }
    const rows = stopped();
    // Stamps that will not read leave every stopped-row monitor unmeasurable, so no take is worth reading.
    const ids = rows.isOk() ? rows.value.silent.map((row) => row.recipeId) : [];
    repairsRead = readRepairs({ home, stopped: new Set(ids) });
    return repairsRead;
  };
  const entries: readonly {
    readonly id: StoppedMonitorId;
    readonly evaluate: (options: {
      rows: readonly SilentRow[];
      taken: ReadonlyMap<string, string>;
      takenIso: ReadonlyMap<string, string>;
      closed: ReadonlyMap<string, string>;
    }) => MonitorReading;
  }[] = [
    { evaluate: evaluateRecipeStopped, id: "recipe-stopped" },
    { evaluate: evaluateRecipeRepairing, id: "recipe-repairing" },
    { evaluate: evaluateCorpusSyncStopped, id: "corpus-sync-stopped" },
  ];
  return entries.map(({ evaluate, id }) => ({
    id,
    read: () => {
      // `corpus-sync-stopped` holds nothing the owner closed: it is not fired on the supervisor's tick.
      const closed =
        id === "corpus-sync-stopped"
          ? ok<ReadonlyMap<string, string>, string>(new Map())
          : readClosedByOwner({ definition: monitorDefinition({ monitorId: id }), home });
      if (closed.isErr()) {
        // Without the card history a set the owner closed would be re-posted over their Done, so the pass answers nothing.
        return { because: closed.error, monitorId: id, state: "unmeasurable" };
      }
      return readStoppedRows({
        evaluate: (options) => evaluate({ ...options, closed: closed.value }),
        monitorId: id,
        reading: stopped(),
        repairs: repairs(),
      });
    },
  }));
}
