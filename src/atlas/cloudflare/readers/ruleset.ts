/**
 * The two Rulesets reads — the inventory at one scope, and one ruleset's own rules.
 *
 * `rulesets.list` returns METADATA only: id, name, phase, kind, version. The rules arrive one
 * `rulesets.get` per ruleset, which is why `rulesetSync.ts` fans out rather than folding this flat. See
 * `projection/ruleset.ts` for the measurement that retired the three Rulesets exclusions, and for why
 * account and zone scope are two kinds rather than one kind with a scope field.
 *
 * The SDK's `account_id`/`zone_id` are MUTUALLY EXCLUSIVE and both optional, so a caller that passed
 * neither would read nothing and a caller that passed both would be refused by the provider. This module
 * takes one already-resolved `params` object from its caller instead of two optional ids, so neither
 * mistake is expressible here.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareRawRuleset, CloudflareRulesetRule } from "../projection/ruleset.js";

/** Which scope a Rulesets read runs at — exactly one of the provider's two mutually exclusive ids. */
export type CloudflareRulesetScopeParams = { readonly account_id: string } | { readonly zone_id: string };

/**
 * Read the ruleset inventory at one scope. Metadata only — the rules are a per-ruleset `get`.
 *
 * @param client the constructed Cloudflare client
 * @param params the resolved account-or-zone scope this read runs at
 * @param operation what to name this read if it fails, so an account and a zone read are told apart
 * @returns every ruleset's metadata at that scope, or the reason the read failed
 */
export async function readCloudflareRulesetInventory({
  client,
  params,
  operation,
}: {
  client: Cloudflare;
  params: CloudflareRulesetScopeParams;
  operation: string;
}): Promise<Result<readonly CloudflareRawRuleset[], CloudflareClientError>> {
  const rulesets: CloudflareRawRuleset[] = [];
  try {
    for await (const ruleset of client.rulesets.list(params)) {
      if (typeof ruleset.id !== "string" || ruleset.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a ruleset named "${ruleset.name}" had no id in the response`,
            operation,
          }),
        );
      }
      rulesets.push(ruleset);
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation }));
  }
  return ok(rulesets);
}

/**
 * Read one ruleset's rules.
 *
 * @param client the constructed Cloudflare client
 * @param rulesetId the ruleset to read
 * @param params the resolved account-or-zone scope this read runs at
 * @param operation what to name this read if it fails
 * @returns that ruleset's rules, or the reason the read failed
 */
export async function readCloudflareRulesetRules({
  client,
  rulesetId,
  params,
  operation,
}: {
  client: Cloudflare;
  rulesetId: string;
  params: CloudflareRulesetScopeParams;
  operation: string;
}): Promise<Result<readonly CloudflareRulesetRule[], CloudflareClientError>> {
  try {
    const full = await client.rulesets.get(rulesetId, params);
    return ok(full.rules);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation }));
  }
}
