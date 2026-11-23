/*
 * `applyGmailSend` — sending the planned draft, reporting the sent message and its labels, and never claiming a
 * delivery or a send that did not happen. It moved here when `outbox.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { GmailApi } from "../../../../../live/gmail/api.js";
import { applyGmailSend, planGmailSend } from "../../../../../live/gmail/outbox.js";
import { draftFixture, fakeApi, record } from "./harness.js";

describe("applyGmailSend", () => {
  it("sends the planned draft and reports the sent message", async () => {
    const calls = record();
    const draft = draftFixture({ headers: [{ name: "To", value: "someone@example.com" }] });
    const api = fakeApi({ calls, draft });
    const plan = unwrap(await planGmailSend({ account: "me@example.com", api, draftId: "d-1" }));
    const outcome = unwrap(await applyGmailSend({ api, plan }));
    expect(outcome.messageId).toBe("m-sent");
    expect(outcome.labelIds).toStrictEqual(["SENT"]);
    expect(calls.sendDraft).toEqual(["d-1"]);
  });

  it("reports a sent message Gmail returned with no `labelIds` as carrying no label", async () => {
    const calls = record();
    const draft = draftFixture({ headers: [{ name: "To", value: "someone@example.com" }] });
    const api = fakeApi({ calls, draft });
    const unlabelled: GmailApi = { ...api, sendDraft: async () => ok({ id: "m-sent", threadId: "t-1" }) };
    const plan = unwrap(await planGmailSend({ account: "me@example.com", api, draftId: "d-1" }));
    const outcome = unwrap(await applyGmailSend({ api: unlabelled, plan }));
    expect(outcome.labelIds).toStrictEqual([]);
  });

  it("says delivery is the receiving server's to confirm, rather than claiming the mail arrived", async () => {
    const calls = record();
    const draft = draftFixture({ headers: [{ name: "To", value: "someone@example.com" }] });
    const api = fakeApi({ calls, draft });
    const plan = unwrap(await planGmailSend({ account: "me@example.com", api, draftId: "d-1" }));
    const outcome = unwrap(await applyGmailSend({ api, plan }));
    expect(outcome.residue).toContain(
      "delivery is the receiving server's to confirm — an accepted send is not a delivered mail",
    );
  });

  it("propagates the seam's typed failure rather than reporting a send that did not happen", async () => {
    const calls = record();
    const draft = draftFixture({ headers: [{ name: "To", value: "someone@example.com" }] });
    const api = fakeApi({ calls, draft, sendFails: true });
    const plan = unwrap(await planGmailSend({ account: "me@example.com", api, draftId: "d-1" }));
    expect(unwrapErr(await applyGmailSend({ api, plan })).message).toBe("the send was refused");
  });
});
