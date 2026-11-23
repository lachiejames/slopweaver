import { describe, expect, it } from "vitest";

import { splitCharacterTail } from "../../../../../cli/commands/supervisor/scratchChild.js";

describe("splitCharacterTail", () => {
  it.each([
    { bytes: [], name: "an empty read", tail: 0 },
    { bytes: [0x61, 0x62], name: "ASCII", tail: 0 },
    { bytes: [0x61, 0xc3], name: "a two-byte lead with nothing after it", tail: 1 },
    { bytes: [0x61, 0xc3, 0xa9], name: "a complete two-byte character", tail: 0 },
    { bytes: [0xe2, 0x82], name: "a three-byte character missing its last byte", tail: 2 },
    { bytes: [0xf0, 0x9f, 0x98], name: "a four-byte character missing its last byte", tail: 3 },
    { bytes: [0xf0, 0x9f, 0x98, 0x80], name: "a complete four-byte character", tail: 0 },
    { bytes: [0xff, 0xff], name: "invalid bytes, which are kept and decode as U+FFFD", tail: 0 },
    { bytes: [0x80, 0x80, 0x80, 0x80], name: "stray continuation bytes", tail: 0 },
    { bytes: [0x61, 0xe0, 0x80], name: "an overlong E0 80, already invalid", tail: 0 },
    { bytes: [0x61, 0xe0, 0xa0], name: "a valid E0 A0 the cap split", tail: 2 },
    { bytes: [0xed, 0xa0], name: "a surrogate ED A0, already invalid", tail: 0 },
    { bytes: [0xf0, 0x80], name: "an overlong F0 80, already invalid", tail: 0 },
    { bytes: [0xf4, 0x90], name: "F4 90, past U+10FFFF and already invalid", tail: 0 },
    { bytes: [0xf4, 0x8f, 0xbf], name: "a valid F4 8F BF the cap split", tail: 3 },
  ])("measures $name as $tail", ({ bytes, tail }) => {
    expect(splitCharacterTail({ bytes: Uint8Array.from(bytes) })).toBe(tail);
  });
});
