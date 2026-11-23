/**
 * One conversation per console: a voice call and the orb messenger's typed box share one delegated thread's worth of
 * context, tools and relay gate, so they never run side by side. Decided on the server, over every live one, because
 * a disabled button in one tab says nothing to a second tab or the desktop shell's other window.
 *
 * - Typing while a call is up goes INTO the call (`/api/talk/typed-in`, {@link liveVoiceCallOf}): the owner's words
 *   reach the voice as their turn and no typed conversation opens beside it, so a typed conversation still never
 *   starts while a call is up (otherwise a pasted Slack link has no way to be sent).
 * - A call started while the typed thread is idle ends it first, so what the owner typed is written down and is
 *   continuity for the call being minted; one started while a typed answer is still being written waits for it. Every
 *   voice mint is ruled alike — the owner's press, a reconnect, a rollover — since a typed conversation another window
 *   opened in a dropped call's gap is as live as any; only the owner's press also yields the box on their own page
 *   first.
 * - A newer typed conversation replaces an older one: one box, one thread.
 * - The desktop test instance's call (`slopweaver desktop e2e --call`) ends nothing and starts beside nothing: any
 *   conversation held here refuses it, voice or typed, leased or not — an idle typed one holds no lease, and a voice
 *   call whose page stopped beating holds none either, so only this registry can say the owner has one.
 */

/** What the arbiter reads of each live conversation. */
export interface LiveConversation {
  readonly surface: "voice" | "typed";
  /** Whether its thread is writing an answer now. */
  readonly replying: boolean;
}

/** Why typing waits while a call is up. */
export const CALL_IS_UP = "a voice call is up; send this to the call instead, or say it to the voice";

/** Why the desktop test instance's call is refused. */
export const E2E_CONVERSATION_HELD =
  "a conversation is held in this console's registry, with or without a live lease, so no test call is placed";

/** What may start: the owner's voice call, their typed conversation, or the desktop test instance's voice call. */
export type ConversationWanted = "voice" | "typed" | "e2e-voice";

/** Why a call waits for a typed answer. */
export const TYPED_IS_REPLYING = "a typed answer is still being written in the messenger; start the call once it lands";

/**
 * How long a typed message whose fate is unknown still counts as being answered, unless the thread says sooner: as
 * long again as `turn/start` is given (`PLAN_CALL_LIMITS.handshakeStepMs`), since a turn it took announces itself well
 * inside that. Long enough that a call never ends an answer still coming; bounded, so a message the thread never took
 * does not hold every call off for good.
 */
export const TYPED_UNSURE_HOLD_MS = 20_000;

/** The arbiter's ruling: go, ending the conversations it names first, or refuse with why. */
export type ConversationRuling =
  { readonly kind: "go"; readonly end: readonly number[] } | { readonly kind: "refused"; readonly reason: string };

/**
 * Whether a new conversation on `wanted` may start now, and which live ones it ends first, by their index in `live`.
 *
 * @param wanted the surface about to start
 * @param live every conversation the server holds now
 * @returns the ruling
 */
export function conversationRuling({
  wanted,
  live,
}: {
  wanted: ConversationWanted;
  live: readonly LiveConversation[];
}): ConversationRuling {
  if (wanted === "e2e-voice") {
    if (live.length > 0) {
      return { kind: "refused", reason: E2E_CONVERSATION_HELD };
    }
    return { end: [], kind: "go" };
  }
  const typed = live.flatMap((conversation, index) => (conversation.surface === "typed" ? [index] : []));
  if (wanted === "typed") {
    if (live.some((conversation) => conversation.surface === "voice")) {
      return { kind: "refused", reason: CALL_IS_UP };
    }
    return { end: typed, kind: "go" };
  }
  if (live.some((conversation) => conversation.surface === "typed" && conversation.replying)) {
    return { kind: "refused", reason: TYPED_IS_REPLYING };
  }
  return { end: typed, kind: "go" };
}

/** The voice call a message typed mid-call goes into: the one live, or why there is none to pick. */
export type LiveVoicePick<T> =
  | { readonly kind: "one"; readonly call: T }
  | { readonly kind: "none"; readonly reason: string }
  | { readonly kind: "several"; readonly reason: string }
  | { readonly kind: "newer"; readonly reason: string };

/** Why a message typed for a call has none to go into. */
export const NO_CALL_UP = "no voice call is up; it ended, or this server restarted";

/** Why a message typed for one call is not handed to the call that replaced it. */
export const CALL_CHANGED = "the call that was up when this was sent has ended and a new one started; send it again";

/**
 * The one live voice call, found without an id because the window the owner typed in may not be the one holding it.
 * Two at once is refused rather than guessed at: the server leaves a second call to the page's own one-call rule, and
 * the owner's words reaching the wrong one is worse than a box that says so. So is a call made after send was
 * pressed: the one the owner was typing to ended and another window started this one before the message arrived.
 *
 * @param live every conversation the server holds now, each with when it was made
 * @param pressedMs when the owner pressed send, on the same machine's clock
 * @returns the call, or why there is not exactly one the owner could have been typing to
 */
export function liveVoiceCallOf<T extends { readonly surface: "voice" | "typed"; readonly madeMs: number }>({
  live,
  pressedMs,
}: {
  live: readonly T[];
  pressedMs: number;
}): LiveVoicePick<T> {
  const voices = live.filter((conversation) => conversation.surface === "voice");
  const only = voices.at(0);
  if (only === undefined) {
    return { kind: "none", reason: NO_CALL_UP };
  }
  if (voices.length > 1) {
    return { kind: "several", reason: `${String(voices.length)} voice calls are up; hang up all but one, then send` };
  }
  // A tie is refused: both instants are whole milliseconds, and the owner cannot have been typing to a call made in the press's own millisecond.
  if (only.madeMs >= pressedMs) {
    return { kind: "newer", reason: CALL_CHANGED };
  }
  return { call: only, kind: "one" };
}

/**
 * Whether a message typed into a live typed conversation may be sent now, given every live conversation.
 *
 * @param live every conversation the server holds now
 * @returns `undefined` when it may, else why not
 */
export function typedSendRefusal({ live }: { live: readonly LiveConversation[] }): string | undefined {
  if (live.some((conversation) => conversation.surface === "voice")) {
    return CALL_IS_UP;
  }
  return undefined;
}
