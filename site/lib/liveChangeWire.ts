/**
 * What the change stream (`app/api/live-changes`) sends the page, and the strict reader the page decodes each message
 * with. Pure; it imports only the register list, which itself imports nothing.
 *
 * The page acts on what it reads: a register named here is re-read, and a signal reported down puts every register
 * it feeds back on its old poll. So a message the reader cannot vouch for is dropped whole, never half-read — a
 * `changed` naming one unknown register would otherwise re-read the known ones and silently skip a typo.
 */
import { isQueueLiveSlug, QUEUE_LIVE_SLUGS, type QueueLiveSlug } from "./queueLiveChanges";

/** One message on the change stream. */
export type LiveChangeEvent =
  /** Sent first on every connection, and again whenever a signal goes up or down: which signals are up now. */
  | { readonly kind: "ready"; readonly files: boolean; readonly store: boolean }
  /** These registers changed: re-read them. */
  | { readonly kind: "changed"; readonly slugs: readonly QueueLiveSlug[] }
  /** Nothing changed, and the stream is alive. */
  | { readonly kind: "heartbeat"; readonly atIso: string };

/** The event names the stream uses, one per kind, so a page listens for exactly these. */
export const LIVE_CHANGE_EVENT_KINDS = ["ready", "changed", "heartbeat"] as const;

/**
 * Whether a value is a plain object, so its fields can be read by name.
 *
 * @param value anything parsed off the wire
 * @returns true for a non-null, non-array object
 */
function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The registers a `changed` message names, in declared order, once each, or `undefined` when any entry is not one.
 *
 * @param value the message's `slugs` field
 * @returns the registers, or `undefined` for a list the reader cannot vouch for
 */
function changedSlugsOf({ value }: { value: unknown }): readonly QueueLiveSlug[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const named = new Set<QueueLiveSlug>();
  for (const entry of value) {
    if (typeof entry !== "string" || !isQueueLiveSlug(entry)) {
      return undefined;
    }
    named.add(entry);
  }
  return QUEUE_LIVE_SLUGS.filter((slug) => named.has(slug));
}

/**
 * Read one message off the stream.
 *
 * @param value the message's parsed JSON
 * @returns the message, or `undefined` when it is not exactly one of the three shapes
 */
export function liveChangeEventOf({ value }: { value: unknown }): LiveChangeEvent | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  if (value["kind"] === "ready") {
    const { files, store } = value;
    if (typeof files !== "boolean" || typeof store !== "boolean") {
      return undefined;
    }
    return { files, kind: "ready", store };
  }
  if (value["kind"] === "changed") {
    const slugs = changedSlugsOf({ value: value["slugs"] });
    return slugs === undefined ? undefined : { kind: "changed", slugs };
  }
  if (value["kind"] === "heartbeat") {
    const atIso = value["atIso"];
    if (typeof atIso !== "string" || Number.isNaN(Date.parse(atIso))) {
      return undefined;
    }
    return { atIso, kind: "heartbeat" };
  }
  return undefined;
}

/**
 * One message as server-sent-event text: its kind as the event name, its JSON as the data.
 *
 * @param event the message
 * @returns the frame, ending in the blank line that closes it
 */
export function liveChangeFrame({ event }: { event: LiveChangeEvent }): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}
