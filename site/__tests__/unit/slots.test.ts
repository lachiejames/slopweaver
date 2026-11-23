import { describe, expect, it } from "vitest";

import { fillSlots, refuseSlot, utf8Hex } from "../../lib/slots";
import { TALK_TOOLS } from "../../lib/talkToolsList";

describe("a hexText slot", () => {
  it("takes a value starting with a hyphen, the search for a flag a text slot refuses", () => {
    expect(refuseSlot({ slot: { shape: "hexText", slot: "text" }, value: "--json" })).toBe(undefined);
    expect(refuseSlot({ slot: { shape: "text", slot: "text" }, value: "--json" })).toBe(
      "text starts with a hyphen, which the verb would read as a flag; start it with a word",
    );
  });

  it("still refuses what a text slot refuses besides the hyphen", () => {
    expect(refuseSlot({ slot: { shape: "hexText", slot: "text" }, value: "  " })).toBe(
      "text is empty; the verb records your words, so it needs some",
    );
    expect(refuseSlot({ slot: { shape: "hexText", slot: "text" }, value: "a\u0000b" })).toBe(
      "text carries a control character",
    );
  });

  it("becomes ONE argv element of UTF-8 hex, so no parser can read it as a flag", () => {
    const built = fillSlots({
      parts: ["talk", "code", "find", "--text-hex", { shape: "hexText", slot: "text" }],
      subject: "code_find",
      supplied: { text: "--json" },
    });
    expect(built).toEqual({ argv: ["talk", "code", "find", "--text-hex", "2d2d6a736f6e"], kind: "argv" });
  });

  it("encodes a character outside ASCII as its UTF-8 bytes", () => {
    expect(utf8Hex({ text: "é-" })).toBe("c3a92d");
    expect(utf8Hex({ text: "-😀" })).toBe("2df09f9880");
  });

  it("refuses a lone surrogate, which UTF-8 cannot spell, and takes a paired one", () => {
    expect(refuseSlot({ slot: { shape: "hexText", slot: "text" }, value: "-é\uD800" })).toBe(
      "text carries half of a character, which no file can contain",
    );
    expect(refuseSlot({ slot: { shape: "hexText", slot: "text" }, value: "-😀" })).toBe(undefined);
  });
});

describe("code_find", () => {
  it("sends its text through the hex spelling, so a search for -n is not refused", () => {
    const tool = TALK_TOOLS.find((candidate) => candidate.name === "code_find")!;
    expect(tool).toMatchObject({
      argv: ["talk", "code", "find", "--text-hex", { shape: "hexText", slot: "text" }, "--json"],
    });
  });
});
