/**
 * What a dispatched turn's live card SAYS while its worker works — the one concern behind every writer that
 * touches that message, lifted out of `./dispatchSweep.ts` when that file passed the size ratchet.
 *
 * The seam is real rather than a size dodge. `./dispatchSweep.ts` answers "what state is each dispatched ask
 * in" — ready, working, phantom, past its lease — and its findings are for the loop session reading stdout.
 * This file answers "what does the person in the Slack thread see right now", which has its own sources, its
 * own preference order between them, and its own staleness probe. Two of its exports are used by writers
 * that are not the sweep at all (`./status.ts`'s self-report and `./watch.ts`'s ticker both advance through
 * `attemptChecklistAdvance` over a `LiveChecklistUpdatePlan`), which is the clearest sign it was never the
 * sweep's private business.
 *
 * ## Three sources for one line, best first
 *
 * The running step's detail comes from whichever of these speaks first, and the order is the whole design:
 *
 * 1. **The worker's own transcript** ({@link liveChecklistUpdatePlan}'s `workerDetail`), rendered by
 *    `../../../live/turn/progressCard.js`'s `nowLine` off `../../../live/turn/workerLog.js`. It names the
 *    tool AND its target, and the harness writes it rather than the model, so it cannot be forgotten
 *    mid-investigation.
 * 2. **The workspace's terminal screen** (`../../../live/turn/liveStatus.js`), a heuristic over free-form
 *    text with no grammar — the degraded path for a worker that never announced which session it is.
 * 3. **The staleness line**, which at least says when the turn was last heard from.
 *
 * Only the second can come from the sweep alone, which has no way to reach the first by itself: it runs in
 * the LOOP session, so the worker's own session id has to be recorded. `../../../live/turn/workerSessionStore.js`
 * is what closed that, and its header carries the measurement.
 */

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { bundledLauncherPath } from "../../../lib/pluginRoot.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { AskLifecycle } from "../../../live/ask/lifecycle.js";
import type { ProcessSnapshot } from "../../../live/standing/inspect.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import { checkpointCardLine } from "../../../live/turn/checkpointStore.js";
import type { FreshDispatchRecord } from "../../../live/turn/dispatch.js";
import { liveStatusFromScreen, stalledDetail } from "../../../live/turn/liveStatus.js";
import { liveChecklistAdvancer } from "../../../live/turn/poster.js";
import {
  activityWindowStart,
  liveLineOf,
  nowLine,
  progressChecklistSteps,
  turnClockLead,
} from "../../../live/turn/progressCard.js";
import {
  appendProgressLogEvent,
  openProgressGap,
  type ProgressGap,
  type ProgressLog,
  type ProgressStageEvent,
  type ProgressTimelineEvent,
  progressGapsExceeding,
  readProgressLog,
  worstProgressGap,
} from "../../../live/turn/progressLog.js";
import type { TurnPoster, TurnProvenance } from "../../../live/turn/run.js";
import { turnTaskLabel } from "../../../live/turn/taskLabel.js";
import { latestWorkerActivity } from "../../../live/turn/workerLog.js";
import { currentGenerationWorkerSession } from "../../../live/turn/workerSessionStore.js";
import { dispatchedWorkerLabel } from "../../../supervisor/session.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";
import { budgetWarned } from "./dispatchBudget.js";
import type { LiveScreenRead } from "./liveScreenRead.js";
import { ORPHAN_SILENCE_MS } from "./tickerOwner.js";

/**
 * Whether any live process is the `turn watch` ticker for this dispatch's own brief. Pure.
 *
 * Matched on the BRIEF PATH, not just the verb: a machine running the loop answers several asks at once and
 * `--brief` is the only argument that names which ask a ticker belongs to. An `unreadable` table is
 * `undefined` rather than `false` for the reason `../../../live/standing/inspect.ts` keeps that arm at all —
 * "no ticker is running" is a verdict, and a table nobody could read establishes neither.
 *
 * @param briefPath the brief this dispatch's ticker would have been started with
 * @param snapshot one reading of the process table
 * @returns whether a ticker is running, or `undefined` when the table could not be read
 */
export function tickerRunning({
  briefPath,
  snapshot,
}: {
  briefPath: string;
  snapshot: ProcessSnapshot;
}): boolean | undefined {
  if (snapshot.kind === "unreadable") {
    return undefined;
  }
  return snapshot.rows.some((row) => row.argv.includes("turn watch") && row.argv.includes(briefPath));
}

/**
 * The clause a `card-stale:` line carries when the reason the card stopped moving is that nobody started its
 * clock — the cause beside the symptom, and the exact command that fixes it. Pure.
 *
 * **Why this rides the existing line instead of being its own.** MEASURED on ask
 * a real ask: the loop session read `card-stale:`, then ran
 * `pgrep -fl "turn watch"` twice five minutes apart to work out WHY, then composed the remedy by hand. Every
 * step after the first is something the sweep already had the information to say. A second line would make
 * the reader join two, which is the same cost in a different place — and rule 7 is about what a reader has
 * to hold, not about how many lines a program prints.
 *
 * `undefined` in either direction prints nothing: a ticker that IS running means the card is stale for some
 * other reason and this has no business guessing at it, and a table nobody could read is not evidence.
 *
 * **The launcher is passed in RESOLVED, and that is the whole of the launcher-path fix.** The clause never
 * emits the literal `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver"` — the form a `SKILL.md` correctly
 * uses, because the harness substitutes it there. The loop session that reads this line sends it to a
 * WORKER, who pastes it into a shell, where that variable is empty: the command would become
 * `/bin/slopweaver`, which does not exist, and the trailing `&` means the shell backgrounds the failure
 * and reports exit 0. The remedy would be inert in exactly the case it exists for. See
 * `../../../lib/pluginRoot.ts`'s `bundledLauncherPath`, and the `unexpanded-plugin-root` gate that now
 * refuses the literal.
 *
 * @param briefPath the brief the remedy command must name
 * @param launcher the absolute `bin/slopweaver` path the worker is to run, resolved by the caller so this
 *   stays pure
 * @param running whether a ticker is running, from {@link tickerRunning}
 * @returns the clause to append, or the empty string when there is nothing to say
 */
export function tickerMissingClause({
  briefPath,
  launcher,
  running,
}: {
  briefPath: string;
  launcher: string;
  running: boolean | undefined;
}): string {
  if (running !== false) {
    return "";
  }
  return (
    "; no `turn watch` process is running for this dispatch, which is why — send the worker: " +
    `\`"${launcher}" turn watch --brief ${briefPath} &\``
  );
}

/**
 * How long a live card may go unchanged before the sweep says so out loud.
 *
 * Five minutes, and it is measured rather than picked: run over three real dogfood turns, a
 * five-minute bound fires on ALL THREE and a ten-minute bound on only two, so five is the smallest bound
 * that catches every turn the owner actually complained about. See
 * `src/__tests__/unit/live/turn/progressLog.test.ts`, which asserts the exact gaps off that day's timeline.
 *
 * @internal
 */
export const CARD_STALE_AFTER_MINUTES = 5;

/**
 * The sweep's own line for a card that has stopped moving while its worker is alive — the staleness probe,
 * reported where a supervisor already looks rather than on a board nobody opens. Pure; the effectful shell
 * is {@link staleCardLine}.
 *
 * This is only possible because every writer records its writes: `turn answer` DELETES the card, and Slack
 * exposes no edit history, so the progress log is the only place a gap can be measured at all.
 *
 * ## It used to describe the past in the present tense, and it under-reported
 *
 * MEASURED on two live tags. The line was built from
 * `progressGapsExceeding(...)[length - 1]` — the most RECENT qualifying gap, taken into a binding named
 * `worst` — and that array is a turn's whole history, so a gap never leaves it once it qualifies. Two
 * defects fell out of the one expression:
 *
 * - **One card was announced as "not changed for 5.1m" while it was writing every twenty seconds.** 64
 *   writes, the last 0.4m before the sweep ran; the 5.1m gap it named had closed 48 minutes earlier. The
 *   day's other card, with identical freshness and no historical gap, drew no alarm. One brief stall early in a
 *   turn made the alarm fire for the rest of that turn's working life.
 * - **That other card's real 9.2m stall was reported as 5.1m**, because a smaller qualifying gap came later
 *   and "last" is not "worst".
 *
 * So the present-tense claim now comes from {@link openProgressGap} — the one gap that is still open — and
 * the number a reader should act on comes from {@link worstProgressGap}. When the turn's worst stall is
 * worse than the one in progress, the line says so in the PAST tense rather than conflating the two.
 *
 * @param entry the ask being swept
 * @param log the turn's folded progress log
 * @param nowIso the current instant, which closes the open gap
 * @param startedIso when the card was first posted — the first boundary
 * @returns the line to write, or `undefined` while the card is keeping up
 */
export function cardStaleSweepLine({
  entry,
  log,
  nowIso,
  startedIso,
  tickerClause = "",
}: {
  entry: AskIdentity;
  log: ProgressLog;
  nowIso: string;
  startedIso: string;
  tickerClause?: string;
}): string | undefined {
  const bounds = { boundMinutes: CARD_STALE_AFTER_MINUTES, log, nowIso, startedIso };
  const open = openProgressGap(bounds);
  if (open === undefined) {
    return undefined;
  }
  const worst = worstProgressGap({ gaps: progressGapsExceeding(bounds) });
  return (
    `card-stale: ${entry.channel}/${entry.messageTs} — the card has not changed for ` +
    `${String(open.minutes)}m (since ${open.fromIso}) while its worker is still working` +
    worstStallPart({ open, worst }) +
    tickerClause
  );
}

/**
 * The past-tense half of {@link cardStaleSweepLine}: empty unless an EARLIER stall beat the one in progress.
 *
 * @param open the gap currently open, already reported in the present tense
 * @param worst the longest gap of the whole turn
 * @returns the clause to append, or the empty string when the open gap is already the worst
 */
function worstStallPart({ open, worst }: { open: ProgressGap; worst: ProgressGap | undefined }): string {
  if (worst === undefined || worst.minutes <= open.minutes) {
    return "";
  }
  return `; its worst stall this turn was ${String(worst.minutes)}m (since ${worst.fromIso}), already closed`;
}

/**
 * {@link cardStaleSweepLine} for one ask, reading its progress log off disk.
 *
 * @param briefPath this dispatch's own brief, which names which ticker would be its own
 * @param entry the ask being swept
 * @param home the resolved state home
 * @param nowIso the current instant
 * @param snapshot one reading of the process table, for the ticker clause
 * @returns the line to write, or `undefined` while the card is keeping up
 */
export function staleCardLine({
  briefPath,
  entry,
  home,
  nowIso,
  snapshot,
}: {
  briefPath: string;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  snapshot: ProcessSnapshot;
}): string | undefined {
  return cardStaleSweepLine({
    entry,
    log: readProgressLog({ askIdentity: entry, home }),
    nowIso,
    startedIso: entry.capturedIso,
    tickerClause: tickerMissingClause({
      briefPath,
      launcher: bundledLauncherPath({ importMetaUrl: import.meta.url }),
      running: tickerRunning({ briefPath, snapshot }),
    }),
  });
}

/**
 * The `now:` line rendered from the WORKER's own transcript, when that worker announced which visible
 * session it is — the same reading, through the same two functions, that `./watch.ts`'s ticker makes.
 *
 * This is what lets the sweep keep a card honest for a worker that never started the ticker. MEASURED on a real
 * ask: with only the screen scrape to work from, the sweep's four
 * pushes over nineteen minutes all carried the single character `─`, and the owner watched a card
 * that had not said anything for ten-plus minutes on a thread the owner was reading. The transcript was there the
 * whole time — once a ticker finally ran, the same source rendered `now: Bash (started 3m
 * ago) · 46 tool calls so far`. Reproduce both halves:
 *
 * ```bash
 * cut -c1-80 "$SLOPWEAVER_HOME/live/slack/progress/C0SYN000009-1789344513.735589.jsonl"
 * ```
 *
 * **It does not retire the ticker.** The sweep runs at the loop's own pace, which on that turn was a push
 * every 6.3–6.6 minutes — still past the five-minute bound `staleCardLine` judges a card by. The ticker is
 * the cadence and this is the floor under it.
 *
 * @param askIdentity the ask whose worker this reads
 * @param home the resolved state home
 * @param nowIso the current instant
 * @param stages the turn's declared stages — the first one dates this turn's own slice of the transcript
 * @returns the rendered line, or `undefined` when no current-generation worker session is recorded
 */
function sweptWorkerDetail({
  askIdentity,
  home,
  nowIso,
  stages,
}: {
  askIdentity: AskIdentity;
  home: string;
  nowIso: string;
  stages: readonly ProgressStageEvent[];
}): string | undefined {
  const worker = currentGenerationWorkerSession({ askIdentity, home });
  if (worker === undefined) {
    return undefined;
  }
  // The same window `./watch.ts` reads — the first stage, else the ask's own instant — so the two writers
  // of one card never count a different slice of the same transcript.
  const sinceIso = activityWindowStart({ askTs: askIdentity.messageTs, firstStageIso: stages[0]?.tsIso, nowIso });
  const activity = latestWorkerActivity({ cwd: worker.cwd, sessionId: worker.sessionId, sinceIso });
  // A hung worker is not "still working": past the reap's own silence the clock says how long nothing moved.
  const turnClock = turnClockLead({
    askTs: askIdentity.messageTs,
    latestIso: activity.latest?.tsIso,
    nowIso,
    quietAfterMs: ORPHAN_SILENCE_MS,
  });
  return nowLine({ callsSoFar: activity.callsSoFar, latest: activity.latest, nowIso, turnClock });
}

/**
 * Push the checklist's in-flight step a genuinely live detail, sourced from the workspace's own screen —
 * the fix for the static "Investigate in a fresh visible session" a slow turn used to show for its whole
 * duration. Best-effort in every direction: no live detail on the screen, no recorded checklist ref, no bot
 * token, or an unreadable brief all mean "skip this tick, try again next sweep" rather than a refusal —
 * this is a courtesy update layered onto a sweep whose real job (readiness, lease expiry) already happened.
 *
 * @param entry the ask this dispatch is for — its `started` ref names the checklist message to advance
 * @param home the resolved state home
 * @param nowIso the current instant, for the staleness fallback
 * @param read this generation's live screen read (screen text + the dispatch record it came from)
 * @returns what the attempt did, or `undefined` when there was nothing worth pushing at all
 */
export async function pushLiveChecklistDetail({
  entry,
  home,
  nowIso,
  read,
}: {
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  read: LiveScreenRead & { readonly record: FreshDispatchRecord };
}): Promise<ChecklistAdvanceOutcome | undefined> {
  const started = entry.started;
  if (started === undefined) {
    return undefined;
  }
  const brief = readBrief({ path: read.record.briefPath });
  if (brief.isErr()) {
    return undefined;
  }
  const { stages, timeline } = readProgressLog({ askIdentity: entry, home });
  const plan = liveChecklistUpdatePlan({
    entry,
    nowIso,
    question: brief.value.question,
    // The sweep and `./watch.ts` edit ONE message, so a sweep that did not know this turn had inherited a
    // dead session's work would overwrite the ticker's resuming line with a mechanical one every pass.
    resuming: checkpointCardLine({ askIdentity: entry, home }),
    screen: read.screen,
    timeline,
    warned: budgetWarned({ askIdentity: entry, home, nowIso }),
    workerDetail: sweptWorkerDetail({ askIdentity: entry, home, nowIso, stages }),
  });
  if (plan === undefined) {
    return undefined;
  }
  const botToken = slackBotToken({ home });
  if (botToken === undefined) {
    return undefined;
  }
  const turnId = started.turnId;
  return advanceAndRecord({ botToken, entry, home, nowIso, plan, read, stageCount: stages.length, turnId });
}

/**
 * Make one swept card edit and record it if it landed. Split from {@link pushLiveChecklistDetail} so that
 * function stays under this repo's line cap; the split is where the DECISION ends and the write begins.
 *
 * @param botToken the Slack bot token
 * @param entry the ask this dispatch is for
 * @param home the resolved state home
 * @param nowIso the current instant
 * @param plan the exact advance already decided
 * @param read this generation's live screen read
 * @param stageCount how many stages the turn has written, recorded beside the write
 * @param turnId the id correlating this edit with its turn
 * @returns what the attempt did
 */
async function advanceAndRecord({
  botToken,
  entry,
  home,
  nowIso,
  plan,
  read,
  stageCount,
  turnId,
}: {
  botToken: string;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  plan: LiveChecklistUpdatePlan;
  read: LiveScreenRead & { readonly record: FreshDispatchRecord };
  stageCount: number;
  turnId: string;
}): Promise<ChecklistAdvanceOutcome> {
  const chrome = chromeFromProfile({ home });
  const supervisor = { host: read.record.session.host, id: read.record.session.surfaceRef };
  // The WORKER wrote this work, so the card must name the worker. `supervisorModelLabel` says "the
  // supervisor session" whoever the session is, which on every swept dispatch is false — the same mislabel
  // `./status.ts` also carries, and the same resolver fixes both.
  const provenance: TurnProvenance = {
    modelId: dispatchedWorkerLabel({
      host: read.record.session.host,
      workspaceRef: read.record.session.workspaceRef,
    }),
    supervisor,
  };
  const advancer = liveChecklistAdvancer({
    askIdentity: entry,
    doorLedger: doorLedgerPort(),
    home,
    provenance,
    transport: makeSlackWriteTransport({ home, token: botToken }),
    turnChrome: turnChromeFrom({ chrome }),
    turnId,
  });
  const outcome = await attemptChecklistAdvance({ advanceWorking: (p) => advancer.advanceWorking(p), plan });
  if (outcome.kind === "advanced") {
    // Recorded after the edit landed, like `./status.ts`'s own write — the staleness probe reads these, and
    // a write logged for a failed `chat.update` would score a frozen card as fresh.
    appendProgressLogEvent({
      askIdentity: entry,
      // The live line, not the last step: the loop's phases now sit after the outline, below the fold. A swept
      // plan is never finished nor blocked, so an outline step is always running — an honest `!`.
      event: { detail: liveLineOf({ steps: plan.steps })!, kind: "card-write", stageCount, tsIso: nowIso },
      home,
    });
  }
  return outcome;
}

/** What one live-checklist-advance attempt did. Never an exception a caller has to catch itself. */
export type ChecklistAdvanceOutcome =
  { readonly kind: "advanced" } | { readonly kind: "failed"; readonly reason: string };

/**
 * Attempt one live-checklist advance, turning a rejection into a typed outcome rather than a thrown error.
 *
 * This is a courtesy update layered onto a sweep whose real job (readiness, lease expiry) already ran for
 * this ask — a Slack failure pushing it must never abort the REST of the sweep's other entries. Before this
 * existed, an uncaught rejection here escaped `sweepOne` and could kill every ask still left in the loop.
 *
 * @param advanceWorking the real (or faked, in a test) Slack append call
 * @param plan the exact advance {@link liveChecklistUpdatePlan} already decided
 * @returns `"advanced"` on success, or `"failed"` with the rejection's reason — never a throw
 */
export async function attemptChecklistAdvance({
  advanceWorking,
  plan,
}: {
  advanceWorking: (plan: LiveChecklistUpdatePlan) => Promise<void>;
  plan: LiveChecklistUpdatePlan;
}): Promise<ChecklistAdvanceOutcome> {
  try {
    await advanceWorking(plan);
    return { kind: "advanced" };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The exact arguments one `TurnPoster.advanceWorking` call needs — what a live-checklist plan produces. */
export type LiveChecklistUpdatePlan = Parameters<TurnPoster["advanceWorking"]>[0];

/**
 * The first candidate that says anything — the ordered-preference primitive {@link liveChecklistUpdatePlan}
 * picks its running detail with. Pure.
 *
 * Spelled as a function rather than a `??` chain because the chain IS the silent substitution
 * `.claude/rules/typescript-patterns.md` bans: three sources of decreasing quality, and which one spoke is
 * the thing a reader of that call site needs to see.
 *
 * @param candidates the sources in preference order, best first
 * @returns the first one carrying text, or `undefined` when none did
 */
function firstDetail({ candidates }: { candidates: readonly (string | undefined)[] }): string | undefined {
  return candidates.find((candidate) => candidate !== undefined && candidate.length > 0);
}

/**
 * What {@link pushLiveChecklistDetail} would push for one ask, or `undefined` when there is nothing worth
 * pushing. Pure and total — the DECISION half of that function, split out so it is testable without a real
 * screen, a real brief file, or a real Slack transport anywhere near it.
 *
 * @param entry the ask this dispatch is for — its `started` ref names the checklist message to advance
 * @param nowIso the current instant, for deciding whether the silence is long enough to report
 * @param question the ask's own question, from its brief — what {@link turnTaskLabel} labels the task with
 * @param screen the workspace's current screen text, from `readScreen`
 * @param timeline the turn's stages, plans and review rounds, from its own progress log
 * @param workerDetail the `now:` line rendered from the worker's OWN transcript, when it announced itself
 * @param warned whether this dispatch carries a budget warn, which the running step then shows
 * @returns the exact `advanceWorking` call to make, or `undefined` when there is no checklist ref to advance
 *   and no live or stalled detail worth showing
 */
export function liveChecklistUpdatePlan({
  entry,
  nowIso,
  question,
  resuming,
  screen,
  timeline,
  warned = false,
  workerDetail,
}: {
  entry: AskLifecycle;
  nowIso: string;
  question: string;
  resuming?: string | undefined;
  screen: string;
  timeline: readonly ProgressTimelineEvent[];
  warned?: boolean;
  workerDetail?: string | undefined;
}): LiveChecklistUpdatePlan | undefined {
  const started = entry.started;
  if (started === undefined) {
    return undefined;
  }
  // Three sources, best first, each absent case named rather than collapsed into a `??` chain.
  //
  // The TRANSCRIPT beats the screen whenever the worker has told us which session it is: it carries the tool
  // and its target (`now: Bash (started 3m ago) · 46 tool calls so far`) and is written by the harness rather
  // than by whatever text last landed on a terminal. The screen scrape is the degraded path for a worker that
  // never announced itself, and the staleness line is the honest floor under both.
  const runningDetail = firstDetail({
    candidates: [
      workerDetail,
      liveStatusFromScreen({ screen }),
      stalledDetail({ lastHeardIso: entry.lastEvent.tsIso, nowIso }),
    ],
  });
  if (runningDetail === undefined) {
    return undefined;
  }
  // The STAGES come from the turn's own progress log, never from this sweep. That matters: the sweep and
  // `./status.ts` both edit one message, so a sweep that rebuilt the card from its own two-step vocabulary
  // would erase every finding the worker had recorded — the reader would watch the trail vanish and reappear
  // depending on which writer got there last.
  return {
    posted: { channel: entry.channel, ts: started.workingTs },
    steps: progressChecklistSteps({ finished: false, nowDetail: runningDetail, question, resuming, timeline, warned }),
    task: turnTaskLabel({ question }),
  };
}
