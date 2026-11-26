/**
 * The Recovery check's state in the running app, and the one press both surfaces share. The menu bar's Recovery item
 * and the Sessions page's Recovery button each call {@link pressFleetRecovery}, which steps the press synchronously, so
 * a second press on either while a pass runs starts nothing. Nothing else starts a pass: not the app's launch, not a
 * timer, not a calendar. The state lives in memory only, so the app opens on "not run since the app opened".
 *
 * The decisions are `fleetRecoveryCheck.ts`; the process is `fleetProcess.ts`'s `recoverFleet`.
 */
import type { Result } from "neverthrow";

import { type CheckoutError, FleetRecoveryErrors } from "./errors";
import { recoverFleet } from "./fleetProcess";
import {
  type FleetRecoveryEvent,
  type FleetRecoveryState,
  RECOVERY_IDLE,
  stepFleetRecovery,
} from "./fleetRecoveryCheck";

/** What the Recovery check reads from, and tells, the rest of the shell. */
export interface FleetRecoveryHost {
  /** The checkout whose `bin/slopweaver` runs. */
  readonly checkout: () => Result<string, CheckoutError>;
  /** The state changed: redraw the Sessions page and the menu. */
  readonly changed: () => void;
}

let host: FleetRecoveryHost | undefined;
let state: FleetRecoveryState = RECOVERY_IDLE;

/**
 * Apply one event and tell the shell.
 *
 * @param event what happened
 * @returns whether that event starts a pass
 */
function apply({ event }: { event: FleetRecoveryEvent }): boolean {
  const step = stepFleetRecovery({ event, state });
  state = step.state;
  host?.changed();
  return step.run;
}

/**
 * Where the Recovery check stands now.
 *
 * @returns the state
 */
export function fleetRecoveryState(): FleetRecoveryState {
  return state;
}

/**
 * The owner pressed Recovery, in the menu or on the Sessions page: start one pass unless one is running.
 */
export function pressFleetRecovery(): void {
  if (host === undefined) {
    return;
  }
  const checkout = host.checkout();
  if (!apply({ event: { kind: "pressed" } })) {
    return;
  }
  if (checkout.isErr()) {
    apply({ event: { error: FleetRecoveryErrors.didNotRun({ detail: checkout.error.message }), kind: "no-result" } });
    return;
  }
  void (async () => {
    const ran = await recoverFleet({ checkout: checkout.value });
    if (ran.isErr()) {
      apply({ event: { error: ran.error, kind: "no-result" } });
      return;
    }
    apply({ event: { kind: "finished", result: ran.value } });
  })();
}

/**
 * Give the Recovery check its host. Starts nothing: a pass runs only on a press.
 *
 * @param recoveryHost what the check reads from the rest of the shell
 */
export function startFleetRecoveryShell({ recoveryHost }: { recoveryHost: FleetRecoveryHost }): void {
  host = recoveryHost;
}
