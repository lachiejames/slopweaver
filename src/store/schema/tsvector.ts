/**
 * Postgres's `tsvector`, which Drizzle has no builder for — declared once, used by every searchable table.
 *
 * MEASURED on `./content.ts`, which is where this type was first needed: declaring the column
 * as `text` typechecks, generates a migration cleanly, and FAILS when that migration is applied —
 * `data type text has no default operator class for access method "gin"`. Only running the DDL surfaces
 * it, which is why the migration is applied against a real Postgres in this repo's tests rather than
 * trusted because it generated.
 *
 * It moved out of `./content.ts` when `./memories.ts` became the second table wanting one. Two copies of a
 * custom type is two places a `dataType()` can drift, and a drift here is invisible until a migration is
 * applied — the exact failure the measurement above describes.
 */
import { customType } from "drizzle-orm/pg-core";

/** The `tsvector` column type. Always generated and STORED, never written by an application. */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
