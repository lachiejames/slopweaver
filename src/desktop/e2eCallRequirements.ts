/**
 * What each call scenario of `slopweaver desktop e2e --call` is judged on: which of the trailing checks
 * `./e2eCallOutcome.ts` applies to it, and how many plan calls it may open before another call is taken to have
 * overlapped it. Pure.
 */
import type { E2eCallStepId } from "./e2eCallPlan.js";

/** Which of the trailing checks a scenario is judged on, and how many plan calls it may open. */
export interface E2eCallRequirements {
  /**
   * One of its calls holds the named card read or opened, an answer, the challenge, the card read or opened again and
   * an answer.
   */
  readonly cardRead: boolean;
  readonly crash: boolean;
  /** The voice opened with a greeting back in a few words, never a self-introduction, product name or capability list. */
  readonly greeting: boolean;
  readonly ownerTurn: boolean;
  readonly voiceAnswer: boolean;
  readonly heap: boolean;
  readonly longTask: boolean;
  /** The voice ran `talk find-card` and said FOUND or NONE. */
  readonly queueSearch: boolean;
  /** Once the card was up and the owner said they were still reading, nothing moved them off it for a whole window. */
  readonly readingHold: boolean;
  /** The three calls hold the owner's ruling on a reopened call (`./e2eCallReopen.ts`). */
  readonly reopen: boolean;
  /** Once the card was up and the owner asked for the next card, the walk left it inside a window. */
  readonly cardNext: boolean;
  /** The most plan calls the console may log opening while it runs: one per press, one per reconnect. */
  readonly planCalls: number;
}

/** No trailing check and one plan call: every scenario's requirements start here and switch on what they need. */
const NONE: E2eCallRequirements = {
  cardNext: false,
  cardRead: false,
  crash: false,
  greeting: false,
  heap: false,
  ownerTurn: false,
  longTask: false,
  planCalls: 1,
  queueSearch: false,
  readingHold: false,
  reopen: false,
  voiceAnswer: false,
};

/**
 * What one scenario is judged on.
 *
 * @param id the scenario
 * @returns its checks
 */
export function callRequirementsOf({ id }: { id: E2eCallStepId }): E2eCallRequirements {
  switch (id) {
    // The only scenario whose microphone says a bare greeting, so the only one whose opening is judged.
    case "call-live":
      return { ...NONE, greeting: true, ownerTurn: true, voiceAnswer: true };
    // The call a launcher's address starts must be a whole call: it heard a caller turn and answered.
    case "launcher-voice":
      return { ...NONE, ownerTurn: true, voiceAnswer: true };
    case "queue-search":
      return { ...NONE, ownerTurn: true, queueSearch: true, voiceAnswer: true };
    case "call-holds":
      return { ...NONE, heap: true };
    case "long-task-mid-call":
    case "fleet-ask":
      return { ...NONE, longTask: true, voiceAnswer: true };
    // Two lines may be drafted in seconds, so no long task is required; the register is judged off the call file.
    case "draft-read-back":
      return { ...NONE, ownerTurn: true, voiceAnswer: true };
    // Structure only: whether either answer was faithful to the card is never judged in the leg.
    case "card-read":
    case "card-read-typed":
      return { ...NONE, cardRead: true, ownerTurn: true, voiceAnswer: true };
    // A voice answer is allowed and never required: saying nothing while the owner reads is the behaviour wanted.
    case "card-reading-hold":
      return { ...NONE, ownerTurn: true, readingHold: true };
    // A voice answer is allowed and never required: the card leaving is the behaviour wanted.
    case "card-next":
      return { ...NONE, cardNext: true, ownerTurn: true };
    case "renderer-killed":
    case "renderer-killed-twice":
    case "renderer-killed-connecting":
      return { ...NONE, crash: true, planCalls: 2 };
    case "typing-after-drop":
      return { ...NONE, crash: true, ownerTurn: true, planCalls: 2, voiceAnswer: true };
    case "relaunch":
      return { ...NONE, planCalls: 2 };
    // The call it ended for the update, and the one the shell restarted with nobody pressing Talk.
    case "update-swap-resume":
      return { ...NONE, planCalls: 2 };
    // Whether the words arrived intact is the scenario's own report (`./e2eTranscriptFidelityReport.ts`), never a pass.
    case "transcription-fidelity":
      return { ...NONE, ownerTurn: true, voiceAnswer: true };
    // Three presses, A, B and C; the owner's turn is C's speech heard, the reopen witness the rest.
    case "call-reopen":
      return { ...NONE, ownerTurn: true, planCalls: 3, reopen: true };
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

/**
 * More plan calls opened on the console while a scenario ran than it could have opened itself: a call that was not
 * its own — the owner's, or another checkout's — or a press that opened two.
 *
 * @param id the scenario
 * @param opened the plan calls the console logged opening while it ran
 * @returns the sentence, `undefined` when the count is within what it may open
 */
export function planCallOverlap({ id, opened }: { id: E2eCallStepId; opened: readonly string[] }): string | undefined {
  const most = callRequirementsOf({ id }).planCalls;
  if (opened.length <= most) {
    return undefined;
  }
  return `${String(opened.length)} plan calls opened while it ran, at most ${String(most)} its own: ${opened.join(", ")}`;
}
