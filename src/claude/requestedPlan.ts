/**
 * The Claude plan an operator NAMED for one seat — `cmux spawn --plan <alias>` and `cmux reseat --plan <alias>` —
 * resolved against the register. Pure: the configured plans in, the store or the typed refusal out.
 *
 * ## Why a named plan exists beside routing
 *
 * MEASURED: six `cmux spawn <slug> --model opus --plan plan-one` calls each printed `claude routing: plan-four
 * for a all-models spawn` and booted on plan-four at 80% of its week, because the flag was read only on the
 * Codex driver and dropped in silence on the Claude one. The chair is a smart model: given the right information
 * it makes the decision. The gauge gives the chair the information; a named plan is the one way to act on it
 * that routing cannot overrule.
 *
 * A named plan is judged exactly as a pinned seat is — its own live gauge, refused when spent unless the spent-plan
 * hatch is open (`./spawnStore.ts` § gatePinnedStore) — so naming a plan chooses WHERE, never whether a wall is
 * crossed.
 *
 * ## A paused plan is refused, never quietly booted
 *
 * A pause is a fact the operator wrote down (`./config.ts` § unpausedAccounts). Booting a named seat on it would
 * make the pause a projection one verb honours and another does not, which is the disagreement this module exists
 * to close.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { ClaudeAccount } from "./contracts.js";

/** The named alias is not a configured Claude plan. */
interface RequestedPlanUnknownError {
  readonly code: "REQUESTED_PLAN_UNKNOWN";
  readonly message: string;
  readonly alias: string;
}

/** The named plan is configured and PAUSED, so no seat boots on it until it is resumed. */
interface RequestedPlanPausedError {
  readonly code: "REQUESTED_PLAN_PAUSED";
  readonly message: string;
  readonly alias: string;
}

/** Why a named Claude plan could not seat this session. */
export type RequestedPlanError = RequestedPlanPausedError | RequestedPlanUnknownError;

const RequestedPlanErrors = {
  paused: ({ alias, reason }: { alias: string; reason: string }): RequestedPlanPausedError => ({
    alias,
    code: "REQUESTED_PLAN_PAUSED",
    message:
      `--plan ${alias} is PAUSED (${reason}), so no seat boots on it — resume it first with ` +
      `\`slopweaver plans resume --provider claude --plan ${alias}\`, or name another plan`,
  }),
  unknown: ({ alias, configured }: { alias: string; configured: readonly string[] }): RequestedPlanUnknownError => ({
    alias,
    code: "REQUESTED_PLAN_UNKNOWN",
    message:
      configured.length === 0
        ? `--plan ${alias} names no Claude plan — this install registers none`
        : `--plan ${alias} is not a Claude plan; the registered ones are ${configured.join(", ")}`,
  }),
} as const;

/**
 * The configured Claude plan an operator named, or why it cannot seat a session.
 *
 * @param accounts every registered Claude plan, paused ones included, in registered order
 * @param alias the alias the operator typed after `--plan`
 * @returns the plan to boot against, or the typed refusal naming what to do instead
 */
export function resolveRequestedClaudePlan({
  accounts,
  alias,
}: {
  accounts: readonly ClaudeAccount[];
  alias: string;
}): Result<ClaudeAccount, RequestedPlanError> {
  const named = accounts.find((account) => account.alias === alias);
  if (named === undefined) {
    return err(RequestedPlanErrors.unknown({ alias, configured: accounts.map((account) => account.alias) }));
  }
  if (named.paused !== undefined) {
    return err(RequestedPlanErrors.paused({ alias, reason: named.paused.reason }));
  }
  return ok(named);
}
