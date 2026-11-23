/**
 * An install's own knowledge domains against a REAL store: the facts an in-memory port cannot prove — the CHECK
 * constraints, the one-time import committing its marker and rows together under two racing first readers, the
 * slug primary key deciding a race between two adds, and the add's transaction rolling back whole.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's, and the file refuses it.
 * This file deletes every row of `knowledge_domain`, and that register's import marker, before and after every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres knowledge_domain_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/knowledge_domain_proof slopweaver store push
 *   KNOWLEDGE_DOMAIN_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/knowledge_domain_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/knowledgeDomainStore.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { storeKnowledgeDomainPort } from "../../knowledge/domainPort.js";
import { knowledgeDomainRowsOver, productionKnowledgeDomainSeams } from "../../knowledge/domainStoreRows.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { homeFileImportTable } from "../../store/schema/homeFileImport.js";
import { knowledgeDomainTable } from "../../store/schema/knowledgeDomain.js";
import { refuseLiveStore } from "../proofStoreUrl.js";

const PROOF_URL = process.env["KNOWLEDGE_DOMAIN_STORE_PROOF_URL"];
const ACME_ENTRY = { holds: "the synthetic team monorepo", slug: "acme" } as const;

describe.skipIf(PROOF_URL === undefined)("an install's own knowledge domains in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storeKnowledgeDomainPort({ seams: productionKnowledgeDomainSeams() });

  const clearTheRegister = async (): Promise<void> => {
    await client.db.delete(knowledgeDomainTable);
    await client.db.delete(homeFileImportTable).where(eq(homeFileImportTable.register, "knowledge-domains"));
  };

  const storedSlugs = async (): Promise<readonly string[]> =>
    (
      await client.db
        .select({ slug: knowledgeDomainTable.slug })
        .from(knowledgeDomainTable)
        .orderBy(asc(knowledgeDomainTable.slug))
    ).map((row) => row.slug);

  beforeAll(() => {
    refuseLiveStore({ url: PROOF_URL!, variable: "KNOWLEDGE_DOMAIN_STORE_PROOF_URL" });
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await clearTheRegister();
    await client.close();
  });

  beforeEach(async () => {
    // Per case, not once: `setup-ambient-home.ts` clears the selector after EVERY test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    home = mkdtempSync(join(tmpdir(), "kd-proof-"));
    await clearTheRegister();
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a slug that is not one, and a row that is both a domain and an alias, at the CHECK", async () => {
    const badSlug = client.db.insert(knowledgeDomainTable).values({ holds: "x", kind: "domain", slug: "Acme Repo" });
    const bothShapes = client.db
      .insert(knowledgeDomainTable)
      .values({ foldsInto: "ci", holds: "x", kind: "domain", slug: "acme" });
    await expect(badSlug).rejects.toThrow();
    await expect(bothShapes).rejects.toThrow();
    expect(await storedSlugs()).toEqual([]);
  });

  it("imports the retired file once under two racing first readers, then answers from the rows alone", async () => {
    const path = stateHomePaths({ home }).knowledgeDomainsJson;
    mkdirSync(join(home, "knowledge"), { recursive: true });
    writeFileSync(path, JSON.stringify({ aliases: { "acme-e2e": "acme" }, domains: [ACME_ENTRY] }));
    const [first, second] = await Promise.all([port.read({ home }), port.read({ home })]);
    writeFileSync(path, JSON.stringify({ aliases: {}, domains: [] }));
    const later = unwrap(await port.read({ home }));
    const expected = { aliases: { "acme-e2e": "acme" }, domains: [ACME_ENTRY], home };
    expect([unwrap(first), unwrap(second), later]).toEqual([expected, expected, expected]);
    expect(await storedSlugs()).toEqual(["acme", "acme-e2e"]);
  });

  it("adds a domain and its aliases, and refuses the same slug again with nothing written", async () => {
    expect(unwrap(await port.add({ aliases: { "acme-e2e": "acme" }, entry: ACME_ENTRY, home }))).toEqual({
      aliases: { "acme-e2e": "acme" },
      domains: [ACME_ENTRY],
      home,
    });
    expect(unwrapErr(await port.add({ aliases: {}, entry: ACME_ENTRY, home })).code).toBe(
      "KNOWLEDGE_DOMAINS_ADD_REFUSED",
    );
    expect(await storedSlugs()).toEqual(["acme", "acme-e2e"]);
  });

  it("lets the slug key decide two racing inserts of one domain: one commits, the other names the slug", async () => {
    const rowsA = knowledgeDomainRowsOver({ client: openStore({ url: PROOF_URL! }) });
    const rowsB = knowledgeDomainRowsOver({ client: openStore({ url: PROOF_URL! }) });
    const records = [{ holds: ACME_ENTRY.holds, kind: "domain" as const, slug: "acme" }];
    const outcomes = await Promise.all([rowsA.insertAll({ records }), rowsB.insertAll({ records })]);
    await rowsA.close();
    await rowsB.close();
    const answers = outcomes.map((outcome) => unwrap(outcome));
    expect(answers.toSorted((a, b) => Number(b.inserted) - Number(a.inserted))).toEqual([
      { inserted: true },
      { inserted: false, taken: ["acme"] },
    ]);
    expect(await storedSlugs()).toEqual(["acme"]);
  });

  it("decides two adds racing over the same two slugs in opposite order as a conflict, never a deadlock", async () => {
    const fooFirst = [
      { holds: "one repository", kind: "domain" as const, slug: "foo" },
      { foldsInto: "foo", kind: "alias" as const, slug: "bar" },
    ];
    const barFirst = [
      { holds: "another repository", kind: "domain" as const, slug: "bar" },
      { foldsInto: "bar", kind: "alias" as const, slug: "foo" },
    ];
    // Twenty rounds, because one interleaving may never reach the lock order a deadlock needs.
    const rounds = await Array.from({ length: 20 }).reduce<Promise<readonly string[]>>(async (previous) => {
      const seen = await previous;
      await clearTheRegister();
      const rowsA = knowledgeDomainRowsOver({ client: openStore({ url: PROOF_URL! }) });
      const rowsB = knowledgeDomainRowsOver({ client: openStore({ url: PROOF_URL! }) });
      const outcomes = await Promise.all([
        rowsA.insertAll({ records: fooFirst }),
        rowsB.insertAll({ records: barFirst }),
      ]);
      await rowsA.close();
      await rowsB.close();
      const answers = outcomes.map((outcome) => unwrap(outcome));
      const shape = answers
        .map((answer) => (answer.inserted ? "inserted" : `taken:${answer.taken.toSorted().join(",")}`))
        .toSorted()
        .join(" ");
      return [...seen, shape];
    }, Promise.resolve([]));
    expect(rounds).toEqual(Array.from({ length: 20 }, () => "inserted taken:bar,foo"));
    expect(await storedSlugs()).toEqual(["bar", "foo"]);
  });

  it("rolls the whole add back when one of its slugs was already taken", async () => {
    await client.db.insert(knowledgeDomainTable).values({ foldsInto: "ci", kind: "alias", slug: "acme-e2e" });
    const rows = knowledgeDomainRowsOver({ client: openStore({ url: PROOF_URL! }) });
    const outcome = unwrap(
      await rows.insertAll({
        records: [
          { holds: ACME_ENTRY.holds, kind: "domain", slug: "acme" },
          { foldsInto: "acme", kind: "alias", slug: "acme-e2e" },
        ],
      }),
    );
    await rows.close();
    expect(outcome).toEqual({ inserted: false, taken: ["acme-e2e"] });
    expect(await storedSlugs()).toEqual(["acme-e2e"]);
  });
});
