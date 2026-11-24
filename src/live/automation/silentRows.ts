/**
 * WHICH SCHEDULED ROWS HAVE GONE QUIET, and why — the reporting half of a measurement this repository has
 * always computed and never surfaced.
 *
 * MEASURED: `vulnfix-digest-acme-admin` (cadence `30 9 * * *`) posted nothing for two days.
 * `conversations.history` on its channel counted 0 messages in 24h and 1 in 48h; `definition-runs.json` held
 * an `exitCode: 0` and a `lastRunAtIso` stamp, which is byte-for-byte what a healthy row looks
 * like. `automation due --json` DID say `band: "overdue", lateByMs: 29637958` — nothing anywhere carried that to
 * a reader. The measurement existed; the reporting did not, and a row the owner explicitly asked to SEE with
 * their own eyes went dark without one word anywhere.
 *
 * ## The reason is read off the record, never guessed
 *
 * "Late" alone is the answer that made this two days long rather than one tick long: a supervisor reading it
 * cannot tell a row waiting on a prerequisite from a row whose cron will not parse from a row nobody has
 * ever run. So each silent row carries its own reason, and every one of them is a fact somebody wrote down:
 *
 * - **DEFERRED** — the firing's own ledger row holds a `deferred` outcome (`./slotAttempt.ts`), carrying
 *   what the verb said it was waiting for. This is the class the finding was, and it is the reason the
 *   deferral stopped being recorded by deleting its own row.
 * - **UNSCHEDULABLE** — the cadence will not parse, so the row will never fire again. The worst silence of
 *   the four and the easiest to miss, because such a row is never `due` and therefore never printed.
 * - **NEVER RUN** — no stamp at all. A row registered and forgotten reads exactly like a row that is fine.
 * - **FAILING** — the last run exited non-zero.
 * - **MISSED** — slots went by and nothing recorded why. Honest rather than invented: the record says only
 *   that the row did not run.
 *
 * ## The threshold, and where its one number comes from
 *
 * `./definitionTolerance.ts` carries no constant on purpose, and its `overdue` band is
 * `firingsSinceWatermark > 1`. Read that carefully: the count includes the firing currently DUE, so
 * `missedSlots = firingsSinceWatermark - 1` and `overdue` already means "one whole slot went by unrun". For
 * a DAILY row that is exactly the handover doc's threshold, with no new number at all.
 *
 * The one exception is a firing the due verdict HANDED TO ITS SUCCESSOR (`deferredSlotIso`): it is not due, it
 * was given up, so it is counted whole. Without that, the `- 1` treats the handed-on slot as the one owed now and a
 * daily row reads HEALTHY for up to half a period after a slot went by unrun.
 *
 * The only new judgement is that a row firing more often than daily must miss TWO. The number that decides
 * "more often than daily" is a day, and it is the cadence of the SURFACE this lands on rather than a tuned
 * fraction of anything: the owner reads one briefing a day, so a sub-daily row that has missed a single firing has
 * usually recovered several times over before the owner ever sees the line, and a line they learn to skip protects
 * nothing. A row at or above a day gets no such second chance — by its second miss the owner has been blind for
 * two days, which is the incident this module exists because of.
 *
 * Pure: rows and an instant in, silent rows out. No clock, no filesystem — the caller read both.
 */
import type { RecipeDestination } from "./definition.js";
import { recipePeriodMs } from "./definitionTolerance.js";
import type { RecipeEffect } from "./kinds.js";
import type { RecipeSlotOutcome } from "./slotAttempt.js";
import type { SilentSupervisorStop } from "./supervisorStops.js";

/** One day in milliseconds — the reporting surface's own period. See the header for why this is the boundary. */
const REPORTING_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Why one row has gone quiet, in the order {@link silentRows} prefers them.
 *
 * @internal — reached through {@link SilentRow}; nothing outside this module names the union.
 */
export type SilenceReason = "UNSCHEDULABLE" | "DEFERRED" | "NEVER RUN" | "FAILING" | "MISSED";

/** One scheduled row as this measure sees it — everything the caller already read, and nothing else. */
export interface SilenceCandidate {
  readonly recipeId: string;
  readonly cadence: string;
  /** How many firings went by after the slot the row last covered, from the due verdict. */
  readonly firingsSinceWatermark: number;
  /**
   * The firing the due verdict handed to its successor, or `null` when it handed none on — then the newest counted
   * firing is the one owed now, never a missed one.
   */
  readonly deferredSlotIso: string | null;
  /** When the row last ran, or `null` when it never has. */
  readonly lastRunAtIso: string | null;
  /** What its last run exited with, or `null` when it has never run. */
  readonly lastExitCode: number | null;
  /**
   * How the slot ledger settled the firing its last run covered, or `null` when it has none. An exit code alone
   * does not say failure — a verb-run's exit 3 is "nothing to do" and settles `succeeded` — so a run the ledger
   * settled `succeeded` is never FAILING. MEASURED: `gmail-meeting-notes-clear` and
   * `meeting-prep-hourly` read FAILING on exit 3 over 71 and 16 recorded successes with no failure among them.
   * Repro: `slopweaver automation status | grep -A6 meeting-prep-hourly` on a build before this field.
   */
  readonly lastRunSlotOutcome?: RecipeSlotOutcome | null | undefined;
  /**
   * The ledger row for the firing this row is currently due for, or `null` when nothing has attempted it.
   *
   * The CURRENT slot rather than a history, and that bound is deliberate: one file read per row, and a row
   * that keeps deferring writes a fresh `deferred` outcome on every tick, so the current slot always carries
   * the live reason. A slot that deferred and then succeeded has had its row overwritten by the success,
   * which is correct — the row describes the firing's state, not its story.
   */
  readonly currentSlotOutcome: RecipeSlotOutcome | null;
  /** Who runs the firing this row is currently due for under a live lease, or `null` when nobody does. */
  readonly currentSlotHold: CurrentSlotHold | null;
  /**
   * The recorded owner steer that already says who seats this row when it stops (`./steers.ts`), or absent when
   * the owner has recorded none. Carried through untouched: the silence judgement never reads it.
   */
  readonly steerId?: string | undefined;
  /**
   * What the row reaches when it runs — its kind, declared effect and destination — or absent when the caller
   * did not read the definition. Carried through untouched, for the card that has to say what a stop costs.
   */
  readonly reach?: RecipeReach | undefined;
}

/**
 * A firing the scheduler reads HELD (`./slotAttempt.ts` `judgeSlotAttempt`): its lease is live and its holder is
 * not proved gone. A silent row can carry one — earlier slots went by unrun, and the current one is running now.
 * MEASURED: `bump-fix-slopweaver` and `slack-owed-daily` were both under a seat's live lease when the
 * sweep registered a repair for them as "no seat had it"; both settled succeeded minutes later.
 */
export interface CurrentSlotHold {
  readonly holder: string;
  /** When the held attempt opened — the instant its holder took the firing. */
  readonly startedAtIso: string;
}

/** What a recipe row touches when it runs, read off its definition. */
interface RecipeReach {
  readonly kind: string;
  /** A closed set, so a card may quote it whatever else the row holds. */
  readonly effect: RecipeEffect;
  /** A closed set, likewise. */
  readonly destination: RecipeDestination["kind"];
}

/** One row that has gone quiet past its own threshold, with the reason a reader needs. */
export interface SilentRow {
  readonly recipeId: string;
  readonly cadence: string;
  /** How many whole firings went by unrun — never the raw count, which includes the one currently due. */
  readonly missedSlots: number;
  readonly lastRunAtIso: string | null;
  readonly reason: SilenceReason;
  /** The sentence a reader acts on: the reason in words, with whatever the record said behind it. */
  readonly detail: string;
  /**
   * Who runs its current firing under a live lease, carried from its {@link SilenceCandidate}. Never part of the
   * silence judgement: the slots that went by unrun still did. The stopped monitors read it as the row's owner.
   */
  readonly currentSlotHold: CurrentSlotHold | null;
  /**
   * The firing handed to its successor unrun, carried from its {@link SilenceCandidate}, or absent when none was — so
   * `./supervisorStops.ts` keeps the sentence naming it rather than rewriting it away.
   */
  readonly deferredSlotIso?: string | undefined;
  /** The recorded steer covering this row, carried from its {@link SilenceCandidate}. */
  readonly steerId?: string | undefined;
  /** What the row reaches, carried from its {@link SilenceCandidate}. */
  readonly reach?: RecipeReach | undefined;
  /**
   * What the supervisor's own record says about a `MISSED` row, or the hold it records on a row of any other reason,
   * so a reader can say it in its own words rather than re-parse {@link detail}. Set only by `./supervisorStops.ts`'s
   * `explainSilentRows`.
   */
  readonly supervisorStop?: SilentSupervisorStop | undefined;
}

/**
 * How many whole firings a row has let go by unrun. The currently due one has not been missed yet; one handed to its
 * successor has.
 */
function missedSlotsOf({
  firingsSinceWatermark,
  deferredSlotIso,
}: {
  firingsSinceWatermark: number;
  deferredSlotIso: string | null;
}): number {
  if (deferredSlotIso !== null) {
    return firingsSinceWatermark;
  }
  return Math.max(0, firingsSinceWatermark - 1);
}

/**
 * How many missed firings a row of this period must reach before it is worth a line.
 *
 * @param periodMs the span between two of the row's own firings
 * @returns 1 for a row that fires at most once a day, 2 for anything more frequent
 */
function missedSlotsThreshold({ periodMs }: { periodMs: number }): number {
  return periodMs >= REPORTING_PERIOD_MS ? 1 : 2;
}

/**
 * The reason and its sentence, read off whatever the records actually hold.
 *
 * The order is not preference, it is specificity: a deferral names what the row is waiting for, a non-zero
 * exit names a failure, and `MISSED` is what is left when the records say only that the row did not run —
 * which is an honest answer rather than the invented one a reader would otherwise supply for themselves.
 */
function silenceOf({ candidate, missedSlots }: { candidate: SilenceCandidate; missedSlots: number }): {
  readonly reason: SilenceReason;
  readonly detail: string;
} {
  const slots = `${String(missedSlots)} slot(s) of \`${candidate.cadence}\` went by unrun`;
  const outcome = candidate.currentSlotOutcome;
  if (outcome?.kind === "deferred") {
    return { detail: `${slots}; the verb ran and declined to act — ${outcome.detail}`, reason: "DEFERRED" };
  }
  // MISSED, never DEFERRED: that reason means a verb ran and wrote a deferral, and here nothing ran at all.
  if (candidate.deferredSlotIso !== null) {
    return {
      detail: `${slots}; slot ${candidate.deferredSlotIso} was handed to its successor because no tick took it in time`,
      reason: "MISSED",
    };
  }
  if (candidate.lastRunAtIso === null) {
    return { detail: `${slots} and it has never run at all`, reason: "NEVER RUN" };
  }
  const settledWorked = candidate.lastRunSlotOutcome?.kind === "succeeded";
  if (candidate.lastExitCode !== null && candidate.lastExitCode !== 0 && !settledWorked) {
    return {
      detail: `${slots}; its last run (${candidate.lastRunAtIso}) exited ${String(candidate.lastExitCode)}`,
      reason: "FAILING",
    };
  }
  return {
    detail: `${slots}; it last ran ${candidate.lastRunAtIso} and nothing recorded why it stopped`,
    reason: "MISSED",
  };
}

/** The candidate's steer and reach as spreadable fields, each absent rather than `undefined` when not known. */
function carriedOf({ candidate }: { candidate: SilenceCandidate }): {
  readonly steerId?: string;
  readonly reach?: RecipeReach;
} {
  return {
    ...(candidate.steerId === undefined ? {} : { steerId: candidate.steerId }),
    ...(candidate.reach === undefined ? {} : { reach: candidate.reach }),
  };
}

/** The row an unschedulable cadence produces — reported whatever its slot count, because it has none. */
function unschedulableRow({ candidate }: { candidate: SilenceCandidate }): SilentRow {
  return {
    cadence: candidate.cadence,
    currentSlotHold: null,
    detail:
      `its cadence \`${candidate.cadence}\` will not parse, so it is not due now and never will be — ` +
      "nothing else reports it, because every other reader starts from the due list it cannot enter",
    lastRunAtIso: candidate.lastRunAtIso,
    missedSlots: 0,
    reason: "UNSCHEDULABLE",
    recipeId: candidate.recipeId,
    ...carriedOf({ candidate }),
  };
}

/**
 * Which rows have gone quiet past their own threshold, worst first.
 *
 * @param candidates every ENABLED scheduled row, with its due verdict and its current firing's ledger row
 * @param nowIso the instant each row's period is measured around
 * @returns one entry per silent row, most missed slots first, ties broken by recipe id so two reads of one
 *   world agree
 */
export function silentRows({
  candidates,
  nowIso,
}: {
  readonly candidates: readonly SilenceCandidate[];
  readonly nowIso: string;
}): readonly SilentRow[] {
  const silent: SilentRow[] = [];
  for (const candidate of candidates) {
    const periodMs = recipePeriodMs({ cadence: candidate.cadence, nowIso });
    // Reported at once, and never through the slot test: a cadence that will not parse produces no firings
    // to count, so `firingsSinceWatermark` is 0 and a threshold would hide the loudest silence there is.
    if (periodMs === null) {
      silent.push(unschedulableRow({ candidate }));
      continue;
    }
    const missedSlots = missedSlotsOf({
      deferredSlotIso: candidate.deferredSlotIso,
      firingsSinceWatermark: candidate.firingsSinceWatermark,
    });
    if (missedSlots < missedSlotsThreshold({ periodMs })) {
      continue;
    }
    silent.push({
      cadence: candidate.cadence,
      currentSlotHold: candidate.currentSlotHold,
      lastRunAtIso: candidate.lastRunAtIso,
      missedSlots,
      recipeId: candidate.recipeId,
      ...silenceOf({ candidate, missedSlots }),
      ...carriedOf({ candidate }),
      ...(candidate.deferredSlotIso === null ? {} : { deferredSlotIso: candidate.deferredSlotIso }),
    });
  }
  return silent.toSorted(
    (left, right) => right.missedSlots - left.missedSlots || left.recipeId.localeCompare(right.recipeId),
  );
}
