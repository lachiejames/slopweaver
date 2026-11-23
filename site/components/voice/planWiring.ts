/**
 * What a plan call's two event sources ask of the page: its data channel's v3 events, already folded into effects
 * (`lib/talkPlanEvents.ts`), and its server-side stream's tool calls, errors and end (`planCallClient.ts`). Its own
 * file so `VoiceProvider.tsx` stays under the line cap; that file's module doc says why the plan path is shaped so.
 */
import type { AnnounceCue } from "../../lib/announceCue";
import {
  PLAN_CALL_LIMITS,
  type PlanCallEvent,
  type PlanTypedInEvent,
  type PlanUsageEvent,
  type PlanWrittenEvent,
} from "../../lib/planCallContract";
import type { ActivityInput } from "../../lib/voiceActivity";
import type { PlanPost } from "./planCallClient";
import { codexWaitLine } from "./planWiringCodexLines";
import type { HeldPlanCall } from "./planWiringHeld";
import {
  ACK_LINE,
  codexTurnLine,
  heldAnswerLine,
  LOOK_START_LINE,
  owedStartLine,
  reopenReminderLine,
  turnOutcomeLine,
} from "./planWiringLines";
import type { ToolLine } from "./voiceContext";

/** One tool call the plan call hands the page to answer. */
export interface PlanToolCall {
  /** The plan call's token for this tool call, which its answer is posted under. */
  readonly token: string;
  readonly tool: string;
  readonly rawArguments: string;
  /** The model's answer the call was made in, `undefined` when the server named none. */
  readonly turnId: string | undefined;
}

/**
 * The handler for a plan call's server-side stream.
 *
 * @param current whether the call is still this page's current one
 * @param closing whether the owner has hung up on it, so no further tool call is run
 * @param claimed every tool call already run, so a replayed one is never run twice
 * @param held the plan call this page holds now; each tool call keeps the one it was claimed on, since a hang-up
 *   clears it before a late claim returns
 * @param claim asks the server whether the tool call is still waiting and unclaimed; `taken` means run it
 * @param fail settles a tool call the page will not run as failed, by `deadlineMs` on `now`'s clock — its claim was
 *   lost, so the page cannot tell whether it holds it, came back too late to run, or came back after the owner hung up —
 *   answering why when it could not
 * @param ended ends the call on the page, with why
 * @param rollover the server found the floor free past its rollover window: roll the call over onto a fresh one
 * @param act feeds the activity fold
 * @param note writes a line in the call's log
 * @param journal writes a line into the call file only — a Codex turn starting or ending, so the next stall says
 *   which side went quiet
 * @param usage writes the delegated thread's token usage after one turn into the call file
 * @param answer runs one tool call and posts its answer
 * @param written shows what a typed conversation's thread has written so far; on a voice call, keeps each completed
 *   message the thread handed the voice on the call file
 * @param progress a delegated turn on a speaking call has run on with the voice silent: the page's working cue is due
 * @param announce the call is about to say a line the owner did not ask for: that kind's herald chime is due now
 * @param typedIn the owner's message typed mid-call, which the voice took as their turn ({@link typedInHandler})
 * @param turnStarted one of the model's answers began, before any tool call in it: the triage pass notes the card then
 *   in front of the owner, which a ruling in that answer binds to
 * @param now a monotonic clock in milliseconds, the page's own `performance.now` unless a test passes one
 * @param windowMs how long the server keeps a claimed call waiting before it times it out
 * @returns the handler
 */
export function planCallEventHandler({
  current,
  closing,
  claimed,
  held,
  claim,
  fail,
  ended,
  rollover,
  act,
  note,
  journal,
  usage,
  answer,
  written,
  progress,
  announce,
  typedIn,
  turnStarted,
  now = () => performance.now(),
  windowMs = PLAN_CALL_LIMITS.pendingToolMs,
}: {
  current: () => boolean;
  closing: () => boolean;
  claimed: { current: Set<string> };
  held: () => HeldPlanCall | undefined;
  claim: (input: { held: HeldPlanCall | undefined; token: string }) => Promise<PlanPost>;
  fail: (input: { held: HeldPlanCall | undefined; token: string; deadlineMs: number }) => Promise<string | undefined>;
  ended: (input: { why: string }) => void;
  rollover: (input: { reason: string; lifetimeRemainingMs: number | null; contextUrgent: boolean }) => void;
  act: (input: { input: ActivityInput }) => void;
  note: (input: { line: ToolLine }) => void;
  journal: (input: { line: ToolLine }) => void;
  usage: (input: { usage: PlanUsageEvent }) => void;
  answer: (input: PlanToolCall) => void;
  written: (input: { event: PlanWrittenEvent }) => void;
  progress: () => void;
  announce: (input: { cue: AnnounceCue }) => void;
  typedIn: (input: { event: PlanTypedInEvent }) => void;
  turnStarted: (input: { turnId: string }) => void;
  now?: () => number;
  windowMs?: number;
}): (event: PlanCallEvent) => void {
  return (event) => {
    if (!current()) {
      return;
    }
    if (event.kind === "closed") {
      ended({ why: `the plan call ended: ${event.reason}` });
      return;
    }
    if (event.kind === "rollover") {
      const { contextUrgent, lifetimeRemainingMs, reason } = event;
      rollover({ contextUrgent, lifetimeRemainingMs, reason });
      return;
    }
    if (event.kind === "error") {
      act({ input: { kind: "error", message: event.message } });
      note({ line: { detail: event.message, ms: undefined, name: "plan", refused: true, usage: undefined } });
      return;
    }
    if (event.kind === "usage") {
      // Usage arrives after each of a Codex turn's model requests, not only at its end: the turn is moving.
      act({ input: { kind: "codex-turn", phase: "progress", step: null, turnId: event.turnId } });
      usage({ usage: event });
      return;
    }
    if (event.kind === "codex-turn") {
      if (event.phase === "started") {
        turnStarted({ turnId: event.turnId });
      }
      act({ input: event });
      const line = codexTurnLine({ event });
      if (line !== undefined) {
        journal({ line });
      }
      return;
    }
    if (event.kind === "model-wait" || event.kind === "codex-notice") {
      // The call file's alone: a re-send's step reaches the orb as its own `codex-turn` progress, and none of these is
      // the call's error.
      journal({ line: codexWaitLine({ event }) });
      return;
    }
    if (event.kind === "written") {
      written({ event });
      return;
    }
    if (event.kind === "look-start") {
      journal({ line: LOOK_START_LINE });
      return;
    }
    if (event.kind === "owed-start") {
      journal({ line: owedStartLine({ why: event.why }) });
      return;
    }
    if (event.kind === "acknowledged") {
      journal({ line: ACK_LINE });
      return;
    }
    if (event.kind === "turn-outcome") {
      journal({ line: turnOutcomeLine({ event }) });
      return;
    }
    if (event.kind === "held-answer") {
      // Folded so the rollover holds while an answer is owed or just handed (`pageRolloverHold`). A `failed` one leaves
      // no line of its own, the `error` beside it being its trace, and nor does `handing`: its `released` or `failed`
      // follows it. A `dropped` one has no `error`, so it leaves its own line.
      act({ input: event });
      if (event.phase === "held" || event.phase === "released" || event.phase === "dropped") {
        journal({ line: heldAnswerLine({ event }) });
      }
      return;
    }
    if (event.kind === "progress") {
      progress();
      return;
    }
    if (event.kind === "announce") {
      announce({ cue: event.cue });
      return;
    }
    if (event.kind === "typed-in") {
      typedIn({ event });
      return;
    }
    if (event.kind === "reopen-reminder") {
      journal({ line: reopenReminderLine({ event }) });
      return;
    }
    if (closing() || claimed.current.has(event.token)) {
      return;
    }
    claimed.current.add(event.token);
    const { arguments: rawArguments, token, tool, turnId } = event;
    // Claimed on the server before it runs: an event that arrives after the server settled it is dropped, never run.
    const on = held();
    const failed = (): void => {
      void fail({ deadlineMs: now() + windowMs, held: on, token }).then((why) => {
        if (why !== undefined) {
          noteIfMine({ detail: why });
        }
        return undefined;
      });
    };
    // A claim answers after an await, by when the call may have dropped and a reconnect taken its place: the line
    // belongs to the call it was claimed on, so it is dropped rather than written into the new one.
    const noteIfMine = ({ detail }: { detail: string }): void => {
      if (current()) {
        note({ line: { detail, ms: undefined, name: tool, refused: true, usage: undefined } });
      }
    };
    const runClaimed = async (): Promise<void> => {
      const asked = now();
      const outcome = await claim({ held: on, token });
      if (outcome.kind !== "taken") {
        noteIfMine({ detail: `not run: ${outcome.why}` });
        // A refused claim is the server's word that the call is settled or another page's; a lost one may have landed
        // or not, and either way the thread waits on it — so it is answered as failed rather than left the whole
        // window on a starved console. So is one the owner hung up over: a lost stop leaves the call up, and a
        // failure on a call that did stop is only refused.
        if (outcome.kind === "lost") {
          failed();
        }
        return;
      }
      // The server restarted the call's wait when it took the claim, which was no earlier than it was asked; so a
      // claim answered a whole window after it was asked (a frozen tab, a stalled response) may already be timed
      // out there, and is dropped rather than run. Inside the window the call is still waiting when the tool starts.
      const took = now() - asked;
      if (took >= windowMs) {
        noteIfMine({
          detail: `not run: its claim was answered ${String(Math.round(took / 1000))}s after it was asked, past the server's wait`,
        });
        failed();
        return;
      }
      if (current() && !closing()) {
        answer({ rawArguments, token, tool, turnId });
      } else {
        // Claimed, then the owner hung up before it ran: this page holds it, so this page says it will not run.
        failed();
      }
    };
    void runClaimed();
  };
}
