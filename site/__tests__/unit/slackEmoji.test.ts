/*
 * Slack's standard shortcodes as the emoji Slack draws (a card must not show emoji in their text form).
 * Every case asserts the exact pieces or string, and the property the decision rests on — a name
 * the table does not hold stays byte for byte, a workspace custom emoji and `10:30:45` alike — is asserted directly.
 */

import { describe, expect, it } from "vitest";

import {
  EMOJI_SOURCE,
  emojiElementGlyph,
  emojiGlyph,
  emojiPieces,
  emojiText,
  emojiUnicodeGlyph,
  fencedLines,
  isSkinTone,
  linkLabelPieces,
} from "../../lib/slackEmoji";
import table from "../../lib/slackEmoji.json";

describe("the emoji snapshot", () => {
  it("names the release it was taken from, and holds every alias and every single-tone name of it", () => {
    expect(EMOJI_SOURCE).toBe("emoji-datasource@16.0.0/emoji.json");
    expect(Object.keys(table.glyphs).length).toBe(1972);
    expect(table.skinToneNames.length).toBe(329);
    expect(new Set(table.skinToneNames).size).toBe(329);
  });

  it("leaves out the two-person emoji that carry no single-tone variation", () => {
    expect(table.skinToneNames.includes("people_holding_hands")).toBe(false);
    expect(table.skinToneNames.includes("thumbsup")).toBe(true);
  });
});

describe("emojiGlyph", () => {
  it("draws a standard name, and each of its aliases, as the same emoji", () => {
    expect([emojiGlyph({ name: "thumbsup" }), emojiGlyph({ name: "+1" })]).toEqual(["👍", "👍"]);
  });

  it("folds a skin tone into an emoji that takes one", () => {
    expect(emojiGlyph({ name: "thumbsup", skinTone: 4 })).toBe("👍🏽");
  });

  it("folds a tone after the first code point of a joined emoji", () => {
    expect(emojiGlyph({ name: "male-technologist", skinTone: 4 })).toBe("👨🏽‍💻");
  });

  it("drops the presentation selector the tone replaces", () => {
    expect(emojiGlyph({ name: "point_up", skinTone: 2 })).toBe("☝🏻");
  });

  it("draws an emoji that takes no tone without one", () => {
    expect(emojiGlyph({ name: "coffee", skinTone: 4 })).toBe("☕");
  });

  it("has no emoji for a name outside the standard set", () => {
    expect([emojiGlyph({ name: "partyparrot" }), emojiGlyph({ name: "man-technologist" })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("emojiPieces", () => {
  it("splits text around a standard shortcode, keeping what was written", () => {
    expect(emojiPieces({ text: "shipped :tada: thanks" })).toEqual([
      { kind: "text", text: "shipped " },
      { glyph: "🎉", kind: "emoji", name: "tada", written: ":tada:" },
      { kind: "text", text: " thanks" },
    ]);
  });

  it("reads each alias as its own written name", () => {
    expect(emojiPieces({ text: ":+1::thumbsup:" })).toEqual([
      { glyph: "👍", kind: "emoji", name: "+1", written: ":+1:" },
      { glyph: "👍", kind: "emoji", name: "thumbsup", written: ":thumbsup:" },
    ]);
  });

  it("takes a skin tone written after a tonable emoji into that one emoji", () => {
    expect(emojiPieces({ text: ":wave::skin-tone-3:" })).toEqual([
      { glyph: "👋🏼", kind: "emoji", name: "wave", written: ":wave::skin-tone-3:" },
    ]);
  });

  it("leaves a tone after an emoji that takes none as its own swatch, as Slack draws it", () => {
    expect(emojiPieces({ text: ":coffee::skin-tone-4:" })).toEqual([
      { glyph: "☕", kind: "emoji", name: "coffee", written: ":coffee:" },
      { glyph: "🏽", kind: "emoji", name: "skin-tone-4", written: ":skin-tone-4:" },
    ]);
  });

  it("leaves a workspace custom emoji exactly as written, its tone included", () => {
    expect(emojiPieces({ text: "nice :partyparrot::skin-tone-2: :our_workspace_thing:" })).toEqual([
      { kind: "text", text: "nice :partyparrot::skin-tone-2: :our_workspace_thing:" },
    ]);
  });

  it("leaves prose with colons in it alone", () => {
    expect(emojiPieces({ text: "deployed at 10:30:45, ratio 1:100" })).toEqual([
      { kind: "text", text: "deployed at 10:30:45, ratio 1:100" },
    ]);
  });

  it("keeps a shortcode inside inline code or a fenced block as written, and draws the one outside", () => {
    expect(emojiPieces({ text: "`:tada:` ```\n:tada:\n``` :tada:" })).toEqual([
      { kind: "text", text: "`:tada:` ```\n:tada:\n``` " },
      { glyph: "🎉", kind: "emoji", name: "tada", written: ":tada:" },
    ]);
  });

  it("reads an unmatched backtick as text, so the shortcode after it still draws", () => {
    expect(emojiPieces({ text: "a ` b :tada:" })).toEqual([
      { kind: "text", text: "a ` b " },
      { glyph: "🎉", kind: "emoji", name: "tada", written: ":tada:" },
    ]);
  });

  it("never pairs a stray backtick with a fence's first backtick, so the fenced shortcode stays as written", () => {
    expect([
      emojiText({ text: "` stray ```\n:tada:\n```" }),
      emojiText({ text: "x https://a.io```:tada:```" }),
    ]).toEqual(["` stray ```\n:tada:\n```", "x https://a.io```:tada:```"]);
  });

  it("leaves a web address whole, bare or bracketed, and draws the shortcode after it", () => {
    expect(
      emojiPieces({ text: "see https://x.io/a:tada:b <http://x.io/:tada:|docs> HTTPS://x.io/:tada: :tada:" }),
    ).toEqual([
      { kind: "text", text: "see https://x.io/a:tada:b <http://x.io/:tada:|docs> HTTPS://x.io/:tada: " },
      { glyph: "🎉", kind: "emoji", name: "tada", written: ":tada:" },
    ]);
  });

  it("has no pieces for empty text", () => {
    expect(emojiPieces({ text: "" })).toEqual([]);
  });
});

describe("emojiText", () => {
  it("draws each standard shortcode as its emoji and leaves every other word", () => {
    expect(emojiText({ text: "lgtm :+1::skin-tone-5: — :partyparrot: at 10:30:45" })).toBe(
      "lgtm 👍🏾 — :partyparrot: at 10:30:45",
    );
  });
});

describe("emojiElementGlyph", () => {
  it("draws Slack's own toned unicode as recorded, never toning it twice", () => {
    expect(emojiElementGlyph({ name: "wave", skinTone: 3, unicode: "1f44b-1f3fc" })).toBe("👋🏼");
  });

  it("folds a tone recorded beside a base unicode into it", () => {
    expect(emojiElementGlyph({ name: "wave", skinTone: 3, unicode: "1f44b" })).toBe("👋🏼");
  });

  it("draws the unicode over the name, an alias's own name included", () => {
    expect(emojiElementGlyph({ name: "yay", skinTone: undefined, unicode: "1f389" })).toBe("🎉");
  });

  it("draws by name and tone when no unicode was recorded, and has nothing for a custom name", () => {
    expect([
      emojiElementGlyph({ name: "wave", skinTone: 4, unicode: undefined }),
      emojiElementGlyph({ name: "partyparrot", skinTone: undefined, unicode: undefined }),
    ]).toEqual(["👋🏽", undefined]);
  });
});

describe("linkLabelPieces", () => {
  it("draws the shortcodes in a label the author wrote", () => {
    expect(linkLabelPieces({ href: "https://example.com", label: "ship :tada:" })).toEqual([
      { kind: "text", text: "ship " },
      { glyph: "🎉", kind: "emoji", name: "tada", written: ":tada:" },
    ]);
  });

  it("leaves a bare address exactly as written, even one that holds a shortcode's shape", () => {
    const href = "https://example.com/a:tada:b";
    expect(linkLabelPieces({ href, label: href })).toEqual([{ kind: "text", text: href }]);
  });
});

describe("fencedLines", () => {
  const plain = ({ text }: { text: string }): unknown => ({ fenced: false, text });
  const code = ({ text }: { text: string }): unknown => ({ fenced: true, text });

  it("marks every line a fence spanning lines covers, the fence lines and a blank one inside included", () => {
    expect(fencedLines({ text: "ship :tada:\n```\n:tada:\n\n```\nafter :tada:" })).toEqual([
      { line: "ship :tada:", segments: [plain({ text: "ship :tada:" })] },
      { line: "```", segments: [code({ text: "```" })] },
      { line: ":tada:", segments: [code({ text: ":tada:" })] },
      { line: "", segments: [code({ text: "" })] },
      { line: "```", segments: [code({ text: "```" })] },
      { line: "after :tada:", segments: [plain({ text: "after :tada:" })] },
    ]);
  });

  it("cuts a line the fence opens or closes on, so the words beside the fence stay outside it", () => {
    expect(fencedLines({ text: "before :tada: ```\n:thumbsup:\n``` after :wave:" })).toEqual([
      { line: "before :tada: ```", segments: [plain({ text: "before :tada: " }), code({ text: "```" })] },
      { line: ":thumbsup:", segments: [code({ text: ":thumbsup:" })] },
      { line: "``` after :wave:", segments: [code({ text: "```" }), plain({ text: " after :wave:" })] },
    ]);
  });

  it("cuts out a fence opening and closing on one line, a stray backtick inside it included", () => {
    expect(fencedLines({ text: "a ```before ` :tada:``` b" })).toEqual([
      {
        line: "a ```before ` :tada:``` b",
        segments: [plain({ text: "a " }), code({ text: "```before ` :tada:```" }), plain({ text: " b" })],
      },
    ]);
  });

  it("reads an unclosed fence as no fence", () => {
    expect(fencedLines({ text: "```\n:tada:" })).toEqual([
      { line: "```", segments: [plain({ text: "```" })] },
      { line: ":tada:", segments: [plain({ text: ":tada:" })] },
    ]);
  });

  it("reads one empty line for empty text", () => {
    expect(fencedLines({ text: "" })).toEqual([{ line: "", segments: [plain({ text: "" })] }]);
  });
});

describe("emojiUnicodeGlyph", () => {
  it("reads Slack's hyphenated hex, a keycap's selector and combining mark included", () => {
    expect([emojiUnicodeGlyph({ unicode: "1f44b-1f3fd" }), emojiUnicodeGlyph({ unicode: "0031-fe0f-20e3" })]).toEqual([
      "👋🏽",
      "1️⃣",
    ]);
  });

  it("has no emoji for a spelling that is not Unicode scalar values, rather than throwing", () => {
    const spellings = ["", "1f44b-", "zz", "110000", "1f44b 1f3fd", "d800", "1f44b-dfff"];
    expect(spellings.map((unicode) => emojiUnicodeGlyph({ unicode }))).toEqual(spellings.map(() => undefined));
  });
});

describe("isSkinTone", () => {
  it("admits Slack's five tone numbers and nothing else", () => {
    expect([1, 2, 3, 4, 5, 6, 7, "3", 2.5].map((value) => isSkinTone(value))).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
