/**
 * The `audit-log` reader: Cloudflare's Audit Logs v2, narrowed to the last 30 days rather than the full
 * 18-month documented retention.
 *
 * Cloudflare's list endpoint refuses past exactly 100 pages (10,000 entries) with `service error: Maximum
 * page limit exceeded (code: 111)` in one continuous cursor walk — an undocumented server-side ceiling,
 * measured live. A full 18-month pull over an account whose history passes that ceiling would need to walk
 * the window in monthly `since`/`before` slices to stay under it. The owner chose the tighter 30-day window instead — "what changed recently" covers the overwhelming majority
 * of real investigations, one un-chunked call per sync rather than a mandatory multi-window walk every time.
 * The busiest 30-day period measured live still sat under the per-call ceiling, so no chunking is needed at
 * this window size — an account busy enough to pass it in 30 days would meet the refusal above.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareAuditLog } from "../projection/auditLog.js";

/** How far back the `audit-log` kind reaches on every sync — see this module's own header for why this is
 * narrower than Cloudflare's full 18-month retention. */
const AUDIT_LOG_WINDOW_DAYS = 30;

/**
 * Read every Audit Logs v2 entry under the selected account from the last {@link AUDIT_LOG_WINDOW_DAYS} days.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every audit log entity from the window, or the reason the read failed
 */
export async function readCloudflareAuditLogs({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const before = new Date(at);
  const since = new Date(before);
  since.setUTCDate(since.getUTCDate() - AUDIT_LOG_WINDOW_DAYS);
  const entities: CloudflareEntity[] = [];
  try {
    for await (const log of client.auditLogs.list({
      account_id: accountId,
      before: before.toISOString(),
      since: since.toISOString(),
    })) {
      if (typeof log.id !== "string" || log.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareAuditLog({ accountId, at, log: { ...log, id: log.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "audit-logs-list" }));
  }
  return ok(entities);
}
