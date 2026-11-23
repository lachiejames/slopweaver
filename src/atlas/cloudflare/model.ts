/**
 * The Cloudflare atlas's on-disk vocabulary, and the schemas that refuse to trust it.
 *
 * ## One channel, not two
 *
 * Vanta's entity shape hard-codes `manage-api` and `browser` because a browser capture was a real, if
 * unbuilt, second source of truth. Cloudflare has exactly one acquisition channel — the REST API reached
 * through the official SDK — so an entity carries one direct `source`, not two nullable channel slots.
 *
 * ## Detail stays unknown at the disk layer
 *
 * Vanta's own kind-file schema validates `detail` as `unknown` and lets a projection function decide what
 * belongs there — the same posture Cloudflare takes here. No SDK response type is exported from this file,
 * serialised wholesale, or treated as the on-disk contract; each kind's own projection (added as its reader
 * lands) is what actually shapes `detail` before it is ever written.
 *
 * ## Selection is part of the manifest, not a credential
 *
 * A Cloudflare token can see more than one account, and picking the wrong one by array position would sync
 * unrelated data. `selection` records the explicitly configured account and deep zone the moment the first
 * sync succeeds; every later sync compares against it and refuses on a mismatch rather than silently
 * re-scoping. It is `null` only for a freshly reset atlas that has never synced.
 */
import { z } from "zod";

import { ATLAS_COVERAGE_STATES, type AtlasCoverageState } from "../kit/contract.js";
import { atlasPermissionBlockSchema } from "../kit/permissionBlock.js";

/**
 * The on-disk schema version for the Cloudflare atlas. Bump only with a real layout change.
 *
 * **Version 2 changed no field.** It changed what a zone-scoped entity's `id` MEANS: that id now hashes the
 * zone it was read from, so the same `providerId` in two zones is two entities rather than one. A v1
 * generation is byte-valid against every v2 schema and silently wrong — its zone-scoped ids collapse every
 * zone the account holds onto one — which is precisely the case the version field exists for. The store refuses a v1
 * generation and names `cloudflare reset` (see `store.ts`'s `CLOUDFLARE_SUPERSEDE_REMEDY`); a
 * migration was considered and is not possible, because the zone a v1 id was hashed from is exactly the
 * information that identity threw away.
 *
 * **Version 3 changed no field either.** It added thirty-six KINDS — thirty-four Zero Trust surfaces plus
 * `ruleset` and `zone-ruleset`. `cloudflareManifestSchema`'s `kinds` is a
 * `z.record(z.enum(CLOUDFLARE_KINDS), …)`, which Zod v4 treats as exhaustive AND closed, so a v2 manifest
 * is missing thirty-six required keys and fails to parse. Bumping is what turns that into the store's own
 * named refusal (`CLOUDFLARE_SUPERSEDE_REMEDY`) instead of thirty-six Zod issues: `kit/store.ts`'s
 * `foreignSchemaVersion` fires BEFORE validation. Reproduce the exhaustiveness in one line:
 * `z.object({ k: z.record(z.enum(["a","b"]), z.string()) }).safeParse({ k: { a: "x" } }).success` is `false`.
 */
export const CLOUDFLARE_ATLAS_SCHEMA_VERSION = 3;

/** The platform discriminator, written alongside the version so a store can never be misread as another atlas's. */
export const CLOUDFLARE_ATLAS_PLATFORM = "cloudflare";

/** The one acquisition channel this atlas has. See this file's header. */
export const CLOUDFLARE_CHANNEL = "rest-api";

/** The permanent claim boundary every coverage cell carries: complete for what the configured token can see. */
export const CLOUDFLARE_VISIBILITY_SCOPE = "configured-token-visible";

/**
 * Every Zero Trust kind this atlas holds, in the order a reader walks the enforcement path: actor, device,
 * policy, egress, private topology, data controls, then the Access administration and posture surfaces.
 *
 * **The 13 candidate DEFERRED kinds are held, not deferred, by the owner's ruling.** Missing coverage is
 * unacceptable; only a highly voluminous surface (the owner's example of a qualifying volume was a terabyte
 * on this machine) may ever be excluded, and every other exclusion is unacceptable.
 *
 * Every candidate kind was MEASURED against an account, GET only — rows from `slopweaver atlas
 * cloudflare read --kind <kind> --json | jq '.page.matched'`, bytes from the kind file's size — and not one
 * came close. The time-series kinds (`dex-fleet-status` over the provider's whole 7-day retention, then
 * `access-authentication-log`) are the largest, because a time series grows with the clock. So all
 * thirteen have readers, and no `CLOUDFLARE_DEFERRED_SURFACES` list or `deferredKinds.ts` exists — a
 * mechanism with no members is one the next session quietly fills back up — and the reasons those
 * kinds could carry (secondary administration, a churning judgement, a time series) are recorded here as
 * REJECTED grounds, so the same argument cannot be made again from scratch.
 *
 * Nine of these are SINGLETONS whose provider id is a fixed string, exactly as `worker-account-setting`
 * is. Four fold several independent reads into one kind, the way `notification-destination` folds webhooks
 * and PagerDuty: `device-policy` (default plus custom WARP profiles), `access-certificate` (mTLS plus SAML),
 * `access-authentication-log` (authentication events plus SCIM provisioning updates) and `risk-score`
 * (behaviour definitions plus the integrations that feed them).
 *
 * **`risk-score-summary` is here to FAIL, and that is the second half of the same ruling.** The owner's rule
 * on permission boundaries: a kind the configured credential cannot see is recorded as a permission
 * boundary, first-class and visible, never a silent exclusion. `zero_trust/risk_scoring/summary` can answer
 * `403 Authentication error` to a token while the behaviour and integration surfaces beside it answer 200
 * (measured), so it is a kind of its own rather than a permanently-null field on
 * `risk-score`: the ordinary failed-read fold then records coverage `unreadable` carrying the provider's own
 * refusal plus an open `permission-refused` gap, and both close by themselves the day the token gains the
 * scope. `readers/zeroTrustPosture.ts` carries the measurement.
 */
export const CLOUDFLARE_ZERO_TRUST_HELD_KINDS = [
  "access-user",
  "zero-trust-organization",
  "device-registration",
  "device-policy",
  "device-setting",
  "device-managed-network",
  "gateway-policy",
  "gateway-configuration",
  "gateway-logging",
  "gateway-location",
  "gateway-certificate",
  "gateway-proxy-endpoint",
  "gateway-audit-ssh-setting",
  "connectivity-setting",
  "tunnel",
  "tunnel-route",
  "virtual-network",
  "zero-trust-subnet",
  "dlp-profile",
  "casb-integration",
  "access-tag",
  "access-bookmark",
  "access-custom-page",
  "access-certificate",
  "access-gateway-ca",
  "access-infrastructure-target",
  "access-authentication-log",
  "access-key-configuration",
  "dlp-dataset",
  "casb-finding",
  "risk-score",
  "risk-score-summary",
  "dex-test",
  "dex-fleet-status",
] as const;

/**
 * Every ACCOUNT-scoped kind: a surface whose entities belong to the selected account as a whole, so one
 * read of it covers everything this atlas stores for that kind. `zone` is one of these — it is the light
 * inventory OF the zones, not a fact read from inside one.
 */
export const CLOUDFLARE_ACCOUNT_SCOPED_KINDS = [
  "account-setting",
  "access-application",
  "access-policy",
  "access-group",
  "access-service-token",
  "device-posture-rule",
  "identity-provider",
  "gateway-list",
  "pages-project",
  "worker-account-setting",
  "worker-script",
  "worker-domain",
  "account-filter-list",
  "notification-policy",
  "notification-destination",
  "notification-silence",
  "notification-history",
  "audit-log",
  "account-certificate",
  "zone",
  ...CLOUDFLARE_ZERO_TRUST_HELD_KINDS,
  "ruleset",
] as const;

/**
 * Every ZONE-scoped kind: a surface read from INSIDE one zone, whose entities therefore belong to that one
 * zone and to no other. Two facts follow, and both are load-bearing rather than descriptive.
 *
 * **Identity.** A zone-scoped entity's id must carry its zone. Cloudflare allocates several of these id
 * spaces per zone rather than globally — measured, two different zones return byte-identical
 * sets of `zone-setting` ids (`ssl`, `always_use_https`, …), and `api-gateway`, `zone-analytics` and
 * `zone-certificate` each carry fixed singleton ids that are the same string in every zone. Hashing
 * `{accountId, providerId}` therefore folds every zone onto one set and the last zone written wins. This
 * is what `identity.ts`'s `cloudflareZoneEntityId` exists to make unforgettable: `cloudflareEntityId` will
 * not accept a kind in this list, so a new zone-scoped projection cannot COMPILE without its zone.
 *
 * **The fold.** A read of one zone is a complete read of that zone and of nothing else, so it may only
 * stale, preserve or replace that zone's own entities — see `merge.ts` and the five deep-zone
 * `<kind>Sync.ts` modules.
 */
export const CLOUDFLARE_ZONE_SCOPED_KINDS = [
  "dns-record",
  "dnssec",
  "zone-setting",
  "firewall-service",
  "legacy-waf",
  "zone-certificate",
  "page-rule",
  "zone-analytics",
  "api-gateway",
  "worker-route",
  "zone-ruleset",
] as const;

/**
 * Every kind this atlas tracks: the account-wide surfaces, then the surfaces read in depth from inside a
 * zone. Every zone (including a deeply-read one) also gets a light `zone` inventory row — see
 * `inventory.ts` for which surfaces are required per kind and what is deliberately excluded (modern
 * Rulesets/WAF, Cache Rules, browser capture, mutations).
 */
export const CLOUDFLARE_KINDS = [...CLOUDFLARE_ACCOUNT_SCOPED_KINDS, ...CLOUDFLARE_ZONE_SCOPED_KINDS] as const;

/** A surface whose entities belong to the account as a whole. */
export type CloudflareAccountScopedKind = (typeof CLOUDFLARE_ACCOUNT_SCOPED_KINDS)[number];

/** A surface read from inside one zone, whose entities belong to that zone alone. */
export type CloudflareZoneScopedKind = (typeof CLOUDFLARE_ZONE_SCOPED_KINDS)[number];

export type CloudflareKind = (typeof CLOUDFLARE_KINDS)[number];

const ZONE_SCOPED_KINDS: ReadonlySet<string> = new Set(CLOUDFLARE_ZONE_SCOPED_KINDS);

/**
 * Whether one kind is read from inside a zone rather than across the account — the runtime half of the
 * split above, for the merge and the read adapter, which hold a `CloudflareKind` rather than a literal.
 *
 * @param kind the kind to classify
 * @returns whether that kind's entities belong to one zone
 */
// A type predicate cannot destructure its subject (TS1230), so this one stays positional — see
// `.claude/rules/typescript-patterns.md`, where the compiler's refusal is the named exception.
export function isCloudflareZoneScopedKind(kind: CloudflareKind): kind is CloudflareZoneScopedKind {
  return ZONE_SCOPED_KINDS.has(kind);
}

/** How far this atlas has got with one surface. Kit-owned and CLOSED — see `kit/contract.ts`. This atlas
 * had independently arrived at exactly these seven states in exactly this order, which is why they are the
 * kit's now; the stored values are byte-identical, so nothing on disk changes. */
export type CloudflareCoverageState = AtlasCoverageState;

const isoSchema = z.iso.datetime();

/** Where in Cloudflare's scoping an entity lives — its account, the zone it belongs to (if any), and its
 * immediate parent (e.g. an Access application, for a policy nested beneath it). */
export const cloudflareScopeSchema = z
  .object({
    accountId: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    zoneId: z.string().min(1).nullable(),
  })
  .strict();

/**
 * Where a fact came from, and when it was observed.
 *
 * NOT derived from the kit's `atlasSourceSchema`, and the gap is the finding rather than the omission: that
 * schema requires a `deepLink` plus a non-nullable `deepLinkStatus`, and this one carries neither. The
 * Cloudflare REST API returns no link to the dashboard on any surface this atlas reads — a dashboard URL is
 * CONSTRUCTIBLE from an account, zone and resource id, but a link this code assembled is not a link the
 * provider handed back, and writing one under `provider-provided` would be exactly the fake the kit's
 * status field exists to expose. The honest status for every record here is `unverified`: nobody has looked
 * with a browser yet.
 *
 * Adding the two fields to say so is an on-disk layout change, which is a schema bump and a forced reset —
 * out of scope for a port whose whole contract is that no install loses its data. So the fact is declared
 * once, where a reader will actually meet it: `descriptor.ts`'s browser surface is `declared-unfilled`, and
 * its `unfilledBecause` names this. Filling that surface is what makes the schema bump worth taking.
 */
export const cloudflareSourceSchema = z
  .object({
    channel: z.literal(CLOUDFLARE_CHANNEL),
    observedAt: isoSchema,
    operation: z.string().min(1),
  })
  .strict();

/** One coverage cell: what we know about one surface, at one scope. */
export const cloudflareCoverageCellSchema = z
  .object({
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.literal(CLOUDFLARE_VISIBILITY_SCOPE),
  })
  .strict();

/** A gap, as stored. Free-text condition/scope so a reader is never blocked inventing a new enum literal. */
export const cloudflareGapSchema = z
  .object({
    condition: z.string().min(1),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(CLOUDFLARE_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
  })
  .strict();

export type CloudflareGap = z.infer<typeof cloudflareGapSchema>;

/**
 * One tracked entity. `detail` is deliberately `unknown` here — see this file's header on why the disk
 * schema never mirrors an SDK response type.
 */
export const cloudflareEntitySchema = z
  .object({
    detail: z.unknown(),
    firstSeenAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(CLOUDFLARE_KINDS),
    lastSeenAt: isoSchema,
    providerId: z.string().min(1),
    scope: cloudflareScopeSchema,
    source: cloudflareSourceSchema,
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type CloudflareEntity = z.infer<typeof cloudflareEntitySchema>;

/** One kind's file on disk. */
export const cloudflareKindFileSchema = z
  .object({
    coverage: z.array(cloudflareCoverageCellSchema),
    entities: z.array(cloudflareEntitySchema),
    gaps: z.array(cloudflareGapSchema),
    kind: z.enum(CLOUDFLARE_KINDS),
    platform: z.literal(CLOUDFLARE_ATLAS_PLATFORM),
    schemaVersion: z.literal(CLOUDFLARE_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type CloudflareKindFile = z.infer<typeof cloudflareKindFileSchema>;

/** What is known about one kind's synchronisation history. */
export const cloudflareKindStatusSchema = z
  .object({
    /** A digest of the bytes published, so a later half-write is detectable rather than silent. */
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: isoSchema, outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: isoSchema.nullable(),
    // Absent on manifests written before the field existed, so nullish rather than required — see
    // `atlasPermissionBlockSchema` in the kit for why the field exists at all.
    permissionBlocked: atlasPermissionBlockSchema.nullish(),
  })
  .strict();

export type CloudflareKindStatus = z.infer<typeof cloudflareKindStatusSchema>;

/** The one explicitly configured account and deep zone this atlas's data belongs to. See this file's header. */
export const cloudflareSelectionSchema = z
  .object({
    accountId: z.string().regex(/^[0-9a-f]{32}$/, "expected a lowercase 32-character Cloudflare account id"),
    deepZone: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict(),
  })
  .strict();

/** The manifest: the authority on what has been published, plus the scope it was published for. */
export const cloudflareManifestSchema = z
  .object({
    kinds: z.record(z.enum(CLOUDFLARE_KINDS), cloudflareKindStatusSchema),
    platform: z.literal(CLOUDFLARE_ATLAS_PLATFORM),
    schemaVersion: z.literal(CLOUDFLARE_ATLAS_SCHEMA_VERSION),
    /** `null` only for a freshly reset atlas that has never completed a sync. */
    selection: cloudflareSelectionSchema.nullable(),
    updatedAt: isoSchema,
  })
  .strict();

export type CloudflareManifest = z.infer<typeof cloudflareManifestSchema>;

/** The live-verified account/deep-zone scope, once resolved — see `client.ts`'s `resolveLiveCloudflareScope`. */
export type CloudflareSelection = z.infer<typeof cloudflareSelectionSchema>;

/**
 * A manifest with every kind present, never synced, and no selection recorded yet.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialCloudflareManifest({ updatedAt }: { updatedAt: string }): CloudflareManifest {
  const empty: CloudflareKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  // `as`: Object.fromEntries widens keys to string; we built it from the exhaustive CLOUDFLARE_KINDS, so the
  // narrower CloudflareKind-keyed type is sound.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(CLOUDFLARE_KINDS.map((kind) => [kind, empty])) as Record<
    CloudflareKind,
    CloudflareKindStatus
  >;
  return {
    kinds,
    platform: CLOUDFLARE_ATLAS_PLATFORM,
    schemaVersion: CLOUDFLARE_ATLAS_SCHEMA_VERSION,
    selection: null,
    updatedAt,
  };
}

/**
 * An empty kind file.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyCloudflareKindFile({
  kind,
  updatedAt,
}: {
  kind: CloudflareKind;
  updatedAt: string;
}): CloudflareKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: CLOUDFLARE_ATLAS_PLATFORM,
    schemaVersion: CLOUDFLARE_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
