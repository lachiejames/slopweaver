/**
 * The pasted-media criterion and the slotting that puts a paste back. The criterion is narrow on purpose, so the
 * refusals are tested as carefully as the acceptances: each names one way a block could carry prose or markup.
 */
import { describe, expect, it } from "vitest";
import {
  isPastedMedia,
  joinWithPasted,
  liftPasted,
  pastedMediaEnds,
} from "../../../../../outbound/github/legacy/pastedMedia.js";

/** A user-attachments upload address. */
const ASSET = "https://github.com/user-attachments/assets/abc-1";

describe("pastedMediaEnds", () => {
  it("names the offset past each pasted block's closing newline, a mid-text one and a final one", () => {
    const text = `<p>a</p>\n\n${ASSET}\n\n<p>b</p>\n\n${ASSET}\n`;
    const first = `<p>a</p>\n\n${ASSET}`.length + 1;
    expect(pastedMediaEnds({ text })).toStrictEqual([first, text.length]);
  });

  it("ends a final paste no newline closes at the end of the text, and names nothing for text with no paste", () => {
    const unclosed = `<p>a</p>\n\n${ASSET}`;
    expect(pastedMediaEnds({ text: unclosed })).toStrictEqual([unclosed.length]);
    expect(pastedMediaEnds({ text: "<p>a</p>\n\n<p>b</p>\n" })).toStrictEqual([]);
  });

  it("reads blocks only at a blank line, so a region opening on one newline yields no block", () => {
    expect(pastedMediaEnds({ text: `\n${ASSET}\n` })).toStrictEqual([]);
    expect(pastedMediaEnds({ text: `\n\n${ASSET}\n` })).toStrictEqual([ASSET.length + 3]);
  });
});

describe("isPastedMedia", () => {
  it.each([
    ["an <img> GitHub's editor writes", `<img width="1512" height="982" alt="Image" src="${ASSET}" />`],
    ["an <img> with no closing slash", `<img src="${ASSET}" alt="Image">`],
    ["an <img> carrying only a source", `<img src="${ASSET}">`],
    ["a Markdown image", `![image](${ASSET})`],
    ["a Markdown image with an empty alt", `![](${ASSET})`],
    ["a Markdown image with a plain-words alt", `![Screenshot 2026-10-30 at 10.00.00 (2)](${ASSET})`],
    ["a bare video URL", ASSET],
  ])("accepts %s", (_name, block) => {
    expect(isPastedMedia({ block })).toBe(true);
  });

  it.each([
    ["an image off user-attachments", '<img src="https://example.com/a.png" />'],
    ["an attachment address with a path after the id", `<img src="${ASSET}/x" />`],
    ["an event handler", `<img src="${ASSET}" onerror="alert(1)" />`],
    ["a style attribute", `<img src="${ASSET}" style="x" />`],
    ["a duplicated source", `<img src="${ASSET}" src="https://example.com/a" />`],
    ["a percentage width", `<img width="50%" src="${ASSET}" />`],
    ["an <img> with no source", '<img alt="Image" />'],
    ["two images in one block", `<img src="${ASSET}" />\n<img src="${ASSET}" />`],
    ["an <img> split across lines by CRLF, which a read would turn into LF", `<img\r\nsrc="${ASSET}" />`],
    ["an <img> split across lines", `<img\nsrc="${ASSET}" alt="Image" />`],
    ["an <img> parted by a vertical tab", `<img\u000Bsrc="${ASSET}">`],
    ["an <img> parted by a tab", `<img\tsrc="${ASSET}">`],
    ["an alt carrying U+0085 NEXT LINE", `<img src="${ASSET}" alt="before\u0085after">`],
    ["an alt carrying a no-break space", `<img src="${ASSET}" alt="before\u00A0after">`],
    ["an alt carrying a zero-width joiner", `<img src="${ASSET}" alt="before\u200Dafter">`],
    ["a Markdown alt carrying U+2028", `![before\u2028after](${ASSET})`],
    ["a Markdown image with a title", `![image](${ASSET} "t")`],
    ["a Markdown image whose alt carries a tag", `![<b>extra prose</b>](${ASSET})`],
    ["a Markdown image whose alt carries emphasis", `![**extra prose**](${ASSET})`],
    ["a Markdown image whose alt carries underscores", `![_extra_](${ASSET})`],
    ["a Markdown image whose alt carries a backtick", `![\`code\`](${ASSET})`],
    ["a Markdown image off user-attachments", "![image](https://example.com/a.png)"],
    ["prose carrying the address", `see ${ASSET}`],
    ["the address with a trailing space", `${ASSET} `],
  ])("refuses %s", (_name, block) => {
    expect(isPastedMedia({ block })).toBe(false);
  });
});

describe("liftPasted", () => {
  it("splits the canonical blocks from the pastes, counting the canonical blocks before each paste", () => {
    expect(liftPasted({ blocks: [ASSET, "a", "b", `![x](${ASSET})`, "c"] })).toStrictEqual({
      canonical: ["a", "b", "c"],
      pasted: [
        { before: 0, raw: ASSET },
        { before: 2, raw: `![x](${ASSET})` },
      ],
    });
  });

  it("lifts nothing from a body with no paste", () => {
    expect(liftPasted({ blocks: ["a", "b"] })).toStrictEqual({ canonical: ["a", "b"], pasted: [] });
  });
});

describe("joinWithPasted", () => {
  const blocks = [
    { key: "badges", text: "B" },
    { key: "problem", text: "P" },
    { key: "change", text: "C" },
  ] as const;

  it("joins the blocks alone when nothing was pasted", () => {
    expect(joinWithPasted({ blocks, pasted: [] })).toBe("B\n\nP\n\nC");
  });

  it("puts a paste first, after its own key, and after the nearest earlier key when its own is gone", () => {
    const pasted = [
      { after: "start", raw: "S" },
      { after: "problem", raw: "X" },
      { after: "change-heading", raw: "Y" },
      { after: "notes", raw: "Z" },
    ] as const;
    expect(joinWithPasted({ blocks, pasted })).toBe("S\n\nB\n\nP\n\nX\n\nY\n\nC\n\nZ");
  });

  it("keeps several pastes after one key in the order they were read", () => {
    const pasted = [
      { after: "badges", raw: "1" },
      { after: "badges", raw: "2" },
    ] as const;
    expect(joinWithPasted({ blocks, pasted })).toBe("B\n\n1\n\n2\n\nP\n\nC");
  });
});
