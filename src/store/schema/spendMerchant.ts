/**
 * The card merchants this install groups its card charges under — written whole by `slopweaver spend merchants set`
 * and read only through `../../spend/merchants/store.ts`.
 *
 * A company's accounts, preferences and policies live in the database, and the repository stays
 * stateless. Which merchants a company's card pays, how its provider spells them and where their receipts come from
 * is that company's, so it is rows here rather than a list in code. An empty table is a statement, not an absence:
 * every charge then groups under its own merchant string.
 *
 * The domain parser (`../../spend/merchants/core.ts`) stays the authority on overlapping prefixes and receipt-domain
 * shape: a row a hand-edit left wrong is refused on read, never trusted because the column types allowed it.
 */
import { pgTable, text } from "drizzle-orm/pg-core";

import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** One registered merchant: its slug, the prefixes its charges are billed under, and its receipt domains. */
export const spendMerchantTable = pgTable(
  "spend_merchant",
  {
    slug: text("slug").primaryKey(),
    prefixes: text("prefixes").array().notNull(),
    receiptDomains: text("receipt_domains").array().notNull(),
  },
  () => [...storeTablePolicies({ botRead: botSeesEverything(), table: "spend_merchant" })],
);

/** One merchant row as the database returns it. */
export type SpendMerchantRow = typeof spendMerchantTable.$inferSelect;

/** One merchant row as an insert takes it. */
export type NewSpendMerchantRow = typeof spendMerchantTable.$inferInsert;
