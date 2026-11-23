/**
 * A hand step's quotes: the room's own lines drawn above the note's fold, capped by the schema and refused rather
 * than cut, and carried through the register's own reader byte for byte.
 */
import { describe, expect, it } from "vitest";

import { checkedQuotes, QUOTE_TEXT_CAP, QUOTE_WHO_CAP, QUOTES_MAX } from "../../../hand/quotes.js";
import { conflictingField, parseHandLine } from "../../../hand/row.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** A permalink in the shape a Slack message link has. */
const LINK = "https://acme.slack.com/archives/C0SYN000004/p1790126312750189";

/** One quote as a poster supplies it. */
const QUOTE = { permalink: LINK, text: "our sdk is old af", who: "Jonah Yates" } as const;

/**
 * The refusal's message for a value the check must refuse — throwing, like `unwrap`, when it accepts it.
 *
 * @param value the value to check
 * @returns the refusal's message
 */
function refusal({ value }: { value: unknown }): string {
  const checked = checkedQuotes({ value });
  if (checked.isOk()) {
    throw new Error("expected a refusal");
  }
  return checked.error.message;
}

/**
 * A step carrying the given quotes, built through the one builder every reader and writer uses.
 *
 * @param quotes the quotes to carry
 * @returns the built step
 */
function stepWith({ quotes }: { quotes: unknown }): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "inc-c0syn000004-r1",
        postedBy: "workspace:1",
        postedIso: "2026-10-04T07:00:00.000Z",
        quotes,
        unblocks: "handover run incident-2026-09-23-payment-checkout-r-c0syn000004",
        what: "Share the checkout incident findings with the team?",
        witness: "slopweaver hand done inc-c0syn000004-r1",
      },
    }),
  );
}

describe("checkedQuotes", () => {
  it("keeps each quote trimmed, in order, and drops an absent or empty list", () => {
    expect(
      unwrap(checkedQuotes({ value: [{ ...QUOTE, text: "  our sdk is old af  ", who: " Jonah Yates " }] })),
    ).toEqual([QUOTE]);
    expect(unwrap(checkedQuotes({ value: undefined }))).toBe(undefined);
    expect(unwrap(checkedQuotes({ value: [] }))).toBe(undefined);
  });

  it("accepts a permalink carrying a thread query", () => {
    const threaded = `${LINK}?thread_ts=1790126246.723329&cid=C0SYN000004`;
    expect(unwrap(checkedQuotes({ value: [{ ...QUOTE, permalink: threaded }] }))![0]!.permalink).toBe(threaded);
  });

  it("refuses a value that is not a list of quote objects, or an entry with a key it does not know", () => {
    expect(refusal({ value: "one" })).toBe("quotes is a list of { text, who, permalink }");
    expect(refusal({ value: ["one"] })).toBe("quotes is a list of { text, who, permalink }");
    expect(refusal({ value: [{ ...QUOTE, when: "01:18Z" }] })).toBe(
      'quotes carries an entry with an unknown key "when"',
    );
  });

  it("refuses an entry whose text or who is missing, empty or multi-line", () => {
    expect(refusal({ value: [{ permalink: LINK, who: "Jonah Yates" }] })).toBe(
      "quotes carries an entry whose text is not text",
    );
    expect(refusal({ value: [{ ...QUOTE, text: "  " }] })).toBe("quotes carries an empty or multi-line text");
    expect(refusal({ value: [{ ...QUOTE, who: "a\nb" }] })).toBe("quotes carries an empty or multi-line who");
  });

  it("refuses a quote past its cap rather than cutting it, and accepts one at it", () => {
    expect(unwrap(checkedQuotes({ value: [{ ...QUOTE, text: "q".repeat(QUOTE_TEXT_CAP) }] }))![0]!.text.length).toBe(
      QUOTE_TEXT_CAP,
    );
    expect(refusal({ value: [{ ...QUOTE, text: "q".repeat(QUOTE_TEXT_CAP + 1) }] })).toBe(
      `quotes carries a 201-character text and the cap is 200 — quote a shorter line, or mark your own elision with …: "${"q".repeat(40)}…"`,
    );
    expect(refusal({ value: [{ ...QUOTE, who: "w".repeat(QUOTE_WHO_CAP + 1) }] })).toBe(
      `quotes carries a 61-character who and the cap is 60 — quote a shorter line, or mark your own elision with …: "${"w".repeat(40)}…"`,
    );
  });

  it("refuses more quotes than the fold carries, and accepts exactly that many", () => {
    expect(unwrap(checkedQuotes({ value: Array.from({ length: QUOTES_MAX }, () => QUOTE) }))!.length).toBe(QUOTES_MAX);
    expect(refusal({ value: Array.from({ length: QUOTES_MAX + 1 }, () => QUOTE) })).toBe(
      "quotes carries 4 quotes and the cap is 3 — keep the lines that carry the incident",
    );
  });

  it("refuses a permalink that is not a Slack message link", () => {
    expect(refusal({ value: [{ ...QUOTE, permalink: "https://example.com/archives/C1/p1" }] })).toBe(
      'quotes carries a permalink "https://example.com/archives/C1/p1" that is not a Slack message link (https://<workspace>.slack.com/archives/<channel>/p<ts>)',
    );
    expect(refusal({ value: [{ ...QUOTE, permalink: "https://acme.slack.com/archives/C0SYN000004" }] })).toBe(
      'quotes carries a permalink "https://acme.slack.com/archives/C0SYN000004" that is not a Slack message link (https://<workspace>.slack.com/archives/<channel>/p<ts>)',
    );
  });
});

describe("a step's quotes in the register", () => {
  it("reads back from a posted line exactly as written", () => {
    const step = stepWith({ quotes: [QUOTE] });
    const read = unwrap(parseHandLine({ line: JSON.stringify({ kind: "posted", step }), lineNumber: 1 }));
    expect(read).toEqual({ kind: "posted", step });
    expect(step.quotes).toEqual([QUOTE]);
  });

  it("refuses a register line whose quotes break a rule, rather than drawing them", () => {
    const step = { ...stepWith({ quotes: undefined }), quotes: [{ ...QUOTE, permalink: "nope" }] };
    const read = parseHandLine({ line: JSON.stringify({ kind: "posted", step }), lineNumber: 7 });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().code).toBe("CORRUPT_ROW");
  });

  it("calls two postings that differ only in their quotes a conflict, naming the field", () => {
    expect(
      conflictingField({
        first: stepWith({ quotes: [QUOTE] }),
        second: stepWith({ quotes: [{ ...QUOTE, who: "Kieran" }] }),
      }),
    ).toBe("quotes");
    expect(conflictingField({ first: stepWith({ quotes: [QUOTE] }), second: stepWith({ quotes: [QUOTE] }) })).toBe(
      undefined,
    );
  });
});
