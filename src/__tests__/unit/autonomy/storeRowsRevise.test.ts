/**
 * The autonomy ledger's one in-place UPDATE, `revise`, over a scripted client (`../../scriptedStoreClient.ts`): the
 * compare-and-swap statement it issues, what an updated and an unmatched row answer, and which failure a driver throw
 * becomes. Postgres's own jsonb comparison is the opt-in case in `integration/autonomyLedgerStore.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { autonomyRecordJson } from "../../../autonomy/storeRecord.js";
import { autonomyRowsOver } from "../../../autonomy/storeRows.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { scriptedStoreClient } from "../../scriptedStoreClient.js";

const EXPECTED = { actionId: "finding-pr.watchpr-dies", why: "#12 lagged", witness: "w" };
const REVISION = {
  actionId: "finding-pr.watchpr-dies",
  expected: EXPECTED,
  row: {
    record: { ...EXPECTED, why: "acme/widgets#12 lagged", witness: "w qualified" },
    why: "acme/widgets#12 lagged",
    witness: "w qualified",
  },
};

describe("autonomyRowsOver revise", () => {
  it("answers true when one act was updated, comparing the stored record's jsonb text to the one read", async () => {
    const { client, statements } = scriptedStoreClient({ answer: () => [[7]] });

    expect(unwrap(await autonomyRowsOver({ client }).revise(REVISION))).toBe(true);
    expect(statements().length).toBe(1);
    expect(statements()[0]!.query).toContain('"record"::text = (cast(');
    expect(statements()[0]!.params).toContain(autonomyRecordJson({ record: EXPECTED }));
    expect(statements()[0]!.params).toContain(autonomyRecordJson({ record: REVISION.row.record }));
  });

  it("answers false when no act still holds the record read, so nothing was overwritten", async () => {
    const { client } = scriptedStoreClient({ answer: () => [] });

    expect(unwrap(await autonomyRowsOver({ client }).revise(REVISION))).toBe(false);
  });

  it("turns a driver throw into AUTONOMY_STORE_UNAVAILABLE naming the revision", async () => {
    const { client } = scriptedStoreClient({
      answer: () => {
        throw new Error("connection reset");
      },
    });

    const refused = unwrapErr(await autonomyRowsOver({ client }).revise(REVISION));

    expect(refused.code).toBe("AUTONOMY_STORE_UNAVAILABLE");
    expect(refused.message).toContain("revise the act stored under one id");
  });
});
