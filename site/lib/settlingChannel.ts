/*
 * What one document tells another about the rows a press hid. The settling store (`components/console/settling.tsx`)
 * is module-scoped, so a press in the console window hid its row only there: the desktop voice overlay, a separate
 * document, still drew the act until the registers re-read, and could open an act the owner had just settled while its
 * pull-request lookup was pending. Same-origin documents share a `BroadcastChannel`; this file is
 * the message shape and the one rule every document applies to it.
 *
 * Each document posts its WHOLE hidden list on every change, under its own writer name and a sequence number it
 * raises on every post, and each reader keeps the highest-numbered list per writer ({@link acceptsHidden}), so a press
 * put back after a refusal is put back everywhere too. A document that opens late asks, every open one answers with
 * its own list AND relays every list it holds, each under its writer's name and number, and the asker trusts its list
 * only once the answers have had time to arrive ({@link settlingHeard}). So a document that closes leaves its last
 * list behind in every document that heard it, and a document opened after it closed still learns it from them; a press that answered done stays hidden for the life of every document that knows of it.
 *
 * **One residual, stated**: a settle reaches another document only once its message is DELIVERED,
 * and nothing shared between documents makes that synchronous. An open document answers within its next task, so the
 * gap is milliseconds; a document whose main thread is blocked past {@link SETTLING_HANDSHAKE_MS} answers late, and a
 * check in that gap can still read an act the owner settled there: the voice reads a card they have already answered, until the
 * registers re-read. That re-read after the press is the authority; this channel only shortens the time the act is
 * still drawn elsewhere.
 *
 * **What the channel spans**: documents open AT ONCE, or in an overlapping chain. A document opened
 * after every document that settled has closed hears nothing, and needs nothing: its registers are read fresh from the
 * server (`app/api/live/[verb]/route.ts`, `no-store`, and no read rides a flight that left before an act wrote:
 * `./liveFlights.ts` `forgetFlights`), and a press answers done only once its verb has written
 * (`app/api/act/[verb]/route.ts`), so that read already leaves the act out. A press still in flight when its document closed
 * has not settled anything yet: a read before its write lands shows the act as it still is. The channel covers only
 * the gap a press leaves in a document whose readings were drawn BEFORE the write.
 *
 * The channel defends against ordinary delivery, not a hostile poster: only a document of this origin can post on it,
 * and a malformed or oversized message is dropped so a stray one cannot break a reader.
 */

/** The channel's name, one per origin. */
export const SETTLING_CHANNEL = "sw-settling";

/** The most keys one message may carry; a press hides one row, so this only stops a runaway list. */
const MAX_KEYS = 512;

/** The longest key one message may carry, past any `<kind>:<id>` a register writes. */
const MAX_KEY = 256;

/** One document's hidden rows as last heard: whether the list is whole, and its writer's number for it. */
export interface HeldHidden {
  readonly keys: readonly string[];
  readonly complete: boolean;
  readonly seq: number;
}

/** One message on the channel: `ask` from a document that has just opened it, or one document's hidden rows. */
export type SettlingMessage =
  { readonly kind: "ask" } | ({ readonly kind: "hidden"; readonly writer: string } & HeldHidden);

/**
 * Whether a writer's list replaces the one held for it: only a higher number does, so a relayed copy that arrives
 * after the writer's own newer post never rolls it back.
 *
 * @param held the number of the list held for this writer, `undefined` when none is
 * @param seq the arriving list's number
 * @returns whether to keep the arriving list
 */
export function acceptsHidden({ held, seq }: { held: number | undefined; seq: number }): boolean {
  return held === undefined || seq > held;
}

/**
 * The hidden rows one document posts: its newest {@link MAX_KEYS}, so a list a reader would drop whole is never sent,
 * and whether that is all of them. A list cut short says so, and a reader holding one resolves no
 * act ({@link settlingHeard}): the row it dropped may be one the owner settled while the registers still project it.
 *
 * @param hidden this document's hidden rows, oldest first
 * @returns the rows to post, at most {@link MAX_KEYS}, newest kept, and whether none was left out
 */
export function postedHidden({ hidden }: { hidden: readonly string[] }): {
  readonly keys: readonly string[];
  readonly complete: boolean;
} {
  return { complete: hidden.length <= MAX_KEYS, keys: hidden.slice(-MAX_KEYS) };
}

/**
 * The keys one press hides: the row's own, and every earlier act folded under it, since settling the newest act of a
 * pattern settles each earlier one too (`./actGroups.ts`). A document still drawing an older snapshot draws one of
 * those earlier acts as a row of its own, under its own key, and must hide it as well.
 *
 * @param key the pressed row's key
 * @param aliases the keys of the acts folded under it, `undefined` for a row that folds none
 * @returns every key the press hides, the row's own first, once each
 */
export function pressedKeys({
  key,
  aliases,
}: {
  key: string;
  aliases: readonly string[] | undefined;
}): readonly string[] {
  if (aliases === undefined) {
    return [key];
  }
  return [...new Set([key, ...aliases])];
}

/**
 * A document's hidden rows once a press that did not answer done is taken back: ONE occurrence of each key that press
 * added, the latest, never every occurrence. The list holds a key once per press that hid it, so a refused press whose
 * row folds an act an earlier press already settled leaves that earlier settle hidden.
 *
 * @param hidden the document's hidden rows, the refused press's keys among them
 * @param pressed the keys that press added ({@link pressedKeys})
 * @returns the rows with that press's own occurrences removed
 */
export function withoutPress({
  hidden,
  pressed,
}: {
  hidden: readonly string[];
  pressed: readonly string[];
}): readonly string[] {
  const kept = [...hidden];
  for (const key of pressed) {
    const at = kept.lastIndexOf(key);
    if (at !== -1) {
      kept.splice(at, 1);
    }
  }
  return kept;
}

/**
 * A document's hidden rows once a press answers: kept as they are on done, and on an UNKNOWN outcome too, since that
 * press may have landed and putting its row back would let a document whose registers predate the write open an act the owner
 * settled; only a refusal, which wrote nothing, takes the press's own occurrences back
 * ({@link withoutPress}).
 *
 * @param hidden the document's hidden rows, the press's keys among them
 * @param phase how the press answered
 * @param pressed the keys that press added ({@link pressedKeys})
 * @returns the rows to post
 */
export function hiddenAfterPress({
  hidden,
  phase,
  pressed,
}: {
  hidden: readonly string[];
  phase: "done" | "refused" | "unknown";
  pressed: readonly string[];
}): readonly string[] {
  if (phase === "refused") {
    return withoutPress({ hidden, pressed });
  }
  return hidden;
}

/**
 * A channel message read as a `SettlingMessage`, or nothing when it is not one — any document of the origin can post
 * on the channel, so its data is never trusted to have this shape.
 *
 * @param data the message event's data, as posted
 * @returns the message, or undefined when `data` is not one
 */
export function parseSettlingMessage({ data }: { data: unknown }): SettlingMessage | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const { kind, writer, keys, complete, seq } = data as {
    kind?: unknown;
    writer?: unknown;
    keys?: unknown;
    complete?: unknown;
    seq?: unknown;
  };
  if (kind === "ask") {
    return { kind };
  }
  if (kind !== "hidden" || typeof writer !== "string" || writer === "" || !Array.isArray(keys)) {
    return undefined;
  }
  if (typeof complete !== "boolean" || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
    return undefined;
  }
  if (keys.length > MAX_KEYS) {
    return undefined;
  }
  const valid = keys.every((key: unknown) => typeof key === "string" && key !== "" && key.length <= MAX_KEY);
  if (!valid) {
    return undefined;
  }
  return { complete, keys: keys as readonly string[], kind, seq, writer };
}

/**
 * How long a document that has just opened the channel waits for every other document's answer to its `ask` before it
 * trusts its hidden list. A channel message is delivered as a task, so the answers arrive after the opening call
 * returns, and a check in between would see none of them. An open document answers within its next
 * task; a second covers one whose main thread is busy, and the overlay mounts long before a call can ask for a card.
 */
export const SETTLING_HANDSHAKE_MS = 1000;

/**
 * Whether the other documents' answers to this one's opening `ask` can be trusted to have arrived, whole: the
 * handshake window has passed since the channel opened, and no document's latest list was cut short
 * ({@link postedHidden}). A document with no channel has nothing to hear, so it has heard.
 *
 * @param openedAtMs when this document opened the channel on the monotonic clock (`performance.now()`), so a
 * wall-clock step cannot end the window early; `undefined` where the platform has none
 * @param nowMs the instant of the check, on that same monotonic clock
 * @param partial whether any other document's latest list left rows out
 * @returns whether the hidden list reads every other document's too
 */
export function settlingHeard({
  openedAtMs,
  nowMs,
  partial,
}: {
  openedAtMs: number | undefined;
  nowMs: number;
  partial: boolean;
}): boolean {
  if (openedAtMs === undefined) {
    return true;
  }
  if (partial) {
    return false;
  }
  return nowMs - openedAtMs >= SETTLING_HANDSHAKE_MS;
}

/**
 * The acts a card check may resolve, and what it names unread: none inside the handshake window, when another
 * document's settle may not have arrived yet, so an act the owner just settled elsewhere is answered as unread rather than
 * read or opened again. A Queue card is never held back: no press on it rides this channel.
 *
 * @param acts the Alignment acts the registers project
 * @param heard whether the handshake window has passed ({@link settlingHeard})
 * @returns the acts to resolve among, and the unread source naming why there are none
 */
export function actsOnceHeard<T>({ acts, heard }: { acts: readonly T[]; heard: boolean }): {
  readonly acts: readonly T[];
  readonly unread: readonly { readonly source: string; readonly why: string }[];
} {
  if (heard) {
    return { acts, unread: [] };
  }
  return {
    acts: [],
    unread: [{ source: "settled acts", why: "not yet heard in full from the owner's other console windows" }],
  };
}

/**
 * The rows hidden in any document: this one's first, in its own order, then each other document's not already named.
 *
 * @param local the rows this document's own presses hid
 * @param remote each other document's latest hidden list, by writer
 * @returns every hidden row, once each
 */
export function hiddenAcross({
  local,
  remote,
}: {
  local: readonly string[];
  remote: ReadonlyMap<string, Pick<HeldHidden, "keys">>;
}): readonly string[] {
  const seen = new Set(local);
  const across = [...local];
  for (const { keys } of remote.values()) {
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        across.push(key);
      }
    }
  }
  return across;
}
