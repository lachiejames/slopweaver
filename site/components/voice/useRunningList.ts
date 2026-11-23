"use client";

/**
 * The running list as the voice's window holds it (`../../lib/runningList.ts`): read through the console's route
 * when the window opens and every twenty seconds after, call or no call, and again the moment anything is added here,
 * so a fleet session's item reaches the owner within one poll and their own or the voice's at once. Nothing lives here between
 * reads — the list is the file `talk list` reads, so a hang-up, a reload or a restart shows the same ten.
 *
 * The dot's cursor is the newest number the owner has seen and that item's time, kept in this browser: the first read stores
 * the newest (so the ten already there never arrive as news), opening the list stores it again, and only the voice's
 * and the fleet's items above it count. A list file recreated under it numbers again from 1, so every read also
 * squares the cursor with the list (`seenCursorAfterRead`) — without that a stored `22` over a list numbered 3 to 12
 * keeps the dot dark.
 *
 * The voice's `offer_copy` is judged against the owner's exact voice rules before it is added — a Slack message as the owner against
 * the parked-draft shape and the per-paragraph word cap too — or refused when they cannot be checked (`../../lib/copyVoiceCheck.ts`), so the model
 * rewrites it before the owner ever sees it: the owner pastes it under their own name, past every send door. Asked on a call, it is ALSO written down as an `offered` line on the call's file
 * (`./useCallTranscript.ts`) before the list takes it — a call with no open record to hold its line refuses it rather
 * than showing it — and joins the relay gate's log once the list holds it, so the owner's next relay carries the exact
 * draft they were reacting to.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { checkCopyVoice } from "../../lib/copyVoiceCheck";
import type { GateEntry } from "../../lib/relayGate";
import {
  type RunningListAdd,
  type RunningListAddResult,
  type RunningListSnapshot,
  receiptHoldsAdd,
  runningListAddResultOf,
  runningListReadOf,
} from "../../lib/runningList";
import {
  type CopyOffer,
  copyDestinationOf,
  copyOfferText,
  copyOfferWire,
  offerCopyOf,
  offerFoldLine,
  offerStillLands,
} from "../../lib/runningListCopy";
import { runningListUnread, seenCursorAfterRead, seenCursorOnOpen, seenOf } from "../../lib/runningListDraw";
import type { MentionLabels } from "../../lib/slackMrkdwn";
import type { VoiceLink } from "../../lib/voiceActivity";
import { seenCursorNow, underSeenLock, useSeenCursor, writeSeenCursor } from "./seenCursorStore";
import type { CallTranscript } from "./useCallTranscript";
import { useLatest } from "./useLatest";

/** The route the list is read from and added to. */
const ROUTE = "/api/talk/list";

/**
 * How often the list is read again: the console's own background cadence. A fleet item can take this long to show;
 * every read is one `slopweaver` child, which the route shares between windows.
 */
const POLL_MS = 20_000;

/**
 * How long an add waits for the route: its own 15s verb timeout plus room for the request, so a route that never
 * answers is the unknown arm rather than an offer the voice waits on forever.
 */
const ADD_WAIT_MS = 20_000;

/** What an offer asked on a call is told when that call ended, or a fresh one replaced it, while the check ran. */
const CALL_CHANGED =
  "the call changed while the owner's voice rules were checked, so nothing went on their running list: if a call is still up, " +
  "call offer_copy again";

/** What an offer asked on a call is told when the call's record had no open call to write it to. */
const NOT_RECORDED =
  "the call's record was not open to keep it, so nothing went on the owner's running list: if a call is still up, call " +
  "offer_copy again";

/** What an offer is told when its tool call's id already names an item holding other words. */
const HELD_OTHER =
  "the owner's running list already holds a different message under this tool call's id, so this one did not go on it: call " +
  "offer_copy again";

/** What `offer_copy` answers the model: fixed words, never the message. */
export interface OfferAnswer {
  readonly answer: unknown;
  readonly detail: string;
  readonly refused: boolean;
}

/** The running list as the tray and the orb read it. */
export interface RunningListState {
  /** The list, newest first — `undefined` until the first read lands. */
  readonly snapshot: RunningListSnapshot | undefined;
  /** Why the last read failed, `undefined` when it did not. */
  readonly failure: string | undefined;
  /** How many of the voice's and the fleet's items the owner has not seen. */
  readonly unread: number;
  /** How the tray names a `<@U…>` mention, in what it draws and in the HTML half of a copy. */
  readonly labels: MentionLabels;
  /**
   * Add the owner's own words. Answers `undefined` once the list holds them, else why it may not: the tray keeps the draft
   * until then.
   */
  readonly add: (input: { text: string }) => Promise<string | undefined>;
  /** The owner is looking at the list: everything on it now is seen. */
  readonly markSeen: () => void;
}

/** Post one add, never throwing: a network failure is the unknown arm. */
async function postAdd({ add }: { add: RunningListAdd }): Promise<RunningListAddResult> {
  try {
    const response = await fetch(ROUTE, {
      body: JSON.stringify(add),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(ADD_WAIT_MS),
    });
    const answer = runningListAddResultOf({ value: await response.json() });
    if (answer === undefined) {
      return { outcome: "unknown", why: `the console answered ${String(response.status)} in a shape it never sends` };
    }
    return answer;
  } catch (cause: unknown) {
    return { outcome: "unknown", why: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The voice's offer as one add to the list: the whole message the owner copies, and the line its fold starts on.
 *
 * @param offer the offer the voice check passed
 * @param requestId the tool call's own token, so a retry of the same call is the same item
 * @returns the add
 */
function voiceAddOf({ offer, requestId }: { offer: CopyOffer; requestId: string }): RunningListAdd {
  const foldLine = offerFoldLine({ offer });
  return {
    id: requestId,
    origin: "voice",
    text: copyOfferText({ offer }),
    ...(offer.label === undefined ? {} : { label: offer.label }),
    ...(foldLine === undefined ? {} : { foldLine }),
  };
}

/**
 * The list, its dot, the two ways onto it from this window — the owner's add and the voice's `offer_copy` — and the
 * provider's seam that opens a fresh call.
 *
 * @param callIdNow the call or typed conversation up as the owner adds, which the route tells the list changed
 * @param copyLabels how the tray names a `<@U…>` mention, carried on the list's state so it draws from one value
 * @param freshConversation the act that turns the shown conversation fresh, called by the fresh-call seam
 * @param gateLog the relay gate's record of the session, which an offer landing on a call joins so a relay can carry it
 * @param link where this window's call is: an offer asked on one is written to its file
 * @param watcher the call's spoken-claims watcher, told an offer asked on it is on the list, the one thing that
 *   grounds the voice saying so (`../../lib/talkRunningListClaims.ts`); a ref, since each call swaps it
 * @param transcript the call's record, whose `offered` writes an offer onto the call's file and answers whether its
 *   line was queued
 * @returns the list's state, the tool's seam and the fresh-call seam
 */
export function useRunningList({
  callIdNow,
  copyLabels,
  freshConversation,
  gateLog,
  link,
  transcript,
  watcher,
}: {
  callIdNow: () => string | undefined;
  copyLabels: MentionLabels;
  freshConversation: (input: { medium: "voice" }) => void;
  gateLog: { readonly current: GateEntry[] };
  link: VoiceLink;
  transcript: Pick<CallTranscript, "offered">;
  watcher: { readonly current: { readonly offerLanded: () => void } };
}): {
  readonly freshCall: () => void;
  readonly list: RunningListState;
  readonly offerCopy: (input: { args: Record<string, unknown>; requestId: string }) => Promise<OfferAnswer>;
} {
  const { offered } = transcript;
  const [snapshot, setSnapshot] = useState<RunningListSnapshot | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const cursorValue = useSeenCursor();
  const inFlight = useRef(false);
  const read = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      const response = await fetch(ROUTE, { cache: "no-store" });
      const answer = runningListReadOf({ value: await response.json() });
      if (answer === undefined) {
        setFailure(`the console answered ${String(response.status)} in a shape it never sends`);
      } else if (answer.outcome === "read") {
        setSnapshot(answer.snapshot);
        setFailure(undefined);
      } else {
        setFailure(answer.why);
      }
    } catch (cause: unknown) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
    }
  }, []);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the list file is the external system: its state lands after the fetch
    void read();
    const timer = window.setInterval(() => {
      void read();
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [read]);
  // Every read squares the cursor with the list: the first read in this browser stores the newest, so what is already
  // there is not news, and a list that restarted its numbering under the cursor brings it back down.
  useEffect(() => {
    if (snapshot === undefined) {
      return;
    }
    const { items } = snapshot;
    // Squared against the cursor as it stands under the lock, never only as this window last drew it: an effect that
    // runs late must not bring down a cursor another window raised in between.
    underSeenLock({
      act: () => {
        const next = seenCursorAfterRead({
          cursor: seenCursorNow(),
          items,
          nowIso: new Date().toISOString(),
        });
        if (next !== undefined) {
          writeSeenCursor({ value: next });
        }
      },
    });
  }, [snapshot]);
  const seen = seenOf({ cursor: cursorValue });
  const newest = snapshot?.items.at(0);
  const shown = useLatest({ value: { cursorValue, newest } });
  const markSeen = useCallback((): void => {
    // Read again under the lock, not only as this window last drew it: another window may have written a newer one.
    underSeenLock({
      act: () => {
        // Read inside the lock, which is granted only after this commit's effects have all run: the tray's effect runs
        // before this provider's `useLatest` updates `shown`, so a read taken at the call still holds the last render's
        // newest item, and an item arriving while the tray is open stays unread.
        const now = shown.current;
        const next = seenCursorOnOpen({
          held: [now.cursorValue, seenCursorNow()],
          newest: now.newest,
        });
        if (next !== undefined) {
          writeSeenCursor({ value: next });
        }
      },
    });
  }, [shown]);
  const callId = useLatest({ value: callIdNow });
  const add = useCallback(
    async ({ text }: { text: string }): Promise<string | undefined> => {
      const live = callId.current();
      const result = await postAdd({
        add: { id: crypto.randomUUID(), origin: "owner", text, ...(live === undefined ? {} : { callId: live }) },
      });
      void read();
      if (result.outcome === "added") {
        return undefined;
      }
      return result.why;
    },
    [callId, read],
  );
  const live = link === "connecting" || link === "live" || link === "reconnecting";
  const callUp = useRef(live);
  // A layout effect, in the commit's own task, so no check resolving after a call ended reads it as up.
  useLayoutEffect(() => {
    callUp.current = live;
  });
  // Never reset, and a bigint never saturates, so no two offers this window makes share an id in a call's file.
  const minted = useRef(0n);
  // Which call it is: every fresh call this window opened, moved by `freshCall` alone, so a reconnect or a
  // rollover stays the same call, and a bigint never stops moving.
  const freshCalls = useRef(0n);
  const offerCopy = useCallback(
    async ({ args, requestId }: { args: Record<string, unknown>; requestId: string }): Promise<OfferAnswer> => {
      minted.current += 1n;
      const parsed = offerCopyOf({ args, made: minted.current });
      if (parsed.kind === "refused") {
        return { answer: { refused: parsed.why }, detail: "not a message to copy", refused: true };
      }
      const { offer } = parsed;
      // Where it goes decides which check it meets — a Slack message as the owner the Slack shape too — and is
      // carried nowhere else: not on the list, and not on the call's file.
      const where = copyDestinationOf({ args });
      if (where.kind === "refused") {
        return { answer: { refused: where.why }, detail: "no destination", refused: true };
      }
      const onCall = callUp.current;
      const asked = freshCalls.current;
      // The relay gate's log of the call that asked: every call start, a reconnect's included, opens a new record and
      // swaps in a new log in the same step, so this one still in place is that call still up.
      const askedLog = gateLog.current;
      const sameCall = (): boolean =>
        gateLog.current === askedLog && offerStillLands({ asked, callUp: callUp.current, now: freshCalls.current });
      // The owner's exact voice rules judge it before they see it: the whole message they copy, the fold included.
      const verdict = await checkCopyVoice({ destination: where.destination, text: copyOfferText({ offer }) });
      if (verdict.kind === "refused") {
        return { answer: { refused: verdict.reasons.join("\n") }, detail: "voice rule refused", refused: true };
      }
      if (onCall) {
        // Asked again after the wait: a call that ended, or that a fresh one replaced, while the check ran keeps its
        // offer off the list and off the new call's file ("some call is up" is not "the call that asked is up").
        if (!sameCall()) {
          return { answer: { refused: CALL_CHANGED }, detail: "call changed", refused: true };
        }
        // Written down before the list takes it: no open call to hold its line keeps it off the list too.
        if (!offered({ offer })) {
          return { answer: { refused: NOT_RECORDED }, detail: "no call record open", refused: true };
        }
      }
      const voiceAdd = voiceAddOf({ offer, requestId });
      const result = await postAdd({ add: voiceAdd });
      void read();
      if (result.outcome !== "added") {
        return { answer: { refused: result.why }, detail: "not added to the running list", refused: true };
      }
      if (!receiptHoldsAdd({ add: voiceAdd, receipt: result.receipt })) {
        return { answer: { refused: HELD_OTHER }, detail: "id held other words", refused: true };
      }
      // Asked once more after the add: a call that ended, or reconnected, while the list took it keeps its offer out of
      // the next call's relay gate. The asking call's file already holds its line.
      if (onCall && sameCall()) {
        // In the relay gate's record once the owner can see it, so the next relay carries the exact text they are reacting to
        // (`../../lib/relayGate.ts`'s `offeredSince`).
        askedLog.push({ kind: "offered", offer: copyOfferWire({ offer }) });
        watcher.current.offerLanded();
      }
      return {
        answer: { offered: true, where: "the owner's running list, at the bottom" },
        detail: "added to the running list",
        refused: false,
      };
    },
    [callUp, freshCalls, gateLog, minted, offered, read, watcher],
  );
  // A fresh call opens its conversation and moves the call count in one step, so an offer still in its check from the
  // call before never lands on this one's file. The list itself carries on: it outlives every call.
  const freshCall = useCallback((): void => {
    freshConversation({ medium: "voice" });
    freshCalls.current += 1n;
  }, [freshConversation, freshCalls]);
  const unread = runningListUnread({ items: snapshot === undefined ? [] : snapshot.items, seen });
  const list = useMemo<RunningListState>(
    () => ({ add, failure, labels: copyLabels, markSeen, snapshot, unread }),
    [add, copyLabels, failure, markSeen, snapshot, unread],
  );
  return { freshCall, list, offerCopy };
}
