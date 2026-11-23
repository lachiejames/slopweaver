import { describe, expect, it } from "vitest";

import type {
  GmailDraftOutcome,
  GmailDraftPlan,
  GmailSendOutcome,
  GmailSendPlan,
} from "../../../../live/gmail/outbox.js";
import {
  renderGmailDraftOutcomeText,
  renderGmailDraftPlanText,
  renderGmailSendOutcomeText,
  renderGmailSendPlanText,
} from "../../../../live/gmail/renderOutbox.js";

/** A draft plan with every recipient field populated and a reply context. */
function fullDraftPlan(): GmailDraftPlan {
  return {
    account: "owner@example.com",
    form: {
      bcc: ["audit@example.com"],
      body: "Hello there.",
      cc: ["carol@example.com", "dave@example.com"],
      subject: "",
      to: ["alice@example.com", "bob@example.com"],
    },
    from: "Owner <owner@example.com>",
    message: "unused-rfc5322",
    raw: "unused-raw",
    reply: { inReplyTo: "<parent@mail.example.com>", references: ["<parent@mail.example.com>"], threadId: "t-1" },
  };
}

/** A draft plan with only a `To` row, a subject, and no reply context. */
function minimalDraftPlan(): GmailDraftPlan {
  return {
    account: "owner@example.com",
    form: { bcc: [], body: "Short body.", cc: [], subject: "Quarterly numbers", to: ["alice@example.com"] },
    from: "owner@example.com",
    message: "unused-rfc5322",
    raw: "unused-raw",
    reply: undefined,
  };
}

/** A send plan whose fields can be overridden per case. */
function sendPlan({ over = {} }: { over?: Partial<GmailSendPlan> } = {}): GmailSendPlan {
  return {
    account: "owner@example.com",
    bcc: ["audit@example.com"],
    body: "The body.",
    cc: ["carol@example.com"],
    digest: "0123456789abcdef",
    draftId: "r-42",
    from: "owner@example.com",
    residue: ["the draft stays in Drafts until sent"],
    subject: "Hello",
    threadId: "t-9",
    to: ["alice@example.com"],
    ...over,
  };
}

describe("renderGmailDraftPlanText", () => {
  it("renders To, Cc and Bcc on separate rows, the reply id, an empty subject stand-in and the dry-run warning", () => {
    expect(renderGmailDraftPlanText({ plan: fullDraftPlan() })).toBe(
      [
        "would draft as Owner <owner@example.com>",
        "to: alice@example.com, bob@example.com",
        "cc: carol@example.com, dave@example.com",
        "bcc: audit@example.com",
        "subject: (no subject)",
        "in reply to: <parent@mail.example.com>",
        "",
        "Hello there.",
        "",
        "DRY RUN — nothing was stored and nothing was sent.",
        "",
      ].join("\n"),
    );
  });

  it("omits empty Cc and Bcc rows and the reply row, and prints a non-empty subject verbatim", () => {
    expect(renderGmailDraftPlanText({ plan: minimalDraftPlan() })).toBe(
      [
        "would draft as owner@example.com",
        "to: alice@example.com",
        "subject: Quarterly numbers",
        "",
        "Short body.",
        "",
        "DRY RUN — nothing was stored and nothing was sent.",
        "",
      ].join("\n"),
    );
  });

  it("bounds the body preview at 400 characters with a visible cut marker", () => {
    const plan: GmailDraftPlan = { ...minimalDraftPlan(), form: { ...minimalDraftPlan().form, body: "x".repeat(401) } };
    expect(renderGmailDraftPlanText({ plan })).toBe(
      [
        "would draft as owner@example.com",
        "to: alice@example.com",
        "subject: Quarterly numbers",
        "",
        `${"x".repeat(400)}\n… (1 more characters, not shown)`,
        "",
        "DRY RUN — nothing was stored and nothing was sent.",
        "",
      ].join("\n"),
    );
  });
});

describe("renderGmailDraftOutcomeText", () => {
  it("renders the draft id, account, thread and every residue line", () => {
    const outcome: GmailDraftOutcome = {
      draftId: "r-7",
      plan: fullDraftPlan(),
      residue: ["stored in Drafts", "nothing was sent"],
      threadId: "t-1",
    };
    expect(renderGmailDraftOutcomeText({ outcome })).toBe(
      [
        "drafted: r-7  (owner@example.com)",
        "thread: t-1",
        "residue:",
        "  - stored in Drafts",
        "  - nothing was sent",
        "",
      ].join("\n"),
    );
  });

  it("omits the thread row when the stored draft has no thread id", () => {
    const outcome: GmailDraftOutcome = {
      draftId: "r-8",
      plan: minimalDraftPlan(),
      residue: ["stored in Drafts"],
      threadId: undefined,
    };
    expect(renderGmailDraftOutcomeText({ outcome })).toBe(
      ["drafted: r-8  (owner@example.com)", "residue:", "  - stored in Drafts", ""].join("\n"),
    );
  });
});

describe("renderGmailSendPlanText", () => {
  it("renders the envelope, body, residue and the exact digest-bearing approval command", () => {
    expect(renderGmailSendPlanText({ plan: sendPlan() })).toBe(
      [
        "would send draft r-42  (owner@example.com)",
        "from: owner@example.com",
        "to: alice@example.com",
        "cc: carol@example.com",
        "bcc: audit@example.com",
        "subject: Hello",
        "",
        "The body.",
        "",
        "residue:",
        "  - the draft stays in Drafts until sent",
        "",
        "NOTHING HAS BEEN SENT. To send exactly this:",
        "  slopweaver gmail send r-42 --approve 0123456789abcdef",
        "",
      ].join("\n"),
    );
  });

  it("names a missing Subject header as '(no subject header)'", () => {
    const text = renderGmailSendPlanText({ plan: sendPlan({ over: { bcc: [], cc: [], subject: undefined } }) });
    expect(text).toBe(
      [
        "would send draft r-42  (owner@example.com)",
        "from: owner@example.com",
        "to: alice@example.com",
        "subject: (no subject header)",
        "",
        "The body.",
        "",
        "residue:",
        "  - the draft stays in Drafts until sent",
        "",
        "NOTHING HAS BEEN SENT. To send exactly this:",
        "  slopweaver gmail send r-42 --approve 0123456789abcdef",
        "",
      ].join("\n"),
    );
  });

  it("names an empty subject as '(empty subject)', distinct from a missing header", () => {
    const text = renderGmailSendPlanText({ plan: sendPlan({ over: { bcc: [], cc: [], subject: "" } }) });
    expect(text).toBe(
      [
        "would send draft r-42  (owner@example.com)",
        "from: owner@example.com",
        "to: alice@example.com",
        "subject: (empty subject)",
        "",
        "The body.",
        "",
        "residue:",
        "  - the draft stays in Drafts until sent",
        "",
        "NOTHING HAS BEEN SENT. To send exactly this:",
        "  slopweaver gmail send r-42 --approve 0123456789abcdef",
        "",
      ].join("\n"),
    );
  });

  it("omits the Cc and Bcc rows when both are empty", () => {
    const text = renderGmailSendPlanText({ plan: sendPlan({ over: { bcc: [], cc: [], residue: [] } }) });
    expect(text).toBe(
      [
        "would send draft r-42  (owner@example.com)",
        "from: owner@example.com",
        "to: alice@example.com",
        "subject: Hello",
        "",
        "The body.",
        "",
        "residue:",
        "",
        "NOTHING HAS BEEN SENT. To send exactly this:",
        "  slopweaver gmail send r-42 --approve 0123456789abcdef",
        "",
      ].join("\n"),
    );
  });
});

describe("renderGmailSendOutcomeText", () => {
  it("renders the message id, envelope, thread and residue", () => {
    const outcome: GmailSendOutcome = {
      labelIds: ["SENT"],
      messageId: "m-100",
      plan: sendPlan(),
      residue: ["delivered to 3 recipients", "the draft is gone"],
      threadId: "t-9",
    };
    expect(renderGmailSendOutcomeText({ outcome })).toBe(
      [
        "SENT: m-100  (owner@example.com)",
        "from: owner@example.com",
        "to: alice@example.com",
        "cc: carol@example.com",
        "bcc: audit@example.com",
        "subject: Hello",
        "thread: t-9",
        "residue:",
        "  - delivered to 3 recipients",
        "  - the draft is gone",
        "",
      ].join("\n"),
    );
  });
});
