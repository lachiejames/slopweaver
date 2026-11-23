/** A fold may hold a fold one level down, carrying every block kind, and no deeper. */
import { describe, expect, it } from "vitest";

import { withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("a fold may hold a fold, to a bounded depth", () => {
  /** A fold carrying one paragraph, wrapped in `depth` further folds. */
  function nested({ depth }: { depth: number }): unknown {
    let fold: unknown = {
      blocks: [{ content: [{ kind: "text", text: "The deepest line." }], kind: "para" }],
      summary: "deepest",
    };
    for (let level = 0; level < depth; level += 1) {
      fold = { blocks: [{ fold, kind: "fold" }], summary: `level ${String(level)}` };
    }
    return fold;
  }

  /** One block of each kind the fold vocabulary admits, keyed by its own discriminator. */
  const EVERY_BLOCK_KIND = [
    { content: [{ kind: "text", text: "A paragraph." }], kind: "para" },
    { items: [[{ kind: "text", text: "one" }]], kind: "list", ordered: true },
    { alt: "a screenshot", data: "data:image/png;base64,AA==", kind: "image" },
    { kind: "draft", surface: "slack-as-me", text: "A drafted line." },
    { kind: "paste", label: "the scopes", text: "one,two" },
  ] as const;

  it("admits every block kind one fold down, not only at the top level", () => {
    const refused = EVERY_BLOCK_KIND.filter(
      (block) =>
        refusals({
          form: withCard({
            over: {
              detail: {
                blocks: [{ fold: { blocks: [block], summary: "inner" }, kind: "fold" }],
                summary: "outer",
              } as never,
            },
          }),
        }).length > 0,
    ).map((block) => block.kind);

    expect(refused).toEqual([]);
  });

  it("admits a fold nested one level inside a card's own fold", () => {
    expect(refusals({ form: withCard({ over: { detail: nested({ depth: 1 }) as never } }) })).toEqual([]);
  });

  it("refuses a third level, so a reader never clicks four times to reach a sentence", () => {
    expect(refusals({ form: withCard({ over: { detail: nested({ depth: 2 }) as never } }) })).toEqual([
      "reactNow.teamFacing.0.detail.blocks.0.fold.blocks.0.kind: Invalid discriminator value. " +
        "Expected 'para' | 'list' | 'image' | 'draft' | 'paste'",
    ]);
  });
});
