/**
 * The shared slotting that puts a paste back, as the C3 renderer drives it: a key may render more than once, so a
 * paste names which occurrence it followed, and an edit that drops that occurrence or that key still keeps the paste.
 * The criterion itself is tested beside the frozen reader that first carried it (`./legacy/pastedMedia.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { joinWithPasted, type PastedMediaBlock } from "../../../../outbound/github/pastedMedia.js";

/** The keys a block can carry here, in render order. */
const KEY_ORDER = ["head", "check", "tail"] as const;

/** A body whose `check` key renders twice, as a layout-1 description's check paragraphs do. */
const BLOCKS = [
  { key: "head", text: "H" },
  { key: "check", text: "C1" },
  { key: "check", text: "C2" },
  { key: "tail", text: "T" },
] as const;

/** One paste after the `occurrence`-th block keyed `after`. */
function after({
  key,
  occurrence,
  raw,
}: {
  key: (typeof KEY_ORDER)[number];
  occurrence: number;
  raw: string;
}): PastedMediaBlock<(typeof KEY_ORDER)[number]> {
  return { after: key, occurrence, raw };
}

describe("joinWithPasted — occurrence-keyed", () => {
  it("puts a paste after the exact occurrence of its key", () => {
    const pasted = [after({ key: "check", occurrence: 1, raw: "X" }), after({ key: "check", occurrence: 2, raw: "Y" })];
    expect(joinWithPasted({ blocks: BLOCKS, keyOrder: KEY_ORDER, pasted })).toBe("H\n\nC1\n\nX\n\nC2\n\nY\n\nT");
  });

  it("puts a paste after its key's last occurrence when an edit removed the one it followed", () => {
    const pasted = [after({ key: "check", occurrence: 3, raw: "X" })];
    expect(joinWithPasted({ blocks: BLOCKS, keyOrder: KEY_ORDER, pasted })).toBe("H\n\nC1\n\nC2\n\nX\n\nT");
  });

  it("puts a paste after the nearest earlier key when an edit removed every block of its own", () => {
    const blocks = BLOCKS.filter((block) => block.key !== "check");
    const pasted = [after({ key: "check", occurrence: 1, raw: "X" })];
    expect(joinWithPasted({ blocks, keyOrder: KEY_ORDER, pasted })).toBe("H\n\nX\n\nT");
  });

  it("puts a paste opening the body first, and joins the blocks alone when nothing was pasted", () => {
    expect(joinWithPasted({ blocks: BLOCKS, keyOrder: KEY_ORDER, pasted: [{ after: "start", raw: "S" }] })).toBe(
      "S\n\nH\n\nC1\n\nC2\n\nT",
    );
    expect(joinWithPasted({ blocks: BLOCKS, keyOrder: KEY_ORDER, pasted: [] })).toBe("H\n\nC1\n\nC2\n\nT");
  });
});
