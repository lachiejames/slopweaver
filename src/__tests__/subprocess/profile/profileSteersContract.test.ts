/**
 * The PRODUCER half of the `profile steers --json` contract, over the whole production seam: the shipped
 * `bin/slopweaver` spawned against a REAL, freshly migrated store, its home's legacy journal imported into the store on
 * first read, and its stdout pinned to a golden file the console's reader (`site/components/live/readSlackSteers.ts`)
 * is tested against in `site/__tests__/unit/profileSteersContract.test.ts`. The two halves live in separate Yarn
 * projects and neither may import the other's graph, so they meet in ONE file,
 * `src/__tests__/fixtures/contract/profile-steers.json`.
 *
 * A subprocess-lane file because it spawns the shipped CLI: that lane builds the tree it spawns, and its job already
 * runs the one Postgres service the door ledger needs, so this proof adds no second container (a service of its own on
 * the integration job cost that job 32s, run 41310095813). REQUIRED in CI, where the subprocess job names the service's
 * admin connection; this file throws at collection when CI is set and the URL is not, so a lane without the service
 * reads red, never skipped. Locally it is opt-in, handed the stack's ADMIN connection, and creates, migrates and drops
 * its own throwaway database — it never touches the database the admin URL names:
 *
 *   PROFILE_STEERS_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/profile/profileSteersContract.test.ts
 *
 * A change to what the verb prints fails here until the golden is re-cut (the same command with `--update`), and the
 * re-cut golden fails the site half until the reader draws it.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { type SteerVerdict, steerVerdictLine } from "../../../profile/steerKinds.js";
import { stateHomePaths } from "../../../stateHome.js";
import { STORE_URL_ENV } from "../../../store/client.js";
import { applyStore } from "../../../store/migrate.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";

const ADMIN_URL = process.env["PROFILE_STEERS_PROOF_ADMIN_URL"];

if (process.env["CI"] === "true" && ADMIN_URL === undefined) {
  throw new Error(
    "PROFILE_STEERS_PROOF_ADMIN_URL is unset in CI: the subprocess job's Postgres service is what this proof runs on, so a lane without it must fail rather than skip",
  );
}

/** Where both halves read the contract; relative to this file, as `toMatchFileSnapshot` resolves it. */
const GOLDEN = "../../fixtures/contract/profile-steers.json";

/** The shipped entrypoint, run exactly as an operator runs it. */
const BIN = fileURLToPath(new URL("../../../../bin/slopweaver", import.meta.url));

/** The instant the reading is taken at, so the window and every day count are fixed. */
const NOW = "2026-10-20T00:00:00.000Z";

/** One correction of one kind, inside the default window. */
const CORRECTS: SteerVerdict = {
  anchor: "slack:acme/C0FIXTURE/1760000000.000100",
  judgedAtIso: "2026-10-10T00:00:00.000Z",
  kind: "em-dashes",
  quote: "no em dashes",
  says: "corrects",
  turnAtIso: "2026-10-09T23:00:00.000Z",
};

describe.skipIf(ADMIN_URL === undefined)(
  "profile steers --json from a real store, the contract the console reads",
  () => {
    const database = `profile_steers_proof_${randomUUID().slice(0, 8)}`;
    // Built in `beforeAll`, never at collection: `skipIf` still runs this body.
    let admin: postgres.Sql;
    let storeUrl: string;
    let root: string;

    beforeAll(async () => {
      admin = postgres(ADMIN_URL!, { max: 1, onnotice: () => {} });
      const url = new URL(ADMIN_URL!);
      url.pathname = `/${database}`;
      storeUrl = url.toString();
      await admin.unsafe(`create database ${database}`);
      unwrap(await applyStore({ url: storeUrl }));
      root = mkdtempSync(join(tmpdir(), "sw-steers-proof-"));
    }, 120_000);

    afterAll(async () => {
      rmSync(root, { force: true, recursive: true });
      await admin.unsafe(`drop database if exists ${database} with (force)`);
      await admin.end();
    });

    it("imports the home's legacy journal, then prints exactly the golden the console's reader is tested against", async () => {
      const home = join(root, "home");
      const paths = stateHomePaths({ home });
      mkdirSync(paths.judgement.root, { recursive: true });
      // A line that does not read comes first, so the reading names it by its place in the file.
      writeFileSync(paths.judgement.steerKindsJsonl, `not json\n${steerVerdictLine({ verdict: CORRECTS })}\n`, "utf8");
      const operatorHome = join(root, "operator");
      mkdirSync(operatorHome);

      const run = spawnSync(BIN, ["profile", "steers", "--json", "--home", home, "--now", NOW], {
        encoding: "utf8",
        env: { ...accountSandboxChildEnv(), HOME: operatorHome, PATH: process.env["PATH"]!, [STORE_URL_ENV]: storeUrl },
        timeout: 60_000,
      });

      expect([run.status, run.stderr]).toEqual([0, ""]);
      // Re-indented so a re-cut golden diffs line by line; the bytes the console parses are the same document.
      const printed: unknown = JSON.parse(run.stdout);
      await expect(`${JSON.stringify(printed, null, 2)}\n`).toMatchFileSnapshot(GOLDEN);
    }, 120_000);
  },
);
