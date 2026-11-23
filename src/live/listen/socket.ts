/**
 * The listener LOOP — the transport half of the agent surface, and nothing else.
 *
 * It reads frames off an INJECTED {@link SocketConnection}, acknowledges each envelope, decides what is a
 * mention and what is a duplicate of one, and hands every accepted mention to an injected {@link MentionHandler}.
 * It never opens a socket, never posts anything, and never composes an answer — the socket is `./wire.ts`
 * and the answer belongs to whatever handler is passed in.
 *
 * That is what makes the dangerous parts testable with a plain fake async generator and zero mocks: the
 * acknowledge-then-work ordering, the duplicate-address drop, the "an event that is not an address is ignored by
 * name" rule, and the "a handler that throws must not kill the listener" rule are all exercised in
 * `src/__tests__/unit/live/listen/socket/` with no network at all.
 *
 * ## Two event types reach the parse, and the parse decides
 *
 * `app_mention` is a channel tag; `message` is a direct message, where the owner decided that every message
 * is address. The pre-filter here is deliberately the WIDER of the two checks — it lets both types through
 * and lets `./mention.ts` refuse a `message.channels`, an `mpim` or a bot-authored DM by name. Duplicating
 * the `channel_type` rule here would be a second place for it to drift, and the transport is the half of
 * this feature that is supposed to hold no judgement.
 *
 * ## Acknowledge first, then work — in that order, always
 *
 * Slack expects the envelope acknowledged within about three seconds and REDELIVERS anything it did not see
 * acknowledged. A turn takes far longer than three seconds, so acknowledging after the work is the same as
 * asking for a duplicate. The ack therefore happens before the frame is even parsed into a mention: an
 * envelope this program cannot understand is still an envelope Slack is waiting on.
 *
 * The dedupe window is the second half of that guarantee and it is threaded THROUGH a reconnect: the state
 * goes in and comes back out rather than living inside the loop, because a socket that drops mid-turn is
 * exactly when a redelivery arrives, and a window that reset on reconnect would let it through. It is keyed
 * on the MESSAGE, not the event id, because one message can arrive as two distinct events (`./dedupe.ts`).
 *
 * ## Every drop is printed
 *
 * A silent drop is indistinguishable from a bug. Whatever ends up ignored — a duplicate, a non-tag event, a
 * frame that would not parse, a handler that threw — says so on its own line, with the reason.
 *
 * ## WHO may command the bot is decided here, after dedupe and before any capture effect
 *
 * `admitResponder` runs AFTER `admitEvent` has marked the message's key seen and BEFORE the accepted-address
 * log line or `handler` ever fire. Both orderings are load-bearing: after dedupe, so a Slack redelivery of an
 * already-refused tag lands in the duplicate branch rather than refusing (and replying, and ledgering) a
 * second time; before the handler, because `handler` is what reacts, posts the capture checklist and spends a
 * whole turn — none of which a refused identity should ever cause.
 *
 * This is the ONLY identity gate a bot-authored event passes through: `./mention.ts` no
 * longer refuses every bot outright, only this install's own app (`selfBotId`), so a whitelisted peer bot's
 * `mention.userId` reaches `admitResponder` exactly the way a human's does.
 */
import { handleHello, type MultipleConnectionsRefusal } from "./connections.js";
import type { DedupeState } from "./dedupe.js";
import { parseSocketFrame } from "./frames.js";
import type { Mention, MentionHandler } from "./mention.js";
import { SLACK_LINK_DISABLED } from "./reconnect.js";
import { type ListenScope, UNSCOPED } from "./scope.js";
import { type EventPolicy, handleEvent } from "./socketEvent.js";
import { NO_THREAD_REPLIES, type ThreadReplyCounts } from "./threadReply.js";
import type { ResponderWhitelist } from "./whitelist.js";

/** A live Socket Mode connection, as the loop needs it: frames in, acknowledgements out. */
export interface SocketConnection {
  /** Every text frame, in arrival order. Returns when the socket has closed and the buffer is drained. */
  frames(): AsyncIterable<string>;
  /** Acknowledge one envelope. Must be sent before any work on that envelope begins. */
  acknowledge(args: { envelopeId: string }): void;
  /** Why the connection ended, or undefined while it is live. */
  endedBecause(): string | undefined;
  /**
   * Close the connection GRACEFULLY (a signal, or `--once` having done its one turn) — buffered frames
   * drain. Resolves once the underlying transport has actually settled, OR after a bounded ceiling if a
   * peer never confirms (see `wire.ts`'s `settleWithinBound`) — never once the request to close it was made
   * and never left unresolved forever either. Not itself awaited by the ordinary `--once` path, which is
   * fire-and-forget on purpose (nothing there races on the outcome); deadline mode's cancel below is what
   * actually needs this bound.
   */
  close(args: { why: string }): Promise<void>;
  /**
   * Close the connection DESTRUCTIVELY — buffered, not-yet-admitted frames are discarded rather than drained.
   * Resolves within the same bound {@link close} does, for the same reason.
   *
   * Deadline mode's only close primitive: once a real winner is decided, the connection must not go on
   * quietly draining whatever Slack had already buffered — see `./frameQueue.ts`'s `FrameQueue.cancel`. Never used by
   * ordinary `--once`, which keeps `close`'s graceful drain unchanged.
   */
  cancel(args: { why: string }): Promise<void>;
  /** How many frames arrived after the connection closed, or were discarded by {@link cancel}. */
  discarded(): number;
}

/**
 * Whether an admitted address may proceed to its handler, decided BEFORE the handler runs and its capture
 * effects (reaction, checklist, status) begin.
 *
 * Called only for an ADMITTED mention — never for a refusal, which is deliberately outside this decision (a
 * refusal cannot win or lose a race it never enters, see the deadline-listener handover's P3 finding on this
 * exact point). `true` means this address is the winner; `false` means something else already won (the
 * clock), so no handler runs and the mention is not acted on — the connection's own teardown, already under
 * way elsewhere, is what stops the loop, not this return value.
 */
export type AddressStart = (args: { mention: Mention }) => boolean;

/** Where the loop's narration goes. A plain function so a test collects lines instead of mocking a logger. */
export type ListenLog = (args: { line: string }) => void;

/**
 * Where a whitelist refusal's durable effects go — the door ledger and the fixed reply, in the live wiring.
 * Never expected to throw: the live implementation is best-effort over its own two internal steps, so this
 * is a defensive contract rather than the normal path. See `handleEvent` for what happens if it does anyway.
 */
export type ResponderRefusalHandler = (args: { mention: Mention; why: string }) => Promise<void>;

/** What one connection's lifetime did. Counts, so a run can be summarised without re-reading the log. */
export interface ConnectionOutcome {
  /** Mentions handed to the handler. */
  readonly handled: number;
  /**
   * Duplicate addresses dropped because their MESSAGE had already been handled OR already refused — a Slack
   * redelivery, or a second event naming the same message.
   */
  readonly dropped: number;
  /** Events acknowledged but not acted on: neither a tag nor a DM, or a frame that would not parse. */
  readonly ignored: number;
  /**
   * Addressed messages refused because the identity is not on the responder whitelist.
   *
   * Counted APART from `ignored`: an ignored event is noise the listener was never meant to act on, this is
   * somebody who really did address the bot and was deliberately not answered. Collapsing the two would bury
   * the one number that shows the gate doing its job.
   */
  readonly refused: number;
  /** Handler or refusal-handler invocations that threw. Counted rather than fatal. */
  readonly failed: number;
  /**
   * Frames that reached a CLOSED connection and were thrown away — the `--once` silent drop, made loud.
   *
   * The other four counters describe things this listener decided to do. This one describes something it
   * failed to receive, which is why it was missing: nothing in the loop ever saw these frames, so there was
   * no code path with an obvious place to increment. The count comes from the connection itself.
   *
   * Non-zero means a tag may have been lost. "May", precisely: a discarded frame might be a redelivery of one
   * already handled, or a `hello` on a dying socket. What it can never be is nothing, and it can never again
   * be invisible.
   */
  readonly abandoned: number;
  /** Slack's stated `disconnect` reason, when it sent one before closing. */
  readonly disconnectReason: string | undefined;
  /**
   * Whether an admitted address won the arbiter's race and its handler concluded — success OR failure. See
   * `LoopState`'s own field of the same name for why this is distinct from `handled + failed > 0`, and why
   * it exists at all: `stepAfterDrain` (in `loop.ts`, which has no other access to this connection's internal
   * state) needs it to treat deadline mode's `--once` as satisfied even when the winning handler failed,
   * rather than reconnecting to wait on a clock that `AddressStart` has already permanently disabled.
   */
  readonly wonAddressConcluded: boolean;
  /**
   * Set when Slack's `hello` reported more than one connection with no override — a tag can be delivered to
   * either one, and only one of them will answer. The reconnect loop (`loop.ts`) retries it inside a bounded
   * grace window and exits on one past it; this outcome alone only describes what happened here.
   */
  readonly connectionRefusal: MultipleConnectionsRefusal | undefined;
  /**
   * Whether a `hello` on this connection passed the permit — the one sign the socket was really live, so the
   * reconnect loop ends a refusal streak and resets its consecutive-failure count on it. A frame arriving is
   * not that sign, and neither is a socket opening.
   */
  readonly helloPermitted: boolean;
}

/**
 * The loop's result: what happened, the dedupe window to carry into the next connection, and how much of
 * each thread's daily reply budget has been spent. Both carried values exist for the same reason — a
 * reconnect is one listener continuing, not a new one, so neither window may reset when the socket does.
 */
export interface ConsumeResult {
  readonly outcome: ConnectionOutcome;
  readonly seen: DedupeState;
  readonly threadReplies: ThreadReplyCounts;
}

/** The mutable tallies + window one connection accumulates. */
export interface LoopState {
  handled: number;
  dropped: number;
  ignored: number;
  refused: number;
  failed: number;
  disconnectReason: string | undefined;
  seen: DedupeState;
  /** What each thread has already spent of its daily reply budget — see `./threadReply.ts`. */
  threadReplies: ThreadReplyCounts;
  stop: boolean;
  /**
   * Set once an admitted address has won the arbiter's race and its handler has concluded — success OR
   * failure, since `runHandler` never lets a throw escape. Distinct from `handled + failed > 0`, which a
   * failing REFUSAL'S own handler also increments — this is deliberately narrower, and is what
   * `closeIfSatisfied`'s deadline-mode branch checks: a review pass found that a THROWING admitted handler
   * (a `--queue` file write failing, say) left `handled` at 0, so the connection stayed open waiting for a
   * frame that could never arrive again — the clock had already been PERMANENTLY disabled by `addressStart`
   * winning, before the handler was even known to succeed. There is no "un-win" path once that latch fires;
   * this field is what lets the connection close (and the loop exit) even when the winning handler failed.
   */
  wonAddressConcluded: boolean;
  /** See {@link ConnectionOutcome.connectionRefusal}. */
  connectionRefusal: MultipleConnectionsRefusal | undefined;
  /** See {@link ConnectionOutcome.helloPermitted}. */
  helloPermitted: boolean;
}

/**
 * The disconnect reason to keep: a fatal reason, once observed, is STICKY rather than overwritten by a
 * later frame on the same connection.
 *
 * A review pass found that a second disconnect (any other reason) arriving after `link_disabled` would
 * silently replace it, letting a subsequently-successful admission mask the fatal condition in deadline
 * mode's own exit decision. Whether Slack's real protocol can genuinely send two conflicting disconnect
 * frames on one still-open socket is unclear; keeping the fatal one is the safe default regardless.
 *
 * @param next the reason the newest disconnect frame carried
 * @param previous the reason already recorded, if any
 * @returns whichever reason should be recorded going forward
 */
function stickyDisconnectReason({ next, previous }: { next: string; previous: string | undefined }): string {
  return previous === SLACK_LINK_DISABLED ? previous : next;
}

/** One frame of any kind. Returns nothing — every effect lands on `state` or the log. */
async function handleFrame({
  allowMultipleConnections,
  connection,
  log,
  onHello,
  policy,
  state,
  text,
}: {
  allowMultipleConnections: boolean;
  connection: SocketConnection;
  log: ListenLog;
  onHello: (args: { connections: number }) => void;
  policy: EventPolicy;
  state: LoopState;
  text: string;
}): Promise<void> {
  const frame = parseSocketFrame({ text });
  switch (frame.kind) {
    case "hello":
      await handleHello({
        allowMultipleConnections,
        connection,
        connections: frame.connections,
        log,
        onHello,
        state,
      });
      return;
    case "disconnect": {
      // Slack warns BEFORE it closes. Recorded, not treated as a failure — see `./reconnect.ts`.
      state.disconnectReason = stickyDisconnectReason({ next: frame.reason, previous: state.disconnectReason });
      log({ line: `Slack asked this socket to disconnect (reason: ${frame.reason}); reconnecting` });
      return;
    }
    case "event":
      await handleEvent({ connection, frame, log, policy, state });
      return;
    case "ignored":
      state.ignored += 1;
      log({ line: `ignored a ${frame.frameType} frame — this listener reads events_api frames only` });
      return;
    case "unreadable":
      state.ignored += 1;
      log({ line: `could not read a frame: ${frame.why}` });
      return;
  }
}

/** The fresh tallies + carried window a connection starts draining with. */
function initialLoopState({ seen, threadReplies }: { seen: DedupeState; threadReplies: ThreadReplyCounts }): LoopState {
  return {
    connectionRefusal: undefined,
    disconnectReason: undefined,
    dropped: 0,
    failed: 0,
    handled: 0,
    helloPermitted: false,
    ignored: 0,
    refused: 0,
    seen,
    stop: false,
    threadReplies,
    wonAddressConcluded: false,
  };
}

/**
 * Close the connection once `--once` is satisfied.
 *
 * Two genuinely different modes, not one condition with an extra flag bolted on:
 *
 * - **Ordinary `--once` (`discardBufferedAfterFirst: false`, the default):** a HANDLED or a REFUSED address
 *   is equally final — both are the addressed message's own deterministic response — so either satisfies it,
 *   and the close is graceful: anything already buffered still drains.
 * - **Deadline mode (`discardBufferedAfterFirst: true`):** an admitted address WINNING the race and its
 *   handler CONCLUDING — `state.wonAddressConcluded`, success or failure — satisfies it. Never `refused`: a
 *   refusal never entered the race and so cannot win or end it (see `AddressStart`). Failure counts too, and
 *   that half changed on purpose: an earlier version gated on `handled` alone, deliberately NOT closing after
 *   a thrown handler (a queue-file write failing, say), reasoning that tearing down having emitted nothing
 *   would be the silent-swallow this repo keeps finding and refusing to repeat — hoping instead that a LATER
 *   admitted address might still arrive and succeed, since `AddressStart`'s latch only excludes the CLOCK,
 *   not a second Slack address. A review pass found the failure mode that reasoning missed: once `AddressStart`
 *   has admitted ANY address, the clock is ALREADY permanently disabled, so if no second address ever
 *   arrives, the connection waits forever with no clock left to end it — "never stall silently" (this
 *   feature's own house rule) loses to a hoped-for redemption that may never come. Closing on a concluded
 *   failure lets the process exit with a judgeable "no JSON, non-zero exit", which `skills/loop/SKILL.md`'s own
 *   documented protocol already knows how to handle — strictly better than hanging on the chance a second
 *   address saves it. Frames are processed strictly sequentially (one `handleFrame` fully resolves before
 *   the next is even pulled), so waiting for genuine completion here cannot let a duplicate WIN sneak past
 *   the arbiter's own separate, earlier latch — this is only about when it is safe to physically tear the
 *   socket down. The close itself is destructive: buffered frames are discarded, not drained, so the deadline
 *   path's stdout stays genuinely one event (or, on this branch, none).
 */
async function closeIfSatisfied({
  connection,
  discardBufferedAfterFirst,
  log,
  state,
  stopAfterFirst,
}: {
  connection: SocketConnection;
  discardBufferedAfterFirst: boolean;
  log: ListenLog;
  state: LoopState;
  stopAfterFirst: boolean;
}): Promise<void> {
  if (!stopAfterFirst || state.stop) {
    return;
  }
  const satisfied = discardBufferedAfterFirst ? state.wonAddressConcluded : state.handled + state.refused > 0;
  if (!satisfied) {
    return;
  }
  state.stop = true;
  if (discardBufferedAfterFirst) {
    log({
      line: "deadline mode: one address won the race, cancelling the connection (anything buffered is discarded)",
    });
    await connection.cancel({ why: "deadline mode resolved one address" });
    return;
  }
  // What close does and does not cost, measured rather than assumed: frames ALREADY buffered still drain
  // (the queue empties its buffer before it honours the end), so this loop keeps handling them. Frames that
  // arrive AFTER this point are thrown away — and they are the ones Slack will not usefully redeliver,
  // because the connection they would come back to has gone. Hence the count below.
  log({ line: "--once: one address resolved, closing the connection (anything already buffered still drains)" });
  // Deliberately NOT awaited, unlike the deadline branch's `cancel` above: awaiting the deadline race's
  // cancel is what makes THAT race correct (see this function's header), but this ordinary path is deciding
  // nothing — there is no race whose winner could be misreported by teardown still being in flight. Awaiting
  // it here instead — tried, and reverted — traded that non-guarantee for a real one: a peer whose close
  // handshake never completes and never errors would leave `settled` unresolved forever, hanging the whole
  // process on a plain `--once` run that used to exit cleanly. Fire-and-forget is the pre-existing, correct
  // shape for a close nothing downstream needs to observe finishing.
  void connection.close({ why: "--once resolved one address" });
}

/** Print the `--once` silent-drop count, when there was one. */
function logAbandoned({ abandoned, log }: { abandoned: number; log: ListenLog }): void {
  if (abandoned === 0) {
    return;
  }
  log({
    line:
      `${String(abandoned)} frame(s) arrived after the connection closed and were thrown away — if one was a ` +
      "tag, it was never acknowledged and Slack cannot redeliver it to a closed socket. Recover it with " +
      "`slopweaver listen recover`.",
  });
}

/** The final result: the outcome tallies plus the dedupe window to carry into the next connection. */
function consumeResultOf({ abandoned, state }: { abandoned: number; state: LoopState }): ConsumeResult {
  return {
    outcome: {
      abandoned,
      connectionRefusal: state.connectionRefusal,
      disconnectReason: state.disconnectReason,
      dropped: state.dropped,
      failed: state.failed,
      handled: state.handled,
      helloPermitted: state.helloPermitted,
      ignored: state.ignored,
      refused: state.refused,
      wonAddressConcluded: state.wonAddressConcluded,
    },
    seen: state.seen,
    threadReplies: state.threadReplies,
  };
}

/**
 * Drain one connection: acknowledge every envelope, hand every fresh mention to the handler, and report what
 * happened plus the dedupe window to carry forward.
 *
 * @param addressStart called synchronously the instant an admitted address would otherwise proceed, before
 *   any capture effect — `true` lets it proceed, `false` means something else already won and it is not
 *   acted on. Defaults to always admitting, which is every existing caller's exact current behaviour. Never
 *   called for a refusal — see {@link AddressStart}'s own doc.
 * @param connection the live connection (injected — a test passes a fake async generator)
 * @param discardBufferedAfterFirst whether the first winning address CANCELS the connection (discarding
 *   whatever else is buffered) instead of gracefully closing it (which drains what is already buffered).
 *   Defaults to `false`, preserving every existing caller's exact current behaviour — see
 *   {@link closeIfSatisfied} for why the two modes cannot share one condition.
 * @param handler what to do with an admitted mention; the turn half of this feature replaces the stub
 * @param log where each line of narration goes
 * @param refuseResponder where a whitelist refusal's durable effects go (the door ledger, the fixed reply) —
 *   REQUIRED, so no caller can wire a listener that refuses without a reply ever being attempted
 * @param responderHatchOpen asks, per address, whether the journalled `responder-allow-open` grant is open
 * @param responderWhitelist reads the responder whitelist every addressed message is put through — called once
 *   PER addressed mention, so a `responders add` takes effect on the next tag without a restart; REQUIRED, so
 *   no caller can admit the whole workspace by omitting it
 * @param selfBotId this install's own `bot_id` from `auth.test`, or `undefined` when it is not yet known —
 *   the only identity a bot-authored event is ever refused for; any OTHER bot reaches `responderWhitelist`
 *   exactly like a human tag
 * @param selfUserId this install's own Slack USER id from `auth.test` — the tag a DM must carry to be
 *   address at all (`./mention.ts`'s own header); `undefined` refuses every DM rather than admitting an
 *   untagged one
 * @param scope the conversations this listener acts on; an address outside it is dropped before the
 *   whitelist, with no Slack effect at all. Defaults to every conversation, the unscoped listener
 * @param seen the dedupe window from the previous connection, so a redelivery after a reconnect still drops
 * @param stopAfterFirst whether to close the connection after ONE resolved address — handled OR refused —
 *   because both are the addressed message's final deterministic response (`--once`)
 * @param allowMultipleConnections the resolved `SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS` break-glass —
 *   defaults to `false` (refuse), so every existing caller not yet passing this gets the strict behavior
 * @param onFrame called once per frame BEFORE it is interpreted — including a `ping` and a frame this
 *   listener goes on to ignore. That breadth is the point: it is the liveness signal a supervisor reads, and
 *   the question it answers is "is Slack still talking to this socket", not "did this socket see a tag". A
 *   listener that only stamped a real tag would look dead every quiet hour.
 * @param onHello called with the connection count Slack reported on `hello`, before the permit decides,
 *   and not at all when that frame carried no count. The one place this number is observable — see
 *   `./supervise/socketBudget.ts` for why nothing local can compute it instead
 * @returns the tallies and the dedupe window to carry into the next connection
 */
export async function consumeMentions({
  addressStart = () => true,
  allowMultipleConnections = false,
  connection,
  discardBufferedAfterFirst = false,
  handler,
  log,
  onFrame = () => undefined,
  onHello = () => undefined,
  refuseResponder,
  responderHatchOpen,
  responderWhitelist,
  scope = UNSCOPED,
  selfBotId = undefined,
  selfUserId = undefined,
  seen,
  stopAfterFirst = false,
  threadReplies = NO_THREAD_REPLIES,
  threadReplyChannels = [],
}: {
  addressStart?: AddressStart;
  allowMultipleConnections?: boolean;
  connection: SocketConnection;
  discardBufferedAfterFirst?: boolean;
  handler: MentionHandler;
  log: ListenLog;
  onFrame?: () => void;
  onHello?: (args: { connections: number }) => void;
  refuseResponder: ResponderRefusalHandler;
  responderHatchOpen: () => boolean;
  responderWhitelist: () => ResponderWhitelist;
  scope?: ListenScope;
  selfBotId?: string;
  selfUserId?: string;
  seen: DedupeState;
  stopAfterFirst?: boolean;
  threadReplies?: ThreadReplyCounts;
  threadReplyChannels?: readonly string[];
}): Promise<ConsumeResult> {
  const state = initialLoopState({ seen, threadReplies });
  const policy: EventPolicy = {
    addressStart,
    handler,
    refuseResponder,
    responderHatchOpen,
    responderWhitelist,
    scope,
    selfBotId,
    selfUserId,
    threadReplyChannels,
  };
  for await (const text of connection.frames()) {
    onFrame();
    await handleFrame({ allowMultipleConnections, connection, log, onHello, policy, state, text });
    await closeIfSatisfied({ connection, discardBufferedAfterFirst, log, state, stopAfterFirst });
  }
  const abandoned = connection.discarded();
  logAbandoned({ abandoned, log });
  return consumeResultOf({ abandoned, state });
}
