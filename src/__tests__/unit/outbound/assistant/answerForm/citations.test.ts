/*
 * Citations, the ranked index that may cite them, and the citation budget: a chip names a defined citation and
 * every citation is cited, the index refuses past its cap unless a truncated-send grant is live, and the budget
 * grows with the answer's own item count.
 */
import { describe, expect, it } from "vitest";

import { INDEX_MAX_ITEMS, TABLE_MAX_ROWS } from "../../../../../outbound/artifact/schema.js";
import { TRUNCATED_SEND_ESCAPE } from "../../../../../outbound/artifact/truncatedSendHatch.js";
import { answerFormSchema } from "../../../../../outbound/assistant/answerForm.js";
import { BODY_MAX_BLOCKS, CITATIONS_MAX } from "../../../../../outbound/assistant/contentLimits.js";
import { withLiveGrant } from "../../../../hatchGrantFixture.js";
import { VALID_ANSWER_CONVERSATION, VALID_ANSWER_VERB } from "./fixtures.js";

describe("citations — the same [n] chip mechanism the operator card uses, hardened", () => {
  it("REFUSES a citation run that names no defined citation", () => {
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      body: [{ runs: [{ citationId: "1", type: "citation" }], type: "paragraph" }],
      citations: [],
    };

    expect(answerFormSchema.safeParse(form).success).toBe(false);
  });

  it("REFUSES a defined citation that no run in body actually cites", () => {
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      body: [{ runs: [{ text: "no chip here", type: "text" }], type: "paragraph" }],
    };

    expect(answerFormSchema.safeParse(form).success).toBe(false);
  });

  it("REFUSES duplicate citation ids", () => {
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      citations: [...VALID_ANSWER_CONVERSATION.citations, { ...VALID_ANSWER_CONVERSATION.citations[0] }],
    };

    expect(answerFormSchema.safeParse(form).success).toBe(false);
  });

  it("accepts a citation with no sourceRef — no live grounding kind requires one any more", () => {
    const { sourceRef: _sourceRef, ...withoutSourceRef } = VALID_ANSWER_CONVERSATION.citations[0];
    const form = { ...VALID_ANSWER_CONVERSATION, citations: [withoutSourceRef] };

    expect(answerFormSchema.safeParse(form).success).toBe(true);
  });
});

describe("index — the operator card's own above-the-fold ranking, reused for a rich-form answer", () => {
  /** A citation referenced ONLY from `index`, never from `body` — the shape a ranked-findings card needs. */
  const RANKED_FORM = {
    ...VALID_ANSWER_CONVERSATION,
    body: [{ runs: [{ text: "no chip here", type: "text" }], type: "paragraph" }],
    citations: [{ id: "1", label: "[1]", url: "https://example.test/alert/1" }],
    index: [[{ text: "critical: 3", type: "text" }], [{ citationId: "1", type: "citation" }]],
  };

  it("accepts a citation referenced only from index, not from body", () => {
    expect(answerFormSchema.safeParse(RANKED_FORM).success).toBe(true);
  });

  it("REFUSES an index run that names no defined citation", () => {
    const form = { ...VALID_ANSWER_CONVERSATION, index: [[{ citationId: "missing", type: "citation" }]] };

    expect(answerFormSchema.safeParse(form).success).toBe(false);
  });

  it("REFUSES more index lines than INDEX_MAX_ITEMS by default, naming the journalled hatch", () => {
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      index: Array.from({ length: INDEX_MAX_ITEMS + 1 }, (_, i) => [
        { text: `line ${String(i)}`, type: "text" as const },
      ]),
    };
    const parsed = answerFormSchema.safeParse(form);

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
      TRUNCATED_SEND_ESCAPE,
    );
  });

  it("names the count it measured and the limit it broke, so the refusal is one edit", () => {
    // The dogfood defect: the refusal used to say "over the count/aggregate cap" and no figure at all, so
    // the only way to learn the budget was to grep the constant out of this module's own source mid-turn.
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      index: Array.from({ length: INDEX_MAX_ITEMS + 2 }, (_, i) => [
        { text: `line ${String(i)}`, type: "text" as const },
      ]),
    };
    const parsed = answerFormSchema.safeParse(form);

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
      `${String(INDEX_MAX_ITEMS + 2)} index lines against the INDEX_MAX_ITEMS limit of ${String(INDEX_MAX_ITEMS)}`,
    );
  });

  it("names the BODY_MAX_BLOCKS measurement on an over-long body", () => {
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      body: [
        ...VALID_ANSWER_CONVERSATION.body,
        ...Array.from({ length: BODY_MAX_BLOCKS }, (_, i) => ({
          runs: [{ text: `block ${String(i)}`, type: "text" as const }],
          type: "paragraph" as const,
        })),
      ],
    };
    const parsed = answerFormSchema.safeParse(form);

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
      `${String(BODY_MAX_BLOCKS + 1)} body blocks against the BODY_MAX_BLOCKS limit of ${String(BODY_MAX_BLOCKS)}`,
    );
  });

  it("TRUNCATES more index lines than INDEX_MAX_ITEMS, appending a +N-more line, under a live truncated-send grant", () => {
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      index: Array.from({ length: INDEX_MAX_ITEMS + 1 }, (_, i) => [
        { text: `line ${String(i)}`, type: "text" as const },
      ]),
    };

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        const parsed = answerFormSchema.safeParse(form);

        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.kind === "answer" ? parsed.data.index.length : -1).toBe(INDEX_MAX_ITEMS);
      },
    });
  });

  it("drops an orphaned citation ALONG WITH the truncated line that alone referenced it, under a live truncated-send grant", () => {
    // The last-line-chip counterexample: one index line past the cap where only the LAST carries the chip. Truncating to
    // INDEX_MAX_ITEMS drops that line (and the one before it, to leave room for the warning) — if `citations`
    // were left untouched, checkCitations would refuse this otherwise-fine answer for a citation IT orphaned.
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      body: [{ runs: [{ text: "no chip here", type: "text" as const }], type: "paragraph" as const }],
      citations: [{ id: "c1", label: "[1]", url: "https://example.test/alert/1" }],
      index: [
        ...Array.from({ length: INDEX_MAX_ITEMS }, (_, i) => [{ text: `line ${String(i)}`, type: "text" as const }]),
        [{ citationId: "c1", type: "citation" as const }],
      ],
    };

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        const parsed = answerFormSchema.safeParse(form);

        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.kind === "answer" ? parsed.data.citations : undefined).toEqual([]);
      },
    });
  });

  it("still REFUSES a citation that was ALREADY unreferenced before any truncation happened", () => {
    // Truncation must not become a laundering path for the pre-existing "unused citation" refusal: a
    // citation that was never cited in the first place is a real, unrelated authoring defect.
    const form = {
      ...VALID_ANSWER_CONVERSATION,
      citations: [{ id: "unused", label: "[1]", url: "https://example.test/alert/1" }],
      index: Array.from({ length: INDEX_MAX_ITEMS + 1 }, (_, i) => [
        { text: `line ${String(i)}`, type: "text" as const },
      ]),
    };

    expect(answerFormSchema.safeParse(form).success).toBe(false);
  });

  it("REFUSES a single index line over INDEX_ITEM_VISIBLE_MAX visible characters", () => {
    const form = { ...VALID_ANSWER_CONVERSATION, index: [[{ text: "x".repeat(121), type: "text" as const }]] };

    expect(answerFormSchema.safeParse(form).success).toBe(false);
  });

  it("defaults to an empty index when the field is omitted, so a plain prose answer is unaffected", () => {
    const parsed = answerFormSchema.safeParse(VALID_ANSWER_CONVERSATION);

    expect(parsed.success && parsed.data.kind === "answer" ? parsed.data.index : undefined).toEqual([]);
  });

  it("accepts an explicit indexStyle of plain", () => {
    const form = { ...RANKED_FORM, indexStyle: "plain" as const };

    expect(answerFormSchema.safeParse(form).success).toBe(true);
  });
});

describe("the citation budget is the answer's own item count, floored at CITATIONS_MAX", () => {
  /**
   * One citation per row, and one table row per citation, so the chip/citation hygiene rules are satisfied
   * and the only thing under test is the COUNT.
   *
   * @param rows how many rows the table carries, each citing its own source
   * @returns an `answer` form whose whole body is that table
   */
  function rankedAnswer({ rows }: { rows: number }): unknown {
    const ids = Array.from({ length: rows }, (_unused, row) => `c${String(row)}`);
    // Split across as many tables as TABLE_MAX_ROWS needs: a ranked list past ten rows is TWO blocks rather
    // than a taller table, and that is the shape the real sixteen-alert card has to take.
    const tables = Array.from({ length: Math.ceil(rows / TABLE_MAX_ROWS) }, (_unused, table) => ({
      columns: ["finding"],
      rows: ids.slice(table * TABLE_MAX_ROWS, (table + 1) * TABLE_MAX_ROWS).map((id) => [
        [
          { text: "an open alert ", type: "text" },
          { citationId: id, type: "citation" },
        ],
      ]),
      type: "table",
    }));
    return {
      ...VALID_ANSWER_VERB,
      body: tables,
      citations: ids.map((id, row) => ({
        id,
        label: `[${String(row + 1)}]`,
        url: `https://github.com/example/repo/security/dependabot/${String(row + 1)}`,
      })),
    };
  }

  it("accepts a ten-row ranked answer citing every row, which the flat cap already allowed", () => {
    expect(answerFormSchema.safeParse(rankedAnswer({ rows: 10 })).success).toBe(true);
  });

  it("accepts a SIXTEEN-row ranked answer citing every row — the shape the flat 12 refused outright", () => {
    expect(answerFormSchema.safeParse(rankedAnswer({ rows: 16 })).success).toBe(true);
  });

  it("refuses one citation more than the answer's items earn, naming both numbers", () => {
    const answer = rankedAnswer({ rows: 16 }) as { citations: { id: string; label: string; url: string }[] };
    const over = {
      ...answer,
      citations: [
        ...answer.citations,
        { id: "spare", label: "[17]", url: "https://github.com/example/repo/security/dependabot/17" },
      ],
    };
    const parsed = answerFormSchema.safeParse(over);

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message).join("\n")).toContain("17 citations, over the 16");
  });

  it("still gives a ONE-paragraph answer the full floor of twelve", () => {
    const ids = Array.from({ length: CITATIONS_MAX }, (_unused, n) => `c${String(n)}`);
    const dense = {
      ...VALID_ANSWER_VERB,
      body: [
        {
          runs: [
            { text: "Twelve sources say the same thing", type: "text" },
            ...ids.map((id) => ({ citationId: id, type: "citation" as const })),
          ],
          type: "paragraph",
        },
      ],
      citations: ids.map((id, n) => ({
        id,
        label: `[${String(n + 1)}]`,
        url: `https://example.test/source/${String(n + 1)}`,
      })),
    };

    expect(answerFormSchema.safeParse(dense).success).toBe(true);
  });
});
