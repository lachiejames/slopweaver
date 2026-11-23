/*
 * The links `slack draft record` would derive off a composed drip form: the drip parse first, then the recorder's
 * own `receiptLinks`, so a verb declaring its own receipts judges by what the recorder will find.
 */
import { describe, expect, it } from "vitest";

import { dripArtifactSchema } from "../../../../outbound/artifact/asMeSchema.js";
import { receiptLinks } from "../../../../outbound/slack/draftReceipts.js";
import { formReceiptLinks } from "../../../../outbound/slack/formReceipts.js";

/**
 * A one-message drip form holding the runs given.
 *
 * @returns the form JSON
 */
function drip({ runs }: { runs: readonly Record<string, string>[] }): string {
  return JSON.stringify({ kind: "drip", messages: [{ runs }] });
}

describe("formReceiptLinks", () => {
  it("derives a link run, a bare web address the parse converts, and never a mailto the parse also converts", () => {
    expect([
      formReceiptLinks({ form: drip({ runs: [{ label: "the run", type: "link", url: "https://x.test/r/1" }] }) }),
      formReceiptLinks({ form: drip({ runs: [{ text: "see https://x.test/r/2 for it", type: "text" }] }) }),
      formReceiptLinks({ form: drip({ runs: [{ text: "mail mailto:owner@example.com", type: "text" }] }) }),
      formReceiptLinks({ form: drip({ runs: [{ text: "nothing to open here", type: "text" }] }) }),
    ]).toEqual([["https://x.test/r/1"], ["https://x.test/r/2"], [], []]);
  });

  it("answers undefined for a form the parse refuses, as a link with only a scheme", () => {
    expect(formReceiptLinks({ form: drip({ runs: [{ label: "x", type: "link", url: "https://" }] }) })).toBe(undefined);
  });

  it("finds the same links the recorder's own receiptLinks does over a form parsed at an operator's tight caps", () => {
    const form = drip({
      runs: [
        { text: "see https://x.test/r/3 and ", type: "text" },
        { label: "the board", type: "link", url: "https://x.test/r/4" },
      ],
    });
    const tight = dripArtifactSchema({ maxMessages: 1, messageVisibleMax: 400 }).parse(JSON.parse(form));
    expect(formReceiptLinks({ form })).toEqual(receiptLinks({ payload: tight }));
    expect(formReceiptLinks({ form })).toEqual(["https://x.test/r/3", "https://x.test/r/4"]);
  });
});
