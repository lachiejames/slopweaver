/**
 * The console voice's call transcript on its way to disk: the queue, the one post in flight, and what becomes of a
 * batch the route did not take. Plain rather than a hook, with the post injected, so every edge is a unit test;
 * `site/components/voice/VoiceProvider.tsx` holds one for the page's life and feeds it.
 *
 * A call that drops must not lose the steers the owner gave it, so the transcript does not live
 * only in the page. What a line says and how a batch is cut is `./talkTranscript.ts`.
 *
 * - **Only the current call, and only once its open line went in.** A line for an earlier call — a grouper closing
 *   late after a new call began — or for a call whose mint never finished is not written. The one exception is a
 *   reconnect step (`reconnect`), which is written onto a call this sink closed, once its `closed` line was written:
 *   the attempts to re-open a dropped call are that call's story, and an attempt that never went live has no file of
 *   its own (measured: a reconnect after the 90-minute limit failed and nothing on disk said why). The other is a
 *   tool's answer (`settledTool`), written only after the page handed it to the model, so a hang-up while it was being
 *   delivered still lands it on the call that asked — after that call's `closed` line, never on the call after it.
 * - **One post at a time.** A 200 posts the next batch; no answer or a 5xx puts the batch back at the front, tried
 *   again with the next line or the next `snapshot`, whichever comes first — so a batch left over after the call
 *   ended is still retried; any other status will refuse again, so the batch is dropped and SAID through
 *   `onRefused`, never silently.
 * - **Each line is minted a `writeId` once, as it is queued**, and keeps it through every retry. No answer does not
 *   mean nothing was written: the route can kill a verb a loaded machine has starved past its bound after it
 *   has appended, and the batch posted again would go in twice. With the ids the verb appends each line once. The
 *   instants and ids are `./transcriptStamps.ts`.
 * - **Each stretch of speech names the card open when it BEGAN** (`./transcriptHearing.ts`). Whether the voice opened
 *   that card (`openBy`) is taken the same first time, and `talk transcript` lands nothing said over a card the voice
 *   opened. The cards the owner's utterances since the last relay began over are
 *   `heardOver`, which says what a relay is about (`./heardOver.ts`).
 * - **It says whether the current call's words are on disk yet** (`unwritten`), which a rollover waits on: the
 *   successor's mint reads the call it replaces from its file, and a successor minted while an answer was still
 *   queued here was told an exchange that ended before that answer. A dead route is the rollover floor's to bound, not this.
 * - **The end is written once**, after a snapshot of the speech still open, both in the one post that follows — a
 *   `keepalive` post when the page is going away, which the browser lets outlive the page, and as many of them as
 *   the queue needs. The residues: a batch already in flight as the page goes is the browser's to finish or cancel,
 *   and so is a keepalive past the browser's own cap on keepalive bodies in flight — one it refuses gets no answer,
 *   so a page the back-forward cache keeps retries it.
 */

import {
  type CallLine,
  nextTranscriptBatch,
  type QueuedLine,
  type TalkTranscriptWire,
  TRANSCRIPT_BATCH_BYTES,
} from "./talkTranscript";
import { TranscriptHearing } from "./transcriptHearing";
import { callsOf, turnsOf } from "./transcriptLoss";
import type { TranscriptPostAnswer, TranscriptSink } from "./transcriptSinkContract";
import { TranscriptStamps } from "./transcriptStamps";

/** The most lines held while the disk is unreachable; the oldest go first past it, and the page says so. */
export const TRANSCRIPT_QUEUE_MAX = 2000;

/**
 * A sink with nothing queued and no call.
 *
 * @param post sends one batch; a `keepalive` one's answer is never read
 * @param onRefused says on the page that a batch was dropped, with how many lines, why, which calls they were of and
 *   the call open now — a batch can answer after its call ended, so the page must not read an earlier call's loss as
 *   this one's — and the turns whose speech was among the lost lines, which the history keeps on the page
 * @param nowIso the clock each line is stamped with
 * @param mintWriteId a fresh v4 UUID for each line queued, the browser's own unless a test counts them
 * @param queueMax the most lines held while no post is taken; past it the oldest go, SAID through `onRefused`
 * @returns the sink
 */
export function createTranscriptSink({
  post,
  onRefused,
  nowIso,
  mintWriteId = () => crypto.randomUUID(),
  queueMax = TRANSCRIPT_QUEUE_MAX,
}: {
  post: (input: { wire: TalkTranscriptWire; keepalive: boolean }) => Promise<TranscriptPostAnswer>;
  onRefused: (input: {
    calls: readonly string[];
    live: string | undefined;
    lines: number;
    turns: readonly string[];
    why: string;
  }) => void;
  nowIso: () => string;
  mintWriteId?: () => string;
  queueMax?: number;
}): TranscriptSink {
  let current: string | undefined;
  let isOpen = false;
  let queue: readonly QueuedLine[] = [];
  // The regular batch awaiting its answer, held whole so `unwritten` can say whose lines are in it.
  let posting: readonly QueuedLine[] | undefined;
  const stamps = new TranscriptStamps({ mintWriteId });
  const hearing = new TranscriptHearing({ nowIso });
  // A reconnect step reaches the queue only once its call's `closed` line was WRITTEN — the route answered 200 for it —
  // so no post, a keepalive racing the close included, lands a step ahead of the close or
  // without it. Until then a call's steps wait here; a close the queue dropped or the route refused takes them with it.
  const closesWritten = new Set<string>();
  const waiting = new Map<string, QueuedLine[]>();
  const closesIn = ({ lines }: { lines: readonly QueuedLine[] }): string[] =>
    lines.filter((queued) => queued.line.kind === "closed").map((queued) => queued.callId);
  const isStep = (queued: QueuedLine): boolean => queued.line.kind === "reconnect";
  // A lost close takes what waited behind it. A step goes quietly; a tool's answer is evidence, so its loss is said.
  const lost = ({ lines }: { lines: readonly QueuedLine[] }): void => {
    const answers: QueuedLine[] = [];
    for (const call of closesIn({ lines })) {
      const held = waiting.get(call);
      waiting.delete(call);
      if (held !== undefined) {
        answers.push(...held.filter((queued) => !isStep(queued)));
      }
    }
    if (answers.length > 0) {
      onRefused({
        calls: callsOf({ lines: answers }),
        live: liveCall(),
        lines: answers.length,
        turns: [],
        why: "the call's close was not written, so the tool answers held behind it went with it",
      });
    }
  };
  // A step is diagnostics: on a full queue it is the one that goes, never a line already queued.
  const admit = ({ steps }: { steps: readonly QueuedLine[] }): void => {
    queue = [...queue, ...steps.slice(0, Math.max(queueMax - queue.length, 0))];
  };
  const tookCloses = ({ lines }: { lines: readonly QueuedLine[] }): void => {
    for (const call of closesIn({ lines })) {
      closesWritten.add(call);
      const held = waiting.get(call);
      waiting.delete(call);
      if (held !== undefined) {
        // A tool's answer goes through the bound that SAYS what it drops; a step through the one that drops itself.
        const answers = held.filter((queued) => !isStep(queued));
        if (answers.length > 0) {
          hold({ next: [...queue, ...answers] });
        }
        admit({ steps: held.filter(isStep) });
      }
    }
  };

  // The call open now: the one begun, once its open line went in and until its end.
  const liveCall = (): string | undefined => {
    if (!isOpen) {
      return undefined;
    }
    return current;
  };

  // The queue past its bound drops its oldest lines, and says how many — a long outage is never a silent loss. A
  // reconnect step is diagnostics, so the steps go first: one holding a slot never costs a line of a call.
  const hold = ({ next }: { next: readonly QueuedLine[] }): void => {
    const over = next.length - queueMax;
    if (over <= 0) {
      queue = next;
      return;
    }
    const steps = next.filter((queued) => queued.line.kind === "reconnect").slice(0, over);
    const calls = next.filter((queued) => !steps.includes(queued));
    const gone = [...steps, ...calls.slice(0, over - steps.length)];
    queue = next.filter((queued) => !gone.includes(queued));
    lost({ lines: gone });
    onRefused({
      calls: callsOf({ lines: gone }),
      live: liveCall(),
      lines: over,
      turns: turnsOf({ lines: gone }),
      why: `no post was taken while ${String(queueMax)} lines queued; the oldest went`,
    });
  };

  const flush = ({ keepalive }: { keepalive: boolean }): void => {
    if (posting !== undefined && !keepalive) {
      return;
    }
    const batch = nextTranscriptBatch({ maxBytes: TRANSCRIPT_BATCH_BYTES, queued: queue });
    if (batch === undefined) {
      return;
    }
    const taken = queue.slice(0, batch.taken);
    queue = queue.slice(batch.taken);
    // A batch of reconnect steps alone never holds the one slot: a step post that hangs must not keep the owner's next call's
    // lines unsent. Its own stamps order it against the steps beside it.
    const stepsAlone = taken.every((queued) => queued.line.kind === "reconnect");
    const posted = post({ keepalive, wire: batch.wire });
    if (!keepalive && !stepsAlone) {
      posting = taken;
    }
    void (async (): Promise<void> => {
      let answer: TranscriptPostAnswer = { status: 0, why: undefined };
      try {
        answer = await posted;
      } catch {
        // No answer at all: status 0, so the batch goes back to the front below.
      }
      if (keepalive) {
        // The page is going away — but one the browser keeps in its back-forward cache comes back, and its next
        // snapshot retries a batch that got no answer rather than losing the words in it.
        if (answer.status === 200) {
          tookCloses({ lines: taken });
        } else {
          unanswered({ answer, taken });
        }
        return;
      }
      if (stepsAlone) {
        if (answer.status !== 200) {
          unanswered({ answer, taken });
        }
        return;
      }
      posting = undefined;
      if (answer.status === 200) {
        tookCloses({ lines: taken });
        flush({ keepalive: false });
        return;
      }
      unanswered({ answer, taken });
    })();
    // The page going away gets no later post, so it sends every batch it holds now, not only the first;
    // and a batch of steps alone held no slot, so the lines behind it go now too.
    if (keepalive || stepsAlone) {
      flush({ keepalive });
    }
  };

  // A batch the route did not take: back to the front when nothing answered or the route failed, said when refused.
  const unanswered = ({ answer, taken }: { answer: TranscriptPostAnswer; taken: readonly QueuedLine[] }): void => {
    if (answer.status === 0 || answer.status >= 500) {
      hold({ next: [...taken, ...queue] });
      return;
    }
    let why = `the route answered ${String(answer.status)}`;
    if (answer.why !== undefined) {
      why = answer.why;
    }
    lost({ lines: taken });
    onRefused({
      calls: callsOf({ lines: taken }),
      live: liveCall(),
      lines: taken.length,
      turns: turnsOf({ lines: taken }),
      why,
    });
  };

  // Queued without a post, so the end can put its last lines in ONE post — the keepalive one when leaving.
  const enqueue = ({ call, line }: { call: string | undefined; line: CallLine }): boolean => {
    if (call === undefined || call !== current || !isOpen) {
      return false;
    }
    hold({ next: [...queue, { callId: call, line: stamps.begun({ line: stamps.stamped({ line }) }) }] });
    stamps.noteCall({ call });
    return true;
  };

  const record = ({ call, line }: { call: string | undefined; line: CallLine }): boolean => {
    const queued = enqueue({ call, line });
    flush({ keepalive: false });
    return queued;
  };

  return {
    begin: ({ call }) => {
      current = call;
      isOpen = false;
      hearing.beginCall();
      stamps.beginCall();
    },
    end: ({ why, leaving }) => {
      if (!isOpen) {
        if (leaving) {
          flush({ keepalive: true });
        }
        return;
      }
      const partial = hearing.openPartial();
      if (partial !== undefined) {
        enqueue(partial);
        hearing.clearSpeech();
      }
      let closedWhy: string | null = null;
      if (why !== undefined) {
        closedWhy = why;
      }
      enqueue({ call: current, line: { atIso: nowIso(), kind: "closed", why: closedWhy } });
      if (current !== undefined) {
        waiting.set(current, []);
      }
      isOpen = false;
      flush({ keepalive: leaving });
    },
    open: ({ call, line }) => {
      if (call !== current) {
        return;
      }
      isOpen = true;
      record({ call, line });
    },
    heardOver: () => hearing.heardOver(),
    heardStamp: ({ segmentId }) => hearing.heardStamp({ segmentId }),
    reconnect: ({ call, line }) => {
      const held = waiting.get(call);
      if (held !== undefined) {
        held.push({ callId: call, line: stamps.stampedStep({ call, line }) });
        return;
      }
      if (!closesWritten.has(call)) {
        return;
      }
      admit({ steps: [{ callId: call, line: stamps.stampedStep({ call, line }) }] });
      flush({ keepalive: false });
    },
    relayed: () => {
      hearing.relayed();
    },
    record,
    settledTool: ({ call, line }) => {
      if (call === current && isOpen) {
        record({ call, line });
        return;
      }
      // Its call ended while the answer was being delivered: after that call's own close, on that call's own sequence.
      const held = waiting.get(call);
      if (held !== undefined) {
        held.push({ callId: call, line: stamps.stampedStep({ call, line }) });
        return;
      }
      if (closesWritten.has(call)) {
        hold({ next: [...queue, { callId: call, line: stamps.stampedStep({ call, line }) }] });
        flush({ keepalive: false });
        return;
      }
      onRefused({
        calls: [call],
        live: liveCall(),
        lines: 1,
        turns: [],
        why: "the call that asked was not open and no close of it was written, so its tool answer has no file",
      });
    },
    snapshot: () => {
      const partial = hearing.changedPartial();
      if (partial === undefined) {
        flush({ keepalive: false });
        return;
      }
      record(partial);
    },
    speaking: ({ call, speech, open, openBy, context }) => {
      if (call !== current) {
        return;
      }
      const first = hearing.speaking({ call, current, speech, stamp: { context, open, openBy } });
      if (first !== undefined) {
        record(first);
      }
    },
    spoke: ({ call, speech, open, openBy, context }) => {
      record({ call, line: hearing.spoke({ call, current, speech, stamp: { context, open, openBy } }) });
    },
    unwritten: () => {
      if (current === undefined) {
        return false;
      }
      // A reconnect step is diagnostics on a call already closed, never its words, so it holds no rollover.
      const ofCurrent = (queued: QueuedLine): boolean => queued.callId === current && !isStep(queued);
      const inFlight = posting?.some(ofCurrent) === true;
      return hearing.changedFor({ call: current }) || queue.some(ofCurrent) || inFlight;
    },
  };
}
