/**
 * One conversation per console: a voice call and the orb messenger's typed box share one delegated thread's worth of
 * context, tools and relay gate, so they never run side by side. Decided on the server, over every live one, because
 * a disabled button in one tab says nothing to a second tab or the desktop shell's other window.
 *
 * - Typing while a call is up goes INTO the call of the sender's own instance (`/api/talk/typed-in`, {@link liveVoiceCallOf}): the owner's words
 *   reach the voice as their turn and no typed conversation opens beside it, so a typed conversation still never
 *   starts while a call is up (otherwise a pasted Slack link has no way to be sent).
 * - A call started while the typed thread is idle ends it first, so what the owner typed is written down and is
 *   continuity for the call being minted; one started while a typed answer is still being written waits for it. Every
 *   voice mint is ruled alike — the owner's press, a reconnect, a rollover — since a typed conversation another window
 *   opened in a dropped call's gap is as live as any; only the owner's press also yields the box on their own page
 *   first.
 * - A newer typed conversation replaces an older one of its own instance: one box, one thread. The test instance's
 *   typed open (`instance: "e2e"` on `/api/talk/typed`) starts beside nothing of the owner's, at rest or not.
 * - The desktop test instance's call (`slopweaver desktop e2e --call`) ends nothing. It starts beside nothing but
 *   typed conversations AT REST ({@link typedAtRest}): any voice call refuses it, leased or not, and so does a typed
 *   one written in or answered within {@link TYPED_AT_REST_MS}, since an idle typed one holds no lease and a voice
 *   call whose page stopped beating holds none either, so only this registry can say the owner has one. Beside one at
 *   rest it runs as a stranger: every owner surface above reads past it ({@link ownerOnly}), so the owner's typing goes
 *   to their own conversation and never into the test call, and the owner's voice call ends it rather than waiting.
 */

/** Whose a live conversation is: the owner's, or the desktop test instance's call (`instance: "e2e"` on the offer). */
export type ConversationInstance = "owner" | "e2e";

/** What the arbiter reads of each live conversation. */
export interface LiveConversation {
  readonly surface: "voice" | "typed";
  /** Whether its thread is writing an answer now. */
  readonly replying: boolean;
  /** Whether it is the desktop test instance's call rather than the owner's. */
  readonly test: boolean;
  /** Whether it is a typed conversation at rest ({@link typedAtRest}); a voice call never is. */
  readonly atRest: boolean;
}

/**
 * How long a typed conversation must have had nothing sent, started or written before the desktop test instance's call
 * may run beside it. A CHOSEN number, not a measured one: no record of how long the owner pauses mid-conversation
 * exists to measure. It sits above the call store's own quiet window (`src/desktop/unendedCalls.ts`
 * `UNENDED_CALL_QUIET_MS`, five minutes), so a conversation at rest here has also gone quiet there, and the e2e leg's
 * two preflight reads agree rather than one of them always waiting.
 */
export const TYPED_AT_REST_MS = 10 * 60_000;

/**
 * Whether a typed conversation is at rest: nothing being answered, and nothing sent, started or written for at least
 * {@link TYPED_AT_REST_MS}. Fails closed — an instant that is not a finite number, or a clock that reads earlier than the
 * last activity, is never at rest.
 *
 * @param replying whether its thread is writing an answer, or a send is out
 * @param lastActiveMs when it last had a send, a turn notice or a written piece, on the server's clock
 * @param nowMs the server's clock now
 * @returns whether the test instance's call may run beside it
 */
export function typedAtRest({
  replying,
  lastActiveMs,
  nowMs,
}: {
  replying: boolean;
  lastActiveMs: number;
  nowMs: number;
}): boolean {
  if (replying || !Number.isFinite(lastActiveMs) || !Number.isFinite(nowMs) || nowMs < lastActiveMs) {
    return false;
  }
  return nowMs - lastActiveMs >= TYPED_AT_REST_MS;
}

/**
 * The owner's own conversations, the test instance's call left out — what every owner surface reads.
 *
 * @param live every conversation the server holds now
 * @returns the owner's, in the same order
 */
export function ownerOnly<T extends { readonly test: boolean }>({ live }: { live: readonly T[] }): readonly T[] {
  return live.filter((conversation) => !conversation.test);
}

/** Why typing waits while a call is up. */
export const CALL_IS_UP = "a voice call is up; send this to the call instead, or say it to the voice";

/** Why the desktop test instance's call is refused. */
export const E2E_CONVERSATION_HELD =
  "a voice call, or a typed conversation not yet at rest, is held in this console's registry, with or without a live lease, so no test call is placed";

/** Why the desktop test instance's typed conversation is refused. */
export const E2E_TYPED_HELD =
  "the owner holds a conversation in this console's registry, at rest or not, and a typed open replaces typed conversations, so no test conversation is typed into beside it";

/**
 * What may start: the owner's voice call, their typed conversation, or the desktop test instance's voice call or typed
 * conversation.
 */
export type ConversationWanted = "voice" | "typed" | "e2e-voice" | "e2e-typed";

/**
 * What a typed open from one instance asks the arbiter for.
 *
 * @param instance whose page pressed it
 * @returns the owner's typed conversation, or the test instance's
 */
export function typedWantedOf({ instance }: { instance: ConversationInstance }): "typed" | "e2e-typed" {
  if (instance === "e2e") {
    return "e2e-typed";
  }
  return "typed";
}

/**
 * Whose a body's `instance` names: absent is the owner's page, `e2e` the desktop test instance's, and anything else is
 * refused, never read as either. An own property only, so an inherited one is never the page's word.
 *
 * @param body the press's JSON object
 * @returns the instance, or why the body names none this console reads
 */
export function instanceOfBody({
  body,
}: {
  body: Readonly<Record<string, unknown>>;
}): { readonly instance: ConversationInstance } | { readonly refused: string } {
  const marked = Object.hasOwn(body, "instance") ? body["instance"] : undefined;
  if (marked === undefined) {
    return { instance: "owner" };
  }
  if (marked === "e2e") {
    return { instance: "e2e" };
  }
  return { refused: "the body's instance is not one this route reads: absent, or e2e" };
}

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
    // Ends nothing, whatever it starts beside: only an owner's typed conversation at rest is one it may sit beside.
    const besideRestOnly = live.every(
      (conversation) => conversation.surface === "typed" && !conversation.test && conversation.atRest,
    );
    if (!besideRestOnly) {
      return { kind: "refused", reason: E2E_CONVERSATION_HELD };
    }
    return { end: [], kind: "go" };
  }
  if (wanted === "e2e-typed") {
    return testTypedRuling({ live });
  }
  const owners = ownerOnly({ live });
  const typed = live.flatMap((conversation, index) =>
    conversation.surface === "typed" && !conversation.test ? [index] : [],
  );
  if (wanted === "typed") {
    if (owners.some((conversation) => conversation.surface === "voice")) {
      return { kind: "refused", reason: CALL_IS_UP };
    }
    return { end: typed, kind: "go" };
  }
  if (owners.some((conversation) => conversation.surface === "typed" && conversation.replying)) {
    return { kind: "refused", reason: TYPED_IS_REPLYING };
  }
  // The owner's call outranks a test call: it ends one up, rather than waiting on it or sitting beside it.
  const tests = live.flatMap((conversation, index) => (conversation.test ? [index] : []));
  return { end: [...typed, ...tests].toSorted((left, right) => left - right), kind: "go" };
}

/**
 * The desktop test instance's typed open. A typed open replaces the typed conversations it starts beside, so this one
 * starts beside nothing of the owner's at all, at rest or not, and ends only the test instance's own typed one. The e2e
 * leg's preflight already waits for none before a scenario that types (`besideAtRestFor`); this refuses rather than
 * trusts that.
 *
 * @param live every conversation the server holds now
 * @returns the ruling
 */
function testTypedRuling({ live }: { live: readonly LiveConversation[] }): ConversationRuling {
  if (live.some((conversation) => !conversation.test)) {
    return { kind: "refused", reason: E2E_TYPED_HELD };
  }
  if (live.some((conversation) => conversation.surface === "voice")) {
    return { kind: "refused", reason: CALL_IS_UP };
  }
  return { end: live.flatMap((conversation, index) => (conversation.surface === "typed" ? [index] : [])), kind: "go" };
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
 * Only a call of the sender's own instance is a pick: the owner's words never reach a test call, and the test instance's
 * never reach the owner's.
 *
 * @param live every conversation the server holds now, each with when it was made and whether it is a test call
 * @param pressedMs when the owner pressed send, on the same machine's clock
 * @param instance whose page sent it: the owner's, or the desktop test instance's (`instance: "e2e"` on the body)
 * @returns the call, or why there is not exactly one the owner could have been typing to
 */
export function liveVoiceCallOf<
  T extends { readonly surface: "voice" | "typed"; readonly madeMs: number; readonly test: boolean },
>({
  live,
  pressedMs,
  instance,
}: {
  live: readonly T[];
  pressedMs: number;
  instance: ConversationInstance;
}): LiveVoicePick<T> {
  const fromTest = instance === "e2e";
  const voices = live.filter((conversation) => conversation.surface === "voice" && conversation.test === fromTest);
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
 * Whether a message typed into a live typed conversation may be sent now, given every live conversation. A test call
 * running beside it is no call of the owner's, so it never holds a send.
 *
 * @param live every conversation the server holds now
 * @returns `undefined` when it may, else why not
 */
export function typedSendRefusal({ live }: { live: readonly LiveConversation[] }): string | undefined {
  if (ownerOnly({ live }).some((conversation) => conversation.surface === "voice")) {
    return CALL_IS_UP;
  }
  return undefined;
}
