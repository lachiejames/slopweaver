/**
 * `annotateImage` — boxes and notes drawn onto an EXISTING PNG through real Jimp, read back pixel by pixel: no pixel
 * inside any box changes, a frame sits outside each, a numbered badge sits beside each when there are several, and the
 * notes come back as the font printed them.
 */
import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { HIGHLIGHT_COLOR, HIGHLIGHT_OFFSET_PX, HIGHLIGHT_STROKE_PX } from "../../../visualEvidence/annotate.js";
import { annotateImage, BADGE_SIZE_PX, badgePlacement } from "../../../visualEvidence/annotateExisting.js";

const WHITE = 0xffffffff;
const GREY = 0x808080ff;

/** A 200x200 white PNG with a grey square at 20,60 40x40 and another at 62,60 40x40 — evidence to protect. */
async function sourcePng(): Promise<Uint8Array> {
  const image = new Jimp({ color: WHITE, height: 200, width: 200 });
  for (const left of [20, 62]) {
    for (let y = 60; y < 100; y += 1) {
      for (let x = left; x < left + 40; x += 1) {
        image.setPixelColor(GREY, x, y);
      }
    }
  }
  return new Uint8Array(await image.getBuffer("image/png"));
}

/** Decode PNG bytes for reading pixels back. */
async function decode({ bytes }: { bytes: Uint8Array }): Promise<Awaited<ReturnType<typeof Jimp.fromBuffer>>> {
  return Jimp.fromBuffer(Buffer.from(bytes));
}

const LEFT_BOX = { height: 40, width: 40, x: 20, y: 60 };
const RIGHT_BOX = { height: 40, width: 40, x: 62, y: 60 };

describe("annotateImage", () => {
  it("frames one box outside its edge, leaves its interior untouched, and appends the bare note below", async () => {
    const bytes = await sourcePng();

    const drawn = unwrap(await annotateImage({ annotations: [{ note: "the failing check", rect: LEFT_BOX }], bytes }));
    const out = await decode({ bytes: drawn.bytes });

    expect(out.width).toBe(200);
    expect(out.height).toBeGreaterThan(200);
    expect(drawn.artifact.widthPx).toBe(200);
    expect(drawn.artifact.heightPx).toBe(out.height);
    expect(out.getPixelColor(20, 60)).toBe(GREY);
    expect(out.getPixelColor(59, 99)).toBe(GREY);
    expect(out.getPixelColor(20 - HIGHLIGHT_OFFSET_PX - 1, 80)).toBe(HIGHLIGHT_COLOR);
    expect(out.getPixelColor(20 - HIGHLIGHT_OFFSET_PX - HIGHLIGHT_STROKE_PX, 80)).toBe(HIGHLIGHT_COLOR);
    expect(out.getPixelColor(20 - HIGHLIGHT_OFFSET_PX + 1, 80)).toBe(WHITE);
    expect(drawn.annotations).toEqual([{ note: "the failing check", rect: LEFT_BOX }]);
    expect(drawn.ops.map((op) => op.kind)).toEqual(["highlight", "caption"]);
    expect(drawn.ops[1]).toMatchObject({ kind: "caption", lines: ["the failing check"] });
  });

  it("keeps a translucent pixel inside a box exactly as it was, rather than blending it onto the caption's white", async () => {
    const image = new Jimp({ color: WHITE, height: 200, width: 200 });
    const translucent = 0x00000080;
    image.setPixelColor(translucent, 30, 70);
    const bytes = new Uint8Array(await image.getBuffer("image/png"));

    const drawn = unwrap(await annotateImage({ annotations: [{ note: "half see-through", rect: LEFT_BOX }], bytes }));
    const out = await decode({ bytes: drawn.bytes });

    expect(out.getPixelColor(30, 70)).toBe(translucent);
  });

  it("refuses a 16-bit PNG rather than rounding every pixel inside its boxes to 8 bits", async () => {
    const bytes = await sourcePng();
    expect(bytes[24]).toBe(8);
    bytes[24] = 16;

    const refused = unwrapErr(await annotateImage({ annotations: [{ note: "deep", rect: LEFT_BOX }], bytes }));

    expect(refused.code).toBe("ANNOTATIONS_REFUSED");
    expect(refused.message).toContain("16-bit PNG");
  });

  it("numbers several boxes, in the caption and in a red badge beside each, and never paints one box's frame into the other", async () => {
    const bytes = await sourcePng();

    const drawn = unwrap(
      await annotateImage({
        annotations: [
          { note: "first", rect: LEFT_BOX },
          { note: "second", rect: RIGHT_BOX },
        ],
        bytes,
      }),
    );
    const out = await decode({ bytes: drawn.bytes });

    // The right box's frame would run x 54..61, through the left box's interior; every one of those stays grey.
    for (let x = 54; x < 60; x += 1) {
      expect(out.getPixelColor(x, 80)).toBe(GREY);
    }
    expect(out.getPixelColor(62, 80)).toBe(GREY);
    expect(drawn.ops.at(-1)).toMatchObject({ kind: "caption", lines: ["1. first", "2. second"] });
    const leftBadge = badgePlacement({ height: 200, protect: [LEFT_BOX, RIGHT_BOX], rect: LEFT_BOX, width: 200 })!;
    expect(leftBadge).toEqual({ height: BADGE_SIZE_PX, width: BADGE_SIZE_PX, x: 12, y: 16 });
    expect(out.getPixelColor(leftBadge.x, leftBadge.y)).toBe(HIGHLIGHT_COLOR);
    expect(out.getPixelColor(leftBadge.x + BADGE_SIZE_PX - 1, leftBadge.y + BADGE_SIZE_PX - 1)).toBe(HIGHLIGHT_COLOR);
  });

  it("returns each note as the font printed it, so a record names the words a reader sees", async () => {
    const drawn = unwrap(
      await annotateImage({ annotations: [{ note: "Sep 13 – Oct 21", rect: LEFT_BOX }], bytes: await sourcePng() }),
    );

    expect(drawn.annotations).toEqual([{ note: "Sep 13 - Oct 21", rect: LEFT_BOX }]);
  });

  it("refuses a box running past the picture, naming it, before drawing anything", async () => {
    const error = unwrapErr(
      await annotateImage({
        annotations: [{ note: "off the edge", rect: { height: 10, width: 20, x: 190, y: 0 } }],
        bytes: await sourcePng(),
      }),
    );

    expect(error.code).toBe("ANNOTATIONS_REFUSED");
    expect(error.message).toBe("annotations.0: the box 20x10 at 190,0 runs past the 200x200 picture");
  });

  it("refuses no boxes, and refuses five", async () => {
    const bytes = await sourcePng();
    const box = { note: "x", rect: { height: 5, width: 5, x: 0, y: 0 } };

    const none = unwrapErr(await annotateImage({ annotations: [], bytes }));
    const five = unwrapErr(await annotateImage({ annotations: [box, box, box, box, box], bytes }));

    expect(none.message).toBe("an annotated picture needs at least one box");
    expect(five.code).toBe("ANNOTATIONS_REFUSED");
    expect(five.message).toBe("a picture may carry at most 4 boxes, one caption line each, got 5");
  });

  it("refuses several boxes when one has no room for its number beside it", async () => {
    const whole = { height: 200, width: 200, x: 0, y: 0 };

    const error = unwrapErr(
      await annotateImage({
        annotations: [
          { note: "everything", rect: whole },
          { note: "the left square", rect: LEFT_BOX },
        ],
        bytes: await sourcePng(),
      }),
    );

    expect(error.code).toBe("ANNOTATIONS_REFUSED");
    expect(error.message).toContain("box 1 has no room for its number");
  });

  it("answers the typed decode error for a PNG cut short", async () => {
    const truncated = (await sourcePng()).slice(0, 40);

    const error = unwrapErr(await annotateImage({ annotations: [{ note: "x", rect: LEFT_BOX }], bytes: truncated }));

    expect(error.code).toBe("UNDECODABLE");
  });

  it("refuses a source that is not a PNG, since Jimp would round any deeper format to 8 bits", async () => {
    const jpeg = new Uint8Array(await new Jimp({ color: WHITE, height: 200, width: 200 }).getBuffer("image/jpeg"));

    const refused = unwrapErr(await annotateImage({ annotations: [{ note: "x", rect: LEFT_BOX }], bytes: jpeg }));

    expect(refused.code).toBe("ANNOTATIONS_REFUSED");
    expect(refused.message).toContain("the source is not a PNG");
  });
});
