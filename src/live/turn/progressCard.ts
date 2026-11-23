/**
 * What the live card SAYS — the pure half of the progress ticker.
 *
 * Every function here is total and clock-injected, so the exact card a turn would show at a given instant is
 * assertable with no Slack, no filesystem and no running worker anywhere near it. The effectful half (read
 * the log, read the worker's command log, call `chat.update`) is `../../cli/commands/turn/watch.ts`.
 *
 * ## The shape, and where it came from
 *
 * The owner watches Claude's own Slack agent answer with a running checklist — ticked lines, an "as of"
 * stamp, each line a finished step carrying what it found — and reports that as legible. This module builds
 * that, drawn as the planning loop the owner asked for: a meter, the question, the worker's declared
 * plan with only the live step expanded (its latest finding and a mechanical `now:` line under it), and below
 * the fold every plan, re-plan, worker handover and review round with the findings filed in it.
 *
 * A card that held one 120-character detail replaced on every write left a reader who waited 45 minutes
 * unable to tell what had been learned in them (measured across three dogfood turns), which is
 * why every finding stays on the card.
 *
 * ## Why the `now:` line is mechanical and the stage lines are not
 *
 * A stage is the worker's own sentence — it already knows why it is doing what it is doing, and no other
 * source can say "8 of 10 bot PRs merged". The `now:` line is the opposite: it must be true at 90-second
 * granularity, which no model can be asked for without interrupting the work it is describing. So it is
 * derived from the worker's own command log — the last tool call it made, and how long ago — and it states
 * only what that log actually proves.
 */

import { slackTsToIso } from "#lib/slackTs.js";

import type { TodoStep } from "../../outbound/assistant/todoBlock.js";
import { CARD_LINE_CAP, clampVisible } from "./answer.js";
import type { ProgressTimelineEvent } from "./progressLog.js";
import { loopView, meterLine } from "./progressLoop.js";
import { loopSteps, outlineSteps } from "./progressOutline.js";
import { questionForPlainField } from "./quotedQuestion.js";
import { strippedAddressing } from "./taskLabel.js";
import { quietClockText, turnClockText } from "./turnClock.js";

// `CARD_LINE_CAP` is re-exported here (rather than only from `./answer.js`) so this module's own
// pre-existing callers — `../../cli/commands/turn/status.ts`, `../listen/capture.ts` — need no import
// change; see `./answer.js`'s own doc comment on the constant for why it moved there.
export { CARD_LINE_CAP };

/**
 * The card's step 0 id and title, fixed. Shared with `./answer.ts`'s own step lists so a card built here and
 * one built there never disagree about what the first line says.
 * @internal
 */
export const QUESTION_STEP_ID = "question";

/** One tool call the worker made, as its own command log records it. */
export interface WorkerActivity {
  readonly tsIso: string;
  readonly tool: string;
  readonly target: string | undefined;
}

/**
 * How long ago, in the words a person waiting actually uses. Whole minutes, because a card that says "just
 * now" for the first 59 seconds and "1m" after is telling the reader the only thing they asked.
 *
 * @param fromIso the earlier instant
 * @param toIso the later instant
 * @returns e.g. `just now`, `3m`, `1h 12m`, or `undefined` when either instant cannot be read
 */
export function elapsedWords({ fromIso, toIso }: { fromIso: string; toIso: string }): string | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return undefined;
  }
  const minutes = Math.floor(Math.max(0, to - from) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

/**
 * One shape a worker's own tool call can take, and the reader-facing phrase it becomes on the card.
 *
 * `targetPrefix`, when present, is matched against the call's (already leak-scrubbed) target — lower-cased,
 * prefix only — so a gloss can tell `slopweaver turn status …` apart from `slopweaver github …` without ever
 * quoting the command back to the reader. A rule with no `targetPrefix` matches every call the tool makes.
 */
interface ActivityGloss {
  readonly tool: string;
  readonly targetPrefix?: string;
  readonly phrase: string;
}

/**
 * The glosses this card knows, most-specific first within a tool — checked top to bottom, first match wins.
 * Never add a rule whose phrase embeds `target` or any part of it: the whole point of this table is that a
 * reader-facing line is composed FROM the shape of a call, never FROM its own text.
 */
const ACTIVITY_GLOSSES: readonly ActivityGloss[] = [
  { phrase: "checking the turn status", targetPrefix: "slopweaver turn status", tool: "Bash" },
  { phrase: "watching the progress card", targetPrefix: "slopweaver turn watch", tool: "Bash" },
  { phrase: "getting a second opinion", targetPrefix: "slopweaver turn review", tool: "Bash" },
  { phrase: "reading the corpus", targetPrefix: "slopweaver store", tool: "Bash" },
  { phrase: "checking the run board", targetPrefix: "slopweaver handover", tool: "Bash" },
  { phrase: "checking GitHub", targetPrefix: "slopweaver github", tool: "Bash" },
  { phrase: "checking Slack", targetPrefix: "slopweaver slack", tool: "Bash" },
  { phrase: "checking Linear", targetPrefix: "slopweaver linear", tool: "Bash" },
  { phrase: "running the test gate", targetPrefix: "yarn test", tool: "Bash" },
  { phrase: "running the test gate", targetPrefix: "yarn validate", tool: "Bash" },
  { phrase: "running the lint gate", targetPrefix: "yarn lint", tool: "Bash" },
  { phrase: "checking GitHub", targetPrefix: "gh ", tool: "Bash" },
  { phrase: "checking git state", targetPrefix: "git ", tool: "Bash" },
  { phrase: "reading a file", tool: "Read" },
  { phrase: "searching the code", tool: "Grep" },
  { phrase: "looking for files", tool: "Glob" },
  { phrase: "editing a file", tool: "Edit" },
  { phrase: "editing a file", tool: "Write" },
  { phrase: "checking a webpage", tool: "WebFetch" },
  { phrase: "searching the web", tool: "WebSearch" },
  { phrase: "updating its checklist", tool: "TodoWrite" },
  { phrase: "running a subagent", tool: "Agent" },
  { phrase: "running a subagent", tool: "Task" },
];

/**
 * The reader-facing phrase for one tool call — never the call's own argv, sanitised or not. Falls back to
 * the bare tool name when nothing in {@link ACTIVITY_GLOSSES} fits, which is still honest (it names WHAT
 * kind of thing is running) without ever risking a leak class this table's author never anticipated.
 *
 * @param target the call's own (already leak-scrubbed) subject, or `undefined` when it named none
 * @param tool the tool name the worker's own transcript recorded
 * @returns the phrase to show in place of the tool call's own text
 */
export function activityGloss({ target, tool }: { target: string | undefined; tool: string }): string {
  const lowerTarget = target?.toLowerCase();
  for (const gloss of ACTIVITY_GLOSSES) {
    if (gloss.tool !== tool) {
      continue;
    }
    if (gloss.targetPrefix === undefined) {
      return gloss.phrase;
    }
    if (lowerTarget?.startsWith(gloss.targetPrefix) === true) {
      return gloss.phrase;
    }
  }
  return tool;
}

/**
 * How long the reader has been waiting, as the card's clock — measured from the ask's own Slack `ts`, the
 * moment the ask arrived, so it spans capture, dispatch and every generation of worker alike. `./turnClock.ts`
 * carries the incident this closes.
 *
 * @param askTs the asking message's Slack timestamp
 * @param nowIso the current instant
 * @returns e.g. `still working, 22m`, or `undefined` when either instant cannot be read
 */
export function stillWorkingLead({ askTs, nowIso }: { askTs: string; nowIso: string }): string | undefined {
  const askedIso = slackTsToIso({ ts: askTs });
  if (askedIso === undefined) {
    return undefined;
  }
  const elapsed = elapsedWords({ fromIso: askedIso, toIso: nowIso });
  if (elapsed === undefined) {
    return undefined;
  }
  return turnClockText({ elapsed });
}

/**
 * The clock a card writer that reads the session's activity leads with: `still working, 22m` while the
 * session is visibly moving, and the quiet form (`./turnClock.ts`) once its last tool call — or, with none
 * visible, the ask itself — is `quietAfterMs` old. "Still working" is a claim about the worker, so past
 * that bound it is only made while the worker's own log supports it; inside it, a turn with no visible call
 * yet (just dispatched, or a Codex worker with no transcript) is given the same grace the reap gives it.
 *
 * @param askTs the asking message's Slack timestamp
 * @param latestIso the session's last tool call this turn, or `undefined` when none is visible
 * @param nowIso the current instant
 * @param quietAfterMs the silence past which the turn is no longer called working — the ticker's reap bound
 * @returns the lead, or `undefined` when the ask's instant cannot be read
 */
export function turnClockLead({
  askTs,
  latestIso,
  nowIso,
  quietAfterMs,
}: {
  askTs: string;
  latestIso: string | undefined;
  nowIso: string;
  quietAfterMs: number;
}): string | undefined {
  const askedIso = slackTsToIso({ ts: askTs });
  if (askedIso === undefined) {
    return undefined;
  }
  const waited = elapsedWords({ fromIso: askedIso, toIso: nowIso });
  if (waited === undefined) {
    return undefined;
  }
  const nowMs = Date.parse(nowIso);
  if (latestIso === undefined) {
    // No visible call yet: the ask itself is the last sign of life, and nothing has a quiet reading.
    if (nowMs - Date.parse(askedIso) < quietAfterMs) {
      return turnClockText({ elapsed: waited });
    }
    return quietClockText({ quiet: undefined, waited });
  }
  if (nowMs - Date.parse(latestIso) < quietAfterMs) {
    return turnClockText({ elapsed: waited });
  }
  return quietClockText({ quiet: elapsedWords({ fromIso: latestIso, toIso: nowIso }), waited });
}

/**
 * Where a worker's command log starts counting for this turn: its first stage, else the moment the ask was
 * made — never "now".
 *
 * A session's transcript is append-only from boot, so counting from the session would fold in whatever it did
 * before this ask arrived; the ask's own instant excludes exactly that. "Now" was the old stage-less window,
 * and it read nothing, ever: every inline turn declares no stage, so its ticker saw no activity, rendered no
 * subject, and could never be reaped as orphaned — a dead loop's card would have ticked on for the whole lease.
 *
 * @param askTs the asking message's Slack timestamp
 * @param firstStageIso the turn's first declared stage, when it has one
 * @param nowIso the current instant, the window only when neither of the others can be read
 * @returns the instant to count from
 */
export function activityWindowStart({
  askTs,
  firstStageIso,
  nowIso,
}: {
  askTs: string;
  firstStageIso: string | undefined;
  nowIso: string;
}): string {
  if (firstStageIso !== undefined) {
    return firstStageIso;
  }
  const askedIso = slackTsToIso({ ts: askTs });
  if (askedIso === undefined) {
    return nowIso;
  }
  return askedIso;
}

/**
 * The `now:` line under the running step — what the worker is doing this minute, from its own command log.
 *
 * Says `still working` rather than inventing a subject when the log has nothing recent: the honest failure
 * of this line is silence about the target, never a stale target presented as current. That is the exact
 * defect `./liveStatus.ts`'s screen scrape has (it shows whatever text last landed on the terminal), and
 * repeating it here with a nicer label would be worse, not better.
 *
 * The subject is always {@link activityGloss}'s phrase, never the call's own argv — a reader in the channel
 * has no context for `slopweaver turn status --brief …`, and a sanitised command is still a command.
 *
 * With a `turnClock` the line LEADS with it, ahead of the clamp so only the tail is ever cut, and an empty
 * log reads as the clock alone: `0 tool calls so far` is what a turn whose log cannot be read — every inline
 * turn, which has no stage to count from — would otherwise claim forever.
 *
 * @param callsSoFar how many tool calls the worker has made this turn, for a coarse "is it busy" signal
 * @param latest the worker's most recent tool call, or `undefined` when its log has none
 * @param nowIso the current instant
 * @param turnClock the reader's elapsed wait from {@link turnClockLead} or {@link stillWorkingLead}, when known
 * @returns the clamped line
 */
export function nowLine({
  callsSoFar,
  latest,
  nowIso,
  turnClock,
}: {
  callsSoFar: number;
  latest: WorkerActivity | undefined;
  nowIso: string;
  turnClock?: string | undefined;
}): string {
  const calls = `${String(callsSoFar)} tool call${callsSoFar === 1 ? "" : "s"} so far`;
  if (latest === undefined) {
    if (turnClock !== undefined) {
      return clampVisible({ cap: CARD_LINE_CAP, text: `now: ${turnClock}` });
    }
    return clampVisible({ cap: CARD_LINE_CAP, text: `now: still working — ${calls}` });
  }
  const ago = elapsedWords({ fromIso: latest.tsIso, toIso: nowIso });
  const subject = activityGloss({ target: latest.target, tool: latest.tool });
  const started = ago === undefined ? "" : ` (started ${ago === "just now" ? "just now" : `${ago} ago`})`;
  const lead = turnClock === undefined ? "" : `${turnClock} · `;
  return clampVisible({ cap: CARD_LINE_CAP, text: `now: ${lead}${subject}${started} · ${calls}` });
}

/**
 * The last step is BLOCKED ON THE OWNER rather than running — what {@link progressChecklistSteps} renders
 * in place of the `now:` line while the turn waits on the owner.
 *
 * A shape rather than a bare string so the caller cannot express half of it: the hourglass and the sentence
 * under it are one decision, and a card carrying the glyph with a mechanical `now: still working — 0 tool
 * calls so far` under it would be the failure look re-entering through the detail line.
 */
export interface BlockedStepDetail {
  /** The one colleague-safe sentence under the hourglass step — what the owner has to do, and that the turn resumes. */
  readonly detail: string;
}

/**
 * The whole card, as steps: the METER, the question, the OUTLINE, and the LOOP phases below the fold —
 * `./progressLoop.ts` derives all three off the turn's timeline, and its header carries the owner's ask.
 *
 * The LIVE step carries the `now:` line as a child; with a declared plan it is the plan step in flight, and
 * without one it is the latest stage, every earlier stage keeping its own text in the loop below the fold. A
 * turn with no stages yet still renders a running step, so a card posted at capture says something truthful
 * rather than nothing.
 *
 * ## When the last step is blocked on the owner
 *
 * `blocked` replaces `running` on that one step and nothing else about the card changes — same one-line-per-
 * step shape, same finished steps keeping their own findings, no `✗` anywhere. That is the owner's design
 * and the reason for it: the shape is what the owner likes, a card that checks off different things as it
 * goes, and the card must not read as a failure, so the difference between working and waiting is one
 * glyph and one sentence rather than a different card.
 *
 * The `now:` line is DROPPED on a blocked step, deliberately. It is derived from the worker's command log
 * and it states what the worker is doing this minute; the worker has stopped, so leaving it would show a
 * frozen "started 4m ago" that ages into a lie over the week this state is allowed to last.
 *
 * `blocked` also beats `finished`, which cannot both be true of a real turn and would be a caller bug either
 * way — a turn that reached its terminal did not stop on the owner. Rendering the hourglass in that case is the
 * conservative reading: the ask is not done, and this card is the surface that must never say it is.
 *
 * ## When the loop's sweep has raised a budget warn
 *
 * `warned` prefixes the RUNNING step's detail with `warn raised — `, and nothing else: the reader sees the
 * same clock the bot does, and never the witness's note, which is written for the worker rather than for the
 * channel. The words are neutral on purpose — a warn does not establish that the worker is wrapping up, and
 * the owner ruled that the worker, not the loop, decides how the turn ends. A blocked or finished step
 * ignores it.
 *
 * ## When this turn is picking up a dead session's work
 *
 * `resuming` prefixes the RUNNING step's detail, exactly the way `warned` does and for the same reason: the
 * card's shape is what the owner likes and a second card shape for a second condition is the thing the owner ruled
 * against. What it replaces is the worst line this card has ever shown. Measured on a real ask: the
 * worker died and the thread sat, in front of the whole platform team, on `now: <its last tool call> · 61 tool calls so far` — a sentence that was true when it
 * was written and a lie every minute after. The mechanical `now:` line is DROPPED while resuming, for the
 * same reason a blocked step drops it: it is derived from a command log a dead session stopped writing.
 *
 * `blocked` still beats it. A turn waiting on the owner is waiting on them whether or not it inherited a draft.
 *
 * @param blocked the blocked-step detail, when this turn is waiting on the owner
 * @param finished whether the turn has reached its terminal state, in which case nothing is still running
 * @param nowDetail the `now:` line for the running step, omitted when the turn is finished
 * @param question the ask's own question, shown as step 0's finding
 * @param resuming the checkpoint sentence, when this turn is picking up an earlier generation's work
 * @param timeline the stages, plans and review rounds the progress log holds, in file order
 * @param warned whether the current dispatch carries a budget warn
 * @returns the steps to render, in display order
 */
export function progressChecklistSteps({
  blocked,
  finished,
  nowDetail,
  question,
  resuming,
  timeline,
  warned = false,
}: {
  blocked?: BlockedStepDetail | undefined;
  finished: boolean;
  nowDetail: string | undefined;
  question: string;
  resuming?: string | undefined;
  timeline: readonly ProgressTimelineEvent[];
  warned?: boolean;
}): readonly TodoStep[] {
  const first: TodoStep = {
    // `questionForPlainField` inside `strippedAddressing`, and BOTH: the strip handles the NORMALISED
    // `@(id)` addressing the socket path produces, and the rewrite handles the RAW `<@U…>` the ask-register
    // path keeps. `detail` reaches Slack's own `task_card` `details`, which Slack parses — so a raw tag left
    // here is a live mention of a real person on a card that was only ever meant to quote them.
    detail: clampVisible({
      cap: CARD_LINE_CAP,
      text: `"${questionForPlainField({ question: strippedAddressing({ question }) })}"`,
    }),
    id: QUESTION_STEP_ID,
    state: "done",
    title: "Read the question",
  };
  const lastState = lastStepState({ blocked, finished });
  const liveDetail = resumingDetail({ nowDetail, resuming: lastState === "running" ? resuming : undefined });
  const runningDetail = warnedDetail({ nowDetail: liveDetail, warned: warned && lastState === "running" });
  const lastDetail = blocked === undefined ? runningDetail : blocked.detail;
  const liveLine = lastState !== "done" && lastDetail !== undefined && lastDetail.length > 0 ? lastDetail : undefined;
  const view = loopView({ timeline });
  // `lastState`, not `finished`: blocked beats finished on the meter and the outline exactly as on the live step.
  const done = lastState === "done";
  const meter = meterLine({ finished: done, view });
  const meterStep: readonly TodoStep[] =
    meter === undefined ? [] : [{ id: "meter", placement: "meter", state: lastState, title: meter }];
  return [
    ...meterStep,
    first,
    ...outlineSteps({ finished: done, lastState, liveLine, view }),
    ...loopSteps({ lastState, timeline, view }),
  ];
}

/**
 * The line a card write records as what the live step said: the live step's last child, else its detail.
 * The staleness probe compares these (`./progressLog.ts`'s `changingWrites`), so it must be the line that
 * moves — never a loop phase's, which a re-render leaves as it was.
 *
 * @param steps one frame's steps
 * @returns the live line, or `undefined` when no outline step is running or blocked
 */
export function liveLineOf({ steps }: { steps: readonly TodoStep[] }): string | undefined {
  const live = steps.find(
    (step) => step.placement === undefined && (step.state === "running" || step.state === "blocked"),
  );
  if (live === undefined) {
    return undefined;
  }
  const children = live.children;
  if (children !== undefined && children.length > 0) {
    return children[children.length - 1];
  }
  return live.detail;
}

/**
 * The running step's detail while this turn is resuming from a checkpoint — the checkpoint sentence, and
 * the mechanical `now:` line DROPPED.
 *
 * Dropped rather than appended: that line is derived from the worker's own command log, and the session that
 * wrote the log this card would be reading is the one that died. Showing it beside "resuming" would put the
 * dead session's last activity and the live session's state on one line, which is the frozen card this whole
 * change exists to remove, wearing a new label.
 *
 * @param nowDetail the detail the writer derived, used when nothing is being resumed
 * @param resuming the checkpoint sentence, when this turn is picking up an earlier generation's work
 * @returns the detail to render
 */
function resumingDetail({
  nowDetail,
  resuming,
}: {
  nowDetail: string | undefined;
  resuming: string | undefined;
}): string | undefined {
  if (resuming === undefined || resuming.length === 0) {
    return nowDetail;
  }
  return clampVisible({ cap: CARD_LINE_CAP, text: resuming });
}

/**
 * The running step's detail with the warn shown, clamped after prefixing so the cap still holds.
 *
 * @param nowDetail the detail the writer derived, if any
 * @param warned whether to show the warn on this step
 * @returns the detail to render
 */
function warnedDetail({ nowDetail, warned }: { nowDetail: string | undefined; warned: boolean }): string | undefined {
  if (!warned) {
    return nowDetail;
  }
  const rest = nowDetail === undefined || nowDetail.length === 0 ? "" : ` — ${nowDetail}`;
  return clampVisible({ cap: CARD_LINE_CAP, text: `warn raised${rest}` });
}

/**
 * What the LAST step's state is: blocked on the owner, done, or still running. Pure and total.
 *
 * Split out rather than written as a nested ternary inline, per this repo's own ban on those, and the
 * ordering is the rule: `blocked` is checked first so a caller that passes both cannot render a card that
 * says a turn waiting on the owner has finished.
 *
 * @param blocked the blocked-step detail, when this turn is waiting on the owner
 * @param finished whether the turn has reached its terminal state
 * @returns the state to render on the last step
 */
function lastStepState({
  blocked,
  finished,
}: {
  blocked: BlockedStepDetail | undefined;
  finished: boolean;
}): TodoStep["state"] {
  if (blocked !== undefined) {
    return "blocked";
  }
  return finished ? "done" : "running";
}
