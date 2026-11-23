/**
 * `applyStagedImport` on a REAL Postgres: a staged export written into every live register in one transaction with a
 * receipt last, a retry writing nothing, a restored instruction left inactive, an unanswered question or a store that
 * moved since staging refused whole, an append-only difference kept as the current row and reported — or refused when
 * the apply is told to stop — and a standing ask taken over every live ask it meets. What a pure test cannot settle is
 * each against the tables' own keys, triggers and readers.
 *
 * OPT-IN, and never in CI: it needs a running local stack. Each case creates its own throwaway database from the admin
 * connection, migrates it, and drops it afterwards — it never touches the database the admin URL names:
 *
 *   STORE_IMPORT_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/storeImportApply.test.ts
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { activeStandingAsksOf } from "../../profile/standingAskProjection.js";
import { readStandingAskSnapshot } from "../../profile/standingAskRows.js";
import { storeImportApplicationTable } from "../../store/schema/importStaging.js";
import { memoriesTable } from "../../store/schema/memories.js";
import { ownerDirectiveTable } from "../../store/schema/ownerJudgement.js";
import { ownerProfileTable } from "../../store/schema/ownerProfile.js";
import { standingAskTable } from "../../store/schema/standingAsks.js";
import { MEMORY_LINE, OWNER } from "../unit/store/transfer/fixtures.js";
import { ACTIVE, CHANGED_MEMORY_LINE } from "../unit/store/transfer/stagedBatch.js";
import {
  ADMIN_URL,
  type AdminConnection,
  applied,
  closeAll,
  openAdmin,
  type ProofStore,
  rowCounts,
  stagedAndAnswered,
  standingAsk,
  throwawayStore,
  totalRows,
} from "./storeImportApplyHarness.js";

/** The fixture export with its memory's claim changed, so the two meet as one memory held two ways. */
const CHANGED = { ...ACTIVE, memoryLines: [CHANGED_MEMORY_LINE] };

describe.skipIf(ADMIN_URL === undefined)("applying a staged store import, on a real Postgres (opt-in)", () => {
  // Built in `beforeAll`, never at collection: `skipIf` still runs this body.
  let admin: AdminConnection;
  const opened: ProofStore[] = [];
  /** A fresh store, removed when the case ends. */
  const fresh = async (): Promise<ProofStore> => {
    const store = await throwawayStore({ admin });
    opened.push(store);
    return store;
  };

  beforeAll(() => {
    admin = openAdmin();
  });

  afterEach(async () => {
    await closeAll({ stores: opened.splice(0) });
  });

  afterAll(async () => {
    await admin.sql.end();
  });

  it("writes every part in one commit, its receipt counting every row, and a retry writes nothing", async () => {
    const store = await fresh();
    const { batchId, draft } = await stagedAndAnswered({
      answers: { activation: "activate" },
      contents: ACTIVE,
      store,
    });

    const first = unwrap(await applied({ batchId, store }));
    const counts = await rowCounts({ client: store.client });
    const reapplied = unwrap(await applied({ batchId, store }));

    expect(first).toEqual({
      appendOnlyDifferences: [],
      batchId,
      items: 9,
      openAlignmentQuestionIds: [],
      outcome: "applied",
      planDigest: draft.planDigest,
      writes: totalRows({ counts }),
    });
    expect(counts).toEqual({
      memories: 1,
      memory_recalls: 1,
      owner_correction: 0,
      owner_directive: 2,
      owner_profile: 1,
      owner_voice_register: 1,
      standing_ask: 1,
      standing_ask_coverage: 1,
      standing_ask_event: 1,
      steer_measurement: 2,
      store_import_application: 1,
    });
    expect(reapplied).toEqual({
      batchId,
      receiptWrites: first.writes,
      outcome: "already-applied",
      planDigest: draft.planDigest,
      writes: 0,
    });
    expect(await rowCounts({ client: store.client })).toEqual(counts);
  });

  it("counts an owner profile taken over a live one at a later revision as the one row it updated", async () => {
    const store = await fresh();
    const first = await stagedAndAnswered({ answers: { activation: "activate" }, contents: ACTIVE, store });
    unwrap(await applied({ batchId: first.batchId, store }));
    const renamed = { ...ACTIVE, owner: { ...OWNER, displayName: "Acme Owner, renamed" } };
    const { batchId, draft } = await stagedAndAnswered({
      answers: { conflict: "take-imported" },
      contents: renamed,
      store,
    });

    const outcome = unwrap(await applied({ batchId, store }));

    const [profile] = await store.client.db
      .select({ displayName: ownerProfileTable.displayName, revision: ownerProfileTable.revision })
      .from(ownerProfileTable);
    const [receipt] = await store.client.db
      .select({ writeCount: storeImportApplicationTable.writeCount })
      .from(storeImportApplicationTable)
      .where(eq(storeImportApplicationTable.batchId, batchId));
    expect(draft.questions.map((one) => [one.kind, one.part])).toEqual([["conflict", "owner-profile"]]);
    expect(profile).toEqual({ displayName: "Acme Owner, renamed", revision: 2 });
    expect([outcome.outcome, outcome.writes, receipt!.writeCount]).toEqual(["applied", 2, 2]);
  });

  it("writes a restored instruction inactive when its answer left it so, steering by none of them", async () => {
    const store = await fresh();
    const { batchId } = await stagedAndAnswered({ answers: { activation: "leave-inactive" }, contents: ACTIVE, store });

    unwrap(await applied({ batchId, store }));

    const directives = await store.client.db.select({ state: ownerDirectiveTable.state }).from(ownerDirectiveTable);
    const asks = await store.client.db
      .select({ recordedSeq: standingAskTable.recordedSeq, state: standingAskTable.state })
      .from(standingAskTable);
    const stored = unwrap(await readStandingAskSnapshot({ reader: store.client }));
    expect(directives.map((one) => one.state)).toEqual(["inactive", "inactive"]);
    expect(asks).toEqual([{ recordedSeq: null, state: "inactive" }]);
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([]);
    expect((await rowCounts({ client: store.client }))["standing_ask_event"]).toBe(0);
  });

  it("refuses a batch with an unanswered question, writing nothing", async () => {
    const store = await fresh();
    const { batchId, draft } = await stagedAndAnswered({ answers: {}, contents: ACTIVE, store });

    const refused = unwrapErr(await applied({ batchId, store }));

    expect(refused.code).toBe("IMPORT_QUESTIONS_OPEN");
    expect(refused).toMatchObject({ questionIds: draft.questions.map((one) => one.id) });
    expect(draft.questions.map((one) => one.kind)).toEqual(["activation", "activation", "activation"]);
    expect(totalRows({ counts: await rowCounts({ client: store.client }) })).toBe(0);
  });

  it("refuses a batch the store has moved past since it was staged, writing nothing", async () => {
    const store = await fresh();
    const kept = await stagedAndAnswered({ answers: { activation: "activate" }, contents: ACTIVE, store });
    const first = await stagedAndAnswered({ answers: { activation: "activate" }, contents: CHANGED, store });
    unwrap(await applied({ batchId: first.batchId, store }));
    const before = await rowCounts({ client: store.client });

    const refused = unwrapErr(await applied({ batchId: kept.batchId, store }));

    expect(refused.code).toBe("IMPORT_BATCH_STALE");
    expect(refused).toMatchObject({ stagedPlanDigest: kept.draft.planDigest });
    expect(await rowCounts({ client: store.client })).toEqual(before);
  });

  it("stops on an append-only difference only when told to, and otherwise keeps the current row and reports it", async () => {
    const store = await fresh();
    unwrap(
      await applied({
        batchId: (await stagedAndAnswered({ answers: { activation: "activate" }, contents: CHANGED, store })).batchId,
        store,
      }),
    );
    const { batchId, draft } = await stagedAndAnswered({ answers: {}, contents: ACTIVE, store });
    const alignment = draft.questions.map((one) => [one.kind, one.part, one.id]);
    const before = await rowCounts({ client: store.client });

    const stopped = unwrapErr(await applied({ batchId, stopOnConflict: true, store }));
    const afterStop = await rowCounts({ client: store.client });
    const kept = unwrap(await applied({ batchId, store }));

    expect(alignment).toEqual([["alignment", "memories", draft.questions[0]!.id]]);
    expect(stopped.code).toBe("IMPORT_APPEND_ONLY_CONFLICT");
    expect(afterStop).toEqual(before);
    expect(kept).toMatchObject({ openAlignmentQuestionIds: [draft.questions[0]!.id], outcome: "applied", writes: 1 });
    expect(kept).toMatchObject({
      appendOnlyDifferences: [{ part: "memories", questionId: draft.questions[0]!.id, resolved: false }],
    });
    const claims = await store.client.db.select({ claim: memoriesTable.claim }).from(memoriesTable);
    expect(claims).toEqual([{ claim: "acme's widget queue drains out of order" }]);
  });

  it("keeps the live memory holding an imported memory's import key under another id, asked as an alignment", async () => {
    const store = await fresh();
    const memory = JSON.parse(MEMORY_LINE) as Record<string, unknown>;
    const holder = JSON.stringify({
      ...memory,
      claim: "acme's widget queue drains out of order",
      importKey: "acme-import-1",
      recordingId: "bbbbbbbb-0000-4000-8000-000000000002",
    });
    const first = await stagedAndAnswered({
      answers: { activation: "activate" },
      contents: { ...ACTIVE, memoryLines: [holder], recallLines: [] },
      store,
    });
    unwrap(await applied({ batchId: first.batchId, store }));
    const keyed = JSON.stringify({ ...memory, importKey: "acme-import-1" });
    const contents = { ...ACTIVE, memoryLines: [keyed], recallLines: [] };
    const { batchId, draft } = await stagedAndAnswered({ answers: {}, contents, store });
    const before = await rowCounts({ client: store.client });

    const stopped = unwrapErr(await applied({ batchId, stopOnConflict: true, store }));
    const kept = unwrap(await applied({ batchId, store }));

    expect(draft.questions.map((one) => [one.kind, one.part, one.key])).toEqual([
      ["alignment", "memories", "bbbbbbbb-0000-4000-8000-000000000001"],
    ]);
    expect(stopped.code).toBe("IMPORT_APPEND_ONLY_CONFLICT");
    expect(kept).toMatchObject({ openAlignmentQuestionIds: [draft.questions[0]!.id], outcome: "applied", writes: 1 });
    expect(await rowCounts({ client: store.client })).toEqual({
      ...before,
      store_import_application: before["store_import_application"]! + 1,
    });
    const memories = await store.client.db
      .select({ importKey: memoriesTable.importKey, recordingId: memoriesTable.recordingId })
      .from(memoriesTable);
    expect(memories).toEqual([{ importKey: "acme-import-1", recordingId: "bbbbbbbb-0000-4000-8000-000000000002" }]);
  });

  it("refuses whole, before writing, an import whose new recall counts a memory an alignment kept out", async () => {
    const store = await fresh();
    const memory = JSON.parse(MEMORY_LINE) as Record<string, unknown>;
    const holder = JSON.stringify({
      ...memory,
      importKey: "acme-import-1",
      recordingId: "bbbbbbbb-0000-4000-8000-000000000002",
    });
    const first = await stagedAndAnswered({
      answers: { activation: "activate" },
      contents: { ...ACTIVE, memoryLines: [holder], recallLines: [] },
      store,
    });
    unwrap(await applied({ batchId: first.batchId, store }));
    const contents = { ...ACTIVE, memoryLines: [JSON.stringify({ ...memory, importKey: "acme-import-1" })] };
    const { batchId, draft } = await stagedAndAnswered({ answers: {}, contents, store });
    const before = await rowCounts({ client: store.client });

    const refused = unwrapErr(await applied({ batchId, store }));

    expect([refused.code, refused.message]).toEqual([
      "IMPORT_DEPENDENCY_UNMET",
      `batch ${batchId} would write 1 row(s) whose need nothing live or written provides, so none of its rows is applied: memory-recalls cccccccc-0000-4000-8000-000000000001 needs recording bbbbbbbb-0000-4000-8000-000000000001 of claim l-0000000000000001; the alignment(s) keeping an imported row out: ${draft.questions[0]!.id}`,
    ]);
    expect(await rowCounts({ client: store.client })).toEqual(before);
  });

  it("refuses whole, before writing, an import holding a recording that retires its own claim", async () => {
    const store = await fresh();
    const memory = JSON.parse(MEMORY_LINE) as Record<string, unknown>;
    const selfRetiring = JSON.stringify({
      ...memory,
      recordingId: "bbbbbbbb-0000-4000-8000-000000000002",
      supersedes: memory["id"],
    });
    const contents = { ...ACTIVE, memoryLines: [MEMORY_LINE, selfRetiring] };
    const { batchId } = await stagedAndAnswered({ answers: {}, contents, store });
    const before = await rowCounts({ client: store.client });

    const refused = unwrapErr(await applied({ batchId, store }));

    expect([refused.code, refused.message]).toEqual([
      "IMPORT_DEPENDENCY_UNMET",
      `batch ${batchId} would write 1 row(s) whose need nothing live or written provides, so none of its rows is applied: memories bbbbbbbb-0000-4000-8000-000000000002 needs a claim other than l-0000000000000001 itself to supersede; no alignment keeps an imported row out`,
    ]);
    expect(await rowCounts({ client: store.client })).toEqual(before);
  });

  it("refuses an instant the standing-ask register would not record, before reading or writing", async () => {
    const store = await fresh();
    const live = standingAsk({ covers: ["findings"], id: "a" });
    const over = standingAsk({ covers: ["findings"], id: "c" });
    const first = await stagedAndAnswered({
      answers: { activation: "activate" },
      contents: { ...ACTIVE, standingAskLines: [live.line] },
      store,
    });
    unwrap(await applied({ batchId: first.batchId, store }));
    const { batchId } = await stagedAndAnswered({
      answers: { activation: "activate", conflict: "take-imported" },
      contents: { ...ACTIVE, standingAskLines: [over.line] },
      store,
    });
    const before = await rowCounts({ client: store.client });

    const refused = unwrapErr(await applied({ batchId, nowIso: "not-an-instant", store }));

    expect([refused.code, refused.message]).toEqual([
      "IMPORT_INSTANT_INVALID",
      `batch ${batchId} was not applied, and nothing was read or written: "not-an-instant" is not an ISO instant with an offset, the only time a standing ask records a withdrawal at`,
    ]);
    expect(await rowCounts({ client: store.client })).toEqual(before);
    unwrap(await applied({ batchId, store }));
    const stored = unwrap(await readStandingAskSnapshot({ reader: store.client }));
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([over.ask]);
  });

  it("withdraws every live standing ask an ask it takes over meets", async () => {
    const store = await fresh();
    const findings = standingAsk({ covers: ["findings"], id: "a" });
    const rows = standingAsk({ covers: ["registered-rows"], id: "b" });
    const both = standingAsk({ covers: ["findings", "registered-rows"], id: "c" });
    const live = await stagedAndAnswered({
      answers: { activation: "activate" },
      contents: { ...ACTIVE, standingAskLines: [findings.line, rows.line] },
      store,
    });
    unwrap(await applied({ batchId: live.batchId, store }));

    const { batchId, draft } = await stagedAndAnswered({
      answers: { activation: "activate", conflict: "take-imported" },
      contents: { ...ACTIVE, standingAskLines: [both.line] },
      store,
    });
    unwrap(await applied({ batchId, store }));

    // One question, the conflict: taking the imported ask over a live one is its activation.
    expect(draft.questions.map((one) => [one.kind, one.key])).toEqual([["conflict", "c"]]);
    const stored = unwrap(await readStandingAskSnapshot({ reader: store.client }));
    expect(unwrap(activeStandingAsksOf({ stored }))).toEqual([both.ask]);
  });
});
