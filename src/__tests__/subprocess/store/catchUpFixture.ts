/**
 * The fixture checkout `./catchUp.test.ts` opens the store from: this tree's migrations plus one synthetic one,
 * with `refs/remotes/origin/main` deciding whether that migration has landed.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { MIGRATIONS_DIR } from "../../../store/migrate.js";
import { gitInTemp } from "../../tempGitRepo.js";

/** This tree, whose committed migrations the template was migrated through. */
const TREE = fileURLToPath(new URL("../../../../", import.meta.url));

/** The synthetic migration's tag — sorted after every real one, and named for the catch-up proof. */
export const TAG = "9999_catch_up_proof";

/** A purely additive statement: a table no schema declares, which verify does not count as a finding. */
export const ADDITIVE_SQL = 'CREATE TABLE "catch_up_proof" (\n\t"id" integer PRIMARY KEY NOT NULL\n);\n';

/** A statement off the additive allowlist, harmless here because the table does not exist. */
export const SUBTRACTIVE_SQL = 'DROP TABLE IF EXISTS "catch_up_proof_absent";\n';

/** The journal's shape, as far as this file reads and writes it; any other top-level field is kept as it was. */
const JournalSchema = z.looseObject({
  entries: z.array(
    z.object({ breakpoints: z.boolean(), idx: z.number(), tag: z.string(), version: z.string(), when: z.number() }),
  ),
});

/**
 * Build a fixture checkout holding this tree's migrations plus {@link TAG}, with `origin/main` pointing at the
 * commit that adds it when `landed`, else at the commit before.
 *
 * @param root the temp directory the checkout is made in
 * @param sql the synthetic migration's contents, text or raw bytes
 * @param landed whether `origin/main` carries it
 * @returns the checkout's path
 */
export function fixtureCheckout({
  root,
  sql,
  landed,
}: {
  root: string;
  sql: string | Buffer;
  landed: boolean;
}): string {
  const cwd = join(root, "checkout");
  const migrations = join(cwd, MIGRATIONS_DIR);
  mkdirSync(cwd, { recursive: true });
  cpSync(join(TREE, MIGRATIONS_DIR), migrations, { recursive: true });
  gitInTemp({ args: ["init", "--quiet", "--initial-branch", "main"], cwd });
  gitInTemp({ args: ["config", "user.email", "proof@example.invalid"], cwd });
  gitInTemp({ args: ["config", "user.name", "proof"], cwd });
  gitInTemp({ args: ["add", "."], cwd });
  gitInTemp({ args: ["commit", "--quiet", "--message", "the migrations the store already has"], cwd });
  const before = gitInTemp({ args: ["rev-parse", "HEAD"], cwd });
  const journalPath = join(migrations, "meta", "_journal.json");
  const journal = JournalSchema.parse(JSON.parse(readFileSync(journalPath, "utf8")));
  const last = journal.entries.at(-1)!;
  journal.entries.push({ breakpoints: true, idx: last.idx + 1, tag: TAG, version: last.version, when: last.when + 1 });
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  writeFileSync(join(migrations, `${TAG}.sql`), sql);
  gitInTemp({ args: ["add", "."], cwd });
  gitInTemp({ args: ["commit", "--quiet", "--message", "one more migration"], cwd });
  const after = gitInTemp({ args: ["rev-parse", "HEAD"], cwd });
  gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", landed ? after : before], cwd });
  return cwd;
}
