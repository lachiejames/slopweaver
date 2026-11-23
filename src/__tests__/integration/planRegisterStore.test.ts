/**
 * The plan register against a REAL store: the facts an in-memory port cannot prove — the singleton CHECK, the
 * `jsonb` round trip keeping a field no version declares, the compare-and-set predicate deciding a real race,
 * and a committed row surviving a projection that failed after it.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's, and whose
 * `plan_register` row IS this install's fleet. This file deletes that table's singleton row before and after
 * every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres plan_register_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/plan_register_proof slopweaver store push
 *   PLAN_REGISTER_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/plan_register_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/planRegisterStore.test.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import { storePlanRegisterPort } from "../../plans/storePort.js";
import { planRegisterRowsOver, productionPlanRegisterSeams } from "../../plans/storeRows.js";
import type { PlanRegisterDocument } from "../../plans/types.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { PLAN_REGISTER_ID, planRegisterTable } from "../../store/schema/planRegister.js";

const PROOF_URL = process.env["PLAN_REGISTER_PROOF_URL"];
const NOW = "2026-10-31T09:00:00.000Z";

/** A register carrying a row field and a document field no version here declares. */
const LEGACY: PlanRegisterDocument & { readonly futureTop: string } = {
  futureTop: "keep me too",
  rows: [
    { alias: "codex-one", futureField: "keep me", provider: "codex", storeDir: "/stores/codex-one" },
    { alias: "codex-two", provider: "codex", storeDir: "/stores/codex-two" },
  ],
  version: 1,
};

describe.skipIf(PROOF_URL === undefined)("the plan register in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storePlanRegisterPort({ seams: productionPlanRegisterSeams() });
  const request = (): { home: string } => ({ home });

  const deleteTheRow = async (): Promise<void> => {
    await client.db.delete(planRegisterTable).where(eq(planRegisterTable.id, PLAN_REGISTER_ID));
  };

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await deleteTheRow();
    await client.close();
  });

  beforeEach(async () => {
    // Per case, not once: `setup-ambient-home.ts` clears the selector after EVERY test, so a `beforeAll` value
    // reaches only the first case and every later one reads "no database is selected".
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await deleteTheRow();
    home = mkdtempSync(join(tmpdir(), "plan-register-proof-"));
    writeFileSync(stateHomePaths({ home }).plansJson, JSON.stringify(LEGACY), "utf8");
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a second register row: the table is a singleton by CHECK, not by convention", async () => {
    await expect(
      client.db.insert(planRegisterTable).values({ document: LEGACY, id: "another", revision: 1 }),
    ).rejects.toThrow();
  });

  it("imports plans.json once at revision 1, keeping every field no version declares through jsonb", async () => {
    const snapshot = unwrap(await port.read(request()));
    const [row] = await client.db.select().from(planRegisterTable).where(eq(planRegisterTable.id, PLAN_REGISTER_ID));

    expect(snapshot.revision).toBe(1);
    expect(row!.revision).toBe(1);
    expect(row!.document).toStrictEqual(LEGACY);
  });

  it("keeps the row authoritative over a plans.json changed, or broken, after the import", async () => {
    unwrap(await port.read(request()));
    writeFileSync(stateHomePaths({ home }).plansJson, "{ not json", "utf8");

    const snapshot = unwrap(await port.read(request()));

    expect(snapshot.plans.map((plan) => plan.alias)).toStrictEqual(["codex-one", "codex-two"]);
    // The Claude projection was never written by a READ, so only the plans.json note is this case's evidence.
    const aboutPlansJson = snapshot.diagnostics.filter((note) => note.message.includes("plans.json"));
    expect(aboutPlansJson.map((note) => note.code)).toStrictEqual(["PROJECTION_DIVERGED"]);
  });

  it("bumps the revision on a real write and regenerates plans.json from the committed row", async () => {
    unwrap(await port.read(request()));

    const published = unwrap(
      await port.write({
        ...request(),
        mutation: {
          alias: "codex-two",
          kind: "pause",
          paused: { reason: "billing lapsed", sinceIso: NOW },
          provider: "codex",
        },
        nowIso: NOW,
      }),
    );
    const [row] = await client.db.select().from(planRegisterTable).where(eq(planRegisterTable.id, PLAN_REGISTER_ID));

    expect(published.revision).toBe(2);
    expect(row!.revision).toBe(2);
    expect(JSON.parse(readFileSync(stateHomePaths({ home }).plansJson, "utf8"))).toStrictEqual(row!.document);
  });

  it("lets exactly ONE of two writers holding the same revision commit", async () => {
    unwrap(await port.read(request()));
    const first = planRegisterRowsOver({ client: openStore({ url: PROOF_URL! }) });
    const second = planRegisterRowsOver({ client: openStore({ url: PROOF_URL! }) });
    try {
      const [won, lost] = await Promise.all([
        first.update({ document: LEGACY, expectedRevision: 1 }),
        second.update({ document: LEGACY, expectedRevision: 1 }),
      ]);
      const committed = [unwrap(won), unwrap(lost)].filter((row) => row !== undefined);

      expect(committed.map((row) => row.revision)).toStrictEqual([2]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("answers a stale writer REGISTER_REVISION_CONFLICT and leaves the winner's row alone", async () => {
    unwrap(await port.read(request()));
    const rows = planRegisterRowsOver({ client: openStore({ url: PROOF_URL! }) });
    try {
      unwrap(await rows.update({ document: LEGACY, expectedRevision: 1 }));
      const stale = unwrap(await rows.update({ document: LEGACY, expectedRevision: 1 }));

      expect(stale).toBe(undefined);
    } finally {
      await rows.close();
    }
    const [row] = await client.db.select().from(planRegisterTable).where(eq(planRegisterTable.id, PLAN_REGISTER_ID));
    expect(row!.revision).toBe(2);
  });

  it("keeps a row committed when its projection fails, and repairs both files without a new revision", async () => {
    unwrap(await port.read(request()));
    const plansJson = stateHomePaths({ home }).plansJson;
    rmSync(plansJson, { force: true });
    mkdirSync(plansJson, { recursive: true });

    const failed = unwrapErr(
      await port.write({
        ...request(),
        mutation: {
          alias: "codex-two",
          kind: "pause",
          paused: { reason: "billing lapsed", sinceIso: NOW },
          provider: "codex",
        },
        nowIso: NOW,
      }),
    );
    expect(failed.code).toBe("PROJECTION_WRITE_FAILED");

    rmSync(plansJson, { force: true, recursive: true });
    const repaired = unwrap(await port.write({ ...request(), mutation: { kind: "repair-projection" }, nowIso: NOW }));
    const [row] = await client.db.select().from(planRegisterTable).where(eq(planRegisterTable.id, PLAN_REGISTER_ID));

    expect(row!.revision).toBe(2);
    expect(repaired.revision).toBe(2);
    expect(JSON.parse(readFileSync(plansJson, "utf8"))).toStrictEqual(row!.document);
  });
});
