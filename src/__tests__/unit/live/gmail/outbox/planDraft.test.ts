/*
 * `planGmailDraft` — encoding a new message or a reply, reading the parent's threading headers and subject, and
 * refusing a reply Gmail would draft outside its thread. It moved here when `outbox.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import { planGmailDraft } from "../../../../../live/gmail/outbox.js";
import type { GmailMessage } from "../../../../../live/gmail/parse.js";
import { fakeApi, form, record } from "./harness.js";

describe("planGmailDraft", () => {
  it("encodes the message and reads nothing when there is no reply", async () => {
    const calls = record();
    const plan = unwrap(await planGmailDraft({ account: "me@example.com", api: fakeApi({ calls }), form: form() }));
    expect(plan.message).toContain("To: someone@example.com\r\n");
    expect(plan.reply).toBe(undefined);
  });

  it("sends as the bound account, never as anything the form supplied", async () => {
    const calls = record();
    const plan = unwrap(await planGmailDraft({ account: "me@example.com", api: fakeApi({ calls }), form: form() }));
    expect(plan.from).toBe("me@example.com");
  });

  it("stores nothing — the plan is the whole of what planning does", async () => {
    const calls = record();
    await planGmailDraft({ account: "me@example.com", api: fakeApi({ calls }), form: form() });
    expect(calls.createDraft).toEqual([]);
  });

  it("refuses a hard-wrapped body itself, so a caller that skipped the form's validator stores nothing", async () => {
    const calls = record();
    const refused = unwrapErr(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls }),
        form: form({ body: "one\nwrapped" }),
      }),
    );
    expect(refused.code).toBe("INVALID_ADDRESS");
    expect(refused.message).toContain('body: 1 hard line break inside a paragraph (line 2; first "wrapped")');
    expect(calls.createDraft).toEqual([]);
  });

  it("lifts the parent's threading headers when replying", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<parent@example.com>" },
          { name: "References", value: "<older@example.com>" },
          { name: "Subject", value: "the original" },
        ],
      },
      threadId: "t-9",
    };
    const plan = unwrap(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent }),
        form: form({ subject: "" }),
        replyToId: "p-1",
      }),
    );
    expect(plan.reply).toEqual({
      inReplyTo: "<parent@example.com>",
      references: ["<older@example.com>", "<parent@example.com>"],
      threadId: "t-9",
    });
  });

  it("inherits the parent subject with one Re: when the form left it empty", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<p@e.com>" },
          { name: "Subject", value: "the original" },
        ],
      },
      threadId: "t-9",
    };
    const plan = unwrap(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent }),
        form: form({ subject: "" }),
        replyToId: "p-1",
      }),
    );
    expect(plan.form.subject).toBe("Re: the original");
  });

  it("does not stack a second Re: on a subject that already has one", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<p@e.com>" },
          { name: "Subject", value: "Re: already" },
        ],
      },
      threadId: "t-9",
    };
    const plan = unwrap(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent }),
        form: form({ subject: "" }),
        replyToId: "p-1",
      }),
    );
    expect(plan.form.subject).toBe("Re: already");
  });

  it("keeps an explicit subject on a reply that Gmail would thread, prefixes and case aside", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<p@e.com>" },
          { name: "Subject", value: "Fwd: the  Original" },
        ],
      },
      threadId: "t-9",
    };
    const plan = unwrap(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent }),
        form: form({ subject: "RE: the original" }),
        replyToId: "p-1",
      }),
    );
    expect(plan.form.subject).toBe("RE: the original");
  });

  it("refuses a reply whose subject is not its parent's, since Gmail would draft it outside the thread", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<p@e.com>" },
          { name: "Subject", value: "Quarterly meeting" },
        ],
      },
      threadId: "t-9",
    };
    const failure = unwrapErr(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent }),
        form: form({ subject: "Completely different topic" }),
        replyToId: "p-1",
      }),
    );
    expect(failure).toEqual(
      GmailErrors.replySubjectMismatch({ parentSubject: "Quarterly meeting", subject: "Completely different topic" }),
    );
    expect(calls.createDraft).toEqual([]);
  });

  it("refuses even a bare Re: on a reply to a message with no subject at all", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: { headers: [{ name: "Message-ID", value: "<p@e.com>" }] },
      threadId: "t-9",
    };
    const failure = unwrapErr(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent }),
        form: form({ subject: "Re:" }),
        replyToId: "p-1",
      }),
    );
    expect(failure).toEqual(GmailErrors.replySubjectMismatch({ parentSubject: undefined, subject: "Re:" }));
    expect(failure.message).toContain("(no subject at all)");
  });

  it("never infers a recipient from the parent, because guessing who to mail is the one unsafe guess", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<p@e.com>" },
          { name: "From", value: "someone-else@example.com" },
          { name: "Subject", value: "a subject" },
        ],
      },
      threadId: "t-9",
    };
    const plan = unwrap(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent }),
        form: form(),
        replyToId: "p-1",
      }),
    );
    expect(plan.form.to).toEqual(["someone@example.com"]);
  });

  it("refuses a reply to a message carrying no Message-ID, rather than sending an unthreaded reply", async () => {
    const calls = record();
    const parent: GmailMessage = { id: "p-1", payload: { headers: [] }, threadId: "t-9" };
    const failure = unwrapErr(
      await planGmailDraft({
        account: "me@example.com",
        api: fakeApi({ calls, parent }),
        form: form(),
        replyToId: "p-1",
      }),
    );
    expect(failure.code).toBe("INVALID_ADDRESS");
  });

  it("propagates the seam's typed failure when the parent cannot be read", async () => {
    const calls = record();
    const failure = unwrapErr(
      await planGmailDraft({ account: "me@example.com", api: fakeApi({ calls }), form: form(), replyToId: "p-1" }),
    );
    expect(failure.code).toBe("API_FAILED");
  });
});
