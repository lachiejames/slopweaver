/**
 * `draftRevisionText.ts` — a parked as-me form's words as editable text and back, keeping links, mentions, marks and
 * the form's kind. The voice edits the body only.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { DraftRevisionErrors } from "../../../../outbound/slack/draftRevisionErrors.js";
import { draftEditableText, revisedFormJson, textRuns } from "../../../../outbound/slack/draftRevisionText.js";

const CARD = JSON.stringify({
  kind: "one-card",
  lines: [
    { runs: [{ text: "Can you look at " }, { label: "the pool", type: "link", url: "https://example.com/pool" }] },
    { runs: [{ person: "seth", type: "mention" }, { text: " it is " }, { bold: true, text: "urgent" }] },
  ],
  opening: "ask",
});

const LIST = JSON.stringify({
  bullets: [[{ text: "one" }], [{ code: true, text: "two" }]],
  kind: "one-list",
  lead: [{ text: "Two things:" }],
  trailing: [[{ text: "Thanks" }]],
});

const DRIP = JSON.stringify({
  kind: "drip",
  messages: [{ runs: [{ text: "First" }] }, { runs: [{ text: "Second" }] }],
});

describe("draftEditableText", () => {
  it("writes a one-card's lines with Slack's own markup for a link, a mention and a bold mark", () => {
    expect(unwrap(draftEditableText({ form: CARD }))).toBe(
      "Can you look at <https://example.com/pool|the pool>\n<@seth> it is *urgent*",
    );
  });

  it("writes a one-list's dot points as `- ` lines between its lead and trailing", () => {
    expect(unwrap(draftEditableText({ form: LIST }))).toBe("Two things:\n- one\n- `two`\nThanks");
  });

  it("writes a sub-point indented under its headline, so a voice edit sees the nesting", () => {
    const nested = JSON.stringify({ ...JSON.parse(LIST), depths: [0, 1] });
    expect(unwrap(draftEditableText({ form: nested }))).toBe("Two things:\n- one\n  - `two`\nThanks");
  });

  it("writes a drip's messages a blank line apart", () => {
    expect(unwrap(draftEditableText({ form: DRIP }))).toBe("First\n\nSecond");
  });

  it("refuses a form that is not JSON, and a kind a voice edit does not rewrite", () => {
    expect(unwrapErr(draftEditableText({ form: "{" })).code).toBe("FORM_NOT_JSON");
    const plain = draftEditableText({ form: JSON.stringify({ kind: "plain", text: "hi" }) });
    expect(unwrapErr(plain).message).toBe(
      "a plain form is not one a voice edit rewrites; only one-card, one-list and drip are",
    );
  });
});

describe("revisedFormJson", () => {
  it("keeps a one-card a one-card, and its opening declaration, when the text has no dot points", () => {
    const form = JSON.parse(unwrap(revisedFormJson({ form: CARD, text: "Hey <@seth>\ncould you look?" })));
    expect(form).toEqual({
      kind: "one-card",
      lines: [{ runs: [{ text: "Hey <@seth>", type: "text" }] }, { runs: [{ text: "could you look?", type: "text" }] }],
      opening: "ask",
    });
  });

  it("turns a one-card into a one-list when the owner asks for dot points", () => {
    const form = JSON.parse(unwrap(revisedFormJson({ form: CARD, text: "Two things:\n- one\n• two\nThanks" })));
    expect(form).toEqual({
      bullets: [[{ text: "one", type: "text" }], [{ text: "two", type: "text" }]],
      kind: "one-list",
      lead: [{ text: "Two things:", type: "text" }],
      opening: "ask",
      trailing: [[{ text: "Thanks", type: "text" }]],
    });
  });

  it("reads an indented dot point back as a sub-point, so a revision keeps the nesting it was shown", () => {
    const form = JSON.parse(unwrap(revisedFormJson({ form: LIST, text: "Two things:\n- one\n  - two\n- three" })));
    expect(form["depths"]).toEqual([0, 1, 0]);
    expect(form["bullets"]).toEqual([
      [{ text: "one", type: "text" }],
      [{ text: "two", type: "text" }],
      [{ text: "three", type: "text" }],
    ]);
  });

  it("writes no depths for a flat list, so a revision of one leaves its form exactly as it was", () => {
    const form = JSON.parse(unwrap(revisedFormJson({ form: LIST, text: "Two things:\n- one\n- two" })));
    expect(Object.keys(form).toSorted()).toEqual(["bullets", "kind", "lead", "trailing"]);
  });

  it("turns a one-list into a one-card when the dot points go", () => {
    expect(JSON.parse(unwrap(revisedFormJson({ form: LIST, text: "Just one thing" })))["kind"]).toBe("one-card");
  });

  it("keeps a drip a drip of one message, and refuses a second, since a parked draft is one", () => {
    const form = JSON.parse(unwrap(revisedFormJson({ form: DRIP, text: "\nFirst\n\n" })));
    expect(form).toEqual({ kind: "drip", messages: [{ runs: [{ text: "First", type: "text" }] }] });
    expect(unwrapErr(revisedFormJson({ form: DRIP, text: "First\n\n\nSecond" }))).toEqual(
      DraftRevisionErrors.dripTwoMessages(),
    );
  });

  it("refuses a line break inside a drip message, and a list lead of two lines, rather than joining them", () => {
    expect(unwrapErr(revisedFormJson({ form: DRIP, text: "First\nstill first\n\nSecond" })).code).toBe(
      "DRIP_LINE_BREAK",
    );
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "Lead\nmore lead\n- one" })).code).toBe("LIST_LEAD_LINES");
  });

  it("refuses an empty rewrite, a list with no lead, and dot points split by words", () => {
    expect(unwrapErr(revisedFormJson({ form: CARD, text: " \n\r\n " }))).toEqual(DraftRevisionErrors.noWords());
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "- one\n- two" }))).toEqual(DraftRevisionErrors.listNoLead());
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "Lead\n- one\nmiddle\n- two" })).code).toBe("POINTS_SPLIT");
  });

  it("round-trips a one-card's editable text back to the same words", () => {
    const text = unwrap(draftEditableText({ form: CARD }));
    expect(unwrap(draftEditableText({ form: unwrap(revisedFormJson({ form: CARD, text })) }))).toBe(text);
  });
});

describe("textRuns", () => {
  it("splits code and bold marks into their own runs and leaves the rest plain", () => {
    expect(textRuns({ text: "run `yarn x` *now* please" })).toEqual([
      { text: "run ", type: "text" },
      { code: true, text: "yarn x", type: "text" },
      { text: " ", type: "text" },
      { bold: true, text: "now", type: "text" },
      { text: " please", type: "text" },
    ]);
  });

  it("refuses a bold link both ways, since the register keeps no styled link", () => {
    const bold = JSON.stringify({
      kind: "one-card",
      lines: [{ runs: [{ bold: true, label: "urgent", type: "link", url: "https://example.com" }] }],
    });
    expect(unwrapErr(draftEditableText({ form: bold })).code).toBe("STYLE_NOT_KEPT");
    const boldLink = "*Read <https://example.com|the guide> now*";
    expect(unwrapErr(revisedFormJson({ form: CARD, text: boldLink })).message).toBe(
      `a tag, an @here or a link cannot be bold: write it plain, the words around it bold. The line: ${boldLink}`,
    );
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "Read <https://example.com|*urgent*>" })).code).toBe(
      "STRAY_MARK",
    );
    expect(unwrap(revisedFormJson({ form: CARD, text: "*Read* <https://example.com|the guide>" }))).toContain(
      '"bold":true',
    );
  });

  it("never starts or ends a mark inside a link", () => {
    expect(textRuns({ text: "<https://example.com|a *b* c> *now*" })).toEqual([
      { text: "<https://example.com|a *b* c> ", type: "text" },
      { bold: true, text: "now", type: "text" },
    ]);
  });

  it("refuses a row carrying italic or bold code both ways, rather than dropping the style unseen", () => {
    const italic = JSON.stringify({
      kind: "one-card",
      lines: [{ runs: [{ italic: true, text: "Urgent", type: "text" }] }],
    });
    const boldCode = JSON.stringify({
      kind: "drip",
      messages: [{ runs: [{ bold: true, code: true, text: "yarn x", type: "text" }] }],
    });
    expect(unwrapErr(draftEditableText({ form: italic })).code).toBe("STYLE_NOT_KEPT");
    expect(unwrapErr(revisedFormJson({ form: italic, text: "Urgent" })).code).toBe("STYLE_NOT_KEPT");
    expect(unwrapErr(draftEditableText({ form: boldCode })).code).toBe("STYLE_NOT_KEPT");
  });

  it("refuses a literal * or ` in the words both ways, since a mark would read it back as style", () => {
    const starred = JSON.stringify({
      kind: "one-card",
      lines: [{ runs: [{ bold: true, text: "2 * 3", type: "text" }] }],
    });
    const ticked = JSON.stringify({ kind: "one-card", lines: [{ runs: [{ code: true, text: "a`b", type: "text" }] }] });
    const label = JSON.stringify({
      kind: "one-card",
      lines: [{ runs: [{ label: "*x*", type: "link", url: "https://example.com" }] }],
    });
    expect(unwrapErr(draftEditableText({ form: starred })).code).toBe("STYLE_NOT_KEPT");
    expect(unwrapErr(draftEditableText({ form: ticked })).code).toBe("STYLE_NOT_KEPT");
    expect(unwrapErr(draftEditableText({ form: label })).code).toBe("STYLE_NOT_KEPT");
    // A label holding the markup's own edge would end the link early.
    const edged = JSON.stringify({
      kind: "one-card",
      lines: [{ runs: [{ label: "a>b", type: "link", url: "https://example.com" }] }],
    });
    expect(unwrapErr(draftEditableText({ form: edged })).code).toBe("STYLE_NOT_KEPT");
    const broken = JSON.stringify({ kind: "drip", messages: [{ runs: [{ text: "one\n\ntwo", type: "text" }] }] });
    expect(unwrapErr(draftEditableText({ form: broken })).code).toBe("STYLE_NOT_KEPT");
  });

  it("refuses a card line that would read back as a dot point, turning the card into a list", () => {
    const card = JSON.stringify({ kind: "one-card", lines: [{ runs: [{ text: "- not a point", type: "text" }] }] });
    const list = JSON.stringify({
      bullets: [[{ text: "a", type: "text" }]],
      kind: "one-list",
      lead: [{ text: "Lead", type: "text" }],
      trailing: [[{ text: "• tail", type: "text" }]],
    });
    expect(unwrapErr(draftEditableText({ form: card })).code).toBe("LINE_READS_AS_POINT");
    expect(unwrapErr(draftEditableText({ form: list })).code).toBe("LINE_READS_AS_POINT");
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "*2 * 3* please" })).code).toBe("STRAY_MARK");
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "run `yarn" })).code).toBe("STRAY_MARK");
    expect(unwrap(revisedFormJson({ form: CARD, text: "run `a*b` *now*" }))).toContain('"code":true');
  });

  it("refuses a bold tag or @here rather than losing its mark, and allows one beside a bold word", () => {
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "*<@seth>*" })).code).toBe("BOLD_MARKUP");
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "*urgent <!here>*" })).code).toBe("BOLD_MARKUP");
    expect(unwrap(revisedFormJson({ form: CARD, text: "<@seth> *urgent*" }))).toContain('"bold":true');
  });

  it("refuses an empty dot point rather than sending a literal dash", () => {
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "Lead\n- " }))).toEqual(DraftRevisionErrors.emptyPoint());
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "Lead\n•" })).code).toBe("EMPTY_POINT");
  });

  it("refuses a bold bare link", () => {
    expect(unwrapErr(revisedFormJson({ form: CARD, text: "*see https://x.test/a*" })).code).toBe("BOLD_MARKUP");
  });

  it("refuses a |label on a tag and an empty link label, which typing would drop", () => {
    const dropped = ["<@seth|DO NOT DROP> please review", "ping <!here|all>", "see <https://x.test/a|>"];
    expect(dropped.map((text) => unwrapErr(revisedFormJson({ form: CARD, text })))).toEqual(
      dropped.map((line) => DraftRevisionErrors.labelDropped({ line })),
    );
    expect(unwrap(revisedFormJson({ form: CARD, text: "<@seth> see <https://x.test/a|this>" }))).toContain("<@seth>");
  });

  it("keeps a bold run's edge spaces outside its mark", () => {
    const form = JSON.stringify({
      kind: "one-card",
      lines: [{ runs: [{ text: "go" }, { bold: true, text: " now " }] }],
    });
    expect(unwrap(draftEditableText({ form }))).toBe("go *now* ");
  });

  it("leaves a lone asterisk and an empty line alone", () => {
    expect(textRuns({ text: "5 * 3" })).toEqual([{ text: "5 * 3", type: "text" }]);
    expect(textRuns({ text: "" })).toEqual([]);
  });
});
