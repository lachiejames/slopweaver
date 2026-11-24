/**
 * WHY A ROW STOPPED, read off the one record that can say it: the supervisor's own tick ledger.
 *
 * There is no clock (`skills/automation/SKILL.md`): a row runs only because a supervisor pass read it due and ran
 * or seated it. So a row that went quiet with nothing failing was, by construction, passed over by the supervisor —
 * and `./silentRows.ts`'s `MISSED` reading ("nothing recorded why it stopped") was true of the scheduler's records and
 * useless to the owner. MEASURED: `resync-corpus-slack` last ran hours earlier; the ledger's `recipeDue` reading
 * listed it unseated (`heldBy: null`) on 24 consecutive passes, and not one of them carried a
 * `hold-rationale` or `recipe-held` on `{kind:"recipe", id:"resync-corpus-slack"}` — the reason (the owner's live steers at
 * the seat ceiling, then a cpu hold) sat only in an action's free text about another subject. Repro:
 * `jq -c '{t:.tickId, s:[.sources.recipeDue.facts.rows[]? | select(.id=="resync-corpus-slack")]}' "$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl"`.
 *
 * Two answers, in this order, each a fact the ledger holds:
 *
 * - **held** — the newest `hold-rationale` judgement naming the recipe as its subject or among its
 *   `relatedSubjects`, or `recipe-held` action on it, since it last ran: the supervisor's own words are the reason.
 * - **passed over** — otherwise, how many passes since it last ran read it due and unseated and neither ran it nor
 *   held it. Said as a count, because "the supervisor saw it 24 times and said nothing" IS the cause.
 *
 * An unreadable or absent ledger is said as that, never as zero passes. The fold is pure; the one read streams the
 * ledger through `visitSupervisorTicks` and keeps a summary per stopped row, never the rows.
 */
import type { Result } from "#lib/result.js";

import type { SupervisorCoreError } from "../../supervisor/errors.js";
import { visitSupervisorTicks } from "../../supervisor/tickLedgerCheck.js";
import { supervisorTickLedgerPath } from "../../supervisor/tickStore.js";
import type { SupervisorTickRow, TickSubject } from "../../supervisor/tickTypes.js";
import type { SilentRow } from "./silentRows.js";

/** One stopped row and the instant its window opens: its last run, or `null` for the whole ledger. */
interface RecipeStopWindow {
  readonly recipeId: string;
  readonly sinceIso: string | null;
}

/** What the supervisor's record says about one stopped row since it last ran. */
export type RecipeSupervisorStop =
  | { readonly kind: "held"; readonly recordedIso: string; readonly reason: string }
  | { readonly kind: "passed-over"; readonly firstSeenDueIso: string; readonly passes: number }
  | { readonly kind: "no-due-reading" };

/**
 * What a stopped row carries: the record's answer, or that the record would not read. The diagnostic itself is
 * the page's `ledgerIssue`, once, never repeated on every row it stopped.
 */
export type SilentSupervisorStop = RecipeSupervisorStop | { readonly kind: "unreadable" };

/** The running summary for one window while the ledger is walked. */
interface StopTally {
  held: { recordedIso: string; reason: string } | null;
  /** False once a LATER tick passed the row over without holding it again: the hold no longer stands. */
  heldStands: boolean;
  passes: number;
  firstSeenDueIso: string | null;
}

/** Whether a subject is exactly this recipe — by kind and id, never by label or a name prefix. */
function namesRecipe({ subject, recipeId }: { subject: TickSubject; recipeId: string }): boolean {
  return subject.kind === "recipe" && subject.id === recipeId;
}

/** Whether `iso` falls inside a window that opens at `sinceIso` (inclusive), or always for an open window. */
function inWindow({ iso, sinceIso }: { iso: string; sinceIso: string | null }): boolean {
  return sinceIso === null || Date.parse(iso) >= Date.parse(sinceIso);
}

/**
 * Every hold one tick recorded on a recipe and when: a `hold-rationale` judgement's own one-sentence call, or a
 * `recipe-held` action's detail — its subject's label when it carries none, which names the row and not the reason.
 * A `failed` action held nothing, so it is never a hold.
 */
function holdsIn({
  row,
  recipeId,
}: {
  row: SupervisorTickRow;
  recipeId: string;
}): { recordedIso: string; reason: string }[] {
  const holds: { recordedIso: string; reason: string }[] = [];
  for (const judgement of row.judgements) {
    const named =
      namesRecipe({ recipeId, subject: judgement.subject }) ||
      judgement.relatedSubjects?.some((subject) => namesRecipe({ recipeId, subject })) === true;
    if (judgement.kind === "hold-rationale" && named) {
      holds.push({ reason: judgement.claim, recordedIso: judgement.recordedIso });
    }
  }
  for (const action of row.actions) {
    const heldIt = action.kind === "recipe-held" && action.outcome !== "failed";
    if (!heldIt || !namesRecipe({ recipeId, subject: action.subject })) {
      continue;
    }
    holds.push({ reason: heldReasonOf({ action }), recordedIso: action.recordedIso });
  }
  return holds;
}

/** A held action's own detail, or its subject's label when it carries none — which names the row, not the reason. */
function heldReasonOf({ action }: { action: SupervisorTickRow["actions"][number] }): string {
  if (action.detail !== undefined) {
    return action.detail;
  }
  return action.subject.label;
}

/**
 * Whether this tick read the recipe due and unseated, and then neither ran nor held it — one pass it went past. Every
 * stamp is taken as written and judged only against the window, never against the tick's own span or the due reading:
 * the supervisor stamps entries by hand a few minutes either side of its tick, so no in-row ordering rule is both
 * strict and true of the real ledger. MEASURED, rows with an action before the tick started or a hold-rationale after
 * it closed:
 * `jq -c '. as $r | (.actions[], .judgements[]) | select(.recordedIso < $r.startedIso or .recordedIso > $r.finalisedIso) | $r.tickId' "$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl"`.
 */
function passedOverIn({
  row,
  recipeId,
  sinceIso,
}: {
  row: SupervisorTickRow;
  recipeId: string;
  sinceIso: string | null;
}): string | null {
  const due = row.sources.recipeDue;
  if (due.status === "unavailable" || !inWindow({ iso: due.observedAtIso, sinceIso })) {
    return null;
  }
  const waiting = due.facts.rows.some((fact) => fact.id === recipeId && fact.heldBy === null);
  const acted = row.actions.some(
    (action) =>
      (action.kind === "recipe-run" || action.kind === "recipe-held") &&
      action.outcome !== "failed" &&
      namesRecipe({ recipeId, subject: action.subject }) &&
      inWindow({ iso: action.recordedIso, sinceIso }),
  );
  if (!waiting || acted) {
    return null;
  }
  return due.observedAtIso;
}

/**
 * Fold one tick into one window's tally, in ledger order. A tick that passes the row over WITHOUT a hold of its own
 * ends the standing of every earlier one: the sweep records a rationale on each due row it holds, so a later pass
 * with none did not hold it, and an old hold read as standing kept a no-longer-held row off the owner's Queue until it ran.
 */
function foldTick({
  row,
  window,
  tally,
}: {
  row: SupervisorTickRow;
  window: RecipeStopWindow;
  tally: StopTally;
}): void {
  const holds = holdsIn({ recipeId: window.recipeId, row }).filter((hold) =>
    inWindow({ iso: hold.recordedIso, sinceIso: window.sinceIso }),
  );
  for (const hold of holds) {
    if (tally.held === null || Date.parse(hold.recordedIso) >= Date.parse(tally.held.recordedIso)) {
      tally.held = hold;
    }
  }
  if (holds.length > 0) {
    tally.heldStands = true;
  }
  const seenDueIso = passedOverIn({ recipeId: window.recipeId, row, sinceIso: window.sinceIso });
  if (seenDueIso === null) {
    return;
  }
  if (holds.length === 0) {
    tally.heldStands = false;
  }
  if (tally.passes === 0) {
    tally.firstSeenDueIso = seenDueIso;
  }
  tally.passes += 1;
}

/** A finished tally as the answer it supports. */
function stopOf({ tally }: { tally: StopTally }): RecipeSupervisorStop {
  if (tally.held !== null && tally.heldStands) {
    return { kind: "held", reason: tally.held.reason, recordedIso: tally.held.recordedIso };
  }
  if (tally.firstSeenDueIso !== null) {
    return { firstSeenDueIso: tally.firstSeenDueIso, kind: "passed-over", passes: tally.passes };
  }
  return { kind: "no-due-reading" };
}

/** A fresh tally per window, keyed by recipe. */
function emptyTallies({ windows }: { windows: readonly RecipeStopWindow[] }): Map<string, StopTally> {
  return new Map(
    windows.map((window) => [window.recipeId, { firstSeenDueIso: null, held: null, heldStands: false, passes: 0 }]),
  );
}

/**
 * What the supervisor's record says about each stopped row — the pure fold, over rows already read, oldest first.
 *
 * @param rows tick rows in ledger order
 * @param windows one per stopped row: its recipe id and the instant it last ran
 * @returns one answer per window, keyed by recipe id
 */
export function foldRecipeSupervisorStops({
  rows,
  windows,
}: {
  rows: readonly SupervisorTickRow[];
  windows: readonly RecipeStopWindow[];
}): ReadonlyMap<string, RecipeSupervisorStop> {
  const tallies = emptyTallies({ windows });
  for (const row of rows) {
    for (const window of windows) {
      foldTick({ row, tally: tallies.get(window.recipeId)!, window });
    }
  }
  return new Map([...tallies].map(([recipeId, tally]) => [recipeId, stopOf({ tally })]));
}

/**
 * The oldest instant any window opens at — the walk starts there, so history no window folds cannot refuse the read.
 * `null`, the whole ledger, when a window opens at the start of it.
 */
function oldestWindowIso({ windows }: { windows: readonly RecipeStopWindow[] }): string | null {
  let oldest: string | null = null;
  for (const window of windows) {
    if (window.sinceIso === null) {
      return null;
    }
    if (oldest === null || Date.parse(window.sinceIso) < Date.parse(oldest)) {
      oldest = window.sinceIso;
    }
  }
  return oldest;
}

/**
 * Read the supervisor's record once for every stopped row, streaming the ledger and keeping one summary per row.
 *
 * @param home the state home whose tick ledger is read
 * @param windows one per stopped row
 * @returns one answer per window, or why the ledger could not be read
 */
function readRecipeSupervisorStops({
  home,
  windows,
}: {
  home: string;
  windows: readonly RecipeStopWindow[];
}): Result<ReadonlyMap<string, RecipeSupervisorStop>, SupervisorCoreError> {
  const tallies = emptyTallies({ windows });
  const walked = visitSupervisorTicks({
    fromIso: oldestWindowIso({ windows }),
    onTick: ({ row }) => {
      for (const window of windows) {
        foldTick({ row, tally: tallies.get(window.recipeId)!, window });
      }
    },
    path: supervisorTickLedgerPath({ home }),
  });
  return walked.map(() => new Map([...tallies].map(([recipeId, tally]) => [recipeId, stopOf({ tally })])));
}

/**
 * The sentence a stopped row's reason becomes, in plain words — no "tick", "slot" or "firing".
 *
 * @param stop what the record says, or why it could not be read
 * @param lastRunAtIso when the row last ran
 * @returns the sentence, lower-case first so it reads after the row's name
 */
export function supervisorStopWords({
  stop,
  lastRunAtIso,
}: {
  stop: SilentSupervisorStop;
  lastRunAtIso: string;
}): string {
  const ran = `it last ran ${lastRunAtIso}`;
  switch (stop.kind) {
    case "unreadable":
      return `${ran}, and the supervisor's own record could not be read to say why it was not run since`;
    case "held":
      return `${ran}; the supervisor held it at ${stop.recordedIso}: ${stop.reason}`;
    case "passed-over":
      return (
        `${ran}; the supervisor saw it waiting to run on ${String(stop.passes)} check(s) since ` +
        `${stop.firstSeenDueIso} and neither ran it nor said why`
      );
    case "no-due-reading":
      return `${ran}; no supervisor check since has seen it waiting to run, and it runs again when one does`;
    default: {
      const unreachable: never = stop;
      return unreachable;
    }
  }
}

/**
 * A row whose reason already names its own cause, with a standing supervisor hold laid over it: the hold is carried
 * as its `supervisorStop` and said after the detail; anything short of a hold leaves the row exactly as it was.
 *
 * @param stop what the record says since the row last ran, or `undefined` when the ledger would not read
 * @returns the row, held or untouched
 */
function heldOver({ row, stop }: { row: SilentRow; stop: RecipeSupervisorStop | undefined }): SilentRow {
  if (stop?.kind !== "held") {
    return row;
  }
  return {
    ...row,
    detail: `${row.detail}; the supervisor held it at ${stop.recordedIso}: ${stop.reason}`,
    supervisorStop: stop,
  };
}

/**
 * Say what the supervisor's record holds about every silent row. A `MISSED` row's detail is rewritten with it, since
 * "nothing recorded why" is the gap the record fills. Every other reason already names its own cause, so it keeps
 * that and gains only a standing HOLD: a `NEVER RUN`, `FAILING`, `DEFERRED` or `UNSCHEDULABLE` row the chair records a
 * hold-rationale on every due tick has been chosen for exactly as a held `MISSED` one has, and before this it stayed
 * at the top of the owner's Queue as a stop nobody had decided on. A never-run row's
 * window is the whole ledger, which costs nothing extra: the walk parses every line whatever its window
 * (`../../supervisor/tickLedgerCheck.ts` § `fromIso`).
 *
 * @param home the state home whose tick ledger is read
 * @param rows the silent rows, worst first
 * @returns the same rows in the same order, explained, and the ledger's error when it would not read
 */
export function explainSilentRows({ home, rows }: { home: string; rows: readonly SilentRow[] }): {
  readonly rows: readonly SilentRow[];
  readonly ledgerIssue: string | null;
} {
  if (rows.length === 0) {
    return { ledgerIssue: null, rows };
  }
  const windows = rows.map((row) => ({ recipeId: row.recipeId, sinceIso: row.lastRunAtIso }));
  const read = readRecipeSupervisorStops({ home, windows });
  const explained = rows.map((row) => {
    if (row.reason !== "MISSED" || row.lastRunAtIso === null) {
      return heldOver({ row, stop: read.isOk() ? read.value.get(row.recipeId) : undefined });
    }
    let stop: SilentSupervisorStop = { kind: "unreadable" };
    if (read.isOk()) {
      stop = read.value.get(row.recipeId)!;
    }
    // A slot handed to its successor already names its own cause; the record says only why no tick took it.
    let went = `${String(row.missedSlots)} scheduled time(s) went by with no run`;
    if (row.deferredSlotIso !== undefined) {
      went = row.detail;
    }
    return {
      ...row,
      detail: `${went}; ${supervisorStopWords({ lastRunAtIso: row.lastRunAtIso, stop })}`,
      supervisorStop: stop,
    };
  });
  return { ledgerIssue: read.isErr() ? `supervisor tick ledger: ${read.error.message}` : null, rows: explained };
}
