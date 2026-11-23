/** `sniffImage` names a picture by its first bytes alone, and nothing else passes for one. */
import { describe, expect, it } from "vitest";

import { IMAGE_SNIFF_BYTES, sniffImage } from "../../../talk/imageSniff.js";

/** `RIFF`, four size bytes, then the given form type. */
function riff({ form }: { form: string }): Uint8Array {
  return Uint8Array.from([...Buffer.from("RIFF"), 0x24, 0x00, 0x00, 0x00, ...Buffer.from(form)]);
}

describe("sniffImage", () => {
  it("names each of the three formats from its signature", () => {
    expect(sniffImage({ head: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]) })).toBe(
      "image/png",
    );
    expect(sniffImage({ head: Uint8Array.from([0xff, 0xd8, 0xff, 0xe1]) })).toBe("image/jpeg");
    expect(sniffImage({ head: riff({ form: "WEBP" }) })).toBe("image/webp");
  });

  it("reads no more than twelve bytes, the length of a WebP's RIFF header", () => {
    expect(IMAGE_SNIFF_BYTES).toBe(12);
    expect(riff({ form: "WEBP" }).length).toBe(IMAGE_SNIFF_BYTES);
  });

  it("refuses another RIFF form, a cut signature, an empty head and text", () => {
    expect(sniffImage({ head: riff({ form: "AVI " }) })).toBe(undefined);
    expect(sniffImage({ head: riff({ form: "WEBP" }).subarray(0, 11) })).toBe(undefined);
    expect(sniffImage({ head: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]) })).toBe(undefined);
    expect(sniffImage({ head: new Uint8Array(0) })).toBe(undefined);
    expect(sniffImage({ head: Buffer.from("not a picture") })).toBe(undefined);
  });
});
