/**
 * Pure projection for the `audit-log` kind — Cloudflare's Audit Logs v2 (`client.auditLogs.list`), narrowed
 * to the last 30 days (see `readers/auditLog.ts`'s own header for why). Flat and account-filtered, keyed by
 * the log entry's own `id`. The dedicated Resource History endpoint (`GET /accounts/{id}/logs/audit/{logId}/
 * history`, undocumented in the pinned SDK) is deliberately NOT fanned out here — grouping this kind's own
 * entities by `resourceId` already reconstructs "every change to this resource" for every entry
 * that carries one, for zero extra API calls, versus one call per unique resource touched across the full
 * 18-month retention for the fan-out. The one real gap this leaves — an entry with
 * no `resourceId` that Cloudflare's backend could still approximately match via other signals — is a
 * deliberate, named, deferred limitation, not an oversight.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `audit-log` kind. */
interface CloudflareAuditLogDetail {
  readonly kind: "audit-log";
  readonly actionType: string | null;
  readonly actionResult: boolean | null;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly actorIp: string | null;
  readonly actorType: string | null;
  readonly sourceInterface: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly newValue: string | null;
  readonly oldValue: string | null;
  readonly ownerId: string | null;
  readonly resourceId: string | null;
  readonly resourceType: string | null;
  readonly when: string | null;
}

/** The subset of the SDK's `AuditLog` shape this projection reads. */
export interface CloudflareRawAuditLog {
  readonly id: string;
  readonly action?: { readonly type?: string; readonly result?: boolean };
  readonly actor?: { readonly id?: string; readonly email?: string; readonly ip?: string; readonly type?: string };
  readonly interface?: string;
  readonly metadata?: unknown;
  readonly newValue?: string;
  readonly oldValue?: string;
  readonly owner?: { readonly id?: string };
  readonly resource?: { readonly id?: string; readonly type?: string };
  readonly when?: string;
}

/**
 * Project one raw audit log entry into an `audit-log` entity.
 *
 * @param log the raw audit log entry, already validated to carry a non-empty `id`
 * @param accountId the account this entry was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAuditLog({
  log,
  accountId,
  at,
}: {
  log: CloudflareRawAuditLog;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareAuditLogDetail = {
    actionResult: unsetFieldAsNull({ key: "result", record: log.action }),
    actionType: unsetFieldAsNull({ key: "type", record: log.action }),
    actorEmail: unsetFieldAsNull({ key: "email", record: log.actor }),
    actorId: unsetFieldAsNull({ key: "id", record: log.actor }),
    actorIp: unsetFieldAsNull({ key: "ip", record: log.actor }),
    actorType: unsetFieldAsNull({ key: "type", record: log.actor }),
    kind: "audit-log",
    metadata: isRecord(log.metadata) ? { ...log.metadata } : null,
    newValue: unsetFieldAsNull({ key: "newValue", record: log }),
    oldValue: unsetFieldAsNull({ key: "oldValue", record: log }),
    ownerId: unsetFieldAsNull({ key: "id", record: log.owner }),
    resourceId: unsetFieldAsNull({ key: "id", record: log.resource }),
    resourceType: unsetFieldAsNull({ key: "type", record: log.resource }),
    sourceInterface: unsetFieldAsNull({ key: "interface", record: log }),
    when: unsetFieldAsNull({ key: "when", record: log }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: log.id }, kind: "audit-log" }),
    kind: "audit-log",
    lastSeenAt: at,
    providerId: log.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "audit-logs-list" },
    state: "observed",
  };
}
