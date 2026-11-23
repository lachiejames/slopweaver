/*
 * The relay the hand-off and gate tests share (`relayAttempt.test.ts`, `relayAttemptAccept.test.ts`): the turn and
 * card it is made under, the owner's words cut and whole, and the gate's sentence when nothing new has been said.
 */
import { type GateEntry, NOTHING_NEW_SINCE_RELAY } from "../../lib/relayGate";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";

export const TURN = "a0000017-0000-4000-8000-000000000019";
export const CARD = "ask:queue-shows-raw-user-id";
export const NOT_TAKEN: TalkRelayWire["screen"] = { kind: "none", reason: "not-taken-this-turn" };
export const SHUT_NOTHING_NEW = NOTHING_NEW_SINCE_RELAY;

export const HEARD: GateEntry = { kind: "heard", text: "fix the tab" };
/** The wire's head for {@link HEARD}: spoken words with no finished stretch after them, which `heardTailOf` reads cut. */
export const CUT = { about: CARD, heard: "fix the tab", heardTail: "cut" } as const;

/** The owner's words matched by their own stretch's growth over the same audio, then that stretch finished: `whole`. */
export const WHOLE_STRETCH: readonly GateEntry[] = [
  { kind: "heard", span: { endMs: 7_400, startMs: 7_000 }, text: "fix the tab" },
  { final: false, grew: "fix the tab", id: "turn_1", kind: "speech-segment", span: { endMs: 7_400, startMs: 7_000 } },
  { final: true, id: "turn_1", kind: "speech-segment" },
];
