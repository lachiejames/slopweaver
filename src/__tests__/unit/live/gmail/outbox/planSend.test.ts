/*
 * `planGmailSend` — reading the stored draft back, Bcc included, and digesting what the server actually holds,
 * while sending nothing. It moved here when `outbox.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { GmailDraft } from "../../../../../live/gmail/api.js";
import { approvalDigest } from "../../../../../live/gmail/compose.js";
import { planGmailSend } from "../../../../../live/gmail/outbox.js";
import { draftFixture, fakeApi, form, record } from "./harness.js";

describe("planGmailSend", () => {
  it("reads the draft back and reports what would actually be delivered", async () => {
    const calls = record();
    const draft = draftFixture({
      headers: [
        { name: "From", value: "me@example.com" },
        { name: "To", value: "someone@example.com" },
        { name: "Subject", value: "a subject" },
      ],
    });
    const plan = unwrap(
      await planGmailSend({ account: "me@example.com", api: fakeApi({ calls, draft }), draftId: "d-1" }),
    );
    expect(plan.to).toEqual(["someone@example.com"]);
    expect(plan.subject).toBe("a subject");
    expect(plan.body).toBe("the body");
  });

  it("reads the Bcc header, which is exactly what an approver must be shown", async () => {
    const calls = record();
    const draft = draftFixture({
      headers: [
        { name: "From", value: "me@example.com" },
        { name: "To", value: "someone@example.com" },
        { name: "Bcc", value: "quiet@example.com" },
        { name: "Subject", value: "a subject" },
      ],
    });
    const plan = unwrap(
      await planGmailSend({ account: "me@example.com", api: fakeApi({ calls, draft }), draftId: "d-1" }),
    );
    expect(plan.bcc).toEqual(["quiet@example.com"]);
  });

  it("digests the message AS READ BACK, so the approval covers what the server holds", async () => {
    const calls = record();
    const draft = draftFixture({
      headers: [
        { name: "From", value: "me@example.com" },
        { name: "To", value: "someone@example.com" },
        { name: "Subject", value: "a subject" },
      ],
    });
    const plan = unwrap(
      await planGmailSend({ account: "me@example.com", api: fakeApi({ calls, draft }), draftId: "d-1" }),
    );
    expect(plan.digest).toBe(approvalDigest({ ...form(), from: "me@example.com" }));
  });

  it("sends nothing", async () => {
    const calls = record();
    const draft = draftFixture({ headers: [{ name: "To", value: "someone@example.com" }] });
    await planGmailSend({ account: "me@example.com", api: fakeApi({ calls, draft }), draftId: "d-1" });
    expect(calls.sendDraft).toEqual([]);
  });

  it("propagates the seam's typed failure when the draft cannot be read", async () => {
    const calls = record();
    const failure = unwrapErr(
      await planGmailSend({ account: "me@example.com", api: fakeApi({ calls }), draftId: "d-1" }),
    );
    expect(failure.code).toBe("API_FAILED");
  });

  it("refuses a draft holding no addressable message rather than sending an empty one", async () => {
    const calls = record();
    const draft: GmailDraft = { id: "d-1", message: {} };
    const failure = unwrapErr(
      await planGmailSend({ account: "me@example.com", api: fakeApi({ calls, draft }), draftId: "d-1" }),
    );
    expect(failure.code).toBe("INVALID_ADDRESS");
  });
});
