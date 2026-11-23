/**
 * The standing-ask register against a REAL store: what the in-memory fake (`../standingAskFixture.ts`) cannot
 * prove — the advisory lock serialising two writers so the second decides against the first's commit, the
 * cascading key carrying a withdrawal onto its coverage, the partial unique indexes, the witness CHECKs on the
 * import marker, and an export of the store holding the identical nonblank event lines, in order, of the journal it
 * imported — gathered through the store export's own read and folded by the import's own decoder.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's. This file deletes every
 * row of the three `standing_ask*` tables, and the `standing-asks` import marker, before and after every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres standing_ask_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/standing_ask_proof slopweaver store push
 *   STANDING_ASK_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/standing_ask_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/standingAskStore.test.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import { standingAskExportLines } from "../../profile/standingAskRecords.js";
import {
  productionStandingAskSeams,
  readStandingAskSnapshot,
  STANDING_ASKS_WRITE_LOCK,
} from "../../profile/standingAskRows.js";
import { storeStandingAskPort } from "../../profile/standingAskStore.js";
import { type StandingAsk, type StandingAskEvent, standingAskLine } from "../../profile/standingAsks.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { homeFileImportTable } from "../../store/schema/homeFileImport.js";
import { standingAskCoverageTable, standingAskEventTable, standingAskTable } from "../../store/schema/standingAsks.js";
import { readStoreExportContents } from "../../store/transfer/bundleWrite.js";
import { liveRetained } from "../../store/transfer/liveRetained.js";

const PROOF_URL = process.env["STANDING_ASK_PROOF_URL"];

/** One ask under a fixed quote. */
function ask({ id, covers }: { id: string; covers: readonly string[] }): StandingAsk {
  return {
    covers,
    id,
    quote: {
      anchor: "talk:a0000017-0000-4000-8000-000000000019",
      atIso: "2026-10-04T00:55:00.000Z",
      cut: "none",
      where: "console-voice",
      words: "chuck anything worth a look on the board",
    },
    recordedAtIso: "2026-10-05T00:00:00.000Z",
  };
}

/** One journal line. */
function line({ event }: { event: StandingAskEvent }): string {
  return standingAskLine({ event });
}

describe.skipIf(PROOF_URL === undefined)("the standing-ask register in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storeStandingAskPort({ seams: productionStandingAskSeams() });

  const clearTheRegister = async (): Promise<void> => {
    await client.db.delete(standingAskEventTable);
    await client.db.delete(standingAskCoverageTable);
    await client.db.delete(standingAskTable);
    await client.db.delete(homeFileImportTable).where(eq(homeFileImportTable.register, "standing-asks"));
  };

  /** Write the home journal under the case's home, returning the exact bytes. */
  const writeJournal = ({ text }: { text: string }): string => {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    writeFileSync(paths.judgement.standingAsksJsonl, text, "utf8");
    return text;
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
    home = mkdtempSync(join(tmpdir(), "standing-ask-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("imports the journal once under two racing first readers, witnessing its bytes, and exports them back", async () => {
    const recorded = line({ event: { kind: "recorded", ...ask({ covers: ["findings"], id: "a" }) } });
    const withdrawn = line({
      event: { id: "a", kind: "withdrawn", reason: "superseded", withdrawnAtIso: "2026-10-06T00:00:00.000Z" },
    });
    const again = line({ event: { kind: "recorded", ...ask({ covers: ["findings", "bot-replies"], id: "a" }) } });
    const text = writeJournal({ text: `${recorded}\n\n${withdrawn}\n${again}\n` });

    const [left, right] = await Promise.all([port.readActive({ home }), port.readActive({ home })]);
    const markers = await client.db
      .select()
      .from(homeFileImportTable)
      .where(eq(homeFileImportTable.register, "standing-asks"));
    const snapshot = unwrap(await readStandingAskSnapshot({ reader: client }));

    expect([unwrap(left), unwrap(right)]).toEqual([
      [ask({ covers: ["findings", "bot-replies"], id: "a" })],
      [ask({ covers: ["findings", "bot-replies"], id: "a" })],
    ]);
    expect(markers.map((one) => [one.sourceState, one.records, one.sourceSha256, one.sourceBytes])).toEqual([
      ["present", 3, `sha256:${createHash("sha256").update(text).digest("hex")}`, Buffer.byteLength(text)],
    ]);
    expect(standingAskExportLines({ events: snapshot.events })).toEqual([recorded, withdrawn, again]);
    expect(snapshot.events.map((one) => [one.journalSeq, one.kind, one.origin])).toEqual([
      [1, "recorded", "legacy-file"],
      [2, "withdrawn", "legacy-file"],
      [3, "recorded", "legacy-file"],
    ]);
  });

  it("exports what the port recorded through the store export's own read, and the import decoder folds it", async () => {
    const first = ask({ covers: ["findings"], id: "a" });
    const second = ask({ covers: ["bot-replies"], id: "b" });
    const third = ask({ covers: ["findings", "act:auto.merge"], id: "a" });
    const withdraw = { id: "a", kind: "withdraw", reason: "done", withdrawnAtIso: "2026-10-07T00:00:00.000Z" } as const;
    unwrap(await port.write({ home, request: { ask: first, kind: "add" } }));
    unwrap(await port.write({ home, request: { ask: second, kind: "add" } }));
    unwrap(await port.write({ home, request: withdraw }));
    unwrap(await port.write({ home, request: { ask: third, kind: "add" } }));

    const contents = unwrap(await readStoreExportContents({ client, home }));
    const retained = unwrap(liveRetained({ contents })).get("standing-asks")!;

    expect(contents.standingAskLines).toEqual([
      line({ event: { kind: "recorded", ...first } }),
      line({ event: { kind: "recorded", ...second } }),
      line({ event: { id: "a", kind: "withdrawn", reason: "done", withdrawnAtIso: "2026-10-07T00:00:00.000Z" } }),
      line({ event: { kind: "recorded", ...third } }),
    ]);
    expect(retained.map((entry) => [entry.key, entry.summary])).toEqual([
      ["b", "standing ask b, covers bot-replies"],
      ["a", "standing ask a, covers findings, act:auto.merge"],
    ]);

    // A journal appearing at the old path after the import is refused on this path too, not exported around.
    writeJournal({ text: `${line({ event: { kind: "recorded", ...ask({ covers: ["findings"], id: "z" }) } })}\n` });
    const refused = unwrapErr(await readStoreExportContents({ client, home }));
    expect(refused.code).toBe("SOURCE_UNREADABLE");
    expect(refused.message).toContain("the standing asks would not read: ");
    expect(refused.message).toContain("is not the file the store imported its standing asks from");
  });

  it("refuses a read once a withdrawn generation is edited apart from its line", async () => {
    unwrap(await port.write({ home, request: { ask: ask({ covers: ["findings"], id: "a" }), kind: "add" } }));
    const withdraw = { id: "a", kind: "withdraw", reason: "done", withdrawnAtIso: "2026-10-07T00:00:00.000Z" } as const;
    unwrap(await port.write({ home, request: withdraw }));
    expect(unwrap(await port.readActive({ home }))).toEqual([]);

    await client.db.update(standingAskTable).set({ quoteWords: "tampered" }).where(eq(standingAskTable.askId, "a"));

    expect(unwrapErr(await port.readActive({ home })).message).toBe(
      "the stored standing asks do not read as one register: generation a is not the ask its recording event 1 records",
    );
  });

  it("refuses the journal once it changes after the import, writing nothing", async () => {
    writeJournal({ text: `${line({ event: { kind: "recorded", ...ask({ covers: ["findings"], id: "a" }) } })}\n` });
    unwrap(await port.readActive({ home }));
    writeJournal({ text: "" });

    expect(unwrapErr(await port.readActive({ home })).code).toBe("STANDING_ASK_HOME_FILE_CHANGED_AFTER_IMPORT");
    const add = { ask: ask({ covers: ["bot-replies"], id: "b" }), kind: "add" } as const;
    expect(unwrapErr(await port.write({ home, request: add })).code).toBe(
      "STANDING_ASK_HOME_FILE_CHANGED_AFTER_IMPORT",
    );
    expect((await client.db.select().from(standingAskEventTable)).length).toBe(1);
  });

  it("serialises two writers on the lock, so the second decides against the first's commit", async () => {
    const first = { ask: ask({ covers: ["findings"], id: "a" }), kind: "add" } as const;
    const second = { ask: ask({ covers: ["findings"], id: "b" }), kind: "add" } as const;

    const outcomes = await Promise.all([port.write({ home, request: first }), port.write({ home, request: second })]);

    const codes = outcomes.map((one) => (one.isOk() ? "written" : one.error.code)).toSorted();
    expect(codes).toEqual(["COVERAGE_OVERLAP", "written"]);
    expect((await client.db.select().from(standingAskEventTable)).map((one) => one.journalSeq)).toEqual([1]);
  });

  it("holds a write until the lock's holder commits", async () => {
    const holder = openStore({ url: PROOF_URL! });
    const add = { ask: ask({ covers: ["findings"], id: "a" }), kind: "add" } as const;
    let settled = false;
    let heldWhileLocked = true;
    let pending: ReturnType<typeof port.write> | undefined;
    try {
      // The one-time import takes no lock, so it runs first; the held write is the only thing left to wait.
      unwrap(await port.readActive({ home }));
      await holder.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(STANDING_ASKS_WRITE_LOCK.toString())})`);
        pending = port.write({ home, request: add });
        void pending.finally(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        heldWhileLocked = !settled;
      });
      expect(heldWhileLocked).toBe(true);
      expect(unwrap(await pending!)).toEqual({ journalSeq: 1, kind: "written" });
    } finally {
      await holder.close();
    }
  });

  it("carries a withdrawal onto its coverage by the cascading key, freeing the card for a new ask", async () => {
    unwrap(await port.write({ home, request: { ask: ask({ covers: ["findings"], id: "a" }), kind: "add" } }));
    const withdraw = { id: "a", kind: "withdraw", reason: "done", withdrawnAtIso: "2026-10-07T00:00:00.000Z" } as const;
    unwrap(await port.write({ home, request: withdraw }));
    unwrap(await port.write({ home, request: { ask: ask({ covers: ["findings"], id: "b" }), kind: "add" } }));

    const coverage = await client.db
      .select({ coverage: standingAskCoverageTable.coverage, state: standingAskCoverageTable.state })
      .from(standingAskCoverageTable)
      .innerJoin(standingAskTable, eq(standingAskTable.rowId, standingAskCoverageTable.askRowId))
      .orderBy(standingAskTable.recordedSeq);
    expect(coverage).toEqual([
      { coverage: "findings", state: "withdrawn" },
      { coverage: "findings", state: "active" },
    ]);
    expect(unwrap(await port.readActive({ home }))).toEqual([ask({ covers: ["findings"], id: "b" })]);
  });

  it("refuses at the table what no write makes: a second active card holder, a witnessless marker", async () => {
    unwrap(await port.write({ home, request: { ask: ask({ covers: ["findings"], id: "a" }), kind: "add" } }));
    const [held] = await client.db.select().from(standingAskTable);

    const { rowId: _rowId, ...columns } = held!;
    await client.db.insert(standingAskTable).values({ ...columns, askId: "b", recordedSeq: 9 });
    const [other] = await client.db.select().from(standingAskTable).where(eq(standingAskTable.askId, "b"));
    await expect(
      client.db
        .insert(standingAskCoverageTable)
        .values({ askRowId: other!.rowId, coverage: "findings", ordinal: 0, state: "active" }),
    ).rejects.toThrow();
    await expect(client.db.insert(standingAskTable).values({ ...columns, recordedSeq: 10 })).rejects.toThrow();

    await client.db.delete(homeFileImportTable).where(eq(homeFileImportTable.register, "standing-asks"));
    await expect(
      client.db.insert(homeFileImportTable).values({ records: 1, register: "standing-asks", sourceState: "present" }),
    ).rejects.toThrow();
  });
});
