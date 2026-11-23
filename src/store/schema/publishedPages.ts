/**
 * Published pages in the store: identity, the current files and the frozen versions as rows, every body as one
 * content-addressed object in the private `published-pages` bucket (`ensureBucket`, `../objects/client.ts`).
 *
 * A page lives in the store only, with no
 * persistent copy or mirror on the file system. [The published pages doc](../../../docs/store/published-pages.md)
 * carries the shape and the stages.
 *
 * ## Every body is an object, the small ones too
 *
 * `measurement_blob` keeps a small text body inline and `published_page_blob` deliberately does not. One placement
 * means one read path, exact bytes for every page, and a restore proof that covers every body the same way.
 *
 * ## Two pointers on a page, and why one would lie
 *
 * `current_body_sha256` is what a reader opens and `latest_frozen_body_sha256` is what a correction diffs against. A
 * publish that wrote the page and failed its freeze leaves the two different, and a single "latest" would either show
 * the owner a stale page or diff a correction against bytes the owner never read.
 *
 * ## A key is a slug, or a freeze key with no page
 *
 * A `local` row's `page_key` is its slug. A `history-only` row is a freeze-store directory with versions and no
 * current page, which is what an artifact id from before local pages is.
 *
 * ## Only a local page has files and aliases
 *
 * A CHECK cannot read another table, so `published_page_file` and `published_page_alias` each carry `page_kind`, fixed
 * to `local` and foreign-keyed with `page_key` to `published_page (page_key, kind)`. A file or an alias on a history
 * with no page is then refused by the database, where it would otherwise resolve to something no reader can serve.
 */
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** One distinct file body. The object's key in the bucket is this row's `body_sha256`. */
export const publishedPageBlobTable = pgTable(
  "published_page_blob",
  {
    /** Lower-case hex sha-256 of the exact bytes, and the object's key. */
    bodySha256: text("body_sha256").primaryKey(),
    /** The size in bytes, so a restore can check it wrote back what was read. */
    byteLength: integer("byte_length").notNull(),
    /** The content type a reader serves the body as. */
    mediaType: text("media_type").notNull(),
    /** When the store first held this body. */
    firstStoredAt: timestamp("first_stored_at", { mode: "date", precision: 3, withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  () => [
    check("published_page_blob_sha_shape", sql`body_sha256 ~ '^[0-9a-f]{64}$'`),
    check("published_page_blob_byte_length_non_negative", sql`byte_length >= 0`),
    ...storeTablePolicies({ botRead: sql`false`, table: "published_page_blob" }),
  ],
);

/** One page, or one history with no page: its identity and the two pointers into its bodies. */
export const publishedPageTable = pgTable(
  "published_page",
  {
    /** The slug of a `local` page, or the freeze key of a `history-only`. */
    pageKey: text("page_key").primaryKey(),
    /** `local` is a page a reader opens; `history-only` is frozen versions with no current page. */
    kind: text("kind").notNull(),
    /** The `file:///…/pages/<slug>/index.html` address records name the page by. An identity, never a readable file. */
    canonicalAddress: text("canonical_address"),
    /** What a reader opens. */
    currentBodySha256: text("current_body_sha256").references(() => publishedPageBlobTable.bodySha256),
    /** What a correction diffs against, null when no freeze of this page ever completed. */
    latestFrozenBodySha256: text("latest_frozen_body_sha256").references(() => publishedPageBlobTable.bodySha256),
    /** When that freeze was taken, null exactly when the pointer is. */
    latestFrozenAt: timestamp("latest_frozen_at", { mode: "date", precision: 3, withTimezone: true }),
    /** When the current body was published, which `page find` ranks recency by. */
    publishedAt: timestamp("published_at", { mode: "date", precision: 3, withTimezone: true }),
  },
  (table) => [
    unique("published_page_key_kind").on(table.pageKey, table.kind),
    check("published_page_key_shape", sql`page_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'`),
    check("published_page_kind", sql`kind in ('local', 'history-only')`),
    check(
      "published_page_local_shape",
      sql`(kind = 'local') = (canonical_address is not null)
        and (kind = 'local') = (current_body_sha256 is not null)
        and (kind = 'local') = (published_at is not null)`,
    ),
    check("published_page_frozen_pair", sql`(latest_frozen_body_sha256 is null) = (latest_frozen_at is null)`),
    ...storeTablePolicies({ botRead: sql`false`, table: "published_page" }),
  ],
);

/** One file a page currently serves: `index.html` is the document, every other row a file it links. */
export const publishedPageFileTable = pgTable(
  "published_page_file",
  {
    pageKey: text("page_key").notNull(),
    /** Always `local`; the half of the foreign key that keeps a file off a history with no page. */
    pageKind: text("page_kind").default("local").notNull(),
    /** The path under the page, `/`-separated, exactly as a relative link in the page names it. */
    relativePath: text("relative_path").notNull(),
    bodySha256: text("body_sha256")
      .notNull()
      .references(() => publishedPageBlobTable.bodySha256),
  },
  (table) => [
    primaryKey({ columns: [table.pageKey, table.relativePath], name: "published_page_file_pk" }),
    foreignKey({
      columns: [table.pageKey, table.pageKind],
      foreignColumns: [publishedPageTable.pageKey, publishedPageTable.kind],
      name: "published_page_file_local_page_fk",
    }),
    check("published_page_file_kind_local", sql`page_kind = 'local'`),
    check(
      "published_page_file_path_shape",
      sql`relative_path ~ '^[^/]+(/[^/]+)*$' and relative_path !~ '\\\\' and relative_path !~ '(^|/)\\.{1,2}(/|$)'`,
    ),
    index("idx_published_page_file_sha").on(table.bodySha256),
    ...storeTablePolicies({ botRead: sql`false`, table: "published_page_file" }),
  ],
);

/** One frozen version of a page. Republishing identical bytes is the same version, as the freeze always was. */
export const publishedPageVersionTable = pgTable(
  "published_page_version",
  {
    pageKey: text("page_key")
      .notNull()
      .references(() => publishedPageTable.pageKey),
    bodySha256: text("body_sha256")
      .notNull()
      .references(() => publishedPageBlobTable.bodySha256),
    /** When this version was first frozen; an imported version is dated by its import, its real date never recorded. */
    firstFrozenAt: timestamp("first_frozen_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    /** `published` for a freeze the store took, `imported` for one carried over from the old folder. */
    origin: text("origin").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.pageKey, table.bodySha256], name: "published_page_version_pk" }),
    check("published_page_version_origin", sql`origin in ('published', 'imported')`),
    index("idx_published_page_version_sha").on(table.bodySha256),
    ...storeTablePolicies({ botRead: sql`false`, table: "published_page_version" }),
  ],
);

/** An address spelled some other way than a page's canonical one, so a record holding it keeps resolving. */
export const publishedPageAliasTable = pgTable(
  "published_page_alias",
  {
    /** The address, exactly as a record spells it. */
    address: text("address").primaryKey(),
    pageKey: text("page_key").notNull(),
    /** Always `local`; the half of the foreign key that keeps an alias off a history with no page. */
    pageKind: text("page_kind").default("local").notNull(),
    /** Where the spelling was found. */
    source: text("source").notNull(),
    discoveredAt: timestamp("discovered_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.pageKey, table.pageKind],
      foreignColumns: [publishedPageTable.pageKey, publishedPageTable.kind],
      name: "published_page_alias_local_page_fk",
    }),
    check("published_page_alias_kind_local", sql`page_kind = 'local'`),
    check("published_page_alias_address_shape", sql`length(address) > 0`),
    check("published_page_alias_source", sql`source in ('home-register', 'store-row', 'symlink-resolved')`),
    index("idx_published_page_alias_key").on(table.pageKey),
    ...storeTablePolicies({ botRead: sql`false`, table: "published_page_alias" }),
  ],
);

/** A body as the database returns it. */
export type PublishedPageBlobRecord = typeof publishedPageBlobTable.$inferSelect;

/** A page as the database returns it. */
export type PublishedPageRecord = typeof publishedPageTable.$inferSelect;

/** A served file as the database returns it. */
export type PublishedPageFileRecord = typeof publishedPageFileTable.$inferSelect;

/** A frozen version as the database returns it. */
export type PublishedPageVersionRecord = typeof publishedPageVersionTable.$inferSelect;

/** An alias as the database returns it. */
export type PublishedPageAliasRecord = typeof publishedPageAliasTable.$inferSelect;

/** A body as an import writes it. */
export type NewPublishedPageBlobRecord = typeof publishedPageBlobTable.$inferInsert;

/** A page as an import writes it. */
export type NewPublishedPageRecord = typeof publishedPageTable.$inferInsert;

/** A served file as an import writes it. */
export type NewPublishedPageFileRecord = typeof publishedPageFileTable.$inferInsert;

/** A frozen version as an import writes it. */
export type NewPublishedPageVersionRecord = typeof publishedPageVersionTable.$inferInsert;
