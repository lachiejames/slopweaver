/**
 * `slopweaver listen reconcile` — back-write every listener death the arm journal implies but never recorded,
 * from durable state alone. Split out of `supervise.ts` (which still owns `arm`/`status`/`supervise`/`disarm`)
 * purely to keep that file under the file-size ratchet's cap; the death-watch reasoning this verb exists for
 * is documented on `supervise.ts`'s own file header.
 */
import { logger } from "../../../lib/logger.js";
import { currentLiveness } from "../../../live/listen/supervise/currentLiveness.js";
import type { ListenerLiveness } from "../../../live/listen/supervise/liveness.js";
import { type ListenerArmEvent, REARM_WINDOW_MS } from "../../../live/listen/supervise/rearm.js";
import {
  deathLowerBoundIso,
  type ObservedListenerDeath,
  reconciledDeaths,
} from "../../../live/listen/supervise/reconcile.js";
import {
  appendListenerArmEvent,
  listenerLogPath,
  readListenerArm,
  readListenerArmEvents,
  readListenerHeartbeat,
  readListenerLogTail,
} from "../../../live/listen/supervise/store.js";
import { listenerDiedEvent } from "../../../live/listen/supervise/streamEvents.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { deathOf, livenessLine, parseListenReconcileArgs, publish, refuse, resolveTargets } from "./listenShared.js";
import { LISTEN_RECONCILE_USAGE } from "./listenUsage.js";

/** Where this family's own arguments start in `process.argv`: `[node, cli, listen, <verb>, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** What one reconciliation pass found and wrote. */
export interface ReconcileOutcome {
  readonly liveness: ListenerLiveness;
  /**
   * The deaths it derived and ATTEMPTED to append to the journal, oldest first. Empty when the journal was
   * already complete. A failed append is not reported here or in `problems`: an entry may be missing on disk.
   */
  readonly appended: readonly ListenerArmEvent[];
  readonly problems: readonly string[];
}

/**
 * The death the caller can see on the live process right now, stamped at the tightest lower bound available.
 *
 * Returns `undefined` for every non-death verdict, including `unarmed` — nothing is armed, so there is no arm
 * for a death to belong to, and the journal walk still closes any arm a later one replaced.
 */
function observedDeath({
  home,
  liveness,
  nowMs,
}: {
  home: string;
  liveness: ListenerLiveness;
  nowMs: number;
}): ObservedListenerDeath | undefined {
  const death = deathOf({ liveness });
  if (death === undefined) {
    return undefined;
  }
  const arm = readListenerArm({ home });
  if (arm.isErr() || arm.value === undefined) {
    return undefined;
  }
  const heartbeat = readListenerHeartbeat({ home });
  const beat = heartbeat.isOk() ? heartbeat.value : undefined;
  const lastLog = readListenerLogTail({ logPath: listenerLogPath({ armId: death.armId, home }) });
  return {
    armId: death.armId,
    atIso: deathLowerBoundIso({
      armStartedAtIso: arm.value.startedAtIso,
      lastBeatAtIso: beat?.armId === death.armId ? beat.writtenAtIso : undefined,
      nowMs,
    }),
    reason: death.reason,
    ...(lastLog === undefined ? {} : { lastLog }),
  };
}

/**
 * One reconciliation pass: append every death the journal implies but does not record, and publish each onto
 * the supervisor stream.
 *
 * An arm journal that will not READ is reconciled as an EMPTY one, and an append that fails is still returned
 * in `appended`; neither is added to `problems`.
 *
 * Deliberately does NOT escalate and does NOT hand back an arm command. `supervise` owns the bounded-retry
 * contract, and a verb any session may tick must not be able to leave the bot deliberately DOWN. Nothing is
 * published for a healthy listener either — MONITORS-ALERT-ONLY: alert on down, never a recovery ping.
 *
 * @param home the Slopweaver home
 * @param nowMs the current instant, epoch milliseconds
 * @returns what it read and what it tried to write
 */
export function reconcileTick({ home, nowMs }: { home: string; nowMs: number }): ReconcileOutcome {
  const { liveness, problems } = currentLiveness({ home, nowMs });
  const events = readListenerArmEvents({ home });
  const appended = reconciledDeaths({
    events: events.isOk() ? events.value : [],
    observed: observedDeath({ home, liveness, nowMs }),
  });
  for (const death of appended) {
    appendListenerArmEvent({ event: death, home });
  }
  publishReconciled({ appended, home, nowMs });
  return { appended, liveness, problems };
}

/** Publish one `died` event per reconciled death, so a supervisor sweep sees an outage it slept through. */
function publishReconciled({
  appended,
  home,
  nowMs,
}: {
  appended: readonly ListenerArmEvent[];
  home: string;
  nowMs: number;
}): void {
  for (const death of appended) {
    if (death.kind !== "died") {
      continue;
    }
    publish({
      event: listenerDiedEvent({
        armId: death.armId,
        atIso: death.atIso,
        deathsInWindow: deathsInWindowNow({ home, nowMs }),
        lastLog: death.lastLog,
        pid: death.pid,
        reason: death.reason,
      }),
      home,
    });
  }
}

/** How many deaths the journal now holds inside the re-arm window — read fresh, after the appends. */
function deathsInWindowNow({ home, nowMs }: { home: string; nowMs: number }): number {
  const events = readListenerArmEvents({ home });
  const since = nowMs - REARM_WINDOW_MS;
  return (events.isOk() ? events.value : []).filter(
    (event) => event.kind === "died" && Date.parse(event.atIso) >= since && Date.parse(event.atIso) <= nowMs,
  ).length;
}

/**
 * `slopweaver listen reconcile` — back-write the deaths nothing was alive to record.
 *
 * Exits {@link EXIT_EXPECTED_EMPTY} when it recorded at least one death: a diagnostic that found a fault ran
 * correctly, the same reasoning `status` carries.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export const listenReconcileCommand = defineCommand({
  run: (argv) => {
    const parsed = parseListenReconcileArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      return refuse({ errors: parsed.error, usage: LISTEN_RECONCILE_USAGE });
    }
    const { home } = resolveTargets({ homeFlag: parsed.value.values["home"], queueFlag: undefined });
    const outcome = reconcileTick({ home, nowMs: Date.now() });
    printReconciled({ json: parsed.value.values["json"] === true, outcome });
    return outcome.appended.length === 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
  },
});

/** Narrate a reconciliation pass. Silence on a complete journal is the point: a tick must be cheap to read. */
function printReconciled({ json, outcome }: { json: boolean; outcome: ReconcileOutcome }): void {
  if (json) {
    logger.out({ line: JSON.stringify(outcome) });
    return;
  }
  for (const problem of outcome.problems) {
    logger.error({ msg: `listen reconcile: ${problem}` });
  }
  if (outcome.appended.length === 0) {
    logger.out({ line: `nothing to reconcile — ${livenessLine({ liveness: outcome.liveness })}` });
    return;
  }
  for (const death of outcome.appended) {
    logger.out({
      line:
        `RECORDED a death nothing watched: arm ${death.armId} at ${death.atIso}` +
        (death.kind === "died" ? ` (${death.reason})` : ""),
    });
  }
}
