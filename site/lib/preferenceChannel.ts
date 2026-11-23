/*
 * What one document tells another about a preference storage refused to keep. A refused write fires no `storage`
 * event, so without this the desktop voice overlay never heard about a theme, mode or orb presence the console window
 * chose while its storage was read-only or full. Same-origin documents share a `BroadcastChannel`; this file is
 * the message shape and the one rule every document applies to it, read by `components/console/preference.ts`.
 *
 * Every write carries a stamp — when, then which document — and every document keeps, per key, only what the
 * newest stamp it has seen says. Two windows choosing at once therefore settle on the same choice, whichever order
 * the channel delivers the two in, and a late `stored` never clears a newer refused choice.
 *
 * What the channel defends against is ordinary delivery — writes racing, arriving late, out of order, or from a
 * document opened after them — not a hostile poster. Only a document of this origin can post on it, and any script
 * of this origin can already write a preference straight into storage, so the channel adds no trust boundary. A
 * malformed message is dropped so a stray one cannot break a reader, and a stamp past `STAMP_AT_MAX` is refused so
 * a writer's own `at + 1` always advances. A writer holds its clock to `STAMP_CLOCK_MAX`, so no stamp it makes
 * reaches that cap and is refused.
 */

/** The channel's name, one per origin. */
export const PREFERENCE_CHANNEL = "sw-preference";

/** When a write was made, and by which document: the later `at` wins, and `writer` breaks a tie. */
export interface PreferenceStamp {
  readonly at: number;
  readonly writer: string;
}

/**
 * What one document knows of one key: the newest write's stamp and value, and whether storage refused it. The value
 * is what the key reads as in that document, held or stored, ahead of storage — two stored writes can commit to
 * storage in the opposite order to their stamps.
 */
export interface PreferenceEntry {
  readonly held: boolean;
  readonly stamp: PreferenceStamp;
  readonly value: string;
}

/** A write another document announces: `held` for one storage refused, `stored` for one storage kept. */
export interface PreferenceWrite {
  readonly key: string;
  readonly kind: "held" | "stored";
  readonly stamp: PreferenceStamp;
  readonly value: string;
}

/** One message on the channel: a write, or `ask` from a document that has just opened it. */
export type PreferenceMessage = { readonly kind: "ask" } | PreferenceWrite;

/**
 * Whether `incoming` is a later write than `current`: by time, then by writer, so every document orders the same
 * two writes the same way.
 *
 * @param current the newest stamp this document holds for the key, absent when it holds none
 * @returns true when `incoming` should replace `current`
 */
export function isLaterWrite({
  current,
  incoming,
}: {
  current: PreferenceStamp | undefined;
  incoming: PreferenceStamp;
}): boolean {
  if (current === undefined) {
    return true;
  }
  if (incoming.at !== current.at) {
    return incoming.at > current.at;
  }
  return incoming.writer > current.writer;
}

/**
 * What a document should hold for a key after another document's write arrives.
 *
 * @param entry what it holds now, absent when it holds nothing for the key
 * @param write the write that arrived
 * @returns the entry to hold, or undefined when the write is older and changes nothing
 */
export function receivePreference({
  entry,
  write,
}: {
  entry: PreferenceEntry | undefined;
  write: PreferenceWrite;
}): PreferenceEntry | undefined {
  if (!isLaterWrite({ current: entry?.stamp, incoming: write.stamp })) {
    return undefined;
  }
  return { held: write.kind === "held", stamp: write.stamp, value: write.value };
}

/**
 * The message announcing an entry — what a document posts on a write and answers an `ask` with.
 *
 * @param key the preference's storage key
 * @returns the write to post
 */
export function announcedWrite({ entry, key }: { entry: PreferenceEntry; key: string }): PreferenceWrite {
  if (entry.held) {
    return { key, kind: "held", stamp: entry.stamp, value: entry.value };
  }
  return { key, kind: "stored", stamp: entry.stamp, value: entry.value };
}

/**
 * The latest `at` a stamp may carry: 2^52, so a write stamped one millisecond later (`at + 1`) is still a distinct
 * number, below 2^53 where adding one stops changing a float. A stamp past it would let a writer's next two writes
 * share one stamp and the second be refused as not later. Clock milliseconds sit near 2^40.
 */
export const STAMP_AT_MAX = 2 ** 52;

/**
 * The latest clock reading a write takes as its `at`: half of `STAMP_AT_MAX`. A write's `at` is the clock or one past
 * the newest stamp held, so every stamp any document makes is at most this plus the number of writes ever made —
 * short of the cap the readers enforce by 2^51 writes, however far a broken clock runs ahead.
 */
export const STAMP_CLOCK_MAX = STAMP_AT_MAX / 2;

/**
 * The `at` for a write made now: the clock, held to `STAMP_CLOCK_MAX`, or one past the newest stamp held for the key
 * when the clock has not passed it, so a choice made here always replaces the one it was made over.
 *
 * @param heldAt the `at` of the newest stamp held for the key, absent when none is held
 * @param now the clock, in milliseconds
 * @returns the `at` to stamp the write with
 */
export function nextStampAt({ heldAt, now }: { heldAt: number | undefined; now: number }): number {
  const clock = Math.min(now, STAMP_CLOCK_MAX);
  if (heldAt !== undefined && clock <= heldAt) {
    return heldAt + 1;
  }
  return clock;
}

/**
 * A stamp read from untrusted data, or nothing when it is not one: `at` a whole number from 0 to `STAMP_AT_MAX`.
 *
 * @returns the stamp, or undefined
 */
function parseStamp({ data }: { data: unknown }): PreferenceStamp | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const { at, writer } = data as { at?: unknown; writer?: unknown };
  if (typeof at !== "number" || !Number.isInteger(at) || at < 0 || at > STAMP_AT_MAX || typeof writer !== "string") {
    return undefined;
  }
  return { at, writer };
}

/**
 * A channel message read as a `PreferenceMessage`, or nothing when it is not one — any document of the origin can
 * post on the channel, so its data is never trusted to have this shape.
 *
 * @param data the message event's data, as posted
 * @returns the message, or undefined when `data` is not one
 */
export function parsePreferenceMessage({ data }: { data: unknown }): PreferenceMessage | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const { key, kind, stamp, value } = data as { key?: unknown; kind?: unknown; stamp?: unknown; value?: unknown };
  if (kind === "ask") {
    return { kind };
  }
  const parsedStamp = parseStamp({ data: stamp });
  if (typeof key !== "string" || parsedStamp === undefined || typeof value !== "string") {
    return undefined;
  }
  if (kind === "held" || kind === "stored") {
    return { key, kind, stamp: parsedStamp, value };
  }
  return undefined;
}
