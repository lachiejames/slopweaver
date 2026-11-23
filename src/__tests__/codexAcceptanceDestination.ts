/**
 * Which registered Codex plan the opt-in, paid acceptance run (`src/__tests__/subprocess/codex/acceptance.test.ts`)
 * spends — picked from the STORED plan register, never an unregistered ambient `~/.codex` login. A row whose
 * `storeDir` IS that directory pays: the operator registered it.
 *
 * A Codex pass and a seat route through the plan register (`../cli/commands/codex/passDeps.ts`,
 * `../codex/seatDecision.ts`), whose DERIVED picture on an unadopted install carries a synthetic `codex-ambient`
 * row. This run is deliberately stricter: it proves the real binary's sandbox on real OpenAI, so it spends only a
 * row the operator stored, never one on an account never registered and perhaps left out of the fleet on purpose.
 *
 * Three choices follow from the run reading the operator's real home and filing nothing into it — no register
 * import, no fleet-cap record, no sign-in observation, no reservation:
 *
 * - **The snapshot is the stored row only** (`../plans/storePort.ts`'s `readStoredPlanRegister`). An unadopted
 *   install's derived picture always carries a synthetic `codex-ambient` row — the very login this run must not
 *   fall back to — so no stored row is a refusal, never a derivation.
 * - **It does not rank.** The ranker's evidence comes from a fleet read that files fleet-cap records, sign-in
 *   observations and reservations into the home. So the run names its plan, or the register holds exactly one
 *   unpaused Codex plan.
 * - **A usage ceiling is refused, not checked.** A usage limit below 100% or a monthly-spend allowance is a
 *   ceiling no route crosses (`../plans/usageLimit.ts`), and the headroom under it is only known from that same
 *   writing fleet read. A paused plan is refused even when named: a pause withholds exactly this paid traffic.
 *   So is a relative `storeDir`, which the browser door and the SDK spawn would resolve against different
 *   working directories.
 */
import { isAbsolute } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { CodexDestination } from "../codex/destinations.js";
import { findRegisteredPlan, plansForProvider, unpausedPlansFor } from "../plans/register.js";
import type { PlanRegisterSnapshot, RegisteredPlan } from "../plans/types.js";

import { type AcceptancePlanError, AcceptancePlanErrors } from "./codexAcceptanceDestinationErrors.js";

/** Spend one picked row, refusing one with a usage ceiling or a relative home. */
function spendable({ plan }: { plan: RegisteredPlan }): Result<CodexDestination, AcceptancePlanError> {
  if (plan.allowance.kind === "monthly-spend" || plan.usageLimitPercent < 100) {
    return err(AcceptancePlanErrors.usageLimited({ alias: plan.alias }));
  }
  if (!isAbsolute(plan.storeDir)) {
    return err(AcceptancePlanErrors.homeRelative({ alias: plan.alias, storeDir: plan.storeDir }));
  }
  return ok({ alias: plan.alias, codexHome: plan.storeDir });
}

/**
 * The registered Codex destination a paid acceptance run spends.
 *
 * @param register the STORED register, or undefined when the store holds no row
 * @param requestedAlias the alias `CODEX_ACCEPTANCE_PLAN` named, exactly as set, or undefined when the run named none
 * @returns the named Codex row, or the sole unpaused one when none was named, paired with its own `CODEX_HOME` —
 *   or why no registered plan may pay
 */
export function acceptanceCodexDestination({
  register,
  requestedAlias,
}: {
  register: PlanRegisterSnapshot | undefined;
  requestedAlias: string | undefined;
}): Result<CodexDestination, AcceptancePlanError> {
  if (register === undefined) {
    return err(AcceptancePlanErrors.notAdopted());
  }
  const { plans } = register;
  const registeredAliases = plansForProvider({ plans, provider: "codex" }).map((plan) => plan.alias);
  if (requestedAlias !== undefined) {
    const named = findRegisteredPlan({ alias: requestedAlias, plans, provider: "codex" });
    if (named === undefined) {
      return err(AcceptancePlanErrors.notRegistered({ alias: requestedAlias, registeredAliases }));
    }
    if (named.paused !== undefined) {
      return err(AcceptancePlanErrors.paused({ alias: named.alias, ...named.paused }));
    }
    return spendable({ plan: named });
  }
  const candidates = unpausedPlansFor({ plans, provider: "codex" });
  const [sole] = candidates;
  if (sole === undefined) {
    return err(AcceptancePlanErrors.noCodexPlan({ registeredAliases }));
  }
  if (candidates.length > 1) {
    return err(AcceptancePlanErrors.ambiguous({ aliases: candidates.map((plan) => plan.alias) }));
  }
  return spendable({ plan: sole });
}
