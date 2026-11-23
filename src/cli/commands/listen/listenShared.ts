/**
 * Helpers `supervise.ts`, `superviseTick.ts` and `listenReconcile.ts` need, split out so none imports another
 * for them — `superviseTick.ts`'s `superviseTick` calls `listenReconcile.ts`'s `reconcileTick`, so a shared
 * dependency living in either of those two files would be a circular import.
 */
import { slopweaverHome } from "../../../config.js";
import type { SupervisorEvent } from "../../../events/event.js";
import { publishSupervisorEvent } from "../../../events/store.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { ListenerLiveness } from "../../../live/listen/supervise/liveness.js";
import type { ListenerDeathReason } from "../../../live/listen/supervise/rearm.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

/** `listen reconcile`'s flag spec. */
export const RECONCILE_SPEC: FlagSpec = { boolean: ["json"], string: ["home"] };

/**
 * Parse `listen reconcile`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or every rejection
 */
export function parseListenReconcileArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: RECONCILE_SPEC });
}

/**
 * One line of English for a verdict — what `status` prints and what `supervise` narrates.
 *
 * Every DOWN verdict leads with the literal word `DOWN`, so a human scanning a long log finds the outages
 * without reading each line's grammar. `starting`, `reconnecting` and `unarmed` deliberately do not.
 *
 * @param liveness the verdict to render
 * @returns the one line to print
 */
export function livenessLine({ liveness }: { liveness: ListenerLiveness }): string {
  switch (liveness.state) {
    case "unarmed":
      return "unarmed — no listener is running. A tag arriving now is a no-op BY DESIGN.";
    case "starting":
      return `starting — arm ${liveness.armId} (pid ${String(liveness.pid)}) is ${String(Math.round(liveness.armAgeMs / 1000))}s old and has not beaten yet`;
    case "process-dead":
      return `DOWN process-dead — arm ${liveness.armId} pid ${String(liveness.pid)} is gone from the process table`;
    case "heartbeat-missing":
      return `DOWN heartbeat-missing — arm ${liveness.armId} pid ${String(liveness.pid)} is alive but has never written a beat in ${String(Math.round(liveness.armAgeMs / 1000))}s`;
    case "heartbeat-foreign":
      return `DOWN heartbeat-foreign — the newest beat belongs to arm ${liveness.heartbeatArmId}, not the supervised arm ${liveness.armId}`;
    case "heartbeat-stale":
      return `DOWN heartbeat-stale — arm ${liveness.armId} pid ${String(liveness.pid)} last beat ${String(Math.round(liveness.ageMs / 1000))}s ago`;
    case "reconnecting":
      return `reconnecting — arm ${liveness.armId} pid ${String(liveness.pid)} has been off the socket for ${String(Math.round(liveness.socketDownMs / 1000))}s, still inside the backoff a normal reconnect takes`;
    case "socket-down":
      return `DOWN socket-down — arm ${liveness.armId} pid ${String(liveness.pid)} is alive and beating, but its Socket Mode connection has been down for ${String(Math.round(liveness.socketDownMs / 1000))}s`;
    case "healthy":
      return `healthy — arm ${liveness.armId} pid ${String(liveness.pid)}, beat ${String(Math.round(liveness.ageMs / 1000))}s ago, socket connected`;
  }
}

/**
 * The death a verdict describes — reason plus the arm it happened to — or `undefined` when it is not one.
 *
 * @param liveness the verdict to classify
 * @returns the death it describes, or `undefined` for a non-death verdict
 */
export function deathOf({
  liveness,
}: {
  liveness: ListenerLiveness;
}): { readonly reason: ListenerDeathReason; readonly armId: string; readonly pid: number } | undefined {
  switch (liveness.state) {
    case "process-dead":
    case "heartbeat-missing":
    case "heartbeat-foreign":
    case "heartbeat-stale":
    case "socket-down":
      return { armId: liveness.armId, pid: liveness.pid, reason: liveness.state };
    case "unarmed":
    case "starting":
    case "reconnecting":
    case "healthy":
      return undefined;
  }
}

/**
 * Print every rejection plus the usage line, and return the usage exit code.
 *
 * @param errors every rejection to print
 * @param usage the verb's usage line
 * @returns the usage exit code, {@link EXIT_USAGE}
 */
export function refuse({ errors, usage }: { errors: readonly string[]; usage: string }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * Resolve `--home` and `--queue` the same way for every verb in this family.
 *
 * @param homeFlag the raw `--home` flag value
 * @param queueFlag the raw `--queue` flag value
 * @returns the resolved home and queue path
 */
export function resolveTargets({ homeFlag, queueFlag }: { homeFlag: unknown; queueFlag: unknown }): {
  readonly home: string;
  readonly queuePath: string;
} {
  const home = typeof homeFlag === "string" && homeFlag.length > 0 ? homeFlag : slopweaverHome();
  const queuePath =
    typeof queueFlag === "string" && queueFlag.length > 0
      ? queueFlag
      : stateHomePaths({ home }).live.listener.queueJsonl;
  return { home, queuePath };
}

/**
 * Publish one event onto the supervisor stream, narrating a failure rather than letting it sink the tick.
 *
 * The death-watch is real work and the stream is a notification bolted beside it: a tick that refused to
 * journal a death because a notification file was unwritable would be strictly worse than one that carried on
 * and said so.
 */
export function publish({ event, home }: { event: SupervisorEvent; home: string }): void {
  const failure = publishSupervisorEvent({ event, home });
  if (failure !== undefined) {
    logger.error({ msg: `listen supervise: ${failure}` });
  }
}
