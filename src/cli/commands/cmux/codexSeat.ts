/**
 * `cmux spawn`'s Codex half: which registered account a visible seat boots against, whether it may, and what
 * a caught exhaustion is recorded against.
 *
 * The decision itself is `../../../codex/seatDecision.ts`, shared with the chair's hand-off and the console
 * voice; this file is the CLI edge that translates `--plan` and `--force`, prints the verdict and turns a
 * refusal into an exit code. A sibling of `./codexQuotaSeat.ts`, which owns the cap record a booted seat writes.
 *
 * Both exports take `home: string | undefined` and resolve it through {@link seatStateHome}, never a
 * coalesce: `--home` is a real flag every test passes, and a silent substitution here would send a cap
 * record to the operator's own state home from a test that thought it had a sandbox.
 */

import type { CmuxDriver } from "../../../cmux/pickupCommand.js";
import { type CodexSeatRoute, codexSeatModelNote } from "../../../cmux/seatRoute.js";
import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import type { CodexDestination } from "../../../codex/destinations.js";
import type { CodexFleetCapPort } from "../../../codex/fleetCapPort.js";
import type { CodexQuotaKind } from "../../../codex/quotaTypes.js";
import { decideCodexSeat } from "../../../codex/seatDecision.js";
import type { CodexSignInPort } from "../../../codex/signInPort.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { recordCodexSeatExhaustion } from "./codexQuotaSeat.js";
import { stringFlag } from "./core.js";

/** The current instant, as ISO-8601. Not injected: this is the effectful CLI edge, not a pure module. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The state home this seat's register and cap records live under.
 *
 * @param home the `--home` flag's value, or undefined when the caller passed none
 * @returns the explicit home, or the ambient one when there was no explicit one
 */
function seatStateHome({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/** Print which account the seat took and why, plus the note when `--model` named a tier Codex cannot take. */
function reportCodexSeat({ parsed, route }: { parsed: ParsedFlags; route: CodexSeatRoute }): void {
  logger.out({
    line: `cmux spawn: codex seat on ${route.destination.alias} (CODEX_HOME=${route.destination.codexHome}) — ${route.why}`,
  });
  const requestedModel = stringFlag({ name: "model", parsed });
  if (requestedModel === undefined) {
    return;
  }
  const note = codexSeatModelNote({ requestedModel });
  if (note !== undefined) {
    logger.error({ msg: `cmux spawn: ${note}` });
  }
}

/**
 * Which registered Codex account this seat boots against.
 *
 * Runs BEFORE the doc is found and before any worktree exists, for the reason the quota fast-fail does: a
 * spawn with nowhere to boot should leave no directory and no cmux tab behind. `--plan` names the account and
 * `--force` reaches only the provider quota decision, never the owner's pause, usage limit or monthly-spend
 * setting (`../../../codex/seatDecision.ts`).
 *
 * @param driver the already-resolved `--driver`; a Claude spawn routes nothing and gets `undefined`
 * @param home the state home holding the register and the cached quota records
 * @param parsed the verb's parsed flags, for `--plan` and `--force`
 * @param port where the plan register is read — the spawn's own port, so a store outage stops the seat before
 *   any worktree or tab exists
 * @param fleetCap where the seat's fleet read files its conclusion, so the monitor lane reads what the spawn saw
 * @param signInPort where the fleet read files each store's sign-in observation
 * @returns the routed seat, undefined for a Claude spawn, or the exit code to stop on
 */
export async function resolveCodexSeat({
  driver,
  fleetCap,
  home,
  parsed,
  port,
  signInPort,
}: {
  driver: CmuxDriver;
  fleetCap: CodexFleetCapPort;
  home: string | undefined;
  parsed: ParsedFlags;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
}): Promise<CodexSeatRoute | undefined | number> {
  if (driver !== "codex") {
    return undefined;
  }
  const decided = await decideCodexSeat({
    allowRefusing: parsed.values["force"] === true,
    fleetCap,
    home: seatStateHome({ home }),
    nowIso: nowIso(),
    port,
    readLive: readCodexAccountsLive,
    requestedAlias: stringFlag({ name: "plan", parsed }),
    signInPort,
  });
  if (decided.isErr()) {
    logger.error({ msg: `cmux spawn: ${decided.error.message}` });
    return EXIT_ERROR;
  }
  reportCodexSeat({ parsed, route: decided.value });
  return decided.value;
}

/**
 * Record an exhaustion a booted seat caught, against the account it was spending.
 *
 * The `undefined` arm is not a fallback and deliberately writes nothing: a cap record is keyed by an alias,
 * and keying one to a destination this spawn never chose would refuse the wrong account on the next spawn.
 * It says so rather than passing silently, because a banner that produced no record is a fact a reader needs.
 *
 * @param destination the routed account, or undefined when this spawn routed none
 * @param home the state home the cap records live under
 * @param kind what the post-boot check saw
 */
export function recordCaughtExhaustion({
  destination,
  home,
  kind,
}: {
  destination: CodexDestination | undefined;
  home: string | undefined;
  kind: CodexQuotaKind;
}): void {
  if (destination === undefined) {
    logger.error({
      msg:
        "cmux spawn: a Codex exhaustion was caught but this seat routed no destination, so no cap record was " +
        "written — the next spawn re-reads it from that home's own rollout log",
    });
    return;
  }
  recordCodexSeatExhaustion({ destination, home, kind, observedAtIso: nowIso() });
}
