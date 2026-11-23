/**
 * `fold-caps`' pure reshape: what it joins, what it refuses to touch, and the two things it must never do —
 * change a word, or drop a key.
 */
import { describe, expect, it } from "vitest";

import { FOLD_MAX_BLOCKS } from "../../../briefing/caps.js";
import { reshapeFormFolds } from "../../../briefing/foldCaps.js";

/** One paragraph block carrying `text`. */
function para({ text }: { text: string }): Record<string, unknown> {
  return { content: [{ kind: "text", text }], kind: "para" };
}

/** One unordered list block, one item per string. */
function list({ items }: { items: readonly string[] }): Record<string, unknown> {
  return { items: items.map((text) => [{ kind: "text", text }]), kind: "list", ordered: false };
}

/** A form whose one `recent` note carries `blocks` in its fold. */
function formWith({ blocks }: { blocks: readonly unknown[] }): Record<string, unknown> {
  return {
    recent: [{ detail: { blocks, summary: "the fold" }, headline: [{ kind: "text", text: "a headline" }] }],
  };
}

/** The blocks of the reshaped form's one recent fold. */
function blocksOf({ form }: { form: unknown }): readonly unknown[] {
  const recent = (form as { recent: readonly { detail: { blocks: readonly unknown[] } }[] }).recent;
  return recent[0]!.detail.blocks;
}

describe("reshapeFormFolds", () => {
  it("leaves a fold at the cap exactly as it was", () => {
    const blocks = [para({ text: "A." }), para({ text: "B." }), para({ text: "C." }), para({ text: "D." })];
    const result = reshapeFormFolds({ form: formWith({ blocks }) });

    expect(result.reshaped).toEqual([]);
    expect(result.unshapeable).toEqual([]);
    expect(blocksOf({ form: result.form })).toEqual(blocks);
  });

  it("joins one run of five paragraphs into a single list, in order, keeping every run", () => {
    const result = reshapeFormFolds({
      form: formWith({
        blocks: [
          para({ text: "A." }),
          para({ text: "B." }),
          para({ text: "C." }),
          para({ text: "D." }),
          para({ text: "E." }),
        ],
      }),
    });

    expect(result.reshaped).toEqual([{ after: 1, before: 5, path: "recent.0.detail" }]);
    expect(blocksOf({ form: result.form })).toEqual([list({ items: ["A.", "B.", "C.", "D.", "E."] })]);
  });

  it("joins paragraphs and unordered lists that sit together, keeping each list's own items", () => {
    const result = reshapeFormFolds({
      form: formWith({
        blocks: [
          para({ text: "A." }),
          list({ items: ["B.", "C."] }),
          para({ text: "D." }),
          para({ text: "E." }),
          para({ text: "F." }),
        ],
      }),
    });

    expect(blocksOf({ form: result.form })).toEqual([list({ items: ["A.", "B.", "C.", "D.", "E.", "F."] })]);
  });

  it("never merges an ORDERED list, whose numbering is part of what it says", () => {
    const ordered = { items: [[{ kind: "text", text: "first" }]], kind: "list", ordered: true };
    const result = reshapeFormFolds({
      form: formWith({
        blocks: [para({ text: "A." }), para({ text: "B." }), ordered, para({ text: "C." }), para({ text: "D." })],
      }),
    });

    expect(blocksOf({ form: result.form })).toEqual([
      list({ items: ["A.", "B."] }),
      ordered,
      list({ items: ["C.", "D."] }),
    ]);
  });

  it("leaves a candidate carrying a key of its own alone, because merging it would drop that key", () => {
    const extra = { content: [{ kind: "text", text: "A." }], extra: "KEEP", kind: "para" };
    const result = reshapeFormFolds({
      form: formWith({
        blocks: [extra, para({ text: "B." }), para({ text: "C." }), para({ text: "D." }), para({ text: "E." })],
      }),
    });

    expect(blocksOf({ form: result.form })).toEqual([extra, list({ items: ["B.", "C.", "D.", "E."] })]);
  });

  it("reports a fold it cannot bring under the cap, and leaves that fold untouched", () => {
    const image = { alt: "a", data: "data:image/png;base64,AA==", kind: "image" };
    const blocks = [image, image, image, image, image];
    const result = reshapeFormFolds({ form: formWith({ blocks }) });

    expect(result.reshaped).toEqual([]);
    expect(result.unshapeable).toEqual([{ after: 5, before: 5, path: "recent.0.detail" }]);
    expect(blocksOf({ form: result.form })).toEqual(blocks);
  });

  it("repairs a nested fold under a parent that is itself within the cap", () => {
    const nested = {
      fold: {
        blocks: [
          para({ text: "A." }),
          para({ text: "B." }),
          para({ text: "C." }),
          para({ text: "D." }),
          para({ text: "E." }),
        ],
        summary: "the nested fold",
      },
      kind: "fold",
    };
    const result = reshapeFormFolds({ form: formWith({ blocks: [para({ text: "top." }), nested] }) });

    expect(result.reshaped).toEqual([{ after: 1, before: 5, path: "recent.0.detail.blocks.1.fold" }]);
    expect(blocksOf({ form: result.form })).toEqual([
      para({ text: "top." }),
      { fold: { blocks: [list({ items: ["A.", "B.", "C.", "D.", "E."] })], summary: "the nested fold" }, kind: "fold" },
    ]);
  });

  it("reaches earlierToday, history and the alignment fold, and leaves cards alone", () => {
    const over = [
      para({ text: "A." }),
      para({ text: "B." }),
      para({ text: "C." }),
      para({ text: "D." }),
      para({ text: "E." }),
    ];
    const card = { detail: { blocks: over, summary: "a card fold" }, question: "is it?" };
    const result = reshapeFormFolds({
      form: {
        alignment: { detail: { blocks: over, summary: "alignment" }, headline: [] },
        earlierToday: { notes: [{ detail: { blocks: over, summary: "note" }, headline: [] }], summary: "earlier" },
        history: [{ notes: [{ detail: { blocks: over, summary: "old" }, headline: [] }], summary: "history" }],
        reactNow: { meFacing: [card], teamFacing: [] },
      },
    });

    expect(result.reshaped.map((fold) => fold.path)).toEqual([
      "earlierToday.notes.0.detail",
      "history.0.notes.0.detail",
      "alignment.detail",
    ]);
    expect((result.form as { reactNow: { meFacing: readonly unknown[] } }).reactNow.meFacing).toEqual([card]);
  });

  it("is idempotent: a reshaped form reshapes again to itself", () => {
    const once = reshapeFormFolds({
      form: formWith({
        blocks: [
          para({ text: "A." }),
          para({ text: "B." }),
          para({ text: "C." }),
          para({ text: "D." }),
          para({ text: "E." }),
        ],
      }),
    });
    const twice = reshapeFormFolds({ form: once.form });

    expect(twice.reshaped).toEqual([]);
    expect(twice.form).toEqual(once.form);
  });

  it("changes no word: a long paragraph and a multi-sentence item survive the join exactly", () => {
    const long = para({ text: "1. One sentence that runs on and on and on. And a second. And a third. And a fourth." });
    const result = reshapeFormFolds({
      form: formWith({
        blocks: [long, para({ text: "B." }), para({ text: "C." }), para({ text: "D." }), para({ text: "E." })],
      }),
    });
    const merged = blocksOf({ form: result.form })[0] as { items: readonly unknown[] };

    expect(merged.items[0]).toEqual(long["content"]);
    expect(FOLD_MAX_BLOCKS).toBe(4);
  });

  it("answers a value that is not a form with that value, untouched", () => {
    const result = reshapeFormFolds({ form: 42 });

    expect(result.form).toBe(42);
    expect(result.reshaped).toEqual([]);
  });
});
