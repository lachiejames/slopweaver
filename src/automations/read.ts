/**
 * Read every store the Automations page draws on, once, and fold them into its report.
 *
 * The effectful shell around `./card.ts` and `../syncRun/fold.ts`, joining what `./readLedgers.ts` and
 * `./readOutputs.ts` read. Read-only: it takes no lock, writes nothing and reaches no network, so the console can
 * poll it.
 *
 * **An unreadable store is said, never read as empty.** A definitions directory that will not list, a slot file that
 * will not decode, a resync record that is corrupt: each becomes a line in `issues`, because "no rows" and "healthy"
 * are exactly the readings an unreadable store would otherwise produce, and both are the silent failure this page
 * exists to end. A definition file that is there and will not parse has no recipe id to hang a card on, so it gets
 * its own entry in `rejected`, named by its file.
 */
import { loadAuditedRecipeDefinitions } from "../live/automation/auditedDefinitionStore.js";
import type { RecipeDefinition } from "../live/automation/definition.js";
import { judgeRecipeDefinitions, type RecipeDueVerdict } from "../live/automation/definitionDue.js";
import { lastRecipeRun, type RecipeDefinitionRuns } from "../live/automation/definitionRunStore.js";
import { nextFiringAfter } from "../live/automation/firingCalculus.js";
import { holderAliveFor } from "../live/automation/holderLiveness.js";
import { findRecipeKind } from "../live/automation/kinds.js";
import { judgeSlotAttempt, type RecipeSlotAttempt, type RecipeSlotVerdict } from "../live/automation/slotAttempt.js";
import { readAllResyncState } from "../live/resync/outcomeStore.js";
import { stateHomePaths } from "../stateHome.js";
import type { SyncRunView } from "../syncRun/fold.js";
import type { AtlasQuestions } from "./atlasQuestions.js";
import { type AutomationCard, automationCard } from "./card.js";
import { explanationsOf, explanationsOrIssue } from "./cardExplanations.js";
import { purposeOf } from "./purpose.js";
import {
  type AutomationsReadDeps,
  definitionsDirIssue,
  ledgerSources,
  readAllAttempts,
  runsOrIssue,
  syncRunsOf,
} from "./readLedgers.js";
import { notesByActor, outputsAndSteering, readingsByActor } from "./readOutputs.js";
import { silentAmong } from "./readSilent.js";
import { steersByRecipe } from "./readSteers.js";
import { corpusSourceOf } from "./rowAsks.js";

/** A corpus source's newest sync runs, for a source no scheduled row covers — a refresh run by hand. */
interface UnscheduledSync {
  readonly source: string;
  readonly runs: readonly SyncRunView[];
}

/** Everything the Automations page shows. */
export interface AutomationsReport {
  readonly observedAtIso: string;
  readonly cards: readonly AutomationCard[];
  /** Definition files that are there and could not become a row. */
  readonly rejected: readonly { readonly file: string; readonly why: string }[];
  /** Stores that could not be read, in words — never folded into an empty or healthy reading. */
  readonly issues: readonly string[];
  /**
   * Why the definitions directory would not list, or `null` when it listed — set, the page says its counts are
   * unread rather than drawing an unreadable roster as zero scheduled.
   */
  readonly rosterGap: string | null;
  readonly unscheduledSyncs: readonly UnscheduledSync[];
}

/**
 * Why the roster may be missing rows, said as an issue too. The loader reads an unlistable directory as empty, so
 * only an empty roster needs the second listing that tells "no rows" from "could not look" — a roster with any row
 * in it proves the directory listed.
 */
function rosterGapOf({
  home,
  issues,
  roster,
}: {
  home: string;
  issues: string[];
  roster: { definitions: readonly unknown[]; rejected: readonly unknown[] };
}): string | null {
  if (roster.definitions.length > 0 || roster.rejected.length > 0) {
    return null;
  }
  const dirIssue = definitionsDirIssue({ home });
  if (dirIssue !== null) {
    issues.push(dirIssue);
  }
  return dirIssue;
}

/** One row's firings out of the slot ledger read once for every card; a row that never fired has none. */
function attemptsOf({
  attempts,
  recipeId,
}: {
  attempts: ReadonlyMap<string, readonly RecipeSlotAttempt[]>;
  recipeId: string;
}): readonly RecipeSlotAttempt[] {
  const mine = attempts.get(recipeId);
  if (mine === undefined) {
    return [];
  }
  return mine;
}

/**
 * Each source's newest runs, read on first ask and served from memory after, so a source shared by two cards is
 * read once — and `read` names every source a card already covers, which a hand-run sync then is not.
 */
function syncRunsReader({
  deps,
  home,
  issues,
  nowIso,
}: {
  deps: AutomationsReadDeps;
  home: string;
  issues: string[];
  nowIso: string;
}): {
  once: (args: { source: string }) => { runs: SyncRunView[]; gap: string | null };
  read: ReadonlyMap<string, unknown>;
} {
  const read = new Map<string, { runs: SyncRunView[]; gap: string | null }>();
  const once = ({ source }: { source: string }): { runs: SyncRunView[]; gap: string | null } => {
    const known = read.get(source);
    if (known !== undefined) {
      return known;
    }
    const fresh = syncRunsOf({ deps, home, issues, nowIso, source });
    read.set(source, fresh);
    return fresh;
  };
  return { once, read };
}

/** A row's corpus source's newest runs as its card's two sync fields — none, and no gap, when it syncs nothing. */
function cardSyncRunsOf({
  definition,
  syncRuns,
}: {
  definition: RecipeDefinition;
  syncRuns: ReturnType<typeof syncRunsReader>;
}): { syncRuns: SyncRunView[]; syncRunsGap: string | null } {
  const source = corpusSourceOf({ definition });
  if (source === null) {
    return { syncRuns: [], syncRunsGap: null };
  }
  const read = syncRuns.once({ source });
  return { syncRuns: read.runs, syncRunsGap: read.gap };
}

/** Every store the cards share, each read once for the whole call; an unreadable one is said into `issues`. */
function sharedStoresOf({
  definitions,
  deps,
  home,
  issues,
  nowIso,
}: {
  definitions: readonly RecipeDefinition[];
  deps: AutomationsReadDeps;
  home: string;
  issues: string[];
  nowIso: string;
}): {
  attempts: ReturnType<typeof readAllAttempts>["byRecipe"];
  explanations: ReadonlyMap<string, ReadonlyMap<string, string>>;
  firingsGap: string | null;
  runsGap: string | null;
  notes: ReturnType<typeof notesByActor>;
  readings: ReturnType<typeof readingsByActor>;
  resync: ReturnType<typeof readAllResyncState>;
  runs: RecipeDefinitionRuns;
  silent: ReturnType<typeof silentAmong>;
  steers: ReturnType<typeof steersByRecipe>;
  verdicts: readonly RecipeDueVerdict[];
} {
  const { read: runsRead, runs } = runsOrIssue({ home, issues });
  const verdicts = judgeRecipeDefinitions({
    definitions,
    nowIso,
    runFor: ({ recipeId }) => lastRecipeRun({ recipeId, runs }),
  });
  const { byRecipe: attempts, gap: firingsGap } = readAllAttempts({ home, issues });
  const silent = silentAmong({
    attempts,
    definitions,
    home,
    issues,
    nowIso,
    processAlive: deps.processAlive,
    runs,
    runsRead,
  });
  const resync = readAllResyncState({ stateDir: stateHomePaths({ home }).live.recipe.resyncStateDir });
  for (const error of resync.corrupt) {
    issues.push(error.message);
  }
  const readings = readingsByActor({ home, issues });
  const notes = notesByActor({ home, issues });
  const steers = steersByRecipe({ home, issues });
  const explanations = explanationsOrIssue({ home, issues });
  let runsGap: string | null = null;
  if (!runsRead) {
    runsGap = "the run stamps file did not read";
  }
  return { attempts, explanations, firingsGap, notes, readings, resync, runs, runsGap, silent, steers, verdicts };
}

/** The scheduler's verdict on a row's newest firing, or `null` when it has none on disk. */
function newestSlotVerdict({
  deps,
  firings,
  nowIso,
}: {
  deps: AutomationsReadDeps;
  firings: readonly RecipeSlotAttempt[];
  nowIso: string;
}): RecipeSlotVerdict | null {
  const stored = firings.toSorted((a, b) => b.slotIso.localeCompare(a.slotIso))[0];
  if (stored === undefined) {
    return null;
  }
  return judgeSlotAttempt({ holderAlive: holderAliveFor({ processAlive: deps.processAlive, stored }), nowIso, stored });
}

/** One row's card, folded from the stores every card shares and the row's own definition file. */
function cardOf({
  atlas,
  definition,
  deps,
  file,
  home,
  index,
  nowIso,
  shared,
  syncRuns,
}: {
  atlas: AtlasQuestions;
  definition: RecipeDefinition;
  deps: AutomationsReadDeps;
  file: Parameters<typeof outputsAndSteering>[0]["file"];
  home: string;
  index: number;
  nowIso: string;
  shared: ReturnType<typeof sharedStoresOf>;
  syncRuns: ReturnType<typeof syncRunsReader>;
}): AutomationCard {
  const { attempts, explanations, firingsGap, notes, readings, resync, runs, runsGap, silent, steers, verdicts } =
    shared;
  const firings = attemptsOf({ attempts, recipeId: definition.recipeId });
  const verdict = verdicts[index]!;
  return automationCard({
    attempts: firings,
    definition,
    explanations: explanationsOf({ explanations, recipeId: definition.recipeId }),
    firingsGap,
    kindSummary: kindSummaryOf({ kind: definition.kind }),
    nowIso,
    ...outputsAndSteering({
      definition,
      file,
      firings,
      home,
      nextFiringIso: nextFiringOf({ definition, nowIso, verdict }),
      notes,
      readings,
      steers,
    }),
    purpose: purposeOf({ atlasQuestions: atlas.questions, definition }),
    resync: resync.states.get(definition.recipeId),
    run: runs[definition.recipeId],
    runsGap,
    silent: silent.get(definition.recipeId),
    slotVerdict: newestSlotVerdict({ deps, firings, nowIso }),
    ...cardSyncRunsOf({ definition, syncRuns }),
    verdict,
  });
}

/**
 * Read one home's automations and syncs into the Automations report.
 *
 * @param home the Slopweaver home
 * @param nowIso the instant every reading is made at
 * @param deps the liveness probes
 * @param atlas each atlas's question, loaded by `./atlasQuestions.ts`, which names an atlas refresh's purpose
 * @returns the report
 */
export function readAutomations({
  home,
  nowIso,
  deps,
  atlas,
}: {
  home: string;
  nowIso: string;
  deps: AutomationsReadDeps;
  atlas: AtlasQuestions;
}): AutomationsReport {
  const issues: string[] = [...atlas.issues];
  const roster = loadAuditedRecipeDefinitions({ home });
  const rosterGap = rosterGapOf({ home, issues, roster });
  const shared = sharedStoresOf({ definitions: roster.definitions, deps, home, issues, nowIso });
  const syncRuns = syncRunsReader({ deps, home, issues, nowIso });
  const cards = roster.definitions.map((definition, index) =>
    cardOf({ atlas, definition, deps, file: roster.definitionFiles[index]!, home, index, nowIso, shared, syncRuns }),
  );
  const unscheduledSyncs = ledgerSources({ home, issues })
    .filter((source) => !syncRuns.read.has(source))
    .map((source) => ({ runs: syncRuns.once({ source }).runs, source }));
  return {
    cards,
    observedAtIso: nowIso,
    issues,
    rejected: roster.rejected.map((rejection) => ({ file: rejection.file, why: rejection.error.message })),
    rosterGap,
    unscheduledSyncs,
  };
}

/** When a row next fires on its own cadence — `null` while it is off, or when its cadence will not read. */
function nextFiringOf({
  definition,
  verdict,
  nowIso,
}: {
  definition: RecipeDefinition;
  verdict: RecipeDueVerdict;
  nowIso: string;
}): string | null {
  if (verdict.offReason !== undefined) {
    return null;
  }
  const next = nextFiringAfter({ cadence: definition.cadence, nowIso });
  return typeof next === "string" ? next : null;
}

/** A kind's summary, or `null` for a kind this build does not register. */
function kindSummaryOf({ kind }: { kind: string }): string | null {
  const found = findRecipeKind({ kind });
  return found === undefined ? null : found.summary;
}
