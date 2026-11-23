/**
 * The two database reads the door's catch-up makes before it applies anything, each over a real store migrated
 * through this tree: the code an additive statement could reach, and the ledger instant drizzle's migrator selects by.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { migratorSelectionDeclined, reachableCode } from "../../../store/catchUpCatalog.js";
import { readJournal } from "../../../store/lifecycle.js";
import { REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";
import { openProofTemplate, type ProofDatabase, type ProofTemplate, proofAdminUrl } from "../proofDatabase.js";

import { ADDITIVE_SQL, fixtureCheckout } from "./catchUpFixture.js";

const ADMIN_URL = proofAdminUrl();

describe.skipIf(ADMIN_URL === undefined)("the catch-up's catalog reads, over a real store", () => {
  // Built in the hooks, never at collection: `skipIf` still runs this body.
  let template: ProofTemplate;
  let database: ProofDatabase;
  let root: string;

  beforeAll(async () => {
    template = await openProofTemplate({ adminUrl: ADMIN_URL!, prefix: "catch_up_catalog" });
  }, 120_000);

  afterAll(async () => {
    await template.drop();
  });

  beforeEach(async () => {
    database = await template.open();
    root = mkdtempSync(join(tmpdir(), "sw-catalog-"));
  }, 60_000);

  afterEach(async () => {
    rmSync(root, { force: true, recursive: true });
    await database.drop();
  });

  it("reads no reachable code on a store holding only what its migrations created", async () => {
    expect(unwrap(await reachableCode({ url: database.storeUrl }))).toEqual([]);
  });

  it(
    "finds the migrator in step with a journal one landed entry ahead, and declines once the ledger's instant moves",
    async () => {
      const journal = unwrap(readJournal({ cwd: fixtureCheckout({ landed: true, root, sql: ADDITIVE_SQL }) }));
      const applied = journal.length - 1;

      expect(unwrap(await migratorSelectionDeclined({ applied, journal, url: database.storeUrl }))).toBe(undefined);

      const sql = postgres(database.storeUrl, { max: 1, onnotice: () => {} });
      try {
        await sql.unsafe(
          "update drizzle.__drizzle_migrations set created_at = created_at - 1 where id = (select max(id) from drizzle.__drizzle_migrations)",
        );
      } finally {
        await sql.end({ timeout: 5 });
      }

      expect(unwrap(await migratorSelectionDeclined({ applied, journal, url: database.storeUrl }))).toContain(
        "not caught up, because the ledger's last created_at is",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
