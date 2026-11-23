import { describe, expect, it } from "vitest";

import { call, nextPageToken, pageToEnd, pageTokenField, refusal } from "../../../gcpAudit/call.js";
import { GcpAuditErrors } from "../../../gcpAudit/errors.js";
import { LIST_SINKS } from "../../../gcpAudit/wire.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

describe("nextPageToken", () => {
  it("ends a list on an absent or an empty token, and carries any other", () => {
    expect(nextPageToken({ next: undefined })).toBeUndefined();
    expect(nextPageToken({ next: "" })).toBeUndefined();
    expect(nextPageToken({ next: "t2" })).toBe("t2");
  });
});

describe("pageTokenField", () => {
  it("leaves the field off the first page rather than sending it undefined", () => {
    expect(pageTokenField({ pageToken: undefined })).toEqual({});
    expect(pageTokenField({ pageToken: "t2" })).toEqual({ pageToken: "t2" });
  });
});

describe("pageToEnd", () => {
  it("follows tokens to the last page, asking each page with the previous page's token", async () => {
    const asked: (string | undefined)[] = [];
    const pages = new Map<string | undefined, { items: readonly number[]; next: string | undefined }>([
      [undefined, { items: [1, 2], next: "p2" }],
      ["p2", { items: [3], next: "" }],
    ]);
    const found = await pageToEnd({
      fetchPage: ({ pageToken }) => {
        asked.push(pageToken);
        return Promise.resolve(ok(pages.get(pageToken)!));
      },
    });
    expect(unwrap(found)).toEqual([1, 2, 3]);
    expect(asked).toEqual([undefined, "p2"]);
  });

  it("stops on a failed page and answers that failure, never the items before it", async () => {
    const failure = GcpAuditErrors.transportFailed({ detail: "down", operation: "op", status: 503 });
    const found = await pageToEnd<number>({
      fetchPage: ({ pageToken }) =>
        Promise.resolve(pageToken === undefined ? ok({ items: [1], next: "p2" }) : err(failure)),
    });
    expect(unwrapErr(found)).toEqual(failure);
  });
});

describe("call", () => {
  it("answers the boundary's parse of what the sender returned", async () => {
    const answered = await call({
      boundary: LIST_SINKS,
      request: { kind: "list-sinks", parent: "organizations/1" },
      send: () => Promise.resolve(ok({ sinks: [{ destination: "d", name: "n" }] })),
    });
    expect(unwrap(answered)).toEqual({ sinks: [{ destination: "d", name: "n" }] });
  });

  it("maps a shape the boundary refuses to RESPONSE_CHANGED naming the endpoint", async () => {
    const answered = await call({
      boundary: LIST_SINKS,
      request: { kind: "list-sinks", parent: "organizations/1" },
      send: () => Promise.resolve(ok({ sinks: [{ destination: "d", name: "n", surprise: true }] })),
    });
    expect(unwrapErr(answered)).toMatchObject({ code: "RESPONSE_CHANGED", endpoint: "GET logging v2 sinks" });
  });
});

describe("refusal", () => {
  it("keeps a transport failure's HTTP status, and null for any other failure", () => {
    expect(
      refusal({
        error: GcpAuditErrors.transportFailed({ detail: "no", operation: "op", status: 403 }),
        what: "projects/p-one",
      }),
    ).toEqual({ message: "op failed (HTTP 403): no", status: 403, what: "projects/p-one" });
    expect(refusal({ error: GcpAuditErrors.inputInvalid({ why: "bad" }), what: "x" })).toEqual({
      message: "bad",
      status: null,
      what: "x",
    });
  });
});
