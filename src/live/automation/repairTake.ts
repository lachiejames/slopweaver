/**
 * THE REPAIRS REGISTER — which seat has taken a stopped recipe, so the recipe-stopped monitor can tell a stop
 * being fixed from a stop nobody has.
 *
 * The owner learns via a floating card when a job has stopped working but is being fixed; it does not show up as
 * a queue card, or as something blocked on the owner, or as a silent stop. Nothing on disk linked a stopped recipe to the seat repairing it, so a seat says so:
 * `slopweaver automation repair <recipe-id> --row <slug>` appends one take here.
 *
 * **A stop is TAKEN iff a take for its recipe names a row that is still non-terminal AND whose run a seat has
 * started and not closed.** The seat is named by that row's slug — the one handle a reader can check in one command. A row that
 * finished, or a run that closed, releases the take by itself; nothing ever edits a line.
 *
 * **An unreadable register reads as NOTHING TAKEN**, never as everything taken: an untaken stop is loud, and
 * the loud side is the safe one to fall to. The caller says the register was unreadable beside it.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { isTerminalDocStatus } from "../../handover/doc.js";
import { runStateOf } from "../../handover/ledger.js";
import { readDerivedRowState } from "../../handover/rowState.js";
import { readRunJournal } from "../../handover/runStore.js";
import { stateHomePaths } from "../../stateHome.js";
import { type RecipeError, RecipeErrors } from "./errors.js";

/** Owner-only, like every register beside it. */
const DIR_MODE = 0o700;

/** One seat saying it has taken a stopped recipe's repair. */
export interface RepairTake {
  /** The recipe that stopped firing. */
  readonly recipeId: string;
  /** The board row whose seat is repairing it — what names the seat. */
  readonly row: string;
  /** When the take was written. */
  readonly takenIso: string;
}

/**
 * Read one register line's value as a take, or nothing when it is not one.
 *
 * @param value one decoded JSONL line
 * @returns the take, or `undefined` when a field is missing or not a non-empty string
 */
export function parseRepairTake({ value }: { value: unknown }): RepairTake | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { recipeId, row, takenIso } = value;
  if (!isFilled(recipeId) || !isFilled(row) || !isFilled(takenIso)) {
    return undefined;
  }
  return { recipeId, row, takenIso };
}

/** Whether a field is a non-empty string. */
function isFilled(field: unknown): field is string {
  return typeof field === "string" && field.length > 0;
}

/**
 * Append one take.
 *
 * @param home the Slopweaver home the register lives under
 * @param take the take to write
 * @returns ok, or why the append failed
 */
export function appendRepairTake({ home, take }: { home: string; take: RepairTake }): Result<void, RecipeError> {
  const path = stateHomePaths({ home }).live.recipe.repairsJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ path, text: `${safeJsonStringify({ label: "an automation repair take", value: take })}\n` });
  } catch (error: unknown) {
    return err(RecipeErrors.repairsFileUnwritable({ detail: String(error), path }));
  }
  return ok(undefined);
}

/**
 * Every take in the register, oldest first, and the 1-based numbers of the lines that did not read as one.
 *
 * A missing file is an empty register — no seat has ever taken a repair. A line that will not parse is counted
 * rather than failing the read, so one torn append never hides every good take.
 *
 * @param home the Slopweaver home the register lives under
 * @returns the takes and the unparsed line numbers, or why the file could not be read at all
 */
export function readRepairTakes({
  home,
}: {
  home: string;
}): Result<{ readonly takes: readonly RepairTake[]; readonly unparsed: readonly number[] }, RecipeError> {
  const path = stateHomePaths({ home }).live.recipe.repairsJsonl;
  if (!existsSync(path)) {
    return ok({ takes: [], unparsed: [] });
  }
  const takes: RepairTake[] = [];
  const unparsed: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        let value: unknown;
        try {
          value = safeJsonParse({ label: "an automation repair take", text: line });
        } catch {
          unparsed.push(index + 1);
          return;
        }
        const take = parseRepairTake({ value });
        if (take === undefined) {
          unparsed.push(index + 1);
          return;
        }
        takes.push(take);
      },
      path,
    });
  } catch (error: unknown) {
    return err(RecipeErrors.repairsFileUnreadable({ detail: String(error), path }));
  }
  return ok({ takes, unparsed });
}

/**
 * Which row is repairing each taken recipe — the newest take per recipe whose row is still live.
 *
 * Pure: whether a row is live is decided by the caller and passed in, so the choice here is only which take
 * wins. A later take for the same recipe wins while its row is live; an older take whose row is still live
 * stands in when the newer one's row has finished.
 *
 * @param takes every take, in register order
 * @param liveRows the rows known to be non-terminal with an open run
 * @returns recipe id → the row slug repairing it
 */
export function repairingRows({
  takes,
  liveRows,
}: {
  takes: readonly RepairTake[];
  liveRows: ReadonlySet<string>;
}): ReadonlyMap<string, string> {
  return new Map([...winningTakes({ liveRows, takes })].map(([recipeId, take]) => [recipeId, take.row]));
}

/**
 * When each taken recipe's winning take was recorded — the same take {@link repairingRows} picks — so a take made
 * after the owner closed a repairing note re-opens it, as a run does.
 *
 * @param takes every take, in register order
 * @param liveRows the rows known to be non-terminal with an open run
 * @returns recipe id → when the take repairing it was recorded
 */
export function repairingTakeIsos({
  takes,
  liveRows,
}: {
  takes: readonly RepairTake[];
  liveRows: ReadonlySet<string>;
}): ReadonlyMap<string, string> {
  return new Map([...winningTakes({ liveRows, takes })].map(([recipeId, take]) => [recipeId, take.takenIso]));
}

/**
 * The newest take per recipe whose row is still live, by instant rather than by text — a stamp written with an offset
 * sorts wrong as a string. A stamp that will not read loses no tie: the later line wins.
 */
function winningTakes({
  takes,
  liveRows,
}: {
  takes: readonly RepairTake[];
  liveRows: ReadonlySet<string>;
}): ReadonlyMap<string, RepairTake> {
  const seats = new Map<string, RepairTake>();
  takes
    .filter((take) => liveRows.has(take.row))
    .forEach((take) => {
      const prior = seats.get(take.recipeId);
      if (prior === undefined || !(Date.parse(take.takenIso) < Date.parse(prior.takenIso))) {
        seats.set(take.recipeId, take);
      }
    });
  return seats;
}

/** Why a row cannot hold a repair take. */
export type RepairRowRefusal =
  | { readonly kind: "terminal"; readonly status: string }
  | { readonly kind: "run-not-started" }
  | { readonly kind: "run-not-open"; readonly phase: string }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Whether one row can be repairing a recipe right now: it reads whole, its derived status is not terminal, and
 * a seat has started its run and not closed it. Reads that row's doc and journal only, never the board.
 *
 * @param home the Slopweaver home the board lives under
 * @param slug the row to judge
 * @returns ok when live, or why not
 */
export function repairRowLiveness({ home, slug }: { home: string; slug: string }): Result<void, RepairRowRefusal> {
  const paths = stateHomePaths({ home });
  const state = readDerivedRowState({ handoverDir: paths.handovers, runsDir: paths.runs, slug });
  if (state.isErr()) {
    return err({ kind: "unreadable", why: state.error.message });
  }
  if (isTerminalDocStatus(state.value.status)) {
    return err({ kind: "terminal", status: state.value.status });
  }
  const journal = readRunJournal({ runsDir: paths.runs, slug });
  if (journal.isErr()) {
    return err({ kind: "unreadable", why: journal.error.message });
  }
  const run = runStateOf({ events: journal.value.events });
  if (run.entries === 0) {
    return err({ kind: "run-not-started" });
  }
  if (run.phase === "closed") {
    return err({ kind: "run-not-open", phase: run.phase });
  }
  return ok(undefined);
}

/**
 * The rows among the takes that are live right now — each distinct row read once.
 *
 * A row that did not read is left out, so its recipe reads untaken and stays loud; its reason is returned so
 * the caller can say why.
 *
 * @param home the Slopweaver home the board lives under
 * @param takes every take
 * @returns the live rows, and one line per row that did not read
 */
export function liveRepairRows({ home, takes }: { home: string; takes: readonly RepairTake[] }): {
  readonly live: ReadonlySet<string>;
  readonly problems: readonly string[];
} {
  const live = new Set<string>();
  const problems: string[] = [];
  new Set(takes.map((take) => take.row)).forEach((slug) => {
    const read = repairRowLiveness({ home, slug });
    if (read.isOk()) {
      live.add(slug);
      return;
    }
    if (read.error.kind === "unreadable") {
      problems.push(`repair row ${slug}: ${read.error.why}`);
    }
  });
  return { live, problems };
}
