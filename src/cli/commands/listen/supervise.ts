/**
 * `slopweaver listen arm | status | reconcile | supervise | disarm` — how a visible loop session watches the
 * Slack listener it is itself running, and how ANY session accounts for a death nothing watched.
 *
 * ## The shape, and the ruling behind it
 *
 * The listener is ONE SHELL PROCESS INSIDE THE LOOP SESSION. It is not detached, it does not outlive that
 * session, and nothing in this file starts it. The rule: the Slack listener runs only while the
 * live loop runs in a Claude session, and if something kills the process the session says so and the owner
 * reruns it. A detached, session-leading process
 * reparented to launchd would be a daemon, which this repository refuses on purpose.
 *
 * So these verbs supply the two things the session cannot work out for itself, and nothing else:
 *
 * - **`arm`** composes the exact command to run, with a fresh arm id, and refuses when one is already live.
 * - **`status`** answers "is it live?" with a check that can actually FAIL — including the verdict a pidfile
 *   can never produce, `socket-down`: process in the table, socket gone.
 * - **`reconcile`** back-writes every death the journal IMPLIES but does not record, from durable state
 *   alone. It exists because a watcher cannot be the signal: measured three times over, the
 *   harness reaped the listener and the death-watch watching it in the same event, so nothing was alive to
 *   write the death down. Read-mostly, idempotent, and safe to tick from any session — see
 *   `../../../live/listen/supervise/reconcile.ts`.
 * - **`supervise`** is one death-watch tick. It reconciles first, counts the deaths, and answers re-arm or
 *   escalate. It hands back a command; the SESSION runs it.
 * - **`disarm`** clears the record. It sends no signal — the process belongs to the session, which stops it
 *   the way it stops anything else it is running.
 *
 * The division is deliberate: this code decides, the visible session acts. That keeps every process the
 * owner can see and interrupt, which is the property the whole arrangement exists to preserve.
 */
import { randomUUID } from "node:crypto";

import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { parseListenScope } from "../../../live/listen/scope.js";
import { currentLiveness, pidAlive } from "../../../live/listen/supervise/currentLiveness.js";
import { HEARTBEAT_INTERVAL_MS } from "../../../live/listen/supervise/heartbeat.js";
import { isListenerDown, type ListenerLiveness } from "../../../live/listen/supervise/liveness.js";
import { listenerReport } from "../../../live/listen/supervise/report.js";
import {
  appendListenerArmEvent,
  clearListenerArm,
  readListenerArm,
  readListenerArmEvents,
  readListenerHeartbeat,
} from "../../../live/listen/supervise/store.js";
import { listenerDisarmedEvent } from "../../../live/listen/supervise/streamEvents.js";
import { parseThreadReplyChannels } from "../../../live/listen/threadReply.js";
import { standingSessionLines } from "../../../live/standing/freshness.js";
import { productionStandingInspectDeps } from "../../../live/standing/inspect.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { loopFreshness } from "../session/standingFreshness.js";
import { planArm } from "./armPlan.js";
import { printArmPlan } from "./armReport.js";
import { listenReconcileCommand, type ReconcileOutcome } from "./listenReconcile.js";
import {
  livenessLine,
  parseListenReconcileArgs,
  publish,
  RECONCILE_SPEC,
  refuse,
  resolveTargets,
} from "./listenShared.js";
import { LISTEN_ARM_USAGE, LISTEN_DISARM_USAGE, LISTEN_STATUS_USAGE, LISTEN_SUPERVISE_USAGE } from "./listenUsage.js";
import { printOutcome, superviseTick } from "./superviseTick.js";

export { listenReconcileCommand, livenessLine, parseListenReconcileArgs, type ReconcileOutcome };

/** Where this family's own arguments start in `process.argv`: `[node, cli, listen, <verb>, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** How often the session should tick `supervise`. One beat interval — an outage is bounded to ~15s. */
export const SUPERVISE_TICK_MS = HEARTBEAT_INTERVAL_MS;

/** Each verb's flag spec, and the `--`-prefixed names derived from it for the help-truth ratchet. */
const ARM_SPEC: FlagSpec = {
  boolean: ["background", "dm-only", "json"],
  string: ["channels", "home", "queue", "thread-replies"],
};
const STATUS_SPEC: FlagSpec = { boolean: ["json"], string: ["home"] };
const SUPERVISE_SPEC: FlagSpec = { boolean: ["json"], string: ["home", "queue"] };
const DISARM_SPEC: FlagSpec = { boolean: [], string: ["home"] };

/** The `--`-prefixed names one spec accepts, sorted — one derivation, so a list cannot drift from a spec. */
function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted();
}

/** `listen arm`'s advertised flags, for the help-truth ratchet. */
export const LISTEN_ARM_FLAG_NAMES: readonly string[] = flagNames({ spec: ARM_SPEC });
/** `listen status`'s advertised flags, for the help-truth ratchet. */
export const LISTEN_STATUS_FLAG_NAMES: readonly string[] = flagNames({ spec: STATUS_SPEC });
/** `listen supervise`'s advertised flags, for the help-truth ratchet. */
export const LISTEN_SUPERVISE_FLAG_NAMES: readonly string[] = flagNames({ spec: SUPERVISE_SPEC });
/** `listen reconcile`'s advertised flags, for the help-truth ratchet. */
export const LISTEN_RECONCILE_FLAG_NAMES: readonly string[] = flagNames({ spec: RECONCILE_SPEC });
/** `listen disarm`'s advertised flags, for the help-truth ratchet. */
export const LISTEN_DISARM_FLAG_NAMES: readonly string[] = flagNames({ spec: DISARM_SPEC });

/**
 * Parse `listen arm`'s flags. Exported so the help-truth ratchet pushes every advertised flag through the
 * REAL parser rather than comparing two declarations with each other.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or every rejection
 */
export function parseListenArmArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: ARM_SPEC });
}

/**
 * Parse `listen status`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or every rejection
 */
export function parseListenStatusArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: STATUS_SPEC });
}

/**
 * Parse `listen supervise`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or every rejection
 */
export function parseListenSuperviseArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: SUPERVISE_SPEC });
}

/**
 * Parse `listen disarm`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or every rejection
 */
export function parseListenDisarmArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: DISARM_SPEC });
}

/**
 * `slopweaver listen arm` — print the command the visible session runs.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export const listenArmCommand = defineCommand({
  run: (argv) => {
    const parsed = parseListenArmArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      return refuse({ errors: parsed.error, usage: LISTEN_ARM_USAGE });
    }
    const { home, queuePath } = resolveTargets({
      homeFlag: parsed.value.values["home"],
      queueFlag: parsed.value.values["queue"],
    });
    const scope = parseListenScope({
      channelsFlag: parsed.value.values["channels"],
      dmOnly: parsed.value.values["dm-only"] === true,
    });
    if (scope.isErr()) {
      return refuse({ errors: scope.error, usage: LISTEN_ARM_USAGE });
    }
    const threadReplies = parseThreadReplyChannels({ flag: parsed.value.values["thread-replies"] });
    if (threadReplies.isErr()) {
      return refuse({ errors: threadReplies.error, usage: LISTEN_ARM_USAGE });
    }
    const existing = readListenerArm({ home });
    if (existing.isErr()) {
      logger.error({ msg: existing.error.message });
      return EXIT_ERROR;
    }
    const plan = planArm({
      armId: randomUUID().slice(0, 8),
      background: parsed.value.values["background"] === true,
      existing: existing.value,
      existingAlive: existing.value !== undefined && pidAlive({ pid: existing.value.pid }),
      home,
      queuePath,
      scope: scope.value,
      threadReplyChannels: threadReplies.value,
    });
    if (plan.isErr()) {
      logger.error({ msg: `${plan.error.message}; run \`slopweaver listen disarm\` first` });
      return EXIT_EXPECTED_EMPTY;
    }
    printArmPlan({
      home,
      json: parsed.value.values["json"] === true,
      nowMs: Date.now(),
      plan: plan.value,
    });
    return EXIT_OK;
  },
});

/**
 * `slopweaver listen status` — report the liveness verdict.
 *
 * Exits {@link EXIT_EXPECTED_EMPTY} when the listener is DOWN: a diagnostic that found a fault ran
 * correctly, and this verb is declared `diagnostic` for exactly that reason.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export const listenStatusCommand = defineCommand({
  run: (argv) => {
    const parsed = parseListenStatusArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      return refuse({ errors: parsed.error, usage: LISTEN_STATUS_USAGE });
    }
    const { home } = resolveTargets({ homeFlag: parsed.value.values["home"], queueFlag: undefined });
    const nowMs = Date.now();
    const { liveness, problems } = currentLiveness({ home, nowMs });
    // Which COMMIT the loop is on is reported here as well as by `session standing`, because this is the verb
    // the loop's own maintenance tick already calls: a gauge the loop has to remember to call separately is a
    // gauge that goes unread, which is the whole failure in `live/standing/freshness.ts`'s header.
    const fresh = loopFreshness({
      deps: productionStandingInspectDeps(),
      fallbackBin: undefined,
      pid: "pid" in liveness ? liveness.pid : undefined,
    });
    const allProblems = [...problems, ...fresh.problems];
    printListenStatus({
      asJson: parsed.value.values["json"] === true,
      fresh,
      home,
      liveness,
      nowMs,
      problems: allProblems,
    });
    // A STALE loop exits 3 exactly as a DOWN one does, and for the same reason: `listen status || <act>` is the
    // whole idiom, and a loop applying none of today's fixes is not a loop that should read as fine.
    return isListenerDown({ liveness }) || fresh.freshness?.grade === "stale" ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  },
});

/**
 * Print `listen status` in whichever shape the caller asked for — split out of the verb so the branchiness of
 * two renderings does not sit inside the one function that decides the exit code.
 *
 * @param asJson whether the caller passed `--json`
 * @param fresh the loop's measured tree freshness, and whatever could not be read
 * @param home the resolved state home, for the three record reads the JSON report needs
 * @param liveness the already-judged verdict
 * @param nowMs the instant the verdict was taken
 * @param problems every signal problem, from both the liveness read and the freshness measurement
 */
function printListenStatus({
  asJson,
  fresh,
  home,
  liveness,
  nowMs,
  problems,
}: {
  asJson: boolean;
  fresh: ReturnType<typeof loopFreshness>;
  home: string;
  liveness: ListenerLiveness;
  nowMs: number;
  problems: readonly string[];
}): void {
  if (asJson) {
    printListenStatusJson({ fresh, home, liveness, nowMs, problems });
    return;
  }
  logger.out({ line: livenessLine({ liveness }) });
  for (const line of threadReplyLines({ home })) {
    logger.out({ line });
  }
  const freshnessLines = fresh.freshness === undefined ? [] : standingSessionLines({ freshness: fresh.freshness });
  for (const line of freshnessLines) {
    logger.out({ line });
  }
  for (const problem of problems) {
    logger.out({ line: `  signal problem: ${problem}` });
  }
}

/**
 * The `--json` rendering: the supervisor's whole report, assembled from the three records on disk.
 *
 * @param fresh the loop's measured tree freshness, and whatever could not be read
 * @param home the resolved state home, for the three record reads the report needs
 * @param liveness the already-judged verdict
 * @param nowMs the instant the verdict was taken
 * @param problems every signal problem, from both the liveness read and the freshness measurement
 */
function printListenStatusJson({
  fresh,
  home,
  liveness,
  nowMs,
  problems,
}: {
  fresh: ReturnType<typeof loopFreshness>;
  home: string;
  liveness: ListenerLiveness;
  nowMs: number;
  problems: readonly string[];
}): void {
  const arm = readListenerArm({ home });
  const heartbeat = readListenerHeartbeat({ home });
  const events = readListenerArmEvents({ home });
  const report = listenerReport({
    arm: arm.isOk() ? arm.value : undefined,
    events: events.isOk() ? events.value : [],
    heartbeat: heartbeat.isOk() ? heartbeat.value : undefined,
    liveness,
    nowMs,
    why: livenessLine({ liveness }),
  });
  logger.out({ line: JSON.stringify({ ...report, freshness: fresh.freshness, problems }) });
}

/**
 * The human rendering's thread-reply line, or NOTHING when the feature is off.
 *
 * Thread-reply addressing changes what COUNTS as an address, so a reader asking "what is this listener
 * doing" has to be able to see it — before this line the only witness was the running process's argv.
 * Empty when none are on, because silence is the honest rendering of off: a "none" line on every healthy
 * check is the kind of noise that trains a reader to skim past the block it sits in.
 *
 * @param home the resolved state home the arm record lives under
 * @returns the one line to print, or no lines at all
 */
function threadReplyLines({ home }: { home: string }): readonly string[] {
  const armed = readListenerArm({ home });
  const channels = armed.isOk() && armed.value !== undefined ? armed.value.threadReplyChannels : [];
  if (channels.length === 0) {
    return [];
  }
  return [`  thread replies: answering replies under the bot's own posts in ${channels.join(", ")}`];
}

/**
 * `slopweaver listen supervise` — one death-watch tick.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export const listenSuperviseCommand = defineCommand({
  run: (argv) => {
    const parsed = parseListenSuperviseArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      return refuse({ errors: parsed.error, usage: LISTEN_SUPERVISE_USAGE });
    }
    const { home, queuePath } = resolveTargets({
      homeFlag: parsed.value.values["home"],
      queueFlag: parsed.value.values["queue"],
    });
    const outcome = superviseTick({ home, queuePath });
    printOutcome({ json: parsed.value.values["json"] === true, outcome });
    return outcome.action === "escalate" || outcome.action === "held" ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  },
});

/**
 * `slopweaver listen disarm` — clear the record.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export const listenDisarmCommand = defineCommand({
  run: (argv) => {
    const parsed = parseListenDisarmArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      return refuse({ errors: parsed.error, usage: LISTEN_DISARM_USAGE });
    }
    const { home } = resolveTargets({ homeFlag: parsed.value.values["home"], queueFlag: undefined });
    const arm = readListenerArm({ home });
    if (arm.isErr()) {
      logger.error({ msg: arm.error.message });
      return EXIT_ERROR;
    }
    if (arm.value === undefined) {
      logger.out({ line: "nothing armed" });
      return EXIT_OK;
    }
    const disarmedAtIso = new Date().toISOString();
    appendListenerArmEvent({
      event: { armId: arm.value.armId, atIso: disarmedAtIso, kind: "disarmed", pid: arm.value.pid },
      home,
    });
    publish({
      event: listenerDisarmedEvent({ armId: arm.value.armId, atIso: disarmedAtIso, pid: arm.value.pid }),
      home,
    });
    const cleared = clearListenerArm({ home });
    if (cleared.isErr()) {
      logger.error({ msg: cleared.error.message });
      return EXIT_ERROR;
    }
    logger.out({
      line: `cleared arm ${arm.value.armId} (pid ${String(arm.value.pid)}) — stop the process in the session that runs it`,
    });
    return EXIT_OK;
  },
});
