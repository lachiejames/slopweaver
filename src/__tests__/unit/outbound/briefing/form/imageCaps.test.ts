/** An image block's encoding, its per-image cap, its place in a fold and the page's total image budget. */
import { describe, expect, it } from "vitest";

import { IMAGE_MAX_BYTES, IMAGE_TOTAL_MAX_BYTES } from "../../../../../briefing/caps.js";
import { pageImageBytes } from "../../../../../outbound/briefing/schemaWalk.js";
import type { BriefingBlock, BriefingForm } from "../../../../../outbound/briefing/types.js";
import { dataUriOfBytes, FORM, text, withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the briefing form's image caps", () => {
  /** The form with the card's `detail` replaced by a fold carrying exactly these blocks. */
  function withDetailBlocks({ blocks }: { blocks: readonly BriefingBlock[] }): unknown {
    return withCard({ over: { detail: { blocks, summary: "the screenshots" } } });
  }

  it("admits a well-shaped image sitting after a paragraph in the same fold", () => {
    const blocks: readonly BriefingBlock[] = [
      { content: text({ value: "The draft, as it would post." }), kind: "para" },
      { alt: "the drafted Slack post", data: dataUriOfBytes({ bytes: 1024 }), kind: "image" },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([]);
  });

  it("refuses an image's `data` that is not a data:image/…;base64,… URI", () => {
    const blocks: readonly BriefingBlock[] = [{ alt: "a screenshot", data: "not-a-data-uri", kind: "image" }];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([
      "reactNow.teamFacing.0.detail.blocks.0.data: an image's `data` must be a `data:image/(png|jpeg|gif|webp);base64,…` " +
        "URI. Write `path` instead and let `briefing render` embed the file, or fix the encoding.",
    ]);
  });

  it("refuses one image over the per-image byte cap", () => {
    const blocks: readonly BriefingBlock[] = [
      { alt: "an oversized screenshot", data: dataUriOfBytes({ bytes: IMAGE_MAX_BYTES + 1 }), kind: "image" },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([
      `reactNow.teamFacing.0.detail.blocks.0.data: an image decodes to over the cap of ${String(IMAGE_MAX_BYTES)} bytes. ` +
        "Resize or recompress it.",
    ]);
  });

  it("admits one image exactly at the per-image byte cap", () => {
    const blocks: readonly BriefingBlock[] = [
      { alt: "a screenshot at the cap", data: dataUriOfBytes({ bytes: IMAGE_MAX_BYTES }), kind: "image" },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([]);
  });

  it("refuses an image ahead of a paragraph in the same fold — text then images, never the reverse", () => {
    const blocks: readonly BriefingBlock[] = [
      { alt: "a screenshot", data: dataUriOfBytes({ bytes: 1024 }), kind: "image" },
      { content: text({ value: "The draft, as it would post." }), kind: "para" },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([
      "reactNow.teamFacing.0.detail: an image block sits ahead of a para, list, draft or paste block in the " +
        "same fold. A card reads text then images, the way the Slack post it describes would — move every " +
        "image to the end of `blocks`.",
    ]);
  });

  it("sums decoded image bytes across every fold, cards included", () => {
    const blocks: readonly BriefingBlock[] = [
      { alt: "shot one", data: dataUriOfBytes({ bytes: 100 }), kind: "image" },
      { alt: "shot two", data: dataUriOfBytes({ bytes: 250 }), kind: "image" },
    ];

    expect(pageImageBytes({ form: withDetailBlocks({ blocks }) as BriefingForm })).toBe(350);
  });

  it("counts zero image bytes on a page carrying no image block at all", () => {
    expect(pageImageBytes({ form: FORM })).toBe(0);
  });

  it("refuses the whole page over the total image-byte budget, while every image is within its own cap", () => {
    const blocks: readonly BriefingBlock[] = [
      { alt: "shot one", data: dataUriOfBytes({ bytes: IMAGE_MAX_BYTES }), kind: "image" },
      { alt: "shot two", data: dataUriOfBytes({ bytes: IMAGE_MAX_BYTES }), kind: "image" },
      {
        alt: "shot three",
        data: dataUriOfBytes({ bytes: IMAGE_TOTAL_MAX_BYTES - 2 * IMAGE_MAX_BYTES + 1 }),
        kind: "image",
      },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([
      `form: the page embeds over the cap of ${String(IMAGE_TOTAL_MAX_BYTES)} bytes of image data, summed ` +
        "across every image. Drop one, or resize the largest.",
    ]);
  });
});
