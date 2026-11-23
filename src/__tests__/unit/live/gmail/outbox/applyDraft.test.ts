/*
 * `applyGmailDraft` — storing the planned message as a draft in the right thread, refusing a plan whose body or
 * raw message is not what its form builds, and the residue that says nothing was sent. It moved here when
 * `outbox.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildMimeMessage, toRawBase64Url } from "../../../../../live/gmail/compose.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import { applyGmailDraft, planGmailDraft } from "../../../../../live/gmail/outbox.js";
import type { GmailMessage } from "../../../../../live/gmail/parse.js";
import { fakeApi, form, record } from "./harness.js";

describe("applyGmailDraft", () => {
  it("stores the encoded message and reports the draft id", async () => {
    const calls = record();
    const api = fakeApi({ calls });
    const plan = unwrap(await planGmailDraft({ account: "me@example.com", api, form: form() }));
    const outcome = unwrap(await applyGmailDraft({ api, plan }));
    expect(outcome.draftId).toBe("d-created");
    expect(calls.createDraft.length).toBe(1);
  });

  it("passes the thread id through on a reply, so the draft lands in the conversation", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: { headers: [{ name: "Message-ID", value: "<p@e.com>" }] },
      threadId: "t-9",
    };
    const api = fakeApi({ calls, parent });
    const plan = unwrap(
      await planGmailDraft({ account: "me@example.com", api, form: form({ subject: "" }), replyToId: "p-1" }),
    );
    await applyGmailDraft({ api, plan });
    expect(calls.createDraft[0]!.threadId).toBe("t-9");
  });

  it("refuses a reply Gmail filed in another thread, naming the draft that now exists", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: { headers: [{ name: "Message-ID", value: "<p@e.com>" }] },
      threadId: "t-9",
    };
    const api = fakeApi({ calls, parent, storesInThread: "t-new" });
    const plan = unwrap(
      await planGmailDraft({ account: "me@example.com", api, form: form({ subject: "" }), replyToId: "p-1" }),
    );
    const failure = unwrapErr(await applyGmailDraft({ api, plan }));
    expect(failure).toEqual(GmailErrors.replyDetached({ draftId: "d-created", expected: "t-9", threadId: "t-new" }));
    expect(failure.message).toContain("delete that draft in Gmail before drafting again");
  });

  it("asks for one attempt only when told to, and leaves the retrying default alone otherwise", async () => {
    const calls = record();
    const api = fakeApi({ calls });
    const plan = unwrap(await planGmailDraft({ account: "me@example.com", api, form: form() }));
    await applyGmailDraft({ api, once: true, plan });
    await applyGmailDraft({ api, plan });
    expect(calls.createDraft.map((call) => call.once)).toEqual([true, false]);
  });

  it("stores a reply whose inherited subject the form's own rules would refuse, judging only the body", async () => {
    const calls = record();
    const parent: GmailMessage = {
      id: "p-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<p@e.com>" },
          { name: "Subject", value: "first\nsecond" },
        ],
      },
      threadId: "t-9",
    };
    const api = fakeApi({ calls, parent });
    const plan = unwrap(
      await planGmailDraft({ account: "me@example.com", api, form: form({ subject: "" }), replyToId: "p-1" }),
    );
    expect(plan.form.subject).toBe("Re: first\nsecond");
    expect(unwrap(await applyGmailDraft({ api, plan })).draftId).toBe("d-created");
  });

  it("refuses a hand-built plan whose body is hard-wrapped, storing nothing", async () => {
    const calls = record();
    const wrapped = form({ body: "one\nwrapped" });
    const message = buildMimeMessage({ form: wrapped, from: "me@example.com" });
    const plan = {
      account: "me@example.com",
      form: wrapped,
      from: "me@example.com",
      message,
      raw: toRawBase64Url({ message }),
      reply: undefined,
    };
    const refused = unwrapErr(await applyGmailDraft({ api: fakeApi({ calls }), plan }));
    expect(refused.message).toContain('body: 1 hard line break inside a paragraph (line 2; first "wrapped")');
    expect(calls.createDraft).toEqual([]);
  });

  it("refuses a plan whose raw message is not the one its form builds, storing nothing", async () => {
    const calls = record();
    const api = fakeApi({ calls });
    const plan = unwrap(await planGmailDraft({ account: "me@example.com", api, form: form() }));
    const swapped = toRawBase64Url({
      message: buildMimeMessage({ form: form({ body: "a\nb" }), from: "me@example.com" }),
    });
    expect(unwrapErr(await applyGmailDraft({ api, plan: { ...plan, raw: swapped } })).message).toBe(
      "the compose form was refused:\n  - raw: the plan's message is not the one its form builds",
    );
    expect(calls.createDraft).toEqual([]);
  });

  it("says in its residue that nothing was sent, because that is the question a reader has", async () => {
    const calls = record();
    const api = fakeApi({ calls });
    const plan = unwrap(await planGmailDraft({ account: "me@example.com", api, form: form() }));
    const outcome = unwrap(await applyGmailDraft({ api, plan }));
    expect(outcome.residue).toContain("nothing has been sent — this is a draft in your own mailbox");
  });

  it("leads its hand-off with pressing Send in Gmail, the flow the owner asked for", async () => {
    const calls = record();
    const api = fakeApi({ calls });
    const plan = unwrap(await planGmailDraft({ account: "me@example.com", api, form: form() }));
    const outcome = unwrap(await applyGmailDraft({ api, plan }));
    expect(outcome.residue).toEqual([
      "nothing has been sent — this is a draft in your own mailbox",
      "it is ready in Gmail with its recipients and body: review or edit it there and press Send",
      "or send it through the door with: slopweaver gmail send d-created",
    ]);
  });
});
