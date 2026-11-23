/**
 * Pure projection for the `worker-account-setting` kind — a SINGLETON, not a list. Combines the account's
 * Workers settings (`client.workers.accountSettings.get`) and its `*.workers.dev` subdomain
 * (`client.workers.subdomains.get`) into one entity, per the plan's own grouping ("Workers account/subdomain
 * settings exposed by the SDK"). The account id itself is the provider id, since there is exactly one of
 * these per account — the same pattern the eventual `account-setting` kind will need.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `worker-account-setting` kind. */
interface CloudflareWorkerAccountSettingDetail {
  readonly kind: "worker-account-setting";
  readonly defaultUsageModel: string | null;
  readonly greenCompute: boolean | null;
  readonly subdomain: string | null;
}

/** The subset of the SDK's account-settings response this projection reads. */
export interface CloudflareRawWorkerAccountSetting {
  readonly default_usage_model?: string;
  readonly green_compute?: boolean;
}

/** The subset of the SDK's subdomain-get response this projection reads. */
export interface CloudflareRawWorkerSubdomain {
  readonly subdomain?: string;
}

/**
 * Project the account's Workers settings and subdomain into a single `worker-account-setting` entity.
 *
 * @param accountSetting the raw account-settings response
 * @param subdomain the raw subdomain response
 * @param accountId the account these settings belong to
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareWorkerAccountSetting({
  accountSetting,
  subdomain,
  accountId,
  at,
}: {
  accountSetting: CloudflareRawWorkerAccountSetting;
  subdomain: CloudflareRawWorkerSubdomain;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareWorkerAccountSettingDetail = {
    defaultUsageModel: unsetFieldAsNull({ key: "default_usage_model", record: accountSetting }),
    greenCompute: unsetFieldAsNull({ key: "green_compute", record: accountSetting }),
    kind: "worker-account-setting",
    subdomain: unsetFieldAsNull({ key: "subdomain", record: subdomain }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: accountId }, kind: "worker-account-setting" }),
    kind: "worker-account-setting",
    lastSeenAt: at,
    providerId: accountId,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "workers-account-settings-get" },
    state: "observed",
  };
}
