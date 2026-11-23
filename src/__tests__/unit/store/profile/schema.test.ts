/**
 * The three schema facts this change rests on, asserted against the files that actually create the
 * database and against the module that actually writes people.
 *
 * ## Why the reconciler is checked by reading its source
 *
 * The ruling puts per-person judgement on the SAME table the member pull rewrites, so "a refresh cannot
 * clobber curation" is the load-bearing claim and it is a property of the reconciler's own column list
 * rather than of the column. Its upsert names each overwritten column explicitly, so the check is exactly
 * "does any identity write name this column" — and a source scan answers that with no database. A runtime test
 * would need a live Postgres and would still only prove the paths it exercised; this proves every write
 * site in the module, including one added tomorrow.
 *
 * ## Why the grants list is checked rather than trusted
 *
 * MEASURED and recorded in `store/policies.ts`: a policy set can be complete and still deny
 * everyone, because a policy is never consulted for a role that cannot reach the relation. A new table
 * missing from `storeTables()` therefore reads as protected while being unreadable, and the unit tests of
 * the statement list pass throughout — so the agreement between the two lists is asserted here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { storeTables } from "../../../../store/policies.js";
import { OWNER_PROFILE_ID } from "../../../../store/schema/ownerProfile.js";

/** Every generated migration, concatenated — the DDL that actually creates this database. */
function allMigrations(): string {
  const dir = join(process.cwd(), "supabase", "migrations");
  const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  return journal.entries.map((entry) => readFileSync(join(dir, `${entry.tag}.sql`), "utf8")).join("\n");
}

describe("the generated DDL", () => {
  it("creates the table dedicated to the owner", () => {
    expect(allMigrations()).toContain('CREATE TABLE "owner_profile"');
  });

  it("pins that table to a single row in the database rather than in a convention", () => {
    expect(allMigrations()).toContain(`CHECK (id = '${OWNER_PROFILE_ID}')`);
  });

  it("creates the measured voice register keyed on surface and cohort", () => {
    expect(allMigrations()).toContain('PRIMARY KEY("owner_id","surface","cohort")');
  });

  it("adds the judgement column to the identity register", () => {
    expect(allMigrations()).toContain('ALTER TABLE "person" ADD COLUMN "judgement" jsonb');
  });
});

describe("the grant list", () => {
  it("covers the owner table, or its policies would be consulted for nobody", () => {
    expect(storeTables()).toContain("owner_profile");
  });

  it("covers the voice register", () => {
    expect(storeTables()).toContain("owner_voice_register");
  });
});

describe("identity reconciliation", () => {
  it("never names the judgement column in any write, so a member pull cannot clobber curation", () => {
    const source = readFileSync(join(process.cwd(), "src", "store", "identity", "reconcile.ts"), "utf8");
    expect(source).not.toContain("judgement");
  });

  it("does upsert people there, so the check above is over a file that really writes the table", () => {
    const source = readFileSync(join(process.cwd(), "src", "store", "identity", "reconcile.ts"), "utf8");
    expect(source).toContain(".insert(personTable)");
  });

  it("enumerates the columns a conflicting row overwrites, rather than overwriting the row", () => {
    const source = readFileSync(join(process.cwd(), "src", "store", "identity", "reconcile.ts"), "utf8");
    expect(source).toContain("displayName: sql`excluded.display_name`");
  });
});
