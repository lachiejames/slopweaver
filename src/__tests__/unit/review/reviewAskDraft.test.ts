/*
 * The ask an approved reviewer pick parks: its one-message form, its why, and which held draft already is it.
 */
import { describe, expect, it } from "vitest";

import type { SlackDraftItem, SlackDraftState } from "../../../outbound/slack/draftRegister.js";
import { formReceiptLinks } from "../../../outbound/slack/formReceipts.js";
import {
  heldAskFor,
  heldDmChannelsFor,
  reviewAskFormOf,
  reviewAskReceiptsOf,
  reviewAskWhyOf,
} from "../../../review/reviewAskDraft.js";

const URL = "https://github.com/acme/acme-admin/pull/17";

/**
 * One register item with a plain payload — the only fields `heldAskFor` reads are real.
 *
 * @returns the item
 */
function item({
  id,
  state,
  channel,
  text,
}: {
  id: string;
  state: SlackDraftState;
  channel: string;
  text: string;
}): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      channel,
      digest: "d",
      form: "{}",
      id,
      mentions: [],
      payload: { form: "plain", text, unfurl_links: true, unfurl_media: true },
      shape: "top-level",
      tsIso: "2026-09-29T00:00:00.000Z",
      why: "w",
    },
    id,
    state,
  };
}

describe("reviewAskFormOf", () => {
  it("is one drip message: the ask, the pull request as one link labelled with its title and number", () => {
    expect(JSON.parse(reviewAskFormOf({ number: 17, title: "fix the thing", url: URL }))).toEqual({
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "hey, could I grab a review on ", type: "text" },
            { label: "fix the thing #17", type: "link", url: URL },
            { text: " when you get a sec? no rush", type: "text" },
          ],
        },
      ],
    });
  });
});

describe("reviewAskFormOf's label", () => {
  /** The ask's link label for a title, read back off its form. */
  const labelOf = ({ title }: { title: string }): string =>
    JSON.parse(reviewAskFormOf({ number: 7, title, url: URL })).messages[0].runs[1].label;

  it("keeps a title that fits, and shortens one that would pass the link label cap so the ask still parses", () => {
    const long = "x".repeat(200);
    expect(labelOf({ title: "fix the thing" })).toBe("fix the thing #7");
    expect(labelOf({ title: "y".repeat(117) })).toBe(`${"y".repeat(117)} #7`);
    expect(labelOf({ title: long })).toBe(`${"x".repeat(116)}… #7`);
    expect(labelOf({ title: long }).length).toBe(120);
    expect(formReceiptLinks({ form: reviewAskFormOf({ number: 7, title: long, url: URL }) })).toEqual([URL]);
  });

  it("folds a line break in the title to one space, so the one-line label still parses", () => {
    const title = "line one\r\n  line two\n";
    expect(labelOf({ title })).toBe("line one line two #7");
    expect(formReceiptLinks({ form: reviewAskFormOf({ number: 7, title, url: URL }) })).toEqual([URL]);
  });

  it("never leaves half an emoji where the cut lands", () => {
    // 115 single units then an emoji (two units) straddling the 116-unit cut: its high half is dropped, not kept alone.
    expect(labelOf({ title: `${"z".repeat(115)}😀${"z".repeat(10)}` })).toBe(`${"z".repeat(115)}… #7`);
  });
});

describe("reviewAskReceiptsOf", () => {
  it("declares nothing exactly when the recorder's parse derives the ask's link, and what was tried otherwise", () => {
    /** The declaration beside what the recorder derives off the ask's own form, after the form's parse. */
    const both = ({ url }: { url: string }) => {
      const form = reviewAskFormOf({ number: 7, title: "a fix", url });
      return { kind: reviewAskReceiptsOf({ form, url }).kind, links: formReceiptLinks({ form }) };
    };
    expect([
      both({ url: "https://github.com/acme/widgets/pull/7" }),
      both({ url: "ftp://github.com/acme/widgets/pull/7" }),
      // Prefixed like a web address, yet the drip parse refuses it, so it is no receipt.
      both({ url: "https://" }),
    ]).toEqual([
      { kind: "undeclared", links: ["https://github.com/acme/widgets/pull/7"] },
      { kind: "tried", links: [] },
      { kind: "tried", links: undefined },
    ]);
    const unparsed = reviewAskFormOf({ number: 7, title: "a fix", url: "https://" });
    const ftp = "ftp://github.com/acme/widgets/pull/7";
    expect([
      reviewAskReceiptsOf({ form: unparsed, url: "https://" }),
      reviewAskReceiptsOf({ form: reviewAskFormOf({ number: 7, title: "a fix", url: ftp }), url: ftp }),
    ]).toEqual([
      { kind: "tried", tried: "linking the pull request at https://, but the ask's form does not parse" },
      {
        kind: "tried",
        tried: `linking the pull request, but the reading's address ${ftp} does not count as a receipt link`,
      },
    ]);
  });
});

describe("reviewAskWhyOf", () => {
  it("names the pull request, the person and where the pick came from", () => {
    expect(reviewAskWhyOf({ prKey: "acme/acme-admin#17", who: "Sadie" })).toBe(
      "first review ask for acme/acme-admin#17 to Sadie, your approved pick from the suggested reviewer",
    );
  });
});

describe("heldAskFor", () => {
  const LINKED = `hey <${URL}|fix the thing #17> no rush`;

  const NO_DMS = new Map<string, string>();

  it("answers the held draft to that person linking that pull request", () => {
    const items = [
      item({ channel: "U0OTHER", id: "sd-other", state: "held", text: LINKED }),
      item({ channel: "U0SADIE", id: "sd-sadie", state: "held", text: LINKED }),
    ];
    expect(heldAskFor({ dmUsers: NO_DMS, items, reviewer: "U0SADIE", url: URL })).toBe("sd-sadie");
  });

  it("answers a DM addressed by its D id only once it resolves to that person", () => {
    const items = [
      item({ channel: "D0ROSA", id: "sd-rosa", state: "held", text: LINKED }),
      item({ channel: "D0SADIE", id: "sd-sadie", state: "held", text: LINKED }),
    ];
    const dmUsers = new Map([
      ["D0ROSA", "U0ROSA"],
      ["D0SADIE", "U0SADIE"],
    ]);
    expect([
      heldAskFor({ dmUsers, items, reviewer: "U0SADIE", url: URL }),
      heldAskFor({ dmUsers: NO_DMS, items, reviewer: "U0SADIE", url: URL }),
    ]).toEqual(["sd-sadie", undefined]);
  });

  it("never takes a DM to someone else for the ask, even one tagging the reviewer beside the link", () => {
    const text = `<@U0QUINN> is out today, could you take <${URL}|fix #17>?`;
    const items = [
      item({ channel: "U0JONAH", id: "sd-jonah", state: "held", text }),
      item({ channel: "D0SELF", id: "sd-proof", state: "held", text }),
    ];
    const dmUsers = new Map([["D0SELF", "U0SYNADAOWN"]]);
    expect(heldAskFor({ dmUsers, items, reviewer: "U0QUINN", url: URL })).toBeUndefined();
  });

  it("passes over a released or dropped one, and a link to a longer pull request number", () => {
    const items = [
      item({ channel: "U0SADIE", id: "sd-sent", state: "released", text: LINKED }),
      item({ channel: "U0SADIE", id: "sd-no", state: "dropped", text: LINKED }),
      item({ channel: "U0SADIE", id: "sd-170", state: "held", text: `hey <${URL}0|another #170>` }),
    ];
    expect(heldAskFor({ dmUsers: NO_DMS, items, reviewer: "U0SADIE", url: URL })).toBeUndefined();
  });

  it("answers a channel ask only where one line both tags the person and links the pull request", () => {
    const tagged = item({ channel: "C0TEAM", id: "sd-text", state: "held", text: `<@U0PRANAV|pranav> ${LINKED}` });
    const batch = item({
      channel: "C0TEAM",
      id: "sd-batch",
      state: "held",
      text: `two for you\n• <@U0SADIE> <${URL}0|#170>\n• <@U0PRANAV> ${LINKED}`,
    });
    const oneLine = item({
      channel: "C0TEAM",
      id: "sd-one-line",
      state: "held",
      text: `<@U0SADIE> <${URL}0|#170>, <@U0PRANAV> ${LINKED}`,
    });
    const toGroup = item({
      channel: "C0TEAM",
      id: "sd-group",
      state: "held",
      text: `<@U0SADIE> <${URL}0|#170>, <!subteam^S0PLATFORM|@platform> ${LINKED}, <!here> ${LINKED}`,
    });
    expect([
      heldAskFor({ dmUsers: NO_DMS, items: [oneLine], reviewer: "U0PRANAV", url: URL }),
      heldAskFor({ dmUsers: NO_DMS, items: [oneLine], reviewer: "U0SADIE", url: URL }),
      heldAskFor({ dmUsers: NO_DMS, items: [toGroup], reviewer: "U0SADIE", url: URL }),
    ]).toEqual(["sd-one-line", undefined, undefined]);
    expect([
      heldAskFor({ dmUsers: NO_DMS, items: [tagged], reviewer: "U0PRANAV", url: URL }),
      heldAskFor({ dmUsers: NO_DMS, items: [tagged], reviewer: "U0SADIE", url: URL }),
      heldAskFor({ dmUsers: NO_DMS, items: [batch], reviewer: "U0PRANAV", url: URL }),
      heldAskFor({ dmUsers: NO_DMS, items: [batch], reviewer: "U0SADIE", url: URL }),
    ]).toEqual(["sd-text", undefined, "sd-batch", undefined]);
  });

  it("answers an ask linking the bare address or a page under it", () => {
    const bare = item({ channel: "U0SADIE", id: "sd-bare", state: "held", text: `review? <${URL}>` });
    const files = item({ channel: "U0SADIE", id: "sd-files", state: "held", text: `review? <${URL}/files|diff>` });
    expect([
      heldAskFor({ dmUsers: NO_DMS, items: [bare], reviewer: "U0SADIE", url: URL }),
      heldAskFor({ dmUsers: NO_DMS, items: [files], reviewer: "U0SADIE", url: URL }),
    ]).toEqual(["sd-bare", "sd-files"]);
  });

  it("answers nothing over an empty register", () => {
    expect(heldAskFor({ dmUsers: NO_DMS, items: [], reviewer: "U0SADIE", url: URL })).toBeUndefined();
  });
});

describe("heldDmChannelsFor", () => {
  it("names each D id a held draft linking the pull request is addressed to, once, and nothing else", () => {
    const linked = `hey <${URL}|fix #17>`;
    const items = [
      item({ channel: "D0A", id: "sd-1", state: "held", text: linked }),
      item({ channel: "D0A", id: "sd-2", state: "held", text: linked }),
      item({ channel: "D0B", id: "sd-3", state: "released", text: linked }),
      item({ channel: "D0C", id: "sd-4", state: "held", text: `hey <${URL}0|#170>` }),
      item({ channel: "U0SADIE", id: "sd-5", state: "held", text: linked }),
      item({ channel: "C0TEAM", id: "sd-6", state: "held", text: linked }),
    ];
    expect(heldDmChannelsFor({ items, url: URL })).toEqual(["D0A"]);
  });
});
