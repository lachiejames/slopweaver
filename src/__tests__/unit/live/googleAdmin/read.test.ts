/**
 * One planned Admin API call driven through a scripted client standing in for the grant's `OAuth2Client`:
 * the URL carries the plan's query on every page and a page token only from the second, records gather
 * across pages, the first page decides the payload shape, the read stops at ten pages and says so, and a
 * refusal comes back as Google's status and message after exactly one attempt.
 */
import { describe, expect, it } from "vitest";

import type { GoogleAdminPlannedCall } from "../../../../atlas/googleAdmin/adminApi/plan.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type GoogleAdminRequest, readGoogleAdminCollection } from "../../../../live/googleAdmin/read.js";

const CALL: GoogleAdminPlannedCall = {
  baseUrl: "https://admin.googleapis.com/",
  collectionField: "users",
  document: "admin:directory_v1",
  id: "directory.users.list",
  kind: "user",
  paging: "pageToken",
  path: "admin/directory/v1/users",
  query: { customer: "my_customer" },
  scope: "https://www.googleapis.com/auth/admin.directory.user.readonly",
};

const FIRST_PAGE_URL = "https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer";

/** A client answering each request with the next scripted body, or throwing it when it is an `Error`. */
function scriptedClient({ answers }: { answers: readonly unknown[] }): {
  client: { request: GoogleAdminRequest };
  requested: { method: string; url: string }[];
} {
  const requested: { method: string; url: string }[] = [];
  const request: GoogleAdminRequest = async (input) => {
    requested.push({ method: input.method, url: input.url });
    const answer = answers[requested.length - 1];
    if (answer instanceof Error) {
      throw answer;
    }
    return { data: answer };
  };
  return { client: { request }, requested };
}

/** One full page holding a single keyed user, pointing at a further page. */
function pageWithToken({ index }: { index: number }): unknown {
  return { nextPageToken: `tok-${String(index)}`, users: [{ id: `u-${String(index)}` }] };
}

describe("readGoogleAdminCollection", () => {
  it("sends the plan's query on page one and adds the page token only from page two", async () => {
    const { client, requested } = scriptedClient({
      answers: [
        { nextPageToken: "tok-1", users: [{ id: "u-2", primaryEmail: "b@example.invalid" }, { id: "u-1" }] },
        { users: [{ id: "u-3" }] },
      ],
    });

    const result = await readGoogleAdminCollection({ call: CALL, client, scopeId: "scope-paging" });

    expect(requested).toEqual([
      { method: "GET", url: FIRST_PAGE_URL },
      { method: "GET", url: `${FIRST_PAGE_URL}&pageToken=tok-1` },
    ]);
    expect(unwrap(result)).toEqual({
      records: [
        { fields: ["id"], providerId: "u-1" },
        { fields: ["id", "primaryEmail"], providerId: "u-2" },
        { fields: ["id"], providerId: "u-3" },
      ],
      shape: "records",
      truncated: false,
    });
  });

  it("keeps the first page's shape when the final page omits the collection field", async () => {
    const { client, requested } = scriptedClient({
      answers: [{ nextPageToken: "tok-1", users: [{ id: "u-1" }] }, {}],
    });

    const result = await readGoogleAdminCollection({ call: CALL, client, scopeId: "scope-shape" });

    expect(requested.length).toBe(2);
    expect(unwrap(result)).toEqual({
      records: [{ fields: ["id"], providerId: "u-1" }],
      shape: "records",
      truncated: false,
    });
  });

  it("returns only the keyed records, and the result carries no count of the ones it dropped", async () => {
    const { client } = scriptedClient({
      answers: [{ users: [{ id: "u-1" }, { email: "nokey@example.invalid" }, "not-an-object"] }],
    });

    const result = await readGoogleAdminCollection({ call: CALL, client, scopeId: "scope-unkeyed" });

    expect(unwrap(result)).toEqual({
      records: [{ fields: ["id"], providerId: "u-1" }],
      shape: "records",
      truncated: false,
    });
  });

  it("reports a tenth page that ends the collection as complete, and a tenth page with a further token as truncated", async () => {
    const nineFull = Array.from({ length: 9 }, (_, index) => pageWithToken({ index }));
    const ended = scriptedClient({ answers: [...nineFull, { users: [{ id: "u-9" }] }] });
    const continues = scriptedClient({
      answers: [...nineFull, pageWithToken({ index: 9 }), pageWithToken({ index: 10 })],
    });

    const complete = unwrap(
      await readGoogleAdminCollection({ call: CALL, client: ended.client, scopeId: "scope-cap-a" }),
    );
    const truncated = unwrap(
      await readGoogleAdminCollection({ call: CALL, client: continues.client, scopeId: "scope-cap-b" }),
    );

    expect(ended.requested.length).toBe(10);
    expect(complete.truncated).toBe(false);
    expect(complete.records.length).toBe(10);
    expect(continues.requested.length).toBe(10);
    expect(truncated.truncated).toBe(true);
    expect(truncated.records.length).toBe(10);
    expect(continues.requested[9]).toEqual({ method: "GET", url: `${FIRST_PAGE_URL}&pageToken=tok-8` });
  });

  it("reports a thrown numeric status as Google's own status, after exactly one attempt", async () => {
    const { client, requested } = scriptedClient({
      answers: [Object.assign(new Error("Not Authorized to access this resource/api"), { status: 403 })],
    });

    const result = await readGoogleAdminCollection({ call: CALL, client, scopeId: "scope-403" });

    expect(requested.length).toBe(1);
    expect(unwrapErr(result)).toEqual({ message: "Not Authorized to access this resource/api", status: 403 });
  });

  it("falls back to a numeric code when the thrown error carries no status", async () => {
    const { client, requested } = scriptedClient({
      answers: [Object.assign(new Error("Requested entity was not found."), { code: 404 })],
    });

    const result = await readGoogleAdminCollection({ call: CALL, client, scopeId: "scope-404" });

    expect(requested.length).toBe(1);
    expect(unwrapErr(result)).toEqual({ message: "Requested entity was not found.", status: 404 });
  });

  it("reports status 0 when the thrown error carries neither a numeric status nor a numeric code", async () => {
    const { client, requested } = scriptedClient({
      answers: [Object.assign(new Error("Invalid Input"), { code: "invalid", status: "403" })],
    });

    const result = await readGoogleAdminCollection({ call: CALL, client, scopeId: "scope-none" });

    expect(requested.length).toBe(1);
    expect(unwrapErr(result)).toEqual({ message: "Invalid Input", status: 0 });
  });

  it("fails the whole read when a later page is refused, keeping none of the earlier records", async () => {
    const { client, requested } = scriptedClient({
      answers: [pageWithToken({ index: 1 }), Object.assign(new Error("Forbidden"), { status: 403 })],
    });

    const result = await readGoogleAdminCollection({ call: CALL, client, scopeId: "scope-later" });

    expect(requested.length).toBe(2);
    expect(unwrapErr(result)).toEqual({ message: "Forbidden", status: 403 });
  });
});
