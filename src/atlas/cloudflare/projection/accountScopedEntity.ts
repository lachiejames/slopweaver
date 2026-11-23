/**
 * The one builder every ACCOUNT-scoped Cloudflare projection shares — the entity envelope, with only the
 * kind, the provider id, the detail and the operation left to the caller.
 *
 * Extracted because `duplicate-windows` caught it: `zeroTrustAccessAdmin.ts` and `zeroTrustPosture.ts` each
 * grew a private `<domain>Entity` helper of their own on the same day, and the two were identical apart
 * from the kind union each narrowed to. The gate is right that this belongs in one place — and narrowing to
 * a per-domain union bought nothing, because {@link CloudflareAccountScopedKind} already refuses a
 * zone-scoped kind here, which is the mistake worth preventing.
 *
 * It is deliberately NOT retrofitted onto `zeroTrustActor.ts`, `zeroTrustData.ts` or `zeroTrustGateway.ts`,
 * which still spell the envelope inline per projection: that is a real follow-up, and doing it inside a
 * change this size would put a rewrite of eleven working projections behind one ruling's landing.
 */
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareAccountScopedKind, CloudflareEntity } from "../model.js";

/**
 * Build one account-scoped entity.
 *
 * @param kind the kind this entity belongs to — account-scoped by type, so a zone-scoped kind cannot be
 *   passed here at all
 * @param providerId the provider's own id for this record, or the fixed string a singleton is stored under
 * @param detail the projected detail this atlas stores
 * @param accountId the account this record was read under
 * @param at this run's ISO timestamp
 * @param operation which read produced it, for the entity's own source stamp
 * @returns the projected entity
 */
export function accountScopedEntity({
  kind,
  providerId,
  detail,
  accountId,
  at,
  operation,
}: {
  kind: CloudflareAccountScopedKind;
  providerId: string;
  detail: unknown;
  accountId: string;
  at: string;
  operation: string;
}): CloudflareEntity {
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId }, kind }),
    kind,
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation },
    state: "observed",
  };
}
