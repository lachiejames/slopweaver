/**
 * How `slopweaver claude reset` prints a plan's free-reset state. Pure. Nothing here can reach an organisation id or a
 * token: it renders the parsed block and the NAME of the slot the login came from, and no field of either holds one.
 */
import type { ResetLoginSource } from "../../../claude/resetCredential.js";
import type { ClaudeResetGrant, ClaudeResetStatus } from "../../../claude/resetStatus.js";

/** One grant as one line. */
function grantLine({ grant, next }: { grant: ClaudeResetGrant; next: boolean }): string {
  const total = grant.resetsTotal === undefined ? "" : ` of ${String(grant.resetsTotal)}`;
  const label = grant.label === undefined || grant.label === "" ? "" : ` "${grant.label}"`;
  const ends = grant.endsAtIso === undefined ? "" : `, ends ${grant.endsAtIso}`;
  const clears = grant.clears.length === 0 ? "" : `, clears ${grant.clears.join("/")}`;
  const states = [
    grant.usableNow ? "usable now" : "not usable now",
    grant.useRequiresLimit ? "only at a limit" : "any time",
    ...(grant.paused ? ["paused"] : []),
    ...(next ? ["next"] : []),
  ];
  return `  grant ${grant.id}${label}: ${String(grant.resetsLeft)}${total} reset(s) left${ends}${clears} — ${states.join(", ")}`;
}

/** Whether the account may take a reset, and the provider's reason when it may not. */
function eligibilityText({ block }: { block: ClaudeResetStatus["block"] }): string {
  if (block.eligible) {
    return "eligible";
  }
  if (block.ineligibleReason === undefined) {
    return "NOT eligible (no reason given)";
  }
  return `NOT eligible (${block.ineligibleReason})`;
}

/**
 * The status lines for one plan.
 *
 * @param label the plan as it is named to them — alias and enrolled address
 * @param source which slot the bound login came from
 * @param status the parsed status
 * @returns the lines to print
 */
export function renderResetStatus({
  label,
  source,
  status,
}: {
  label: string;
  source: ResetLoginSource;
  status: ClaudeResetStatus;
}): readonly string[] {
  const { block } = status;
  const slot = source === "store" ? "its own store" : "the default slot";
  const eligibility = eligibilityText({ block });
  const limit = block.atLimit ? `at a limit (${block.exhausted.join(", ")})` : "no window at its limit";
  return [
    `claude reset: ${label} — read over ${slot}'s login: ${eligibility}, ${limit}`,
    ...(block.grants.length === 0 ? ["  no grant held"] : []),
    ...block.grants.map((grant) => grantLine({ grant, next: grant.id === block.nextGrantId })),
    ...(block.cooldownUntilIso === undefined ? [] : [`  cooldown until ${block.cooldownUntilIso}`]),
    ...(block.weeklyResetsAtIso === undefined ? [] : [`  week resets on its own at ${block.weeklyResetsAtIso}`]),
  ];
}
