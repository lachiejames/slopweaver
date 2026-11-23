/** A paste block carries the exact bytes the owner pastes, held to a byte cap and nothing else. */
import { describe, expect, it } from "vitest";

import { PASTE_MAX_BYTES } from "../../../../../briefing/caps.js";
import type { BriefingBlock } from "../../../../../outbound/briefing/types.js";
import { text, withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the briefing form's paste blocks", () => {
  /** The form with the card's `detail` replaced by a fold carrying exactly these blocks. */
  function withDetailBlocks({ blocks }: { blocks: readonly BriefingBlock[] }): unknown {
    return withCard({ over: { detail: { blocks, summary: "the scopes" } } });
  }

  it("admits a paste block carrying the exact bytes the owner pastes, with no prose rules applied to them", () => {
    const blocks: readonly BriefingBlock[] = [
      { content: text({ value: "Paste this into the scopes box." }), kind: "para" },
      {
        kind: "paste",
        label: "the 25 scopes, comma separated",
        // Every one of the three shapes `proseLine` refuses in composed prose, and none of them is this
        // schema's business: the bytes are what the owner pastes, so re-spacing them would break the paste.
        text: "1. one 2. two 3. three ...",
      },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([]);
  });

  it("admits a line the size of the 1,725-byte scope list the cap was measured against", () => {
    // `PASTE_MAX_BYTES` names the measurement and the command that reproduces it; this is the half that
    // fails if the cap is ever ratcheted below the case it was sized for.
    const line = "https://www.googleapis.com/auth/admin.directory.user.readonly,".repeat(28);

    expect(Buffer.byteLength(line, "utf8")).toBeGreaterThan(1725);
    expect(
      refusals({ form: withDetailBlocks({ blocks: [{ kind: "paste", label: "the 25 scopes", text: line }] }) }),
    ).toEqual([]);
  });

  it("refuses a paste block over the byte cap and names the cap in bytes", () => {
    const blocks: readonly BriefingBlock[] = [
      { kind: "paste", label: "too much", text: "a".repeat(PASTE_MAX_BYTES + 1) },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([
      `reactNow.teamFacing.0.detail.blocks.0.text: a paste block's text runs over the cap of ` +
        `${String(PASTE_MAX_BYTES)} bytes. A paste block is one value the owner moves into one box — link the file ` +
        "instead when it is bigger than that.",
    ]);
  });

  it("counts the cap in BYTES, not characters, so a multi-byte value cannot slip past it", () => {
    const line = "é".repeat(PASTE_MAX_BYTES / 2 + 1);

    expect(line.length).toBeLessThan(PASTE_MAX_BYTES);
    expect(
      refusals({ form: withDetailBlocks({ blocks: [{ kind: "paste", label: "two-byte", text: line }] }) }).length,
    ).toBe(1);
  });

  it("refuses a paste block with an empty label or empty text", () => {
    expect(refusals({ form: withDetailBlocks({ blocks: [{ kind: "paste", label: "", text: "x" }] }) }).length).toBe(1);
    expect(refusals({ form: withDetailBlocks({ blocks: [{ kind: "paste", label: "l", text: "" }] }) }).length).toBe(1);
  });

  it("refuses an unknown key on a paste block, the way every other block is held", () => {
    const blocks = [{ kind: "paste", label: "l", lang: "bash", text: "x" }] as unknown as readonly BriefingBlock[];

    expect(refusals({ form: withDetailBlocks({ blocks }) }).length).toBeGreaterThan(0);
  });

  it("refuses an image sitting ahead of a paste block, the same way it refuses one ahead of prose", () => {
    const blocks: readonly BriefingBlock[] = [
      { alt: "a screenshot", data: "data:image/png;base64,AA==", kind: "image" },
      { kind: "paste", label: "the scopes", text: "a,b" },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([
      "reactNow.teamFacing.0.detail: an image block sits ahead of a para, list, draft or paste block in the " +
        "same fold. A card reads text then images, the way the Slack post it describes would — move every " +
        "image to the end of `blocks`.",
    ]);
  });
});
