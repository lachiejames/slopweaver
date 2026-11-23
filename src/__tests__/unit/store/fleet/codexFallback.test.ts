/**
 * Projecting one fallback directory's texts into its store rows — verbatim text, best-effort columns.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  decodeFallbackDocument,
  fallbackImportDivergences,
  projectFallbackRequest,
} from "../../../../store/fleet/codexFallback.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";

const REQUEST = `${JSON.stringify(
  {
    createdAtIso: "2026-09-14T01:00:00.000Z",
    mode: "plan",
    pass: "p2",
    repoRoot: "/w/repo",
    requestId: "req-a",
    tree: { branch: "feature" },
  },
  null,
  2,
)}\n`;

function sha({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("projectFallbackRequest", () => {
  it("stores both texts verbatim, hashed, with the request's filter columns read out", () => {
    const projected = unwrap(
      projectFallbackRequest({
        path: "/h/codex-fallback/req-a",
        receiptText: '{"r":1}\n',
        requestId: "req-a",
        requestText: REQUEST,
      }),
    );
    expect(projected).toEqual({
      receipt: { receiptSha256: sha({ text: '{"r":1}\n' }), receiptText: '{"r":1}\n', requestId: "req-a" },
      request: {
        branch: "feature",
        createdAt: new Date("2026-09-14T01:00:00.000Z"),
        mode: "plan",
        pass: "p2",
        readerEpoch: 2,
        repoRoot: "/w/repo",
        requestId: "req-a",
        requestSha256: sha({ text: REQUEST }),
        requestText: REQUEST,
      },
    });
  });

  it("stores a request that is not JSON, verbatim, with every filter column NULL — the reader decides what it means", () => {
    const projected = unwrap(
      projectFallbackRequest({ path: "/h/x", receiptText: undefined, requestId: "x", requestText: "{ broken" }),
    );
    expect(projected.receipt).toBe(undefined);
    expect(projected.request).toEqual({
      branch: null,
      createdAt: null,
      mode: null,
      pass: null,
      readerEpoch: 2,
      repoRoot: null,
      requestId: "x",
      requestSha256: sha({ text: "{ broken" }),
      requestText: "{ broken",
    });
  });

  it("leaves a filter column NULL when its value is one Postgres could not index or hold, and keeps the text", () => {
    const requestText = JSON.stringify({
      createdAtIso: "-010000-01-01T00:00:00.000Z",
      mode: "m".repeat(513),
      pass: "p".repeat(512),
      tree: { branch: "b".repeat(100_000) },
    });
    const projected = unwrap(
      projectFallbackRequest({ path: "/h/odd", receiptText: undefined, requestId: "odd", requestText }),
    );
    expect(projected.request).toEqual({
      branch: null,
      createdAt: null,
      mode: null,
      pass: "p".repeat(512),
      readerEpoch: 2,
      repoRoot: null,
      requestId: "odd",
      requestSha256: sha({ text: requestText }),
      requestText,
    });
  });

  it("refuses a NUL byte rather than store a text whose digest no longer binds", () => {
    const refused = unwrapErr(
      projectFallbackRequest({ path: "/h/n", receiptText: "a\u0000", requestId: "n", requestText: "{}" }),
    );
    expect(refused.code).toBe("UNSTORABLE_FALLBACK_DOCUMENT");
    expect(refused.message).toBe("/h/n cannot be stored as a Claude fallback document verbatim: it holds a NUL byte");
  });
});

describe("decodeFallbackDocument", () => {
  it("decodes valid UTF-8 exactly, keeping a byte-order mark because it is one of the bytes", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0xc3, 0xa9, 0x7d]);
    expect(unwrap(decodeFallbackDocument({ bytes, path: "/h/r.json" }))).toBe("﻿{é}");
  });

  it("refuses a malformed byte rather than store the U+FFFD a lenient decode would put in its place", () => {
    const refused = unwrapErr(decodeFallbackDocument({ bytes: new Uint8Array([0x80]), path: "/h/r.json" }));
    expect(refused.code).toBe("UNSTORABLE_FALLBACK_DOCUMENT");
    expect(refused.message).toBe(
      "/h/r.json cannot be stored as a Claude fallback document verbatim: it is not valid UTF-8",
    );
  });
});

describe("fallbackImportDivergences", () => {
  const pathOf = ({ requestId }: { requestId: string }): string => `/h/codex-fallback/${requestId}`;
  const answered = unwrap(
    projectFallbackRequest({ path: pathOf({ requestId: "a" }), receiptText: "R", requestId: "a", requestText: "Q" }),
  );
  const pending = unwrap(
    projectFallbackRequest({
      path: pathOf({ requestId: "b" }),
      receiptText: undefined,
      requestId: "b",
      requestText: "P",
    }),
  );

  it("finds nothing when the store holds every legacy text byte for byte", () => {
    const stored = new Map([
      ["a", { receiptText: "R", requestText: "Q" }],
      ["b", { receiptText: null, requestText: "P" }],
    ]);
    expect(fallbackImportDivergences({ pathOf, projected: [answered, pending], stored })).toEqual([]);
  });

  it("does not call a receipt the store holds and the directory lacks a divergence — the store is ahead", () => {
    const stored = new Map([["b", { receiptText: "later", requestText: "P" }]]);
    expect(fallbackImportDivergences({ pathOf, projected: [pending], stored })).toEqual([]);
  });

  it("names a request and a receipt whose stored text differs, and leaves the stored rows standing", () => {
    const stored = new Map([["a", { receiptText: "R2", requestText: "Q2" }]]);
    expect(fallbackImportDivergences({ pathOf, projected: [answered], stored })).toEqual([
      FleetImportErrors.fallbackImportDiverged({ document: "request", path: "/h/codex-fallback/a", requestId: "a" }),
      FleetImportErrors.fallbackImportDiverged({ document: "receipt", path: "/h/codex-fallback/a", requestId: "a" }),
    ]);
  });

  it("names a legacy receipt the store never took, and a request whose row is missing altogether", () => {
    const stored = new Map([["a", { receiptText: null, requestText: "Q" }]]);
    expect(fallbackImportDivergences({ pathOf, projected: [answered, pending], stored })).toEqual([
      FleetImportErrors.fallbackImportDiverged({ document: "receipt", path: "/h/codex-fallback/a", requestId: "a" }),
      FleetImportErrors.fallbackImportDiverged({ document: "request", path: "/h/codex-fallback/b", requestId: "b" }),
    ]);
    expect(FleetImportErrors.fallbackImportDiverged({ document: "receipt", path: "/p", requestId: "a" }).message).toBe(
      "/p's receipt differs from the stored receipt for a; the stored row stands and was not overwritten",
    );
  });
});
