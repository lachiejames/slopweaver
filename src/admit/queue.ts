/**
 * The QUEUE a withheld draft lands in — pure: the event shapes, their JSONL encoding, and the fold that turns
 * a log into the current state of each held reply. `queueStore.ts` is the effectful edge over it.
 *
 * ## It is the product, not a log
 *
 * "Queued for review" is a promise to the person who asked, so the entry has to hold enough to ACT on later
 * without going back to a transcript: the draft itself, where it was going, who asked, why it was held and
 * when. A record that only says "something was withheld" would make the queue impossible to drain, and a
 * queue nobody can drain is worse than no queue — it converts a visible silence into an invisible one.
 *
 * ## Append-only, folded on read
 *
 * One `held` event per withheld draft, then at most one `released`/`dropped` resolving it. Rewriting an
 * entry in place would mean a crash mid-write could lose a draft that has already been promised to somebody;
 * appending cannot. It is also the same shape as the run journal and the door ledger, so there is one way to
 * read persisted state in this repo rather than three.
 *
 * The draft is stored as OPAQUE JSON. The queue is a mechanism and knows nothing about Slack forms — the
 * release path validates it, trying the answer-form schema first (the primary contract; its images ride
 * along as base64 bytes locked at hold time, under a reserved key the queue never inspects) and falling
 * back to the `UpdateArtifact` card schema for a draft filed as a card. Either way validation is
 * where that knowledge belongs, and where a refusal can name the field.
 */

import { isRecord } from "../lib/parsers.js";
import type { AskIdentity, RecordedAskIdentity } from "../live/ask/identity.js";
import { parseSchemaOneAskRow, type SchemaOneHeldReply, threadOnlyRecordedAskIdentity } from "./schemaOneAskRow.js";
import type { ReplySurface } from "./withhold.js";

/** What was withheld, and everything needed to act on it later — exact ask identity, schema 2. */
export interface HeldReply extends AskIdentity {
  /** Which surface addressed the bot. */
  readonly surface: ReplySurface;
  /** The Slack user id that asked. */
  readonly askedBy: string;
  /** The question as asked. */
  readonly question: string;
  /** The finding code that held it. */
  readonly code: string;
  /** Why it was held, in the judgement's own words. */
  readonly reason: string;
  /** The composed draft, opaque to the queue — the release path validates it against the renderer's schema. */
  readonly draft: Readonly<Record<string, unknown>>;
}

/** One appended event. A `held` opens an entry; a `released` or `dropped` resolves it. NEW WRITES ONLY. */
export type QueueEvent =
  | { readonly kind: "held"; readonly id: string; readonly tsIso: string; readonly held: HeldReply }
  | { readonly kind: "released"; readonly id: string; readonly tsIso: string; readonly note: string }
  | { readonly kind: "dropped"; readonly id: string; readonly tsIso: string; readonly note: string };

/** A held reply as READ back — a new exact row, or an old row kept readable through its own schema-1 shape. */
export type ReadableHeldReply = HeldReply | SchemaOneHeldReply;

/** A `held` event as it can be READ — schema 1 (thread-only) or schema 2 (exact), never conflated. */
export type ReadableQueueEvent =
  | { readonly kind: "held"; readonly id: string; readonly tsIso: string; readonly held: ReadableHeldReply }
  | { readonly kind: "released"; readonly id: string; readonly tsIso: string; readonly note: string }
  | { readonly kind: "dropped"; readonly id: string; readonly tsIso: string; readonly note: string };

/** Where a held draft has got to. */
type QueueState = "held" | "released" | "dropped";

/** One entry, folded to its current state. */
export interface QueueItem {
  readonly id: string;
  /** When it was held. */
  readonly tsIso: string;
  readonly state: QueueState;
  readonly held: ReadableHeldReply;
  /** When it was released or dropped. Absent while it is still held. */
  readonly resolvedIso?: string | undefined;
  /** What the release or drop recorded. Absent while it is still held. */
  readonly note?: string | undefined;
}

/** The current queue schema version — bumped from 1 to 2 for exact ask identity on `held` rows. */
export const QUEUE_SCHEMA_VERSION = 2;

/**
 * Encode one event as a JSONL line. Always schema 2 — new writes carry exact identity.
 *
 * @param event the event to encode
 * @returns the JSON line (no trailing newline)
 */
export function queueEventLine({ event }: { event: QueueEvent }): string {
  return JSON.stringify({ schemaVersion: QUEUE_SCHEMA_VERSION, ...event });
}

/** Whether a parsed value carries every field an exact schema-2 {@link HeldReply} declares. */
function isExactHeldReply(value: unknown): value is HeldReply {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["channel"] === "string" &&
    typeof value["messageTs"] === "string" &&
    typeof value["threadTs"] === "string" &&
    (value["surface"] === "channel" || value["surface"] === "dm") &&
    typeof value["askedBy"] === "string" &&
    typeof value["question"] === "string" &&
    typeof value["code"] === "string" &&
    typeof value["reason"] === "string" &&
    isRecord(value["draft"])
  );
}

/** One parsed `held` line as a readable event, by whichever schema it names — or `undefined` for neither. */
function readableHeldEventOf({
  parsed,
  id,
  tsIso,
}: {
  parsed: Record<string, unknown>;
  id: string;
  tsIso: string;
}): ReadableQueueEvent | undefined {
  if (parsed["schemaVersion"] === 1) {
    const schemaOne = parseSchemaOneAskRow({ value: parsed });
    return schemaOne === undefined ? undefined : { held: schemaOne.held, id, kind: "held", tsIso };
  }
  if (parsed["schemaVersion"] === QUEUE_SCHEMA_VERSION) {
    const held = parsed["held"];
    return isExactHeldReply(held) ? { held, id, kind: "held", tsIso } : undefined;
  }
  return undefined;
}

/** One parsed line as a readable event, or `undefined` when the line is unreadable by either schema. */
function readableEventOf({ parsed }: { parsed: unknown }): ReadableQueueEvent | undefined {
  if (!isRecord(parsed) || typeof parsed["id"] !== "string" || typeof parsed["tsIso"] !== "string") {
    return undefined;
  }
  const { id, tsIso } = parsed;
  const kind = parsed["kind"];
  if (kind === "held") {
    return readableHeldEventOf({ id, parsed, tsIso });
  }
  if (kind === "released" || kind === "dropped") {
    // Both schema versions share the same resolution shape — no version branch needed here.
    const note = parsed["note"];
    return { id, kind, note: typeof note === "string" ? note : "", tsIso };
  }
  return undefined;
}

/**
 * Parse the queue log's text into events, in file order.
 *
 * Tolerant of a blank or malformed line for the same reason the door ledger is: a corrupt line must not make
 * the whole queue unreadable. It is NOT tolerant in the same direction, though — a skipped `held` line loses
 * a draft somebody was told was queued, so {@link parseQueueLog} reports what it could not read rather than
 * discarding it silently.
 *
 * @param text the raw log contents
 * @returns the parsed events and the 1-indexed line numbers that could not be read
 */
export function parseQueueLog({ text }: { text: string }): {
  readonly events: readonly ReadableQueueEvent[];
  readonly unreadable: readonly number[];
} {
  const events: ReadableQueueEvent[] = [];
  const unreadable: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable.push(index + 1);
      return;
    }
    const event = readableEventOf({ parsed });
    if (event === undefined) {
      unreadable.push(index + 1);
      return;
    }
    events.push(event);
  });
  return { events, unreadable };
}

/**
 * Whether a readable held reply owns its own `messageTs` — `Object.hasOwn`, never the `in` operator. `in`
 * also matches the prototype chain, so a polluted `Object.prototype.messageTs` would make `in` report a
 * schema-1 row (which never earned one) as carrying its own, upgrading it to `quality: "exact"` and stamping
 * an invented timestamp — exactly the reconstruction this contract exists to forbid.
 */
function hasOwnMessageTs(held: ReadableHeldReply): held is HeldReply {
  return Object.hasOwn(held, "messageTs");
}

/**
 * The recorded ask identity a held reply's current form carries — exact for a schema-2 row, thread-only for
 * a schema-1 row that never earned a `messageTs`.
 *
 * @param held the held reply, in either readable form
 * @returns the recorded identity, quality named honestly
 */
export function recordedAskIdentityForHeld({ held }: { held: ReadableHeldReply }): RecordedAskIdentity {
  return hasOwnMessageTs(held)
    ? { channel: held.channel, messageTs: held.messageTs, quality: "exact", threadTs: held.threadTs }
    : threadOnlyRecordedAskIdentity({ held });
}

/**
 * Fold events into one entry per held draft, newest first.
 *
 * A resolution for an id that was never held is IGNORED rather than inventing an entry with no draft in it:
 * the queue's whole value is that an entry can be acted on, and a resolution alone carries nothing to act on.
 *
 * @param events the parsed events, in file order
 * @returns one item per `held` event, most recently held first
 */
export function foldQueue({ events }: { events: readonly ReadableQueueEvent[] }): readonly QueueItem[] {
  const items = new Map<string, QueueItem>();
  for (const event of events) {
    if (event.kind === "held") {
      items.set(event.id, { held: event.held, id: event.id, state: "held", tsIso: event.tsIso });
      continue;
    }
    const existing = items.get(event.id);
    if (existing !== undefined) {
      items.set(event.id, { ...existing, note: event.note, resolvedIso: event.tsIso, state: event.kind });
    }
  }
  return [...items.values()].toReversed();
}
