/**
 * A plan call's data-channel handlers: the folded v3 effects (`lib/talkPlanEvents.ts`) and the owner's typed turn the voice
 * took. Split from `planWiring.ts` to keep it under the line cap.
 */
import {
  foldLookAck,
  foldLookFrame,
  LOOK_ACK_START,
  LOOK_FRAME_START,
  type LookAckState,
  type LookAsk,
  type LookFrameState,
} from "../../lib/lookAck";
import type { PlanTypedInEvent } from "../../lib/planCallContract";
import { type GateEntry, speechStepOf } from "../../lib/relayGate";
import type { PlanEffect } from "../../lib/talkPlanEvents";
import type { ActivityInput } from "../../lib/voiceActivity";
import { voiceAsked, voicePromiseOf } from "../../lib/voiceOwed";
import type { Segment, ToolLine } from "./voiceContext";

/**
 * The handler for a plan call's data-channel effects.
 *
 * @param act feeds the activity fold
 * @param gateLog the relay gate's record, which every fragment the owner was heard saying joins
 * @param show puts a stretch of speech in the transcript
 * @param note writes a line in the call's log
 * @param looking has the voice say it is looking, or finding it, once a look or a lookup the owner asked for is handed off
 *   (`../../lib/lookAck.ts`); the owner's open turn is read from this handler's own effects, so each call — a reconnect's
 *   included — starts clean
 * @param framing takes a frame of the owner's screen for the thinking model answering their turn, once a turn that asked for a
 *   look is handed off or the owner's words in it are final (`foldLookFrame`) — whether or not the voice has spoken since
 * @returns the handler
 */
export function planEffectHandler({
  act,
  gateLog,
  show,
  note,
  looking,
  framing,
}: {
  act: (input: { input: ActivityInput }) => void;
  gateLog: { current: GateEntry[] };
  show: (input: { speech: Segment; final: boolean }) => void;
  note: (input: { line: ToolLine }) => void;
  looking: (input: { ask: LookAsk }) => void;
  framing: () => void;
}): (effect: PlanEffect) => void {
  let lookAck: LookAckState = LOOK_ACK_START;
  let lookFrame: LookFrameState = LOOK_FRAME_START;
  const stretchText = new Map<string, string>();
  return (effect) => {
    const ack = foldLookAck({ effect, state: lookAck });
    lookAck = ack.state;
    if (ack.say !== undefined) {
      looking({ ask: ack.say });
    }
    const framed = foldLookFrame({ effect, state: lookFrame });
    lookFrame = framed.state;
    if (framed.frame) {
      framing();
    }
    if (effect.kind === "heard") {
      if (effect.span === undefined) {
        gateLog.current.push({ kind: "heard", text: effect.text });
      } else {
        gateLog.current.push({ kind: "heard", span: effect.span, text: effect.text });
      }
      act({ input: { kind: "heard", text: effect.text } });
    } else if (effect.kind === "spoke") {
      act({ input: { kind: "spoke" } });
    } else if (effect.kind === "segment") {
      show({ final: effect.final, speech: { id: effect.id, text: effect.text, who: effect.who } });
      if (effect.who === "owner") {
        // Whether a stretch of the owner's is still open when the voice relays, and whether each fragment heard is
        // matched by its own stretch's growth, so the words do not end early (`heardTailOf`).
        const step = speechStepOf({
          before: stretchText.get(effect.id),
          final: effect.final,
          id: effect.id,
          span: effect.span,
          text: effect.text,
        });
        if (step !== undefined) {
          gateLog.current.push(step);
        }
        if (effect.final) {
          stretchText.delete(effect.id);
        } else {
          stretchText.set(effect.id, effect.text);
        }
        // Whether the owner's turn is still open, which a held rollover waits out (`pageRolloverHold`, `callRolloverFloor.ts`).
        act({ input: { event: { final: effect.final, id: effect.id, kind: "segment" }, kind: "owner" } });
      } else {
        // Which voice turn is newest, so the resume can tell the owner's words after it from a late fragment of theirs before it.
        act({ input: { id: effect.id, kind: "voice-turn" } });
      }
      if (effect.final && effect.who === "voice" && effect.text.trim() !== "") {
        // Whether its turn ended on a question decides whose turn the quiet after it is (`voiceOwesTurn`); whether on a
        // promise, whether the page presses the nudge itself when nothing starts (`promiseDueOf`).
        act({
          input: {
            asked: voiceAsked({ text: effect.text }),
            kind: "voice-finished",
            promised: voicePromiseOf({ text: effect.text }),
          },
        });
      }
    } else if (effect.kind === "delegated") {
      act({ input: { id: effect.id, kind: "delegated", responseId: undefined, target: effect.target } });
    } else if (effect.kind === "usage" && effect.limitStatus !== undefined) {
      let detail = `plan usage limit: ${effect.limitStatus}`;
      if (effect.resetSeconds !== undefined) {
        detail += `, resets in ${String(Math.ceil(effect.resetSeconds / 60))} min`;
      }
      note({ line: { detail, ms: undefined, name: "plan", refused: true, usage: undefined } });
    }
  };
}

/**
 * What the window holding a call does with the owner's typed turn the voice took (`PlanTypedInEvent`): what the owner's speech does
 * once heard — the relay gate hears it, the activity fold hears it, and it is shown, and so written into the call file,
 * as one finished turn of the owner's. A replayed event, by the page's message id, is heard and shown once.
 *
 * @param act feeds the activity fold
 * @param gateLog the relay gate's record
 * @param show puts it in the transcript as the owner's
 * @returns the handler
 */
export function typedInHandler({
  act,
  gateLog,
  show,
}: {
  act: (input: { input: ActivityInput }) => void;
  gateLog: { current: GateEntry[] };
  show: (input: { speech: Segment; final: boolean }) => void;
}): (input: { event: PlanTypedInEvent }) => void {
  const seen = new Set<string>();
  return ({ event }) => {
    if (seen.has(event.messageId)) {
      return;
    }
    seen.add(event.messageId);
    gateLog.current.push({ kind: "heard", text: event.text, typed: true });
    act({ input: { kind: "heard", text: event.text, typed: true } });
    act({ input: { event: { kind: "typed" }, kind: "owner" } });
    show({ final: true, speech: { id: `typed-in-${event.messageId}`, text: event.text, who: "owner" } });
  };
}
