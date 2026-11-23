/**
 * The call-file lines a plan call leaves (look-start, owed-start, ack, turn-outcome, held-answer, a Codex turn), and the
 * nudge and resume posts on the held call with their lines, and the `resume-gate` line naming what held a resume. Split from `planWiring.ts` to keep it under the line cap.
 */
import type {
  OwedTurnWhy,
  PlanHeldAnswerEvent,
  PlanReopenReminderEvent,
  PlanTurnEvent,
  PlanTurnOutcomeEvent,
} from "../../lib/planCallContract";
import { TALKING_REFUSAL } from "../../lib/talkPlanFloor";
import type { ResumeGateObservation } from "../../lib/voiceResumeTrace";
import { nudgePlanCall, type PlanPost, resumePlanCall } from "./planCallClient";
import type { HeldPlanCall } from "./planWiringHeld";
import type { ToolLine } from "./voiceContext";

/**
 * The call-file line a look the console started itself leaves (`PlanCall.attachLook`), so the next measurement of a
 * look counts how often the voice answered one itself: `grep -c '"name":"look-start"'` over
 * `$SLOPWEAVER_HOME/talk/calls/*.jsonl`. Older calls carry `look-handoff` instead, the developer message
 * that asked the voice to hand the look over. What the start came to follows it as the `frame` line.
 */
export const LOOK_START_LINE: ToolLine = {
  detail: "started the thinking model's turn with the look's frame itself",
  ms: undefined,
  name: "look-start",
  refused: false,
  usage: undefined,
};

/**
 * The call-file line an owed turn the console started itself leaves (`../../lib/talkPlanOwedTurn.ts`): the owner's nudge or
 * the page's promise press was taken and the voice handed nothing over, so the next measurement counts how often:
 * `grep -c '"name":"owed-start"'` over `$SLOPWEAVER_HOME/talk/calls/*.jsonl`. A resume's turn is the console's by
 * design, so its line counts resumes, not a voice that failed to hand off. The `codex` line after it says
 * whether the turn started; a start that failed follows as a refused `plan` line naming why.
 *
 * @param why which developer message owed the turn
 * @returns the line
 */
export function owedStartLine({ why }: { why: OwedTurnWhy }): ToolLine {
  const after: Readonly<Record<OwedTurnWhy, string>> = {
    nudge: "the voice took the owner's nudge and handed nothing over",
    promise: "the voice took the page's promise press and handed nothing over",
    resume: "the resume made the answer the thinking model's",
    triage: "the triage card's clock was up, and the suggestion is the thinking model's",
    walk: "they asked for the next card and no turn started during the owner's words",
  };
  return {
    detail: `started the thinking model's turn itself: ${after[why]}`,
    ms: undefined,
    name: "owed-start",
    refused: false,
    usage: undefined,
  };
}

/**
 * The call-file line a server-said acknowledgement of a hand-off leaves (`HandOffSpeech`, `site/lib/talkPlanHandOffSpeech.ts`), so the next measurement
 * of the owner's silence counts the hand-offs the console said "on it" for: `grep -c '"name":"ack"'` over
 * `$SLOPWEAVER_HOME/talk/calls/*.jsonl`. One the voice would not take follows as the stream's own `plan` error line.
 */
export const ACK_LINE: ToolLine = {
  detail: "said it is on it",
  ms: undefined,
  name: "ack",
  refused: false,
  usage: undefined,
};

/**
 * The call-file line a turn's outcome leaves (`TurnOutcomes`, `site/lib/talkPlanTurnOutcome.ts`): the voice told the owner
 * a turn it said it was on came back with no answer or failed, or that line was not said and why. Counted with
 * `grep '"name":"turn-outcome"'` over `$SLOPWEAVER_HOME/talk/calls/*.jsonl`.
 *
 * @param event the streamed event
 * @returns the line, refused when it was not said
 */
export function turnOutcomeLine({ event }: { event: PlanTurnOutcomeEvent }): ToolLine {
  const { detail, phase, turnId } = event;
  return {
    detail: `turn ${turnId}: ${detail}`,
    ms: undefined,
    name: "turn-outcome",
    refused: phase === "dropped",
    usage: undefined,
  };
}

/**
 * The call-file line a thinking-model message held off the voice, or handed to it, leaves
 * (`../../lib/talkPlanHeldAnswers.ts`), so the next measurement of a cut-in can tell an answer held over the owner's words from
 * one spoken over them: `grep '"name":"held-answer"'` over `$SLOPWEAVER_HOME/talk/calls/*.jsonl`, each `held` beside
 * its `released` and the voice's segment after it.
 *
 * @param event the streamed event
 * @returns the line
 */
export function heldAnswerLine({ event }: { event: PlanHeldAnswerEvent }): ToolLine {
  const { detail, itemId, phase, turnId } = event;
  let said = `held ${itemId} of turn ${turnId}: ${detail}`;
  if (phase === "released") {
    said = `handed the voice what turn ${turnId} wrote, through ${itemId}: ${detail}`;
  }
  if (phase === "dropped") {
    said = `did not hand the voice what turn ${turnId} wrote, through ${itemId}: ${detail}`;
  }
  return { detail: said, ms: undefined, name: "held-answer", refused: false, usage: undefined };
}

/**
 * The call-file line a reopened call's opening window leaves (`../../lib/talkPlanReopenReminder.ts`), so its three
 * seconds are measured on the real call: `slopweaver talk call-tools --call <id>` prints each step's `reopenReminder`,
 * an `armed` followed by the `handed` whose `elapsedSinceArmedMs` is at least the window, or the `gave-way` whose
 * `elapsedSinceArmedMs` is under it. Its `ms` stays unset: on a tool line that is latency, a different thing.
 *
 * @param event the streamed event
 * @returns the line, carrying the step as `reopenReminder`; refused when the reminder could not be handed
 */
export function reopenReminderLine({ event }: { event: PlanReopenReminderEvent }): ToolLine {
  const { acceptedElapsedMs, elapsedMs, failure, phase, previousCallId, reason, windowMs } = event;
  const window = `${String(windowMs)} ms window, previous call ${previousCallId}`;
  let detail = `armed the ${window}`;
  if (phase === "handed") {
    detail = `handed the reminder after ${String(elapsedMs)} ms of the ${window}`;
    if (acceptedElapsedMs !== null) {
      detail += `; the voice took it at ${String(acceptedElapsedMs)} ms`;
    }
  }
  if (phase === "gave-way") {
    detail = `gave way to ${String(reason)} after ${String(elapsedMs)} ms of the ${window}`;
  }
  if (phase === "failed") {
    detail = `could not hand the reminder after ${String(elapsedMs)} ms of the ${window}: ${String(failure)}`;
  }
  return {
    detail,
    ms: undefined,
    name: "reopen-reminder",
    refused: phase === "failed",
    reopenReminder: { elapsedSinceArmedMs: elapsedMs, phase, previousCallId, windowMs },
    usage: undefined,
  };
}

/**
 * A Codex turn's start or end as a line of the call file, so a stall afterwards says whether a turn started and
 * never ended, or none started at all — a call file without these lines could say neither. Progress is not written: it is many
 * per turn, and the turn's start and end bound it.
 *
 * @param event the streamed turn event
 * @returns the line, or `undefined` for progress
 */
export function codexTurnLine({ event }: { event: PlanTurnEvent }): ToolLine | undefined {
  if (event.phase === "progress") {
    return undefined;
  }
  if (event.phase === "started") {
    return { detail: `turn ${event.turnId} started`, ms: undefined, name: "codex", refused: false, usage: undefined };
  }
  let detail = `turn ${event.turnId} ${event.status}`;
  if (event.failure !== null) {
    detail += `: ${event.failure}`;
  }
  return { detail, ms: undefined, name: "codex", refused: event.status === "failed", usage: undefined };
}

/**
 * The call-log line a nudge leaves, so a nudge that did not land is never silent and one that did is on the record. One
 * the page pressed itself, over a promise that started nothing, says so: `grep '"detail":"pressed it itself'` over
 * `$SLOPWEAVER_HOME/talk/calls/*.jsonl` counts them.
 *
 * @param posted what the nudge route answered
 * @param promised whether the page pressed it itself over a promise (`promiseDueOf`), rather than the owner did
 * @returns the line
 */
export function nudgeLine({ posted, promised }: { posted: PlanPost; promised: boolean }): ToolLine {
  let detail = "asked it to answer";
  if (promised) {
    detail = "pressed it itself: it said it would do something and started nothing";
  }
  if (posted.kind === "refused") {
    detail = `not sent: ${posted.why}`;
  } else if (posted.kind === "lost") {
    detail = `lost: ${posted.why}`;
  }
  return { detail, ms: undefined, name: "nudge", refused: posted.kind !== "taken", usage: undefined };
}

/**
 * Nudge the plan call this page holds, once.
 *
 * @param held the plan call the press was made on
 * @returns the call-log line saying what the nudge came to
 */
export async function nudgeOnHeld({ held }: { held: HeldPlanCall }): Promise<ToolLine> {
  return nudgeLine({ posted: await nudgePlanCall({ callId: held.callId, promised: false }), promised: false });
}

/**
 * Press the nudge on the plan call this page holds ITSELF, once, over a promise the voice made and never started
 * (`promiseDueOf`, `site/lib/voiceOwed.ts`): the server hands it its own promise sentence and stops nothing.
 *
 * @param held the plan call whose silence the clock judged
 * @returns the call-log line saying what the press came to
 */
export async function keepPromiseOnHeld({ held }: { held: HeldPlanCall }): Promise<ToolLine> {
  return nudgeLine({ posted: await nudgePlanCall({ callId: held.callId, promised: true }), promised: true });
}

/**
 * The call-log line a resume leaves: the owner's words went unanswered, so the voice was asked to acknowledge them and the
 * answer left to the thinking model, or why not.
 * Written as a `resume` line, so the call file counts every one (`grep -c '"name":"resume"'` over
 * `$SLOPWEAVER_HOME/talk/calls/*.jsonl`).
 *
 * @param posted what the resume route answered
 * @returns the line
 */
export function resumeLine({ posted }: { posted: PlanPost }): ToolLine {
  let detail = "asked it to acknowledge the owner and let the thinking model answer";
  if (posted.kind === "refused") {
    detail = `not sent: ${posted.why}`;
  } else if (posted.kind === "lost") {
    detail = `lost: ${posted.why}`;
  }
  return { detail, ms: undefined, name: "resume", refused: posted.kind !== "taken", usage: undefined };
}

/**
 * The call-log line a held silence leaves (`foldResumeTrace`, `site/lib/voiceResumeTrace.ts`): no resume was posted
 * after the owner's words went quiet, and this is the gate that held it, with the instants it read. A `resume-gate` line, never
 * a `resume` one, so a count of resume posts stays a count of posts.
 *
 * @param observation the held silence
 * @returns the line
 */
export function resumeGateLine({ observation }: { observation: ResumeGateObservation }): ToolLine {
  const ago = (ms: number | undefined): string => (ms === undefined ? "never" : `${(ms / 1000).toFixed(1)}s ago`);
  const rows = observation.rows.length === 0 ? "none" : observation.rows.join(",");
  const parts = [
    `heard ${ago(observation.heardAgoMs)}`,
    `voice sound ${ago(observation.voiceSoundAgoMs)}`,
    `the owner's sound ${ago(observation.ownerSoundAgoMs)}`,
    `voice final ${ago(observation.voiceFinalAgoMs)}`,
    `mic ${observation.micLevel.toFixed(3)} rms ${observation.micRms.toFixed(4)}${observation.muted ? " muted" : ""}`,
    `tools ${String(observation.tools)}`,
    `rows ${rows}`,
  ];
  const detail = `not posted: ${observation.blocker}; ${parts.join(", ")}`;
  return { detail, ms: undefined, name: "resume-gate", refused: true, usage: undefined };
}

/**
 * Ask the plan call this page holds to take its turn, once.
 *
 * @param held the plan call whose silence the clock judged
 * @returns the call-log line saying what the resume came to, and what the route answered
 */
export async function resumeOnHeld({ held }: { held: HeldPlanCall }): Promise<{ line: ToolLine; posted: PlanPost }> {
  const posted = await resumePlanCall({ callId: held.callId });
  return { line: resumeLine({ posted }), posted };
}

/**
 * Whether a resume was refused only because someone was transcribed a moment ago — the one refusal a moment clears
 * by itself, so the page tries again (`RESUME_RETRIES`, `../../lib/voiceResumeFold.ts`). A lost post or any other
 * refusal is never retried: the first may have landed, and the rest would be refused again.
 *
 * @param posted what the resume route answered
 * @returns true for a refusal whose reason is exactly {@link TALKING_REFUSAL}
 */
export function transientResumeRefusal({ posted }: { posted: PlanPost }): boolean {
  return posted.kind === "refused" && posted.why === TALKING_REFUSAL;
}
