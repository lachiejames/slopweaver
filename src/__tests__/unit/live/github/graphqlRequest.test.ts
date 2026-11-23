import { describe, expect, it } from "vitest";

import { missingFileOnlyData, withMissingFilesAsNull } from "../../../../live/github/graphqlRequest.js";

/** The partial data of a read whose base tip holds no file at `f0`, with the head's alias read. */
const DATA = {
  repository: {
    pullRequest: { commits: { nodes: [{ commit: { h0: { mode: 33188 }, oid: "head" } }] } },
    ref: { target: { f0: null, oid: "tip" } },
  },
};

/** What `@octokit/graphql` throws for an answer carrying errors: the partial data beside every error GitHub gave. */
const thrownWith = ({ errors }: { errors: readonly unknown[] }): Error => {
  const thrown = new Error("Request failed due to following response errors");
  return Object.assign(thrown, { data: DATA, errors });
};

/** GitHub's own error for a path the base tip does not hold, as measured live. */
const MISSING = {
  message: "Could not resolve file for path 'a.ts'.",
  path: ["repository", "ref", "target", "f0"],
  type: "NOT_FOUND",
};

describe("missingFileOnlyData", () => {
  it("answers the partial data when every error is a missing file at a null alias", () => {
    expect(missingFileOnlyData({ thrown: thrownWith({ errors: [MISSING, MISSING] }) })).toEqual(DATA);
  });

  it("answers undefined for any other NOT_FOUND, an error at a field that read, or a path into nothing", () => {
    const head = ["repository", "pullRequest", "commits", "nodes", 0, "commit", "h0"];

    expect([
      missingFileOnlyData({ thrown: thrownWith({ errors: [{ ...MISSING, message: "failed to resolve the blob" }] }) }),
      missingFileOnlyData({ thrown: thrownWith({ errors: [{ ...MISSING, path: head }] }) }),
      missingFileOnlyData({ thrown: thrownWith({ errors: [{ ...MISSING, path: ["repository", "ref", "f9"] }] }) }),
      missingFileOnlyData({ thrown: thrownWith({ errors: [{ ...MISSING, path: [] }] }) }),
      missingFileOnlyData({ thrown: thrownWith({ errors: [{ ...MISSING, path: undefined }] }) }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("answers undefined when any error is another kind, there is none, or the throw carries no data", () => {
    expect([
      missingFileOnlyData({
        thrown: thrownWith({ errors: [MISSING, { message: "rate limit", type: "RATE_LIMITED" }] }),
      }),
      missingFileOnlyData({ thrown: thrownWith({ errors: [] }) }),
      missingFileOnlyData({ thrown: new Error("socket hang up") }),
      missingFileOnlyData({ thrown: "a string" }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("withMissingFilesAsNull", () => {
  const missing = thrownWith({ errors: [MISSING] });
  const throwing =
    ({ thrown }: { thrown: Error }) =>
    (): Promise<unknown> =>
      Promise.reject(thrown);

  it("answers the partial data of a missing-file throw only when the caller asked for it", async () => {
    const execute = throwing({ thrown: missing });

    await expect(withMissingFilesAsNull({ execute, missingFileReadsNull: true })).resolves.toEqual(DATA);
    await expect(withMissingFilesAsNull({ execute, missingFileReadsNull: undefined })).rejects.toBe(missing);
  });

  it("rethrows any other failure as it came, and passes an answer through", async () => {
    const other = new Error("socket hang up");

    await expect(
      withMissingFilesAsNull({ execute: throwing({ thrown: other }), missingFileReadsNull: true }),
    ).rejects.toBe(other);
    await expect(
      withMissingFilesAsNull({ execute: () => Promise.resolve({ ok: 1 }), missingFileReadsNull: true }),
    ).resolves.toEqual({ ok: 1 });
  });
});
