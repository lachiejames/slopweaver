/**
 * This install's own knowledge domains and the retired spellings that fold into them — the part of the knowledge
 * register's closed vocabulary that names an organisation's own systems, so it is state and never code.
 *
 * `src/knowledge/domains.ts` commits the generic vocabulary and `src/knowledge/installDomains.ts` carries every
 * check an install addition is held to. This table is where the install's additions LIVE: the old
 * `knowledge/domains.json` is imported once (`./homeFileImport.ts`) and never read again.
 *
 * ## One namespace for domains and aliases
 *
 * A domain and an alias share the primary key, so an alias can never race a domain under the same spelling: two
 * concurrent `knowledge domains add` calls naming one slug end with exactly one row. Nothing updates or deletes a
 * row — the vocabulary only grows, the same rule the file held — so an insert that loses on the key is the whole
 * compare-and-set.
 *
 * An alias carries no foreign key to its target: it may fold into a committed domain or an atlas platform, and
 * neither has a row here. The checks `installDomainProblems` runs decide that before any insert.
 *
 * The bot is denied the table: these are the organisation's own system names.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** One install domain, or one retired spelling of a domain. */
export const knowledgeDomainTable = pgTable(
  "knowledge_domain",
  {
    /** The domain or the retired spelling, in the knowledge register's slug shape. */
    slug: text("slug").primaryKey(),
    /** `domain` for one of the install's own domains, `alias` for a spelling that folds into one. */
    kind: text("kind").$type<"domain" | "alias">().notNull(),
    /** What a domain holds; null on an alias. */
    holds: text("holds"),
    /** The domain an alias folds into; null on a domain. */
    foldsInto: text("folds_into"),
    createdAt: timestamp("created_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("knowledge_domain_kind", sql`kind in ('domain', 'alias')`),
    check("knowledge_domain_slug_shape", sql`length(slug) between 2 and 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      "knowledge_domain_row_shape",
      sql`(kind = 'domain' and holds is not null and btrim(holds) <> '' and folds_into is null) or (kind = 'alias' and holds is null and folds_into is not null)`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "knowledge_domain" }),
  ],
);

/** A domain row as the database returns it. */
export type KnowledgeDomainRow = typeof knowledgeDomainTable.$inferSelect;
