/**
 * Outlook drafts: the shared compose form becoming Graph fields, storing a new draft and a reply over the fake
 * mailbox, and a send planned from the draft as the mailbox holds it, whose digest moves with the content.
 */
import { describe, expect, it } from "vitest";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  draftPayload,
  planOutlookSend,
  readOutlookSendPlan,
  storeOutlookDraft,
  toWireRecipient,
} from "../../../../live/outlook/drafts.js";
import { toMessage } from "../../../../live/outlook/messages.js";
import { FAKE_OUTLOOK_ACCOUNT, fakeMailbox, fakeOutlookApi, wireMessage } from "../../../fakeOutlookMailbox.js";

const FORM = {
  bcc: [],
  body: "Synthetic body line.",
  cc: [],
  subject: "Synthetic draft subject",
  to: ["Pat Example <pat@example.test>"],
};

/** A wire draft with recipients, read through the door's own mapper. */
function draftMessage({ id, over = {} }: { id: string; over?: Parameters<typeof wireMessage>[0]["over"] }) {
  return unwrap(
    toMessage({
      message: wireMessage({
        id,
        over: {
          isDraft: true,
          toRecipients: [{ emailAddress: { address: "pat@example.test", name: "Pat Example" } }],
          ...over,
        },
      }),
      operation: "test.op",
    }),
  );
}

describe("toWireRecipient", () => {
  it("takes a bare address as itself", () => {
    expect(toWireRecipient({ entry: "pat@example.test" })).toEqual({ emailAddress: { address: "pat@example.test" } });
  });

  it("splits Name <addr> into its halves", () => {
    expect(toWireRecipient({ entry: "Pat Example <pat@example.test>" })).toEqual({
      emailAddress: { address: "pat@example.test", name: "Pat Example" },
    });
  });

  it("unquotes a quoted display name, keeping its comma", () => {
    expect(toWireRecipient({ entry: '"Example, Pat" <pat@example.test>' })).toEqual({
      emailAddress: { address: "pat@example.test", name: "Example, Pat" },
    });
  });

  it("drops an empty name", () => {
    expect(toWireRecipient({ entry: "<pat@example.test>" })).toEqual({ emailAddress: { address: "pat@example.test" } });
  });

  it("trims surrounding whitespace", () => {
    expect(toWireRecipient({ entry: "  pat@example.test  " })).toEqual({
      emailAddress: { address: "pat@example.test" },
    });
  });
});

describe("draftPayload", () => {
  it("builds the Graph fields from a valid form", () => {
    const payload = unwrap(draftPayload({ form: { ...FORM, cc: ["cc@example.test"], bcc: ["bcc@example.test"] } }));

    expect(payload).toEqual({
      bccRecipients: [{ emailAddress: { address: "bcc@example.test" } }],
      body: { content: "Synthetic body line.", contentType: "text" },
      ccRecipients: [{ emailAddress: { address: "cc@example.test" } }],
      subject: "Synthetic draft subject",
      toRecipients: [{ emailAddress: { address: "pat@example.test", name: "Pat Example" } }],
    });
  });

  it("refuses a form with no recipient, listing the problem", () => {
    const refused = draftPayload({ form: { ...FORM, to: [] } });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
    expect(unwrapErr(refused).message).toContain("to: at least one recipient is required");
  });

  it("refuses every problem at once, not only the first", () => {
    const refused = draftPayload({ form: { ...FORM, body: "", subject: "two\nlines", to: ["not-an-address"] } });

    expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
    expect(unwrapErr(refused).message).toContain("subject: must not contain a line break");
    expect(unwrapErr(refused).message).toContain("body: must not be empty");
    expect(unwrapErr(refused).message).toContain("to:");
  });
});

describe("storeOutlookDraft", () => {
  it("stores a new draft with one create write", async () => {
    const mailbox = fakeMailbox();
    const payload = unwrap(draftPayload({ form: FORM }));

    const outcome = unwrap(await storeOutlookDraft({ api: fakeOutlookApi({ mailbox }), payload, replyTo: undefined }));

    expect(outcome).toEqual({ conversationId: "conv-draft-1", draftId: "draft-1", isReply: false });
    expect(mailbox.writes).toEqual(["draft draft-1"]);
    expect(mailbox.messages.get("draft-1")!.subject).toBe("Synthetic draft subject");
  });

  it("stores a reply as a create followed by a patch of the form's fields", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "parent" })] });
    const payload = unwrap(draftPayload({ form: FORM }));

    const outcome = unwrap(await storeOutlookDraft({ api: fakeOutlookApi({ mailbox }), payload, replyTo: "parent" }));

    expect(outcome).toEqual({ conversationId: "conv-1", draftId: "reply-1", isReply: true });
    expect(mailbox.writes).toEqual(["reply reply-1 to parent", "patch-draft reply-1"]);
    expect(mailbox.messages.get("reply-1")!.body).toEqual({ content: "Synthetic body line.", contentType: "text" });
  });

  it("names a stored draft whose answer carries no conversation, so it is never drafted twice", async () => {
    const mailbox = fakeMailbox();
    const api = {
      ...fakeOutlookApi({ mailbox }),
      createDraft: async () => ok(wireMessage({ id: "draft-9", over: { conversationId: null, isDraft: true } })),
    };

    const refused = await storeOutlookDraft({ api, payload: unwrap(draftPayload({ form: FORM })), replyTo: undefined });

    expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
    expect(unwrapErr(refused).message).toBe(
      "Outlook stored draft draft-9 but its answer named no conversation; " +
        "it is in Drafts, so edit or send that one rather than drafting again",
    );
  });

  it("reports a stored draft whose answer omits fields it does not need", async () => {
    const mailbox = fakeMailbox();
    const api = {
      ...fakeOutlookApi({ mailbox }),
      createDraft: async () => ok({ conversationId: "conv-sparse", id: "draft-sparse" }),
    };

    const outcome = unwrap(
      await storeOutlookDraft({ api, payload: unwrap(draftPayload({ form: FORM })), replyTo: undefined }),
    );

    expect(outcome).toEqual({ conversationId: "conv-sparse", draftId: "draft-sparse", isReply: false });
  });

  it("refuses a reply to a message that does not exist and writes nothing", async () => {
    const mailbox = fakeMailbox();
    const payload = unwrap(draftPayload({ form: FORM }));

    const refused = await storeOutlookDraft({ api: fakeOutlookApi({ mailbox }), payload, replyTo: "absent" });

    expect(unwrapErr(refused).code).toBe("API_FAILED");
    expect(mailbox.writes).toEqual([]);
  });
});

describe("planOutlookSend", () => {
  it("plans a send from a draft, naming the draft's own sender and formatting each recipient", () => {
    const plan = unwrap(
      planOutlookSend({
        account: FAKE_OUTLOOK_ACCOUNT,
        changeKey: "ck-1",
        draft: draftMessage({ id: "d1", over: { subject: "Hello" } }),
      }),
    );

    expect(plan.draftId).toBe("d1");
    expect(plan.from).toBe("Sender One <sender@example.test>");
    expect(plan.to).toEqual(["Pat Example <pat@example.test>"]);
    expect(plan.cc).toEqual([]);
    expect(plan.subject).toBe("Hello");
    expect(plan.body).toBe("synthetic body of d1");
  });

  it("names the bound mailbox only when the draft carries no sender", () => {
    const plan = unwrap(
      planOutlookSend({
        account: FAKE_OUTLOOK_ACCOUNT,
        changeKey: "ck-1",
        draft: draftMessage({ id: "d1", over: { from: null } }),
      }),
    );

    expect(plan.from).toBe(FAKE_OUTLOOK_ACCOUNT);
  });

  it.each(["", "   ", "​", "owner"])(
    "refuses a draft with no sender when the bound mailbox's address %j is unusable",
    (account) => {
      const refused = planOutlookSend({
        account,
        changeKey: "ck-1",
        draft: draftMessage({ id: "d1", over: { from: null } }),
      });

      expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
      expect(unwrapErr(refused).message).toContain(
        "draft d1 names no sender and the connected mailbox has no usable address",
      );
    },
  );

  it("previews and digests an alias the draft names, not the bound mailbox", () => {
    const asAlias = unwrap(
      planOutlookSend({
        account: FAKE_OUTLOOK_ACCOUNT,
        changeKey: "ck-1",
        draft: draftMessage({ id: "d1", over: { from: { emailAddress: { address: "alias@example.test" } } } }),
      }),
    );
    const asMailbox = unwrap(
      planOutlookSend({
        account: FAKE_OUTLOOK_ACCOUNT,
        changeKey: "ck-1",
        draft: draftMessage({ id: "d1", over: { from: { emailAddress: { address: FAKE_OUTLOOK_ACCOUNT } } } }),
      }),
    );

    expect(asAlias.from).toBe("alias@example.test");
    expect(asAlias.digest).not.toBe(asMailbox.digest);
  });

  it("refuses a sender Graph names with no address", () => {
    const refused = planOutlookSend({
      account: FAKE_OUTLOOK_ACCOUNT,
      changeKey: "ck-1",
      draft: draftMessage({ id: "d1", over: { from: { emailAddress: { name: "Nameless" } } } }),
    });

    expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
    expect(unwrapErr(refused).message).toBe(
      "draft d1 names a sender with no usable address, so who it would be sent as cannot be shown",
    );
  });

  it.each(["", "   ", "​", "nameless"])(
    "refuses a sender Graph names with the unusable address %j, never previewing `Nameless <>`",
    (address) => {
      const refused = planOutlookSend({
        account: FAKE_OUTLOOK_ACCOUNT,
        changeKey: "ck-1",
        draft: draftMessage({ id: "d1", over: { from: { emailAddress: { address, name: "Nameless" } } } }),
      });

      expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
      expect(unwrapErr(refused).message).toBe(
        "draft d1 names a sender with no usable address, so who it would be sent as cannot be shown",
      );
    },
  );

  it.each<[string, Parameters<typeof wireMessage>[0]["over"]]>([
    ["to", { toRecipients: [{ emailAddress: { name: "Nameless" } }] }],
    ["cc", { ccRecipients: [{ emailAddress: { address: "", name: "Blank" } }] }],
    ["bcc", { bccRecipients: [{ emailAddress: { address: "​" } }] }],
  ])("refuses a %s recipient with no usable address, never approving `(no address)`", (_field, over) => {
    const refused = planOutlookSend({
      account: FAKE_OUTLOOK_ACCOUNT,
      changeKey: "ck-1",
      draft: draftMessage({ id: "d1", over }),
    });

    expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
    expect(unwrapErr(refused).message).toBe(
      "draft d1 names a recipient with no usable address, so who it would reach cannot be shown",
    );
  });

  it("changes the digest when Graph's version stamp moves, the content shown unchanged", () => {
    const before = unwrap(
      planOutlookSend({ account: FAKE_OUTLOOK_ACCOUNT, changeKey: "ck-1", draft: draftMessage({ id: "d1" }) }),
    );
    const after = unwrap(
      planOutlookSend({ account: FAKE_OUTLOOK_ACCOUNT, changeKey: "ck-2", draft: draftMessage({ id: "d1" }) }),
    );

    expect(after.body).toBe(before.body);
    expect(after.digest).not.toBe(before.digest);
  });

  it("refuses a message that is not a draft", () => {
    const refused = planOutlookSend({
      account: FAKE_OUTLOOK_ACCOUNT,
      changeKey: "ck-1",
      draft: draftMessage({ id: "m1", over: { isDraft: false } }),
    });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
    expect(unwrapErr(refused).message).toContain("m1 is not a draft");
  });

  it("refuses a draft with no recipients", () => {
    const refused = planOutlookSend({
      account: FAKE_OUTLOOK_ACCOUNT,
      changeKey: "ck-1",
      draft: draftMessage({ id: "d1", over: { toRecipients: [] } }),
    });

    expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
    expect(unwrapErr(refused).message).toContain("draft d1 has no recipients");
  });

  it("gives the same digest for the same content", () => {
    const first = unwrap(
      planOutlookSend({ account: FAKE_OUTLOOK_ACCOUNT, changeKey: "ck-1", draft: draftMessage({ id: "d1" }) }),
    );
    const second = unwrap(
      planOutlookSend({ account: FAKE_OUTLOOK_ACCOUNT, changeKey: "ck-1", draft: draftMessage({ id: "d1" }) }),
    );

    expect(second.digest).toBe(first.digest);
  });

  it("changes the digest when the body changes", () => {
    const before = unwrap(
      planOutlookSend({ account: FAKE_OUTLOOK_ACCOUNT, changeKey: "ck-1", draft: draftMessage({ id: "d1" }) }),
    );
    const edited = draftMessage({
      id: "d1",
      over: { body: { content: "an edited synthetic body", contentType: "text" } },
    });
    const after = unwrap(planOutlookSend({ account: FAKE_OUTLOOK_ACCOUNT, changeKey: "ck-1", draft: edited }));

    expect(after.digest).not.toBe(before.digest);
  });

  it("changes the digest when a recipient changes", () => {
    const before = unwrap(
      planOutlookSend({ account: FAKE_OUTLOOK_ACCOUNT, changeKey: "ck-1", draft: draftMessage({ id: "d1" }) }),
    );
    const otherRecipient = unwrap(
      planOutlookSend({
        account: FAKE_OUTLOOK_ACCOUNT,
        changeKey: "ck-1",
        draft: draftMessage({
          id: "d1",
          over: { toRecipients: [{ emailAddress: { address: "someone-else@example.test" } }] },
        }),
      }),
    );

    expect(otherRecipient.digest).not.toBe(before.digest);
  });
});

describe("readOutlookSendPlan", () => {
  it("reads the draft back and plans from what the mailbox holds now", async () => {
    const mailbox = fakeMailbox();
    const payload = unwrap(draftPayload({ form: FORM }));
    const api = fakeOutlookApi({ mailbox });
    const stored = unwrap(await storeOutlookDraft({ api, payload, replyTo: undefined }));

    const first = unwrap(await readOutlookSendPlan({ api, account: FAKE_OUTLOOK_ACCOUNT, id: stored.draftId }));
    await api.patchDraft({
      id: stored.draftId,
      payload: { body: { content: "edited in Outlook", contentType: "text" } },
    });
    const second = unwrap(await readOutlookSendPlan({ api, account: FAKE_OUTLOOK_ACCOUNT, id: stored.draftId }));

    expect(first.body).toBe("Synthetic body line.");
    expect(second.body).toBe("edited in Outlook");
    expect(second.digest).not.toBe(first.digest);
  });

  it("voids an approval when the draft changes in a way its text cannot show", async () => {
    const mailbox = fakeMailbox();
    const api = fakeOutlookApi({ mailbox });
    const stored = unwrap(
      await storeOutlookDraft({ api, payload: unwrap(draftPayload({ form: FORM })), replyTo: undefined }),
    );

    const first = unwrap(await readOutlookSendPlan({ api, account: FAKE_OUTLOOK_ACCOUNT, id: stored.draftId }));
    await api.patchMessage({ id: stored.draftId, patch: { categories: ["Waiting on"] } });
    const second = unwrap(await readOutlookSendPlan({ api, account: FAKE_OUTLOOK_ACCOUNT, id: stored.draftId }));

    expect(second.body).toBe(first.body);
    expect(second.to).toEqual(first.to);
    expect(second.digest).not.toBe(first.digest);
  });

  it.each([null, "", "  ", "​", "=+/"])(
    "refuses a draft Graph answered with no version stamp (%j), sending nothing",
    async (changeKey) => {
      const mailbox = fakeMailbox({
        messages: [wireMessage({ id: "d1", over: { changeKey, isDraft: true } })],
      });

      const refused = await readOutlookSendPlan({
        api: fakeOutlookApi({ mailbox }),
        account: FAKE_OUTLOOK_ACCOUNT,
        id: "d1",
      });

      expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
      expect(unwrapErr(refused).message).toContain("`changeKey`");
      expect(mailbox.writes).toEqual([]);
    },
  );

  it("refuses an id that is not a draft", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "received" })] });

    const refused = await readOutlookSendPlan({
      api: fakeOutlookApi({ mailbox }),
      account: FAKE_OUTLOOK_ACCOUNT,
      id: "received",
    });

    expect(unwrapErr(refused).code).toBe("DRAFT_REFUSED");
  });

  it("passes a missing draft through", async () => {
    const refused = await readOutlookSendPlan({
      api: fakeOutlookApi({ mailbox: fakeMailbox() }),
      account: FAKE_OUTLOOK_ACCOUNT,
      id: "absent",
    });

    expect(unwrapErr(refused).code).toBe("API_FAILED");
  });
});
