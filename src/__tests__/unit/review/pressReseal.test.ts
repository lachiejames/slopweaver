import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { type PressRecord, pressKey } from "../../../review/pressJournal.js";
import type { StoredPress } from "../../../review/pressJournalPort.js";
import {
  applyPressReseal,
  type PressResealReceipt,
  type PressResealSeams,
  type PressResealTx,
  planPressReseal,
  pressRegisterDigest,
  previewPressReseal,
} from "../../../review/pressReseal.js";
import { type PressResealError, PressResealErrors } from "../../../review/pressResealErrors.js";
import { appendPressResealReceipt } from "../../../review/pressResealStoreRows.js";
import { memoryPressJournalPort, memoryPressStore } from "../../landingRegistersFixture.js";

const HOME = "/nonexistent/press-reseal-home";
const NOW = "2026-11-17T09:00:00.000Z";

const press = ({
  repoSlug = "acme/widgets",
  number = 7,
  atIso = "2026-10-01T00:00:00.000Z",
}: {
  repoSlug?: string;
  number?: number;
  atIso?: string;
}): PressRecord => ({
  atIso,
  entryState: "QUEUED",
  headOid: "1111111111111111111111111111111111111111",
  number,
  repoSlug,
});

/** A row stored under its own fields' hash. */
const sound = ({ record }: { record: PressRecord }): StoredPress => ({ ...record, pressKey: pressKey({ record }) });

/** A row as a sanitiser leaves it: its slug rewritten, its key still the hash of the ORIGINAL slug. */
const carried = ({ record, from }: { record: PressRecord; from: string }): StoredPress => ({
  ...record,
  pressKey: pressKey({ record: { ...record, repoSlug: from } }),
});

/** An in-memory store, its transaction committing a working copy on ok and dropping it on err. */
interface MemoryResealStore {
  rows: StoredPress[];
  receipts: PressResealReceipt[];
  /** Run inside the transaction after its first read, to stand for another writer racing it. */
  afterFirstRead: ((rows: StoredPress[]) => void) | undefined;
}

const memorySeams = ({ store }: { store: MemoryResealStore }): PressResealSeams => ({
  appendReceipt: ({ receipt }) => {
    store.receipts.push(receipt);
    return ok("/nonexistent/press-reseal-home/ledgers/landing-press-reseals.jsonl");
  },
  inTransaction: async ({ body }) => {
    const working = store.rows.map((row) => ({ ...row }));
    let reads = 0;
    const tx: PressResealTx = {
      readAll: () => {
        reads += 1;
        const snapshot = [...working];
        if (reads === 1 && store.afterFirstRead !== undefined) {
          store.afterFirstRead(working);
        }
        return Promise.resolve(ok(snapshot));
      },
      rekey: ({ oldKey, newKey }) => {
        const index = working.findIndex((row) => row.pressKey === oldKey);
        if (index === -1) {
          return Promise.resolve(ok(false));
        }
        working[index] = { ...working[index]!, pressKey: newKey };
        return Promise.resolve(ok(true));
      },
    };
    const answer = await body(tx);
    if (answer.isOk()) {
      store.rows = working;
    }
    return answer;
  },
  readStored: () => Promise.resolve(ok([...store.rows])),
});

const storeOf = ({ rows }: { rows: StoredPress[] }): MemoryResealStore => ({
  afterFirstRead: undefined,
  receipts: [],
  rows,
});

const ROW_A = carried({ from: "acme-before/widgets", record: press({ repoSlug: "old-org/slopweaver", number: 1 }) });
const ROW_B = carried({ from: "acme-before/widgets", record: press({ repoSlug: "old-org/slopweaver", number: 2 }) });
const ROW_SOUND = sound({ record: press({ number: 3 }) });

describe("planPressReseal", () => {
  it("pairs every mismatched row with its fields' hash and counts them per repository", () => {
    const plan = unwrap(planPressReseal({ repos: ["old-org/slopweaver"], stored: [ROW_A, ROW_SOUND, ROW_B] }));

    expect(plan.rowCount).toBe(3);
    expect(plan.pairs).toEqual([
      {
        newKey: pressKey({ record: press({ number: 1, repoSlug: "old-org/slopweaver" }) }),
        number: 1,
        oldKey: ROW_A.pressKey,
        repoSlug: "old-org/slopweaver",
      },
      {
        newKey: pressKey({ record: press({ number: 2, repoSlug: "old-org/slopweaver" }) }),
        number: 2,
        oldKey: ROW_B.pressKey,
        repoSlug: "old-org/slopweaver",
      },
    ]);
    expect(plan.perRepo).toEqual([{ repoSlug: "old-org/slopweaver", rows: 2 }]);
    expect(plan.sourceSha256).toBe(pressRegisterDigest({ stored: [ROW_A, ROW_SOUND, ROW_B] }));
  });

  it("has nothing to do on a register already sound", () => {
    const plan = unwrap(planPressReseal({ repos: ["acme/widgets"], stored: [ROW_SOUND] }));

    expect(plan.pairs).toEqual([]);
    expect(plan.perRepo).toEqual([]);
  });

  it("refuses a mismatched row of a repository the caller did not name", () => {
    const refused = unwrapErr(planPressReseal({ repos: ["acme/widgets"], stored: [ROW_A, ROW_SOUND] }));

    expect(refused).toEqual(PressResealErrors.repoNotNamed({ repos: ["old-org/slopweaver"] }));
  });

  it("refuses a new key another row already sits under, even when both are the same press", () => {
    const record = press({ number: 1, repoSlug: "old-org/slopweaver" });
    const duplicate = sound({ record });
    const refused = unwrapErr(planPressReseal({ repos: ["old-org/slopweaver"], stored: [duplicate, ROW_A] }));

    expect(refused).toEqual(
      PressResealErrors.keyCollision({ newKey: duplicate.pressKey, oldKeys: [duplicate.pressKey, ROW_A.pressKey] }),
    );
  });

  it("refuses two mismatched rows that would land on one key", () => {
    const twin = carried({ from: "acme-other/widgets", record: press({ number: 1, repoSlug: "old-org/slopweaver" }) });
    const refused = unwrapErr(planPressReseal({ repos: ["old-org/slopweaver"], stored: [ROW_A, twin] }));

    expect(refused.code).toBe("RESEAL_KEY_COLLISION");
    expect(refused.message).toContain(`${ROW_A.pressKey}, ${twin.pressKey}`);
  });

  it("refuses a row that does not decode, naming it", () => {
    const broken: StoredPress = { ...ROW_A, repoSlug: "not a slug" };
    const refused = unwrapErr(planPressReseal({ repos: ["old-org/slopweaver"], stored: [broken] }));

    expect(refused).toEqual(
      PressResealErrors.recordInvalid({ pressKey: ROW_A.pressKey, reason: "carries no owner/name repoSlug" }),
    );
  });
});

describe("pressRegisterDigest", () => {
  it("is the same over any read order and moves when any field does", () => {
    const forward = pressRegisterDigest({ stored: [ROW_A, ROW_B, ROW_SOUND] });

    expect(pressRegisterDigest({ stored: [ROW_SOUND, ROW_B, ROW_A] })).toBe(forward);
    expect(pressRegisterDigest({ stored: [ROW_A, ROW_B, { ...ROW_SOUND, entryState: "" }] })).not.toBe(forward);
    expect(forward).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("previewPressReseal", () => {
  it("writes nothing", async () => {
    const store = storeOf({ rows: [ROW_A, ROW_B] });
    const plan = unwrap(
      await previewPressReseal({ home: HOME, repos: ["old-org/slopweaver"], seams: memorySeams({ store }) }),
    );

    expect(plan.pairs.length).toBe(2);
    expect(store.rows).toEqual([ROW_A, ROW_B]);
    expect(store.receipts).toEqual([]);
  });
});

describe("applyPressReseal", () => {
  const apply = ({
    store,
    expectedSourceSha256,
  }: {
    store: MemoryResealStore;
    expectedSourceSha256: string;
  }): Promise<Result<unknown, PressResealError>> =>
    applyPressReseal({
      expectedSourceSha256,
      home: HOME,
      nowIso: NOW,
      reason: "carried home",
      repos: ["old-org/slopweaver"],
      seams: memorySeams({ store }),
    });

  it("re-keys every row, journals one receipt, and leaves a register the ordinary reader accepts", async () => {
    const store = storeOf({ rows: [ROW_A, ROW_SOUND, ROW_B] });
    const digest = pressRegisterDigest({ stored: store.rows });
    const applied = unwrap(await apply({ expectedSourceSha256: digest, store }));

    expect(applied).toEqual({
      plan: unwrap(planPressReseal({ repos: ["old-org/slopweaver"], stored: [ROW_A, ROW_SOUND, ROW_B] })),
      receiptPath: "/nonexistent/press-reseal-home/ledgers/landing-press-reseals.jsonl",
    });
    expect(store.rows.map((row) => row.pressKey)).toEqual(store.rows.map((row) => pressKey({ record: row })));
    expect(store.receipts.length).toBe(1);
    expect(store.receipts[0]!.count).toBe(2);
    expect(store.receipts[0]!.sourceSha256).toBe(digest);
    expect(store.receipts[0]!.reason).toBe("carried home");
    expect(store.receipts[0]!.atIso).toBe(NOW);

    const memory = memoryPressStore();
    memory.imported = true;
    memory.rows.push(...store.rows);
    const latest = unwrap(await memoryPressJournalPort({ store: memory }).readLatest({ home: HOME }));
    expect([...latest.keys()].toSorted()).toEqual(["acme/widgets#3", "old-org/slopweaver#1", "old-org/slopweaver#2"]);
  });

  it("refuses, writing nothing, when the register moved since the preview", async () => {
    const store = storeOf({ rows: [ROW_A, ROW_B] });
    const stale = pressRegisterDigest({ stored: [ROW_A] });
    const refused = unwrapErr(await apply({ expectedSourceSha256: stale, store }));

    expect(refused).toEqual(
      PressResealErrors.sourceMoved({ expected: stale, observed: pressRegisterDigest({ stored: [ROW_A, ROW_B] }) }),
    );
    expect(store.rows).toEqual([ROW_A, ROW_B]);
    expect(store.receipts).toEqual([]);
  });

  it("rolls back when the read-back does not hold every row it re-keyed over", async () => {
    const store = storeOf({ rows: [ROW_A, ROW_B] });
    store.afterFirstRead = (rows) => {
      rows.push(ROW_SOUND);
    };
    const refused = unwrapErr(
      await apply({ expectedSourceSha256: pressRegisterDigest({ stored: store.rows }), store }),
    );

    expect(refused).toEqual(
      PressResealErrors.readbackUnsound({ reason: "it holds 3 rows where 2 were re-keyed over" }),
    );
    expect(store.rows).toEqual([ROW_A, ROW_B]);
    expect(store.receipts).toEqual([]);
  });

  it("rolls back when the read-back would still be refused by the strict reader", async () => {
    const corrupt: StoredPress = { ...ROW_SOUND, pressKey: "f".repeat(64) };
    const store = storeOf({ rows: [ROW_A, ROW_SOUND] });
    store.afterFirstRead = (rows) => {
      rows[1] = corrupt;
    };
    const refused = unwrapErr(
      await apply({ expectedSourceSha256: pressRegisterDigest({ stored: store.rows }), store }),
    );

    expect(refused.code).toBe("RESEAL_READBACK_UNSOUND");
    expect(refused.message).toContain(
      `the stored press ${"f".repeat(64)} is stored under a key its own fields do not hash to`,
    );
    expect(store.rows).toEqual([ROW_A, ROW_SOUND]);
    expect(store.receipts).toEqual([]);
  });

  it("rolls back when a row is gone from under its old key by the time its update runs", async () => {
    const store = storeOf({ rows: [ROW_A, ROW_B] });
    store.afterFirstRead = (rows) => {
      rows[1] = { ...ROW_B, pressKey: "e".repeat(64) };
    };
    const refused = unwrapErr(
      await apply({ expectedSourceSha256: pressRegisterDigest({ stored: store.rows }), store }),
    );

    expect(refused).toEqual(PressResealErrors.rowMoved({ oldKey: ROW_B.pressKey }));
    expect(store.rows).toEqual([ROW_A, ROW_B]);
  });

  it("journals nothing when there is nothing to re-key", async () => {
    const store = storeOf({ rows: [ROW_SOUND] });
    const applied = unwrap(await apply({ expectedSourceSha256: pressRegisterDigest({ stored: store.rows }), store }));

    expect(applied).toEqual({
      plan: { pairs: [], perRepo: [], rowCount: 1, sourceSha256: pressRegisterDigest({ stored: [ROW_SOUND] }) },
      receiptPath: undefined,
    });
    expect(store.receipts).toEqual([]);
  });

  it("refuses with the store's own words when a statement fails", async () => {
    const store = storeOf({ rows: [ROW_A] });
    const failing: PressResealSeams = {
      ...memorySeams({ store }),
      inTransaction: ({ body }) =>
        body({
          readAll: () => Promise.resolve(err({ doing: "read the press register", reason: "connection reset" })),
          rekey: () => Promise.resolve(ok(true)),
        }),
    };
    const refused = unwrapErr(
      await applyPressReseal({
        expectedSourceSha256: "a".repeat(64),
        home: HOME,
        nowIso: NOW,
        reason: "carried home",
        repos: ["old-org/slopweaver"],
        seams: failing,
      }),
    );

    expect(refused).toEqual(
      PressResealErrors.storeUnavailable({ doing: "read the press register", reason: "connection reset" }),
    );
  });
});

describe("appendPressResealReceipt", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("appends one line per receipt to an owner-only journal under the home's ledgers", () => {
    const home = mkdtempSync(join(tmpdir(), "press-reseal-"));
    homes.push(home);
    const receipt: PressResealReceipt = {
      atIso: NOW,
      count: 1,
      kind: "landing-press-reseal",
      pairs: [{ newKey: "b".repeat(64), number: 1, oldKey: "a".repeat(64), repoSlug: "old-org/slopweaver" }],
      reason: "carried home",
      repos: ["old-org/slopweaver"],
      sourceSha256: "c".repeat(64),
    };

    const path = unwrap(appendPressResealReceipt({ home, receipt }));
    unwrap(appendPressResealReceipt({ home, receipt }));

    expect(path).toBe(join(home, "ledgers", "landing-press-reseals.jsonl"));
    expect(
      readFileSync(path, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown),
    ).toEqual([receipt, receipt]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "ledgers")).mode & 0o777).toBe(0o700);
  });
});
