"use client";

/**
 * The orb messenger's typed box (`Messenger.tsx`): the console voice's typed twin, run through the call's own machinery.
 *
 * The voice can tell the owner to paste a link "here", so there has to be a here. A typed conversation
 * (`site/lib/talkTypedSession.ts`) takes the seat a call takes — the provider's plan
 * call, under a fresh generation — and its event stream feeds the same handler: a tool call it makes is claimed, run
 * and answered by `answerTool` like a call's, a relay goes through the same gate, and every line lands in one call file
 * marked `surface: typed`. What differs is the medium: the owner's words are shown and written the moment the thread
 * takes them, and the answer is the thread's own writing, streamed onto the transcript the voice's speech is shown on.
 *
 * One conversation at a time: a voice call ends an idle typed one before it starts (`start` asks {@link TypedTalk}),
 * waits for one still answering, and a send while a call is up goes into that call instead (`typedInClient.ts`). The
 * server rules the same way over every tab (`site/lib/talkArbiter.ts`).
 */
import { type Dispatch, type SetStateAction, useCallback, useMemo, useRef, useState } from "react";

import { TYPED_IS_REPLYING, TYPED_UNSURE_HOLD_MS } from "../../lib/talkArbiter";
import type { HeardStamp } from "../../lib/transcriptSinkContract";
import { type TypedLookCell, typedLookOnSend } from "../../lib/typedLookGate";
import type { ActivityInput } from "../../lib/voiceActivity";
import type { HeardSegment } from "../../lib/voiceTranscript";
import { followPlanCall, stopPlanCall } from "./planCallClient";
import { type PlanToolCall, planCallEventHandler } from "./planWiring";
import { claimOnHeld, failOnHeld, type HeldPlanCall, releasePlanCall, speechShower } from "./planWiringHeld";
import { type OwedSend, openTypedTalk, phaseAfterSend, sayTyped, sendTaken, typedHoldsCall } from "./typedTalkClient";
import { typedTurnFollower } from "./typedTurnNotice";
import type { CallTranscript } from "./useCallTranscript";
import type { CallSeat, HeldTyped, SentOn, TypedOpenMode, TypedPhase, TypedTalk } from "./useTypedTalkSeat";
import type { ToolLine } from "./voiceContext";

export { callSeat } from "./useTypedTalkSeat";

/**
 * The typed box, in the provider's seat.
 *
 * @param seat makes the seat a call takes, which the typed conversation takes instead while it is open — read only
 *   from a handler, never while rendering, since it is the provider's refs
 * @param transcript the call file the conversation is written to
 * @param setSegments the shown transcript's setter
 * @param fresh carries the conversation shown now into the earlier one, as a new typed conversation opens
 * @param kept how many shown segments are kept
 * @param openNow the key of the card open as the owner sends, whether the voice opened it, and the console they are on
 * @param act feeds the activity fold
 * @param note writes a line in the call's log
 * @param answerTool runs one tool call the thread made and posts its answer
 * @param conversationOpened resets the conversation's work on screen as one opens — a fresh one drops the last one's
 *   tool lines, so the messenger band never credits a read it did not make (`./useConversationWork.ts`)
 * @param turnStarted tells the triage pass an answer began, so a ruling in it lands on the card in front of the owner then
 * @param typedLook the one look the owner's latest message asked for, set here and spent where the look is taken
 * @returns the box's state and acts
 */
export function useTypedTalk({
  seat,
  transcript,
  setSegments,
  fresh,
  kept,
  openNow,
  act,
  note,
  answerTool,
  conversationOpened,
  turnStarted,
  typedLook,
}: {
  seat: () => CallSeat;
  transcript: CallTranscript;
  setSegments: Dispatch<SetStateAction<readonly HeardSegment[]>>;
  fresh: (input: { medium: "typed" }) => void;
  kept: number;
  openNow: () => HeardStamp;
  act: (input: { input: ActivityInput }) => void;
  note: (input: { line: ToolLine }) => void;
  answerTool: (input: PlanToolCall & { mine: number; typed: boolean }) => Promise<void>;
  conversationOpened: (input: { carrying: boolean }) => void;
  turnStarted: (input: { readonly turnId: string }) => void;
  typedLook: TypedLookCell;
}): TypedTalk {
  const [phase, setPhase] = useState<TypedPhase>("idle");
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const typed = useRef<HeldTyped | undefined>(undefined);
  const sending = useRef(false);
  // The turns the thread has announced, whether it has announced one since the last send went out, and until when a
  // send of unknown fate still counts as answered (`TYPED_UNSURE_HOLD_MS`).
  const turns = useRef({ completed: new Set<string>(), running: new Set<string>() });
  const turnHeard = useRef(false);
  const heardDuring = useRef(new Set<string>());
  const awaiting = useRef(false);
  const unsureUntilMs = useRef<number | undefined>(undefined);
  // A send of unknown fate, shown as the owner's and heard once the thread announces a turn: only their send starts one. A turn
  // heard while it was out, when an earlier unsure send may own it, is never taken as its.
  const owed = useRef<OwedSend | undefined>(undefined);

  /** The conversation held, while it still holds the seat: a call's start or a leaving page takes it. */
  const holding = useCallback((): HeldTyped | undefined => {
    const now = typed.current;
    if (now === undefined || !seat().holds({ mine: now.mine })) {
      typed.current = undefined;
      return undefined;
    }
    return now;
  }, [seat]);

  /**
   * Let the conversation go: stopped on the server, or with `detach` only let go here, for a call whose offer the
   * server's arbiter rules on — it ends an idle one there and refuses the call while a turn runs, which a page whose
   * notice of that turn is still in flight cannot know.
   */
  const leave = useCallback(
    ({ why, detach }: { why: string | undefined; detach: boolean }): void => {
      const now = holding();
      typed.current = undefined;
      typedLook.set(undefined);
      setPhase("idle");
      if (now === undefined) {
        return;
      }
      seat().leave({ held: now.held });
      if (detach) {
        now.held.follow.abort();
      } else {
        releasePlanCall({ held: now.held });
      }
      if (transcript.current() === now.call) {
        transcript.end({ journal: undefined, leaving: false, why });
      }
    },
    [holding, seat, transcript, typedLook],
  );

  const end = useCallback(
    ({ why }: { why: string | undefined }): void => {
      leave({ detach: false, why });
    },
    [leave],
  );

  const open = useCallback(async (): Promise<HeldTyped | undefined> => {
    const sat = seat();
    const mine = sat.take();
    const call = transcript.begin();
    fresh({ medium: "typed" });
    setSegments([]);
    setPhase("opening");
    const opened = await openTypedTalk();
    if (!sat.holds({ mine })) {
      if (opened.ok) {
        stopPlanCall({ callId: opened.callId, keepalive: false });
      }
      return undefined;
    }
    if (!opened.ok) {
      transcript.end({ journal: undefined, leaving: false, why: opened.notOpened });
      setFailure(`not sent: ${opened.notOpened}`);
      setPhase("idle");
      return undefined;
    }
    const { backendModel, callId, packed, threadId } = opened;
    turns.current = { completed: new Set(), running: new Set() };
    unsureUntilMs.current = undefined;
    owed.current = undefined;
    const plan: HeldPlanCall = { callId, claimant: crypto.randomUUID(), follow: new AbortController() };
    sat.hold({ held: plan, packed });
    const show = speechShower({ call, kept, openNow, setSegments, transcript });
    const current = (): boolean => sat.holds({ mine });
    const onEvent = planCallEventHandler({
      act,
      answer: (toolCall) => {
        void answerTool({ ...toolCall, mine, typed: true });
      },
      claim: claimOnHeld,
      claimed: sat.claimed,
      closing: () => false,
      current,
      ended: ({ why }) => {
        end({ why });
      },
      fail: failOnHeld,
      held: sat.held,
      journal: transcript.tool,
      note,
      // The server sends no progress cue to a typed conversation (`lib/talkTypedSession.ts`): it has no voice.
      progress: () => undefined,
      // Nor a herald: nothing on a typed conversation is spoken, so there is no line for a chime to come before.
      announce: () => undefined,
      // The server never arms a rollover for a typed conversation (`lib/talkTypedSession.ts`): nothing to roll.
      rollover: () => undefined,
      // The owner's words reach a typed conversation by `say`, never as a call's typed-in turn (`lib/talkTypedSession.ts`).
      typedIn: () => undefined,
      // A typed pass is rapid triage in the written console: the card in front of the owner as each
      // answer began is what a ruling in it lands on, as on a call.
      turnStarted,
      usage: transcript.usage,
      written: ({ event }) => {
        show({ final: event.final, speech: { id: `typed-${event.itemId}`, text: event.text, who: "voice" } });
        // The message whole, as a `wrote` line like a call's, so `talk fidelity` reads it against its turn's sources
        // with the turn named; a streamed piece is not yet the message.
        if (event.final) {
          transcript.written({ event });
        }
      },
    });
    const cells = { awaiting, heardDuring, owed, turnHeard, turns, unsureUntilMs };
    void followPlanCall({
      callId,
      onEvent: typedTurnFollower({ cells, current, heard: sat.heard, onEvent, setFailure, setPhase, show, typedLook }),
      signal: plan.follow.signal,
    });
    const minted = { backendModel, callId, model: backendModel, sessionId: threadId, threadId, voice: "none" };
    transcript.open({ call, minted, typed: true });
    const now: HeldTyped = { call, held: plan, mine, show };
    typed.current = now;
    setPhase("open");
    return now;
  }, [act, answerTool, end, fresh, kept, note, openNow, seat, setSegments, transcript, turnStarted, typedLook]);

  /**
   * The conversation held, or one opened when none is. A `fresh` one starts with none of the last one's tool lines; a
   * `gone-reopen` — `deliver`'s one re-open after the server let the held thread go — is a new thread but the same
   * conversation to the owner, so it keeps them.
   */
  const heldOrOpened = useCallback(
    async ({ mode }: { mode: TypedOpenMode }): Promise<HeldTyped | undefined> => {
      const now = holding();
      if (now !== undefined) {
        return now;
      }
      // In the same synchronous run as the open's own resets, before it awaits, so no line the new thread writes lands first.
      conversationOpened({ carrying: mode === "gone-reopen" });
      return open();
    },
    [conversationOpened, holding, open],
  );

  /** One message onto the conversation held, opening one in that mode when none is. */
  const sendOn = useCallback(
    async ({
      messageId,
      mode,
      text,
    }: {
      messageId: string;
      mode: TypedOpenMode;
      text: string;
    }): Promise<SentOn | undefined> => {
      const now = await heldOrOpened({ mode });
      if (now === undefined) {
        return undefined;
      }
      setPhase("sending");
      turnHeard.current = false;
      heardDuring.current = new Set();
      awaiting.current = true;
      const setAside = owed.current !== undefined;
      owed.current = undefined;
      // Armed before the send goes, so a thread that answers faster than this returns still finds it.
      typedLook.set(typedLookOnSend({ messageId, setAside, text }));
      return { now, said: await sayTyped({ callId: now.held.callId, messageId, text }) };
    },
    [heldOrOpened, typedLook],
  );

  /** One message, and what the page shows of how it landed. */
  const deliver = useCallback(
    async ({ text }: { text: string }): Promise<boolean> => {
      const messageId = crypto.randomUUID();
      // An earlier send of unknown fate is set aside while this one is out, so a turn this one starts is never taken
      // as its; it is owed again if this one is refused.
      const earlier = owed.current;
      let sent = await sendOn({ messageId, mode: "fresh", text });
      // One re-open when the held conversation is gone — the 90-minute ceiling, a server restart, a page reload.
      if (sent?.said.kind === "gone") {
        end({ why: sent.said.why });
        sent = await sendOn({ messageId, mode: "gone-reopen", text });
      }
      awaiting.current = false;
      if (sent === undefined) {
        typedLook.set(undefined);
        return false;
      }
      // Its turn may have run and ended while the send was out, with nothing left to close the look but this.
      if (sent.said.kind !== "accepted" || (turnHeard.current && turns.current.running.size === 0)) {
        typedLook.set(undefined);
      }
      // Refused, so any turn announced meanwhile was the earlier send's; one gone or never opened took it with it.
      if (sent.said.kind === "refused" && earlier !== undefined) {
        owed.current = earlier;
        if (turnHeard.current) {
          owed.current = undefined;
          sent.now.show({
            final: true,
            speech: { id: `typed-owner-${earlier.messageId}`, text: earlier.text, who: "owner" },
          });
          seat().heard({ text: earlier.text });
        }
      }
      const { now, said } = sent;
      setPhase(phaseAfterSend({ said, seen: turns.current }));
      // A turn heard while an earlier unsure send was set aside may be either one's, so it takes neither.
      const heardIsThis = turnHeard.current && earlier === undefined;
      if (said.kind !== "accepted" && !sendTaken({ said, turnHeard: heardIsThis })) {
        let why = `not sent: ${said.why}`;
        if (said.kind === "unknown") {
          why = `maybe sent: ${said.why}, so look before sending again`;
          // It may still start a turn, so the next one the thread announces is its — never one heard while it was
          // out, which an earlier unsure send may own — and until then the bounded guess holds a call off.
          owed.current = { messageId, notIts: new Set(heardDuring.current), text };
          unsureUntilMs.current = Date.now() + TYPED_UNSURE_HOLD_MS;
        }
        setFailure(why);
        return false;
      }
      now.show({ final: true, speech: { id: `typed-owner-${messageId}`, text, who: "owner" } });
      seat().heard({ text });
      return true;
    },
    [end, seat, sendOn, typedLook],
  );

  const send = useCallback(
    async ({ text }: { text: string }): Promise<boolean> => {
      if (sending.current || text.trim() === "") {
        return false;
      }
      sending.current = true;
      setFailure(undefined);
      return deliver({ text }).finally(() => {
        sending.current = false;
      });
    },
    [deliver],
  );

  const yieldToCall = useCallback(
    ({ refused }: { refused: (why: string) => void }): boolean => {
      const answering = phase === "sending" || phase === "replying";
      if (typedHoldsCall({ answering, nowMs: Date.now(), unsureUntilMs: unsureUntilMs.current })) {
        refused(TYPED_IS_REPLYING);
        return false;
      }
      leave({ detach: true, why: "the owner started a voice call, which carries the conversation on" });
      return true;
    },
    [leave, phase],
  );

  const dropLook = useCallback((): void => {
    typedLook.set(undefined);
  }, [typedLook]);

  return useMemo<TypedTalk>(
    () => ({ dropLook, end, failure, phase, send, yieldToCall }),
    [dropLook, end, failure, phase, send, yieldToCall],
  );
}
