/**
 * `draftReceipts.ts` — a card that makes a claim brings a link or a file, or says why none is needed, or says what
 * it tried. The payloads below are cards the owner named, copied from the register.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { DraftReceiptsErrors } from "../../../../outbound/slack/draftReceiptErrors.js";
import {
  receiptLinks,
  receiptsDeclarationOf,
  receiptsOfRecording,
  receiptsValid,
} from "../../../../outbound/slack/draftReceipts.js";
import { receiptsLine } from "../../../../outbound/slack/receiptsLine.js";

/** sd-4a11e00c, a bot post making an unbacked claim: "where's the receipt? No link, no screenshot". */
const MFA_PAYLOAD = {
  blocks: [
    {
      elements: [
        {
          elements: [
            {
              text: "A stand-in claim about one account, Noel Chang's, carrying nothing that backs it.",
              type: "text",
            },
            { text: "\n\n", type: "text" },
          ],
          type: "rich_text_section",
        },
        {
          elements: [
            {
              text: "A second stand-in sentence, saying what would clear it.",
              type: "text",
            },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    },
  ],
  metadata: {
    event_payload: {
      artifactFingerprint: "9c0683a327bcd5724fc9d282d66f7d7a",
      artifactKind: "no-fold",
      renderer: "slack-no-fold-v1",
      schemaVersion: 1,
    },
    event_type: "acme_bot_card_v1",
  },
  text: "A stand-in claim about one account, Noel Chang's, carrying nothing that backs it.",
  unfurl_links: false,
  unfurl_media: false,
};

/** sd-b9230a1c: the re-cut that said "got the receipts" while every claim sat on a local page. */
const NUDGE_PAYLOAD = {
  blocks: [
    {
      elements: [
        {
          elements: [
            {
              text: "yo, got the receipts on nudge. a stand-in claim about how widely it is deployed, every claim on a local page.",
              type: "text",
            },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: "yo, got the receipts on nudge. a stand-in claim about how widely it is deployed, every claim on a local page.",
};

const THREAD = "https://acme.slack.com/archives/C0SYN000002/p1790485901702259";

/** sd-d9fa519b, Claude's cut: "excellent, I'd send that as is". The link rides as an element AND in `text`. */
const MICHAEL_CLAUDE_PAYLOAD = {
  blocks: [
    {
      elements: [
        {
          elements: [
            { text: "this is where it started: ", type: "text" },
            { text: "agent CLI as an opt-in plugin, in #dev-team", type: "link", url: THREAD },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: `this is where it started: <${THREAD}|agent CLI as an opt-in plugin, in #dev-team>.`,
};

/** sd-d9fa519b, Codex's variant: "the Codex one is crap, no receipts". */
const MICHAEL_CODEX_PAYLOAD = {
  blocks: [
    {
      elements: [
        {
          elements: [
            { text: "yo ", type: "text" },
            { type: "user", user_id: "U0SYN000031" },
            {
              text: ", could you jump into the 27 Sep #dev-team discussion? I think the PR’s ready once there’s buy-in.",
              type: "text",
            },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: "yo <@U0SYN000031>, could you jump into the 27 Sep #dev-team discussion? I think the PR’s ready once there’s buy-in.",
};

const UNDECLARED = { kind: "undeclared" } as const;

describe("receiptLinks", () => {
  it("finds a rich-text link once though the fallback text carries it again", () => {
    expect(receiptLinks({ payload: MICHAEL_CLAUDE_PAYLOAD })).toEqual([THREAD]);
  });

  it("finds nothing in a message of prose and a mention", () => {
    expect(receiptLinks({ payload: MICHAEL_CODEX_PAYLOAD })).toEqual([]);
    expect(receiptLinks({ payload: MFA_PAYLOAD })).toEqual([]);
  });

  it("reads a <url|label> in mrkdwn text", () => {
    expect(receiptLinks({ payload: { text: "see <https://example.com/run|the run> and <@U1>" } })).toEqual([
      "https://example.com/run",
    ]);
  });
});

describe("receiptsDeclarationOf", () => {
  it("reads each flag, and neither as undeclared", () => {
    expect(unwrap(receiptsDeclarationOf({ selfEvident: "the link is the message", tried: undefined }))).toEqual({
      kind: "self-evident",
      why: "the link is the message",
    });
    expect(unwrap(receiptsDeclarationOf({ selfEvident: undefined, tried: "Vanta signed out" }))).toEqual({
      kind: "tried",
      tried: "Vanta signed out",
    });
    expect(unwrap(receiptsDeclarationOf({ selfEvident: undefined, tried: undefined }))).toEqual(UNDECLARED);
  });

  it("refuses both together, and either empty", () => {
    expect(unwrapErr(receiptsDeclarationOf({ selfEvident: "x", tried: "y" }))).toEqual([
      "--self-evident and --tried contradict each other: a card that needs no receipt tried for none",
    ]);
    expect(unwrapErr(receiptsDeclarationOf({ selfEvident: " ", tried: undefined }))[0]).toContain(
      "--self-evident needs the reason",
    );
    expect(unwrapErr(receiptsDeclarationOf({ selfEvident: undefined, tried: "" }))[0]).toContain(
      "--tried needs what was tried",
    );
  });
});

describe("receiptsOfRecording", () => {
  it("refuses the MFA claim and the nudge re-cut, which carried no link and no file", () => {
    for (const payload of [MFA_PAYLOAD, NUDGE_PAYLOAD]) {
      const refusal = unwrapErr(
        receiptsOfRecording({ bump: false, declared: UNDECLARED, media: 0, payload, sentBackFor: undefined }),
      );
      expect(refusal.code).toBe("RECEIPTS_MISSING");
      expect(refusal.lines[0]).toContain("this card carries no receipt");
      expect(refusal.lines[1]).toContain('--tried "<what and why it failed>"');
      expect(refusal.lines[2]).toContain("deliberately NO escape hatch");
    }
  });

  it("derives attached receipts from a link, with no flag typed", () => {
    expect(
      unwrap(
        receiptsOfRecording({
          bump: false,
          declared: UNDECLARED,
          media: 0,
          payload: MICHAEL_CLAUDE_PAYLOAD,
          sentBackFor: undefined,
        }),
      ),
    ).toEqual({ kind: "attached", links: [THREAD], media: 0 });
  });

  it("derives attached receipts from a file alone", () => {
    expect(
      unwrap(
        receiptsOfRecording({
          bump: false,
          declared: UNDECLARED,
          media: 3,
          payload: MFA_PAYLOAD,
          sentBackFor: undefined,
        }),
      ),
    ).toEqual({ kind: "attached", links: [], media: 3 });
  });

  it("parks a self-evident card and a card that says what it tried", () => {
    expect(
      unwrap(
        receiptsOfRecording({
          bump: false,
          declared: { kind: "self-evident", why: "an invite into a thread the owner asked to share" },
          media: 0,
          payload: MICHAEL_CODEX_PAYLOAD,
          sentBackFor: undefined,
        }),
      ),
    ).toEqual({ kind: "self-evident", why: "an invite into a thread the owner asked to share" });
    expect(
      unwrap(
        receiptsOfRecording({
          bump: false,
          declared: { kind: "tried", tried: "Vanta's test page needs a sign-in the fleet does not hold" },
          media: 0,
          payload: MFA_PAYLOAD,
          sentBackFor: undefined,
        }),
      ),
    ).toEqual({ kind: "tried", tried: "Vanta's test page needs a sign-in the fleet does not hold" });
  });

  it("keeps what was tried beside the receipts a card does carry", () => {
    expect(
      unwrap(
        receiptsOfRecording({
          bump: false,
          declared: { kind: "tried", tried: "no screenshot: the console was signed out" },
          media: 0,
          payload: MICHAEL_CLAUDE_PAYLOAD,
          sentBackFor: undefined,
        }),
      ),
    ).toEqual({ kind: "attached", links: [THREAD], media: 0, tried: "no screenshot: the console was signed out" });
  });

  it("refuses --self-evident on a card that already brings receipts", () => {
    const refusal = unwrapErr(
      receiptsOfRecording({
        bump: false,
        declared: { kind: "self-evident", why: "obvious" },
        media: 1,
        payload: MICHAEL_CLAUDE_PAYLOAD,
        sentBackFor: undefined,
      }),
    );
    expect(refusal).toEqual(DraftReceiptsErrors.selfEvidentWithReceipts({ links: 1, media: 1 }));
    expect(refusal.message).toContain("it already brings its receipts");
  });

  it("refuses the nudge re-cut calling itself self-evident after the owner sent it back for receipts", () => {
    const refusal = unwrapErr(
      receiptsOfRecording({
        bump: false,
        declared: { kind: "self-evident", why: "every claim is on page:nudge-dm-proof" },
        media: 0,
        payload: NUDGE_PAYLOAD,
        sentBackFor: "sd-aca21d36",
      }),
    );
    expect(refusal.code).toBe("SELF_EVIDENT_SENT_BACK");
    expect(refusal.lines).toEqual([refusal.message, DraftReceiptsErrors.missing().lines[2]]);
    expect(refusal.message).toContain("this re-cuts sd-aca21d36, which the owner sent back for its receipts");
  });

  it("parks that re-cut once it says what it tried, or carries a file", () => {
    expect(
      unwrap(
        receiptsOfRecording({
          bump: false,
          declared: { kind: "tried", tried: "JumpCloud's policy page would not load signed out" },
          media: 0,
          payload: NUDGE_PAYLOAD,
          sentBackFor: "sd-aca21d36",
        }),
      ),
    ).toEqual({ kind: "tried", tried: "JumpCloud's policy page would not load signed out" });
    expect(
      unwrap(
        receiptsOfRecording({
          bump: false,
          declared: UNDECLARED,
          media: 1,
          payload: NUDGE_PAYLOAD,
          sentBackFor: "sd-aca21d36",
        }),
      ),
    ).toEqual({ kind: "attached", links: [], media: 1 });
  });

  it("owes nothing on a bump that brought and declared nothing", () => {
    expect(
      unwrap(
        receiptsOfRecording({
          bump: true,
          declared: UNDECLARED,
          media: 0,
          payload: MFA_PAYLOAD,
          sentBackFor: undefined,
        }),
      ),
    ).toBe(undefined);
  });
});

describe("receiptsValid", () => {
  it("admits an absent field and each shape that matches its own message", () => {
    expect(receiptsValid({ media: 0, payload: MFA_PAYLOAD, receipts: undefined })).toBe(true);
    expect(
      receiptsValid({
        media: 0,
        payload: MICHAEL_CLAUDE_PAYLOAD,
        receipts: { kind: "attached", links: [THREAD], media: 0 },
      }),
    ).toBe(true);
    expect(receiptsValid({ media: 0, payload: MFA_PAYLOAD, receipts: { kind: "tried", tried: "signed out" } })).toBe(
      true,
    );
  });

  it("refuses a count or a link the message does not carry, an unknown kind and a blank reason", () => {
    expect(
      receiptsValid({ media: 0, payload: MFA_PAYLOAD, receipts: { kind: "attached", links: [THREAD], media: 0 } }),
    ).toBe(false);
    expect(receiptsValid({ media: 0, payload: MFA_PAYLOAD, receipts: { kind: "attached", links: [], media: 2 } })).toBe(
      false,
    );
    expect(receiptsValid({ media: 0, payload: MFA_PAYLOAD, receipts: { kind: "screenshot" } })).toBe(false);
    expect(receiptsValid({ media: 0, payload: MFA_PAYLOAD, receipts: { kind: "self-evident", why: " " } })).toBe(false);
  });
});

describe("receiptsLine", () => {
  it("names each shape, a bump, and a row that named none", () => {
    expect(receiptsLine({ bump: false, receipts: undefined })).toBe("No receipts named");
    expect(receiptsLine({ bump: true, receipts: undefined })).toBe("No receipt owed: a bump");
    expect(receiptsLine({ bump: false, receipts: { kind: "attached", links: [THREAD], media: 3 } })).toBe(
      "Receipts: 1 link, 3 attachments",
    );
    expect(
      receiptsLine({ bump: false, receipts: { kind: "attached", links: ["a", "b"], media: 0, tried: "signed out" } }),
    ).toBe("Receipts: 2 links. Still missing, tried: signed out");
    expect(receiptsLine({ bump: false, receipts: { kind: "self-evident", why: "the link is the message" } })).toBe(
      "No receipt needed: the link is the message",
    );
    expect(receiptsLine({ bump: false, receipts: { kind: "tried", tried: "Vanta signed out" } })).toBe(
      "No receipt. Tried: Vanta signed out",
    );
  });
});
