/**
 * One pass of the drawdown watch: record what the plans read, judge the pace, and — only in the watch's own
 * recurring mode — open ONE visible investigation when the pace is genuinely anomalous.
 *
 * ## Reading never spawns, and that is the property to keep
 *
 * Three modes, and only one of them can open anything. `slopweaver session depth` renders the journal and
 * never calls this module at all; `--dry-run` writes nothing; `--once` records the sample but never spawns.
 * A read-only verb that could open a workspace as a side effect of being run would make the whole gauge
 * unsafe to consult, which is the opposite of what a supervisor needs from it.
 *
 * ## What it opens, and why that satisfies rule 2
 *
 * The investigation is a `cmux spawn` — a VISIBLE, interactive workspace the owner can watch and interrupt.
 * Nothing here launches a detached or resident model. The intended shape: the tick notices usage drawn down
 * at several times last week's baseline and spawns a session to investigate, so the owner never has to
 * come in after the fact to ask what happened.
 *
 * Every effect is injected, so the whole decision path is unit-tested without touching a socket or a file.
 */
import type { Result } from "../lib/result.js";
import type { ClaudeAccountGauge } from "./contracts.js";
import {
  type DrawdownEvaluation,
  type DrawdownIncident,
  drawdownSamples,
  evaluateDrawdown,
  renderDrawdownEvaluation,
} from "./drawdownAnomaly.js";
import {
  admitDrawdownInvestigation,
  type DrawdownJournalEvent,
  type DrawdownJournalRead,
  samplesOf,
} from "./drawdownJournal.js";

/** What this pass is allowed to do. */
export type DrawdownTickMode = "dry-run" | "sample-only" | "watch";

/** Where a visible investigation came up. */
export interface DrawdownInvestigationReceipt {
  readonly incidentId: string;
  readonly workspaceRef: string;
}

/** Every effect the tick needs, injected. */
export interface DrawdownTickDeps {
  readonly readJournal: (input: { home: string }) => Result<DrawdownJournalRead>;
  readonly appendJournal: (input: { home: string; events: readonly DrawdownJournalEvent[] }) => Result<undefined>;
  readonly openInvestigation: (input: {
    incident: DrawdownIncident;
    nowIso: string;
  }) => Promise<Result<DrawdownInvestigationReceipt>>;
}

/** What this pass did. */
export interface DrawdownTickOutcome {
  readonly evaluation: DrawdownEvaluation;
  readonly investigation: "none" | "suppressed" | "opened" | "failed";
  readonly lines: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Run one pass.
 *
 * @param gauges the readings this tick already took — never re-probed here, so the watch pays for one probe
 * @param home the state home the journal lives under
 * @param nowIso the instant the baseline is judged from
 * @param mode what this pass may do
 * @param deps the injected effects
 * @returns what it decided, the lines to print, and anything that went wrong
 */
export async function processDrawdownTick({
  gauges,
  home,
  nowIso,
  mode,
  deps,
}: {
  gauges: readonly ClaudeAccountGauge[];
  home: string;
  nowIso: string;
  mode: DrawdownTickMode;
  deps: DrawdownTickDeps;
}): Promise<DrawdownTickOutcome> {
  const errors: string[] = [];
  const read = deps.readJournal({ home });
  if (read.isErr()) {
    // A journal that exists and cannot be read leaves the baseline unknowable, so this pass judges nothing
    // rather than judging against an empty history and calling every ordinary hour an anomaly.
    return {
      errors: read.error,
      evaluation: { baselines: [], incident: undefined, latestSampleAtIso: undefined },
      investigation: "none",
      lines: ["plan drawdown: NOT MEASURED — the journal could not be read"],
    };
  }
  const history = samplesOf({ events: read.value.events });
  const current = drawdownSamples({ gauges });
  const evaluation = evaluateDrawdown({ current, history, nowIso });
  const lines = renderDrawdownEvaluation({ evaluation });

  if (mode !== "dry-run" && current.length > 0) {
    const appended = deps.appendJournal({ events: current, home });
    if (appended.isErr()) {
      errors.push(...appended.error);
    }
  }

  const incident = evaluation.incident;
  if (incident === undefined || mode !== "watch") {
    return { errors, evaluation, investigation: "none", lines };
  }

  return openInvestigationFor({ deps, evaluation, errors, history: read.value.events, home, incident, lines, nowIso });
}

/**
 * The half of a pass that may open a workspace: admit, journal the attempt, spawn, journal the outcome.
 *
 * Split from {@link processDrawdownTick} because it is the only part with a side effect on the world, and
 * keeping it separate makes "reading never spawns" a property of which function ran rather than of a branch
 * buried inside a long one.
 *
 * @param deps the injected effects
 * @param evaluation what the detector resolved, carried through onto the outcome
 * @param errors anything that already went wrong this pass
 * @param history every event already journalled, which suppression reads
 * @param home the state home the journal lives under
 * @param incident the episode that fired
 * @param lines the report so far, appended to rather than replaced
 * @param nowIso the instant to stamp the journal rows with
 * @returns what this pass did
 */
async function openInvestigationFor({
  deps,
  evaluation,
  errors,
  history,
  home,
  incident,
  lines,
  nowIso,
}: {
  deps: DrawdownTickDeps;
  evaluation: DrawdownEvaluation;
  errors: readonly string[];
  history: readonly DrawdownJournalEvent[];
  home: string;
  incident: DrawdownIncident;
  lines: readonly string[];
  nowIso: string;
}): Promise<DrawdownTickOutcome> {
  const admission = admitDrawdownInvestigation({ history, incident });
  if (admission.kind === "suppress") {
    return {
      errors,
      evaluation,
      investigation: "suppressed",
      lines: [...lines, `  no new investigation: ${admission.reason}`],
    };
  }
  // The ATTEMPT is journalled before the spawn, so a process that dies mid-spawn cannot open a fresh
  // workspace for the same episode on every following tick.
  const attempt = deps.appendJournal({ events: [attemptEvent({ incident, nowIso })], home });
  if (attempt.isErr()) {
    const why = "  no investigation opened: the attempt could not be journalled, so none was made";
    return { errors: [...errors, ...attempt.error], evaluation, investigation: "failed", lines: [...lines, why] };
  }

  return spawnAndRecord({ deps, evaluation, errors, home, incident, lines, nowIso });
}

/**
 * Open the workspace and record which way it went.
 *
 * @param deps the injected effects
 * @param evaluation what the detector resolved
 * @param errors anything that already went wrong this pass
 * @param home the state home
 * @param incident the episode being investigated
 * @param lines the report so far
 * @param nowIso the instant to stamp with
 * @returns what this pass did
 */
async function spawnAndRecord({
  deps,
  evaluation,
  errors,
  home,
  incident,
  lines,
  nowIso,
}: {
  deps: DrawdownTickDeps;
  evaluation: DrawdownEvaluation;
  errors: readonly string[];
  home: string;
  incident: DrawdownIncident;
  lines: readonly string[];
  nowIso: string;
}): Promise<DrawdownTickOutcome> {
  const opened = await deps.openInvestigation({ incident, nowIso });
  if (opened.isErr()) {
    const reason = opened.error.join("; ");
    journal({ deps, event: failedEvent({ incident, nowIso, reason }), home });
    const why = `  investigation FAILED to open: ${reason} — not retried automatically`;
    return { errors: [...errors, ...opened.error], evaluation, investigation: "failed", lines: [...lines, why] };
  }
  const workspaceRef = opened.value.workspaceRef;
  journal({
    deps,
    event: {
      incidentId: incident.incidentId,
      kind: "investigation-opened",
      recordedAtIso: nowIso,
      schemaVersion: 1,
      workspaceRef,
    },
    home,
  });
  const note = `  investigation opened in ${workspaceRef} — visible, and yours to interrupt`;
  return { errors, evaluation, investigation: "opened", lines: [...lines, note] };
}

/**
 * The row recording that an investigation is about to be attempted.
 *
 * @param incident the episode it is for
 * @param nowIso when the decision was taken
 * @returns the row
 */
function attemptEvent({ incident, nowIso }: { incident: DrawdownIncident; nowIso: string }): DrawdownJournalEvent {
  return {
    attemptedAtIso: nowIso,
    incidentId: incident.incidentId,
    kind: "investigation-attempted",
    schemaVersion: 1,
    triggers: incident.triggers,
  };
}

/**
 * Append one event, ignoring a write failure.
 *
 * The outcome rows are best-effort by design: the ATTEMPT row is what suppression reads, so losing an
 * outcome row costs a reader some detail and can never cause a second spawn.
 *
 * @param deps the injected effects
 * @param event the row to append
 * @param home the state home
 * @returns nothing
 */
function journal({ deps, event, home }: { deps: DrawdownTickDeps; event: DrawdownJournalEvent; home: string }): void {
  deps.appendJournal({ events: [event], home });
}

/**
 * The row recording a spawn that did not come up.
 *
 * @param incident the episode it was for
 * @param nowIso when it failed
 * @param reason what the spawn reported
 * @returns the row
 */
function failedEvent({
  incident,
  nowIso,
  reason,
}: {
  incident: DrawdownIncident;
  nowIso: string;
  reason: string;
}): DrawdownJournalEvent {
  return {
    incidentId: incident.incidentId,
    kind: "investigation-failed",
    reason,
    recordedAtIso: nowIso,
    schemaVersion: 1,
  };
}

/**
 * What the investigating session is told to do.
 *
 * It is pointed at evidence and asked to explain, never told to change anything: the owner wants a
 * session that finds out what is going on, and a spawn that started rotating plans or killing sessions on
 * its own would be acting on a judgement reserved for the owner.
 *
 * @param incident the episode that fired
 * @returns the pickup text
 */
export function drawdownInvestigationBrief({ incident }: { incident: DrawdownIncident }): string {
  const windows = incident.triggers
    .map(
      (trigger) =>
        `${trigger.planAlias} ${trigger.window} at ${(trigger.currentFractionPerHour * 100).toFixed(1)}%/h, ` +
        `${trigger.ratio.toFixed(1)}x its normal ${(trigger.baselineFractionPerHour * 100).toFixed(1)}%/h`,
    )
    .join("; ");
  return [
    `Plan drawdown anomaly at ${incident.observedAtIso}: ${windows}.`,
    "",
    "Find out WHY, and report it. Do not rotate plans, change any session's model, or close anything.",
    "",
    "Start with `slopweaver session depth` — it names every live session, its context depth and its",
    "model-weighted draw, so the sessions responsible for a spike are the ones at the top of that list.",
    "Then `slopweaver claude gauge --json` for the current window readings, and the drawdown journal under",
    "`claude-accounts/drawdown.jsonl` for the samples this fired on.",
    "",
    "Answer three things: which sessions or models account for the change, whether the cause is legitimate",
    "work or a defect, and whether anything needs the owner's attention now.",
  ].join("\n");
}
