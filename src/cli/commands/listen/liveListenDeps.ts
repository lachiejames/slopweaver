/**
 * `slopweaver listen`'s live seams: the real ticket, websocket and clock, the shared Slack transport, the
 * responder-refusal handler, this install's own identity, and where the progress narration goes.
 *
 * Split out of {@link ./runLoop.js} (the file-size ratchet). `runLoop.ts` calls {@link progressLogFor} and
 * {@link buildLiveListenDeps}; the mention handler they wire in is `./capturingHandler.ts`'s.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import { openSocketTicket } from "../../../live/listen/appsConnections.js";
import { liveChunkedWait } from "../../../live/listen/chunkedWait.js";
import type { MentionHandler } from "../../../live/listen/mention.js";
import type { ListenScope } from "../../../live/listen/scope.js";
import type { ListenLog, ResponderRefusalHandler } from "../../../live/listen/socket.js";
import type { ListenerBeatWriter } from "../../../live/listen/supervise/beatWriter.js";
import type { ResponderWhitelist } from "../../../live/listen/whitelist.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import { openSocketConnection } from "../../../live/listen/wire.js";
import type { SupervisorSession } from "../../../supervisor/session.js";
import { ownerUserIdFromProfile } from "../slack/wiring.js";
import { capturingHandler } from "./capturingHandler.js";
import type { ListenDeps } from "./loop.js";
import { responderRefusalHandler } from "./responderRefusal.js";
import { liveHelloRecorder } from "./selfRecord.js";

/**
 * The live seams: the real ticket, the real websocket, the real clock. `log` is injected — see
 * {@link progressLogFor}.
 *
 * Exported for one reason: the beat's two callbacks used to reach this object through a conditional spread,
 * which is exempt from excess-property checking, so they were dropped silently and every supervisor read
 * went DOWN on a healthy listener. A test now asserts the wiring, and a test needs the function.
 *
 * @param allowMultipleConnections the resolved SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS break-glass
 * @param beat the supervision heartbeat writer, or `undefined` when this listener is not supervised
 * @param handler what to do with an admitted mention
 * @param log where the progress narration goes
 * @param onHello where the `hello` frame's connection count is recorded — named explicitly for the same
 *   reason the beat's two callbacks are, one paragraph below
 * @param refuseResponder where a whitelist refusal's durable effects go
 * @param responderHatchOpen asks, per address, whether the journalled `responder-allow-open` grant is open
 * @param responderWhitelist reads who may command the bot, once per addressed mention
 * @param scope the conversations this listener acts on
 * @param self this install's own identity from `auth.test` — its `bot_id` (the one identity a bot-authored
 *   event is refused for) and its Slack USER id (the tag a direct message must carry to be address at all),
 *   each `undefined` when it could not be resolved
 * @returns the assembled live seams
 */
export function liveDeps({
  allowMultipleConnections,
  beat,
  handler,
  log,
  onHello,
  refuseResponder,
  responderHatchOpen,
  responderWhitelist,
  scope,
  self,
  threadReplyChannels,
}: {
  allowMultipleConnections: boolean;
  beat: ListenerBeatWriter | undefined;
  handler: MentionHandler;
  log: ListenLog;
  onHello: (args: { connections: number }) => void;
  refuseResponder: ResponderRefusalHandler;
  responderHatchOpen: () => boolean;
  responderWhitelist: () => ResponderWhitelist;
  scope: ListenScope;
  self: { readonly botId: string | undefined; readonly userId: string | undefined };
  threadReplyChannels: readonly string[];
}): ListenDeps {
  return {
    allowMultipleConnections,
    handler,
    log,
    onHello,
    // Named explicitly, NOT spread from a conditional. A conditional spread — `...(beat === undefined ? {} :
    // { onSocketState: … })` — is exempt from excess-property checking, so when these two fields did not
    // exist on this function's parameter list the compiler accepted the call and dropped them silently. The
    // listener then beat forever in its startup `connecting` state, and every supervisor read went DOWN on a
    // healthy arm within 90 seconds. Keep them named so the checker is the thing that guarantees the wiring.
    ...(beat === undefined ? {} : { onSocketFrame: beat.noteFrame, onSocketState: beat.noteSocketState }),
    nowMs: () => Date.now(),
    openConnection: ({ signal, url }) => openSocketConnection({ signal, url }),
    openTicket: ({ appToken, signal }) => openSocketTicket({ appToken, ...(signal === undefined ? {} : { signal }) }),
    refuseResponder,
    responderHatchOpen,
    responderWhitelist,
    scope,
    ...(self.botId === undefined ? {} : { selfBotId: self.botId }),
    ...(self.userId === undefined ? {} : { selfUserId: self.userId }),
    threadReplyChannels,
    wait: liveChunkedWait,
  };
}

/**
 * Where the `listen:`-prefixed progress narration goes: stdout, exactly as `--emit --once` has always
 * printed it — UNLESS `--follow` or `--deadline-ms` is set, where it moves to stderr so stdout stays pure
 * (JSONL for `--follow`; exactly one discriminated object for a deadline wait) for a consumer parsing it.
 * Every other mode is untouched on purpose: this is the one seam either of those two is allowed to change.
 *
 * @returns the progress sink for the selected stdout/stderr mode
 */
export function progressLogFor({ deadlineMode, follow }: { deadlineMode: boolean; follow: boolean }): ListenLog {
  return follow || deadlineMode
    ? ({ line }) => {
        process.stderr.write(`listen: ${line}\n`);
      }
    : ({ line }) => {
        logger.out({ line: `listen: ${line}` });
      };
}

/**
 * Build the whole live {@link ListenDeps}: one shared transport, the capture handler, the refusal handler,
 * and this install's own `bot_id` — resolved via the transport's own cached `auth.test` (`whoAmI()`), so no
 * extra network round trip beyond what the transport already pays. `undefined` on a failed resolution rather
 * than throwing: the listener still starts, it just fails closed on every bot-authored event until this
 * install's identity is known (see `selfAuthoredCheck` in `../../../live/listen/mention.ts`).
 *
 * @returns the assembled live listener seams
 */
export async function buildLiveListenDeps({
  allowMultipleConnections,
  beat,
  botToken,
  deadlineMode,
  emit,
  follow,
  heartbeatArmId,
  home,
  json,
  progressLog,
  queuePath,
  responderHatchOpen,
  scope,
  supervisor,
  threadReplyChannels,
}: {
  allowMultipleConnections: boolean;
  beat: ListenerBeatWriter | undefined;
  botToken: string;
  deadlineMode: boolean;
  emit: boolean;
  follow: boolean;
  heartbeatArmId: string | undefined;
  home: string;
  json: boolean;
  progressLog: ListenLog;
  queuePath: string | undefined;
  responderHatchOpen: () => boolean;
  scope: ListenScope;
  supervisor: SupervisorSession | undefined;
  threadReplyChannels: readonly string[];
}): Promise<ListenDeps> {
  const transport = makeSlackWriteTransport({ home, token: botToken });
  // ONE loader, read per mention, so admission and the refusal reply never disagree after a `responders add`.
  const responderWhitelist = (): ResponderWhitelist => loadResponderWhitelist({ home });
  return liveDeps({
    allowMultipleConnections,
    beat,
    handler: capturingHandler({
      deadlineMode,
      emit,
      follow,
      home,
      json,
      log: progressLog,
      queuePath,
      supervisor,
      transport,
    }),
    log: progressLog,
    onHello: liveHelloRecorder({ armId: heartbeatArmId, home, progressLog }),
    refuseResponder: liveRefusalHandler({ home, progressLog, responderWhitelist, transport }),
    responderHatchOpen,
    responderWhitelist,
    scope,
    self: await resolveSelfIdentity({ progressLog, whoAmI: transport.whoAmI }),
    threadReplyChannels,
  });
}

/** The whitelist refusal's live effects: the door ledger and the fixed reply, over the shared transport. */
function liveRefusalHandler({
  home,
  progressLog,
  responderWhitelist,
  transport,
}: {
  home: string;
  progressLog: ListenLog;
  responderWhitelist: () => ResponderWhitelist;
  transport: SlackWriteTransport;
}): ResponderRefusalHandler {
  return responderRefusalHandler({
    deps: {
      doorLedger: doorLedgerPort(),
      home,
      log: progressLog,
      ownerUserId: () => ownerUserIdFromProfile({ home }),
      postReply: (args) => transport.postDripMessage(args),
      responderWhitelist,
      sendGates: DEFAULT_GATES,
    },
  });
}

/**
 * This install's own identity — `bot_id` and Slack USER id — via the transport's cached `auth.test`, or both
 * `undefined` if that call fails, degrading GRACEFULLY rather than crashing listener startup. Undefined fails
 * closed twice over, which is the safe direction in both cases: no `bot_id` refuses every bot-authored event
 * (see `selfAuthoredCheck`), and no user id refuses every direct message, because the DM's address test is
 * "does this text tag US" and a listener that does not know who it is cannot answer that.
 *
 * Both fields come from ONE call rather than two resolvers, because they are two fields of the same
 * `auth.test` response the transport already caches — splitting them would buy nothing and could report a
 * single failure twice.
 *
 * Takes only {@link SlackWriteTransport.whoAmI} rather than the whole transport, so a test can inject a
 * one-method fake instead of standing up every other write seam.
 *
 * @param progressLog where a failed resolution is narrated
 * @param whoAmI the transport's own cached `auth.test` call
 * @returns this install's own `bot_id` and user id, each `undefined` if it could not be resolved
 */
export async function resolveSelfIdentity({
  progressLog,
  whoAmI,
}: {
  progressLog: ListenLog;
  whoAmI: SlackWriteTransport["whoAmI"];
}): Promise<{ readonly botId: string | undefined; readonly userId: string | undefined }> {
  try {
    const self = await whoAmI();
    return { botId: self.botId, userId: self.userId };
  } catch (error) {
    // The narration itself must never be able to turn a caught, already-handled auth.test failure into an
    // uncaught rejection — a review pass found exactly that: an unguarded progressLog() here could throw and
    // escape past this catch, crashing listener startup over a LOGGING failure rather than the real one.
    try {
      progressLog({
        line:
          `could not resolve this install's own bot identity (auth.test failed: ${String(error)}) — every ` +
          "bot-authored event AND every direct message will be refused until a later connection resolves it",
      });
    } catch {
      // Swallowed deliberately: this function's contract is "never throws", and a failed narration is not
      // worth breaking that promise for.
    }
    return { botId: undefined, userId: undefined };
  }
}
