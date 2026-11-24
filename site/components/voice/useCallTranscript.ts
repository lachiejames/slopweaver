"use client";

/**
 * The console voice's call, written down as it runs — the hook `VoiceProvider.tsx` feeds, over one
 * `site/lib/transcriptSink.ts` sink for the page's life. It owns the call the sink is on, the snapshot of speech
 * still going on every few seconds, and how the page's own tool and relay lines become lines of the call.
 *
 * A call that drops must not lose the steers the owner gave it, so the transcript lives outside the page. The file is `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl`, written by `slopweaver talk transcript`
 * behind `/api/talk/transcript`; `talk calls`, `talk recent` and the next call's continuity read it back.
 */
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";

import { isBag, str } from "../../lib/bag";
import type { ReconnectJournal } from "../../lib/callReconnect";
import type { HeardOver } from "../../lib/heardOver";
import type { PlanUsageEvent, PlanWrittenEvent } from "../../lib/planCallContract";
import { type CopyOffer, copyOfferWire } from "../../lib/runningListCopy";
import {
  type CardMoveCallLine,
  type TalkTranscriptWire,
  TRANSCRIPT_TEXT_MAX,
  wireForInstance,
} from "../../lib/talkTranscript";
import { refusedDetail } from "../../lib/transcriptLoss";
import { createTranscriptSink } from "../../lib/transcriptSink";
import type { TranscriptPostAnswer, TranscriptSink } from "../../lib/transcriptSinkContract";
import { relayJournalDetail } from "./relayAttemptPost";
import { transcriptToolLine } from "./transcriptToolLine";
import { useLatest } from "./useLatest";
import type { LiveMeta, RelayLine, ToolLine, VoiceState } from "./voiceContext";

/**
 * How often a still-open stretch of speech is written down, so a call dropped mid-sentence keeps the sentence — and
 * a batch that got no answer is tried again, on a call or after it.
 */
const PARTIAL_EVERY_MS = 4000;

/** What the provider tells the transcript. */
export interface CallTranscript {
  /** A new call: mints its id, which every line of it names. */
  readonly begin: () => string;
  /**
   * The call connected: its open line, stamped when the call BEGAN — before its mint read what the owner typed — so a turn the owner
   * types while it is still connecting is after that floor, and reaches their next call rather than falling below it.
   */
  readonly open: (input: { call: string; minted: LiveMeta; typed?: boolean }) => void;
  /** A stretch of speech still going, with the card open as it was heard and whether the voice opened it. */
  readonly speaking: TranscriptSink["speaking"];
  /** A stretch of speech that closed, with the card open as it was heard and whether the voice opened it. */
  readonly spoke: TranscriptSink["spoke"];
  /** A tool line the page drew. */
  readonly tool: (input: { line: ToolLine }) => void;
  /**
   * A tool line and the exact answer the model was handed, told once the answer was DELIVERED
   * (`./toolAnswerSettle.ts`): the line drawn among the page's tool lines when `drawn` — the session that ran it still
   * running — and line and answer written to the call the tool BEGAN in, `current()` read before it ran, so a hang-up
   * while it was delivered lands it on that call after its close, never on the next one. Nothing is written for a tool
   * that began with no call.
   */
  readonly settledTool: (input: {
    call: string | undefined;
    line: ToolLine;
    answer: string;
    drawn: boolean;
    turnId: string | undefined;
  }) => void;
  /**
   * Bind one orb cue's trace to the call running NOW, as a `cue` tool line: a cue still routing when the owner hangs up and
   * opens the next call settles onto the call it was decided on, never the new one's. A
   * line is recorded a task after it is told, never inside the cue path; one arriving once that call's file has
   * closed is dropped like any other (`transcriptSink.ts`), so a cue the
   * hang-up itself fades keeps only its played.
   */
  readonly cue: VoiceState["traceCue"];
  /**
   * A relay the page drew — each state of it, the last per turn kept — written to the call it BEGAN in: a relay still
   * posting when the owner hangs up and opens the next call is that earlier call's, never the new one's.
   */
  readonly relay: (input: { call: string | undefined; line: RelayLine }) => void;
  /**
   * The delegated plan thread's token usage after one turn — the only record of what a call cost per turn, since
   * Codex keeps no rollout of an ephemeral thread.
   */
  readonly usage: (input: { usage: PlanUsageEvent }) => void;
  /**
   * One completed message the plan thread handed the voice to say — what lets the file tell what the thread WROTE
   * apart from what the voice SAID.
   */
  readonly written: (input: { event: PlanWrittenEvent }) => void;
  /**
   * One message the voice offered on a call, whole (`../../lib/runningListCopy.ts`): `true` once its line is queued
   * on the call now running, `false` when no call is open to hold it — and the running list then keeps it off too, so
   * every offer a call made is one its file was given. A batch the route later refuses is said as the transcript tool
   * line.
   */
  readonly offered: (input: { offer: CopyOffer }) => boolean;
  /**
   * The Queue walk moved from one card to the next (`../../lib/cardWalk.ts`), written to the call now running, so
   * `talk transcript` takes the card the owner left off their Queue or defers it.
   */
  readonly cardMove: (input: { move: Omit<CardMoveCallLine, "atIso" | "kind"> }) => void;
  /** The call now running, or `undefined` before the first. */
  readonly current: () => string | undefined;
  /**
   * The call's end, once — as a `keepalive` post when the page is going away — then the reconnect steps this end
   * produced (`site/lib/callReconnect.ts`), which the sink takes only onto a call it has closed.
   */
  readonly end: (input: { why: string | undefined; leaving: boolean; journal: ReconnectJournal | undefined }) => void;
  /**
   * Steps of reconnecting a call that dropped (`site/lib/callReconnect.ts`), written onto that call — one this page
   * already closed — and nothing when there are none to write.
   */
  readonly reconnect: (input: { journal: ReconnectJournal | undefined }) => void;
  /** The cards the owner's utterances since the last relay began over — what a relay is about. */
  readonly heardOver: () => HeardOver | undefined;
  /** What one segment of this call was stamped with when first heard: the card it began over. */
  readonly heardStamp: TranscriptSink["heardStamp"];
  /** A relay went out: what the next one is about starts again from the owner's next words. */
  readonly relayed: () => void;
  /** Whether the current call has words not on disk yet, which a rollover waits on before it releases the call. */
  readonly unwritten: TranscriptSink["unwritten"];
}

/**
 * Post one batch to the route.
 *
 * @param wire the batch
 * @param keepalive whether the page is going away
 * @returns the status and the route's why
 */
async function postBatch({
  wire,
  keepalive,
}: {
  wire: TalkTranscriptWire;
  keepalive: boolean;
}): Promise<TranscriptPostAnswer> {
  const response = await fetch("/api/talk/transcript", {
    body: JSON.stringify(wire),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    keepalive,
    method: "POST",
  });
  const body: unknown = await response.json().catch(() => undefined);
  return { status: response.status, why: isBag(body) ? str({ bag: body, key: "why" }) : undefined };
}

/**
 * The call transcript for the page's life.
 *
 * @param setTools the page's tool lines, where a batch the route refused is said
 * @param kept how many tool lines the page keeps
 * @param onUnwritten told the turns whose speech a lost batch carried, so the history keeps them on the page; read
 *   once, so it must be stable for the page's life
 * @param instance `e2e` when the desktop test instance runs the page: every batch posted, retries included, says so
 * @returns what the provider tells the transcript, stable for the page's life
 */
export function useCallTranscript({
  setTools,
  kept,
  onUnwritten,
  instance,
}: {
  setTools: Dispatch<SetStateAction<readonly ToolLine[]>>;
  kept: number;
  onUnwritten: (input: { turns: readonly string[] }) => void;
  instance: "e2e" | undefined;
}): CallTranscript {
  const call = useRef<string | undefined>(undefined);
  const beganIso = useRef<string | undefined>(undefined);
  // Read as each batch posts, so a retry carries the marker the page has now (`wireForInstance`).
  const marker = useLatest({ value: instance });
  const [sink] = useState(() =>
    createTranscriptSink({
      nowIso: () => new Date().toISOString(),
      onRefused: (refused) => {
        const line: ToolLine = {
          detail: refusedDetail(refused),
          ms: undefined,
          name: "transcript",
          refused: true,
          usage: undefined,
        };
        setTools((held) => [...held.slice(-(kept - 1)), line]);
        if (refused.turns.length > 0) {
          onUnwritten({ turns: refused.turns });
        }
      },
      post: ({ wire, keepalive }) =>
        postBatch({ keepalive, wire: wireForInstance({ instance: marker.current, wire }) }),
    }),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      sink.snapshot();
    }, PARTIAL_EVERY_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [sink]);

  return useMemo<CallTranscript>(() => {
    const reconnect: CallTranscript["reconnect"] = ({ journal }) => {
      if (journal === undefined) {
        return;
      }
      journal.events.forEach((event) => {
        sink.reconnect({ call: journal.callId, line: { atIso: new Date().toISOString(), event, kind: "reconnect" } });
      });
    };
    return {
      begin: () => {
        const minted = crypto.randomUUID();
        call.current = minted;
        beganIso.current = new Date().toISOString();
        sink.begin({ call: minted });
        return minted;
      },
      end: ({ journal, leaving, why }) => {
        sink.end({ leaving, why });
        reconnect({ journal });
      },
      heardOver: sink.heardOver,
      heardStamp: sink.heardStamp,
      offered: ({ offer }) =>
        sink.record({
          call: call.current,
          line: { atIso: new Date().toISOString(), kind: "offered", offer: copyOfferWire({ offer }) },
        }),
      open: ({ call: opened, minted, typed = false }) => {
        const { model, sessionId, voice } = minted;
        const atIso = beganIso.current;
        if (atIso === undefined) {
          throw new Error("a call opened that never began");
        }
        const line = { atIso, kind: "open", model, sessionId, voice } as const;
        sink.open({ call: opened, line: typed ? { ...line, surface: "typed" } : line });
      },
      cardMove: ({ move }) => {
        sink.record({ call: call.current, line: { ...move, atIso: new Date().toISOString(), kind: "card-move" } });
      },
      current: () => call.current,
      reconnect,
      relay: ({ call: began, line }) => {
        const { about, heard, outcome, say } = line;
        // The record keeps a retry's first refusal whole, joined to the line it was carried apart from.
        const detail = relayJournalDetail({ line });
        let turnId: string | null = null;
        if (line.turnId !== undefined) {
          turnId = line.turnId;
        }
        const atIso = new Date().toISOString();
        const recorded = { about, atIso, detail, heard, kind: "relay", outcome, say, turnId } as const;
        // Only a judged answer carries the field: `talk transcript` lands nothing on a card without it.
        const judged = line.answersCard === true ? { ...recorded, answersCard: true as const } : recorded;
        const also = line.alsoAnswers === undefined ? {} : { alsoAnswers: line.alsoAnswers };
        sink.record({ call: began, line: { ...judged, ...also } });
      },
      relayed: sink.relayed,
      speaking: sink.speaking,
      spoke: sink.spoke,
      unwritten: sink.unwritten,
      cue: () => {
        const began = call.current;
        return ({ detail, refused }) => {
          // Best effort like the cue it describes: a throw here costs this line, never the cue path that told it.
          try {
            const atIso = new Date().toISOString();
            // A task later, in order: the sink's queue work never delays a note, a fade's release or the next cue's
            // effect.
            setTimeout(() => {
              try {
                sink.record({ call: began, line: { atIso, detail, kind: "tool", name: "cue", refused } });
              } catch {
                // The line is lost in its own task; nothing else rode on it.
              }
            }, 0);
          } catch {
            // The line is lost; the cue is not.
          }
        };
      },
      tool: ({ line }) => {
        sink.record({ call: call.current, line: transcriptToolLine({ atIso: new Date().toISOString(), line }) });
      },
      settledTool: ({ answer, call: began, drawn, line, turnId }) => {
        const atIso = new Date().toISOString();
        if (drawn) {
          setTools((held) => [...held.slice(-(kept - 1)), { ...line, settledAtIso: atIso }]);
        }
        if (began === undefined) {
          return;
        }
        // A tool no turn called writes no turn id: the line's field is absent, never `undefined`.
        const turn = turnId === undefined ? {} : { turnId };
        sink.settledTool({ call: began, line: { ...transcriptToolLine({ atIso, line }), answer, ...turn } });
      },
      usage: ({ usage }) => {
        const { contextWindow, last, total, turnId } = usage;
        sink.record({
          call: call.current,
          line: { atIso: new Date().toISOString(), contextWindow, kind: "usage", last, total, turnId },
        });
      },
      written: ({ event }) => {
        const { itemId, text, turnId } = event;
        sink.record({
          call: call.current,
          line: {
            atIso: new Date().toISOString(),
            itemId,
            kind: "wrote",
            text: text.slice(0, TRANSCRIPT_TEXT_MAX),
            turnId,
          },
        });
      },
    };
  }, [kept, setTools, sink]);
}
