/**
 * The owner-judgement register against a REAL store: what the in-memory fake (`../ownerJudgementFixture.ts`)
 * cannot prove — the CHECK constraints, the partial unique index holding one active version per id, the one-time
 * import committing its marker and rows together under two racing first readers, the counted marker refusing
 * imported rows lost behind it (a memory-written version beside them included), the origin a retired legacy
 * version keeps, and the Postgres marker helper (`../../store/registerImportRows.ts`) driven directly.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's. This file deletes every
 * row of `owner_directive` and `owner_correction`, and the `owner-judgement` import marker, before and after
 * every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres owner_judgement_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/owner_judgement_proof slopweaver store push
 *   OWNER_JUDGEMENT_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/owner_judgement_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/ownerJudgementStore.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OwnerCorrection, OwnerDirective } from "../../judgement/ownerDirective.js";
import {
  OWNER_JUDGEMENT_WRITE_SNAPSHOT,
  productionOwnerDirectiveSeams,
  readOwnerJudgementSnapshot,
} from "../../judgement/ownerDirectiveRows.js";
import { storeOwnerDirectivePort } from "../../judgement/ownerDirectiveStore.js";
import { correctionRowOf, directiveRowOf, type StoredOwnerJudgement } from "../../judgement/ownerJudgementRecords.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { parseMemoryLeaf } from "../../memory/corpus.js";
import type { MemoryLeaf } from "../../memory/types.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { importOnceRegisterOver } from "../../store/registerImportRows.js";
import { homeFileImportTable } from "../../store/schema/homeFileImport.js";
import { ownerCorrectionTable, ownerDirectiveTable } from "../../store/schema/ownerJudgement.js";

const PROOF_URL = process.env["OWNER_JUDGEMENT_PROOF_URL"];

const DIRECTIVE: OwnerDirective = {
  id: "acme-response-policy",
  source: { contentHash: `sha256:${"a".repeat(64)}`, file: "acme-response-policy.md", modified: null },
  text: "answer acme tickets from the runbook first",
};

const CORRECTION: OwnerCorrection = {
  id: "acme-ticket-correction",
  source: { contentHash: `sha256:${"b".repeat(64)}`, file: "acme-ticket-correction.md", modified: null },
  subject: { container: "C0ACME", source: "slack", sourceId: "1700000000.000100" },
  text: "the ABC-1 outage was the queue, not the database",
};

/** A feedback memory that opts into owner directives, or revokes with `ownerDirective: false`. */
function directiveMemory({
  description = "use the direct fallback",
  ownerDirective = true,
}: { description?: string; ownerDirective?: boolean } = {}): MemoryLeaf {
  return parseMemoryLeaf({
    file: "acme-fallback-policy.md",
    text:
      `---\nname: acme-fallback-policy\ndescription: ${description}\nmetadata:\n  type: feedback\n` +
      `  slopweaver:\n    ownerDirective: ${String(ownerDirective)}\n---\n`,
  });
}

describe.skipIf(PROOF_URL === undefined)("the owner-judgement register in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storeOwnerDirectivePort({ seams: productionOwnerDirectiveSeams() });

  const clearTheRegister = async (): Promise<void> => {
    await client.db.delete(ownerDirectiveTable);
    await client.db.delete(ownerCorrectionTable);
    await client.db.delete(homeFileImportTable).where(eq(homeFileImportTable.register, "owner-judgement"));
  };

  /** Write the legacy file under the case's home. */
  const writeLegacy = ({ text }: { text: string }): void => {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    writeFileSync(paths.judgement.ownerDirectivesJson, text, "utf8");
  };

  beforeAll(() => {
    client = openStore({ url: PROOF_URL! });
  });

  afterAll(async () => {
    await clearTheRegister();
    await client.close();
  });

  beforeEach(async () => {
    // Per case, not once: `setup-ambient-home.ts` clears the selector after EVERY test.
    process.env[STORE_URL_ENV] = PROOF_URL!;
    await clearTheRegister();
    home = mkdtempSync(join(tmpdir(), "owner-judgement-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a malformed row at the table: the CHECKs, not the decoder, are the last word", async () => {
    const row = directiveRowOf({ directive: DIRECTIVE, origin: "memory", state: "active" });

    await expect(
      client.db.insert(ownerDirectiveTable).values({ ...row, sourceContentHash: "sha256:short" }),
    ).rejects.toThrow();
    await expect(client.db.insert(ownerDirectiveTable).values({ ...row, text: "" })).rejects.toThrow();
  });

  it("holds one active version per id at the partial unique index, while inactive versions pile up", async () => {
    const row = directiveRowOf({ directive: DIRECTIVE, origin: "memory", state: "active" });
    await client.db.insert(ownerDirectiveTable).values(row);
    await client.db.insert(ownerDirectiveTable).values({ ...row, state: "inactive" });
    await client.db.insert(ownerDirectiveTable).values({ ...row, state: "inactive" });

    await expect(client.db.insert(ownerDirectiveTable).values(row)).rejects.toThrow();
  });

  it("imports the legacy file ONCE under two racing first readers, and ignores the file after", async () => {
    writeLegacy({ text: JSON.stringify({ corrections: [], directives: [DIRECTIVE], schemaVersion: 2 }) });

    const [left, right] = await Promise.all([port.readActive({ home }), port.readActive({ home })]);
    writeLegacy({ text: "{ not json" });
    const after = unwrap(await port.readActive({ home }));
    const stored = await client.db.select().from(ownerDirectiveTable);
    const markers = await client.db
      .select()
      .from(homeFileImportTable)
      .where(eq(homeFileImportTable.register, "owner-judgement"));

    expect([unwrap(left).directives, unwrap(right).directives, after.directives]).toEqual([
      [DIRECTIVE],
      [DIRECTIVE],
      [DIRECTIVE],
    ]);
    expect(stored.length).toBe(1);
    expect(markers.map((marker) => marker.records)).toEqual([1]);
  });

  it("versions a changed ruling and a revocation, keeping every old version inactive", async () => {
    unwrap(await port.syncFromMemory({ home, leaves: [directiveMemory()] }));
    unwrap(
      await port.syncFromMemory({ home, leaves: [directiveMemory({ description: "use the verified fallback" })] }),
    );
    unwrap(await port.syncFromMemory({ home, leaves: [directiveMemory({ ownerDirective: false })] }));

    const stored = await client.db
      .select({ state: ownerDirectiveTable.state, text: ownerDirectiveTable.text })
      .from(ownerDirectiveTable)
      .orderBy(ownerDirectiveTable.recordedAt);
    expect(stored).toEqual([
      { state: "inactive", text: "use the direct fallback" },
      { state: "inactive", text: "use the verified fallback" },
    ]);
    expect(unwrap(await port.readActive({ home })).directives).toEqual([]);
  });

  it("refuses a marker whose rows were deleted behind it rather than reading an empty authority", async () => {
    writeLegacy({ text: JSON.stringify({ corrections: [], directives: [DIRECTIVE], schemaVersion: 2 }) });
    unwrap(await port.readActive({ home }));
    await client.db.delete(ownerDirectiveTable);

    expect(unwrapErr(await port.readActive({ home })).code).toBe("OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT");
  });

  it("refuses a lost imported row even when an inactive memory-written version stands beside it", async () => {
    writeLegacy({ text: JSON.stringify({ corrections: [], directives: [DIRECTIVE], schemaVersion: 2 }) });
    unwrap(await port.syncFromMemory({ home, leaves: [directiveMemory()] }));
    unwrap(await port.syncFromMemory({ home, leaves: [directiveMemory({ ownerDirective: false })] }));
    await client.db.delete(ownerDirectiveTable).where(eq(ownerDirectiveTable.origin, "legacy-file"));

    const left = await client.db
      .select({ origin: ownerDirectiveTable.origin, state: ownerDirectiveTable.state })
      .from(ownerDirectiveTable);
    expect(left).toEqual([{ origin: "memory", state: "inactive" }]);
    expect(unwrapErr(await port.readActive({ home })).code).toBe("OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT");
  });

  it("keeps a replaced legacy version as legacy-file, so the marker still counts it", async () => {
    writeLegacy({ text: JSON.stringify({ corrections: [], directives: [DIRECTIVE], schemaVersion: 2 }) });
    unwrap(await port.readActive({ home }));
    const replacement = parseMemoryLeaf({
      file: DIRECTIVE.source.file,
      text:
        `---\nname: ${DIRECTIVE.id}\ndescription: answer acme tickets from the corpus first\nmetadata:\n` +
        "  type: feedback\n  slopweaver:\n    ownerDirective: true\n---\n",
    });
    unwrap(await port.syncFromMemory({ home, leaves: [replacement] }));

    const stored = await client.db
      .select({ origin: ownerDirectiveTable.origin, state: ownerDirectiveTable.state })
      .from(ownerDirectiveTable)
      .orderBy(ownerDirectiveTable.recordedAt);
    expect(stored).toEqual([
      { origin: "legacy-file", state: "inactive" },
      { origin: "memory", state: "active" },
    ]);
    expect(unwrap(await port.readActive({ home })).directives.map((one) => one.text)).toEqual([
      "answer acme tickets from the corpus first",
    ]);
  });

  it("refuses in the reading snapshot a PARTIAL loss after the import was checked, and reads a sound one", async () => {
    writeLegacy({ text: JSON.stringify({ corrections: [CORRECTION], directives: [DIRECTIVE], schemaVersion: 2 }) });
    unwrap(await port.readActive({ home }));
    const inSnapshot = () =>
      client.db.transaction(async (tx) => readOwnerJudgementSnapshot({ reader: { db: tx } }), {
        accessMode: "read only",
        isolationLevel: "repeatable read",
      });

    const sound = unwrap(await inSnapshot());
    await client.db.delete(ownerDirectiveTable);
    const lost = unwrapErr(await inSnapshot());
    const left = await client.db.select({ id: ownerCorrectionTable.correctionId }).from(ownerCorrectionTable);

    expect([sound.directives.length, sound.corrections.length]).toEqual([1, 1]);
    expect(left).toEqual([{ id: CORRECTION.id }]);
    expect(lost.code).toBe("OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT");
  });

  it("refuses when the marker AND its rows vanish after the import check, rather than reading an empty authority", async () => {
    writeLegacy({ text: JSON.stringify({ corrections: [CORRECTION], directives: [DIRECTIVE], schemaVersion: 2 }) });
    unwrap(await port.readActive({ home }));
    const connected = unwrap(await productionOwnerDirectiveSeams().connect({ home }));
    // The window between the import check and the reading transaction: everything the import wrote is gone.
    await client.db.delete(ownerDirectiveTable);
    await client.db.delete(ownerCorrectionTable);
    await client.db.delete(homeFileImportTable).where(eq(homeFileImportTable.register, "owner-judgement"));

    const refused = unwrapErr(await connected.readStored().finally(() => connected.close()));

    expect([refused.code, refused.message]).toEqual([
      "OWNER_DIRECTIVE_STORE_UNAVAILABLE",
      expect.stringContaining("the marker the import wrote is gone"),
    ]);
  });

  it("refuses a second import behind a deleted marker rather than reading both files' rulings", async () => {
    writeLegacy({ text: JSON.stringify({ corrections: [], directives: [DIRECTIVE], schemaVersion: 2 }) });
    unwrap(await port.readActive({ home }));
    await client.db.delete(homeFileImportTable).where(eq(homeFileImportTable.register, "owner-judgement"));
    writeLegacy({ text: JSON.stringify({ corrections: [CORRECTION], directives: [], schemaVersion: 2 }) });

    const refused = unwrapErr(await port.readActive({ home }));

    expect([refused.code, refused.message]).toEqual([
      "OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT",
      expect.stringContaining("the old file was imported twice"),
    ]);
  });

  it("reads ONE moment across statements in the memory-plan transaction, though another writer commits mid-way", async () => {
    writeLegacy({ text: JSON.stringify({ corrections: [], directives: [DIRECTIVE], schemaVersion: 2 }) });
    unwrap(await port.readActive({ home }));
    const ids = (stored: StoredOwnerJudgement): readonly string[] => [
      ...stored.directives.map((row) => row.directiveId),
      ...stored.corrections.map((row) => row.correctionId),
    ];

    // A second client, so the other writer holds its own connection rather than queueing behind this one.
    const other = openStore({ url: PROOF_URL! });
    const [before, after] = await client.db
      .transaction(async (tx) => {
        const first = unwrap(await readOwnerJudgementSnapshot({ reader: { db: tx } }));
        // Committed outside this transaction: D retired, a correction made active.
        await other.db.update(ownerDirectiveTable).set({ state: "inactive" });
        await other.db
          .insert(ownerCorrectionTable)
          .values(correctionRowOf({ correction: CORRECTION, origin: "memory", state: "active" }));
        const second = unwrap(await readOwnerJudgementSnapshot({ reader: { db: tx } }));
        return [ids(first), ids(second)];
      }, OWNER_JUDGEMENT_WRITE_SNAPSHOT)
      .finally(() => other.close());
    const committed = unwrap(await port.readActive({ home }));

    expect([before, after]).toEqual([[DIRECTIVE.id], [DIRECTIVE.id]]);
    expect([committed.directives, committed.corrections]).toEqual([[], [CORRECTION]]);
  });

  it("claims the marker once, and its counted probe reads back both the claim and what the tables hold", async () => {
    const rows = importOnceRegisterOver<string>({
      client,
      insertRecords: () => Promise.resolve(),
      probeImportedRows: () => Promise.resolve(0),
      register: "owner-judgement",
    });
    const source = { records: ["acme-one", "acme-two"], state: "present" } as const;

    expect([unwrap(await rows.claim({ source })), unwrap(await rows.claim({ source }))]).toEqual([true, false]);
    expect(unwrap(await rows.marker())).toEqual({ observedRows: 0, records: 2, tableHasRows: false });
  });
});
