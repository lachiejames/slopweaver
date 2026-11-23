/**
 * The five answers a broken or paused automation owes the owner: why it is broken, since when, who
 * fixes it and where that fix stands, what is worse while it is down, and what runs instead. Pure, and plain words
 * only — every instant is carried as an ISO field for the page to say in the owner's own clock, never baked into a sentence.
 *
 * **It never promises.** Nothing here says a session is "looking into it now" (no status record carries liveness) or
 * that a fix "will" land: the fix is said as the stage its board row is in (`./brokenWhy.ts`), and the scheduler as
 * what it will NOT do.
 */
import type { RecipeDefinitionRun } from "../live/automation/definitionRunStore.js";
import { ownerHoldIsOwners } from "../live/automation/ownerHoldPlacedBy.js";
import type { SilentRow } from "../live/automation/silentRows.js";
import type { RecipeSlotVerdict } from "../live/automation/slotAttempt.js";
import type { ResyncState } from "../live/resync/outcome.js";
import type { SyncRunView } from "../syncRun/fold.js";
import { type FixAccount, fixStageAccount, unheldAccount } from "./brokenWhy.js";
import type { FiringView } from "./card.js";
import type { AutomationHealth, StandingHold } from "./health.js";
import { ownerHoldAccount, worseOf } from "./ownerHoldAccount.js";
import { endedSyncsOf, plainlyOf, syncEndMs } from "./plainly.js";
import type { AutomationPurpose } from "./purpose.js";
import { finishedBySettleOf, wroteRunStampOf } from "./runStats.js";
import { saidPlainlyOf } from "./saidPlainly.js";

/** How fresh a sync's copy is: its last complete run, and the newest run that still stored rows. */
interface Freshness {
  readonly lastCompleteIso: string | null;
  readonly newestRowsIso: string | null;
}

/** The five answers for one broken or paused automation. */
export interface BrokenAccount {
  readonly state: "broken" | "paused";
  /** Why, in one plain sentence. */
  readonly why: string;
  /**
   * What went wrong with the run that finished last, and what would fix it, in one plain sentence: the one the visible
   * session that ran it recorded about that exact firing (`automation explain`) — the sentence the row leads with.
   * `null` when that run did not fail or no session explained it: the row then leads with {@link why}, never a guess.
   */
  readonly plainly: string | null;
  /**
   * What the failing run said, as short as the record allows: the service's own `message` when its error carried
   * one, else the run's own reason. Never a paraphrase — a guess at a cause reads exactly like a cause.
   */
  readonly said: string | null;
  /**
   * The record behind the answers, verbatim and technical — the failing run's own reason, or what the scheduler and
   * the supervisor recorded about a row that stopped — for the fold beneath them, or `null` when there is none.
   */
  readonly detail: string | null;
  /** When the current break began — the first failure after the last success — or the pause was put on. */
  readonly sinceIso: string | null;
  /** When it last worked. */
  readonly lastWorkedIso: string | null;
  readonly fix: FixAccount;
  /** What is worse while it is down. */
  readonly worse: string;
  /** How stale a sync's copy is, for a corpus sync; `null` for anything else. */
  readonly freshness: Freshness | null;
  /** What runs instead right now, each a sentence; never empty. */
  readonly meanwhile: readonly string[];
}

/** Everything an account is told from, each already read for the card. */
interface AccountInputs {
  readonly health: AutomationHealth;
  readonly hold: StandingHold | null;
  readonly purpose: AutomationPurpose | null;
  /** The row this account describes, which an owner hold's state must have been minted for to read as the owner's. */
  readonly recipeId: string;
  /** Newest slot first. */
  readonly firings: readonly FiringView[];
  readonly slotVerdict: RecipeSlotVerdict | null;
  readonly resync: ResyncState | undefined;
  /** Newest first; empty for anything that syncs no corpus source. */
  readonly syncRuns: readonly SyncRunView[];
  readonly silent: SilentRow | undefined;
  /** The run stamp, whose instant is when the run that finished last settled; absent when the row has never run. */
  readonly run: RecipeDefinitionRun | undefined;
  /** What a visible session said went wrong, per firing (`explanationKey`); empty when none has said. */
  readonly explanations: ReadonlyMap<string, string>;
  /**
   * Why each history the last run is judged from (the slot ledger, the sync runs, the run stamps) did not read whole,
   * or `null` for one that did: with any run missing, none can be named as the one that finished last.
   */
  readonly historyGaps: readonly (string | null)[];
}

/** The later of two instants, either of which may be absent. */
function laterIso({ a, b }: { a: string | null; b: string | null }): string | null {
  if (a === null) {
    return b;
  }
  if (b === null || Date.parse(a) >= Date.parse(b)) {
    return a;
  }
  return b;
}

/**
 * When it last worked and when the current break began, by when each firing SETTLED — a retry overwrites its slot,
 * so slot order is not settle order. A resync's own last success counts as working too. A break in the same
 * millisecond as the last success counts only when it wrote the run stamp, so was written last.
 */
function streakOf({
  firings,
  resync,
  run,
}: {
  firings: readonly FiringView[];
  resync: ResyncState | undefined;
  run: RecipeDefinitionRun | undefined;
}): {
  lastWorkedIso: string | null;
  brokenSinceIso: string | null;
} {
  let lastWorkedIso = resync === undefined ? null : resync.lastSuccessAtIso;
  for (const firing of firings) {
    if (firing.outcome === "succeeded") {
      lastWorkedIso = laterIso({ a: lastWorkedIso, b: firing.settledAtIso });
    }
  }
  const after = lastWorkedIso === null ? Number.NEGATIVE_INFINITY : Date.parse(lastWorkedIso);
  const breaks = firings
    .filter((firing) => firing.outcome === "failed" || firing.outcome === "dead")
    .flatMap((firing) => {
      if (firing.settledAtIso === null) {
        return [];
      }
      const settledMs = Date.parse(firing.settledAtIso);
      const counts = settledMs > after || (settledMs === after && wroteRunStampOf({ firing, run }));
      return counts ? [firing.settledAtIso] : [];
    })
    .toSorted((a, b) => Date.parse(a) - Date.parse(b));
  const first = breaks[0];
  if (first === undefined) {
    return { brokenSinceIso: null, lastWorkedIso };
  }
  return { brokenSinceIso: first, lastWorkedIso };
}

/** The sync run that ended last, by {@link endedSyncsOf}. */
function lastEndedSyncOf({ syncRuns }: { syncRuns: readonly SyncRunView[] }): SyncRunView | undefined {
  return endedSyncsOf({ syncRuns })[0];
}

/** A failed sync run's first error, or `undefined` for one that did not fail or failed without words. */
function syncFailureWords({ run }: { run: SyncRunView }): string | undefined {
  if (run.state !== "failed") {
    return undefined;
  }
  return run.errors.at(0);
}

/** When a firing's run began: its seated session's start when it has one, else when it was taken. */
function runStartMs({ firing }: { firing: FiringView }): number {
  if (firing.runStartedAtIso !== null) {
    return Date.parse(firing.runStartedAtIso);
  }
  return Date.parse(firing.startedAtIso);
}

/**
 * What the failing run said, only while the run that finished last failed: a sync that ended after the last-settled
 * firing speaks alone; else, when that firing failed, the last sync to start and end inside its run speaks its first
 * error ahead of the firing's reason; otherwise the firing's reason. A failure a later run has since got past is history, never why the row is
 * broken now — MEASURED: `resync-corpus-github`, stopped with its last ten runs worked, quoted an abandon from
 * weeks before. Repro: `slopweaver automation status | grep -A6 resync-corpus-github` on a build before this.
 */
function saidOf({
  firings,
  syncRuns,
  run,
}: {
  firings: readonly FiringView[];
  syncRuns: readonly SyncRunView[];
  run: RecipeDefinitionRun | undefined;
}): string | null {
  // The run that finished LAST, not the newest slot: two firings can settle in either order.
  const newest = finishedBySettleOf({ firings, run }).at(0);
  const firingEndMs = newest === undefined ? Number.NEGATIVE_INFINITY : Date.parse(newest.settledAtIso!);
  // The run stamp carries the settle instant of the run that finished last, so it outlives that run's own ledger row
  // when the row would not read.
  const stampMs = run === undefined ? Number.NEGATIVE_INFINITY : Date.parse(run.lastRunAtIso);
  const ended = endedSyncsOf({ syncRuns });
  const lastSync = ended[0];
  // Ended after every run the scheduler settled: the sync is the last run, and alone says whether it failed — a sync that failed without words never lets an older firing's failure speak for it.
  if (lastSync !== undefined && syncEndMs({ run: lastSync }) > Math.max(firingEndMs, stampMs)) {
    const words = syncFailureWords({ run: lastSync });
    if (words === undefined) {
      return null;
    }
    return words;
  }
  // The run that finished last is missing from the ledger, so no firing read here speaks for it.
  if (stampMs > firingEndMs || deadStampWriterMissing({ newest, run })) {
    return null;
  }
  return failedFiringSaid({ ended, firingEndMs, newest });
}

/**
 * Whether a dead firing's stamp settled in the same millisecond as the firing read last, yet names another slot: the
 * run that finished last is then missing from the ledger, exactly as for a stamp settled later.
 */
function deadStampWriterMissing({
  newest,
  run,
}: {
  newest: FiringView | undefined;
  run: RecipeDefinitionRun | undefined;
}): boolean {
  if (run?.failureSlotIso === undefined || newest === undefined || newest.settledAtIso !== run.lastRunAtIso) {
    return false;
  }
  return !wroteRunStampOf({ firing: newest, run });
}

/**
 * What the firing that finished last said, when it failed: the sync it ran speaks first, then its own reason.
 *
 * @param newest the firing that settled last, or `undefined` when none has
 * @param ended the sync runs that have ended, last to end first
 * @param firingEndMs when that firing settled
 * @returns its words, or `null` when it did not fail
 */
function failedFiringSaid({
  newest,
  ended,
  firingEndMs,
}: {
  newest: FiringView | undefined;
  ended: readonly SyncRunView[];
  firingEndMs: number;
}): string | null {
  // Only a run that FAILED said anything: an abandoned one's reason is the scheduler's bookkeeping about the
  // attempt, never the run's own words, and the why already says it stopped partway.
  if (newest?.outcome !== "failed") {
    return null;
  }
  // The sync that firing ran — the last to start and end inside its run, wherever an overlapping run sorts — says more than the firing's own reason. Its run start, never when it was taken: a seated row is taken
  // before its session runs.
  const firingStartMs = runStartMs({ firing: newest });
  const its = ended.find(
    (run) =>
      run.startedAtIso !== null && Date.parse(run.startedAtIso) >= firingStartMs && syncEndMs({ run }) <= firingEndMs,
  );
  const words = its === undefined ? undefined : syncFailureWords({ run: its });
  if (words !== undefined) {
    return words;
  }
  return newest.reason;
}

/** The freshness of a corpus sync's copy, or `null` for a row that syncs none. */
function freshnessOf({
  resync,
  syncRuns,
}: {
  resync: ResyncState | undefined;
  syncRuns: readonly SyncRunView[];
}): Freshness | null {
  if (syncRuns.length === 0) {
    return null;
  }
  // The newest rows by when they landed, never by which run started last: two runs can overlap.
  // Each run's own newest commit, never its last activity: a progress or finish row lands no rows.
  const landedIsos = syncRuns.flatMap((run) => (run.lastCommittedIso === null ? [] : [run.lastCommittedIso]));
  let newestRowsIso: string | null = null;
  for (const iso of landedIsos) {
    newestRowsIso = laterIso({ a: newestRowsIso, b: iso });
  }
  return {
    lastCompleteIso: resync === undefined ? null : resync.lastSuccessAtIso,
    newestRowsIso,
  };
}

/** What runs instead right now: the scheduler's part, the purpose's stand-in, and rows a failed sync still stored. */
function meanwhileOf({ hold, purpose, recipeId, syncRuns }: AccountInputs): readonly string[] {
  const lines: string[] = [];
  if (hold?.kind === "fix") {
    lines.push("The scheduler will not run it again until its fix lands.");
  }
  if (hold?.kind === "owner" && !ownerHoldIsOwners({ recipeId, state: hold.placedByState })) {
    lines.push("The scheduler will not run it while the hold stands.");
  }
  if (hold?.kind === "owner" && ownerHoldIsOwners({ recipeId, state: hold.placedByState })) {
    lines.push("The scheduler will not run it until you lift the pause.");
  }
  if (purpose !== null && purpose.meanwhile !== null) {
    lines.push(purpose.meanwhile);
  }
  // Never "its last run": a firing that started no sync can finish after this one.
  const newest = lastEndedSyncOf({ syncRuns });
  if (newest !== undefined && newest.state !== "finished" && newest.committedWritten > 0) {
    lines.push(`A sync that stopped part way still stored ${String(newest.committedWritten)} new rows.`);
  }
  if (lines.length === 0) {
    lines.push("Nothing stands in for it.");
  }
  return lines;
}

/**
 * The cause the run stamp kept for a dead firing that finished after every firing the ledger still reads — the
 * scheduler's record of a run whose own ledger row is gone. It is never what the run SAID: a dead
 * firing's cause may be the scheduler's bookkeeping about an abandoned attempt, so it is folded, never quoted.
 */
function stampCauseOf({ inputs }: { inputs: AccountInputs }): string | null {
  const { firings, run } = inputs;
  if (run?.failureCause === undefined) {
    return null;
  }
  const stampMs = Date.parse(run.lastRunAtIso);
  // Only a DEAD firing's stamp keeps a cause, and it names that firing's slot; the ledger holds one row per slot, so
  // the ledger still reads the run that wrote the cause exactly when that slot's dead row is there. Matching by slot,
  // never by instant or wording, keeps an unrelated firing settling in the same millisecond from hiding it.
  const later = finishedBySettleOf({ firings, run }).some((firing) => Date.parse(firing.settledAtIso!) > stampMs);
  const itsOwnRow = firings.some((firing) => firing.slotIso === run.failureSlotIso && firing.outcome === "dead");
  if (later || itsOwnRow) {
    return null;
  }
  return run.failureCause;
}

/**
 * The record folded beneath the answers. A dead run the ledger no longer reads keeps the cause its run stamp saved;
 * an explained firing — failed or dead — keeps its WHOLE record, never the cut-down reason, since
 * `plainlyOf` only ever explains the firing that finished last; else a stopped row's record is what the scheduler and
 * the supervisor wrote about it, and any other's is what its run said.
 */
function detailOf({
  inputs,
  plainly,
  raw,
}: {
  inputs: AccountInputs;
  plainly: string | null;
  raw: string | null;
}): string | null {
  const kept = stampCauseOf({ inputs });
  if (kept !== null) {
    return kept;
  }
  const explained =
    plainly === null ? undefined : finishedBySettleOf({ firings: inputs.firings, run: inputs.run }).at(0);
  if (explained !== undefined && explained.detail !== null) {
    return explained.detail;
  }
  if (inputs.health === "stopped" && inputs.silent !== undefined) {
    return inputs.silent.detail;
  }
  return raw;
}

/** The healths that owe the owner an account. */
const ACCOUNTED: ReadonlySet<AutomationHealth> = new Set(["failed", "paused", "waiting", "stuck", "stopped"]);

/**
 * The five answers for a broken or paused automation.
 *
 * @param inputs the row's health, standing hold, purpose, firings and sync runs, as its card already read them
 * @returns the account, or `null` for a row that is neither broken nor paused
 */
export function brokenAccountOf(inputs: AccountInputs): BrokenAccount | null {
  const { health, hold, purpose, firings, resync, syncRuns, run } = inputs;
  if (!ACCOUNTED.has(health)) {
    return null;
  }
  const streak = streakOf({ firings, resync, run });
  const raw = saidOf({ firings, run, syncRuns });
  const freshness = freshnessOf({ resync, syncRuns });
  const meanwhile = meanwhileOf(inputs);
  if (hold?.kind === "owner") {
    return ownerHoldAccount({
      freshness,
      hold,
      lastWorkedIso: streak.lastWorkedIso,
      meanwhile,
      purpose,
      recipeId: inputs.recipeId,
    });
  }
  const { why, fix } =
    hold?.kind === "fix"
      ? {
          fix: fixStageAccount({ sinceIso: hold.sinceIso, stage: hold.stage }),
          why: "A run failed, so the scheduler stopped running it until the fix lands.",
        }
      : unheldAccount(inputs);
  let sinceIso = streak.brokenSinceIso;
  if (sinceIso === null && hold !== null) {
    sinceIso = hold.sinceIso;
  }
  // A history that did not read whole may hide the run that finished last, so no sentence names one; a
  // sync run with a torn line read partly, one with no readable start (`unreadable`) not at all, and one whose own
  // ledger append failed (`ledgerFailures`) wrote only part of itself.
  const plainly =
    inputs.historyGaps.every((gap) => gap === null) &&
    syncRuns.every((one) => one.malformedLines === 0 && one.ledgerFailures === 0 && one.state !== "unreadable")
      ? plainlyOf({ explanations: inputs.explanations, firings, run, syncRuns })
      : null;
  return {
    detail: detailOf({ inputs, plainly, raw }),
    fix,
    freshness,
    lastWorkedIso: streak.lastWorkedIso,
    meanwhile,
    plainly,
    said: saidPlainlyOf({ raw }),
    sinceIso,
    state: "broken",
    why,
    worse: worseOf({ paused: false, purpose }),
  };
}
