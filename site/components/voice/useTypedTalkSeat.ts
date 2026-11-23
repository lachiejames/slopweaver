/**
 * The typed box's state and phase, the seat a call or a typed conversation takes in the provider, and the shapes the
 * typed box holds a conversation in. Split from `useTypedTalk.ts` to keep it under the line cap.
 */
import { type GateEntry, standingReads } from "../../lib/relayGate";
import { stillMine } from "../live/talkSession";
import type { HeldPlanCall, speechShower } from "./planWiringHeld";
import type { TypedSend } from "./typedTalkClient";

/** Where the typed conversation is: none yet, being opened, open and waiting for the owner, or answering them. */
export type TypedPhase = "idle" | "opening" | "open" | "sending" | "replying";

/**
 * How a typed conversation opens: `fresh` for a new one, which starts with none of the last one's tool lines, or
 * `gone-reopen` for the one re-open after the server let the held thread go, which keeps them.
 */
export type TypedOpenMode = "fresh" | "gone-reopen";

/** The typed box's state and its two acts. */
export interface TypedTalk {
  readonly phase: TypedPhase;
  /** Why the last open or send did not plainly go, opening with whether it was not sent or maybe sent, until the next. */
  readonly failure: string | undefined;
  /** Send one message, opening the conversation first when none is held; answers whether the thread took it. */
  readonly send: (input: { text: string }) => Promise<boolean>;
  /** End the conversation, if one is held, with why. */
  readonly end: (input: { why: string | undefined }) => void;
  /**
   * Make way for a voice call: let an idle conversation go and answer true — the call's offer ends it on the server,
   * or refuses while its turn runs — or tell `refused` why one the page sees answering waits.
   */
  readonly yieldToCall: (input: { refused: (why: string) => void }) => boolean;
  /** Forget a look the owner's last message asked for and has not yet taken: the messenger closed. */
  readonly dropLook: () => void;
}

/**
 * The seat a call or a typed conversation takes in the provider: its generation, the plan call it holds, the tool
 * calls run on it and the relay gate's record. Changed only through these, made over the provider's own refs.
 */
export interface CallSeat {
  /** Take the seat for a new conversation — a new generation, no tool call run, nothing heard — answering it. */
  readonly take: () => number;
  /** Whether the generation `mine` still holds the seat. */
  readonly holds: (input: { mine: number }) => boolean;
  /** The plan call the seat holds now. */
  readonly held: () => HeldPlanCall | undefined;
  /** Hold a plan call in the seat, with what its thread holds from its start for the relay gate. */
  readonly hold: (input: { held: HeldPlanCall; packed: boolean }) => void;
  /** Give the seat up: a new generation, and `held` let go of when the seat still holds it. */
  readonly leave: (input: { held: HeldPlanCall }) => void;
  /** Words the owner typed, which the relay gate hears as it hears their speech. */
  readonly heard: (input: { text: string }) => void;
  /** Every tool call already run on the plan call held. */
  readonly claimed: { current: Set<string> };
}

/**
 * The seat over the provider's refs — made once, by the provider that owns them.
 *
 * @param generation the provider's call generation
 * @param planCall the plan call the provider holds
 * @param claimedCalls every tool call already run on it
 * @param gateLog the relay gate's record
 * @param standingData the reads the held session carries from its start, which the relay gate weighs
 * @returns the seat
 */
export function callSeat({
  generation,
  planCall,
  claimedCalls,
  gateLog,
  standingData,
}: {
  generation: { current: number };
  planCall: { current: HeldPlanCall | undefined };
  claimedCalls: { current: Set<string> };
  gateLog: { current: GateEntry[] };
  standingData: { current: readonly string[] };
}): CallSeat {
  return {
    claimed: claimedCalls,
    heard: ({ text }) => {
      gateLog.current.push({ kind: "heard", text, typed: true });
    },
    held: () => planCall.current,
    hold: ({ held, packed }) => {
      planCall.current = held;
      standingData.current = standingReads({ packed });
    },
    holds: ({ mine }) => stillMine({ current: generation.current, mine }),
    leave: ({ held }) => {
      generation.current += 1;
      if (planCall.current === held) {
        planCall.current = undefined;
      }
    },
    take: () => {
      generation.current += 1;
      claimedCalls.current = new Set();
      gateLog.current = [];
      return generation.current;
    },
  };
}

/** A message sent onto a conversation, and how it landed. */
export interface SentOn {
  readonly now: HeldTyped;
  readonly said: TypedSend;
}

/** The conversation this page holds, with the call it is written under and the shower its speech goes through. */
export interface HeldTyped {
  readonly held: HeldPlanCall;
  readonly mine: number;
  readonly call: string;
  readonly show: ReturnType<typeof speechShower>;
}
