/**
 * PNG metadata: the chunk walk over real Jimp output with a text chunk spliced in, the allowlist naming what is not
 * pixels, and the strip whose own output is re-checked.
 */
import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  metadataChunksIn,
  metadataLeftIn,
  pngChunkTypes,
  stripImageMetadata,
} from "../../../visualEvidence/pngMetadata.js";

/** A small plain PNG straight out of Jimp's encoder. */
async function plainPng(): Promise<Uint8Array> {
  return new Uint8Array(await new Jimp({ color: 0x336699ff, height: 4, width: 6 }).getBuffer("image/png"));
}

/** One PNG chunk: length, type, data, and a CRC the walk never reads. */
function chunk({ type, data }: { type: string; data: string }): Uint8Array {
  const body = new TextEncoder().encode(data);
  const out = new Uint8Array(12 + body.byteLength);
  new DataView(out.buffer).setUint32(0, body.byteLength);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

/** The PNG with a `tEXt` chunk inserted right after `IHDR` (8-byte signature plus a 25-byte IHDR chunk). */
function withTextChunk({ png }: { png: Uint8Array }): Uint8Array {
  const text = chunk({ data: "Author\u0000someone@example.test", type: "tEXt" });
  const out = new Uint8Array(png.byteLength + text.byteLength);
  out.set(png.subarray(0, 33), 0);
  out.set(text, 33);
  out.set(png.subarray(33), 33 + text.byteLength);
  return out;
}

describe("pngChunkTypes and metadataChunksIn", () => {
  it("walks a plain encoder output to IEND and finds nothing but pixels", async () => {
    const png = await plainPng();
    const types = pngChunkTypes({ bytes: png })!;
    expect(types[0]).toBe("IHDR");
    expect(types.at(-1)).toBe("IEND");
    expect(metadataChunksIn({ bytes: png })).toEqual([]);
  });

  it("names a spliced text chunk", async () => {
    expect(metadataChunksIn({ bytes: withTextChunk({ png: await plainPng() }) })).toEqual(["tEXt"]);
  });

  it("answers null for bytes that are not a PNG, and for a chunk length running past the end", async () => {
    expect(pngChunkTypes({ bytes: new Uint8Array([1, 2, 3]) })).toBe(null);
    const png = await plainPng();
    expect(pngChunkTypes({ bytes: png.subarray(0, png.byteLength - 4) })).toBe(null);
    expect(metadataChunksIn({ bytes: new Uint8Array(0) })).toBe(null);
  });
});

describe("metadataLeftIn", () => {
  it("answers none for a clean PNG, the chunk for a dirty one, and one named entry for bytes that are no PNG", async () => {
    const png = await plainPng();
    expect([
      metadataLeftIn({ bytes: png }),
      metadataLeftIn({ bytes: withTextChunk({ png }) }),
      metadataLeftIn({ bytes: new Uint8Array([1, 2, 3]) }),
    ]).toStrictEqual([[], ["tEXt"], ["(not a PNG)"]]);
  });
});

describe("stripImageMetadata", () => {
  it("re-encodes away the text chunk and keeps the pixels", async () => {
    const stripped = unwrap(await stripImageMetadata({ bytes: withTextChunk({ png: await plainPng() }) }));
    expect(metadataChunksIn({ bytes: stripped })).toEqual([]);
    const decoded = await Jimp.fromBuffer(Buffer.from(stripped));
    expect(decoded.getPixelColor(2, 2)).toBe(0x336699ff);
  });

  it("refuses bytes it cannot decode", async () => {
    expect(unwrapErr(await stripImageMetadata({ bytes: new Uint8Array([9, 9, 9]) })).code).toBe("UNDECODABLE");
  });
});
