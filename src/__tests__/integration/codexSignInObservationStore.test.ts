/**
 * The Codex sign-in observations against a REAL store: the facts an in-memory port cannot prove — the alias key and
 * its insert-if-absent, the revision CHECK, the compare-and-set predicate deciding a real race, the `jsonb` round
 * trip, and an unreachable store refusing rather than reading a file.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's. This file deletes every
 * `codex_sign_in_observation` row before and after every case:
 *
 *   createdb -w --maintenance-db=postgresql://postgres:postgres@127.0.0.1:55322/postgres codex_sign_in_proof
 *   SLOPWEAVER_ALLOW_UNLANDED_MIGRATION=1 \
 *     SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/codex_sign_in_proof slopweaver store push
 *   CODEX_SIGN_IN_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/codex_sign_in_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/codexSignInObservationStore.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CodexAccountLive } from "../../codex/accountLiveParse.js";
import type { CodexSignInRecord } from "../../codex/signInRecord.js";
import { codexSignInRowsOver, productionCodexSignInSeams } from "../../codex/signInRecordRows.js";
import { storeCodexSignInPort } from "../../codex/signInRecordStore.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { codexSignInObservationTable } from "../../store/schema/codexSignInObservation.js";

const PROOF_URL = process.env["CODEX_SIGN_IN_PROOF_URL"];
const HOME_ONE = "/stores/codex-one";

/** A refusal as an earlier fleet read filed it into the file this store replaced. */
const FILED: CodexSignInRecord = {
  alias: "codex-one",
  authStamp: { ctimeMs: 10, kind: "present", mtimeMs: 10, size: 900 },
  codexHome: HOME_ONE,
  failingSinceIso: "2026-10-31T08:00:00.000Z",
  readAtIso: "2026-10-31T08:00:00.000Z",
  state: "signed-out",
};

const signedIn: CodexAccountLive = {
  accountId: "acct",
  codexHome: HOME_ONE,
  email: "codex-1@example.org",
  gauges: [],
  kind: "signed-in",
  ordinaryUsageAllowed: true,
  planType: "plus",
  readAtIso: "2026-10-31T09:00:00.000Z",
  resetCreditsAvailable: 0,
};

describe.skipIf(PROOF_URL === undefined)("the Codex sign-in observations in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storeCodexSignInPort({ seams: productionCodexSignInSeams() });

  const deleteEveryRow = async (): Promise<void> => {
    await client.db.delete(codexSignInObservationTable);
  };
  const storedRow = async () =>
    (
      await client.db
        .select()
        .from(codexSignInObservationTable)
        .where(eq(codexSignInObservationTable.alias, "codex-one"))
    )[0];

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await deleteEveryRow();
    await client.close();
  });

  beforeEach(async () => {
    // Per case, not once: `setup-ambient-home.ts` clears the selector after EVERY test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await deleteEveryRow();
    home = mkdtempSync(join(tmpdir(), "codex-sign-in-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("imports a file once at revision 1, and the row stays the authority after the file changes", async () => {
    const dir = stateHomePaths({ home }).codexSignInDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "codex-one.json"), JSON.stringify(FILED), "utf8");
    const imported = unwrap(await port.read({ aliases: ["codex-one"], home }));
    writeFileSync(join(dir, "codex-one.json"), JSON.stringify({ ...FILED, state: "capped" }), "utf8");
    const again = unwrap(await port.read({ aliases: ["codex-one"], home }));
    const row = await storedRow();

    const expected = [{ alias: "codex-one", kind: "record", record: FILED, revision: 1 }];
    expect([imported, again]).toEqual([expected, expected]);
    expect([row!.revision, row!.record]).toStrictEqual([1, FILED]);
  });

  it("inserts nothing for an alias with neither a row nor a file", async () => {
    expect(unwrap(await port.read({ aliases: ["codex-one"], home }))).toEqual([{ alias: "codex-one", kind: "absent" }]);
    expect(await storedRow()).toBe(undefined);
  });

  it("files a later signed-in read over a refusal by compare-and-set, dropping failingSinceIso in jsonb", async () => {
    await client.db.insert(codexSignInObservationTable).values({ alias: "codex-one", record: FILED, revision: 1 });
    const stamp = FILED.authStamp;
    const written = unwrap(
      await port.record({
        home,
        observed: [{ alias: "codex-one", authAfter: stamp, authBefore: stamp, live: signedIn }],
      }),
    );
    const row = await storedRow();

    expect(written).toEqual([{ alias: "codex-one", kind: "written", revision: 2 }]);
    expect([row!.revision, row!.record]).toStrictEqual([
      2,
      {
        alias: "codex-one",
        authStamp: stamp,
        codexHome: HOME_ONE,
        readAtIso: "2026-10-31T09:00:00.000Z",
        state: "signed-in",
      },
    ]);
  });

  it("lets exactly one of two writers pinned to the same revision win, and loses a second insert", async () => {
    const rows = codexSignInRowsOver({ client });
    const first = unwrap(await rows.insert({ alias: "codex-one", record: FILED }));
    const lostInsert = unwrap(await rows.insert({ alias: "codex-one", record: { ...FILED, codexHome: "/elsewhere" } }));
    const winner = unwrap(
      await rows.update({
        alias: "codex-one",
        expectedRevision: 1,
        record: { ...FILED, readAtIso: signedIn.readAtIso },
      }),
    );
    const loser = unwrap(await rows.update({ alias: "codex-one", expectedRevision: 1, record: FILED }));

    expect([first!.revision, lostInsert, winner!.revision, loser]).toEqual([1, undefined, 2, undefined]);
    expect((await storedRow())!.record).toStrictEqual({ ...FILED, readAtIso: signedIn.readAtIso });
  });

  it("refuses a revision below 1: the CAS pin is a CHECK, not a convention", async () => {
    await expect(
      client.db.insert(codexSignInObservationTable).values({ alias: "codex-one", record: FILED, revision: 0 }),
    ).rejects.toThrow();
  });

  it("refuses as unavailable when the selected store cannot be reached, and reads no file", async () => {
    const dir = stateHomePaths({ home }).codexSignInDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "codex-one.json"), JSON.stringify(FILED), "utf8");
    process.env[STORE_URL_ENV] = "postgresql://postgres:postgres@127.0.0.1:1/codex_sign_in_proof";
    const refused = unwrapErr(await port.read({ aliases: ["codex-one"], home }));

    expect(refused.code).toBe("CODEX_SIGN_IN_STORE_UNAVAILABLE");
    expect(await storedRow()).toBe(undefined);
  });
});
