/**
 * `visibleLinks.ts`: only a link Slack draws for the reader counts. The finding-proof cases in `findingProof.test.ts`
 * drive it through every field; these pin the module's own contract.
 */
import { describe, expect, it } from "vitest";

import { renderedReceiptLinks } from "../../../../outbound/slack/visibleLinks.js";

describe("renderedReceiptLinks", () => {
  it("reads a labelled link in text, and nothing a reader is not shown", () => {
    expect([
      renderedReceiptLinks({ payload: { text: "12 users <https://e.example/a|evidence>" } }),
      renderedReceiptLinks({ payload: { text: "12 users", url: "https://e.example/hidden" } }),
      renderedReceiptLinks({ payload: "not a payload" }),
    ]).toEqual([["https://e.example/a"], [], []]);
  });

  it("reads a button only with an action_id and a plain_text label", () => {
    const label = { text: "evidence", type: "plain_text" };
    const actions = ({ button }: { button: Record<string, unknown> }): unknown => ({
      blocks: [{ elements: [button], type: "actions" }],
      text: "",
    });
    expect([
      renderedReceiptLinks({
        payload: actions({ button: { action_id: "a", text: label, type: "button", url: "https://e.example" } }),
      }),
      renderedReceiptLinks({ payload: actions({ button: { text: label, type: "button", url: "https://e.example" } }) }),
    ]).toEqual([["https://e.example"], []]);
  });
});
