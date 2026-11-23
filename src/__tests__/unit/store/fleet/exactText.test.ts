/**
 * `decodeExactly` hands back text only when that text re-encodes to the very bytes it was given.
 */
import { describe, expect, it } from "vitest";

import { decodeExactly } from "../../../../store/fleet/exactText.js";

describe("decodeExactly", () => {
  it("returns plain UTF-8 as its text", () => {
    expect(decodeExactly({ bytes: Buffer.from("gold — proof", "utf8") })).toBe("gold — proof");
  });

  it("keeps a leading byte-order mark in the text rather than dropping it", () => {
    expect(decodeExactly({ bytes: Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]) })).toBe("﻿a");
  });

  it("refuses a byte sequence that is not UTF-8", () => {
    expect(decodeExactly({ bytes: Uint8Array.from([0x61, 0xff, 0x62]) })).toBe(undefined);
  });

  it("returns the empty string for no bytes", () => {
    expect(decodeExactly({ bytes: new Uint8Array() })).toBe("");
  });
});
