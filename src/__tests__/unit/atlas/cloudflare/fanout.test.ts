import { describe, expect, it } from "vitest";

import { CloudflareClientErrors } from "../../../../atlas/cloudflare/errors.js";
import { readParentCollections } from "../../../../atlas/cloudflare/fanout.js";
import { err, ok } from "../../../../lib/result.js";

describe("readParentCollections", () => {
  it("reads every parent's collection, in the same order as parentIds", async () => {
    const attempts = await readParentCollections<number>({
      concurrency: 2,
      parentIds: ["p1", "p2", "p3"],
      read: ({ parentId }) => Promise.resolve(ok([parentId.length])),
    });
    expect(attempts.map((attempt) => attempt.parentId)).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps one parent's failure independent of the others", async () => {
    const attempts = await readParentCollections<string>({
      concurrency: 3,
      parentIds: ["ok-1", "bad", "ok-2"],
      read: ({ parentId }) =>
        Promise.resolve(
          parentId === "bad"
            ? err(CloudflareClientErrors.notFound({ cause: new Error("app not found"), operation: "test" }))
            : ok([parentId]),
        ),
    });
    const badAttempt = attempts.find((attempt) => attempt.parentId === "bad")!;
    const okAttempt = attempts.find((attempt) => attempt.parentId === "ok-1")!;
    expect(badAttempt.result.isErr()).toBe(true);
    expect(okAttempt.result.isOk()).toBe(true);
  });

  it("never runs more than the given concurrency at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await readParentCollections<null>({
      concurrency: 2,
      parentIds: ["a", "b", "c", "d", "e"],
      read: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return ok([null]);
      },
    });
    expect(maxInFlight).toBe(2);
  });

  it("returns an empty list for no parents", async () => {
    const attempts = await readParentCollections<number>({
      concurrency: 4,
      parentIds: [],
      read: () => Promise.resolve(ok([])),
    });
    expect(attempts).toEqual([]);
  });
});
