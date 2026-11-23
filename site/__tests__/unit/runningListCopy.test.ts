/*
 * What the voice puts on the running list: one message kept exactly, bounded in the schema's units, folded where the
 * voice chose, drawn in its lines; the destination it names; and what a copy of it carries.
 */
import { describe, expect, it } from "vitest";

import { RUNNING_LIST_LABEL_MAX, RUNNING_LIST_TEXT_MAX, runningListItemFold } from "../../lib/runningList";
import {
  COPY_OFFER_LABEL_MAX_CODE_POINTS,
  COPY_OFFER_TEXT_MAX_CODE_POINTS,
  type CopyOffer,
  copyDestinationOf,
  copyHtmlOf,
  copyMentionLabels,
  copyOfferText,
  copyOfferWire,
  copyOfferWireOf,
  offerCopyOf,
  offerFoldLine,
  offerStillLands,
  runningListItemLines,
} from "../../lib/runningListCopy";
import { mrkdwnSpans } from "../../lib/slackMrkdwn";
import type { SlackPeople } from "../../lib/slackPeople";

describe("the offer's caps", () => {
  it("are the running list's own, so an offer the voice may make is one the list keeps", () => {
    expect([COPY_OFFER_TEXT_MAX_CODE_POINTS, COPY_OFFER_LABEL_MAX_CODE_POINTS]).toEqual([
      RUNNING_LIST_TEXT_MAX,
      RUNNING_LIST_LABEL_MAX,
    ]);
  });
});

describe("copyOfferWireOf", () => {
  const offer: CopyOffer = { belowFold: "the rest", id: "offer-7", label: "reply 🙂", made: 7n, text: "head ``` " };

  it("reads back exactly what copyOfferWire wrote, through JSON", () => {
    const wire = copyOfferWire({ offer });
    expect(copyOfferWireOf({ value: JSON.parse(JSON.stringify(wire)) })).toStrictEqual({ offer: wire });
  });

  it("takes made at the page's twenty-digit cap and refuses one past it", () => {
    const at = "9".repeat(20);
    const past = "1".repeat(21);
    expect([
      copyOfferWireOf({ value: { id: `offer-${at}`, made: at, text: "x" } }),
      copyOfferWireOf({ value: { id: `offer-${past}`, made: past, text: "x" } }),
    ]).toEqual([
      { offer: { id: `offer-${at}`, made: at, text: "x" } },
      { why: "offered must carry made as canonical digits and id as offer-<made>" },
    ]);
  });

  it("counts the label and the message in code points, as the tool schema does", () => {
    const label = "🙂".repeat(COPY_OFFER_LABEL_MAX_CODE_POINTS);
    const text = "🙂".repeat(COPY_OFFER_TEXT_MAX_CODE_POINTS);
    expect([
      copyOfferWireOf({ value: { id: "offer-1", label, made: "1", text } }),
      copyOfferWireOf({ value: { id: "offer-1", made: "1", text: `${text}x` } }),
    ]).toEqual([
      { offer: { id: "offer-1", label, made: "1", text } },
      { why: `offered is over the list's ${String(COPY_OFFER_TEXT_MAX_CODE_POINTS)} characters` },
    ]);
  });
});

// A spoken instruction to stop at the end of a message.
describe("copyDestinationOf", () => {
  const WHY =
    "destination must be slack for a message the owner will post in Slack under their own name, or other for a review comment, a " +
    "script or talking points";

  it("reads slack and other as named", () => {
    expect([
      copyDestinationOf({ args: { destination: "slack", text: "x" } }),
      copyDestinationOf({ args: { destination: "other", text: "x" } }),
    ]).toEqual([
      { destination: "slack", kind: "read" },
      { destination: "other", kind: "read" },
    ]);
  });

  it("refuses an offer naming no destination, or one the list does not know, rather than guessing either", () => {
    expect([
      copyDestinationOf({ args: { text: "x" } }),
      copyDestinationOf({ args: { destination: "Slack", text: "x" } }),
      copyDestinationOf({ args: { destination: 1, text: "x" } }),
    ]).toEqual([
      { kind: "refused", why: WHY },
      { kind: "refused", why: WHY },
      { kind: "refused", why: WHY },
    ]);
  });
});

describe("offerStillLands", () => {
  it("lands in the call that asked, still up, a reconnect or rollover of it included", () => {
    // A reconnect is the same call carried on, so an offer checked across it still lands.
    expect(offerStillLands({ asked: 1n, callUp: true, now: 1n })).toBe(true);
  });

  it("holds nothing once the asking call ended, and nothing in a fresh call started since", () => {
    expect(offerStillLands({ asked: 1n, callUp: false, now: 1n })).toBe(false);
    // The race: call A ends during the check (a restart: release, then open) and B is up.
    expect(offerStillLands({ asked: 1n, callUp: true, now: 2n })).toBe(false);
  });

  it("tells fresh calls apart past where a number stops moving", () => {
    // 2^53 + 1 is 2^53 as a number, so the count is a bigint.
    const many = 2n ** 53n;
    expect(offerStillLands({ asked: many, callUp: true, now: many + 1n })).toBe(false);
  });
});

describe("offerCopyOf", () => {
  it("keeps multiline mrkdwn exactly, surrounding whitespace included", () => {
    const text = "  *Heads up* — staging is back\n• <https://example.com|the PR>\n• `yarn build` green\n";
    expect(offerCopyOf({ args: { text }, made: 1n })).toEqual({
      kind: "offered",
      offer: { id: "offer-1", made: 1n, text },
    });
  });

  it("keeps a label beside the message", () => {
    expect(offerCopyOf({ args: { label: "reply to Ari", text: "on it" }, made: 2n })).toEqual({
      kind: "offered",
      offer: { id: "offer-2", label: "reply to Ari", made: 2n, text: "on it" },
    });
  });

  it("drops a blank label rather than drawing an empty one", () => {
    expect(offerCopyOf({ args: { label: "   ", text: "on it" }, made: 3n })).toEqual({
      kind: "offered",
      offer: { id: "offer-3", made: 3n, text: "on it" },
    });
  });

  it.each([
    ["missing", {}],
    ["not a string", { text: 42 }],
    ["whitespace only", { text: " \n\t " }],
  ])("refuses text that is %s", (_name, args) => {
    expect(offerCopyOf({ args, made: 4n })).toEqual({
      kind: "refused",
      why: "text must be the draft of the owner's words, exactly as they will use it",
    });
  });

  it("counts text in code points, as the schema does, so a cap's worth of emoji is accepted", () => {
    // Each "🙂" is four UTF-8 bytes and two UTF-16 units, and still one code point.
    const text = "🙂".repeat(COPY_OFFER_TEXT_MAX_CODE_POINTS);
    expect(offerCopyOf({ args: { text }, made: 5n })).toEqual({
      kind: "offered",
      offer: { id: "offer-5", made: 5n, text },
    });
  });

  it("refuses a message one code point past the cap", () => {
    const text = "🙂".repeat(COPY_OFFER_TEXT_MAX_CODE_POINTS + 1);
    expect(offerCopyOf({ args: { text }, made: 6n })).toEqual({
      kind: "refused",
      why: "text is 8193 characters, over the list's 8192: offer a shorter message",
    });
  });

  it("refuses a label that is not a string", () => {
    expect(offerCopyOf({ args: { label: 7, text: "on it" }, made: 7n })).toEqual({
      kind: "refused",
      why: "label must be a few words saying what the message is for, or left out",
    });
  });

  it("counts a label in code points, accepting the cap and refusing one past it", () => {
    const atCap = "🙂".repeat(COPY_OFFER_LABEL_MAX_CODE_POINTS);
    expect(offerCopyOf({ args: { label: atCap, text: "x" }, made: 8n })).toEqual({
      kind: "offered",
      offer: { id: "offer-8", label: atCap, made: 8n, text: "x" },
    });
    expect(offerCopyOf({ args: { label: `${atCap}🙂`, text: "x" }, made: 9n })).toEqual({
      kind: "refused",
      why: "label must be at most 80 characters, a few words",
    });
  });
});

/** A roster naming one person, as the console's people reading carries it. */
const PEOPLE: SlackPeople = new Map([["U01ARI", { handle: "ari", name: "Ari Patel" }]]);

/** The list's labels over that roster. */
const LABELS = copyMentionLabels({ people: PEOPLE });

/** Labels over an empty roster: every mention reads as its id. */
const NO_NAMES = copyMentionLabels({ people: new Map() });

describe("copyHtmlOf", () => {
  it("carries bold, italic, code and a labelled link as HTML, one line per break", () => {
    expect(
      copyHtmlOf({ labels: NO_NAMES, text: "*Heads up* _soon_\n• `yarn build` on <https://example.com/pr|the PR>" }),
    ).toBe('<b>Heads up</b> <i>soon</i><br>• <code>yarn build</code> on <a href="https://example.com/pr">the PR</a>');
  });

  it("escapes every HTML character a message carries, so text can never become markup", () => {
    expect(copyHtmlOf({ labels: NO_NAMES, text: `a <b>"x"</b> & 'y'` })).toBe(
      "a &lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; &#39;y&#39;",
    );
  });

  it("reads Slack's own wire escapes once, then escapes them for HTML", () => {
    expect(copyHtmlOf({ labels: NO_NAMES, text: "1 &lt; 2 &amp;&amp; *a &gt; b*" })).toBe(
      "1 &lt; 2 &amp;&amp; <b>a &gt; b</b>",
    );
  });

  it("never makes a link of a scheme Slack's preview would not, leaving it text", () => {
    expect(copyHtmlOf({ labels: NO_NAMES, text: "<javascript:alert(1)|click>" })).toBe(
      "&lt;javascript:alert(1)|click&gt;",
    );
  });

  it("names a mention the roster knows by its name, and one it does not by its id", () => {
    expect(copyHtmlOf({ labels: LABELS, text: "<@U01ARI> and <@U0SYN9NOBODY> thanks" })).toBe(
      "@Ari Patel and @U0SYN9NOBODY thanks",
    );
  });

  it("keeps a shortcode as written, in text and code alike — the tray draws the emoji, the paste carries the name", () => {
    expect(copyHtmlOf({ labels: NO_NAMES, text: "*done* :thumbsup: `:tada:`" })).toBe(
      "<b>done</b> :thumbsup: <code>:tada:</code>",
    );
  });
});

describe("copyMentionLabels", () => {
  it("draws a known member's mention as a chip with their name, keeping the id it notifies", () => {
    expect(mrkdwnSpans({ labels: LABELS, text: "<@U01ARI>" })).toEqual([
      { kind: "mention", label: "@Ari Patel", userId: "U01ARI" },
    ]);
  });

  it("leaves an id the roster does not name as an id chip, never a guessed name", () => {
    expect(mrkdwnSpans({ labels: LABELS, text: "<@U0SYN9NOBODY>" })).toEqual([
      { idLabel: true, kind: "mention", label: "@U0SYN9NOBODY", userId: "U0SYN9NOBODY" },
    ]);
  });

  it("leaves a member the roster holds with no name as an id chip", () => {
    const unnamed = copyMentionLabels({ people: new Map([["U02BLANK", { handle: "blank", name: "  " }]]) });
    expect(unnamed.labelFor({ userId: "U02BLANK" })).toBe(undefined);
  });
});

describe("runningListItemLines", () => {
  const plain = ({ text }: { text: string }): unknown => ({ fenced: false, text });
  const code = ({ text }: { text: string }): unknown => ({ fenced: true, text });

  it("reads a fence crossing the fold as one code block, so neither half draws its shortcodes", () => {
    const offer = { belowFold: ":thumbsup:\n```", text: "ship :tada:\n```\n:tada:" };
    const item = { foldLine: offerFoldLine({ offer }), text: copyOfferText({ offer }) };
    expect(runningListItemLines({ item })).toEqual({
      fold: [
        { line: ":thumbsup:", segments: [code({ text: ":thumbsup:" })] },
        { line: "```", segments: [code({ text: "```" })] },
      ],
      head: [
        { line: "ship :tada:", segments: [plain({ text: "ship :tada:" })] },
        { line: "```", segments: [code({ text: "```" })] },
        { line: ":tada:", segments: [code({ text: ":tada:" })] },
      ],
    });
  });

  it("has no fold for an item with none", () => {
    expect(runningListItemLines({ item: { foldLine: undefined, text: "ship :tada:" } })).toEqual({
      fold: undefined,
      head: [{ line: "ship :tada:", segments: [plain({ text: "ship :tada:" })] }],
    });
  });
});

describe("copyOfferText", () => {
  it("is the head alone when nothing folds", () => {
    expect(copyOfferText({ offer: { text: "on it" } })).toBe("on it");
  });

  it("joins the head and the fold with exactly one newline, whatever either carries at its edge", () => {
    expect(copyOfferText({ offer: { belowFold: "\n• one\n• two\n", text: "*Heads up*\n" } })).toBe(
      "*Heads up*\n\n\n• one\n• two\n",
    );
  });
});

describe("offerFoldLine", () => {
  it("is nothing for a message with no fold", () => {
    expect(offerFoldLine({ offer: { text: "on it\nsecond line" } })).toBe(undefined);
  });

  it("is the line after the head's last", () => {
    expect(offerFoldLine({ offer: { belowFold: "• one", text: "*Heads up*\nstaging is back" } })).toBe(3);
  });

  // The list keeps the whole message and this line; the fold it draws must be the voice's, byte for byte.
  it.each([
    ["a one-line head", { belowFold: "• one\n• two", text: "*Heads up*" }],
    ["edges that carry newlines", { belowFold: "\n• one\n• two\n", text: "*Heads up*\n" }],
    ["a head of blank lines around words", { belowFold: "rest", text: "\n\nhead\n" }],
  ])("round-trips %s through the list's own fold", (_name, offer) => {
    const item = { foldLine: offerFoldLine({ offer })!, text: copyOfferText({ offer }) };
    expect(runningListItemFold({ item })).toEqual({ belowFold: offer.belowFold, head: offer.text });
  });
});

describe("copyOfferWire", () => {
  it("carries made as its decimal digits, past where a number stops counting", () => {
    const made = 2n ** 64n + 1n;
    expect(copyOfferWire({ offer: { id: "offer-x", made, text: "on it" } })).toEqual({
      id: "offer-x",
      made: "18446744073709551617",
      text: "on it",
    });
  });

  it("carries the fold and the label when the offer has them, and nothing it does not", () => {
    const offer: CopyOffer = { belowFold: "the rest", id: "offer-2", label: "reply", made: 2n, text: "head" };
    expect(copyOfferWire({ offer })).toEqual({
      belowFold: "the rest",
      id: "offer-2",
      label: "reply",
      made: "2",
      text: "head",
    });
    expect(Object.keys(copyOfferWire({ offer: { id: "offer-3", made: 3n, text: "x" } }))).toEqual([
      "id",
      "made",
      "text",
    ]);
  });
});

describe("offerCopyOf with a fold", () => {
  it("keeps the head and the fold exactly, mentions and surrounding whitespace included", () => {
    const args = { below_fold: "  • <@U01ARI> owns the rollback\n", text: "*Staging* is back " };
    expect(offerCopyOf({ args, made: 10n })).toEqual({
      kind: "offered",
      offer: {
        belowFold: "  • <@U01ARI> owns the rollback\n",
        id: "offer-10",
        made: 10n,
        text: "*Staging* is back ",
      },
    });
  });

  // A clipboard write turns half a surrogate pair into U+FFFD, so the paste would differ from the offer.
  it.each([
    ["the head", { text: "<@U01ARI>\uD800" }],
    ["the fold", { below_fold: "\uDC00 the rest", text: "head" }],
    ["the label", { label: "reply \uD83D", text: "head" }],
  ])("refuses half a character in %s, rather than offer what the clipboard would change", (_where, args) => {
    expect(offerCopyOf({ args, made: 1n })).toEqual({
      kind: "refused",
      why: "text, below_fold and label must be whole characters: one held half of a surrogate pair",
    });
  });

  // A bounded counter gives an offered line a worst case, and matches the call file's own cap.
  it("takes a counter of 20 digits and refuses one of 21, which the call file could not name", () => {
    expect(offerCopyOf({ args: { text: "hi" }, made: 10n ** 20n - 1n })).toEqual({
      kind: "offered",
      offer: { id: "offer-99999999999999999999", made: 10n ** 20n - 1n, text: "hi" },
    });
    expect(offerCopyOf({ args: { text: "hi" }, made: 10n ** 20n })).toEqual({
      kind: "refused",
      why: "this window has offered more messages than its call file can name: reload it",
    });
  });

  it("takes a whole surrogate pair, an emoji, as the one character it is", () => {
    expect(offerCopyOf({ args: { below_fold: "🙂", text: "done 🎉" }, made: 2n })).toEqual({
      kind: "offered",
      offer: { belowFold: "🙂", id: "offer-2", made: 2n, text: "done 🎉" },
    });
  });

  it.each([
    ["not a string", { below_fold: 3, text: "head" }],
    ["blank", { below_fold: " \n ", text: "head" }],
    ["empty", { below_fold: "", text: "head" }],
  ])("refuses a fold that is %s", (_name, args) => {
    expect(offerCopyOf({ args, made: 11n })).toEqual({
      kind: "refused",
      why: "below_fold must be the rest of the message, behind Show more, or left out",
    });
  });

  it("accepts a head and fold that are the cap together, counting the joining newline", () => {
    const text = "🙂".repeat(4000);
    const belowFold = "🙂".repeat(COPY_OFFER_TEXT_MAX_CODE_POINTS - 4000 - 1);
    expect(offerCopyOf({ args: { below_fold: belowFold, text }, made: 12n })).toEqual({
      kind: "offered",
      offer: { belowFold, id: "offer-12", made: 12n, text },
    });
  });

  it("refuses a head and fold one code point past the cap together, though each alone is under it", () => {
    const text = "🙂".repeat(4000);
    const belowFold = "🙂".repeat(COPY_OFFER_TEXT_MAX_CODE_POINTS - 4000);
    expect(offerCopyOf({ args: { below_fold: belowFold, text }, made: 13n })).toEqual({
      kind: "refused",
      why: "text and below_fold are 8193 characters together, over the list's 8192: offer a shorter message",
    });
  });
});
