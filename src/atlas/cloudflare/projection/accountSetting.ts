/**
 * Pure projection for the `account-setting` kind — the selected account's own metadata and settings
 * (`client.accounts.get`). A flat singleton, keyed by the account id itself, same convention
 * `projection/workerAccountSetting.ts` already established for a one-entity account-level kind.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `account-setting` kind. */
interface CloudflareAccountSettingDetail {
  readonly kind: "account-setting";
  readonly name: string;
  readonly type: "standard" | "enterprise" | null;
  readonly createdOn: string | null;
  readonly abuseContactEmail: string | null;
  readonly enforceTwoFactor: boolean | null;
  readonly parentOrgId: string | null;
  readonly parentOrgName: string | null;
}

/** The subset of the SDK's `Account` shape this projection reads. */
export interface CloudflareRawAccount {
  readonly id: string;
  readonly name: string;
  readonly type?: "standard" | "enterprise";
  readonly created_on?: string;
  readonly managed_by?: { readonly parent_org_id?: string; readonly parent_org_name?: string };
  readonly settings?: { readonly abuse_contact_email?: string; readonly enforce_twofactor?: boolean };
}

/**
 * Project the selected account's own metadata into an `account-setting` entity.
 *
 * @param account the raw account, already validated to carry a non-empty `id`
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccountSetting({
  account,
  at,
}: {
  account: CloudflareRawAccount;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareAccountSettingDetail = {
    abuseContactEmail: unsetFieldAsNull({ key: "abuse_contact_email", record: account.settings }),
    createdOn: unsetFieldAsNull({ key: "created_on", record: account }),
    enforceTwoFactor: unsetFieldAsNull({ key: "enforce_twofactor", record: account.settings }),
    kind: "account-setting",
    name: account.name,
    parentOrgId: unsetFieldAsNull({ key: "parent_org_id", record: account.managed_by }),
    parentOrgName: unsetFieldAsNull({ key: "parent_org_name", record: account.managed_by }),
    type: unsetFieldAsNull({ key: "type", record: account }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId: account.id, providerId: account.id }, kind: "account-setting" }),
    kind: "account-setting",
    lastSeenAt: at,
    providerId: account.id,
    scope: { accountId: account.id, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "account-get" },
    state: "observed",
  };
}
