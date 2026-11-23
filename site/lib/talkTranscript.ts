/**
 * The console voice's call transcript, on its way to disk: what one line says, how the page batches the lines it
 * has queued, and what `/api/talk/transcript` accepts — pure, so every edge is a unit test.
 *
 * A dropped call must not lose the steers the owner gave it, which happened while the transcript lived only in this
 * page. So the page appends every line to `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl` as it lands,
 * through `slopweaver talk transcript`. The verb is the authority on a line's shape (`src/talk/callRecord.ts`, which
 * `site/` cannot import); this restates it so a malformed batch is refused before a spawn, and so the page builds
 * exactly what the verb reads.
 *
 * ## One batch in flight, and one that survives the page going away
 *
 * A spawn costs about 0.8 s (`/usr/bin/time -p slopweaver talk log --limit 1 --json`), so the page never posts per
 * transcript delta: it queues a stretch of speech when the grouper CLOSES it, a snapshot of the still-open one every
 * few seconds, and every tool line, relay, copy-tray offer, plan-thread token usage, the call's open and close, and
 * each step of a reconnect after it dropped — and posts one batch at a time. The last batch, sent as the page hides,
 * rides a `keepalive` request, which the browser caps at 64 KiB, so a batch is cut by bytes as well as by count.
 */

import { OWNER_SPEAKER } from "./chatThread";
import type { CardOpenBy } from "./pageVoice";
import type { CopyOfferWire } from "./runningListCopy";
import type { TokenUsageBreakdown } from "./talkPlanProtocolItems";
import { readsLink } from "./talkTools";

/** A v4 UUID — the call id the page mints and the verb names the file after. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The most lines one batch carries; the verb refuses a batch past it. */
export const TRANSCRIPT_BATCH_MAX = 200;

/** The browser's cap on a `keepalive` body is 64 KiB; a batch stays under it with room for the envelope. */
export const TRANSCRIPT_BATCH_BYTES = 60 * 1024;

/** The largest body the route reads. */
export const TRANSCRIPT_BODY_MAX_BYTES = 64 * 1024;

/** The most characters of one stretch of speech the page sends — the verb's own bound (`CALL_TEXT_CHARS`). */
export const TRANSCRIPT_TEXT_MAX = 16_000;

/** The line kinds the verb appends. */
const LINE_KINDS = new Set([
  "open",
  "segment",
  "tool",
  "relay",
  "wrote",
  "offered",
  "usage",
  "closed",
  "reconnect",
  "card-move",
]);

/**
 * One message the voice offered on a call, whole and byte for byte (`./runningListCopy.ts`). The running list keeps
 * only the newest ten, so without this line an offer that rolled off was gone from the call's own record, which then said only "copy offered". Never cut — the verb refuses one past
 * the list's own bound rather than keep a different message — and at most six bytes a code point on the wire, so the
 * longest one fits a keepalive body alone.
 */
export interface OfferedCallLine {
  readonly kind: "offered";
  readonly atIso: string;
  readonly offer: CopyOfferWire;
}

/**
 * One step of the console re-opening a call that dropped under the owner (`./callReconnect.ts`): an attempt was scheduled
 * after a wait, failed for the exact reason the call's stop was given, or went live as a new call. A reconnect repeats
 * until it succeeds, so no step carries a total. Written onto the DROPPED call, after its `closed` line, so a reconnect
 * that has not come back says why — and a scheduled attempt with nothing after it says the page went away while it
 * waited, or is still waiting for the network.
 */
export type ReconnectEvent =
  | { readonly kind: "scheduled"; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: "failed"; readonly attempt: number; readonly why: string }
  | { readonly kind: "live"; readonly attempt: number; readonly newCallId: string };

/** A reconnect step as a line of the dropped call. */
export interface ReconnectCallLine {
  readonly kind: "reconnect";
  readonly atIso: string;
  readonly event: ReconnectEvent;
}

/**
 * The Queue walk moved from one card to the next (`./cardWalk.ts`): `talk transcript` takes the card the owner left off their
 * Queue, or defers it when they said to come back to it (`src/talk/cardMove.ts`).
 */
export interface CardMoveCallLine {
  readonly kind: "card-move";
  readonly atIso: string;
  readonly disposition: "moved-on" | "come-back";
  readonly fromCardKey: string;
  /** When the card the owner left became the walk's card: their words over it are read from here. */
  readonly fromSinceIso: string;
  /** The `open_card` call's own token, which names the move. */
  readonly requestId: string;
  readonly toCardKey: string;
}

/**
 * A reopened call's opening-window step as a tool line carries it to the call file (`src/talk/callToolLine.ts` reads
 * it): which step, the milliseconds since the window armed on the call's own elapsed clock, the window, and the call
 * it recaps. Never the page's tool `ms`, which is latency.
 */
export interface ReopenReminderMeasurement {
  readonly phase: "armed" | "handed" | "gave-way" | "failed";
  readonly elapsedSinceArmedMs: number;
  readonly windowMs: number;
  readonly previousCallId: string;
}

/** One line of a call, as the page queues it and the verb reads it. */
export type CallLine =
  | CardMoveCallLine
  | {
      readonly kind: "open";
      readonly atIso: string;
      readonly sessionId: string;
      readonly model: string;
      readonly voice: string;
      /** `typed` for the orb messenger's typed box; absent on a voice call, as on every call opened before it existed. */
      readonly surface?: "typed";
    }
  | {
      readonly kind: "segment";
      readonly atIso: string;
      /** When the stretch began, stamped by the sink on every line of it (`./transcriptSink.ts`). */
      readonly beganIso?: string;
      readonly id: string;
      readonly who: "owner" | "voice";
      readonly text: string;
      /** `false` for a snapshot of speech still going on. */
      readonly final: boolean;
      /**
       * The console card the owner had open when this stretch of speech began — its `?open=` key — and absent when
       * none was. What lands the owner's words on that card.
       */
      readonly open?: string;
      /**
       * `voice` when the voice's `open_card` put that card in front of the owner (`./pageVoice.ts` `openByOf`): `talk
       * transcript` lands nothing said over it. Absent when the owner opened it, and on every line written before the
       * field existed.
       */
      readonly openBy?: CardOpenBy;
    }
  | {
      readonly kind: "tool";
      readonly atIso: string;
      readonly name: string;
      readonly detail: string;
      readonly refused: boolean;
      /**
       * The link a read tool opened — what the next call opens again. `null` on a url-taking read whose link this line
       * cannot carry, so no older link passes for it; absent on any other tool.
       */
      readonly opened?: string | null;
      /**
       * Exactly what the model was handed: the text, never cut, inside the page's
       * 24 KiB byte cap — so even escaped to the worst case, one line fits a {@link TRANSCRIPT_BATCH_BYTES} batch
       * alone — or a fixed stand-in for an image. Written after the answer was delivered, never on its path. Absent
       * when no model was handed the output, and on every line written before.
       */
      readonly answer?: string;
      /**
       * The thinking-model turn that called the tool, so `talk fidelity` reads a message against what its
       * own turn read. Absent when no turn called it, and on every line written before.
       */
      readonly turnId?: string;
      /**
       * A reopened call's opening-window step, so its three seconds are read off the file as numbers.
       * Absent on every other tool, and on every line written before.
       */
      readonly reopenReminder?: ReopenReminderMeasurement;
    }
  | {
      readonly kind: "relay";
      readonly atIso: string;
      readonly turnId: string | null;
      readonly outcome: string;
      readonly heard: string;
      readonly say: string;
      readonly about: string;
      readonly detail: string;
      /**
       * `true` when the voice judged the owner's words answer the card `about` names — the one thing that lets `talk
       * transcript` land them on it (`src/talk/cardUtterance.ts`). Absent on every other relay.
       */
      readonly answersCard?: true;
      /**
       * The other Queue cards the voice judged the owner's words answer (`relay_steer`'s `also_answers`), which `talk
       * transcript` then lands nothing on a second way. Absent when none.
       */
      readonly alsoAnswers?: readonly string[];
    }
  | {
      /**
       * One completed message the delegated plan thread wrote, as it handed it to the voice to say, so when the voice
       * says "That covers fourteen cards" the file can say whether the thread wrote it.
       */
      readonly kind: "wrote";
      readonly atIso: string;
      readonly turnId: string;
      readonly itemId: string;
      readonly text: string;
    }
  | {
      /** The delegated plan thread's tokens after one turn: that turn's (`last`) and the thread's so far (`total`). */
      readonly kind: "usage";
      readonly atIso: string;
      readonly turnId: string;
      readonly last: TokenUsageBreakdown;
      readonly total: TokenUsageBreakdown;
      readonly contextWindow: number | null;
    }
  | OfferedCallLine
  | { readonly kind: "closed"; readonly atIso: string; readonly why: string | null }
  | ReconnectCallLine;

/**
 * A line as it is posted: the line and the id the page minted for it when it was queued, kept on every retry so the
 * verb appends it once however often a batch that got no answer goes again (`src/talk/callStore.ts`).
 */
export type PersistedCallLine = CallLine & { readonly writeId: string };

/** A queued line and the call it belongs to. */
export interface QueuedLine {
  readonly callId: string;
  readonly line: PersistedCallLine;
}

/** What the page posts. */
export interface TalkTranscriptWire {
  readonly callId: string;
  readonly lines: readonly PersistedCallLine[];
  /**
   * `e2e` when the desktop TEST instance posts it (`DesktopBridge.instance`): the verb stamps the call as the walk's,
   * never the owner's, lands nothing from it, and the route wakes no chair. Absent from every other page.
   */
  readonly instance?: "e2e";
}

/**
 * A batch as the page posts it: marked on every post, retries included, when the desktop test instance runs the call.
 *
 * @param wire the batch
 * @param instance `e2e` on the test instance, else `undefined`
 * @returns the batch, carrying the marker only when there is one
 */
export function wireForInstance({
  wire,
  instance,
}: {
  wire: TalkTranscriptWire;
  instance: "e2e" | undefined;
}): TalkTranscriptWire {
  if (instance === undefined) {
    return wire;
  }
  return { ...wire, instance };
}

/**
 * Whether a string is a call id the verb will accept.
 *
 * @param callId the candidate
 * @returns whether it is a lowercase v4 UUID
 */
export function isCallId({ callId }: { callId: string }): boolean {
  return UUID_V4.test(callId);
}

/**
 * The next batch to post: the oldest queued lines of ONE call, up to the count and byte bounds. A single line over
 * the byte bound still goes alone — its text is already cut at the verb's bound, so it is never over by much, and
 * holding it would hold every line behind it.
 *
 * @param queued the queue, oldest first
 * @param maxBytes the batch's UTF-8 byte budget
 * @returns the batch and how many queued lines it took, or `undefined` for an empty queue
 */
export function nextTranscriptBatch({
  queued,
  maxBytes,
}: {
  queued: readonly QueuedLine[];
  maxBytes: number;
}): { readonly wire: TalkTranscriptWire; readonly taken: number } | undefined {
  const first = queued.at(0);
  if (first === undefined) {
    return undefined;
  }
  const lines: PersistedCallLine[] = [];
  let bytes = 0;
  for (const entry of queued) {
    if (entry.callId !== first.callId || lines.length === TRANSCRIPT_BATCH_MAX) {
      break;
    }
    const size = new TextEncoder().encode(JSON.stringify(entry.line)).length + 1;
    if (lines.length > 0 && bytes + size > maxBytes) {
      break;
    }
    lines.push(entry.line);
    bytes += size;
  }
  return { taken: lines.length, wire: { callId: first.callId, lines } };
}

/**
 * The control characters JSON writes as a six-byte `\u00XX` escape: every C0 but the five with a two-byte one.
 * With them, and a lone surrogate, stored as U+FFFD, no character of a segment costs more than three bytes on the
 * wire, so the longest one — 16,000 of them, 48,000 bytes — fits a keepalive body whole. Left in, 16,000 of
 * U+0001 made a 96,157-byte body the route refused with a 413, so the line was never written.
 */
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const SIX_BYTE_CONTROL = /[\u0000-\u0007\u000b\u000e-\u001f]/gu;

/**
 * A stretch of speech as a line, its text cut at the verb's bound and every character one that costs at most three
 * bytes on the wire (`SIX_BYTE_CONTROL`).
 *
 * @param id the grouper's segment id
 * @param who whose speech
 * @param text the whole text so far
 * @param final whether the grouper closed it
 * @param atIso when it was taken
 * @param open the card open when the speech began, or `undefined` for none — the line then carries no `open`
 * @param openBy `voice` when the voice's `open_card` put that card there — carried only beside an `open`
 * @returns the line
 */
export function segmentLine({
  id,
  who,
  text,
  final,
  atIso,
  open,
  openBy,
}: {
  id: string;
  who: "owner" | "voice";
  text: string;
  final: boolean;
  atIso: string;
  open: string | undefined;
  openBy: CardOpenBy | undefined;
}): CallLine {
  const line = {
    atIso,
    final,
    id,
    kind: "segment",
    text: text.slice(0, TRANSCRIPT_TEXT_MAX).toWellFormed().replace(SIX_BYTE_CONTROL, "\uFFFD"),
    who,
  } as const;
  if (open === undefined) {
    return line;
  }
  if (openBy === undefined) {
    return { ...line, open };
  }
  return { ...line, open, openBy };
}

/** What the route does with a body. */
export type ParsedTalkTranscript =
  | {
      readonly kind: "ok";
      readonly callId: string;
      readonly jsonl: string;
      readonly count: number;
      /** Whether a line finishes a stretch of the owner's — what wakes the chair once the batch is on disk. */
      readonly finishesOwnerStretch: boolean;
      /** `e2e` when the desktop test instance posted it: the verb is told, and nothing wakes the chair. */
      readonly instance: "e2e" | undefined;
    }
  | { readonly kind: "refused"; readonly status: number; readonly why: string };

/**
 * Parse one `/api/talk/transcript` body into the JSONL the verb appends. Only the envelope is checked here — the
 * call id, the count, that each line is an object of a known kind, and that a `writeId` it carries is a v4 UUID; the
 * verb validates every field. A line with no `writeId` is still taken: a page loaded before the ids were minted may
 * still be posting when the console is rebuilt under it, and refusing it would drop the owner's words.
 *
 * @param raw the request body
 * @returns the batch as JSONL, or why it is refused
 */
export function parseTalkTranscriptRequest({ raw }: { raw: string }): ParsedTalkTranscript {
  if (new TextEncoder().encode(raw).length > TRANSCRIPT_BODY_MAX_BYTES) {
    return { kind: "refused", status: 413, why: `the body is over ${String(TRANSCRIPT_BODY_MAX_BYTES)} bytes` };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { kind: "refused", status: 400, why: "the body is not JSON" };
  }
  if (typeof body !== "object" || body === null || !("callId" in body) || !("lines" in body)) {
    return { kind: "refused", status: 400, why: "the body carries no callId and lines" };
  }
  const { callId, lines } = body;
  if (typeof callId !== "string" || !isCallId({ callId })) {
    return { kind: "refused", status: 400, why: "callId is not a v4 UUID" };
  }
  // The test instance's marker is exactly `e2e` or absent: anything else is refused rather than read as the owner's.
  const instance = "instance" in body ? body.instance : undefined;
  if (instance !== undefined && instance !== "e2e") {
    return { kind: "refused", status: 400, why: "instance is not e2e" };
  }
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > TRANSCRIPT_BATCH_MAX) {
    return { kind: "refused", status: 400, why: `lines is not a list of 1 to ${String(TRANSCRIPT_BATCH_MAX)}` };
  }
  const known = lines.every(
    (line: unknown) =>
      typeof line === "object" &&
      line !== null &&
      "kind" in line &&
      typeof line.kind === "string" &&
      LINE_KINDS.has(line.kind) &&
      (!("writeId" in line) || (typeof line.writeId === "string" && UUID_V4.test(line.writeId))),
  );
  if (!known) {
    return {
      kind: "refused",
      status: 400,
      why: "a line is not an object of a known kind, or its writeId is not a v4 UUID",
    };
  }
  const ids = lines.flatMap((line: { writeId?: unknown }) => (typeof line.writeId === "string" ? [line.writeId] : []));
  if (new Set(ids).size !== ids.length) {
    return { kind: "refused", status: 400, why: "two lines carry the same writeId" };
  }
  const jsonl = lines.map((line: object) => `${JSON.stringify(withoutStrayLink({ line }))}\n`).join("");
  return {
    callId,
    count: lines.length,
    finishesOwnerStretch: lines.some((line: unknown) => isOwnerFinal({ line })),
    instance,
    jsonl,
    kind: "ok",
  };
}

/**
 * Whether a line is a finished stretch of the owner's — spoken or typed in the console's box.
 *
 * @param line one line of the batch
 * @returns whether it is
 */
function isOwnerFinal({ line }: { line: unknown }): boolean {
  return (
    typeof line === "object" &&
    line !== null &&
    "kind" in line &&
    line.kind === "segment" &&
    "who" in line &&
    line.who === OWNER_SPEAKER &&
    "final" in line &&
    line.final === true
  );
}

/**
 * A line as the file keeps it: a tool line naming a link its tool cannot have opened — no url-taking read — loses
 * that link and keeps the rest, because the next call is told to open whatever link the file names. A
 * url-taking read naming none writes `null`, so a writer that left the field off cannot let an older link pass for it.
 *
 * @returns the line, with `opened` only where its tool reads a link
 */
function withoutStrayLink({ line }: { line: object }): object {
  if (!("kind" in line) || line.kind !== "tool") {
    return line;
  }
  if ("name" in line && typeof line.name === "string" && readsLink({ name: line.name })) {
    return "opened" in line ? line : { ...line, opened: null };
  }
  if (!("opened" in line)) {
    return line;
  }
  const { opened: _stray, ...rest } = line;
  return rest;
}

/** `talk transcript`'s exit when it refused the batch itself — `EXIT_USAGE` in `src/cli/exitCodes.ts`. */
const VERB_USAGE_EXIT = 2;

/**
 * What the route answers a batch the verb did not append. Only a batch the verb refused as malformed is a 422, which
 * posting again cannot fix; anything else — no answer, a call file whose lock a wedged writer held past its wait, a
 * failed write — may have left the owner's words off the disk, and a 503 keeps them on the page to post again.
 * A batch posted again after the verb DID append it — killed on its bound past the write — carries the same
 * `writeId`s, so the verb appends none of it twice.
 *
 * @param exitCode the verb's exit, `undefined` when it was killed on the timeout or never launched
 * @returns the HTTP status
 */
export function unappendedStatus({ exitCode }: { exitCode: number | undefined }): 422 | 503 {
  if (exitCode === VERB_USAGE_EXIT) {
    return 422;
  }
  return 503;
}
