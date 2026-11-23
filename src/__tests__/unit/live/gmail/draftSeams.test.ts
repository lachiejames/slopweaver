/**
 * Unit: the `users.drafts` seam over a plain fake SDK surface — what it returns, what it refuses, and how
 * many times it asks when told to ask once.
 */
import type { gmail_v1 } from "@googleapis/gmail";
import { describe, expect, it } from "vitest";

import { draftSeams } from "../../../../live/gmail/draftSeams.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";

/** A fake `drafts` surface recording each create, answering with the given draft id or throwing. */
function fakeClient({ id, fails = false }: { id: string | undefined; fails?: boolean }): {
  client: gmail_v1.Gmail;
  creates: number[];
} {
  const creates: number[] = [];
  const drafts = {
    create: async () => {
      creates.push(1);
      if (fails) {
        throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      }
      return { data: { id, message: { id: "m-1" } } };
    },
  };
  return { client: { users: { drafts } } as unknown as gmail_v1.Gmail, creates };
}

/** A fake `drafts.get` surface answering every id with the given Draft resource. */
function fakeGetClient({ draft }: { draft: gmail_v1.Schema$Draft }): gmail_v1.Gmail {
  const drafts = { get: async () => ({ data: draft }) };
  return { users: { drafts } } as unknown as gmail_v1.Gmail;
}

describe("draftSeams.getDraft", () => {
  it("reports the id the response echoes, with the message it holds", async () => {
    const client = fakeGetClient({ draft: { id: "d-echoed", message: { id: "m-1", threadId: "t-1" } } });
    const fetched = await draftSeams({ client, scopeId: "s" }).getDraft({ id: "d-1" });
    expect(fetched._unsafeUnwrap()).toStrictEqual({ id: "d-echoed", message: { id: "m-1", threadId: "t-1" } });
  });

  it("keeps the requested id as the identity of a successful fetch that echoed none", async () => {
    const client = fakeGetClient({ draft: { id: null, message: { id: "m-1" } } });
    const fetched = await draftSeams({ client, scopeId: "s" }).getDraft({ id: "d-1" });
    expect(fetched._unsafeUnwrap().id).toBe("d-1");
  });

  it("refuses a fetched Draft with no message as malformed, naming the call, the draft and the field", async () => {
    const client = fakeGetClient({ draft: { id: "d-1" } });
    const fetched = await draftSeams({ client, scopeId: "s" }).getDraft({ id: "d-1" });
    expect(fetched._unsafeUnwrapErr()).toStrictEqual(
      GmailErrors.responseFieldMissing({ field: "message", operation: "gmail.users.drafts.get", subject: "draft d-1" }),
    );
  });

  it("refuses a fetched Draft whose message arrived as something other than an object as MALFORMED", async () => {
    const draft = { id: "d-1", message: "not-a-message" } as unknown as gmail_v1.Schema$Draft;
    const fetched = await draftSeams({ client: fakeGetClient({ draft }), scopeId: "s" }).getDraft({ id: "d-1" });
    expect(fetched._unsafeUnwrapErr()).toStrictEqual(
      GmailErrors.responseFieldMalformed({
        expected: "an object",
        field: "message",
        operation: "gmail.users.drafts.get",
        subject: "draft d-1",
      }),
    );
  });

  it("keeps a Draft whose message is present but empty, distinct from one with no message", async () => {
    const client = fakeGetClient({ draft: { id: "d-1", message: {} } });
    const fetched = await draftSeams({ client, scopeId: "s" }).getDraft({ id: "d-1" });
    expect(fetched._unsafeUnwrap()).toStrictEqual({ id: "d-1", message: {} });
  });
});

describe("draftSeams.createDraft", () => {
  it("refuses a stored draft returned with no message as malformed, naming the call, the draft and the field", async () => {
    const drafts = { create: async () => ({ data: { id: "d-1" } }) };
    const client = { users: { drafts } } as unknown as gmail_v1.Gmail;
    const created = await draftSeams({ client, scopeId: "s" }).createDraft({ raw: "cmF3" });
    expect(created._unsafeUnwrapErr()).toStrictEqual(
      GmailErrors.responseFieldMissing({
        field: "message",
        operation: "gmail.users.drafts.create",
        subject: "draft d-1",
      }),
    );
  });

  it("refuses a stored draft whose message arrived as something other than an object as MALFORMED", async () => {
    const drafts = { create: async () => ({ data: { id: "d-1", message: "not-a-message" } }) };
    const client = { users: { drafts } } as unknown as gmail_v1.Gmail;
    const created = await draftSeams({ client, scopeId: "s" }).createDraft({ raw: "cmF3" });
    expect(created._unsafeUnwrapErr()).toStrictEqual(
      GmailErrors.responseFieldMalformed({
        expected: "an object",
        field: "message",
        operation: "gmail.users.drafts.create",
        subject: "draft d-1",
      }),
    );
  });

  it("keeps a stored draft whose message is present but empty, distinct from one with no message", async () => {
    const drafts = { create: async () => ({ data: { id: "d-1", message: {} } }) };
    const client = { users: { drafts } } as unknown as gmail_v1.Gmail;
    const created = await draftSeams({ client, scopeId: "s" }).createDraft({ raw: "cmF3" });
    expect(created._unsafeUnwrap()).toStrictEqual({ id: "d-1", message: {} });
  });

  it("returns the stored draft's id", async () => {
    const { client } = fakeClient({ id: "d-1" });
    const created = await draftSeams({ client, scopeId: "s" }).createDraft({ raw: "cmF3" });
    expect(created._unsafeUnwrap().id).toBe("d-1");
  });

  it("refuses a stored draft that came back with no id, rather than inventing one", async () => {
    const { client } = fakeClient({ id: undefined });
    const created = await draftSeams({ client, scopeId: "s" }).createDraft({ raw: "cmF3" });
    expect(created._unsafeUnwrapErr().message).toContain("returned no draft id");
  });

  it("makes exactly one attempt when told once, even on a failure a retrying call would repeat", async () => {
    const { client, creates } = fakeClient({ fails: true, id: "d-1" });
    const created = await draftSeams({ client, scopeId: "s" }).createDraft({ once: true, raw: "cmF3" });
    expect(created._unsafeUnwrapErr().code).toBe("API_FAILED");
    expect(creates).toHaveLength(1);
  });
});
