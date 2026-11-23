/**
 * The steer-measurement register against a REAL store: what the in-memory fake (`../steerMeasurementFixture.ts`)
 * cannot prove — the one-time import under two racing first readers, the advisory lock giving two appenders two
 * sequences, the triggers refusing every update, delete and truncate (replica mode included) and standing enabled
 * ALWAYS, the counted marker catching an imported line removed behind the triggers' back, the minted ids catching
 * one swapped or edited there with the count unchanged, the CHECKs, and an export of the store carrying each
 * imported line, in order, as the very envelope a v1 read of the journal makes of it.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. Point it at a
 * THROWAWAY database in the running stack — never `postgres`, which is the live fleet's. This file removes every
 * `steer_measurement` row, with its keeping trigger held off inside one transaction, and the `steer-measurements`
 * import marker, before and after every case:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres steer_measurement_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/steer_measurement_proof slopweaver store push
 *   STEER_MEASUREMENT_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/steer_measurement_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/steerMeasurementStore.test.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import { type SteerVerdict, steerVerdictLine } from "../../profile/steerKinds.js";
import { importedSteerEventId } from "../../profile/steerMeasurementRecords.js";
import { productionSteerMeasurementSeams, readSteerMeasurementSnapshot } from "../../profile/steerMeasurementRows.js";
import { storeSteerMeasurementPort } from "../../profile/steerMeasurementStore.js";
import {
  steerMeasurementEnvelopeLine,
  steerMeasurementEnvelopeOfV1Line,
} from "../../profile/steerMeasurementTransfer.js";
import { stateHomePaths } from "../../stateHome.js";
import { openStore, STORE_URL_ENV, type StoreClient } from "../../store/client.js";
import { homeFileImportTable } from "../../store/schema/homeFileImport.js";
import { steerMeasurementTable } from "../../store/schema/steerMeasurements.js";
import { readStoreExportContents } from "../../store/transfer/bundleWrite.js";

const PROOF_URL = process.env["STEER_MEASUREMENT_PROOF_URL"];

/** One verdict on one turn. */
function verdict({ turn }: { turn: number }): SteerVerdict {
  return {
    anchor: `talk:3f2a1b4c-5d6e-4f70-8192-${String(turn).padStart(12, "0")}`,
    judgedAtIso: "2026-10-04T12:00:00.000Z",
    says: "nothing",
    turnAtIso: "2026-10-04T09:00:00.000Z",
  };
}

/** One journal line. */
function line({ turn }: { turn: number }): string {
  return steerVerdictLine({ verdict: verdict({ turn }) });
}

/**
 * Every message down a thrown failure's `cause` chain, so a case can name the database's own refusal through
 * Drizzle's wrapper.
 *
 * @param run the statement expected to fail
 * @returns the joined messages, or "resolved" when it did not fail
 */
async function refusalOf({ run }: { run: () => Promise<unknown> }): Promise<string> {
  try {
    await run();
  } catch (cause) {
    const messages: string[] = [];
    let current: unknown = cause;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(" | ");
  }
  return "resolved";
}

const KEPT = "a steer measurement is never changed or removed";

describe.skipIf(PROOF_URL === undefined)("the steer-measurement register in a real store", () => {
  let client: StoreClient;
  let home = "";

  const port = storeSteerMeasurementPort({ seams: productionSteerMeasurementSeams() });

  /** Remove every measurement with the keeping trigger held off, inside one transaction, and the marker. */
  const clearTheRegister = async (): Promise<void> => {
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`alter table public.steer_measurement disable trigger trg_steer_measurement_kept`);
      await tx.delete(steerMeasurementTable);
      await tx.execute(sql`alter table public.steer_measurement enable always trigger trg_steer_measurement_kept`);
    });
    await client.db.delete(homeFileImportTable).where(eq(homeFileImportTable.register, "steer-measurements"));
  };

  /** Write the home journal under the case's home, returning the exact bytes. */
  const writeJournal = ({ text }: { text: string }): string => {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    writeFileSync(paths.judgement.steerKindsJsonl, text, "utf8");
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
    home = mkdtempSync(join(tmpdir(), "steer-proof-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("imports the journal once under two racing first readers, at each line's place, and exports it back", async () => {
    const text = writeJournal({ text: `${line({ turn: 1 })}\n\nnot json\n${line({ turn: 1 })}\n` });

    const [left, right] = await Promise.all([port.readHistory({ home }), port.readHistory({ home })]);
    const markers = await client.db
      .select()
      .from(homeFileImportTable)
      .where(eq(homeFileImportTable.register, "steer-measurements"));
    const snapshot = unwrap(await readSteerMeasurementSnapshot({ reader: client }));
    const contents = unwrap(await readStoreExportContents({ client, home }));

    const history = { unparsed: [3], verdicts: [verdict({ turn: 1 }), verdict({ turn: 1 })] };
    expect([unwrap(left), unwrap(right)]).toEqual([history, history]);
    expect(markers.map((one) => [one.sourceState, one.records, one.sourceSha256, one.sourceBytes])).toEqual([
      ["present", 3, `sha256:${createHash("sha256").update(text).digest("hex")}`, Buffer.byteLength(text)],
    ]);
    expect(snapshot.map((one) => [one.eventId, one.journalSeq, one.origin])).toEqual([
      [importedSteerEventId({ exactLine: line({ turn: 1 }), sourceOrdinal: 1 }), 1, "legacy-file"],
      [importedSteerEventId({ exactLine: "not json", sourceOrdinal: 3 }), 3, "legacy-file"],
      [importedSteerEventId({ exactLine: line({ turn: 1 }), sourceOrdinal: 4 }), 4, "legacy-file"],
    ]);
    // The envelope a v1 read of the journal makes of each line is the one the store exports for it.
    const envelopeOf = ({ exactText, sourceOrdinal }: { exactText: string; sourceOrdinal: number }): string =>
      steerMeasurementEnvelopeLine({ envelope: steerMeasurementEnvelopeOfV1Line({ exactText, sourceOrdinal }) });
    expect(contents.steerMeasurementLines).toEqual([
      envelopeOf({ exactText: line({ turn: 1 }), sourceOrdinal: 1 }),
      envelopeOf({ exactText: "not json", sourceOrdinal: 3 }),
      envelopeOf({ exactText: line({ turn: 1 }), sourceOrdinal: 4 }),
    ]);
  });

  it("gives two concurrent appenders two sequences, past the imported lines, both read back", async () => {
    writeJournal({ text: `${line({ turn: 1 })}\n` });
    unwrap(await port.readHistory({ home }));

    const written = await Promise.all([
      port.append({ home, verdict: verdict({ turn: 2 }) }),
      port.append({ home, verdict: verdict({ turn: 3 }) }),
    ]);

    expect(written.map((one) => unwrap(one).journalSeq).toSorted((a, b) => a - b)).toEqual([2, 3]);
    expect(unwrap(await port.readHistory({ home })).verdicts).toHaveLength(3);
  });

  it("refuses every update, delete and truncate, in replica mode too, the triggers standing enabled ALWAYS", async () => {
    unwrap(await port.append({ home, verdict: verdict({ turn: 1 }) }));

    expect(await refusalOf({ run: () => client.db.update(steerMeasurementTable).set({ exactLine: "x" }) })).toContain(
      `${KEPT} (UPDATE on steer_measurement)`,
    );
    expect(await refusalOf({ run: () => client.db.delete(steerMeasurementTable) })).toContain(
      `${KEPT} (DELETE on steer_measurement)`,
    );
    expect(await refusalOf({ run: () => client.db.execute(sql`truncate public.steer_measurement`) })).toContain(
      `${KEPT} (TRUNCATE on steer_measurement)`,
    );
    const replica = await refusalOf({
      run: () =>
        client.db.transaction(async (tx) => {
          await tx.execute(sql`set local session_replication_role = replica`);
          await tx.delete(steerMeasurementTable);
        }),
    });
    expect(replica).toContain(`${KEPT} (DELETE on steer_measurement)`);

    const triggers = await client.db.execute<{ tgname: string; tgenabled: string }>(
      sql`select tgname, tgenabled from pg_trigger where tgrelid = 'public.steer_measurement'::regclass and not tgisinternal order by tgname`,
    );
    expect([...triggers].map((one) => [one.tgname, one.tgenabled])).toEqual([
      ["trg_steer_measurement_kept", "A"],
      ["trg_steer_measurement_no_truncate", "A"],
    ]);
    expect((await client.db.select().from(steerMeasurementTable)).length).toBe(1);
  });

  it("refuses a read once an imported line is removed behind the triggers' back, naming both counts", async () => {
    writeJournal({ text: `${line({ turn: 1 })}\n${line({ turn: 2 })}\n` });
    unwrap(await port.readHistory({ home }));
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`alter table public.steer_measurement disable trigger trg_steer_measurement_kept`);
      await tx.delete(steerMeasurementTable).where(eq(steerMeasurementTable.journalSeq, 2));
      await tx.execute(sql`alter table public.steer_measurement enable always trigger trg_steer_measurement_kept`);
    });

    expect(unwrapErr(await port.readHistory({ home })).message).toBe(
      "the steer-measurement import marker says 2 line(s) were imported, and the table holds 1",
    );
  });

  it("refuses a read once an imported line is swapped or edited behind the triggers' back, the count unchanged", async () => {
    writeJournal({ text: `${line({ turn: 1 })}\n` });
    unwrap(await port.readHistory({ home }));
    type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];
    const behindTheTriggers = async ({
      change,
    }: {
      change: (within: { tx: Tx }) => Promise<unknown>;
    }): Promise<void> => {
      await client.db.transaction(async (tx) => {
        await tx.execute(sql`alter table public.steer_measurement disable trigger trg_steer_measurement_kept`);
        await change({ tx });
        await tx.execute(sql`alter table public.steer_measurement enable always trigger trg_steer_measurement_kept`);
      });
    };
    const altered =
      "the steer measurement at sequence 1 is not the line its legacy id was minted from, so the table was written behind its own checks — restore the store from a backup rather than read it";

    // Counterexample: the imported row removed and another put in its place, any id of the right shape.
    await behindTheTriggers({
      change: async ({ tx }) => {
        await tx.delete(steerMeasurementTable);
        await tx.insert(steerMeasurementTable).values({
          eventId: `steer-legacy-${"0".repeat(64)}`,
          exactLine: line({ turn: 2 }),
          journalSeq: 1,
          origin: "legacy-file",
          sourceOrdinal: 1,
        });
      },
    });
    expect(unwrapErr(await port.readHistory({ home })).message).toBe(altered);
    expect(unwrapErr(await readStoreExportContents({ client, home })).message).toContain(altered);

    // The same row edited in place, its minted id kept.
    await behindTheTriggers({
      change: ({ tx }) =>
        tx.update(steerMeasurementTable).set({
          eventId: importedSteerEventId({ exactLine: line({ turn: 1 }), sourceOrdinal: 1 }),
          exactLine: line({ turn: 3 }),
        }),
    });
    expect(unwrapErr(await port.readHistory({ home })).message).toBe(altered);

    // Counterexample: two distinct imported lines moved into each other's places, ids kept.
    await clearTheRegister();
    writeJournal({ text: `${line({ turn: 1 })}\n${line({ turn: 2 })}\n` });
    unwrap(await port.readHistory({ home }));
    const moveTo = ({ tx, from, to }: { tx: Tx; from: number; to: number }): Promise<unknown> =>
      tx
        .update(steerMeasurementTable)
        .set({ journalSeq: to, sourceOrdinal: to })
        .where(eq(steerMeasurementTable.journalSeq, from));
    await behindTheTriggers({
      change: async ({ tx }) => {
        await moveTo({ from: 1, to: 3, tx });
        await moveTo({ from: 2, to: 1, tx });
        await moveTo({ from: 3, to: 2, tx });
      },
    });
    expect(unwrapErr(await port.readHistory({ home })).message).toBe(altered);
  });

  it("refuses the journal once it changes after the import, appending nothing", async () => {
    writeJournal({ text: `${line({ turn: 1 })}\n` });
    unwrap(await port.readHistory({ home }));
    writeJournal({ text: "" });

    expect(unwrapErr(await port.readHistory({ home })).code).toBe("STEER_HOME_FILE_CHANGED_AFTER_IMPORT");
    expect(unwrapErr(await port.append({ home, verdict: verdict({ turn: 2 }) })).code).toBe(
      "STEER_HOME_FILE_CHANGED_AFTER_IMPORT",
    );
    expect((await client.db.select().from(steerMeasurementTable)).length).toBe(1);
  });

  it("refuses at the table what no write makes: a profile line with a legacy id, a blank line, a reused sequence", async () => {
    const written = unwrap(await port.append({ home, verdict: verdict({ turn: 1 }) }));
    const legacyId = importedSteerEventId({ exactLine: line({ turn: 9 }), sourceOrdinal: 7 });
    const insert =
      ({ row }: { row: typeof steerMeasurementTable.$inferInsert }) =>
      (): Promise<unknown> =>
        client.db.insert(steerMeasurementTable).values(row);
    const eventId = ({ n }: { n: number }): string =>
      `steer-event-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

    expect(
      await refusalOf({
        run: insert({ row: { eventId: legacyId, exactLine: line({ turn: 9 }), journalSeq: 5, origin: "profile" } }),
      }),
    ).toContain("violates check constraint");
    expect(
      await refusalOf({
        run: insert({ row: { eventId: eventId({ n: 9 }), exactLine: "  ", journalSeq: 6, origin: "profile" } }),
      }),
    ).toContain("violates check constraint");
    expect(
      await refusalOf({
        run: insert({
          row: {
            eventId: eventId({ n: 10 }),
            exactLine: line({ turn: 9 }),
            journalSeq: written.journalSeq,
            origin: "profile",
          },
        }),
      }),
    ).toContain("uq_steer_measurement_seq");
    expect(
      await refusalOf({
        run: insert({
          row: {
            eventId: legacyId,
            exactLine: line({ turn: 9 }),
            journalSeq: 7,
            origin: "legacy-file",
            sourceOrdinal: 8,
          },
        }),
      }),
    ).toContain("violates check constraint");
  });

  it("refuses a store-import row whose id and source ordinal disagree, and keeps one where they agree", async () => {
    const legacyId = importedSteerEventId({ exactLine: line({ turn: 9 }), sourceOrdinal: 7 });
    const recordedId = "steer-event-00000000-0000-4000-8000-000000000011";
    const insert =
      ({ row }: { row: typeof steerMeasurementTable.$inferInsert }) =>
      (): Promise<unknown> =>
        client.db.insert(steerMeasurementTable).values(row);
    const imported = { exactLine: line({ turn: 9 }), origin: "store-import" } as const;

    expect([
      await refusalOf({ run: insert({ row: { ...imported, eventId: recordedId, journalSeq: 1, sourceOrdinal: 1 } }) }),
      await refusalOf({ run: insert({ row: { ...imported, eventId: legacyId, journalSeq: 2, sourceOrdinal: null } }) }),
    ]).toEqual([
      expect.stringContaining('violates check constraint "steer_measurement_legacy"'),
      expect.stringContaining('violates check constraint "steer_measurement_legacy"'),
    ]);
    await insert({ row: { ...imported, eventId: legacyId, journalSeq: 3, sourceOrdinal: 7 } })();
    await insert({ row: { ...imported, eventId: recordedId, journalSeq: 4, sourceOrdinal: null } })();
    const stored = await client.db.select({ eventId: steerMeasurementTable.eventId }).from(steerMeasurementTable);

    expect(stored.map((row) => row.eventId).toSorted()).toEqual([legacyId, recordedId].toSorted());
  });

  it("refuses a line JavaScript calls blank whatever the database's locale, and keeps one with any other text", async () => {
    const insert =
      ({ row }: { row: typeof steerMeasurementTable.$inferInsert }) =>
      (): Promise<unknown> =>
        client.db.insert(steerMeasurementTable).values(row);
    const appended = { origin: "profile", sourceOrdinal: null } as const;
    const blanks = ["﻿", " 　", " \t"];

    expect(
      await Promise.all(
        blanks.map(async (exactLine, index) =>
          refusalOf({
            run: insert({
              row: {
                ...appended,
                eventId: `steer-event-00000000-0000-4000-8000-00000000002${String(index)}`,
                exactLine,
                journalSeq: index + 1,
              },
            }),
          }),
        ),
      ),
    ).toEqual(blanks.map(() => expect.stringContaining('violates check constraint "steer_measurement_line"')));
    await insert({
      row: { ...appended, eventId: "steer-event-00000000-0000-4000-8000-000000000029", exactLine: "﻿x", journalSeq: 9 },
    })();
    const stored = await client.db.select({ exactLine: steerMeasurementTable.exactLine }).from(steerMeasurementTable);

    expect(stored.map((row) => row.exactLine)).toEqual(["﻿x"]);
  });

  it("refuses a row holding a line feed, which an export would write as two journal lines, and keeps a carriage return", async () => {
    const appended = { origin: "profile", sourceOrdinal: null } as const;
    const refusal = await refusalOf({
      run: () =>
        client.db.insert(steerMeasurementTable).values({
          ...appended,
          eventId: "steer-event-00000000-0000-4000-8000-000000000031",
          exactLine: "first\nsecond",
          journalSeq: 1,
        }),
    });

    expect(refusal).toContain('violates check constraint "steer_measurement_line"');
    await client.db.insert(steerMeasurementTable).values({
      ...appended,
      eventId: "steer-event-00000000-0000-4000-8000-000000000032",
      exactLine: "x\r",
      journalSeq: 2,
    });
    const stored = await client.db.select({ exactLine: steerMeasurementTable.exactLine }).from(steerMeasurementTable);

    expect(stored.map((row) => row.exactLine)).toEqual(["x\r"]);
  });

  it("refuses a sequence or source ordinal past the largest safe integer, which a read would round", async () => {
    const unsafe = 9007199254740992;
    const insert =
      ({ row }: { row: typeof steerMeasurementTable.$inferInsert }) =>
      (): Promise<unknown> =>
        client.db.insert(steerMeasurementTable).values(row);
    const legacy = { exactLine: "x", origin: "store-import" } as const;

    expect([
      await refusalOf({
        run: insert({
          row: {
            ...legacy,
            eventId: importedSteerEventId({ exactLine: "x", sourceOrdinal: 1 }),
            journalSeq: unsafe,
            sourceOrdinal: 1,
          },
        }),
      }),
      await refusalOf({
        run: insert({
          row: {
            ...legacy,
            eventId: importedSteerEventId({ exactLine: "x", sourceOrdinal: unsafe }),
            journalSeq: 1,
            sourceOrdinal: unsafe,
          },
        }),
      }),
    ]).toEqual([
      expect.stringContaining('violates check constraint "steer_measurement_seq"'),
      expect.stringContaining('violates check constraint "steer_measurement_source_ordinal"'),
    ]);
  });

  it("refuses a read over a store-import row whose legacy id its line never minted, which every CHECK admits", async () => {
    unwrap(await port.readHistory({ home }));
    // Counterexample: no trigger is disabled, because an insert is not what they guard.
    await client.db.insert(steerMeasurementTable).values({
      eventId: `steer-legacy-${"0".repeat(64)}`,
      exactLine: "x",
      journalSeq: 1,
      origin: "store-import",
      sourceOrdinal: 1,
    });

    expect(unwrapErr(await port.readHistory({ home }))).toEqual({
      code: "STEER_IMPORTED_ROW_ALTERED",
      journalSeq: 1,
      message:
        "the steer measurement at sequence 1 is not the line its legacy id was minted from, so the table was written behind its own checks — restore the store from a backup rather than read it",
    });
  });
});
