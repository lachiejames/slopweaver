/**
 * `readLandedMigrations` over a real git repository: what it hashes is the resolved `origin/main` commit's own
 * migrations, never another commit's that a `refs/replace/` ref would substitute under the same id.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readLandedMigrations } from "../../../store/lifecycle.js";
import { MIGRATIONS_DIR } from "../../../store/migrate.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** The text a commit's one migration carries. */
const LANDED_SQL = 'CREATE TABLE "landed" ("id" integer);\n';
const REPLACED_SQL = 'DROP TABLE "landed";\n';

/**
 * Commit one migration file holding `sql` and return the commit id.
 *
 * @param cwd the fixture repository
 * @param sql the migration's contents
 * @returns the new commit's id
 */
function commitMigration({ cwd, sql }: { cwd: string; sql: string }): string {
  writeFileSync(join(cwd, MIGRATIONS_DIR, "0001_proof.sql"), sql);
  gitInTemp({ args: ["add", "."], cwd });
  gitInTemp({ args: ["commit", "--quiet", "--message", sql], cwd });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd });
}

describe("readLandedMigrations over a real repository", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "sw-landed-"));
    mkdirSync(join(cwd, MIGRATIONS_DIR), { recursive: true });
    gitInTemp({ args: ["init", "--quiet", "--initial-branch", "main"], cwd });
    gitInTemp({ args: ["config", "user.email", "proof@example.invalid"], cwd });
    gitInTemp({ args: ["config", "user.name", "proof"], cwd });
  });

  afterEach(() => {
    rmSync(cwd, { force: true, recursive: true });
  });

  it(
    "hashes origin/main's own migration even when refs/replace/ points that commit at another",
    () => {
      const landed = commitMigration({ cwd, sql: LANDED_SQL });
      const replacement = commitMigration({ cwd, sql: REPLACED_SQL });
      gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", landed], cwd });
      gitInTemp({ args: ["replace", landed, replacement], cwd });

      expect(gitInTemp({ args: ["show", `${landed}:${MIGRATIONS_DIR}/0001_proof.sql`], cwd })).toBe(
        REPLACED_SQL.trim(),
      );
      const read = readLandedMigrations({ cwd });

      expect(read).toEqual({
        baseRef: "origin/main",
        hashes: new Map([["0001_proof", createHash("sha256").update(LANDED_SQL).digest("hex")]]),
      });
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
