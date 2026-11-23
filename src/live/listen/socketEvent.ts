/**
 * One `events_api` frame, judged — the event path of the listener loop in `./socket.ts`.
 *
 * Acknowledge first, then parse into a mention through the dedupe window, then the scope, the responder
 * whitelist, the thread-reply budget and the deadline race, in that order, and only then the handler. The
 * orderings and why each one is load-bearing are `./socket.ts`'s header; this module holds the code that
 * keeps them, and the connection-wide loop that calls it stays there.
 */
import { admitEvent, dedupeKeyFor, duplicateLine } from "./dedupe.js";
import type { SocketEventFrame } from "./frames.js";
import { MENTION_EVENT_TYPES, type Mention, type MentionHandler, parseMentionEvent } from "./mention.js";
import { admitAddresser } from "./responderHatch.js";
import { type ListenScope, mentionInScope, scopeLine } from "./scope.js";
import type { AddressStart, ListenLog, LoopState, ResponderRefusalHandler, SocketConnection } from "./socket.js";
import { admitThreadReply, THREAD_REPLY_DAILY_CAP } from "./threadReply.js";
import type { ResponderWhitelist } from "./whitelist.js";

/** Run the handler, absorbing a throw: one bad turn must never end the listener. */
async function runHandler({
  handler,
  mention,
  log,
  state,
}: {
  handler: MentionHandler;
  mention: Mention;
  log: ListenLog;
  state: LoopState;
}): Promise<void> {
  try {
    await handler(mention);
    state.handled += 1;
  } catch (error) {
    state.failed += 1;
    log({ line: `the handler threw on a mention in ${mention.channel} — ${String(error)}; the listener continues` });
  }
}

/**
 * Run the refusal handler, absorbing a throw: a bug in the refusal path must never kill the listener, and
 * must never fall through to `handler`. The identity stays refused either way — this only decides whether
 * the unexpected failure is counted.
 */
async function runRefusal({
  mention,
  refuseResponder,
  why,
  log,
  state,
}: {
  mention: Mention;
  refuseResponder: ResponderRefusalHandler;
  why: string;
  log: ListenLog;
  state: LoopState;
}): Promise<void> {
  try {
    await refuseResponder({ mention, why });
  } catch (error) {
    state.failed += 1;
    log({
      line: `the responder refusal handler threw for ${mention.userId} in ${mention.channel} — ${String(error)}; the identity remains refused`,
    });
  }
}

/** The surface word a log line names a mention by: "direct message" or "mention". */
function surfaceWord({ mention }: { mention: Mention }): string {
  return mention.surface === "dm" ? "direct message" : "mention";
}

/** Log the refusal loudly, then run its durable effects. The one place `REFUSED` is ever printed. */
async function handleRefusal({
  log,
  mention,
  refuseResponder,
  state,
  why,
}: {
  log: ListenLog;
  mention: Mention;
  refuseResponder: ResponderRefusalHandler;
  state: LoopState;
  why: string;
}): Promise<void> {
  state.refused += 1;
  log({
    line:
      `REFUSED a ${surfaceWord({ mention })} from ${mention.userId} in ${mention.channel} ` +
      `(thread ${mention.threadTs}): ${why}`,
  });
  await runRefusal({ log, mention, refuseResponder, state, why });
}

/** What one event frame parsed down to: a fresh mention, or the reason it never becomes one. */
type ParsedEvent =
  | { readonly kind: "mention"; readonly mention: Mention; readonly viaThreadReply: boolean }
  | { readonly kind: "ignored"; readonly note: string }
  | { readonly kind: "duplicate"; readonly note: string };

/**
 * Parse one event frame into a fresh mention, applying the dedupe window — pulled out of {@link handleEvent}
 * so that function's own branching stays legible. Mutates `state.seen` on the way through (the dedupe window
 * must advance whether the event turns out ignored, a duplicate, or a real mention).
 */
function parseFreshMention({
  frame,
  selfBotId,
  selfUserId,
  state,
  threadReplyChannels,
}: {
  frame: SocketEventFrame;
  selfBotId: string | undefined;
  selfUserId: string | undefined;
  state: LoopState;
  threadReplyChannels: readonly string[];
}): ParsedEvent {
  if (!MENTION_EVENT_TYPES.includes(frame.eventType)) {
    return {
      kind: "ignored",
      note: `ignored a ${frame.eventType} event — this listener answers a channel tag or a direct message`,
    };
  }
  const parsed = parseMentionEvent({
    enabledChannels: threadReplyChannels,
    event: frame.event,
    selfBotId,
    selfUserId,
  });
  if (parsed.isErr()) {
    return { kind: "ignored", note: `ignored a ${frame.eventType} event: ${parsed.error.message}` };
  }
  const key = dedupeKeyFor({ mention: parsed.value });
  const admitted = admitEvent({ key, state: state.seen });
  state.seen = admitted.state;
  if (admitted.duplicate) {
    return { kind: "duplicate", note: duplicateLine({ frame, key }) };
  }
  // Which of the three addressing doors admitted it, derived rather than carried on `Mention`: only a
  // `message` event can reach the channel surface through `parseChannelThreadReply`, because an
  // `app_mention` is its own event type. A tag typed INSIDE a thread is still an explicit address and is
  // deliberately not budgeted — the cap exists for replies nobody tagged.
  return {
    kind: "mention",
    mention: parsed.value,
    viaThreadReply: frame.eventType === "message" && parsed.value.surface === "channel",
  };
}

/**
 * Decide whether an addressed mention may proceed, running a refusal's durable effects when it may not.
 *
 * Pulled out of {@link handleEvent} so that function's own branching stays legible — the whitelist check
 * itself does not decide who reaches it; only `./mention.ts` decides who even reaches it now.
 */
async function admitOrRefuse({
  log,
  mention,
  refuseResponder,
  responderHatchOpen,
  responderWhitelist,
  state,
}: {
  log: ListenLog;
  mention: Mention;
  refuseResponder: ResponderRefusalHandler;
  responderHatchOpen: () => boolean;
  responderWhitelist: () => ResponderWhitelist;
  state: LoopState;
}): Promise<boolean> {
  const decision = admitAddresser({ log, responderHatchOpen, responderWhitelist, userId: mention.userId });
  if (decision.admitted) {
    return true;
  }
  await handleRefusal({ log, mention, refuseResponder, state, why: decision.why });
  return false;
}

/**
 * Call the race latch and say, when it lost, that the deadline got there first.
 *
 * Called SYNCHRONOUSLY and before any capture effect — never after `runHandler` — so a clock arm cannot
 * also win while this address's (possibly slow) reaction/checklist/status work is still in flight. `false`
 * means something else (the clock) already won, so the mention is not acted on at all. See
 * {@link AddressStart}'s own doc for why a refusal never reaches this call.
 *
 * @param addressStart the latch itself
 * @returns whether this admitted address is the winner and may proceed
 */
function wonTheRace({
  addressStart,
  log,
  mention,
}: {
  addressStart: AddressStart;
  log: ListenLog;
  mention: Mention;
}): boolean {
  if (addressStart({ mention })) {
    return true;
  }
  log({
    line: `an admitted ${surfaceWord({ mention })} from ${mention.userId} arrived after the deadline already won — not acted on`,
  });
  return false;
}

/**
 * Drop an address in a conversation this listener was scoped away from, saying so.
 *
 * BEFORE the whitelist, because a refusal posts a reply: a tag out of scope gets nothing at all in Slack,
 * and is not the tag `--once` waits for. See `./scope.ts`.
 *
 * @returns whether this address is in scope and may proceed
 */
function withinScope({
  log,
  mention,
  scope,
  state,
}: {
  log: ListenLog;
  mention: Mention;
  scope: ListenScope;
  state: LoopState;
}): boolean {
  if (mentionInScope({ mention, scope })) {
    return true;
  }
  state.ignored += 1;
  log({
    line: `ignored a ${surfaceWord({ mention })} from ${mention.userId} in ${mention.channel} — outside this listener's scope, ${scopeLine({ scope })}`,
  });
  return false;
}

/**
 * Spend one reply of this thread's daily budget, or say in the log why nothing happened.
 *
 * Nothing is posted to Slack on a refusal — the whole point of the cap is that a thread stops producing
 * traffic, so a refusal reply would be the noise it exists to prevent. That is why this counts as `ignored`
 * rather than `refused`, matching the out-of-scope drop above: both leave no trace in Slack at all, so
 * neither is the address `--once` is waiting for.
 *
 * @returns whether this reply may proceed
 */
function withinThreadBudget({ log, mention, state }: { log: ListenLog; mention: Mention; state: LoopState }): boolean {
  const budget = admitThreadReply({
    cap: THREAD_REPLY_DAILY_CAP,
    channel: mention.channel,
    counts: state.threadReplies,
    nowIso: new Date().toISOString(),
    threadTs: mention.threadTs,
  });
  state.threadReplies = budget.counts;
  if (budget.admitted) {
    return true;
  }
  state.ignored += 1;
  log({
    line: `ignored a thread reply from ${mention.userId} in ${mention.channel} (thread ${mention.threadTs}) — ${budget.why}`,
  });
  return false;
}

/**
 * Everything an EVENT frame is judged against, bundled — who we are, who may command us, what to do with an
 * admitted address and where a refusal's effects go. One value rather than seven parameters because they
 * travel together through every layer and are never chosen independently: `consumeMentions` fixes them once
 * for the whole connection, and each layer below only forwards them.
 */
export interface EventPolicy {
  readonly addressStart: AddressStart;
  readonly handler: MentionHandler;
  readonly refuseResponder: ResponderRefusalHandler;
  readonly responderHatchOpen: () => boolean;
  readonly responderWhitelist: () => ResponderWhitelist;
  readonly scope: ListenScope;
  readonly selfBotId: string | undefined;
  readonly selfUserId: string | undefined;
  /**
   * The conversations a reply under one of this bot's own posts counts as an address in. Empty — the
   * default — means no channel `message` is ever an address, so naming one conversation is the whole unit
   * of rollout. See `./threadReply.ts`.
   */
  readonly threadReplyChannels: readonly string[];
}

/**
 * Judge one event frame: acknowledge its envelope before anything else, then decide whether it is a fresh,
 * in-scope, admitted address that won the race, and hand it to the handler only if it is. Every outcome lands
 * on `state` or the log.
 */
export async function handleEvent({
  connection,
  frame,
  log,
  policy,
  state,
}: {
  connection: SocketConnection;
  frame: SocketEventFrame;
  log: ListenLog;
  policy: EventPolicy;
  state: LoopState;
}): Promise<void> {
  const { addressStart, handler, refuseResponder, responderHatchOpen, responderWhitelist } = policy;
  connection.acknowledge({ envelopeId: frame.envelopeId });
  const parsed = parseFreshMention({
    frame,
    selfBotId: policy.selfBotId,
    selfUserId: policy.selfUserId,
    state,
    threadReplyChannels: policy.threadReplyChannels,
  });
  if (parsed.kind === "ignored") {
    state.ignored += 1;
    log({ line: parsed.note });
    return;
  }
  if (parsed.kind === "duplicate") {
    state.dropped += 1;
    log({ line: parsed.note });
    return;
  }
  const mention = parsed.mention;
  if (!withinScope({ log, mention, scope: policy.scope, state })) {
    return;
  }
  if (!(await admitOrRefuse({ log, mention, refuseResponder, responderHatchOpen, responderWhitelist, state }))) {
    return;
  }
  // AFTER the whitelist, because a stranger's reply should be told it is a stranger rather than silently
  // eating a budget it was never going to spend, and BEFORE the race latch, so a capped reply cannot win
  // the deadline race and then decline to act.
  if (parsed.viaThreadReply && !withinThreadBudget({ log, mention, state })) {
    return;
  }
  if (!wonTheRace({ addressStart, log, mention })) {
    return;
  }
  log({
    line: `${surfaceWord({ mention })} from ${mention.userId} in ${mention.channel} (thread ${mention.threadTs})`,
  });
  await runHandler({ handler, log, mention, state });
  state.wonAddressConcluded = true;
}
