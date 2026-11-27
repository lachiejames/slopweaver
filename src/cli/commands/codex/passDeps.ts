/**
 * The seams a `codex plan` / `codex review` pass runs over, and the production wiring behind them.
 *
 * Split out of `./run.ts` when the client stopped being a VALUE and became a FACTORY. Before the plan
 * register, one process had one Codex account and so one client, built once at startup; now which account a
 * pass spends is decided per invocation from the same ranking a visible seat routes on
 * (`codex/fleetCap.ts`), and a `LockedCodexClient` held in a deps object could only ever name whichever
 * account the machine happened to export.
 *
 * The routing lives here rather than in either verb because both verbs take it identically and the failure
 * arm is the interesting half: a pass with nowhere to go REFUSES and names every destination it asked,
 * rather than falling through onto the ambient home and spending an account nobody chose.
 */

import { randomUUID } from "node:crypto";

import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import { codexThreadAdmit } from "../../../codex/browserDoor.js";
import {
  type CodexClientFactory,
  type CodexThreadPosture,
  type LockedCodexClient,
  productionCodexClient,
} from "../../../codex/client.js";
import { type FallbackRegisterPort, fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { type CodexFleetCapPort, codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import {
  CODEX_PASS_RESERVATION_LOCK_WAIT_SECONDS,
  type CodexPassReservationPort,
  type CodexPassRoute,
  codexPassFleetRead,
  fileCodexPassReservationPort,
} from "../../../codex/passReservationStore.js";
import { codexHeartbeat, foldCodexEvent, initialCodexActivity } from "../../../codex/progress.js";
import { type DeadlineRuntime, systemDeadlineRuntime } from "../../../codex/runPass.js";
import { type CodexSignInPort, codexSignInPort } from "../../../codex/signInPort.js";
import { openStreamLog } from "../../../codex/streamLog.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { supersessionPort } from "../../../codex/supersessionStore.js";
import type { CodexEventSink, CodexPassId, PassBound } from "../../../codex/types.js";
import { vendoredCodexCli } from "../../../codex/vendoredCli.js";
import { progressJsonEnabled } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { createRichProgressEmitter, unrefIntervalStallTimer } from "../../../lib/progressRichEmitter.js";
import { err, ok } from "../../../lib/result.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { realWaitClock } from "../../../wait/loop.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/** The seams a test replaces. */
export interface CodexDeps {
  /**
   * Builds the client for whichever destination the ranking chose. A factory rather than a client: the
   * account is not known until the pass is about to run, and one built ahead of that names the ambient home.
   */
  readonly clientFor: CodexClientFactory;
  /**
   * Where the Claude fallback receipts the review's property-chase reading folds in are reached —
   * `fallbackRegisterPort()` in production. Required for the same reason as `registerPort`.
   */
  readonly fallbackPort: FallbackRegisterPort;
  /**
   * Where every pass is routed and, on a usage-limited account, reserved — the file-backed port over the real
   * register, fleet-cap and sign-in ports in production (`codex/passReservationStore.ts`), a seam in a test.
   * Required, so no test routes a pass off a real store by leaving it out.
   */
  readonly reservationPort: CodexPassReservationPort;
  /**
   * Where the supersession register a review's announcement reads is reached — `supersessionPort()` in
   * production, an in-memory seam in a test. Required for the reason {@link CodexDeps.reservationPort} is.
   */
  readonly supersessions: SupersessionPort;
  readonly runtime: DeadlineRuntime;
  readonly newId?: () => string;
  /**
   * Builds the live-progress sink for one pass. Injected so a test can watch a pass without a real emitter,
   * and so `--json` callers can run silent. Returns `undefined` to run blind.
   */
  readonly watch?: ({ pass, boundMs }: { pass: CodexPassId; boundMs: number }) => CodexEventSink | undefined;
}

/**
 * The `onEvent` spread for a pass, or nothing when the caller runs blind.
 *
 * @param boundMs the pass's own deadline, which the heartbeat counts against
 * @param deps the seams this invocation is running over
 * @param pass which pass is being watched
 * @returns the spread to apply to the pass options
 */
export function watchFor({ deps, pass, boundMs }: { deps: CodexDeps; pass: CodexPassId; boundMs: number }): {
  readonly onEvent?: CodexEventSink;
} {
  const sink = deps.watch?.({ boundMs, pass });
  return sink === undefined ? {} : { onEvent: sink };
}

/** A routed client, and the release its reservation needs once the pass is over. */
export interface RoutedCodexPass {
  readonly client: LockedCodexClient;
  /** Releases the pass's reservation; a fault is printed and the row left to expire — it never throws or rejects. */
  readonly release: () => Promise<void>;
}

/**
 * The release a caller holds: the port's own, with a fault printed rather than returned, so a release that fails
 * can never replace the result of the pass it follows.
 *
 * @param route the routed pass whose reservation this releases
 * @returns the release
 */
function reportingRelease({ route }: { route: CodexPassRoute & { kind: "routed" } }): () => Promise<void> {
  return async () => {
    const failure = await releaseFailure({ route });
    if (failure !== undefined && route.reservation !== undefined) {
      logger.error({
        msg: `codex: pass reservation ${route.reservation.id} on ${route.destination.alias} was not released and stands until it expires at ${route.reservation.expiresAtIso} — ${failure}`,
      });
    }
  };
}

/**
 * Why a release failed, or undefined when it did not. A THROWN fault counts as well as a returned one — the lock's
 * own filesystem staging throws on a full disk — so a release can never reject into a pass's `finally` and replace
 * that pass's result (found by a Codex review).
 */
async function releaseFailure({ route }: { route: CodexPassRoute & { kind: "routed" } }): Promise<string | undefined> {
  try {
    const released = await route.release();
    return released.isErr() ? released.error.message : undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/**
 * Route this pass, reserving its account's share of the week when the account is usage-limited, and build the
 * client for where it went — or return the exit code to stop on.
 *
 * Refusing is the whole point of the failure arm: a pass that cannot be routed used to run anyway, against
 * whatever `$CODEX_HOME` the shell exported, so an exhausted account and an unregistered one both produced a
 * spend nobody had chosen. The refusal names what was asked, because "Codex is capped" with no list is
 * exactly the line a session cannot act on. A client the factory refuses releases the reservation just taken
 * before the exit code returns, so a pass that never started holds nothing.
 *
 * @param bound the pass's own bound, which dates its reservation's expiry
 * @param deps the seams this invocation is running over, whose factory builds the routed client
 * @param home the state home holding the register, the reservation document and the cached exhaustion records
 * @param model the model the pass asked for, handed to the client the factory builds
 * @returns the client and its release, or the exit code — the refusal printed first
 */
export async function routedCodexPass({
  bound,
  deps,
  home,
  model,
}: {
  bound: PassBound;
  deps: CodexDeps;
  home: string;
  model: string;
}): Promise<RoutedCodexPass | number> {
  const route = await deps.reservationPort.acquire({ bound, home });
  if (route.isErr()) {
    logger.error({ msg: `codex: no registered destination can take this pass — ${route.error.message}` });
    return EXIT_ERROR;
  }
  if (route.value.kind === "refused") {
    logger.error({ msg: `codex: no registered destination can take this pass — ${route.value.why}` });
    return EXIT_ERROR;
  }
  const routed = route.value;
  logger.info({ msg: `codex: routed to ${routed.destination.alias} on ${model} — ${routed.why}` });
  const release = reportingRelease({ route: routed });
  const client = deps.clientFor({ destination: routed.destination, model });
  if (client.isErr()) {
    await release();
    logger.error({ msg: client.error });
    return EXIT_ERROR;
  }
  return { client: client.value, release };
}

/**
 * The production reservation port, over the given register, fleet-cap and sign-in ports and the real live reader,
 * clock, ids and lock wait.
 *
 * @param fleetCap where each fleet read files the ordinary fleet-cap record
 * @param port where the plan register is read
 * @param signInPort where each store's sign-in observation is filed
 * @returns the port a real pass routes through
 */
export function productionCodexPassReservationPort({
  fleetCap,
  port,
  signInPort,
}: {
  fleetCap: CodexFleetCapPort;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
}): CodexPassReservationPort {
  return fileCodexPassReservationPort({
    seams: {
      emit: (line) => {
        logger.info({ msg: line });
      },
      lockWaitSeconds: CODEX_PASS_RESERVATION_LOCK_WAIT_SECONDS,
      newId: () => randomUUID(),
      nowIso: () => new Date().toISOString(),
      pid: process.pid,
      readFleet: codexPassFleetRead({ fleetCap, port, readLive: readCodexAccountsLive, signInPort }),
      waitClock: realWaitClock(),
    },
  });
}

/**
 * The production factory: one real client for the routed home, every thread of which passes the browser door.
 *
 * A pass starts a thread, and an app-server starts its MCP servers on a thread — so a home or a project the
 * ChatGPT app configured with a browser surface the fixed overrides do not name would launch it here exactly
 * as it did in a seat. The door runs at thread start (`codex/client.ts`'s `admittedCodexClient`), because
 * that is when the working directory whose project config Codex loads is known.
 *
 * @param posture which locked policy the factory's threads carry — `sealed` for a pass that only composes
 * @returns the factory a pass routes through: the locked client that spends a destination, or why this machine has
 *   no vendored CLI to spend it through
 */
export function productionCodexClientFor({ posture }: { posture: CodexThreadPosture }): CodexClientFactory {
  return ({ destination, model }) => {
    // ONE binary for the door's listing and the SDK's spawn, so the list judged is the list the thread loads.
    const cli = vendoredCodexCli();
    if ("reason" in cli) {
      return err(`codex pass: ${cli.reason}`);
    }
    const { codexHome } = destination;
    return ok(
      productionCodexClient({
        admitThread: codexThreadAdmit({ cli, codexHome, posture }),
        cli,
        codexHome,
        model,
        posture,
      }),
    );
  };
}

/**
 * The live-progress sink for one pass.
 *
 * Folds the observed events and emits a throttled heartbeat through the SHARED emitter — the one constraint 8
 * (`docs/constraints/7-9.md`) says not to duplicate. Both of its lanes go to stderr, so a `--json` caller's stdout stays pristine.
 */
function passWatcher({ pass, boundMs }: { pass: CodexPassId; boundMs: number }): CodexEventSink {
  const emitter = createRichProgressEmitter({
    stallTimer: unrefIntervalStallTimer,
    verb: "codex",
    ...(progressJsonEnabled() ? {} : { machineSink: () => {} }),
  });
  const log = openStreamLog({ pass });
  const startedMs = Date.now();
  let activity = initialCodexActivity();
  return (event) => {
    activity = foldCodexEvent({ activity, event });
    const heartbeat = codexHeartbeat({ activity, boundMs, elapsedMs: Date.now() - startedMs, pass });
    log({ activity, elapsedMs: Date.now() - startedMs });
    if (event.kind === "turn-completed" || event.kind === "turn-failed") {
      emitter.finish(heartbeat);
      emitter.close(); // the pass is over; its watchdog must not outlive it (`lib/progressRichEmitter.ts`)
      return;
    }
    emitter.emit(heartbeat);
  };
}

/**
 * Production deps: the real client factory, the system clock, and live progress on stderr.
 *
 * @returns the seams a real invocation runs over
 */
export function productionDeps(): CodexDeps {
  return {
    clientFor: productionCodexClientFor({ posture: "pass" }),
    fallbackPort: fallbackRegisterPort(),
    reservationPort: productionCodexPassReservationPort({
      fleetCap: codexFleetCapPort(),
      port: planRegisterPort(),
      signInPort: codexSignInPort(),
    }),
    runtime: systemDeadlineRuntime(),
    supersessions: supersessionPort(),
    watch: passWatcher,
  };
}
