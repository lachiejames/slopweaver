import { describe, expect, it } from "vitest";

import {
  BULLET_ITEM_VISIBLE_MAX,
  DETAIL_PROSE_VISIBLE_MAX,
  INDEX_ITEM_VISIBLE_MAX,
  INDEX_MAX_ITEMS,
  PARAGRAPH_VISIBLE_MAX,
  STRUCTURE_REQUIRED_VISIBLE_THRESHOLD,
  TABLE_CELL_VISIBLE_MAX,
  TLDR_VISIBLE_MAX,
  updateArtifactSchema,
} from "../../../../outbound/artifact/schema.js";
import { TRUNCATED_SEND_ESCAPE } from "../../../../outbound/artifact/truncatedSendHatch.js";
import { withLiveGrant } from "../../../hatchGrantFixture.js";

/** A valid baseline; each test perturbs exactly one thing so the failure is unambiguous. */
function validForm(): Record<string, unknown> {
  return {
    citations: [],
    detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
    kind: "update",
    media: [],
    tldr: "A short lead.",
  };
}

/** Every issue message from a failed parse, so a test can assert the whole set at once. */
function messagesFor({ form }: { form: Record<string, unknown> }): readonly string[] {
  const parsed = updateArtifactSchema.safeParse(form);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map((issue) => issue.message);
}

describe("updateArtifactSchema — the happy path", () => {
  it("accepts a minimal update and defaults citations and media to empty", () => {
    const parsed = updateArtifactSchema.safeParse({
      detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
      kind: "update",
      tldr: "A short lead.",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data!.citations).toEqual([]);
    expect(parsed.data!.media).toEqual([]);
  });

  it("accepts a `group` run, which is what addressing a whole team looks like in this vocabulary", () => {
    const parsed = updateArtifactSchema.safeParse({
      detail: [{ runs: [{ handle: "engineers", type: "group" }], type: "paragraph" }],
      kind: "update",
      tldr: "A short lead.",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data!.detail[0]).toEqual({ runs: [{ handle: "engineers", type: "group" }], type: "paragraph" });
  });

  it("rejects a `group` run with an empty handle, which could only ever render as a bare @", () => {
    const parsed = updateArtifactSchema.safeParse({
      detail: [{ runs: [{ handle: "", type: "group" }], type: "paragraph" }],
      kind: "update",
      tldr: "A short lead.",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts zero citations — they are ADVISORY, never a schema requirement", () => {
    const parsed = updateArtifactSchema.safeParse(validForm());

    expect(parsed.success).toBe(true);
    expect(parsed.data!.citations.length).toBe(0);
  });
});

describe("updateArtifactSchema — detail is required", () => {
  it("rejects an empty detail sequence, because a card that does not fold was rejected by eye", () => {
    expect(messagesFor({ form: { ...validForm(), detail: [] } }).length).toBeGreaterThan(0);
  });

  it("names the REASON, the minimum and the JSON path instead of leaking raw Zod", () => {
    // `.min(1)` alone said "Too small: expected array to have >=1 items", which tells an author nothing
    // about why a card needs a sixth block. The reason it now gives is that the `Details` label must point
    // at something — NOT the block-count fold rule it used to cite, which a three-block attachment refuted
    // once. It also names the form to use when there genuinely is nothing to put below.
    const messages = messagesFor({ form: { ...validForm(), detail: [] } }).join("\n");

    expect(messages).toContain("detail is 0 sub-blocks, under the minimum of 1");
    expect(messages).toContain("a card's `Details` label must point at something");
    expect(messages).toContain('`{"kind":"no-fold"}`');
    expect(messages).toContain("detail[0]");
    expect(messages).not.toContain("Too small");
  });
});

describe("updateArtifactSchema — the measured caps", () => {
  it("accepts a TL;DR exactly at the cap and rejects one character more", () => {
    expect(updateArtifactSchema.safeParse({ ...validForm(), tldr: "x".repeat(TLDR_VISIBLE_MAX) }).success).toBe(true);
    expect(messagesFor({ form: { ...validForm(), tldr: "x".repeat(TLDR_VISIBLE_MAX + 1) } })).toContain(
      `tldr is ${String(TLDR_VISIBLE_MAX + 1)} visible chars, over the ${String(TLDR_VISIBLE_MAX)} cap`,
    );
  });

  it("rejects a paragraph over the cap — the 1091-char wall must be unexpressible", () => {
    const form = {
      ...validForm(),
      detail: [{ runs: [{ text: "x".repeat(PARAGRAPH_VISIBLE_MAX + 1), type: "text" }], type: "paragraph" }],
    };

    expect(messagesFor({ form })).toContain(
      `paragraph is ${String(PARAGRAPH_VISIBLE_MAX + 1)} visible chars, over the ${String(PARAGRAPH_VISIBLE_MAX)} cap`,
    );
  });

  it("does NOT count a link's URL against a paragraph cap", () => {
    const form = {
      ...validForm(),
      detail: [
        {
          runs: [
            { text: "x".repeat(PARAGRAPH_VISIBLE_MAX - 2), type: "text" },
            { label: "ab", type: "link", url: `https://example.invalid/${"u".repeat(400)}` },
          ],
          type: "paragraph",
        },
      ],
    };

    expect(updateArtifactSchema.safeParse(form).success).toBe(true);
  });

  it("requires a bullets or table sub-block once prose passes the structure threshold", () => {
    const half = Math.ceil((STRUCTURE_REQUIRED_VISIBLE_THRESHOLD + 10) / 2);
    const proseOnly = {
      ...validForm(),
      detail: [
        { runs: [{ text: "x".repeat(half), type: "text" }], type: "paragraph" },
        { runs: [{ text: "y".repeat(half), type: "text" }], type: "paragraph" },
      ],
    };

    expect(messagesFor({ form: proseOnly }).join(" ")).toContain("must include a bullets or table sub-block");
  });

  it("accepts the same prose volume once a bullets sub-block breaks it up", () => {
    const half = Math.ceil((STRUCTURE_REQUIRED_VISIBLE_THRESHOLD + 10) / 2);
    const withList = {
      ...validForm(),
      detail: [
        { runs: [{ text: "x".repeat(half), type: "text" }], type: "paragraph" },
        { runs: [{ text: "y".repeat(half), type: "text" }], type: "paragraph" },
        { items: [[{ text: "a break", type: "text" }]], type: "bullets" },
      ],
    };

    expect(updateArtifactSchema.safeParse(withList).success).toBe(true);
  });

  /** Detail whose total prose (1815 chars) breaches the cap even though every paragraph is individually legal. */
  function overProseCapDetail(): readonly Record<string, unknown>[] {
    const paragraph = { runs: [{ text: "x".repeat(600), type: "text" }], type: "paragraph" };
    // The bullets block sits FIRST, so the tail-first drop removes trailing paragraphs rather than the one
    // structural block — dropping it too would trip the (unrelated) structure-required rule on what remains.
    const bullets = { items: [[{ text: "a short lead-in", type: "text" }]], type: "bullets" };
    return [bullets, paragraph, paragraph, paragraph];
  }

  it("REFUSES detail over the TOTAL prose cap by default, naming the journalled hatch", () => {
    const form = { ...validForm(), detail: overProseCapDetail() };

    expect(messagesFor({ form }).join(" ")).toContain(TRUNCATED_SEND_ESCAPE);
  });

  it("TRUNCATES detail over the TOTAL prose cap, dropping whole blocks from the tail, under a live truncated-send grant", () => {
    const form = { ...validForm(), detail: overProseCapDetail() };

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        const parsed = updateArtifactSchema.safeParse(form);

        expect(parsed.success).toBe(true);
        expect(parsed.data!.detail.map((block) => block.type)).toEqual([
          "bullets",
          "paragraph",
          "paragraph",
          "paragraph",
        ]);
      },
    });
  });

  it("names the cap in the appended warning, and never pushes the total back over it, under a live truncated-send grant", () => {
    const form = { ...validForm(), detail: overProseCapDetail() };

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        const parsed = updateArtifactSchema.safeParse(form);
        const warning = parsed.data!.detail.at(-1)!;
        const run = warning.type === "paragraph" ? warning.runs[0]! : undefined;
        const warningText = run?.type === "text" ? run.text : "";

        expect(warningText).toContain("1 item dropped");
        expect(warningText).toContain(`over the ${String(DETAIL_PROSE_VISIBLE_MAX)}-character cap`);
      },
    });
  });

  it("rejects an over-long bullet item", () => {
    const form = {
      ...validForm(),
      detail: [{ items: [[{ text: "x".repeat(BULLET_ITEM_VISIBLE_MAX + 1), type: "text" }]], type: "bullets" }],
    };

    expect(messagesFor({ form })).toContain(
      `bullet is ${String(BULLET_ITEM_VISIBLE_MAX + 1)} visible chars, over the ${String(BULLET_ITEM_VISIBLE_MAX)} cap`,
    );
  });
});

describe("updateArtifactSchema — tables are bounded structurally", () => {
  it("rejects a row whose width does not match the header", () => {
    const form = {
      ...validForm(),
      detail: [
        {
          columns: ["a", "b"],
          rows: [[[{ text: "only one", type: "text" }]]],
          type: "table",
        },
      ],
    };

    expect(messagesFor({ form })).toContain("table row 0 has 1 cells but there are 2 columns");
  });

  it("rejects an over-long cell but never bounds the table by total characters", () => {
    const form = {
      ...validForm(),
      detail: [
        {
          columns: ["a"],
          rows: [[[{ text: "x".repeat(TABLE_CELL_VISIBLE_MAX + 1), type: "text" }]]],
          type: "table",
        },
      ],
    };

    expect(messagesFor({ form })).toContain(
      `table cell is ${String(TABLE_CELL_VISIBLE_MAX + 1)} visible chars, over the ${String(TABLE_CELL_VISIBLE_MAX)} cap`,
    );
  });

  it("accepts a ten-row table, which is the size the owner asked for", () => {
    const rows = Array.from({ length: 10 }, (_, i) => [
      [{ text: `r${String(i)}`, type: "text" }],
      [{ text: "value", type: "text" }],
      [{ text: "note", type: "text" }],
    ]);
    const form = { ...validForm(), detail: [{ columns: ["a", "b", "c"], rows, type: "table" }] };

    expect(updateArtifactSchema.safeParse(form).success).toBe(true);
  });
});

describe("updateArtifactSchema — citation integrity", () => {
  it("rejects a chip pointing at a citation that does not exist", () => {
    const form = {
      ...validForm(),
      detail: [{ runs: [{ citationId: "nope", type: "citation" }], type: "paragraph" }],
    };

    expect(messagesFor({ form })).toContain('citation chip references unknown citation "nope"');
  });

  it("finds a dead chip inside a TABLE CELL, not just in prose", () => {
    const form = {
      ...validForm(),
      detail: [{ columns: ["a"], rows: [[[{ citationId: "nope", type: "citation" }]]], type: "table" }],
    };

    expect(messagesFor({ form })).toContain('citation chip references unknown citation "nope"');
  });

  it("rejects duplicate citation ids", () => {
    const citation = { id: "c1", label: "[1]", url: "https://example.invalid/a" };
    const form = { ...validForm(), citations: [citation, { ...citation, label: "[2]" }] };

    expect(messagesFor({ form })).toContain("citation ids must be unique");
  });

  it("rejects a citation label that is not [n]", () => {
    const form = {
      ...validForm(),
      citations: [{ id: "c1", label: "see here", url: "https://example.invalid/a" }],
    };

    expect(messagesFor({ form })).toContain("a citation label must look like [1]");
  });
});

describe("updateArtifactSchema — reports everything in one pass", () => {
  it("returns the TL;DR, paragraph and citation violations together", () => {
    const form = {
      citations: [],
      detail: [
        { runs: [{ text: "x".repeat(PARAGRAPH_VISIBLE_MAX + 1), type: "text" }], type: "paragraph" },
        { runs: [{ citationId: "nope", type: "citation" }], type: "paragraph" },
      ],
      kind: "update",
      media: [],
      tldr: "x".repeat(TLDR_VISIBLE_MAX + 1),
    };

    const messages = messagesFor({ form });

    expect(messages.length).toBe(3);
  });
});

describe("updateArtifactSchema — a column header may be blank", () => {
  it("accepts an empty header on a severity column", () => {
    // `.min(1)` on a header string rejected `["", "Issue", "24h", "State"]` with a raw Zod message. A
    // severity column's values (`RED`) name themselves; a header there adds a word that earns nothing.
    const form = {
      ...validForm(),
      detail: [
        {
          columns: ["", "Issue"],
          rows: [[[{ text: "RED", type: "text" }], [{ text: "NZ push tokens rejected", type: "text" }]]],
          type: "table",
        },
      ],
    };
    const parsed = updateArtifactSchema.safeParse(form);

    expect(parsed.success).toBe(true);
  });

  it("still refuses a table with NO columns at all", () => {
    // A blank header is a column that says nothing; zero columns is a table with no shape, and
    // `checkTableWidths` would then demand zero-cell rows.
    const form = { ...validForm(), detail: [{ columns: [], rows: [[[{ text: "x", type: "text" }]]], type: "table" }] };

    expect(messagesFor({ form }).length).toBeGreaterThan(0);
  });
});

describe("updateArtifactSchema — the above-the-fold index", () => {
  /** Two index lines, each well inside every cap. */
  function indexForm({ index }: { index: readonly unknown[] }): Record<string, unknown> {
    return { ...validForm(), index };
  }

  it("defaults to empty, so a pre-index form parses unchanged", () => {
    const parsed = updateArtifactSchema.safeParse(validForm());

    expect(parsed.success).toBe(true);
    expect(parsed.data!.index).toEqual([]);
  });

  it("accepts lines carrying a link, so each item is independently clickable", () => {
    const form = indexForm({
      index: [
        [
          { text: "🔴 ", type: "text" },
          { label: "KK-1770", type: "link", url: "https://example.invalid/KK-1770" },
          { text: " NZ push tokens rejected — 706/day", type: "text" },
        ],
        [
          { text: "🟢 ", type: "text" },
          { label: "CCCC-1909", type: "link", url: "https://example.invalid/CCCC-1909" },
          { text: " transition race — 0", type: "text" },
        ],
      ],
    });
    const parsed = updateArtifactSchema.safeParse(form);

    expect(parsed.success).toBe(true);
    expect(parsed.data!.index.length).toBe(2);
  });

  it("REFUSES a line past INDEX_MAX_ITEMS by default, naming the journalled hatch", () => {
    const line = [{ text: "one line", type: "text" }];
    const form = indexForm({ index: Array.from({ length: INDEX_MAX_ITEMS + 1 }, () => line) });

    expect(messagesFor({ form }).join(" ")).toContain(TRUNCATED_SEND_ESCAPE);
  });

  it("TRUNCATES a line past INDEX_MAX_ITEMS, keeping the index at INDEX_MAX_ITEMS with a +N-more line in place of the rest, under a live truncated-send grant", () => {
    const line = [{ text: "one line", type: "text" }];
    const form = indexForm({ index: Array.from({ length: INDEX_MAX_ITEMS + 1 }, () => line) });

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        const parsed = updateArtifactSchema.safeParse(form);

        expect(parsed.success).toBe(true);
        expect(parsed.data!.index.length).toBe(INDEX_MAX_ITEMS);
        const lastLine = parsed.data!.index.at(-1)!;
        const run = lastLine[0]!;
        expect(run.type === "text" ? run.text : "").toBe("⚠️ +2 more, truncated over the above-the-fold cap");
      },
    });
  });

  it("accepts exactly INDEX_MAX_ITEMS lines", () => {
    const line = [{ text: "one line", type: "text" }];
    const form = indexForm({ index: Array.from({ length: INDEX_MAX_ITEMS }, () => line) });

    expect(updateArtifactSchema.safeParse(form).success).toBe(true);
  });

  it("rejects a line that is prose rather than a one-liner, naming the cap and the path", () => {
    const form = indexForm({ index: [[{ text: "x".repeat(INDEX_ITEM_VISIBLE_MAX + 1), type: "text" }]] });

    expect(messagesFor({ form })).toContain(
      `index line 0 is ${String(INDEX_ITEM_VISIBLE_MAX + 1)} visible chars, over the ` +
        `${String(INDEX_ITEM_VISIBLE_MAX)} cap — an index line is a scannable one-liner, and the ` +
        "substance belongs in the detail below the fold.",
    );
  });

  it("charges a link only its label, so a long URL costs an index line nothing", () => {
    const form = indexForm({
      index: [
        [
          {
            label: "x".repeat(INDEX_ITEM_VISIBLE_MAX),
            type: "link",
            url: `https://example.invalid/${"q".repeat(400)}`,
          },
        ],
      ],
    });

    expect(updateArtifactSchema.safeParse(form).success).toBe(true);
  });

  it("REFUSES the WHOLE region over cap by default, so per-line caps cannot be stacked into a wall", () => {
    // INDEX_MAX_ITEMS maximal lines pass every per-line check and still total 1080 + a tldr, past the region cap.
    const line = [{ text: "x".repeat(INDEX_ITEM_VISIBLE_MAX), type: "text" }];
    const form = {
      ...validForm(),
      index: Array.from({ length: INDEX_MAX_ITEMS }, () => line),
      tldr: "x".repeat(TLDR_VISIBLE_MAX),
    };

    expect(messagesFor({ form }).join(" ")).toContain(TRUNCATED_SEND_ESCAPE);
  });

  it("TRUNCATES the WHOLE region under a live truncated-send grant", () => {
    const line = [{ text: "x".repeat(INDEX_ITEM_VISIBLE_MAX), type: "text" }];
    const form = {
      ...validForm(),
      index: Array.from({ length: INDEX_MAX_ITEMS }, () => line),
      tldr: "x".repeat(TLDR_VISIBLE_MAX),
    };

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        const parsed = updateArtifactSchema.safeParse(form);

        expect(parsed.success).toBe(true);
        // 180 + 7x120 plus the warning line fits 1080; an eighth maximal line would not.
        expect(parsed.data!.index.length).toBe(8);
        const lastLine = parsed.data!.index.at(-1)!;
        const run = lastLine[0]!;
        expect(run.type === "text" ? run.text : "").toContain("truncated over the above-the-fold cap");
      },
    });
  });

  it("counts the tldr against the region: a shorter lead needs no truncation and always succeeds", () => {
    // 9x104 + 144 = 1080, exactly the region cap.
    const line = [{ text: "x".repeat(104), type: "text" }];
    const index = Array.from({ length: INDEX_MAX_ITEMS }, () => line);
    const fits = updateArtifactSchema.safeParse({ ...validForm(), index, tldr: "x".repeat(144) });

    expect(fits.success).toBe(true);
    expect(fits.data!.index.length).toBe(INDEX_MAX_ITEMS);
  });

  it("a longer tldr pushes the region over cap and REFUSES by default, naming the journalled hatch", () => {
    const line = [{ text: "x".repeat(104), type: "text" }];
    const index = Array.from({ length: INDEX_MAX_ITEMS }, () => line);
    const form = { ...validForm(), index, tldr: "x".repeat(145) };

    expect(messagesFor({ form }).join(" ")).toContain(TRUNCATED_SEND_ESCAPE);
  });

  it("a longer tldr TRUNCATES (dropping a line) under a live truncated-send grant", () => {
    const line = [{ text: "x".repeat(104), type: "text" }];
    const index = Array.from({ length: INDEX_MAX_ITEMS }, () => line);
    const form = { ...validForm(), index, tldr: "x".repeat(145) };

    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        const overflows = updateArtifactSchema.safeParse(form);

        expect(overflows.success).toBe(true);
        expect(overflows.data!.index.length).toBe(INDEX_MAX_ITEMS);
        expect(overflows.data!.index.at(-1)!.length).toBe(1);
        const overflowLastRun = overflows.data!.index.at(-1)![0]!;
        expect(overflowLastRun.type === "text" ? overflowLastRun.text : "").toContain("truncated");
      },
    });
  });

  it("catches a dead citation chip in an index line, which the renderer would otherwise THROW on", () => {
    const form = indexForm({ index: [[{ citationId: "nope", type: "citation" }]] });

    expect(messagesFor({ form })).toContain('citation chip references unknown citation "nope"');
  });
});

/**
 * Truncating away the prose-cap overage can still leave a genuine, UNRELATED shape problem: prose past
 * {@link STRUCTURE_REQUIRED_VISIBLE_THRESHOLD} with no bullets/table break. That rule is not truncation's to
 * fix — dropping a paragraph does not add structure. By DEFAULT this never even gets that far: the
 * over-the-prose-cap refusal fires first and short-circuits every later `.superRefine()` (Zod does not run a
 * refinement after an earlier effect in the same chain already added an issue), so the caller sees one
 * message, not two, and has to fix the cap overage before ever learning about the structure problem. Only
 * once a live truncated-send grant lets truncation actually apply does the structure check run at all
 * — on whatever truncation left behind — and it still refuses, because dropping a paragraph does not add
 * structure. (Counting itself — that a link's label counts and a table/index does not — is covered directly
 * by `visibleLength.test.ts`, which is what this used to re-test via the refusal message before that message
 * moved into a warning.)
 */
describe("truncation does not paper over an unrelated structure problem", () => {
  function overCapForm(): Record<string, unknown> {
    return {
      citations: [],
      detail: Array.from({ length: 4 }, () => ({
        runs: [{ text: "p".repeat(600), type: "text" as const }],
        type: "paragraph" as const,
      })),
      kind: "update" as const,
      media: [],
      tldr: "Over the detail cap.",
    };
  }

  it("refuses for the cap overage by default, before the structure check ever runs", () => {
    const messages = messagesFor({ form: overCapForm() });

    expect(messages.join(" ")).toContain(TRUNCATED_SEND_ESCAPE);
    expect(messages.length).toBe(1);
  });

  it("still refuses for the UNRELATED structure problem once truncation applies, under a live truncated-send grant", () => {
    withLiveGrant({
      hatchIds: ["truncated-send"],
      run: () => {
        expect(messagesFor({ form: overCapForm() }).join(" ")).toContain("must include a bullets or table sub-block");
      },
    });
  });
});
