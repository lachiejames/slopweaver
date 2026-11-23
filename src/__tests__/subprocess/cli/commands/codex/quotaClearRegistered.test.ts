/**
 * The SHIPPED `codex quota clear` on a REGISTERED Codex plan, with and without a cached record. Both cases must
 * leave a clear mark, because the refusal this verb is named in can stand on Codex's own rollout log with no cached
 * record at all — the case that answered "had no cached record" and cleared nothing. The unit lane proves the
 * decision honours a mark (`unit/codex/quotaNow.test.ts`); this proves the verb writes one, under `--home`, and says so.
 *
 * `--plan` names a registered Codex plan and there is no default: a login merely found in `$CODEX_HOME` is never a
 * plan. So the destination resolves through the register, which lives in the store — each case
 * runs over a throwaway migrated database (`../../../proofDatabase.ts`) that imports the seeded `plans.json`. The
 * refusal of an unnamed `--plan` reads no register, so it runs store-free beside this file (`quotaClear.test.ts`).
 *
 * REQUIRED in CI, where the subprocess job names `STORE_PROOF_ADMIN_URL`: this file throws at collection when CI is
 * set and the URL is not, so a lane without the service reads red, never skipped. Locally it is opt-in:
 *
 *   STORE_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/cli/commands/codex/quotaClearRegistered.test.ts
 *
 * `show` is never run here: it asks the store's app-server for a live reading, and this lane launches nothing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  codexQuotaCacheStanding,
  readCodexQuotaClearMark,
  writeCodexQuotaCache,
} from "../../../../../codex/quotaCache.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { STORE_URL_ENV } from "../../../../../store/config.js";
import { openProofTemplate, type ProofDatabase, type ProofTemplate, proofAdminUrl } from "../../../proofDatabase.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const ADMIN_URL = proofAdminUrl();

if (process.env["CI"] === "true" && ADMIN_URL === undefined) {
  throw new Error(
    "STORE_PROOF_ADMIN_URL is unset in CI: the subprocess job's Postgres service is what this proof runs on, so a lane without it must fail rather than skip",
  );
}

/** The one Codex plan the user registered in each case's home. */
const ALIAS = "codex-one";

describe.skipIf(ADMIN_URL === undefined)("bin/slopweaver codex quota clear, over a real store", () => {
  // Built in the hooks, never at collection: `skipIf` still runs this body.
  let template: ProofTemplate;
  let database: ProofDatabase;
  let home: string;

  beforeAll(async () => {
    template = await openProofTemplate({ adminUrl: ADMIN_URL!, prefix: "quota_clear_proof" });
  }, 120_000);

  afterAll(async () => {
    await template.drop();
  });

  beforeEach(async () => {
    database = await template.open();
    home = mkdtempSync(join(tmpdir(), "quota-clear-"));
    const plansJson = stateHomePaths({ home }).plansJson;
    mkdirSync(dirname(plansJson), { recursive: true });
    writeFileSync(
      plansJson,
      JSON.stringify({ rows: [{ alias: ALIAS, provider: "codex", storeDir: join(home, "codex-one") }], version: 1 }),
      "utf8",
    );
  }, 60_000);

  afterEach(async () => {
    rmSync(home, { force: true, recursive: true });
    await database.drop();
  });

  /**
   * Run the shipped `codex quota clear --plan` against this test's own state home and store.
   *
   * `HOME` stays the runner's own, as `handover/auditRulings.test.ts` keeps it: the toolchain shim resolves the
   * pinned Node from it, and this verb reads nothing under it — the state home is `--home` and `SLOPWEAVER_HOME`.
   */
  function clear(): { status: number | null; stdout: string } {
    const result = spawnSync(BIN, ["codex", "quota", "clear", "--plan", ALIAS, "--home", home], {
      encoding: "utf8",
      env: {
        CODEX_HOME: join(home, "ambient-codex"),
        HOME: process.env["HOME"]!,
        PATH: process.env["PATH"]!,
        SLOPWEAVER_CLI_DIR: repoRoot,
        SLOPWEAVER_HOME: home,
        TMPDIR: process.env["TMPDIR"]!,
        [STORE_URL_ENV]: database.storeUrl,
      },
      timeout: 60_000,
    });
    // `null` when the child died on a signal, which `toBe(0)` reports as itself rather than as a stand-in number.
    return { status: result.status, stdout: result.stdout };
  }

  it(
    "records a clear mark when there was NO cached record, and says rollout evidence before it is disregarded",
    { timeout: 60_000 },
    () => {
      const run = clear();
      const mark = readCodexQuotaClearMark({ alias: ALIAS, home })!;

      expect(run.status).toBe(0);
      expect(Number.isFinite(Date.parse(mark))).toBe(true);
      expect(run.stdout).toBe(
        `codex quota clear: ${ALIAS} had no cached record; rollout-log evidence observed before ${mark} is disregarded\n`,
      );
    },
  );

  it("disarms a cached record with a clear mark, deleting nothing", { timeout: 60_000 }, () => {
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "usage-limit", observedAtIso: "2026-09-11T07:31:24.321Z" },
      home,
    });

    const run = clear();
    const mark = readCodexQuotaClearMark({ alias: ALIAS, home })!;

    expect(run.status).toBe(0);
    expect(existsSync(join(stateHomePaths({ home }).codexQuotaDir, `${ALIAS}.json`))).toBe(true);
    expect(codexQuotaCacheStanding({ alias: ALIAS, home })).toBe("covered");
    expect(run.stdout).toBe(
      `codex quota clear: ${ALIAS}'s cached record is disregarded; evidence observed before ${mark} no longer refuses\n`,
    );
  });

  // The stand-in for a cap another process cached after the mark: observed later than any clear this run can take.
  it("keeps a cached record observed after the mark, so that cap still refuses", { timeout: 60_000 }, () => {
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "usage-limit", observedAtIso: "2999-01-01T00:00:00.000Z" },
      home,
    });

    const run = clear();
    const mark = readCodexQuotaClearMark({ alias: ALIAS, home })!;

    expect(run.status).toBe(0);
    expect(codexQuotaCacheStanding({ alias: ALIAS, home })).toBe("standing");
    expect(run.stdout).toBe(
      `codex quota clear: ${ALIAS}'s cached record was observed after ${mark}, so it still refuses; older evidence is disregarded\n`,
    );
  });
});
