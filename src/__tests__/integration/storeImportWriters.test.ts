/**
 * The writers an applied store import calls, on a REAL Postgres, each inside the caller's transaction: the owner
 * profile created then moved one revision on, a voice cohort, memories and recalls appended with fresh sequences,
 * owner-judgement versions taken over, left inactive or refused when nothing stands to retire, standing asks
 * activated, left inactive and taken over, and steer measurements appended past what the register holds. What a pure
 * test cannot settle is each one against the tables' own keys, CHECKs and triggers, read back through the readers
 * every later turn uses.
 *
 * OPT-IN, and never in CI: it needs a running local stack. It creates its own throwaway database from the admin
 * connection, migrates it, and drops it afterwards — it never touches the database the admin URL names:
 *
 *   STORE_IMPORT_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/storeImportWriters.test.ts
 *
 * The cases run in order over one database, each reading what the one before it left.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql, TransactionRollbackError } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { OwnerDirective } from "../../judgement/ownerDirective.js";
import { writeImportedOwnerJudgement } from "../../judgement/ownerJudgementImport.js";
import { directiveRowOf } from "../../judgement/ownerJudgementRecords.js";
import { KnowledgeErrors } from "../../knowledge/errors.js";
import { appendImportedKnowledge } from "../../knowledge/importAppend.js";
import { parseExportedRecall } from "../../knowledge/recallRestore.js";
import { parseExportedLine } from "../../knowledge/restore.js";
import type { ImportedStandingAskVersion } from "../../profile/standingAskImportRows.js";
import { writeImportedStandingAsks } from "../../profile/standingAskImportWrite.js";
import { activeStandingAsksOf } from "../../profile/standingAskProjection.js";
import {
  productionStandingAskTransferSeams,
  readStandingAskSnapshot,
  STANDING_ASKS_WRITE_LOCK,
} from "../../profile/standingAskRows.js";
import { storeStandingAskTransferPort } from "../../profile/standingAskStore.js";
import { type StandingAsk, standingAskLine } from "../../profile/standingAsks.js";
import { appendImportedSteerMeasurements } from "../../profile/steerMeasurementImport.js";
import {
  productionSteerMeasurementTransferSeams,
  readSteerMeasurementSnapshot,
  STEER_MEASUREMENTS_WRITE_LOCK,
} from "../../profile/steerMeasurementRows.js";
import { storeSteerMeasurementTransferPort } from "../../profile/steerMeasurementStore.js";
import { steerMeasurementEnvelopeOfV1Line } from "../../profile/steerMeasurementTransfer.js";
import { openStore, type StoreClient, type StoreWriter } from "../../store/client.js";
import { applyStore } from "../../store/migrate.js";
import { writeImportedOwnerProfile, writeImportedVoiceCohort } from "../../store/profile/importWrite.js";
import { voiceCohortSchema } from "../../store/profile/types.js";
import { memoriesTable } from "../../store/schema/memories.js";
import { memoryRecallsTable } from "../../store/schema/memoryRecalls.js";
import { ownerDirectiveTable } from "../../store/schema/ownerJudgement.js";
import { ownerProfileTable } from "../../store/schema/ownerProfile.js";
import { ownerVoiceRegisterTable } from "../../store/schema/ownerVoice.js";
import { writeStoreExport } from "../../store/transfer/bundlePublish.js";
import { contentDigest, readExportBundle } from "../../store/transfer/bundleRead.js";
import { planImport } from "../../store/transfer/compare.js";
import { stageImport } from "../../store/transfer/importStore.js";
import type { StoreExportPartKind } from "../../store/transfer/parts.js";
import type { StagedEntry } from "../../store/transfer/retained.js";
import { approveImportPlan, importStageDraft } from "../../store/transfer/staged.js";
import { CONTENTS, MEMORY_LINE, OWNER, RECALL_LINE, STEER_LINE, VOICE_LINE } from "../unit/store/transfer/fixtures.js";

const ADMIN_URL = process.env["STORE_IMPORT_PROOF_ADMIN_URL"];

const EMPTY_LIVE: ReadonlyMap<StoreExportPartKind, readonly StagedEntry[]> = new Map([
  ["memories", []],
  ["memory-recalls", []],
  ["owner-profile", []],
  ["owner-voice", []],
  ["owner-directives", []],
  ["standing-asks", []],
  ["steer-verdicts", []],
]);

const WITHDRAWN_AT = "2026-11-02T00:00:00.000Z";

/** One directive under the synthetic organisation's rule file. */
function directive({ id, text }: { id: string; text: string }): OwnerDirective {
  return { id, source: { contentHash: `sha256:${"a".repeat(64)}`, file: "acme-rule.md", modified: null }, text };
}

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

/**
 * The export staged here: the fixture's, with three standing asks so each imported version below has a question of
 * its own — a question admits exactly one version, which `uq_*_import_question` holds the tables to.
 */
const STAGED = {
  ...CONTENTS,
  standingAskLines: [
    ask({ covers: ["findings"], id: "a" }),
    ask({ covers: ["registered-rows"], id: "b" }),
    ask({ covers: ["bot-replies"], id: "c" }),
  ].map((one) => standingAskLine({ event: { kind: "recorded", ...one } })),
};

/** Take one register's transaction-scoped write lock, as the apply transaction does before it reads. */
async function lock({ writer, key }: { writer: StoreWriter; key: bigint }): Promise<void> {
  await writer.execute(sql`select pg_advisory_xact_lock(${sql.raw(key.toString())})`);
}

/** Run one write in a transaction that commits. */
async function committed<T>({
  client,
  write,
}: {
  client: StoreClient;
  write: (writer: StoreWriter) => Promise<T>;
}): Promise<T> {
  return client.db.transaction(async (tx) => write(tx));
}

/** Run one write in a transaction rolled back afterwards, as the apply transaction is on any refusal. */
async function rolledBack<T>({
  client,
  write,
}: {
  client: StoreClient;
  write: (writer: StoreWriter) => Promise<T>;
}): Promise<T> {
  let outcome: { readonly value: T } | undefined;
  try {
    await client.db.transaction(async (tx) => {
      outcome = { value: await write(tx) };
      tx.rollback();
    });
  } catch (cause) {
    if (!(cause instanceof TransactionRollbackError)) {
      throw cause;
    }
  }
  return outcome!.value;
}

describe.skipIf(ADMIN_URL === undefined)(
  "the writers an applied store import calls, on a real Postgres (opt-in)",
  () => {
    const database = `store_import_writers_${randomUUID().slice(0, 8)}`;
    // Built in `beforeAll`, never at collection: `skipIf` still runs this body.
    let admin: postgres.Sql;
    let client: StoreClient;
    let root: string;
    let questions: ReadonlyMap<string, string>;
    /** The staged question one imported row raised, which the version written for it names. */
    const question = ({ part, key }: { part: StoreExportPartKind; key: string }): string =>
      questions.get(`${part}/${key}`)!;

    beforeAll(async () => {
      admin = postgres(ADMIN_URL!, { max: 1, onnotice: () => {} });
      const url = new URL(ADMIN_URL!);
      url.pathname = `/${database}`;
      await admin.unsafe(`create database ${database}`);
      unwrap(await applyStore({ url: url.toString() }));
      client = openStore({ url: url.toString() });
      root = mkdtempSync(join(tmpdir(), "sw-import-writers-"));
      const out = join(root, "export");
      unwrap(
        writeStoreExport({ contents: STAGED, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }),
      );
      const reading = unwrap(readExportBundle({ dir: out, unmanifested: false }));
      const plan = unwrap(
        planImport({
          contentDigest: contentDigest({ parts: reading.parts }),
          imported: reading.retained,
          live: EMPTY_LIVE,
        }),
      );
      const draft = unwrap(
        importStageDraft({ plan: unwrap(approveImportPlan({ approved: plan.digest, plan })), reading }),
      );
      unwrap(await stageImport({ client, draft }));
      // Every imported version names a staged question, which its foreign key demands.
      questions = new Map(draft.questions.map((one) => [`${one.part}/${one.key}`, one.id]));
      const home = join(root, "home");
      unwrap(
        await storeStandingAskTransferPort({ seams: productionStandingAskTransferSeams() }).ensureImported({
          client,
          home,
        }),
      );
      unwrap(
        await storeSteerMeasurementTransferPort({ seams: productionSteerMeasurementTransferSeams() }).ensureImported({
          client,
          home,
        }),
      );
    }, 120_000);

    afterAll(async () => {
      rmSync(root, { force: true, recursive: true });
      await client.close();
      await admin.unsafe(`drop database if exists ${database} with (force)`);
      await admin.end();
    });

    it("stages one activation question per instruction the export restores, which the versions below name", () => {
      expect([...questions.keys()].toSorted()).toEqual([
        "owner-directives/directive:d-one",
        "owner-directives/directive:d-two",
        "standing-asks/a",
        "standing-asks/b",
        "standing-asks/c",
      ]);
    });

    it("creates the owner profile at revision 1, then moves it one revision on with all three portable fields", async () => {
      expect(
        unwrap(await committed({ client, write: (writer) => writeImportedOwnerProfile({ profile: OWNER, writer }) })),
      ).toBe(1);
      const renamed = { ...OWNER, displayName: "Acme Owner Two" };
      expect(
        unwrap(await committed({ client, write: (writer) => writeImportedOwnerProfile({ profile: renamed, writer }) })),
      ).toBe(2);
      const rows = await client.db
        .select({
          displayName: ownerProfileTable.displayName,
          judgementProfile: ownerProfileTable.judgementProfile,
          personId: ownerProfileTable.personId,
          revision: ownerProfileTable.revision,
          selfDescription: ownerProfileTable.selfDescription,
        })
        .from(ownerProfileTable);
      expect(rows).toEqual([
        {
          displayName: "Acme Owner Two",
          judgementProfile: null,
          personId: null,
          revision: 2,
          selfDescription: OWNER.selfDescription,
        },
      ]);
    });

    it("refuses a profile whose self-description its schema refuses, writing nothing", async () => {
      const broken = { ...OWNER, selfDescription: { schemaVersion: 99 } };
      const refused = await rolledBack({
        client,
        write: (writer) => writeImportedOwnerProfile({ profile: broken, writer }),
      });
      expect(unwrapErr(refused).code).toBe("PAYLOAD_INVALID");
      const [held] = await client.db.select({ revision: ownerProfileTable.revision }).from(ownerProfileTable);
      expect(held!.revision).toBe(2);
    });

    it("refuses a profile whose next revision is past the column's range as a typed failure, writing nothing (Codex r27, 5-3)", async () => {
      const ceiling = 2_147_483_647;
      await client.db.update(ownerProfileTable).set({ revision: ceiling });
      const renamed = { ...OWNER, displayName: "Acme Owner Three" };
      const refused = await rolledBack({
        client,
        write: (writer) => writeImportedOwnerProfile({ profile: renamed, writer }),
      });
      const [held] = await client.db
        .select({ displayName: ownerProfileTable.displayName, revision: ownerProfileTable.revision })
        .from(ownerProfileTable);
      await client.db.update(ownerProfileTable).set({ revision: 2 });
      expect(unwrapErr(refused).code).toBe("PROFILE_QUERY_FAILED");
      expect(held).toEqual({ displayName: "Acme Owner Two", revision: ceiling });
    });

    it("writes one imported voice cohort onto the owner row", async () => {
      const cohort = voiceCohortSchema.parse(JSON.parse(VOICE_LINE));
      expect(unwrap(await committed({ client, write: (writer) => writeImportedVoiceCohort({ cohort, writer }) }))).toBe(
        1,
      );
      const rows = await client.db
        .select({ cohort: ownerVoiceRegisterTable.cohort, medianWords: ownerVoiceRegisterTable.medianWords })
        .from(ownerVoiceRegisterTable);
      expect(rows).toEqual([{ cohort: "all-sent", medianWords: 14 }]);
    });

    it("appends a memory and its recall keeping their identities and instants, each taking this store's sequence", async () => {
      const memory = unwrap(parseExportedLine({ line: MEMORY_LINE, lineNumber: 1 }));
      const recall = unwrap(parseExportedRecall({ line: RECALL_LINE, lineNumber: 1 }));
      const written = await committed({
        client,
        write: (writer) => appendImportedKnowledge({ memories: [memory], recalls: [recall], writer }),
      });
      expect(unwrap(written)).toEqual({ memories: 1, recalls: 1 });
      const memories = await client.db
        .select({ createdAt: memoriesTable.createdAt, recordingId: memoriesTable.recordingId, seq: memoriesTable.seq })
        .from(memoriesTable);
      expect(memories).toEqual([
        {
          createdAt: new Date("2026-10-01T09:00:01.000Z"),
          recordingId: "bbbbbbbb-0000-4000-8000-000000000001",
          seq: 1,
        },
      ]);
      const recalls = await client.db
        .select({ recallId: memoryRecallsTable.recallId, seq: memoryRecallsTable.seq })
        .from(memoryRecallsTable);
      expect(recalls).toEqual([{ recallId: "cccccccc-0000-4000-8000-000000000001", seq: 1 }]);
    });

    it("refuses a recording retiring its own claim, the store holding another recording of it, as a restore does", async () => {
      const memory = unwrap(parseExportedLine({ line: MEMORY_LINE, lineNumber: 1 }));
      const selfRetiring = { ...memory, recordingId: randomUUID(), supersedes: memory.id };
      const refused = await rolledBack({
        client,
        write: (writer) => appendImportedKnowledge({ memories: [selfRetiring], recalls: [], writer }),
      });
      expect([unwrapErr(refused).code, unwrapErr(refused).message]).toEqual([
        "SUPERSEDES_REFUSED",
        KnowledgeErrors.supersedesRefused({ supersedes: memory.id, why: "a recording never retires its own claim" })
          .message,
      ]);
    });

    it("refuses retiring a claim recorded under two kinds, even when its latest recording is of the retiring kind", async () => {
      const exported = JSON.parse(MEMORY_LINE) as Record<string, unknown>;
      const earlierPreference = JSON.stringify({
        ...exported,
        kind: "preference",
        recordedAt: "2026-09-01T09:00:00.000Z",
        recordingId: randomUUID(),
        surface: null,
        tier: null,
      });
      const retiring = JSON.stringify({
        ...exported,
        id: "l-0000000000000002",
        recordingId: randomUUID(),
        supersedes: exported["id"],
      });
      const memories = [earlierPreference, retiring].map((line) => unwrap(parseExportedLine({ line, lineNumber: 1 })));
      const refused = await rolledBack({
        client,
        write: (writer) => appendImportedKnowledge({ memories, recalls: [], writer }),
      });
      expect(unwrapErr(refused).message).toBe(
        KnowledgeErrors.supersedesRefused({
          supersedes: "l-0000000000000001",
          why: "it is recorded as lesson and as preference, not one kind",
        }).message,
      );
    });

    it("refuses a recall naming a recording its claim does not hold", async () => {
      const recall = unwrap(parseExportedRecall({ line: RECALL_LINE, lineNumber: 1 }));
      const stray = { ...recall, recallId: randomUUID(), recordingId: randomUUID() };
      const refused = await rolledBack({
        client,
        write: (writer) => appendImportedKnowledge({ memories: [], recalls: [stray], writer }),
      });
      expect(unwrapErr(refused).code).toBe("CORRUPT_RECORDING");
    });

    it("takes an imported directive over its live version, leaves another inactive, and steers by the taken one", async () => {
      const live = directiveRowOf({
        directive: directive({ id: "d-one", text: "old" }),
        origin: "legacy-file",
        state: "active",
      });
      await client.db.insert(ownerDirectiveTable).values(live);
      const one = question({ key: "directive:d-one", part: "owner-directives" });
      const two = question({ key: "directive:d-two", part: "owner-directives" });
      const written = await committed({
        client,
        write: (writer) =>
          writeImportedOwnerJudgement({
            corrections: [],
            directives: [
              {
                questionId: one,
                retiresCurrent: true,
                state: "active",
                value: directive({ id: "d-one", text: "draft first" }),
              },
              {
                questionId: two,
                retiresCurrent: false,
                state: "inactive",
                value: directive({ id: "d-two", text: "post" }),
              },
            ],
            writer,
          }),
      });
      expect(unwrap(written)).toBe(3);
      const rows = await client.db
        .select({
          directiveId: ownerDirectiveTable.directiveId,
          importQuestionId: ownerDirectiveTable.importQuestionId,
          origin: ownerDirectiveTable.origin,
          state: ownerDirectiveTable.state,
          text: ownerDirectiveTable.text,
        })
        .from(ownerDirectiveTable)
        .orderBy(ownerDirectiveTable.directiveId, ownerDirectiveTable.origin);
      expect(rows).toEqual([
        { directiveId: "d-one", importQuestionId: null, origin: "legacy-file", state: "inactive", text: "old" },
        { directiveId: "d-one", importQuestionId: one, origin: "store-import", state: "active", text: "draft first" },
        { directiveId: "d-two", importQuestionId: two, origin: "store-import", state: "inactive", text: "post" },
      ]);
    });

    it("refuses a second version naming a question that already admitted one, by the table's own key", async () => {
      const one = question({ key: "directive:d-one", part: "owner-directives" });
      const refused = await rolledBack({
        client,
        write: (writer) =>
          writeImportedOwnerJudgement({
            corrections: [],
            directives: [
              { questionId: one, retiresCurrent: false, state: "inactive", value: directive({ id: "d-x", text: "x" }) },
            ],
            writer,
          }),
      });
      expect(unwrapErr(refused).message).toContain('"uq_owner_directive_import_question"');
    });

    it("refuses to take a directive over a live version that no longer stands", async () => {
      const refused = await rolledBack({
        client,
        write: (writer) =>
          writeImportedOwnerJudgement({
            corrections: [],
            directives: [
              {
                questionId: question({ key: "directive:d-two", part: "owner-directives" }),
                retiresCurrent: true,
                state: "active",
                value: directive({ id: "d-gone", text: "x" }),
              },
            ],
            writer,
          }),
      });
      expect(unwrapErr(refused).message).toBe(
        "the import takes directive d-gone over a live version, and no active version of it is stored; plan the import again",
      );
    });

    it("activates an ask, leaves one inactive, then takes one over, the register reading back what stands", async () => {
      const version = ({
        covers,
        id,
        state = "active",
        withdraws = [],
      }: {
        covers: readonly string[];
        id: string;
        state?: "active" | "inactive";
        withdraws?: readonly string[];
      }): ImportedStandingAskVersion => ({
        ask: ask({ covers, id }),
        questionId: question({ key: id, part: "standing-asks" }),
        state,
        withdraws,
      });
      const write = ({ versions }: { versions: readonly ImportedStandingAskVersion[] }) =>
        committed({
          client,
          write: async (writer) => {
            await lock({ key: STANDING_ASKS_WRITE_LOCK, writer });
            return writeImportedStandingAsks({ versions, withdrawnAtIso: WITHDRAWN_AT, writer });
          },
        });
      expect(unwrap(await write({ versions: [version({ covers: ["findings"], id: "a" })] }))).toBe(3);
      // Inactive, it may share a card with the live ask: only active coverage is unique.
      expect(unwrap(await write({ versions: [version({ covers: ["findings"], id: "b", state: "inactive" })] }))).toBe(
        2,
      );
      const takeOver = version({ covers: ["findings", "bot-replies"], id: "c", withdraws: ["a"] });
      // The withdrawal and its one cascaded card, then a generation, two cards and the recording.
      expect(unwrap(await write({ versions: [takeOver] }))).toBe(7);
      const stored = unwrap(await readStandingAskSnapshot({ reader: client }));
      expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([ask({ covers: ["findings", "bot-replies"], id: "c" })]);
      expect(stored.events.map((one) => [one.journalSeq, one.kind, one.origin])).toEqual([
        [1, "recorded", "store-import"],
        [2, "withdrawn", "store-import"],
        [3, "recorded", "store-import"],
      ]);
      const byAsk = stored.asks.toSorted((left, right) => left.askId.localeCompare(right.askId));
      expect(byAsk.map((one) => [one.askId, one.state, one.recordedSeq])).toEqual([
        ["a", "withdrawn", 1],
        ["b", "inactive", null],
        ["c", "active", 3],
      ]);
    });

    it("appends steer measurements past what the register holds, each keeping its id and line, read back whole", async () => {
      const legacy = steerMeasurementEnvelopeOfV1Line({ exactText: STEER_LINE, sourceOrdinal: 1 });
      const later = {
        eventId: "steer-event-00000000-0000-4000-8000-000000000001",
        exactText: STEER_LINE,
        parseStatus: "parsed" as const,
        schemaVersion: 2 as const,
        sourceOrdinal: null,
      };
      const append = ({
        measurements,
      }: {
        measurements: Parameters<typeof appendImportedSteerMeasurements>[0]["measurements"];
      }) =>
        committed({
          client,
          write: async (writer) => {
            await lock({ key: STEER_MEASUREMENTS_WRITE_LOCK, writer });
            return appendImportedSteerMeasurements({ measurements, writer });
          },
        });
      expect(unwrap(await append({ measurements: [legacy] }))).toBe(1);
      expect(unwrap(await append({ measurements: [later] }))).toBe(1);
      const stored = unwrap(await readSteerMeasurementSnapshot({ reader: client }));
      expect(stored.map((one) => [one.journalSeq, one.eventId, one.origin, one.sourceOrdinal, one.exactLine])).toEqual([
        [1, legacy.eventId, "store-import", 1, STEER_LINE],
        [2, later.eventId, "store-import", null, STEER_LINE],
      ]);
    });

    it("refuses a steer measurement whose legacy id its own line and place do not mint, appending nothing", async () => {
      const legacy = steerMeasurementEnvelopeOfV1Line({ exactText: STEER_LINE, sourceOrdinal: 1 });
      const refused = await rolledBack({
        client,
        write: (writer) => appendImportedSteerMeasurements({ measurements: [{ ...legacy, sourceOrdinal: 5 }], writer }),
      });
      expect(unwrapErr(refused).code).toBe("STEER_IMPORTED_ROW_ALTERED");
      const stored = unwrap(await readSteerMeasurementSnapshot({ reader: client }));
      expect(stored.map((one) => one.journalSeq)).toEqual([1, 2]);
    });
  },
);
