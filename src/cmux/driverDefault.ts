/**
 * Which host a `cmux spawn` that names no `--driver` boots on.
 *
 * One plan of either provider runs all of Slopweaver. A spawn that omitted `--driver` always
 * booted Claude, so on an install whose register holds only Codex plans every such spawn — a recipe's, a
 * supervisor's routing line — booted Claude on the ambient credential, a plan the install never registered.
 *
 * The policy, and why each edge sits where it does:
 *
 * - **A REGISTERED register with at least one Codex row and no Claude row boots Codex.** Rows are counted whether
 *   or not they are paused or monthly-spend: a Codex-only install whose one row is paused must get the Codex
 *   route's own refusal naming the pause, never escape onto an unregistered Claude credential.
 * - **Every other register boots Claude, as it always did.** A mixed register keeps the long-standing default. A
 *   DERIVED register (nothing adopted yet) holds only the Claude plans the user signed in to — a Codex row enters
 *   solely by `plans add --provider codex`, never from a login found on the machine — so it is never read as
 *   Codex-only, the same caution `../supervisor/chairSuccessor.ts` takes before it seats a Codex chair.
 *
 * An explicit `--driver` always wins and never reads the register (`../cli/commands/cmux/spawnDriver.ts`).
 */

import { plansForProvider } from "../plans/register.js";
import type { PlanRegisterSnapshot } from "../plans/types.js";
import type { CmuxDriver } from "./pickupCommand.js";

/**
 * The host an omitted `--driver` resolves to, over one register reading.
 *
 * @param register the plan register as this spawn read it
 * @returns `codex` for a registered Codex-only register, else `claude`
 */
export function defaultCmuxDriver({ register }: { register: PlanRegisterSnapshot }): CmuxDriver {
  const codexOnly =
    register.source === "registered" &&
    plansForProvider({ plans: register.plans, provider: "codex" }).length > 0 &&
    plansForProvider({ plans: register.plans, provider: "claude" }).length === 0;
  const driver: CmuxDriver = codexOnly ? "codex" : "claude";
  return driver;
}
