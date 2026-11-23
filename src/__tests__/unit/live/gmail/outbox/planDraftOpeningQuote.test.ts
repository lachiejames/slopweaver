/*
 * `planGmailDraft` on a reply that opens by quoting back the whole parent — refused, unless the quote picks one
 * of several points or the redundant-quote hatch is open. It moved here when `outbox.test.ts` was split by
 * behaviour. Every `ap1` region named in this file is the synthetic Datadog site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { planGmailDraft } from "../../../../../live/gmail/outbox.js";
import type { GmailMessage } from "../../../../../live/gmail/parse.js";
import { fakeApi, form, record } from "./harness.js";

describe("planGmailDraft — an opening quote of the whole parent", () => {
  /** A reply parent whose text/plain body is `body`. */
  function parentSaying({ body }: { body: string }): GmailMessage {
    return {
      id: "p-1",
      payload: {
        body: { data: Buffer.from(body, "utf8").toString("base64url"), size: body.length },
        headers: [
          { name: "Message-ID", value: "<p@e.com>" },
          { name: "Subject", value: "a subject" },
        ],
        mimeType: "text/plain",
      },
      threadId: "t-9",
    };
  }

  const ONE_POINT = "Hi Ada,\n\nCan you confirm which region the account is on?\n\nThanks,\nDavid";

  it("refuses a reply quoting back the parent's one point, and stores nothing", async () => {
    const calls = record();
    const failure = unwrapErr(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent: parentSaying({ body: ONE_POINT }) }),
        form: form({ body: "> Can you confirm which region the account is on?\n\nIt is on ap1." }),
        replyToId: "p-1",
      }),
    );
    expect(failure.code).toBe("REDUNDANT_OPENING_QUOTE");
    expect(failure.message).toContain("slopweaver hatch open redundant-quote");
    expect(calls.createDraft).toEqual([]);
  });

  it("plans the same reply when it opens on the answer", async () => {
    const calls = record();
    const plan = unwrap(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent: parentSaying({ body: ONE_POINT }) }),
        form: form({ body: "It is on ap1." }),
        replyToId: "p-1",
      }),
    );
    expect(plan.form.body).toBe("It is on ap1.");
  });

  it("plans a reply whose quote picks one of the parent's several points", async () => {
    const calls = record();
    const plan = unwrap(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({
          calls,
          parent: parentSaying({ body: "Which region is the account on? And who owns the monitors now?" }),
        }),
        form: form({ body: "> And who owns the monitors now?\n\nPlatform does." }),
        replyToId: "p-1",
      }),
    );
    expect(plan.form.body).toBe("> And who owns the monitors now?\n\nPlatform does.");
  });

  it("plans the redundant quote when the redundant-quote hatch is open", async () => {
    const calls = record();
    const plan = unwrap(
      await planGmailDraft({
        account: "me@example.com",
        allowRedundantQuote: true,
        api: fakeApi({ calls, parent: parentSaying({ body: ONE_POINT }) }),
        form: form({ body: "> Can you confirm which region the account is on?\n\nIt is on ap1." }),
        replyToId: "p-1",
      }),
    );
    expect(plan.form.body).toBe("> Can you confirm which region the account is on?\n\nIt is on ap1.");
  });

  it("refuses a two-paragraph parent quoted whole, ignoring its quoted history", async () => {
    const calls = record();
    const body = "First paragraph.\n\nSecond paragraph.\n\nOn Mon, 28 Sep 2026, Alice wrote:\n> Older text.";
    const failure = unwrapErr(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent: parentSaying({ body }) }),
        form: form({ body: "> First paragraph.\n\n> Second paragraph.\n\nAnswer." }),
        replyToId: "p-1",
      }),
    );
    expect(failure.code).toBe("REDUNDANT_OPENING_QUOTE");
    expect(calls.createDraft).toEqual([]);
  });

  it("refuses rather than checking against nothing when the parent comes back without a message id", async () => {
    const calls = record();
    const { id: _dropped, ...withoutId } = parentSaying({ body: ONE_POINT });
    const failure = unwrapErr(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent: withoutId }),
        form: form({ body: "> Can you confirm which region the account is on?\n\nIt is on ap1." }),
        replyToId: "p-1",
      }),
    );
    expect(failure.code).toBe("INVALID_ADDRESS");
    expect(failure.message).toBe(
      "message p-1 came back without a message id, so its text cannot be read to check the reply",
    );
    expect(calls.createDraft).toEqual([]);
  });
});
