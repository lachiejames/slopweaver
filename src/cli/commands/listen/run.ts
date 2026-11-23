/**
 * `slopweaver listen` — open Socket Mode, turn a tag into a typed mention, hand it to a handler.
 *
 * ## The shape, and what belongs to whom
 *
 * This module is the verb's argv-parsing entry point: it resolves the two credentials, refuses loudly when
 * either is missing or `profile.json` is there but corrupt (a fault, exit 1 — see `live/listen/preflight.ts`
 * for why that file alone stops the listener), and hands off to {@link ../../../cli/commands/listen/runLoop.js}'s `startListening` for
 * everything from there — assembling the live seams, arming supervision, driving the socket to completion.
 * The responder-refusal handler lives in {@link ./responderRefusal.js}; the EMIT-ONLY handler and its
 * deadline-mode stdout shapes live in {@link ./emit.js}. Every decision any of them makes is made by a pure
 * function it imports — the frame grammar, the mention parse, the redelivery window and the reconnect plan
 * all live under `src/live/listen` and are tested there without a socket.
 *
 * The seams (`openTicket`, `openConnection`, `wait`, `handler`, `log`) are injected through `ListenDeps` so
 * the connect/disconnect/reconnect loop — the part with the interesting failure modes — is exercised by
 * the tests under `src/__tests__/unit/cli/commands/listen/run/` with plain fakes and no network.
 *
 * ## The handler EMITS; it no longer answers, and cannot
 *
 * It used to answer, via `turnHandler` over a `claudeCliClient` — a DETACHED `claude -p` child. So this
 * listener's good answers came from a headless model running outside any session the owner could watch.
 *
 * That is the one thing this verb no longer does. It captures an addressed mention, prints it, and stops
 * per mention — see {@link ./emit.js}'s `emitOnly`. The turn happens in a visible session: for a human-driven
 * single turn, `listen --once --emit --json`, then the session's own turn, then repeat by hand. `turnHandler`
 * was DELETED rather than left unused, because an unused answering path is one import away from being an
 * answering path again.
 *
 * ## `--follow` is the continuous drain loop's control plane, and it never drops a mention
 *
 * `--once` is for a human-driven single turn. `--follow` is for the standing drain loop
 * (`skills/loop/SKILL.md`): the connection stays open, reconnecting on its own schedule, and EVERY admitted
 * mention is emitted in order — the listener never waits for the calling session to act on one before
 * reading the next. `--queue <path>` durably fsyncs each one to JSONL underneath that stream as a
 * crash-recovery copy, never a second trigger path. What actually decides an ask's tier now lives entirely
 * downstream, in `turn brief`/`turn dispatch` — this verb's own job stops at capturing and handing off.
 *
 * `stubAcknowledgeHandler` is kept exported and tested. It is the smallest thing that proves the transport
 * reaches Slack at all, which is exactly what you want when a turn misbehaves and the question is whether
 * the socket or the session is at fault.
 *
 * ## Foreground, and NOT a daemon — this one is settled
 *
 * This runs in the terminal until Ctrl-C, and the question of whether something should supervise and restart
 * it has been answered: no. There is no resident listener. A tag arriving when NOTHING is running
 * — no listener process at all — is a no-op BY DESIGN, not a dropped message queued for later. With a
 * `--follow` listener actually running, a tag IS captured and durably recorded even while no turn is yet
 * answering it; see `capturingHandler.js`'s `capturingHandler` for the exact order that guarantees.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { slackAppToken, slackBotToken, slopweaverHome } from "../../../config.js";
import { renderConnectJson, renderConnectText } from "../../../connect/render.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type CapturedChecklistDeps,
  type CapturedLifecycleDeps,
  type CaptureReactionDeps,
  type ChecklistPostedLifecycleDeps,
  type IgnoreCheckDeps,
  withCapturedChecklist,
  withCapturedLifecycle,
  withCaptureReaction,
  withChecklistPostedLifecycle,
  withIgnoreCheck,
} from "../../../live/listen/capture.js";
import { ALLOW_MULTIPLE_SOCKET_CONNECTIONS_ENV } from "../../../live/listen/connections.js";
import { type EmittedMention, emittedMention } from "../../../live/listen/handoff.js";
import type { MentionHandler } from "../../../live/listen/mention.js";
import { listenPreflight } from "../../../live/listen/preflight.js";
import { responderHatchOpenNow } from "../../../live/listen/responderHatch.js";
import { type ListenScope, parseListenScope } from "../../../live/listen/scope.js";
import type { ListenLog } from "../../../live/listen/socket.js";
import { parseThreadReplyChannels } from "../../../live/listen/threadReply.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import type { WitnessIdentityError, WitnessStateError } from "../../../live/listen/witnessErrors.js";
import { readProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  acknowledgementText,
  type ListenOptions,
  listenOptions,
  parseListenArgs,
  validateDeadlineMode,
  validateHeartbeatMode,
  validateListenModes,
} from "./core.js";
import { listenErrorLines } from "./errors.js";
import { LISTEN_USAGE } from "./listenUsage.js";
import { startListening } from "./runLoop.js";
import { loadWitnessSetup, type WitnessSetup } from "./witnessWiring.js";

export type {
  CapturedChecklistDeps,
  CapturedLifecycleDeps,
  CaptureReactionDeps,
  ChecklistPostedLifecycleDeps,
  EmittedMention,
  IgnoreCheckDeps,
};
/**
 * Re-exported so every existing caller/test importing these names from `run.js` is unaffected by their move
 * to the shared `../../../live/listen/capture.js` and `../../../live/listen/handoff.js` modules — see
 * `capturingHandler.js`'s `capturingHandler` for its own header.
 */
export {
  emittedMention,
  withCapturedChecklist,
  withCapturedLifecycle,
  withCaptureReaction,
  withChecklistPostedLifecycle,
  withIgnoreCheck,
};

/** Drop a leading `run` so bare `listen` and explicit `listen run` parse identically. */
function verbTail({ argv }: { argv: readonly string[] }): readonly string[] {
  const rest = argv.slice(3);
  return rest[0] === "run" ? rest.slice(1) : rest;
}

/**
 * The home the acknowledgement's transport judges high-stakes channels by: the lane's own, or the resolved
 * default for `null`. An early return, for the reason `resolveHome` (`cli/optionParsers.ts`) gives: oxlint
 * refuses the ternary spelling and `no-silent-fallback` refuses `??`.
 */
function transportHomeOf({ home }: { home: string | null }): string {
  if (home === null) {
    return slopweaverHome();
  }
  return home;
}

/**
 * The stub handler: ONE acknowledgement, posted through the admit door like every other outbound write.
 *
 * It reuses the existing Slack write transport rather than adding a send path — the same non-retrying,
 * at-most-once posting client every other message in this program goes out through.
 *
 * @param doorLedger where the door's decision is recorded before the acknowledgement is posted
 * @param home the state home the door records the decision under, `null` for the resolved default home — the
 *   door's own spelling (`DoorMeta.home`)
 * @param token the bot token the acknowledgement posts as
 * @param log where the outcome is narrated
 * @returns the handler
 */
export function stubAcknowledgeHandler({
  doorLedger,
  home,
  token,
  log,
}: {
  doorLedger: DoorLedgerPort;
  home: string | null;
  token: string;
  log: ListenLog;
}): MentionHandler {
  const transport = makeSlackWriteTransport({ home: transportHomeOf({ home }), token });
  return async (mention) => {
    const text = acknowledgementText({ userId: mention.userId });
    const routed = await throughDoor({
      gates: DEFAULT_GATES,
      ledger: doorLedger,
      perform: () =>
        transport.postDripMessage({
          channel: mention.channel,
          payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
          threadTs: mention.threadTs,
        }),
      request: {
        action: { kind: "verb", noun: "listen", verb: "acknowledge" },
        artifact: { channel: mention.channel, chars: text.length, threadTs: mention.threadTs },
        meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
      },
      ...(home !== null ? { home } : {}),
    });
    if (!routed.performed) {
      for (const line of notPerformedLines({ command: "posting the acknowledgement", through: routed })) {
        log({ line });
      }
      return;
    }
    log({ line: `acknowledged in ${routed.result.channel} thread ${mention.threadTs} (ts ${routed.result.ts})` });
  };
}

/** Print the credential report in whichever form was asked for. */
function reportCredentials({ json, report }: { json: boolean; report: ReturnType<typeof listenPreflight> }): void {
  if (json) {
    logger.out({ line: renderConnectJson({ report }) });
    return;
  }
  for (const line of renderConnectText({ heading: "listen", report })) {
    logger.out({ line });
  }
}

/** Print every rejection plus the usage line, and refuse. Shared by every way `runListen` can reject argv. */
function refuseListen({ errors }: { errors: readonly string[] }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  logger.error({ msg: LISTEN_USAGE });
  return EXIT_USAGE;
}

/**
 * Parse and validate everything about the argv, or return every rejection — the whole I/O-free half of the
 * verb, separated so `runListen` itself is the effectful shell and nothing else.
 *
 * The three validators run in a fixed order and each short-circuits: mode conflicts before `--deadline-ms`
 * (which is defined in terms of the modes), and `--heartbeat` last, because it is defined in terms of the
 * FOLDED options rather than the raw flags.
 *
 * @param rest the argv after the noun
 * @returns the resolved deadline and options, or every rejection
 */
function acceptListenArgs({ rest }: { rest: readonly string[] }): Result<{
  readonly deadlineMs: number | undefined;
  readonly options: ListenOptions;
  readonly scope: ListenScope;
  readonly threadReplyChannels: readonly string[];
}> {
  const parsed = parseListenArgs({ rest });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const modes = validateListenModes({
    follow: parsed.value.values["follow"] === true,
    once: parsed.value.values["once"] === true,
  });
  if (modes.isErr()) {
    return err(listenErrorLines({ error: modes.error }));
  }
  const deadline = validateDeadlineMode({ parsed: parsed.value });
  if (deadline.isErr()) {
    return err(listenErrorLines({ error: deadline.error }));
  }
  const options = listenOptions({ parsed: parsed.value });
  const heartbeatMode = validateHeartbeatMode({ follow: options.follow, heartbeatArmId: options.heartbeatArmId });
  if (heartbeatMode.isErr()) {
    return err(listenErrorLines({ error: heartbeatMode.error }));
  }
  const scope = parseListenScope({
    channelsFlag: parsed.value.values["channels"],
    dmOnly: parsed.value.values["dm-only"] === true,
  });
  if (scope.isErr()) {
    return err(scope.error);
  }
  const threadReplies = parseThreadReplyChannels({ flag: parsed.value.values["thread-replies"] });
  if (threadReplies.isErr()) {
    return err(threadReplies.error);
  }
  return ok({
    deadlineMs: deadline.value,
    options,
    scope: scope.value,
    threadReplyChannels: threadReplies.value,
  });
}

/**
 * The witness setup and the preflight report that names its bots. Witnessing runs under `--follow` only, so a
 * one-shot listener never reads its config or state: a broken witness snapshot must not stop a turn that would
 * never witness anything. `--check` still reads it, to report it.
 */
function witnessAndPreflight({
  checks,
  home,
  read,
}: {
  checks: Omit<Parameters<typeof listenPreflight>[0], "witness">;
  home: string;
  read: boolean;
}): {
  readonly report: ReturnType<typeof listenPreflight>;
  readonly witness: Result<WitnessSetup | undefined, WitnessIdentityError | WitnessStateError>;
} {
  const witness: Result<WitnessSetup | undefined, WitnessIdentityError | WitnessStateError> = read
    ? loadWitnessSetup({
        home,
        profile: checks.profile.isOk() ? checks.profile.value : null,
        warn: ({ line }) => {
          logger.error({ msg: line });
        },
      })
    : ok(undefined);
  const bots = witness.map((setup) => (setup === undefined ? [] : setup.bots));
  return { report: listenPreflight({ ...checks, witness: bots }), witness };
}

/** Report the preflight and say why the listener will not start: broken configuration, never a prerequisite. */
function refuseStart({
  json,
  problem,
  report,
}: {
  json: boolean;
  problem: string;
  report: ReturnType<typeof listenPreflight>;
}): number {
  reportCredentials({ json, report });
  logger.error({ msg: `listen: will not start — ${problem}` });
  return EXIT_ERROR;
}

/**
 * `slopweaver listen` — the verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runListen(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LISTEN_USAGE });
    return EXIT_OK;
  }
  const accepted = acceptListenArgs({ rest });
  if (accepted.isErr()) {
    return refuseListen({ errors: accepted.error });
  }
  const { deadlineMs, options, scope, threadReplyChannels } = accepted.value;
  const home = resolveHome({ named: options.home });
  const appToken = slackAppToken({ home });
  const botToken = slackBotToken({ home });
  const responderWhitelist = loadResponderWhitelist({ home });
  const responderHatchOpen = (): boolean => responderHatchOpenNow({ home });
  const profile = readProfile({ home });
  const { report, witness } = witnessAndPreflight({
    checks: { appToken, botToken, profile, responderAllowOpen: responderHatchOpen(), responderWhitelist },
    home,
    read: options.follow || options.check,
  });
  if (options.check) {
    reportCredentials({ json: options.json, report });
    return report.ok ? EXIT_OK : EXIT_EXPECTED_EMPTY;
  }
  // Before the token branch, so a corrupt profile is never reported as a prerequisite absent: it is broken
  // configuration someone has to fix, and the listener stops rather than capture on defaults nobody chose.
  if (profile.isErr()) {
    return refuseStart({ json: options.json, problem: profile.error.message, report });
  }
  // Configured witnessing that cannot name exactly one bot, or whose snapshot is corrupt, is broken
  // configuration too — the listener stops rather than witness the wrong thread or forget every witnessed one.
  if (witness.isErr()) {
    return refuseStart({ json: options.json, problem: witness.error.message, report });
  }
  if (!report.ok || appToken === undefined || botToken === undefined) {
    reportCredentials({ json: options.json, report });
    // A prerequisite absent is not a fault: the verb ran correctly and reported what is missing.
    return EXIT_EXPECTED_EMPTY;
  }
  return startListening({
    allowMultipleConnections: process.env[ALLOW_MULTIPLE_SOCKET_CONNECTIONS_ENV] === "1",
    appToken,
    botToken,
    deadlineMs,
    emit: options.emit,
    follow: options.follow,
    heartbeatArmId: options.heartbeatArmId,
    home,
    json: options.json,
    once: options.once,
    queuePath: options.queuePath,
    responderHatchOpen,
    responderWhitelist,
    scope,
    threadReplyChannels,
    witness: witness.value,
  });
}

export const listenCommand = defineCommand({ run: runListen });
