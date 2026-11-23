/**
 * The account filter-list readers: the account-level list inventory (a flat collection, one call, the
 * account `rules.lists` API), and per-list items (a parent fan-out, cursor-exhausted by the SDK).
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type {
  CloudflareRawAccountFilterList,
  CloudflareRawAccountFilterListItem,
} from "../projection/accountFilterList.js";

/**
 * Read the account's filter-list inventory, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @returns every filter list's metadata, or the reason the read failed
 */
export async function readCloudflareAccountFilterListInventory({
  client,
  accountId,
}: {
  client: Cloudflare;
  accountId: string;
}): Promise<Result<readonly CloudflareRawAccountFilterList[], CloudflareClientError>> {
  const lists: CloudflareRawAccountFilterList[] = [];
  try {
    for await (const list of client.rules.lists.list({ account_id: accountId })) {
      if (typeof list.id !== "string" || list.id.length === 0) {
        continue;
      }
      lists.push({ ...list, id: list.id });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "account-filter-lists-list" }));
  }
  return ok(lists);
}

/**
 * Read one filter list's items, exhausting the SDK's own cursor pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param listId the list to read items for
 * @returns every item this list currently has, or the reason the read failed
 */
export async function readCloudflareAccountFilterListItems({
  client,
  accountId,
  listId,
}: {
  client: Cloudflare;
  accountId: string;
  listId: string;
}): Promise<Result<readonly CloudflareRawAccountFilterListItem[], CloudflareClientError>> {
  const items: CloudflareRawAccountFilterListItem[] = [];
  try {
    for await (const item of client.rules.lists.items.list(listId, { account_id: accountId })) {
      if (typeof item.id !== "string" || item.id.length === 0) {
        continue;
      }
      items.push({ ...item, id: item.id });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "account-filter-list-items-list" }));
  }
  return ok(items);
}
