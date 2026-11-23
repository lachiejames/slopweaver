import { describe, expect, it } from "vitest";

import { gradeCapture, pngDimensions } from "../../../../datadog/shot/imageCheck.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/**
 * Build a PNG header declaring a size. Only the bytes {@link pngDimensions} reads are real, which is the
 * point: this asserts the header reader, not an encoder.
 */
function pngHeader({ widthPx, heightPx }: { widthPx: number; heightPx: number }): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(widthPx, 16);
  bytes.writeUInt32BE(heightPx, 20);
  return bytes;
}

describe("pngDimensions", () => {
  it("reads the width and height a PNG's IHDR declares", () => {
    const read = pngDimensions({ bytes: pngHeader({ heightPx: 412, widthPx: 1180 }) });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read).widthPx).toBe(1180);
    expect(unwrap(read).heightPx).toBe(412);
  });

  it("refuses a truncated write rather than grading it usable", () => {
    const read = pngDimensions({ bytes: pngHeader({ heightPx: 10, widthPx: 10 }).subarray(0, 12) });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("IMAGE_UNUSABLE");
    expect(unwrapErr(read).message).toContain("truncated");
  });

  it("refuses an empty file, which a failed screenshot can leave behind", () => {
    const read = pngDimensions({ bytes: Buffer.alloc(0) });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).message).toContain("0 bytes");
  });

  it("refuses a file that is not a PNG at all", () => {
    const read = pngDimensions({ bytes: Buffer.alloc(64, 0x41) });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).message).toContain("PNG signature");
  });

  it("refuses a PNG whose first chunk is not IHDR, so no size is declared", () => {
    const bytes = pngHeader({ heightPx: 10, widthPx: 10 });
    bytes.write("IDAT", 12, "ascii");
    const read = pngDimensions({ bytes });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).message).toContain("IHDR");
  });
});

describe("gradeCapture", () => {
  it("passes a capture with a real area and real bytes", () => {
    const graded = gradeCapture({ byteLength: 63811, dimensions: { heightPx: 412, widthPx: 1180 }, path: "/x.png" });
    expect(graded.isOk()).toBe(true);
    expect(unwrap(graded).widthPx).toBe(1180);
  });

  it("refuses a zero-width capture — a marked element that collapsed to nothing", () => {
    const graded = gradeCapture({ byteLength: 200, dimensions: { heightPx: 412, widthPx: 0 }, path: "/x.png" });
    expect(graded.isErr()).toBe(true);
    expect(unwrapErr(graded).code).toBe("IMAGE_UNUSABLE");
    expect(unwrapErr(graded).message).toContain("no area");
  });

  it("refuses a zero-height capture for the same reason", () => {
    const graded = gradeCapture({ byteLength: 200, dimensions: { heightPx: 0, widthPx: 1180 }, path: "/x.png" });
    expect(graded.isErr()).toBe(true);
    expect(unwrapErr(graded).message).toContain("no area");
  });

  it("refuses an empty file even when its header declared an area", () => {
    const graded = gradeCapture({ byteLength: 0, dimensions: { heightPx: 412, widthPx: 1180 }, path: "/x.png" });
    expect(graded.isErr()).toBe(true);
    expect(unwrapErr(graded).message).toContain("empty");
  });

  it("names the final path in a refusal, so a reader knows which capture was thrown away", () => {
    const graded = gradeCapture({ byteLength: 0, dimensions: { heightPx: 1, widthPx: 1 }, path: "/shots/m-1.png" });
    expect(unwrapErr(graded).message).toContain("/shots/m-1.png");
  });
});
