/**
 * The small registers against a REAL store: the facts an in-memory store cannot prove — the known-id CHECK,
 * the `jsonb` round trip, the one-time import's `ON CONFLICT DO NOTHING` under a real concurrent importer, the
 * compare-and-set predicate deciding a real race, and a session list keeping its order through `jsonb`.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's, and whose
 * `singleton_register` rows ARE this install's registers. This file deletes every register row before and after every
 * case:
 *
 *   PGPASSWORD=postgres createdb -w -h 127.0.0.1 -p 55322 -U postgres singleton_register_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/singleton_register_proof slopweaver store push
 *
 * (Before its migration lands, that push wants `SLOPWEAVER_ALLOW_UNLANDED_MIGRATION=1`, whose named exception is
 * exactly a throwaway database like this one.)
 *
 *   SINGLETON_REGISTER_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/singleton_register_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/singletonRegisterStore.test.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { recordedProfilePort } from "../../browser/recordedProfile.js";
import { staleSeatNoticesPort } from "../../cli/staleSeatNotices.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { gmailTriageRulesPort } from "../../live/gmail/triageRuleStore.js";
import { identityRosterPort } from "../../silver/identityRoster.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { SINGLETON_REGISTER_IDS, singletonRegisterTable } from "../../store/schema/singletonRegister.js";

const PROOF_URL = process.env["SINGLETON_REGISTER_PROOF_URL"];

describe.skipIf(PROOF_URL === undefined)("the small registers in a real store", () => {
  let client: StoreClient;
  let home = "";

  const deleteTheRows = async (): Promise<void> => {
    await client.db
      .delete(singletonRegisterTable)
      .where(inArray(singletonRegisterTable.id, [...SINGLETON_REGISTER_IDS]));
  };

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await deleteTheRows();
    await client.close();
  });

  beforeEach(async () => {
    // Per case, not once: `setup-ambient-home.ts` clears the selector after EVERY test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await deleteTheRows();
    home = mkdtempSync(join(tmpdir(), "singleton-register-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a row whose id is not a declared register: the set is closed by CHECK", async () => {
    await expect(
      client.db
        .insert(singletonRegisterTable)
        .values({ document: {}, id: "another" as "browser-profile", revision: 1 }),
    ).rejects.toThrow();
  });

  it("imports the retired browser.json once; the file changing afterwards changes nothing", async () => {
    writeFileSync(stateHomePaths({ home }).browserJson, JSON.stringify({ profileDirectory: "Profile 2" }), "utf8");
    const first = unwrap(await recordedProfilePort().read({ home }));
    expect(first.directory).toBe("Profile 2");
    expect(first.revision).toBe(1);
    writeFileSync(stateHomePaths({ home }).browserJson, JSON.stringify({ profileDirectory: "Default" }), "utf8");
    const again = unwrap(await recordedProfilePort().read({ home }));
    expect(again.directory).toBe("Profile 2");
    expect(again.inertFile).toBe(stateHomePaths({ home }).browserJson);
  });

  it("two importers racing on a fresh store leave exactly one row, and both read it", async () => {
    writeFileSync(stateHomePaths({ home }).browserJson, JSON.stringify({ profileDirectory: "Profile 2" }), "utf8");
    const [left, right] = await Promise.all([
      recordedProfilePort().read({ home }),
      recordedProfilePort().read({ home }),
    ]);
    expect(unwrap(left).revision).toBe(1);
    expect(unwrap(right).revision).toBe(1);
    const rows = await client.db.select().from(singletonRegisterTable);
    expect(rows.map((row) => row.id)).toEqual(["browser-profile"]);
  });

  it("a compare-and-set decides a real race: one writer at revision 1 wins, the other is refused", async () => {
    unwrap(await recordedProfilePort().record({ directory: "Default", expectedRevision: null, home }));
    const [left, right] = await Promise.all([
      recordedProfilePort().record({ directory: "Profile 1", expectedRevision: 1, home }),
      recordedProfilePort().record({ directory: "Profile 2", expectedRevision: 1, home }),
    ]);
    const outcomes = [left, right].map((result) => (result.isOk() ? "won" : result.error.code)).toSorted();
    expect(outcomes).toEqual(["PROFILE_REVISION_CONFLICT", "won"]);
    expect(unwrap(await recordedProfilePort().read({ home })).revision).toBe(2);
  });

  it("keeps the noticed sessions' order through jsonb, oldest first", async () => {
    const ids = ["zeta", "alpha", "mu"];
    unwrap(
      await staleSeatNoticesPort().replace({
        document: { noticedSessions: ids, schemaVersion: 1 },
        expectedRevision: null,
        home,
      }),
    );
    expect(unwrap(await staleSeatNoticesPort().read({ home }))).toEqual({ noticedSessions: ids, revision: 1 });
  });

  it("an install's triage rules import once into their own row, beside the other registers", async () => {
    writeFileSync(
      stateHomePaths({ home }).gmailTriageRulesJson,
      JSON.stringify({
        rules: [
          {
            anchor: "transcript:fixture#1",
            key: "from:alerts@acme.example",
            kind: "from",
            sender: "Acme alerts",
            why: "the same alert reaches the team channel",
          },
        ],
        schemaVersion: 1,
      }),
      "utf8",
    );
    const read = unwrap(await gmailTriageRulesPort().read({ home }));
    expect(read.revision).toBe(1);
    expect(read.rules.map((rule) => rule.key)).toEqual(["from:alerts@acme.example"]);
  });

  it("the identity roster imports once, keeps its order and duplicates through jsonb, and decides a real race", async () => {
    const ada = { handle: "ada", heardAs: ["Aida"], id: "U0FIXTUREADA", name: "Ada Acme" };
    const bob = { handle: "bob", id: "U0FIXTUREBOB", name: "Bob Acme" };
    writeFileSync(stateHomePaths({ home }).identityJson, JSON.stringify([bob, ada, bob]), "utf8");
    const [left, right] = await Promise.all([identityRosterPort().read({ home }), identityRosterPort().read({ home })]);
    expect([unwrap(left).revision, unwrap(right).revision]).toEqual([1, 1]);
    expect(unwrap(left).records).toEqual([bob, ada, bob]);
    writeFileSync(stateHomePaths({ home }).identityJson, JSON.stringify([ada]), "utf8");
    expect(unwrap(await identityRosterPort().read({ home })).records).toEqual([bob, ada, bob]);
    const [first, second] = await Promise.all([
      identityRosterPort().replace({ expectedRevision: 1, home, records: [ada] }),
      identityRosterPort().replace({ expectedRevision: 1, home, records: [bob] }),
    ]);
    const outcomes = [first, second].map((result) => (result.isOk() ? "won" : result.error.code)).toSorted();
    expect(outcomes).toEqual(["IDENTITY_ROSTER_REVISION_CONFLICT", "won"]);
    expect(unwrap(await identityRosterPort().read({ home })).revision).toBe(2);
  });

  it("an unreachable store refuses the identity roster, never reading the retired file", async () => {
    writeFileSync(stateHomePaths({ home }).identityJson, JSON.stringify([{ id: "U0FIXTUREADA" }]), "utf8");
    process.env[STORE_URL_ENV] = "postgresql://postgres:postgres@127.0.0.1:1/nothing";
    expect(unwrapErr(await identityRosterPort().read({ home })).code).toBe("IDENTITY_ROSTER_STORE_UNAVAILABLE");
  });

  it("an unreachable store is a typed refusal, never the file", async () => {
    writeFileSync(stateHomePaths({ home }).browserJson, JSON.stringify({ profileDirectory: "Profile 2" }), "utf8");
    process.env[STORE_URL_ENV] = "postgresql://postgres:postgres@127.0.0.1:1/nothing";
    expect(unwrapErr(await recordedProfilePort().read({ home })).code).toBe("PROFILE_STORE_UNAVAILABLE");
  });
});
