/**
 * Address dedupe — the state that makes "one tag, one turn" true. PURE and immutable: a state value in,
 * a verdict plus the next state out, so the whole rule is unit-testable without a socket.
 *
 * ## Why this exists at all
 *
 * One addressed Slack MESSAGE can reach this listener more than once, in two different ways:
 *
 *  - **A redelivery.** Slack re-sends an event whose envelope it did not see acknowledged in time, up to three
 *    times, with the SAME `payload.event_id` and a fresh `envelope_id`. The acknowledgement is sent before any
 *    work starts (see `./socket.ts`), but a slow ack behind a busy event loop, a process killed mid-turn or a
 *    second listener started by accident still produce one.
 *  - **A second EVENT for the same message.** Slack can describe one message with two distinct event ids: a
 *    tagged reply in a `--thread-replies` conversation arrives as both a `message` and an `app_mention`, and
 *    a post made as the owner that tags the bot and then has its screenshots attached by `chat.update` arrived as
 *    two subtype-less `app_mention`s 12 seconds apart (measured: two capture checklists on one tag,
 *    `grep -c "mention from U0SYN000001 in C0SYN000001 (thread 1792560645.281679)"
 *    "$SLOPWEAVER_HOME"/live/listener/logs/<arm-id>.err` prints 2). An event-id key admits both.
 *
 * So the key is the message itself — `channel/messageTs`, the ask identity every later stage already uses —
 * and `event_id` is only a diagnostic the drop line prints. Every address door refuses an event carrying a
 * subtype (an edit included), so two admitted events naming one message are always one ask.
 *
 * The consequence of getting this wrong is not a duplicate log line. A turn posts to Slack, so a second turn
 * on one tag is a second visible message in the thread — the shape of the "at-most-once" failure this
 * codebase has already paid for on the outbound side.
 *
 * ## Bounded on purpose, and process-local
 *
 * A listener is a long-lived process, so an unbounded set of keys is a slow leak. The window is a ring: the
 * oldest key is forgotten once `capacity` is reached. It is in memory, so it promises nothing across a
 * process restart, across two simultaneous listeners, or once a key has been evicted; it is carried across a
 * reconnect by `consumeMentions`' caller.
 */
import type { AskIdentity } from "../ask/identity.js";
import type { SocketEventFrame } from "./frames.js";

/** The bounded window of addressed messages already handled. Immutable — every admission returns a new value. */
export interface DedupeState {
  /** The remembered message keys, oldest first. */
  readonly keys: readonly string[];
  /** How many keys are remembered before the oldest is forgotten. */
  readonly capacity: number;
}

/** The default window — hundreds of addressed messages, still bounded. */
export const DEDUPE_CAPACITY = 512;

/**
 * A fresh, empty dedupe window.
 *
 * @param capacity how many message keys to remember (defaults to {@link DEDUPE_CAPACITY})
 * @returns the empty state
 */
export function createDedupeState({ capacity = DEDUPE_CAPACITY }: { capacity?: number } = {}): DedupeState {
  return { capacity: Math.max(1, capacity), keys: [] };
}

/**
 * The key an address is deduped on: the channel and the addressed message's own timestamp.
 *
 * Deliberately takes no event id. A redelivery and a second event for the same message share this key and
 * never share anything else, so accepting an event id here would only make the wrong key possible again.
 *
 * Each half is URI-encoded so the key is injective: a bare `channel/ts` join would read `C/A` + `B` and `C` +
 * `A/B` as one message. A real channel id and ts carry no `/`, so they print unchanged.
 *
 * @param mention the parsed address, whose channel and message ts identify the Slack message
 * @returns the dedupe key
 */
export function dedupeKeyFor({ mention }: { mention: Pick<AskIdentity, "channel" | "messageTs"> }): string {
  return `${encodeURIComponent(mention.channel)}/${encodeURIComponent(mention.messageTs)}`;
}

/** The frame's event id, or `unstated` naming the gap on a malformed body rather than inventing an id. */
function eventNamed({ frame }: { frame: SocketEventFrame }): string {
  if (frame.eventId === undefined) {
    return "unstated";
  }
  return frame.eventId;
}

/**
 * How a dropped duplicate address is described, so the count and the reason are in one place.
 *
 * Two shapes, told apart by the only evidence this process has — Slack's retry metadata. A frame carrying
 * it is a REDELIVERY of an event already seen; one without it is ANOTHER event naming a message already
 * seen (the two measured classes above), and calling that a redelivery would send a reader hunting for a
 * slow ack that never happened.
 *
 * Deliberately neutral about WHAT happened the first time — "already seen, so no second effect" is true
 * whether the first event was answered or refused, and a redelivered refusal claiming "no second turn"
 * would be a narration that is false for the case it exists to cover.
 *
 * @param frame the dropped frame, whose event id and retry metadata the line prints
 * @param key the message key it was dropped under (see {@link dedupeKeyFor})
 * @returns the one log line the listener prints for the drop
 */
export function duplicateLine({ frame, key }: { frame: SocketEventFrame; key: string }): string {
  const event = eventNamed({ frame });
  const attempt = frame.retryAttempt > 0 ? ` retry_attempt=${String(frame.retryAttempt)}` : "";
  const why = frame.retryReason === undefined ? "" : ` retry_reason=${frame.retryReason}`;
  const ids = `event=${event} message=${key}`;
  if (frame.retryAttempt > 0 || frame.retryReason !== undefined) {
    return `dropped a redelivered mention (${ids}${attempt}${why}) — already seen, so no second effect`;
  }
  return `dropped another event for an already-seen message (${ids}) — already seen, so no second effect`;
}

/**
 * Admit one message key: whether it was already seen, and the window to carry forward.
 *
 * @param state the current window
 * @param key the dedupe key (see {@link dedupeKeyFor})
 * @returns whether the key was already seen, and the next state (unchanged when it was)
 */
export function admitEvent({ state, key }: { state: DedupeState; key: string }): {
  readonly duplicate: boolean;
  readonly state: DedupeState;
} {
  if (state.keys.includes(key)) {
    return { duplicate: true, state };
  }
  const grown = [...state.keys, key];
  return {
    duplicate: false,
    state: {
      capacity: state.capacity,
      keys: grown.length > state.capacity ? grown.slice(grown.length - state.capacity) : grown,
    },
  };
}
