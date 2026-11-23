/**
 * The Gateway List readers: the account-level list inventory (a flat collection, one call), and per-list
 * items (a parent fan-out — see `projection/gatewayList.ts`'s header for what a live probe measured about
 * item-count completeness before this was written).
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareRawGatewayList, CloudflareRawGatewayListItem } from "../projection/gatewayList.js";

/**
 * Read the account's Gateway List inventory, exhausting pagination. Never carries items — the list
 * endpoint's own `items` field came back empty for every real list a live probe checked.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @returns every Gateway List's metadata, or the reason the read failed
 */
export async function readCloudflareGatewayListInventory({
  client,
  accountId,
}: {
  client: Cloudflare;
  accountId: string;
}): Promise<Result<readonly CloudflareRawGatewayList[], CloudflareClientError>> {
  const lists: CloudflareRawGatewayList[] = [];
  try {
    for await (const list of client.zeroTrust.gateway.lists.list({ account_id: accountId })) {
      if (typeof list.id !== "string" || list.id.length === 0) {
        continue;
      }
      lists.push({ ...list, id: list.id });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-lists-list" }));
  }
  return ok(lists);
}

/**
 * Read one Gateway List's items, exhausting pagination — the SDK pages this endpoint by `page` number,
 * stopping at the first empty page. The list's own declared `count` is still worth comparing against on the
 * caller's side: nothing about the API guarantees the two agree.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param listId the list to read items for
 * @returns every item this list currently has, or the reason the read failed
 */
export async function readCloudflareGatewayListItems({
  client,
  accountId,
  listId,
}: {
  client: Cloudflare;
  accountId: string;
  listId: string;
}): Promise<Result<readonly CloudflareRawGatewayListItem[], CloudflareClientError>> {
  const items: CloudflareRawGatewayListItem[] = [];
  try {
    for await (const item of client.zeroTrust.gateway.lists.items.list(listId, { account_id: accountId })) {
      items.push(item);
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-list-items-list" }));
  }
  return ok(items);
}
