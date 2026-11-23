/*
 * The one picture check both console routes share: a bounded, canonical-base64 WebP data URL whose bytes are a
 * structurally whole WebP container — each refusal on an input otherwise valid, so the one flaw under test is
 * what refused it.
 */
import { describe, expect, it } from "vitest";

import { RELAY_FRAME_DATA_URL_MAX, RELAY_PICTURE_PREFIX } from "../../lib/screenFrame";
import { decodeWebpDataUrl, isWebpBytes } from "../../lib/webpDataUrl";

/** A WebP container — RIFF sized to the file, one `VP8L` chunk sized to a zeroed body. */
const webpBytes = ({ body }: { body: number }): Uint8Array => {
  const head = Buffer.alloc(20);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(12 + body, 4);
  head.write("WEBPVP8L", 8, "latin1");
  head.writeUInt32LE(body, 16);
  return new Uint8Array(Buffer.concat([head, Buffer.alloc(body)]));
};

/** {@link webpBytes} as the data URL a page posts. */
const webpUrl = ({ body }: { body: number }): string =>
  `${RELAY_PICTURE_PREFIX}${Buffer.from(webpBytes({ body })).toString("base64")}`;

describe("decodeWebpDataUrl", () => {
  it("decodes a bounded WebP data URL to its exact bytes", () => {
    expect(decodeWebpDataUrl({ dataUrl: webpUrl({ body: 4 }), field: "image" })).toEqual({
      bytes: webpBytes({ body: 4 }),
      kind: "webp",
    });
  });

  it("names the field it was given when the string itself is wrong", () => {
    expect(decodeWebpDataUrl({ dataUrl: "data:image/png;base64,AAAA", field: "image" })).toEqual({
      kind: "refused",
      status: 400,
      why: `image must start ${RELAY_PICTURE_PREFIX}`,
    });
    expect(decodeWebpDataUrl({ dataUrl: `${RELAY_PICTURE_PREFIX}AAA`, field: "screen.dataUrl" })).toEqual({
      kind: "refused",
      status: 400,
      why: "screen.dataUrl is not canonical base64",
    });
  });

  it("refuses a string past the data-URL bound with 413, before decoding it", () => {
    const long = `${RELAY_PICTURE_PREFIX}${"A".repeat(RELAY_FRAME_DATA_URL_MAX)}`;
    expect(decodeWebpDataUrl({ dataUrl: long, field: "image" })).toMatchObject({ kind: "refused", status: 413 });
  });

  it("refuses canonical base64 whose bytes are no WebP", () => {
    expect(decodeWebpDataUrl({ dataUrl: `${RELAY_PICTURE_PREFIX}UklGRgAAAABXRUJQ`, field: "image" })).toEqual({
      kind: "refused",
      status: 400,
      why: "the picture is not a WebP image (no RIFF/WEBP container around an image chunk)",
    });
  });
});

describe("isWebpBytes", () => {
  it("accepts a container sized to the file around an image chunk, and a real encoder's 1x1 lossy output", () => {
    expect(isWebpBytes({ bytes: webpBytes({ body: 4 }) })).toBe(true);
    const modernizrLossy = new Uint8Array(
      Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"),
    );
    expect(isWebpBytes({ bytes: modernizrLossy })).toBe(true);
  });

  it("refuses an extended VP8X header with no image chunk behind it", () => {
    const vp8xOnly = new Uint8Array(Buffer.from("UklGRhYAAABXRUJQVlA4WAoAAAAAAAAAAAAAAAAA", "base64"));
    expect(isWebpBytes({ bytes: vp8xOnly })).toBe(false);
  });

  it("refuses the header-shaped shell the magic alone would pass, a wrong RIFF size, and a non-image chunk", () => {
    const shell = new Uint8Array(Buffer.from("UklGRgAAAABXRUJQ", "base64"));
    const resized = webpBytes({ body: 4 });
    new DataView(resized.buffer).setUint32(4, 99, true);
    const iccp = webpBytes({ body: 4 });
    iccp.set(new TextEncoder().encode("ICCP"), 12);
    expect([shell, resized, iccp].map((bytes) => isWebpBytes({ bytes }))).toEqual([false, false, false]);
  });
});
