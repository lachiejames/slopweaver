/**
 * A message about a possible problem states, at the top, how many people it affects: the declaration, the
 * top-region check per form, and what does not count as stating it.
 */
import { describe, expect, it } from "vitest";

import {
  dripArtifactSchema,
  oneCardArtifactSchema,
  oneListArtifactSchema,
} from "../../../../outbound/artifact/asMeSchema.js";
import { noFoldArtifactSchema } from "../../../../outbound/artifact/noFoldSchema.js";
import { authoredTextOf, problemReachIssue } from "../../../../outbound/artifact/problemReach.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";

const FEW = { affects: "a few", kind: "possible" } as const;

/** One text run. */
function text({ value }: { value: string }): { text: string; type: "text" } {
  return { text: value, type: "text" };
}

/** Every issue message a parse produced, or none when it passed. */
function issues({ result }: { result: { success: boolean; error?: { issues: { message: string }[] } } }): string[] {
  return result.error === undefined ? [] : result.error.issues.map((issue) => issue.message);
}

describe("problemReachIssue", () => {
  it("passes the declared word in any case, as whole words", () => {
    expect(problemReachIssue({ problem: FEW, region: "lead", topText: "A few customers cannot pay" })).toBe(undefined);
    expect(
      problemReachIssue({ problem: { affects: "one", kind: "possible" }, region: "lead", topText: "one NZ customer" }),
    ).toBe(undefined);
    expect(
      problemReachIssue({ problem: { affects: "many", kind: "possible" }, region: "lead", topText: "Many, it seems." }),
    ).toBe(undefined);
  });

  it("refuses a top that omits the word, or carries it inside another word", () => {
    expect(problemReachIssue({ problem: FEW, region: "lead", topText: "Checkout is failing" })).toContain(
      'declares a possible problem affecting "a few", and its lead does not say so',
    );
    expect(
      problemReachIssue({ problem: { affects: "one", kind: "possible" }, region: "tldr", topText: "someone noticed" }),
    ).toContain("its tldr does not say so");
  });

  it("asks nothing of a message declaring none, or declaring nothing", () => {
    expect(problemReachIssue({ problem: { kind: "none" }, region: "lead", topText: "" })).toBe(undefined);
    expect(problemReachIssue({ problem: undefined, region: "lead", topText: "" })).toBe(undefined);
  });
});

describe("authoredTextOf", () => {
  it("reads plain text and skips code, quotes and link labels", () => {
    const runs = [
      text({ value: "affects" }),
      { code: true, text: "a few", type: "text" as const },
      { quoted: true, text: "many", type: "text" as const },
      { label: "one", type: "link" as const, url: "https://example.invalid" },
      text({ value: "customers" }),
    ];
    expect(authoredTextOf({ runs })).toBe("affects customers");
  });
});

describe("every composed form checks its own top region", () => {
  it("drip: the first message, not a later one", () => {
    const schema = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 200 });
    const later = {
      kind: "drip",
      messages: [{ runs: [text({ value: "Checkout is failing." })] }, { runs: [text({ value: "A few customers." })] }],
      problem: FEW,
    };
    const first = { ...later, messages: [later.messages[1], later.messages[0]] };
    expect(issues({ result: schema.safeParse(later) })[0]).toContain("its first message does not say so");
    expect(issues({ result: schema.safeParse(first) })).toEqual([]);
  });

  it("one-card: the first line", () => {
    const schema = oneCardArtifactSchema({ cardVisibleMax: 400, maxLines: 3 });
    const card = { kind: "one-card", lines: [{ runs: [text({ value: "Checkout is failing." })] }], problem: FEW };
    expect(issues({ result: schema.safeParse(card) })[0]).toContain("its first line does not say so");
  });

  it("one-list and no-fold: the lead", () => {
    const list = oneListArtifactSchema({ cardVisibleMax: 400, maxBullets: 5, maxTrailing: 2 });
    const form = { bullets: [[text({ value: "GROW-1" })]], lead: [text({ value: "Checkout." })], problem: FEW };
    expect(issues({ result: list.safeParse({ ...form, kind: "one-list", trailing: [] }) })[0]).toContain(
      "its lead does not say so",
    );
    expect(issues({ result: noFoldArtifactSchema.safeParse({ ...form, kind: "no-fold" }) })[0]).toContain(
      "its lead does not say so",
    );
  });

  it("update: the tldr", () => {
    const card = {
      detail: [{ runs: [text({ value: "What happened." })], type: "paragraph" }],
      kind: "update",
      problem: { affects: "many", kind: "possible" },
      tldr: "Checkout is failing.",
    };
    expect(issues({ result: updateArtifactSchema.safeParse(card) })).toEqual([
      expect.stringContaining("its tldr does not say so"),
    ]);
    expect(issues({ result: updateArtifactSchema.safeParse({ ...card, tldr: "Checkout fails for many." }) })).toEqual(
      [],
    );
  });

  it("refuses a declaration outside the three words", () => {
    const schema = oneCardArtifactSchema({ cardVisibleMax: 400, maxLines: 3 });
    const card = {
      kind: "one-card",
      lines: [{ runs: [text({ value: "some customers" })] }],
      problem: { affects: "some", kind: "possible" },
    };
    expect(schema.safeParse(card).success).toBe(false);
  });
});
