import { describe, expect, it } from "vitest";

import { LAYOUT } from "../../../../../outbound/github/legacy/renderLayout.js";
import { whatBlocks } from "../../../../../outbound/github/legacy/renderWhat.js";
import { FULL_BODY, MINIMAL_BODY } from "./fixtures.js";

const keysOf = ({ blocks }: { blocks: readonly { key: string }[] }): readonly string[] => blocks.map((b) => b.key);

describe("whatBlocks", () => {
  it("writes the eight mandatory blocks of a minimal body, in order", () => {
    expect(keysOf({ blocks: whatBlocks({ body: MINIMAL_BODY }) })).toEqual([
      "what-heading",
      "origin",
      "problem-heading",
      "problem",
      "change-heading",
      "change",
      "claims-heading",
      "claims",
    ]);
  });

  it("writes Problem and Change as one escaped paragraph each", () => {
    const blocks = whatBlocks({ body: MINIMAL_BODY });
    expect(blocks.find((b) => b.key === "problem")!.text).toBe("<p>A reviewer meets the table before the risk.</p>");
    expect(blocks.find((b) => b.key === "change")!.text).toBe("<p>Render the body in reading order.</p>");
  });

  it("stands the fixed sentence in for an empty claims list", () => {
    expect(whatBlocks({ body: MINIMAL_BODY }).find((b) => b.key === "claims")!.text).toBe(LAYOUT.claimsEmpty);
  });

  it("adds the witness blocks and the visible Proof section when the body carries them", () => {
    expect(keysOf({ blocks: whatBlocks({ body: FULL_BODY }) })).toEqual([
      "what-heading",
      "origin",
      "problem-heading",
      "problem",
      "change-heading",
      "change",
      "before-after-heading",
      "before-after",
      "fails-on-main",
      "claims-heading",
      "claims",
      "proof-heading",
      "proof",
    ]);
  });

  it("writes the fails-on-main witness on one line", () => {
    const text = whatBlocks({ body: FULL_BODY }).find((b) => b.key === "fails-on-main")!.text;
    expect(text).toBe(
      `${LAYOUT.failsOnMainOpen}<code>yarn vitest run render.test.ts</code>: ❌ on main at <code>f933abaa5</code>, ✅ on this branch.</p>`,
    );
  });

  it("writes a proven and a gap claim as two table rows", () => {
    const text = whatBlocks({ body: FULL_BODY }).find((b) => b.key === "claims")!.text;
    expect(text).toContain(
      "<tr><td>The body parses back.</td><td>✅ <code>yarn vitest run parse.test.ts</code></td></tr>",
    );
    expect(text).toContain("<tr><td>Old bodies convert.</td><td>⚠️ not checked: no live body was converted</td></tr>");
  });

  it("carries the day the problem was seen in the Before-and-after Where cell", () => {
    const text = whatBlocks({ body: FULL_BODY }).find((b) => b.key === "before-after")!.text;
    expect(text).toContain("pull request 1, seen 20 Sep 2026</td>");
  });
});
