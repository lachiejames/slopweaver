/**
 * One pass of the Codex burn watch: record what the rollout log says, judge the pace, and — only in the
 * watch's own recurring mode — open ONE visible investigation when the pace is genuinely anomalous.
 *
 * ## Reading never spawns
 *
 * Three modes, and only one of them can open anything. `--dry-run` writes nothing and spawns nothing;
 * `--once` records unseen readings and never spawns; only the recurring foreground watch may spawn. A
 * read-only diagnostic that could open a workspace as a side effect of being run would make the whole gauge
 * unsafe to consult, which is the opposite of what it is for.
 *
 * ## The order of operations IS the safety property
 *
 * Claim, then journal, then spawn — never spawn then record. The claim is an atomic exclusive file create
 * (`./drawdownJournalStore.ts`), so two foreground watches ticking in the same instant cannot both pass it;
 * a process that dies between claiming and spawning leaves the claim taken, which is correct, because a
 * failed attempt is not a reason to try again automatically. That guarantees **at most one automatic
 * attempt**, never exactly one opened workspace, and the outcome is reported as `ambiguous` when the spawn
 * came back neither cleanly opened nor cleanly refused.
 *
 * ## Rule 2, concretely
 *
 * What gets opened is a `cmux spawn` — a VISIBLE, interactive workspace the owner can watch in their sidebar
 * and interrupt while it runs. Nothing here detaches a model, nothing is resident, and the investigation is
 * pinned to Opus because it is an investigation rather than a mechanical leaf (rule 5's own division).
 *
 * Every effect is injected, so the whole decision path is unit-tested without touching a socket or a file.
 */

import type { Result } from "#lib/result.js";
import {
  type CodexDrawdownEpisode,
  type CodexDrawdownEvaluation,
  type CodexDrawdownPolicy,
  type CodexDrawdownSample,
  DEFAULT_CODEX_DRAWDOWN_POLICY,
  evaluateCodexDrawdown,
  renderCodexDrawdown,
} from "./drawdownAnomaly.js";
import type { CodexDrawdownError } from "./drawdownErrors.js";
import {
  admitCodexDrawdownInvestigation,
  type CodexDrawdownJournalEvent,
  type CodexDrawdownJournalRead,
  codexSamplesOf,
  unseenCodexSamples,
} from "./drawdownJournal.js";
import type { CodexEpisodeClaim } from "./drawdownJournalStore.js";
import { codexDrawdownSamples } from "./drawdownSeries.js";
import type { CodexGauge } from "./gauge.js";

/** What this pass is allowed to do. */
export type CodexDrawdownTickMode = "dry-run" | "sample-only" | "watch";

/** Where a visible investigation came up. */
export interface CodexInvestigationReceipt {
  readonly episodeId: string;
  readonly workspaceRef: string;
}

/**
 * Every effect the tick needs, injected. Each takes one named object, so no call site can transpose two.
 *
 * @internal the parameter shape of {@link processCodexDrawdownTick}, never imported by name.
 */
export interface CodexDrawdownTickDeps {
  readonly readJournal: (input: { home: string }) => Result<CodexDrawdownJournalRead, CodexDrawdownError>;
  readonly appendJournal: (input: {
    home: string;
    events: readonly CodexDrawdownJournalEvent[];
  }) => Result<undefined, CodexDrawdownError>;
  readonly claimEpisode: (input: {
    home: string;
    episodeId: string;
    nowIso: string;
  }) => Result<CodexEpisodeClaim, CodexDrawdownError>;
  readonly openInvestigation: (input: {
    episode: CodexDrawdownEpisode;
    nowIso: string;
  }) => Promise<Result<CodexInvestigationReceipt, CodexDrawdownError>>;
}

/**
 * What happened to the investigation on this pass.
 *
 * `ambiguous` is its own outcome rather than folded into `failed`: a spawn that reported a workspace ref and
 * then errored may have left a real workspace open, and somebody has to go and look. Collapsing the two
 * would make that workspace invisible.
 *
 * @internal a field of the exported outcome, never imported by name.
 */
export type CodexInvestigationOutcome = "none" | "suppressed" | "opened" | "failed" | "ambiguous";

/** What this pass did. */
export interface CodexDrawdownTickOutcome {
  readonly evaluation: CodexDrawdownEvaluation;
  readonly investigation: CodexInvestigationOutcome;
  /** How many readings this pass had not seen before and journalled. */
  readonly recorded: number;
  readonly lines: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Run one pass.
 *
 * @param gauges the readings this tick already took — never re-read here, so one pass opens the log once
 * @param home the state home the journal and claims live under
 * @param nowIso the instant the baseline is judged from
 * @param mode what this pass may do
 * @param policy the tuning, defaulting to the shipped candidate settings
 * @param deps the injected effects
 * @returns what it decided, how much it recorded, the lines to print, and anything that went wrong
 */
export async function processCodexDrawdownTick({
  gauges,
  home,
  nowIso,
  mode,
  policy = DEFAULT_CODEX_DRAWDOWN_POLICY,
  deps,
}: {
  gauges: readonly CodexGauge[];
  home: string;
  nowIso: string;
  mode: CodexDrawdownTickMode;
  policy?: CodexDrawdownPolicy;
  deps: CodexDrawdownTickDeps;
}): Promise<CodexDrawdownTickOutcome> {
  const read = deps.readJournal({ home });
  if (read.isErr()) {
    return notMeasured({ errors: read.error.problems, why: "the journal could not be read" });
  }
  if (read.value.unreadable > 0) {
    // A lost reading is a WRONG baseline, not a smaller one — the pace it would have contributed is missing
    // from the denominator, so the survivors look faster than they were. Judging nothing is the honest
    // answer, and it is emphatically not `normal`.
    return notMeasured({
      errors: [`${String(read.value.unreadable)} journal line(s) could not be parsed`],
      why: `${String(read.value.unreadable)} journal line(s) will not parse, so the baseline is unknowable`,
    });
  }
  const journalled = codexSamplesOf({ events: read.value.events });
  const fresh = unseenCodexSamples({ journalled, read: codexDrawdownSamples({ gauges }) });
  const evaluation = evaluateCodexDrawdown({ current: fresh, history: journalled, nowIso, policy });
  const lines = [...renderCodexDrawdown({ evaluation })];
  const written = record({ deps, fresh, home, mode });
  const errors = written.errors;
  const recorded = written.recorded;

  const episode = evaluation.episode;
  if (episode === undefined) {
    return { errors, evaluation, investigation: "none", lines, recorded };
  }
  if (mode !== "watch") {
    return {
      errors,
      evaluation,
      investigation: "none",
      lines: [...lines, `  no investigation: ${mode} never opens one, by design`],
      recorded,
    };
  }
  return investigate({
    history: read.value.events,
    pass: { deps, episode, errors, evaluation, home, lines, nowIso, recorded },
  });
}

/**
 * Journal this tick's unseen readings, unless the mode forbids writing.
 *
 * `dry-run` is the one mode that writes nothing at all, and it is checked HERE rather than at the call site
 * so that "reading never writes" is a property of the one function that can write.
 *
 * @param deps the injected effects
 * @param fresh the readings this tick had not seen before
 * @param home the state home
 * @param mode what this pass may do
 * @returns how many landed, and anything that went wrong
 */
function record({
  deps,
  fresh,
  home,
  mode,
}: {
  deps: CodexDrawdownTickDeps;
  fresh: readonly CodexDrawdownSample[];
  home: string;
  mode: CodexDrawdownTickMode;
}): { readonly recorded: number; readonly errors: readonly string[] } {
  if (mode === "dry-run" || fresh.length === 0) {
    return { errors: [], recorded: 0 };
  }
  const appended = deps.appendJournal({ events: fresh, home });
  if (appended.isErr()) {
    return { errors: appended.error.problems, recorded: 0 };
  }
  return { errors: [], recorded: fresh.length };
}

/**
 * The pass that judged nothing, because the evidence it would have judged is not readable.
 *
 * Its verdict is `warming` rather than `normal` for the reason the whole detector is built on: a report that
 * nothing fired must never read as a finding that consumption is ordinary.
 *
 * @param errors what went wrong
 * @param why the sentence the report leads with
 * @returns an outcome that opened nothing and claims nothing
 */
function notMeasured({ errors, why }: { errors: readonly string[]; why: string }): CodexDrawdownTickOutcome {
  const evaluation: CodexDrawdownEvaluation = {
    baselines: [],
    episode: undefined,
    latestSampleAtIso: undefined,
    observedSpanMs: 0,
    samples: 0,
    verdict: "warming",
    why,
  };
  return {
    errors,
    evaluation,
    investigation: "none",
    lines: [`codex burn: NOT MEASURED — ${why}`],
    recorded: 0,
  };
}

/**
 * Everything the investigating half carries from one step to the next.
 *
 * A carried object rather than nine repeated parameters, and it earns its place twice over: each of the five
 * places that stops without spawning has to rebuild the SAME outcome, and threading the pieces separately is
 * what made the first version of this two functions long enough for the length gate to catch.
 *
 * @internal the shared parameter of this file's private helpers, never imported by name.
 */
interface InvestigationPass {
  readonly deps: CodexDrawdownTickDeps;
  readonly episode: CodexDrawdownEpisode;
  readonly errors: readonly string[];
  readonly evaluation: CodexDrawdownEvaluation;
  readonly home: string;
  readonly lines: readonly string[];
  readonly nowIso: string;
  readonly recorded: number;
}

/**
 * One outcome, built from the pass plus what this step decided.
 *
 * Every ending goes through here, which is what keeps `investigation` and the printed note in step: an arm
 * that reported `suppressed` while printing a spawn line would be a lie about what happened, and there is
 * now one place that could tell it.
 *
 * @param pass what the investigating half is carrying
 * @param investigation which ending this is
 * @param note the line to append to the report, or undefined when this ending adds none
 * @param added anything that went wrong at this step
 * @returns the outcome
 */
function ending({
  pass,
  investigation,
  note,
  added = [],
}: {
  pass: InvestigationPass;
  investigation: CodexInvestigationOutcome;
  note?: string;
  added?: readonly string[];
}): CodexDrawdownTickOutcome {
  return {
    errors: [...pass.errors, ...added],
    evaluation: pass.evaluation,
    investigation,
    lines: note === undefined ? pass.lines : [...pass.lines, note],
    recorded: pass.recorded,
  };
}

/**
 * The half of a pass that may open a workspace: admit, CLAIM, journal, spawn, record.
 *
 * Split from {@link processCodexDrawdownTick} because it is the only part with an effect on the world, so
 * "reading never spawns" is a property of which function ran rather than of a branch buried inside a long
 * one.
 *
 * @param pass what this pass is carrying
 * @param history every event already journalled, which the first admission check reads
 * @returns what this pass did
 */
async function investigate({
  pass,
  history,
}: {
  pass: InvestigationPass;
  history: readonly CodexDrawdownJournalEvent[];
}): Promise<CodexDrawdownTickOutcome> {
  const admission = admitCodexDrawdownInvestigation({ episodeId: pass.episode.episodeId, history });
  if (admission.kind === "suppress") {
    return ending({ investigation: "suppressed", note: `  no new investigation: ${admission.reason}`, pass });
  }
  // The CLAIM, not the journal row below, is what makes this at-most-once. Taken BEFORE the spawn, so a
  // process that dies here leaves the episode claimed rather than open for the next tick to try again.
  const claim = pass.deps.claimEpisode({ episodeId: pass.episode.episodeId, home: pass.home, nowIso: pass.nowIso });
  if (claim.isErr()) {
    // An unreadable or unwritable claim means the suppression state is UNKNOWN, and unknown must never read
    // as free: spawning here is how one anomaly opens a workspace on every tick.
    return ending({
      added: claim.error.problems,
      investigation: "failed",
      note: "  no investigation opened: the episode claim could not be taken, so none was attempted",
      pass,
    });
  }
  if (claim.value.kind === "held") {
    return ending({ investigation: "suppressed", note: `  no new investigation: ${claim.value.reason}`, pass });
  }
  const journalled = journal({
    event: {
      episodeId: pass.episode.episodeId,
      kind: "episode-opened",
      openedAtIso: pass.nowIso,
      schemaVersion: 1,
      triggers: pass.episode.triggers,
    },
    pass,
  });
  // A lost row does NOT stop the spawn: the claim is the lock, and refusing here would mean a full disk
  // silences the detector entirely. The loss travels on the errors instead.
  return spawnAndRecord({ pass: { ...pass, errors: [...pass.errors, ...journalled] } });
}

/**
 * Append one event, returning anything that went wrong rather than throwing.
 *
 * @param event the row to append
 * @param pass what this pass is carrying
 * @returns the append's own errors, empty when it landed
 */
function journal({ event, pass }: { event: CodexDrawdownJournalEvent; pass: InvestigationPass }): readonly string[] {
  const appended = pass.deps.appendJournal({ events: [event], home: pass.home });
  return appended.isErr() ? appended.error.problems : [];
}

/**
 * Open the workspace and record which way it went.
 *
 * @param pass what this pass is carrying
 * @returns what this pass did
 */
async function spawnAndRecord({ pass }: { pass: InvestigationPass }): Promise<CodexDrawdownTickOutcome> {
  const spawned = await pass.deps.openInvestigation({ episode: pass.episode, nowIso: pass.nowIso });
  if (spawned.isErr()) {
    return recordFailure({ pass, reasons: spawned.error.problems });
  }
  const workspaceRef = spawned.value.workspaceRef;
  journal({
    event: {
      episodeId: pass.episode.episodeId,
      kind: "investigation-opened",
      recordedAtIso: pass.nowIso,
      schemaVersion: 1,
      workspaceRef,
    },
    pass,
  });
  return ending({
    investigation: "opened",
    note: `  investigation opened in ${workspaceRef} — visible, and yours to interrupt`,
    pass,
  });
}

/**
 * Journal and report a spawn that did not come up cleanly.
 *
 * The whole point of the split is the FAILED/AMBIGUOUS distinction: a spawn that named a workspace before
 * failing may have left a real one open, and somebody has to go and close it. Collapsing the two would make
 * that workspace invisible.
 *
 * @param pass what this pass is carrying
 * @param reasons what the spawn reported
 * @returns what this pass did
 */
function recordFailure({
  pass,
  reasons,
}: {
  pass: InvestigationPass;
  reasons: readonly string[];
}): CodexDrawdownTickOutcome {
  const reason = reasons.join("; ");
  const ref = workspaceRefIn({ reason });
  journal({
    event: {
      episodeId: pass.episode.episodeId,
      kind: "investigation-failed",
      reason,
      recordedAtIso: pass.nowIso,
      schemaVersion: 1,
      workspaceRef: ref,
    },
    pass,
  });
  if (ref === undefined) {
    return ending({
      added: reasons,
      investigation: "failed",
      note: `  investigation FAILED to open: ${reason} — not retried automatically`,
      pass,
    });
  }
  return ending({
    added: reasons,
    investigation: "ambiguous",
    note: `  investigation AMBIGUOUS: ${reason} — workspace ${ref} may be open and needs a human look`,
    pass,
  });
}

/**
 * The workspace ref a spawn failure carried, when it carried one.
 *
 * `./drawdownInvestigation.ts` appends `(workspace <ref>)` to a failure whose spawn reported one, because a
 * spawn can open a workspace and then fail to boot it. Reading it back here is what turns that failure into
 * `ambiguous` rather than `failed` — the difference between "nothing happened" and "something may be open".
 *
 * @param reason the joined failure text
 * @returns the ref, or undefined when the failure named none
 */
function workspaceRefIn({ reason }: { reason: string }): string | undefined {
  return /\(workspace (?<ref>[^)]+)\)/u.exec(reason)?.groups?.["ref"];
}

/**
 * What the investigating session is told to do.
 *
 * It is pointed at evidence and asked to explain, never told to change anything. The plan is explicit that
 * this must not automatically abort passes or remove pass kinds, and a session that started doing either
 * would be acting on a judgement the owner reserved. The brief carries BOTH the rate evidence and the
 * marginal history from `codex usage`, so the session can judge whether the spend was worth it rather than
 * only that it happened.
 *
 * @param episode the episode that fired
 * @returns the pickup text
 */
export function codexDrawdownBrief({ episode }: { episode: CodexDrawdownEpisode }): string {
  const windows = episode.triggers
    .map(
      (trigger) =>
        `${trigger.accountScope}/${trigger.limitId} ${String(trigger.windowMinutes)}-minute window at ` +
        `${trigger.currentPercentPointsPerHour.toFixed(2)} points/h, ${trigger.ratio.toFixed(1)}x its normal ` +
        `${trigger.baselinePercentPointsPerHour.toFixed(2)} (${trigger.fromIso} … ${trigger.toIso})`,
    )
    .join("; ");
  return [
    `Codex burn anomaly at ${episode.observedAtIso}: ${windows}.`,
    "",
    "Find out WHY, and report it. Do not abort a running pass, remove a pass kind, change an account or",
    "close anything.",
    "",
    "Start with `slopweaver codex usage` — it counts every recorded pass per arm with its token subtotal and",
    "what it found, so the arms responsible for a spike are the ones at the top of that table. Add",
    "`--diff-sha256 <sha>` for a diff's marginal history: how many review invocations it has already had and",
    "what each one found, which is what says whether the spend was buying anything. Then",
    "`slopweaver codex gauge --json` for the current window readings, and the burn journal under",
    "`codex-burn/drawdown.jsonl` for the readings this fired on.",
    "",
    "Answer three things: which passes account for the change, whether the cause is legitimate work or a",
    "defect, and whether anything needs the owner's attention now.",
  ].join("\n");
}
