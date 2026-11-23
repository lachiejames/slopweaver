/**
 * `--plan <alias>` for a CLAUDE seat — `cmux spawn` on the claude driver and `cmux reseat` — read off the register
 * and turned into the store the seat boots against. The effectful edge of `claude/requestedPlan.ts`, which holds
 * the decision and why it exists.
 *
 * The store it returns travels as the seat's pinned store, so the pre-spawn gate judges it on its own live gauge
 * and never re-routes it (`claude/spawnStore.ts` § gatePinnedStore).
 */
import { logger } from "#lib/logger.js";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { resolveRequestedClaudePlan } from "../../../claude/requestedPlan.js";
import { readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import type { CmuxDriver } from "../../../cmux/pickupCommand.js";
import { slopweaverHome } from "../../../config.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { stringFlag } from "./core.js";

/**
 * The store a named Claude plan boots against, or the exit code after saying why that name cannot seat a session.
 *
 * A register that will not read is a fact about this machine and exits `EXIT_ERROR`; a name it does not carry, or
 * carries paused, is the caller's to change and exits `EXIT_USAGE`.
 *
 * @param alias the `--plan` value
 * @param command the verb printing the refusal, so the line names who refused
 * @param home the `--home` value the register lives under, or undefined for the ambient home
 * @param port where the plan register is read
 * @returns the store directory, or the exit code to stop on
 */
export async function claudePlanStoreFor({
  alias,
  command,
  home,
  port,
}: {
  alias: string;
  command: "cmux reseat" | "cmux spawn";
  home: string | undefined;
  port: PlanRegisterPort;
}): Promise<string | number> {
  let registerHome = slopweaverHome();
  if (home !== undefined) {
    registerHome = home;
  }
  const accounts = await readSpawnAccounts({ home: registerHome, port });
  if (accounts.isErr()) {
    logger.error({ msg: `${command}: --plan ${alias} could not be checked — ${accounts.error.message}` });
    return EXIT_ERROR;
  }
  const resolved = resolveRequestedClaudePlan({ accounts: absentAsNoPlans({ accounts: accounts.value }), alias });
  if (resolved.isErr()) {
    logger.error({ msg: `${command}: refusing — ${resolved.error.message}` });
    return EXIT_USAGE;
  }
  return resolved.value.storeDir;
}

/** An install with no Claude configuration names no plan, which the resolver reports as an empty register. */
function absentAsNoPlans({ accounts }: { accounts: readonly ClaudeAccount[] | undefined }): readonly ClaudeAccount[] {
  if (accounts === undefined) {
    return [];
  }
  return accounts;
}

/**
 * `cmux spawn`'s Claude half of `--plan`: the store a claude-driver seat was named onto, printed as it is chosen.
 *
 * The Codex driver reads the same flag in `./codexSeat.ts` and is untouched here, so one flag names the account
 * the seat SPENDS on either host.
 *
 * @param driver the already-resolved `--driver`; a Codex spawn names nothing here and gets `undefined`
 * @param home the `--home` value the register lives under
 * @param parsed the verb's parsed flags, for `--plan`
 * @param port where the plan register is read
 * @returns the named store, undefined when routing decides, or the exit code to stop on
 */
export async function claudeSeatNamedStore({
  driver,
  home,
  parsed,
  port,
}: {
  driver: CmuxDriver;
  home: string | undefined;
  parsed: ParsedFlags;
  port: PlanRegisterPort;
}): Promise<string | undefined | number> {
  if (driver !== "claude") {
    return undefined;
  }
  const alias = stringFlag({ name: "plan", parsed });
  if (alias === undefined) {
    return undefined;
  }
  const named = await claudePlanStoreFor({ alias, command: "cmux spawn", home, port });
  if (typeof named === "string") {
    logger.out({
      line: `cmux spawn: --plan ${alias} names this seat's plan over any role pin — judged on its own gauge, not routed`,
    });
  }
  return named;
}
