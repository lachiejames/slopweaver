/**
 * The two Zero Trust DATA-CONTROL entity shapes and their projections — what this organisation has told
 * Cloudflare to look for in traffic, and which SaaS tenants it has pointed a scanner at.
 *
 * A `dlp-profile` carries its own `entries` array — the detectors that actually match — and the entries are
 * kept INSIDE the profile rather than split into a kind of their own. That is deliberate: `dlp/entries`
 * returns the same records a second time, keyed by profile, so a separate kind would hold a duplicate of
 * data already stored and give a reader two answers to one question. `dlp-dataset` is the surface entries
 * can reference instead, and it is declared deferred (`inventory.ts`) because a dataset's value is the
 * cells it holds and the read API returns only its metadata.
 *
 * A `casb-integration` is the connection to a SaaS tenant, never a finding about one. The findings are the
 * churning half and are deferred for that reason — an integration is configuration a reader can act on, and
 * a finding is a judgement that is different on every run.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The stable fields one DLP profile carries. */
export interface CloudflareDlpProfileDto {
  readonly id: string;
  readonly name?: string | null;
  readonly type?: string | null;
  readonly description?: string | null;
  readonly entries?: unknown;
  readonly shared_entries?: unknown;
  readonly allowed_match_count?: number | null;
  readonly confidence_threshold?: string | null;
  readonly context_awareness?: unknown;
  readonly ocr_enabled?: boolean | null;
  readonly ai_context_enabled?: boolean | null;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
}

/** The detail this atlas stores for the `dlp-profile` kind. */
export interface CloudflareDlpProfileDetail {
  readonly kind: "dlp-profile";
  readonly name: string | null;
  /** `predefined`, `custom` or `integration` — where the profile came from. */
  readonly type: string | null;
  readonly description: string | null;
  /** The detectors this profile matches on. Kept here rather than as their own kind — see the header. */
  readonly entries: unknown;
  readonly sharedEntries: unknown;
  readonly allowedMatchCount: number | null;
  readonly confidenceThreshold: string | null;
  readonly contextAwareness: unknown;
  readonly ocrEnabled: boolean | null;
  readonly aiContextEnabled: boolean | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Project one DLP profile into a `dlp-profile` entity.
 *
 * @param profile the raw profile, already validated to carry a non-empty `id`
 * @param accountId the account this profile was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDlpProfile({
  profile,
  accountId,
  at,
}: {
  profile: CloudflareDlpProfileDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareDlpProfileDetail = {
    aiContextEnabled: unsetFieldAsNull({ record: profile, key: "ai_context_enabled" }),
    allowedMatchCount: unsetFieldAsNull({ record: profile, key: "allowed_match_count" }),
    confidenceThreshold: unsetFieldAsNull({ record: profile, key: "confidence_threshold" }),
    contextAwareness: unsetFieldAsNull({ record: profile, key: "context_awareness" }),
    createdAt: unsetFieldAsNull({ record: profile, key: "created_at" }),
    description: unsetFieldAsNull({ record: profile, key: "description" }),
    entries: unsetFieldAsNull({ record: profile, key: "entries" }),
    kind: "dlp-profile",
    name: unsetFieldAsNull({ record: profile, key: "name" }),
    ocrEnabled: unsetFieldAsNull({ record: profile, key: "ocr_enabled" }),
    sharedEntries: unsetFieldAsNull({ record: profile, key: "shared_entries" }),
    type: unsetFieldAsNull({ record: profile, key: "type" }),
    updatedAt: unsetFieldAsNull({ record: profile, key: "updated_at" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: profile.id }, kind: "dlp-profile" }),
    kind: "dlp-profile",
    lastSeenAt: at,
    providerId: profile.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "dlp-profiles-list" },
    state: "observed",
  };
}

/** The stable fields one CASB integration carries. */
export interface CloudflareCasbIntegrationDto {
  readonly id: string;
  readonly name?: string | null;
  readonly status?: string | null;
  readonly is_paused?: boolean | null;
  readonly application?: unknown;
  readonly created?: string | null;
  readonly updated?: string | null;
}

/** The detail this atlas stores for the `casb-integration` kind. */
export interface CloudflareCasbIntegrationDetail {
  readonly kind: "casb-integration";
  readonly name: string | null;
  readonly status: string | null;
  readonly isPaused: boolean | null;
  /** Which SaaS product this integration scans, and the tenant it is bound to. */
  readonly application: unknown;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Project one CASB integration into a `casb-integration` entity.
 *
 * @param integration the raw integration, already validated to carry a non-empty `id`
 * @param accountId the account this integration was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareCasbIntegration({
  integration,
  accountId,
  at,
}: {
  integration: CloudflareCasbIntegrationDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareCasbIntegrationDetail = {
    application: unsetFieldAsNull({ record: integration, key: "application" }),
    createdAt: unsetFieldAsNull({ record: integration, key: "created" }),
    isPaused: unsetFieldAsNull({ record: integration, key: "is_paused" }),
    kind: "casb-integration",
    name: unsetFieldAsNull({ record: integration, key: "name" }),
    status: unsetFieldAsNull({ record: integration, key: "status" }),
    updatedAt: unsetFieldAsNull({ record: integration, key: "updated" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: integration.id }, kind: "casb-integration" }),
    kind: "casb-integration",
    lastSeenAt: at,
    providerId: integration.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "casb-integrations-list" },
    state: "observed",
  };
}
