/**
 * The fleet's two timers, applied to Electron: read the fleet every half minute, and knock on cmux from outside it
 * every minute so a hang is watched whole. Neither read ever overlaps itself. What a reading means is
 * `fleetShell.ts`'s; this module only reads and hands the result over.
 */
import type { Result } from "neverthrow";

import { type CmuxReviveReading, reviveHoldsLaunch } from "./cmuxRevive";
import type { CheckoutError } from "./errors";
import type { FleetHealth } from "./fleetHealth";
import { readFleetHealth, reviveCmux } from "./fleetProcess";

/** What the timers read from, and tell, the rest of the shell. */
export interface FleetPollingHost {
  /** The checkout whose `bin/slopweaver` runs. */
  readonly checkout: () => Result<string, CheckoutError>;
  /** The fleet could not be read, and why. */
  readonly fleetReadFailed: (options: { readonly problem: string }) => void;
  /** The fleet was read. */
  readonly fleetReadSucceeded: (options: { readonly health: FleetHealth }) => void;
  /** A problem for the menu bar. */
  readonly reportProblem: (options: { readonly problem: string }) => void;
}

/** How often the fleet is read: `fleet health` starts a CLI, so not every console check. */
const FLEET_INTERVAL_MS = 30_000;

/** How often cmux is knocked on from outside: well inside `cmux revive`'s five-minute gap, so a hang is watched whole. */
const REVIVE_INTERVAL_MS = 60_000;

let host: FleetPollingHost | undefined;
let fleetReading = false;
/** The newest `cmux revive`, and whether one is running now — a restart takes minutes, and two never overlap. */
let cmuxRevive: CmuxReviveReading | undefined;
let cmuxReviving = false;

/**
 * The host, once `startFleetPolling` has run.
 *
 * @returns the host
 */
function hostOf(): FleetPollingHost {
  if (host === undefined) {
    throw new Error("the fleet polling was used before startFleetPolling");
  }
  return host;
}

/**
 * Whether cmux is being restarted, or a restart it just reported still holds a launch back: a launch into a hung
 * cmux, or one being restarted, types into an app that cannot draw the tab.
 *
 * @returns true while a launch must wait on cmux
 */
export function fleetPollingBlocksLaunch(): boolean {
  return cmuxReviving || reviveHoldsLaunch({ reading: cmuxRevive });
}

/** Read the fleet now, unless a read is already running, and hand the reading or its failure to the shell. */
export function checkFleet(): void {
  if (fleetReading) {
    return;
  }
  const checkout = hostOf().checkout();
  if (checkout.isErr()) {
    hostOf().fleetReadFailed({ problem: checkout.error.message });
    return;
  }
  fleetReading = true;
  const path = checkout.value;
  void (async () => {
    const read = await readFleetHealth({ checkout: path });
    fleetReading = false;
    if (read.isErr()) {
      hostOf().fleetReadFailed({ problem: read.error.message });
      return;
    }
    hostOf().fleetReadSucceeded({ health: read.value });
  })();
}

/**
 * Knock on cmux from outside it, and let the verb restart it when it has hung past its bound. A run that could not
 * happen at all is the menu bar's problem, never a silent one; a hang is the sessions page's, through `fleet health`.
 */
function checkCmux(): void {
  if (cmuxReviving) {
    return;
  }
  const checkout = hostOf().checkout();
  if (checkout.isErr()) {
    return;
  }
  cmuxReviving = true;
  void (async () => {
    const revived = await reviveCmux({ checkout: checkout.value });
    cmuxReviving = false;
    if (revived.isErr()) {
      cmuxRevive = undefined;
      hostOf().reportProblem({ problem: `cmux could not be checked: ${revived.error}` });
      return;
    }
    cmuxRevive = revived.value;
    // A restart that just finished changes what health reads, so read it now rather than up to half a minute later.
    if (revived.value.restartOutcome !== undefined) {
      checkFleet();
    }
  })();
}

/**
 * Start the timers: read the fleet now and every half minute after, and knock on cmux now and every minute.
 *
 * @param pollingHost what the timers read from the rest of the shell
 */
export function startFleetPolling({ pollingHost }: { pollingHost: FleetPollingHost }): void {
  host = pollingHost;
  checkFleet();
  setInterval(checkFleet, FLEET_INTERVAL_MS);
  checkCmux();
  setInterval(checkCmux, REVIVE_INTERVAL_MS);
}
