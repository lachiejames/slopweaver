/**
 * The monthly half of every Claude routing input: each `monthly-spend` plan paired with what its newest recorded
 * spend reading says under the owner's usage limit, at one instant. The one place routing reads the spend ledger, so
 * a spawn, a watch tick, `claude gauge` and machine capacity all judge a monthly plan on the same evidence.
 *
 * It reads only the LOCAL ledger `slopweaver claude spend` writes (`./spendStore.ts`), never the provider: the usage
 * endpoint throttles to about one read an hour (`./spendPolicy.ts`), so no tick or spawn may call it. A reading older
 * than an hour, absent, or in a ledger that cannot be read is a `not-measured` verdict here — a plan named as
 * unmeasured, never a plan silently left out, and never one read as having spent nothing.
 */
import { decodePlanAllowance, decodeUsageLimitPercent } from "../plans/usageLimit.js";
import type { ClaudeAccount, ClaudePlanSpend } from "./contracts.js";
import { claudeSpendVerdict } from "./spendPolicy.js";
import { latestClaudeSpendReading } from "./spendStore.js";

/**
 * Whether a configured plan is a monthly-spend plan — the plans this module reads a verdict for.
 *
 * @param account the configured plan
 * @returns true when its allowance is monthly spend
 */
export function monthlySpendAccount({ account }: { account: Pick<ClaudeAccount, "allowance"> }): boolean {
  return decodePlanAllowance({ allowance: account.allowance }).kind === "monthly-spend";
}

/**
 * Every monthly-spend plan among `accounts`, with its spend verdict at `nowIso`, in the accounts' own order.
 *
 * @param accounts the configured plans routing may choose among — already filtered to the unpaused ones; a
 *   weekly-window plan among them is skipped, since its gauge is its evidence
 * @param home the state home whose readings ledger holds the spend readings
 * @param nowIso the instant the verdicts are for — a reading's freshness is judged against it
 * @returns one entry per monthly-spend plan
 */
export function readClaudePlanSpends({
  accounts,
  home,
  nowIso,
}: {
  accounts: readonly ClaudeAccount[];
  home: string;
  nowIso: string;
}): readonly ClaudePlanSpend[] {
  return accounts
    .filter((account) => monthlySpendAccount({ account }))
    .map((account): ClaudePlanSpend => {
      const read = latestClaudeSpendReading({ alias: account.alias, home, nowIso });
      if (read.isErr()) {
        return {
          alias: account.alias,
          verdict: { kind: "not-measured", reason: `its spend readings could not be read — ${read.error.message}` },
        };
      }
      return {
        alias: account.alias,
        verdict: claudeSpendVerdict({
          alias: account.alias,
          nowIso,
          reading: read.value,
          usageLimitPercent: decodeUsageLimitPercent({ usageLimitPercent: account.usageLimitPercent }),
        }),
      };
    });
}
