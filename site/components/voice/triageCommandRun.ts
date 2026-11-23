/**
 * Run one rapid-triage press from the desktop shell — the menu bar's Start triage, Pause timer, Resume timer and Turn
 * triage off, and the floating note's two buttons — in the conversation this window holds.
 *
 * On a voice call every press is the owner's words, said into the call (`./typedInClient.ts`), so the model runs
 * `triage_next`, `triage_clock` or `triage_end` itself and the server's hold on the card in front of the owner
 * (`../../lib/triagePresented.ts`) moves with it, exactly as if the owner had said them. Off a call, a start goes to the typed
 * conversation, which opens one when none is held, and the model walks the Queue from there; a pause, a resume or an
 * off runs here and now through those tools' own code (`./triageClockRun.ts`), because a typed conversation's clock is the
 * page's alone. Every effect is a seam, so a test passes plain fakes.
 */
import type { TriageCommand } from "../../lib/triageBridge";
import { runTriageClock, runTriageEnd } from "./triageClockRun";
import type { TriageSeams } from "./triageRun";
import type { TypedInSend } from "./typedInClient";

/** What a press reaches. */
export interface TriageCommandSeams {
  /** The page's triage pass and the Queue's cards, the same seams the tools run over. */
  readonly seams: Pick<TriageSeams, "cards" | "triage">;
  /** Whether a voice call is up, in this window or reported from the other one. */
  readonly voiceCallUp: () => boolean;
  /** Hand words to the live voice call as the owner's turn. */
  readonly typeIntoCall: (input: { readonly text: string }) => Promise<TypedInSend>;
  /** Send words to the typed conversation, opening one when none is held; whether its thread took them. */
  readonly sendTyped: (input: { readonly text: string }) => Promise<boolean>;
}

/** What became of one press, for the call's log. */
export interface TriageCommandRan {
  readonly detail: string;
  readonly refused: boolean;
}

/** The words each press is, as the owner would say them. */
export const TRIAGE_COMMAND_WORDS: Readonly<Record<TriageCommand, string>> = {
  off: "Turn triage off.",
  pause: "Pause the triage timer.",
  resume: "Start the triage timer again.",
  start: "It's triage time.",
};

/**
 * Run one press.
 *
 * @param command which press
 * @param seams what it reaches
 * @returns what it did, for the call's log
 */
export async function runTriageCommand({
  command,
  seams,
}: {
  command: TriageCommand;
  seams: TriageCommandSeams;
}): Promise<TriageCommandRan> {
  const words = TRIAGE_COMMAND_WORDS[command];
  if (seams.voiceCallUp()) {
    const sent = await seams.typeIntoCall({ text: words });
    if (sent.kind === "taken") {
      return { detail: `triage ${command} said into the call`, refused: false };
    }
    return { detail: `triage ${command} not said into the call: ${sent.why}`, refused: true };
  }
  if (command === "start") {
    if (await seams.sendTyped({ text: words })) {
      return { detail: "triage start sent to the typed conversation", refused: false };
    }
    return { detail: "triage start not sent: the typed conversation did not take it", refused: true };
  }
  if (command === "off") {
    const ended = runTriageEnd({ seams: seams.seams });
    return { detail: ended.detail, refused: ended.refused };
  }
  // A press names no length: a resume runs the card's clock at the length it ran before.
  const clock = runTriageClock({
    minutes: undefined,
    seams: seams.seams,
    state: command === "pause" ? "paused" : "running",
  });
  return { detail: clock.detail, refused: clock.refused };
}
