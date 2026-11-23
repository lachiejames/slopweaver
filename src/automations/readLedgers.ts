/**
 * The ledgers the Automations page reads, each listed or read ONCE per status read: the slot ledger, the definitions
 * directory's own listing, the run stamps, and the sync-run ledger. The effectful half `./read.ts` joins into cards.
 *
 * **An unreadable store is said, never read as empty.** Each reader here returns what it read AND, when it could not
 * read all of it, the reason — pushed onto the report's `issues` and carried to every card that would otherwise
 * read the absence as "nothing happened".
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { readFileIfPresent } from "../atlas/atlasFile.js";
import { liveRefreshes } from "../corpus/refreshSlot.js";
import { BRONZE_SOURCES } from "../integrations/corpusSources.js";
import { isOneOf } from "../lib/parsers.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { type RecipeDefinitionRuns, readRecipeDefinitionRuns } from "../live/automation/definitionRunStore.js";
import type { ProcessAlive } from "../live/automation/holderLiveness.js";
import type { RecipeSlotAttempt } from "../live/automation/slotAttempt.js";
import { attemptOf } from "../live/automation/slotAttemptCodec.js";
import { slotAttemptKey } from "../live/automation/slotLedger.js";
import { stateHomePaths } from "../stateHome.js";
import { foldSyncRun, type SyncRunView } from "../syncRun/fold.js";
import { readRecentSyncRuns } from "../syncRun/store.js";

/** How many of a source's newest sync runs the page carries. */
const SYNC_RUNS_SHOWN = 5;

/** The edges a read needs from the machine. */
export interface AutomationsReadDeps {
  /** Whether a slot holder's pid runs — `recipeHolderAlive` in production. */
  readonly processAlive: ProcessAlive;
  /** Whether the run that started at `startedAtIso` as `pid` still holds `source`'s refresh slot. */
  readonly holdsSlot: (args: { pid: number; source: string; startedAtIso: string }) => boolean;
}

/**
 * Whether one of a source's live slot holders is the run that wrote a ledger: the same pid, holding a slot taken
 * no later than the run started. Refresh takes the slot before it writes its `started` row, so a holder whose slot
 * is NEWER than the run is a recycled pid refreshing the same source, and the old run is dead.
 *
 * @param holders the source's live slot holders
 * @param pid the pid the run's `started` row names
 * @param startedAtIso when the run wrote its `started` row
 * @returns whether that run still holds the slot
 */
export function slotHeldByRun({
  holders,
  pid,
  startedAtIso,
}: {
  holders: readonly { readonly pid: number; readonly startedAtIso: string }[];
  pid: number;
  startedAtIso: string;
}): boolean {
  const runStart = Date.parse(startedAtIso);
  return holders.some((holder) => holder.pid === pid && Date.parse(holder.startedAtIso) <= runStart);
}

/**
 * The production slot probe: the machine-wide refresh slot, read without taking it.
 *
 * @returns the probe
 */
export function productionHoldsSlot(): AutomationsReadDeps["holdsSlot"] {
  return ({ pid, source, startedAtIso }) => {
    if (!isOneOf(source, BRONZE_SOURCES)) {
      return false;
    }
    return slotHeldByRun({ holders: liveRefreshes({ sources: [source] }), pid, startedAtIso });
  };
}

/** Whether a thrown filesystem error says the path is not there — an absent store, as opposed to an unreadable one. */
function isAbsent({ error }: { error: unknown }): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** One slot ledger file decoded, or `undefined` when it would not read, parse or decode. */
function decodeAttemptFile({ directory, name }: { directory: string; name: string }): RecipeSlotAttempt | undefined {
  const raw = readFileIfPresent({ path: join(directory, name) });
  if (raw.isErr() || raw.value === null) {
    return undefined;
  }
  try {
    return attemptOf({ value: safeJsonParse({ label: name, text: raw.value }) });
  } catch {
    return undefined;
  }
}

/**
 * Whether a decoded row is one the scheduler could have written, so every verb keyed by it finds the same row. Its
 * slot is a canonical ISO instant — `--help` there would turn the printed `automation explain` into its usage — its attempt a whole number from 1, which prints as the digits `automation explain --attempt`
 * accepts, and its file is named for its own recipe and slot, the only name `readSlotAttempt` looks under.
 * Anything else is a gap, not a firing.
 */
function asTheSchedulerWrites({ attempt, name }: { attempt: RecipeSlotAttempt; name: string }): boolean {
  const at = Date.parse(attempt.slotIso);
  return (
    Number.isSafeInteger(attempt.attempt) &&
    attempt.attempt >= 1 &&
    !Number.isNaN(at) &&
    new Date(at).toISOString() === attempt.slotIso &&
    name === `${slotAttemptKey({ recipeId: attempt.recipeId, slotIso: attempt.slotIso })}.json`
  );
}

/**
 * Every firing row in the ledger, grouped by recipe — one directory listing, one small file per firing — and, when
 * the ledger would not list or a file in it would not decode, the gap every card must say rather than read as empty.
 *
 * @param home the state home
 * @param issues where the gap is said
 * @returns the firings by recipe id, and the gap or `null`
 */
export function readAllAttempts({ home, issues }: { home: string; issues: string[] }): {
  byRecipe: Map<string, RecipeSlotAttempt[]>;
  gap: string | null;
} {
  const directory = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
  const byRecipe = new Map<string, RecipeSlotAttempt[]>();
  let names: readonly string[];
  // Typed, so an entry that is not a regular file — a FIFO would block the read forever — is never opened, and counts
  // as one that did not decode.
  let irregular = 0;
  try {
    const entries = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.name.endsWith(".json"));
    names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    irregular = entries.length - names.length;
  } catch (error: unknown) {
    if (isAbsent({ error })) {
      return { byRecipe, gap: null };
    }
    const gap = `the slot ledger at ${directory} will not list (${String(error)}), so no firing history can be read`;
    issues.push(gap);
    return { byRecipe, gap };
  }
  let corrupt = irregular;
  for (const name of names) {
    const attempt = decodeAttemptFile({ directory, name });
    if (attempt === undefined || !asTheSchedulerWrites({ attempt, name })) {
      corrupt += 1;
      continue;
    }
    const list = byRecipe.get(attempt.recipeId);
    if (list === undefined) {
      byRecipe.set(attempt.recipeId, [attempt]);
    } else {
      list.push(attempt);
    }
  }
  if (corrupt === 0) {
    return { byRecipe, gap: null };
  }
  const gap = `${String(corrupt)} slot ledger file(s) under ${directory} did not decode, so the firings they record are missing from every card`;
  issues.push(gap);
  return { byRecipe, gap };
}

/**
 * The definitions directory's own readability — the shared loader reads an unlistable one as empty.
 *
 * @param home the state home
 * @returns why the directory will not list, or `null` when it lists or is absent
 */
export function definitionsDirIssue({ home }: { home: string }): string | null {
  const directory = stateHomePaths({ home }).live.recipe.definitionsDir;
  try {
    readdirSync(directory);
  } catch (error: unknown) {
    if (isAbsent({ error })) {
      return null;
    }
    return `the recipe definitions at ${directory} will not list (${String(error)}), so every automation is missing from this page`;
  }
  return null;
}

/**
 * The newest runs of one source, folded, and why they would not read — said as an issue AND carried to the card.
 *
 * @param home the state home
 * @param source the corpus source
 * @param nowIso the instant elapsed and quiet time are measured to
 * @param deps the slot probe
 * @param issues where an unreadable ledger is said
 * @returns the runs, newest first, and the gap or `null`
 */
export function syncRunsOf({
  home,
  source,
  nowIso,
  deps,
  issues,
}: {
  home: string;
  source: string;
  nowIso: string;
  deps: AutomationsReadDeps;
  issues: string[];
}): { runs: SyncRunView[]; gap: string | null } {
  const stored = readRecentSyncRuns({ home, limit: SYNC_RUNS_SHOWN, source });
  if (stored.isErr()) {
    for (const line of stored.error) {
      issues.push(line);
    }
    return { gap: stored.error.join("; "), runs: [] };
  }
  const runs = stored.value.map((run) =>
    foldSyncRun({
      events: run.events,
      holdsSlot: deps.holdsSlot,
      malformedLines: run.malformedLines,
      nowIso,
      runId: run.runId,
      source: run.source,
    }),
  );
  return { gap: null, runs };
}

/**
 * The sources that have a sync-run directory, whatever their scheduling. An absent root is a home that has not
 * refreshed on this build; any other listing failure is said, because an empty list would hide every hand-run sync.
 *
 * @param home the state home
 * @param issues where an unlistable ledger is said
 * @returns the source names, sorted
 */
export function ledgerSources({ home, issues }: { home: string; issues: string[] }): readonly string[] {
  const root = stateHomePaths({ home }).live.syncRunsDir;
  try {
    return readdirSync(root).toSorted();
  } catch (error: unknown) {
    if (!isAbsent({ error })) {
      issues.push(
        `the sync-run ledger at ${root} will not list (${String(error)}), so no sync a scheduled row does not cover is shown`,
      );
    }
    return [];
  }
}

/**
 * The stored run stamps, or `null` with the reason said — every row then reads as never run and none as stopped.
 *
 * @param home the state home
 * @param issues where an unreadable store is said
 * @returns the run stamps and whether they read — none when they would not, so every row then reads as never run
 */
export function runsOrIssue({ home, issues }: { home: string; issues: string[] }): {
  read: boolean;
  runs: RecipeDefinitionRuns;
} {
  const runs = readRecipeDefinitionRuns({ path: stateHomePaths({ home }).live.recipe.definitionRunsJson });
  if (runs.isErr()) {
    for (const line of runs.error) {
      issues.push(`${line} — every row reads as never run, and none can be read as stopped`);
    }
    return { read: false, runs: {} };
  }
  return { read: true, runs: runs.value };
}
