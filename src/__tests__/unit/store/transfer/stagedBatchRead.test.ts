/**
 * The two staged-batch reads staging and an apply share, over a scripted client (`../../../scriptedStoreClient.ts`):
 * the statement each issues, scoped to its batch, and the rows it maps back under the names its callers read.
 */
import { describe, expect, it } from "vitest";

import { stagedPartNames, stagedQuestions } from "../../../../store/transfer/stagedBatchRead.js";
import { scriptedStoreClient } from "../../../scriptedStoreClient.js";

describe("stagedPartNames", () => {
  it("reads the batch's part rows and answers their names", async () => {
    const { client, statements } = scriptedStoreClient({ answer: () => [["memories"], ["standing-asks"]] });
    const parts = await client.db.transaction(async (writer) => stagedPartNames({ batchId: "batch-1", writer }));
    expect(parts).toEqual(["memories", "standing-asks"]);
    expect(statements().map(({ params, query }) => [query.split(" ")[0], params])).toEqual([["select", ["batch-1"]]]);
    expect(statements()[0]!.query).toContain('from "store_import_part"');
  });
});

describe("stagedQuestions", () => {
  it("reads the batch's questions, each under the names the comparison and the apply read", async () => {
    const { client, statements } = scriptedStoreClient({
      answer: () => [["q-1", "imported text", "a", "activation", null, "standing-asks"]],
    });
    const questions = await client.db.transaction(async (writer) => stagedQuestions({ batchId: "batch-1", writer }));
    expect(questions).toEqual([
      { id: "q-1", imported: "imported text", key: "a", kind: "activation", live: null, part: "standing-asks" },
    ]);
    expect(statements()[0]!.query).toContain('from "store_import_question"');
    expect(statements()[0]!.params).toEqual(["batch-1"]);
  });
});
