/**
 * The card-merchant register's store edge, exercised through an injected fake connection, plus the two
 * home-selected wrappers on a home that selects no store.
 *
 * `.claude/rules/testing.md` bans a MOCK and allows a SEAM; every function here takes its connection as a
 * parameter, so this file hands it one, exactly as `knowledge/recallWriter.test.ts` does. What is under test is
 * the ORDER OF DECISIONS — lock, delete, insert only when there is something to insert, read back, and every
 * thrown query becoming the typed refusal — not the SQL, which `integration/spendMerchantStore.test.ts` settles
 * against a real Postgres.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { SpendMerchantDocument } from "../../../../spend/merchants/core.js";
import { SpendMerchantErrors } from "../../../../spend/merchants/errors.js";
import { readSpendMerchantRegister } from "../../../../spend/merchants/read.js";
import { readStoredSpendMerchants, replaceStoredSpendMerchants } from "../../../../spend/merchants/store.js";
import { writeSpendMerchantRegister, writeSpendMerchantRegisterOverClient } from "../../../../spend/merchants/write.js";
import type { StoreClient } from "../../../../store/client.js";
import { STORE_URL_ENV, STORE_URL_SECRET } from "../../../../store/config.js";
import { StoreErrors } from "../../../../store/errors.js";
import type { SpendMerchantRow } from "../../../../store/schema/spendMerchant.js";

const ACME = { prefixes: ["acme"], receiptDomains: ["acme.example"], slug: "acme" };
const GLOBEX = { prefixes: ["globex"], receiptDomains: [], slug: "globex" };
const DOCUMENT: SpendMerchantDocument = { merchants: [ACME, GLOBEX], schemaVersion: 1 };

/** What one fake connection was asked to do, in order. */
interface Calls {
  readonly steps: string[];
  readonly inserted: unknown[];
}

/** How the fake answers: the rows a select yields, and which step throws, if any. */
interface FakeScript {
  readonly rows: SpendMerchantRow[];
  readonly throwOn?: "select" | "transaction";
}

/**
 * A fake connection answering exactly the calls the register edge makes: `select().from().orderBy()`, and a
 * transaction whose writer runs `execute`, `delete` and `insert().values()`. A seam, not a mock — nothing is
 * patched or spied on, and the object is passed in as an ordinary argument.
 */
function fakeClient({ calls, script }: { calls: Calls; script: FakeScript }): StoreClient {
  const select = (): unknown => ({
    from: (): unknown => ({
      orderBy: (): Promise<SpendMerchantRow[]> => {
        calls.steps.push("select");
        if (script.throwOn === "select") {
          return Promise.reject(new Error("connection reset"));
        }
        return Promise.resolve(script.rows);
      },
    }),
  });
  // Each write records `<step>:start` when called and `<step>:end` only once it SETTLES, a whole event-loop turn
  // later. So a write the edge forgot to await shows up in the order: the next write starts before it ends, or the
  // transaction's `commit` lands before its end.
  const settled = async ({ step }: { step: string }): Promise<void> => {
    calls.steps.push(`${step}:start`);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    calls.steps.push(`${step}:end`);
  };
  const writer = {
    delete: (): Promise<void> => settled({ step: "delete" }),
    execute: (): Promise<void> => settled({ step: "lock" }),
    insert: (): unknown => ({
      // named-object-params-exempt: Drizzle's `values(rows)` is positional, and the fake must match the call
      values: async (rows: unknown): Promise<void> => {
        await settled({ step: "insert" });
        calls.inserted.push(rows);
      },
    }),
  };
  const db = {
    select,
    // named-object-params-exempt: Drizzle's `transaction(callback)` is positional, and the fake must match
    transaction: async (run: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      calls.steps.push("begin");
      if (script.throwOn === "transaction") {
        throw new Error("deadlock detected");
      }
      const answer = await run(writer);
      calls.steps.push("commit");
      return answer;
    },
  };
  // The fake answers exactly the calls this edge makes; a structural cast hands the seam to a function that
  // takes the real type.
  return { close: async (): Promise<void> => {}, db } as unknown as StoreClient;
}

/** A whole replace, every write awaited in turn: each one ends before the next starts, and all before the commit. */
const COMPLETE_REPLACE = [
  "begin",
  "lock:start",
  "lock:end",
  "delete:start",
  "delete:end",
  "insert:start",
  "insert:end",
  "commit",
] as const;

/** A fresh call log. */
function freshCalls(): Calls {
  return { inserted: [], steps: [] };
}

describe("readStoredSpendMerchants", () => {
  it("reads every row back as the canonical document", async () => {
    const calls = freshCalls();
    const client = fakeClient({ calls, script: { rows: [GLOBEX, ACME] } });
    expect(unwrap(await readStoredSpendMerchants({ client }))).toEqual(DOCUMENT);
    expect(calls.steps).toEqual(["select"]);
  });

  it("reads no rows as an empty register", async () => {
    const client = fakeClient({ calls: freshCalls(), script: { rows: [] } });
    expect(unwrap(await readStoredSpendMerchants({ client }))).toEqual({ merchants: [], schemaVersion: 1 });
  });

  it("refuses a thrown query as the store's own failure, naming the read", async () => {
    const client = fakeClient({ calls: freshCalls(), script: { rows: [], throwOn: "select" } });
    const error = unwrapErr(await readStoredSpendMerchants({ client }));
    expect(error.code).toBe("SPEND_MERCHANT_QUERY_FAILED");
    expect(error.message).toContain("card merchants read");
  });

  it("refuses stored rows that do not read", async () => {
    const client = fakeClient({ calls: freshCalls(), script: { rows: [ACME, ACME] } });
    expect(unwrapErr(await readStoredSpendMerchants({ client }))).toEqual(
      SpendMerchantErrors.invalid({
        issues: [
          "merchant acme: the slug is registered twice",
          'merchant acme: prefix "acme" overlaps "acme" of acme, so a charge could match both',
        ],
      }),
    );
  });
});

describe("replaceStoredSpendMerchants", () => {
  it("locks, deletes and inserts every merchant inside one transaction", async () => {
    const calls = freshCalls();
    const client = fakeClient({ calls, script: { rows: [] } });
    expect((await replaceStoredSpendMerchants({ client, document: DOCUMENT })).isOk()).toBe(true);
    expect(calls.steps).toEqual([...COMPLETE_REPLACE]);
    expect(calls.inserted).toEqual([[ACME, GLOBEX]]);
  });

  it("clears the table and inserts nothing for an empty register", async () => {
    const calls = freshCalls();
    const client = fakeClient({ calls, script: { rows: [] } });
    const empty: SpendMerchantDocument = { merchants: [], schemaVersion: 1 };
    expect((await replaceStoredSpendMerchants({ client, document: empty })).isOk()).toBe(true);
    expect(calls.steps).toEqual(["begin", "lock:start", "lock:end", "delete:start", "delete:end", "commit"]);
    expect(calls.inserted).toEqual([]);
  });

  it("refuses a failed transaction as the store's own failure, naming the replace", async () => {
    const calls = freshCalls();
    const client = fakeClient({ calls, script: { rows: [], throwOn: "transaction" } });
    const error = unwrapErr(await replaceStoredSpendMerchants({ client, document: DOCUMENT }));
    expect(error.code).toBe("SPEND_MERCHANT_QUERY_FAILED");
    expect(error.message).toContain("card merchants replace");
    expect(calls.steps).toEqual(["begin"]);
  });
});

describe("writeSpendMerchantRegisterOverClient", () => {
  it("replaces, then reports the register as the store reads it back", async () => {
    const calls = freshCalls();
    const client = fakeClient({ calls, script: { rows: [ACME] } });
    expect(unwrap(await writeSpendMerchantRegisterOverClient({ client, document: DOCUMENT }))).toEqual({
      merchants: [ACME],
      schemaVersion: 1,
    });
    // The read-back follows the commit, so what is reported is what a completed replace left.
    expect(calls.steps).toEqual([...COMPLETE_REPLACE, "select"]);
  });

  it("refuses a failed replace without reading anything back", async () => {
    const calls = freshCalls();
    const client = fakeClient({ calls, script: { rows: [ACME], throwOn: "transaction" } });
    expect(unwrapErr(await writeSpendMerchantRegisterOverClient({ client, document: DOCUMENT })).code).toBe(
      "SPEND_MERCHANT_QUERY_FAILED",
    );
    expect(calls.steps).toEqual(["begin"]);
  });
});

describe("the home-selected read and write on a home that selects no store", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A throwaway home with no store selected, removed after each test. */
  function storelessHome(): string {
    const home = mkdtempSync(join(tmpdir(), "sw-spend-merchants-"));
    homes.push(home);
    return home;
  }

  const ABSENT = SpendMerchantErrors.queryFailed({
    cause: StoreErrors.urlMissing({ envVar: STORE_URL_ENV, secretName: STORE_URL_SECRET }),
  });

  it("reads as the store being unselected, which the reader turns into an empty register", async () => {
    expect(unwrapErr(await readSpendMerchantRegister({ home: storelessHome() }))).toEqual(ABSENT);
  });

  it("refuses a write the same way, writing nothing", async () => {
    expect(unwrapErr(await writeSpendMerchantRegister({ document: DOCUMENT, home: storelessHome() }))).toEqual(ABSENT);
  });
});
