/**
 * The Access-policy readers: the account-level reusable-policy list (a flat collection, one call), and
 * per-application policy lists (a parent fan-out — the same policy id can appear under many apps, per
 * Cloudflare's own documented "exclusive and reusable policies" behavior on the per-app endpoint).
 *
 * A live read-only probe (never committed) measured this before any reader code was written, per the plan:
 * a policy id can be attached to more than one app, and where such a policy's body differed across apps —
 * in EVERY case seen — only `precedence` differed. `precedence` is declared only on the per-app response shape, never the account-level one — it is
 * an app-local binding attribute, not a property of the policy itself. `projection/accessPolicy.ts` treats
 * it accordingly: any OTHER field disagreeing across apps is a real conflict, flagged rather than guessed at.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareRawAccessPolicy } from "../projection/accessPolicy.js";

/**
 * Read the account's reusable Access policies, exhausting pagination. Includes policies not currently
 * attached to any application — an unused reusable policy still exists in the atlas.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @returns every reusable policy, or the reason the read failed
 */
export async function readCloudflareAccessReusablePolicies({
  client,
  accountId,
}: {
  client: Cloudflare;
  accountId: string;
}): Promise<Result<readonly CloudflareRawAccessPolicy[], CloudflareClientError>> {
  const policies: CloudflareRawAccessPolicy[] = [];
  try {
    for await (const policy of client.zeroTrust.access.policies.list({ account_id: accountId })) {
      if (typeof policy.id !== "string" || policy.id.length === 0) {
        continue;
      }
      policies.push({ ...policy, id: policy.id });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-reusable-policies-list" }));
  }
  return ok(policies);
}

/**
 * Read one Access application's policies, exhausting pagination. The response mixes policies exclusive to
 * this application with reusable policies also attached elsewhere — the caller reconciles that, this reader
 * only reports what one application currently has.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param applicationId the application to read policies for
 * @returns every policy this application currently has, or the reason the read failed
 */
export async function readCloudflareAccessApplicationPolicies({
  client,
  accountId,
  applicationId,
}: {
  client: Cloudflare;
  accountId: string;
  applicationId: string;
}): Promise<Result<readonly CloudflareRawAccessPolicy[], CloudflareClientError>> {
  const policies: CloudflareRawAccessPolicy[] = [];
  try {
    for await (const policy of client.zeroTrust.access.applications.policies.list(applicationId, {
      account_id: accountId,
    })) {
      if (typeof policy.id !== "string" || policy.id.length === 0) {
        continue;
      }
      policies.push({ ...policy, id: policy.id });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-application-policies-list" }));
  }
  return ok(policies);
}
