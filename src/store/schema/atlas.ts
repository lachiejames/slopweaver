/**
 * The five atlas tables — what each platform's local ground-truth map CONTAINS, in the database rather
 * than in 834 JSONL files nothing backs up.
 *
 * Everything is taken out of the user-level Slopweaver directory and put into the store, atlases included,
 * because the store is where all the data sits.
 *
 * ## Their own tables, never `content` rows
 *
 * The atlas is DISTINCT from the corpus — a bridge from atlas to retrieval is rejected on exactly that.
 * An atlas says what a PLATFORM contains; the
 * corpus says what this organisation SAID. Folding one into the other would make a Cloudflare zone
 * rule and a Slack message the same kind of row, and every retrieval over `content` would start answering
 * with infrastructure. So these five tables sit beside `content` and share nothing with it.
 *
 * ## The keys are NATURAL, which is a departure from the house surrogate `uuid`
 *
 * `content` and its four per-source tables use a surrogate `uuid` primary key
 * (`./content.ts`, `./sourceRows.ts`). {@link atlasEntityTable} and {@link atlasEntityChannelTable} use the
 * natural `(platform, kind, entity_id)` instead, and the reason is the LOADER rather than taste.
 *
 * A kind file is streamed a line at a time — its size is a property of the tenant, and one Cloudflare
 * account's `pages-project` document measured over a hundred MiB (`src/atlas/atlasFile.ts`'s header). An entity and
 * its channel views arrive on the SAME line, so with a surrogate key the loader would have to insert the
 * entity, read its generated id back, and hold an id-per-entity map before it could write a single channel
 * row — re-introducing the whole-file buffering the streaming exists to avoid, one layer down. With the
 * natural key the entity batch and the channel batch are built in one pass and neither waits on the other.
 *
 * The cost is measured and small: the three key columns repeated on the channel table are about 57 bytes
 * per row against a `uuid`'s 16, over 696,261 channel rows, roughly 30 MB against a 1,063 MB fresh load.
 * The benefit is that a channel row is self-describing, so `select … from atlas_entity_channel where platform = 'vanta'`
 * needs no join at all.
 *
 * ## A generation is a TRANSACTION, which is what this leg is for
 *
 * `src/atlas/kit/generationSwap.ts`'s own header names the residue the filesystem cannot close: _"what it
 * cannot do is survive a process KILL mid-commit … closing that needs the whole generation to hang off one
 * renameable pointer, which is a layout change across every atlas"_. In Postgres a transaction IS that
 * pointer. The loader replaces one `(platform, kind)` slice inside one transaction, so the store version is
 * strictly safer than the two-phase rename on disk — an argument for the tables existing, not a detail of
 * them.
 *
 * ## Nullability here is MEASURED, not defensive
 *
 * Every column that could have been `notNull` and is not was measured against the live estate,
 * streaming all 834 kind files under `$SLOPWEAVER_HOME/atlas`:
 *
 * - `atlas_coverage.surface` and `.role` — absent from cloudflare's 66 coverage cells.
 * - `atlas_coverage.visibility_scope` — absent from datadog's 434.
 * - `atlas_gap.fields` and `.surfaces` — absent on cloudflare (10), datadog (448), onepassword (3) and
 *   vanta (36); stored as empty arrays rather than nulls, since a missing list and an empty list say the
 *   same thing about a gap.
 * - `atlas_entity_channel.endpoint`/`.deep_link`/`.deep_link_status` — cloudflare's `source` carries
 *   `{channel, observedAt, operation}` and none of the three; the other three pre-`channels` platforms
 *   carry `{artifacts, deepLink, deepLinkStatus, endpoint, observedAt, surface}` and no `channel`.
 *
 * Reproduce any of them by reading line 1 of every kind file under each platform directory in
 * `~/.slopweaver/atlas` (excluding the `_`-prefixed ones) and testing for the field.
 *
 * ## The bot is denied all five
 *
 * Same posture as `./memories.ts`, for the same reason: these files are `0600` on disk today, so the
 * conservative port denies the Slack-facing role outright rather than widening access in the migration that
 * creates the table. An atlas carries account ids, internal hostnames, serial numbers and prevention-policy
 * settings. It is opened per platform later, when a verb earns it.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { ATLAS_COVERAGE_STATES, ATLAS_ENTITY_STATES, ATLAS_EVIDENCE_ROLES } from "../../atlas/kit/contract.js";

import { storeTablePolicies } from "./rls.js";

/**
 * Whether a channel still sees an entity. Built from the kit's own tuple rather than restated, so the
 * database vocabulary and the vocabulary `kit/merge.ts` assigns cannot drift — see
 * `src/atlas/kit/contract.ts`'s {@link ATLAS_ENTITY_STATES} for why that constant exists at all.
 */
export const atlasEntityStateEnum = pgEnum("atlas_entity_state", ATLAS_ENTITY_STATES);

/** How readable one scope is. The kit's {@link ATLAS_COVERAGE_STATES}, which grades a SCOPE, not an entity. */
export const atlasCoverageStateEnum = pgEnum("atlas_coverage_state", ATLAS_COVERAGE_STATES);

/** What a surface's evidence is worth. The kit's {@link ATLAS_EVIDENCE_ROLES}. */
export const atlasEvidenceRoleEnum = pgEnum("atlas_evidence_role", ATLAS_EVIDENCE_ROLES);

/**
 * One thing one platform contains, as the atlas knows it.
 *
 * `entity_id` is the atlas's own `id` — a content hash the platform's projection mints — and `provider_id`
 * is the platform's own handle for the same thing. Both are strings on every one of the hundreds of thousands
 * of rows measured on disk, including the over a hundred thousand written before the `channels` layout existed, so neither is
 * nullable and neither needs deriving.
 *
 * `extra` holds the fields a platform carries beside the canonical four. Measured across the whole estate
 * those are exactly four names over nine platforms — `scope` (airtable, datadog, figma, knock, nx-cloud,
 * prisma-data-platform), `family` (canva, google-admin, nightfall), and `sensitivity`/`financialDetail`
 * (vanta) — on tens of thousands of the hundreds of thousands of rows. One `jsonb` bag rather than a column
 * per platform, and NO GIN index on it: an index over a column that is `{}` on nearly all rows costs more than the queries it would serve,
 * and the searchable payload is {@link atlasEntityChannelTable}'s `detail`, which does carry one.
 */
export const atlasEntityTable = pgTable(
  "atlas_entity",
  {
    platform: text("platform").notNull(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    providerId: text("provider_id").notNull(),
    extra: jsonb("extra").$type<Record<string, unknown>>().default({}).notNull(),
    /** The envelope's `updatedAt` — which GENERATION this row came from, not when it was loaded. */
    generationAt: timestamp("generation_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    loadedAt: timestamp("loaded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("uq_atlas_entity").on(table.platform, table.kind, table.entityId),
    index("idx_atlas_entity_platform_kind").on(table.platform, table.kind),
    // The handle a human or another verb actually has — an operation name, a Vanta slug, a device serial.
    index("idx_atlas_entity_provider").on(table.providerId),
    ...storeTablePolicies({ botRead: sql`false`, table: "atlas_entity" }),
  ],
);

/**
 * One channel's independent view of one entity.
 *
 * ## Why a table and not a column
 *
 * An entity on disk is a MAP of channel views keyed by channel name, not one view — `kit/channelEntity.ts`
 * exists precisely so one surface succeeding can never erase what another already knew, and a run projects
 * only the channel it refreshed. A scalar `channel` column on {@link atlasEntityTable} would split one
 * entity into two rows that nothing joins, which is the divergence the two-surface design makes an OUTPUT.
 *
 * ## The pre-`channels` rows are not a separate shape
 *
 * Over a hundred thousand of the hundreds of thousands of entity rows on disk predate the `channels` map.
 * Measured, every one of them is a SINGLE-channel entity whose view is the row's own `{state, firstSeenAt,
 * lastSeenAt?, source, detail?}` — the exact fields a `ChannelView` carries — and every one names its
 * channel, in `source.channel` (cloudflare, tens of thousands) or `source.surface` (crowdstrike tens of
 * thousands, aether hundreds, github a handful). **Zero name
 * neither.** So the loader needs one fallback rule and no per-platform adapter, and this table holds both
 * shapes without knowing which it came from.
 *
 * `surface` is kept beside `channel` rather than collapsed into it because for those rows the two ARE the
 * same string and for a channelled row the surface is not recorded at all — dropping it would make the
 * pre-`channels` rows unattributable to the surface that read them.
 */
export const atlasEntityChannelTable = pgTable(
  "atlas_entity_channel",
  {
    platform: text("platform").notNull(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    channel: text("channel").notNull(),
    state: atlasEntityStateEnum("state").notNull(),
    firstSeenAt: timestamp("first_seen_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { mode: "date", precision: 3, withTimezone: true }),
    /** The reproduction handle — the operation, page or document this view came from. */
    endpoint: text("endpoint"),
    surface: text("surface"),
    deepLink: text("deep_link"),
    deepLinkStatus: text("deep_link_status"),
    artifacts: jsonb("artifacts").$type<readonly unknown[]>().default([]).notNull(),
    /**
     * What this channel knows about the entity — the platform's own subject matter, opaque here by
     * construction (`kit/channelEntity.ts`: _"the wrapper generalises exactly because it never looks
     * inside"_). Nullable because the kit's own schema is `z.unknown().nullable()`: a channel that saw an
     * entity exists without learning anything about it is a different fact from one carrying `{}`.
     */
    detail: jsonb("detail"),
  },
  (table) => [
    unique("uq_atlas_entity_channel").on(table.platform, table.kind, table.entityId, table.channel),
    // The composite key back to the entity, cascading — so replacing one `(platform, kind)` slice is ONE
    // delete rather than two that a crash could separate, and an orphan channel view (a claim about an
    // entity the atlas no longer holds) cannot exist. `content_slack` carries the same shape for the same
    // reason; see `./rls.ts`'s `botSeesPublicParent` header on what a composite key does NOT carry.
    foreignKey({
      columns: [table.platform, table.kind, table.entityId],
      foreignColumns: [atlasEntityTable.platform, atlasEntityTable.kind, atlasEntityTable.entityId],
      name: "fk_atlas_entity_channel_entity",
    }).onDelete("cascade"),
    index("idx_atlas_entity_channel_entity").on(table.platform, table.kind, table.entityId),
    index("idx_atlas_entity_channel_channel").on(table.platform, table.channel),
    // The searchable payload. `jsonb_path_ops` rather than the default operator class: it indexes only
    // whole paths, which is what a containment query over a detail bag asks, and measured it
    // was 13% of a loaded kind's total relation size — the jsonb heap is the cost driver, not this.
    index("idx_atlas_entity_channel_detail").using("gin", sql`${table.detail} jsonb_path_ops`),
    ...storeTablePolicies({ botRead: sql`false`, table: "atlas_entity_channel" }),
  ],
);

/**
 * One kind's publication status, as its platform's `manifest.json` records it.
 *
 * Derived from bytes that already exist — the manifest is written LAST in a generation because it names the
 * files, so it is the publication authority — and never re-gathered from a provider. 850 rows over the 35
 * platforms that have a manifest.
 *
 * `digest` is the hash of the exact kind-file bytes on disk (`atlasFile.ts`'s `digestOfKindFile`), so a
 * loader may compare it to decide a slice is unchanged. That makes it a load fast path, not decoration.
 */
export const atlasKindStatusTable = pgTable(
  "atlas_kind_status",
  {
    platform: text("platform").notNull(),
    kind: text("kind").notNull(),
    digest: text("digest"),
    entityCount: integer("entity_count").notNull(),
    schemaVersion: integer("schema_version"),
    /** Present on 74 of 834 envelopes; the generation's own read epoch where an atlas stamps one. */
    readEpoch: text("read_epoch"),
    lastAttemptAt: timestamp("last_attempt_at", { mode: "date", precision: 3, withTimezone: true }),
    lastAttemptOutcome: text("last_attempt_outcome"),
    lastAttemptReasons: text("last_attempt_reasons").array().default([]).notNull(),
    lastSuccessAt: timestamp("last_success_at", { mode: "date", precision: 3, withTimezone: true }),
    /** `kit/permissionBlock.ts`'s record, absent on every manifest written before the block existed. */
    permissionBlocked: jsonb("permission_blocked"),
    generationAt: timestamp("generation_at", { mode: "date", precision: 3, withTimezone: true }),
    loadedAt: timestamp("loaded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("uq_atlas_kind_status").on(table.platform, table.kind),
    index("idx_atlas_kind_status_success").on(table.platform, table.lastSuccessAt.desc()),
    ...storeTablePolicies({ botRead: sql`false`, table: "atlas_kind_status" }),
  ],
);

/**
 * One coverage cell off a kind file's envelope — how readable one SCOPE was, and what its evidence is worth.
 *
 * 1,703 cells across the estate. `(platform, kind, scope, surface)` collided on none of them, so it is the
 * key — declared `nullsNotDistinct` because cloudflare's 66 cells carry no `surface` at all and Postgres
 * would otherwise treat every one of those NULLs as a distinct value, letting a re-load duplicate them.
 */
export const atlasCoverageTable = pgTable(
  "atlas_coverage",
  {
    platform: text("platform").notNull(),
    kind: text("kind").notNull(),
    scope: text("scope").notNull(),
    surface: text("surface"),
    state: atlasCoverageStateEnum("state").notNull(),
    role: atlasEvidenceRoleEnum("role"),
    reason: text("reason").notNull(),
    lastSuccessAt: timestamp("last_success_at", { mode: "date", precision: 3, withTimezone: true }),
    latestAttemptFailed: boolean("latest_attempt_failed").notNull(),
    unblockedBy: text("unblocked_by"),
    visibilityScope: text("visibility_scope"),
    artifacts: jsonb("artifacts").$type<readonly unknown[]>().default([]).notNull(),
    loadedAt: timestamp("loaded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("uq_atlas_coverage").on(table.platform, table.kind, table.scope, table.surface).nullsNotDistinct(),
    index("idx_atlas_coverage_state").on(table.platform, table.state),
    ...storeTablePolicies({ botRead: sql`false`, table: "atlas_coverage" }),
  ],
);

/**
 * One gap off a kind file's envelope — something the atlas knows it does not know.
 *
 * ## The key is `(platform, kind, gap_id)`, and the estate violates it tens of thousands of times
 *
 * MEASURED: the hundreds of envelopes carry tens of thousands of gap records of which only a few thousand
 * are distinct under `(platform, kind, id)` — one directory platform's applications file alone holds dozens
 * of gap records that are a handful of distinct ones, with a single id repeated several times. Every colliding group is BYTE-IDENTICAL: a `sortDeep` +
 * `JSON.stringify` comparison across every group in the estate found **0** lossy collapses. Reproduce by
 * reading line 1 of every kind file, grouping `gaps[]` on `(kind, id)` and comparing serialisations.
 *
 * So this unique constraint is correct and loses nothing — but it is a GUARD, not the fix. The duplication
 * is a defect in whatever writes `gaps[]`, invisible until now because nothing ever counted it, which is
 * why the loader collapses them in memory and REPORTS the count per platform rather than letting an upsert
 * absorb them silently.
 */
export const atlasGapTable = pgTable(
  "atlas_gap",
  {
    platform: text("platform").notNull(),
    kind: text("kind").notNull(),
    gapId: text("gap_id").notNull(),
    condition: text("condition").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    scope: text("scope").notNull(),
    fields: text("fields").array().default([]).notNull(),
    surfaces: text("surfaces").array().default([]).notNull(),
    firstDetectedAt: timestamp("first_detected_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    lastDetectedAt: timestamp("last_detected_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { mode: "date", precision: 3, withTimezone: true }),
    loadedAt: timestamp("loaded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("uq_atlas_gap").on(table.platform, table.kind, table.gapId),
    index("idx_atlas_gap_status").on(table.platform, table.status),
    ...storeTablePolicies({ botRead: sql`false`, table: "atlas_gap" }),
  ],
);

/** One atlas entity as the database returns it. */
export type AtlasEntityRow = typeof atlasEntityTable.$inferSelect;

/** One atlas entity as an insert takes it. */
export type NewAtlasEntityRow = typeof atlasEntityTable.$inferInsert;

/** One channel view as the database returns it. */
export type AtlasEntityChannelRow = typeof atlasEntityChannelTable.$inferSelect;

/** One channel view as an insert takes it. */
export type NewAtlasEntityChannelRow = typeof atlasEntityChannelTable.$inferInsert;

/** One kind's publication status as the database returns it. */
export type AtlasKindStatusRow = typeof atlasKindStatusTable.$inferSelect;

/** One kind's publication status as an insert takes it. */
export type NewAtlasKindStatusRow = typeof atlasKindStatusTable.$inferInsert;

/** One coverage cell as the database returns it. */
export type AtlasCoverageRow = typeof atlasCoverageTable.$inferSelect;

/** One coverage cell as an insert takes it. */
export type NewAtlasCoverageRow = typeof atlasCoverageTable.$inferInsert;

/** One gap as the database returns it. */
export type AtlasGapRow = typeof atlasGapTable.$inferSelect;

/** One gap as an insert takes it. */
export type NewAtlasGapRow = typeof atlasGapTable.$inferInsert;
