/**
 * `slopweaver listen`'s one mention handler: the emit-only sink with every capture-time wrapper composed around
 * it, plus the `--queue` durability wrapper.
 *
 * Split out of {@link ./runLoop.js} (the file-size ratchet). {@link capturingHandler} is what
 * `./liveListenDeps.ts` hands the loop; the shared capture-time UX it composes (ignore-check,
 * captured/checklist-posted lifecycle, capture reaction, the checklist/status post) lives in
 * `../../../live/listen/capture.ts`.
 */

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import {
  withCapturedChecklist,
  withCapturedLifecycle,
  withCaptureReaction,
  withChecklistPostedLifecycle,
  withIgnoreCheck,
} from "../../../live/listen/capture.js";
import { emittedMention } from "../../../live/listen/handoff.js";
import type { MentionHandler } from "../../../live/listen/mention.js";
import { appendQueueLine } from "../../../live/listen/queueFile.js";
import type { ListenLog } from "../../../live/listen/socket.js";
import type { SupervisorSession } from "../../../supervisor/session.js";
import { emitOnly } from "./emit.js";
import { liveCaptureDeps } from "./liveCapture.js";

/**
 * Wrap a handler so every mention is ALSO appended to the queue file — the durability path `--queue`
 * builds. The queue line is always the canonical `EmittedMention` JSON (`live/listen/handoff.ts`), independent
 * of whatever stdout happens to be printing: a session recovering from the queue file needs the machine shape
 * every time, not whatever `--json`/`--follow` decided for the terminal.
 *
 * @param handler the handler to wrap; this changes nothing about what it does or when
 * @param queuePath the queue file's path
 * @param appendLine the queue-file append edge, injected so a test never touches a real file
 * @returns the wrapped handler
 */
export function withQueueFile({
  handler,
  queuePath,
  appendLine,
}: {
  handler: MentionHandler;
  queuePath: string;
  appendLine: (args: { path: string; line: string }) => void;
}): MentionHandler {
  return async (mention) => {
    appendLine({ line: JSON.stringify(emittedMention({ mention })), path: queuePath });
    await handler(mention);
  };
}

/**
 * Build the innermost mention handler: emit to stdout, JSON when `emitJson`, readable lines otherwise.
 * `withQueueFile`/`withCaptureReaction`/`withCapturedChecklist` wrap this from OUTSIDE now, in
 * {@link capturingHandler} — durability and Slack UI effects are no longer this function's concern.
 *
 * @param emitJson whether stdout prints the mention as JSON
 * @param wrapped whether the stdout JSON gets the `{"kind":"slack-address",...}` deadline-mode envelope
 * @returns the innermost handler {@link capturingHandler} wraps
 */
function buildHandler({ emitJson, wrapped }: { emitJson: boolean; wrapped: boolean }): MentionHandler {
  return emitOnly({
    json: emitJson,
    sink: ({ line }) => {
      logger.out({ line });
    },
    wrapped,
  });
}

/**
 * The one handler this verb has, with every capture-time wrapper composed around it in the order that
 * order is the entire feature:
 *
 * `ignore-check` → `captured-lifecycle` → `queue-file` → `capture-reaction` → `captured-checklist` →
 * `checklist-posted-lifecycle` → `emit`.
 *
 * A permanently-ignored ask is dropped before anything else happens at all. Past that, the ONE
 * deterministic fact — that the listener saw this exact ask — lands in the ask-lifecycle log, then the
 * queue file, BEFORE either Slack UI effect: a crash between "saw it" and "reacted to it" must never lose
 * the durable record, which it would if durability sat behind a Slack write that could itself fail. The
 * reaction fires next because it is near-instant; the checklist and status follow right after it, before
 * any turn work runs, so the two-minute silence the owner measured between the reaction and the working
 * message never happens again. `checklist-posted-lifecycle` durably records the SAME `{turnId, workingTs}`
 * the checklist post just minted, so a `turn brief` call that never received it on stdin/argv can still
 * recover it. Emit is last: it is what the calling session actually reads.
 *
 * EMIT-ONLY is the only handler there is. `--emit` does not select it — it is what this verb does now — it
 * selects the JSON shape and implies `--once` (unless `--follow` overrides it). There is deliberately no
 * branch here that could answer. `--follow` forces JSON regardless of `--emit`/`--json`: the whole point of
 * continuous mode is a machine-parseable stream, so there is no readable-lines variant of it.
 *
 * @param emit whether the mention is emitted as JSON
 * @param follow whether the listener stays connected across mentions
 * @param home the state home the reaction emoji, chrome and ignore/lifecycle logs are configured in
 * @param json whether output is machine-readable
 * @param log where a failure is reported that did not let anything stop the turn
 * @param queuePath the durability file a captured mention is appended to, when one was asked for
 * @param transport the Slack write transport this listener shares with the responder-refusal reply
 * @returns the wrapped handler
 */
export function capturingHandler({
  deadlineMode,
  emit,
  follow,
  home,
  json,
  log,
  queuePath,
  supervisor,
  transport,
}: {
  deadlineMode: boolean;
  emit: boolean;
  follow: boolean;
  home: string;
  json: boolean;
  log: ListenLog;
  queuePath: string | undefined;
  supervisor: SupervisorSession | undefined;
  transport: SlackWriteTransport;
}): MentionHandler {
  const { checklist, reaction } = liveCaptureDeps({ doorLedger: doorLedgerPort(), home, log, supervisor, transport });
  const withSlackEffects = withCaptureReaction({
    deps: reaction,
    handler: withCapturedChecklist({
      deps: checklist,
      handler: withChecklistPostedLifecycle({
        deps: { home, log },
        handler: buildHandler({ emitJson: follow || (emit && json), wrapped: deadlineMode }),
      }),
    }),
  });
  const withDurability =
    queuePath === undefined
      ? withSlackEffects
      : withQueueFile({ appendLine: appendQueueLine, handler: withSlackEffects, queuePath });
  return withIgnoreCheck({
    deps: { home, log },
    handler: withCapturedLifecycle({ deps: { home, log }, handler: withDurability }),
  });
}
