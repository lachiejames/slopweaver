/**
 * Unit: retiring named identities from the store, over a plain fake client that records each statement it
 * is handed. What is pinned is the contract the caller relies on: an empty list runs no statement at all, the
 * count is the rows the delete returned, and a failed delete names what it was retiring.
 */
import { describe, expect, it } from "vitest";

import type { StoreClient } from "../../../store/client.js";
import { deleteContentIdentities } from "../../../store/contentRemoval.js";

/** A client whose `execute` answers with the given rows, or throws the given error, and counts its calls. */
function fakeClient({ rows, failure }: { rows: readonly unknown[]; failure?: Error }): {
  client: StoreClient;
  calls: () => number;
} {
  let calls = 0;
  const db = {
    execute: (): Promise<readonly unknown[]> => {
      calls += 1;
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(rows);
    },
  };
  return { calls: () => calls, client: { close: () => Promise.resolve(), db } as unknown as StoreClient };
}

describe("deleteContentIdentities", () => {
  it("deletes nothing and runs no statement for an empty list", async () => {
    const { client, calls } = fakeClient({ rows: [] });
    const result = await deleteContentIdentities({ client, source: "fathom", sourceIds: [] });
    expect(result._unsafeUnwrap()).toBe(0);
    expect(calls()).toBe(0);
  });

  it("answers how many rows the one delete returned", async () => {
    const { client, calls } = fakeClient({ rows: [{ id: 1 }, { id: 2 }] });
    const result = await deleteContentIdentities({ client, source: "fathom", sourceIds: ["share:a", "share:b"] });
    expect(result._unsafeUnwrap()).toBe(2);
    expect(calls()).toBe(1);
  });

  it("names what it was retiring when the delete fails", async () => {
    const { client } = fakeClient({ failure: new Error("connection refused"), rows: [] });
    const result = await deleteContentIdentities({ client, source: "fathom", sourceIds: ["share:a", "share:b"] });
    expect(result._unsafeUnwrapErr().code).toBe("STORE_QUERY_FAILED");
    expect(result._unsafeUnwrapErr().message).toContain("retiring 2 fathom row(s) failed");
  });
});
