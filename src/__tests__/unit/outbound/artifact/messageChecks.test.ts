/** A one-card's whole width and a drip message's shape, read off a real Zod refinement context. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { checkCardLineBreaks, checkCardWidth, checkDripMessage } from "../../../../outbound/artifact/messageChecks.js";
import type { DripInlineRun } from "../../../../outbound/artifact/types.js";

/** One reported issue, reduced to the two fields a caller reads. */
interface Issue {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

/** Every issue one refinement body raised, in order; an empty list when it raised none. */
function issuesOf({ refine }: { refine: (ctx: z.RefinementCtx) => void }): Issue[] {
  const parsed = z
    .unknown()
    .superRefine((_value, ctx) => {
      refine(ctx);
    })
    .safeParse(null);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path }));
}

/** One plain text run of `length` characters. */
function text({ length }: { length: number }): DripInlineRun {
  return { text: "a".repeat(length), type: "text" };
}

const CARD_WIDTH_TAIL =
  " — a discussion piece states the thing and links the detail rather than restating it. Cut it, or move the " +
  "detail into what the card links to. Splitting it into more lines will NOT help: this bound is on the whole " +
  "card, deliberately.";

const PLAIN_HINT =
  ", or send it as one plain message with `--body`, which applies neither rule — only the target platform's own " +
  "maximum length. Private exact voice rules still apply at the send seam, and so does the check that every raw " +
  "`<@U…>` in it names somebody the roster knows.";

const ONE_CARD_HINT =
  ', or — if this was always meant to be ONE message — send it as `{"kind":"one-card"}`, whose `lines` carry the ' +
  "breaks and whose mentions are verified the same way a drip's are";

const DRIP_NEWLINE_HEAD =
  "a drip message carries NO internal line breaks — the gap between messages IS the spacing. Split this into " +
  "two messages instead of embedding a newline";

/** The drip width refusal for message `index` of `width` against `max`, ending in `tail`. */
function dripWidthMessage({
  index,
  max,
  tail,
  width,
}: {
  index: number;
  max: number;
  tail: string;
  width: number;
}): string {
  return (
    `drip message ${String(index)} is ${String(width)} visible chars, over the ${String(max)} cap — a drip ` +
    `message is a concise sentence or two, and the sequence is where the length goes. Split it into another ` +
    `message${tail}`
  );
}

describe("checkCardWidth", () => {
  it("accepts a card at the cap and refuses one a character past it", () => {
    const atCap = issuesOf({
      refine: (ctx) => {
        checkCardWidth({ cardVisibleMax: 5, ctx, path: ["lines"], sequences: [[text({ length: 5 })]] });
      },
    });
    const pastCap = issuesOf({
      refine: (ctx) => {
        checkCardWidth({ cardVisibleMax: 5, ctx, path: ["lines"], sequences: [[text({ length: 6 })]] });
      },
    });
    expect(atCap).toEqual([]);
    expect(pastCap).toEqual([
      { message: `this card is 6 visible chars, over the 5 cap${CARD_WIDTH_TAIL}`, path: ["lines"] },
    ]);
  });

  it("sums the width across every sequence, so splitting a line does not get under the cap", () => {
    const split = issuesOf({
      refine: (ctx) => {
        checkCardWidth({
          cardVisibleMax: 5,
          ctx,
          path: ["bullets", 1],
          sequences: [
            [text({ length: 3 })],
            [text({ length: 2 }), { label: "ab", type: "link", url: "https://x.example/long" }],
          ],
        });
      },
    });
    expect(split).toEqual([
      { message: `this card is 7 visible chars, over the 5 cap${CARD_WIDTH_TAIL}`, path: ["bullets", 1] },
    ]);
  });

  it("costs a link its label and never its URL", () => {
    const issues = issuesOf({
      refine: (ctx) => {
        checkCardWidth({
          cardVisibleMax: 3,
          ctx,
          path: [],
          sequences: [[{ label: "abc", type: "link", url: "https://example.com/a/very/long/path" }]],
        });
      },
    });
    expect(issues).toEqual([]);
  });
});

describe("checkCardLineBreaks", () => {
  it("refuses a newline in a text run and a carriage return in a link label, naming the field given", () => {
    const issues = issuesOf({
      refine: (ctx) => {
        checkCardLineBreaks({
          ctx,
          field: "bullets",
          path: ["bullets", 2],
          runs: [
            { text: "one\ntwo", type: "text" },
            { text: "clean", type: "text" },
            { label: "lab\rel", type: "link", url: "https://example.com" },
          ],
        });
      },
    });
    const message =
      "a bullets entry carries no `\\n` of its own — `bullets` IS the line structure, so add another entry to it " +
      "instead of embedding a break the preview cannot see.";
    expect(issues).toEqual([
      { message, path: ["bullets", 2, "runs", 0] },
      { message, path: ["bullets", 2, "runs", 2] },
    ]);
  });

  it("raises nothing for a mention, group or broadcast run, which carry no visible string of their own", () => {
    const issues = issuesOf({
      refine: (ctx) => {
        checkCardLineBreaks({
          ctx,
          field: "lines",
          path: ["lines", 0],
          runs: [
            { person: "person\none", type: "mention" },
            { handle: "eng\nineers", type: "group" },
            { range: "here", type: "broadcast" },
          ],
        });
      },
    });
    expect(issues).toEqual([]);
  });
});

describe("checkDripMessage", () => {
  it("accepts a message at its cap and refuses one past it, offering the plain body for a sole unstyled message", () => {
    const atCap = issuesOf({
      refine: (ctx) => {
        checkDripMessage({ ctx, index: 0, messageVisibleMax: 4, runs: [text({ length: 4 })], soleMessage: true });
      },
    });
    const pastCap = issuesOf({
      refine: (ctx) => {
        checkDripMessage({ ctx, index: 0, messageVisibleMax: 4, runs: [text({ length: 5 })], soleMessage: true });
      },
    });
    expect(atCap).toEqual([]);
    expect(pastCap).toEqual([
      { message: dripWidthMessage({ index: 0, max: 4, tail: PLAIN_HINT, width: 5 }), path: ["messages", 0] },
    ]);
  });

  it("withholds the plain-body hint from one message of several, and from styled text or a link", () => {
    const ofSeveral = issuesOf({
      refine: (ctx) => {
        checkDripMessage({ ctx, index: 3, messageVisibleMax: 4, runs: [text({ length: 5 })], soleMessage: false });
      },
    });
    const styled = issuesOf({
      refine: (ctx) => {
        checkDripMessage({
          ctx,
          index: 0,
          messageVisibleMax: 4,
          runs: [{ bold: true, text: "aaaaa", type: "text" }],
          soleMessage: true,
        });
      },
    });
    const linked = issuesOf({
      refine: (ctx) => {
        checkDripMessage({
          ctx,
          index: 0,
          messageVisibleMax: 4,
          runs: [{ label: "aaaaa", type: "link", url: "https://example.com" }],
          soleMessage: true,
        });
      },
    });
    expect(ofSeveral).toEqual([
      { message: dripWidthMessage({ index: 3, max: 4, tail: ".", width: 5 }), path: ["messages", 3] },
    ]);
    expect(styled).toEqual([
      { message: dripWidthMessage({ index: 0, max: 4, tail: ".", width: 5 }), path: ["messages", 0] },
    ]);
    expect(linked).toEqual([
      { message: dripWidthMessage({ index: 0, max: 4, tail: ".", width: 5 }), path: ["messages", 0] },
    ]);
  });

  it("refuses a newline in a sole unstyled message with both the one-card and plain-body hints", () => {
    const issues = issuesOf({
      refine: (ctx) => {
        checkDripMessage({
          ctx,
          index: 0,
          messageVisibleMax: 100,
          runs: [{ text: "one\r\ntwo", type: "text" }],
          soleMessage: true,
        });
      },
    });
    expect(issues).toEqual([
      { message: `${DRIP_NEWLINE_HEAD}${ONE_CARD_HINT}${PLAIN_HINT}`, path: ["messages", 0, "runs", 0] },
    ]);
  });

  it("refuses a newline in a link label of one message of several with neither hint", () => {
    const issues = issuesOf({
      refine: (ctx) => {
        checkDripMessage({
          ctx,
          index: 2,
          messageVisibleMax: 100,
          runs: [
            { text: "fine", type: "text" },
            { label: "two\nlines", type: "link", url: "https://example.com" },
          ],
          soleMessage: false,
        });
      },
    });
    expect(issues).toEqual([{ message: `${DRIP_NEWLINE_HEAD}.`, path: ["messages", 2, "runs", 1] }]);
  });

  it("reports width and newline together when one message breaks both", () => {
    const issues = issuesOf({
      refine: (ctx) => {
        checkDripMessage({
          ctx,
          index: 1,
          messageVisibleMax: 3,
          runs: [{ text: "ab\ncd", type: "text" }],
          soleMessage: false,
        });
      },
    });
    expect(issues).toEqual([
      { message: dripWidthMessage({ index: 1, max: 3, tail: ".", width: 5 }), path: ["messages", 1] },
      { message: `${DRIP_NEWLINE_HEAD}.`, path: ["messages", 1, "runs", 0] },
    ]);
  });

  it("does not read a mention's identity key as a visible newline", () => {
    const issues = issuesOf({
      refine: (ctx) => {
        checkDripMessage({
          ctx,
          index: 0,
          messageVisibleMax: 100,
          runs: [{ person: "a\nb", type: "mention" }],
          soleMessage: true,
        });
      },
    });
    expect(issues).toEqual([]);
  });
});
