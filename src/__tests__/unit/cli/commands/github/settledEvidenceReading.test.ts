/**
 * The settled-evidence reader: every URL a description's rendering carries, sorted by how it carries it, read whole
 * and as drawn open, and resolved against the pull request's page. The judgement over two readings is
 * `settledEvidenceCore.test.ts`'s.
 */
import { describe, expect, it } from "vitest";
import { parsedUrl, renderingsOf, urlsInText } from "../../../../../cli/commands/github/settledEvidenceReading.js";

const PAGE = "https://github.com/o/r/pull/42";
const SHOT = "https://github.com/user-attachments/assets/a";
/** U+200B ZERO WIDTH SPACE, built from its code point so the source shows what the test feeds in. */
const ZERO_WIDTH = String.fromCodePoint(0x200b);
/** Characters that draw nothing yet are no format character: a Hangul filler and the blank braille cell. */
const BLANK_GLYPHS = String.fromCodePoint(0x3164, 0x2800);

describe("renderingsOf", () => {
  it("sorts each URL by how the rendering carries it", () => {
    const body = `![shot](${SHOT})\n\n[the run](/o/r/actions/runs/1)\n\n<img alt="${SHOT}" src="x.png">`;
    const { whole } = renderingsOf({ body, page: PAGE, side: "kept" });
    expect({ drawn: whole.drawn, held: whole.held, linked: whole.linked }).toStrictEqual({
      drawn: [SHOT, "https://github.com/o/r/pull/x.png"],
      held: [SHOT],
      linked: ["https://github.com/o/r/actions/runs/1"],
    });
  });

  it("holds a link with only zero-width text, and links one wrapping a picture — the twenty-fifth pass", () => {
    const run = "https://github.com/o/r/actions/runs/1";
    const { whole } = renderingsOf({
      body: `<a href="${run}">${ZERO_WIDTH}</a> <a href="${run}/x"><img src="${SHOT}"></a>`,
      page: PAGE,
      side: "kept",
    });
    expect({ held: whole.held, linked: whole.linked }).toStrictEqual({ held: [run], linked: [`${run}/x`] });
  });

  it("holds a link whose text is only blank glyphs, and links one reading a single dot", () => {
    const run = "https://github.com/o/r/actions/runs/1";
    const { whole } = renderingsOf({
      body: `<a href="${run}">${BLANK_GLYPHS}</a> <a href="${run}/x">.</a>`,
      page: PAGE,
      side: "kept",
    });
    expect({ held: whole.held, linked: whole.linked }).toStrictEqual({ held: [run], linked: [`${run}/x`] });
  });

  it("credits a new body's copy only at ten or more, and protects a live picture unless it is sized zero", () => {
    const body = [
      `<img src="${SHOT}/0" width="0" height="0">`,
      `<img src="${SHOT}/1" height="9px">`,
      `<img src="${SHOT}/2" width="-5">`,
      `<img src="${SHOT}/3" width="10">`,
    ].join(" ");
    const read = ({ side }: { side: "live" | "kept" }): { drawn: readonly string[]; held: readonly string[] } => {
      const { whole } = renderingsOf({ body, page: PAGE, side });
      return { drawn: whole.drawn, held: whole.held };
    };
    expect([read({ side: "kept" }), read({ side: "live" })]).toStrictEqual([
      { drawn: [`${SHOT}/3`], held: [`${SHOT}/0`, `${SHOT}/1`, `${SHOT}/2`] },
      { drawn: [`${SHOT}/1`, `${SHOT}/2`, `${SHOT}/3`], held: [`${SHOT}/0`] },
    ]);
  });

  it("reads a closed details as its summary alone when reading what is shown", () => {
    const body = `<details><summary>notes</summary>\n\n![shot](${SHOT})\n\n</details>`;
    const { shown, whole } = renderingsOf({ body, page: PAGE, side: "kept" });
    expect([shown.drawn, whole.drawn]).toStrictEqual([[], [SHOT]]);
  });
});

describe("urlsInText", () => {
  it("reads each URL whole and normalised, a final dot kept", () => {
    expect(urlsInText({ text: "see HTTPS://GitHub.com/o/r/pull/42. and http://x.test/a" })).toStrictEqual([
      "https://github.com/o/r/pull/42.",
      "http://x.test/a",
    ]);
  });
});

describe("parsedUrl", () => {
  it("parses an absolute URL and refuses a relative one", () => {
    expect([parsedUrl({ url: SHOT })!.hostname, parsedUrl({ url: "x.png" })]).toStrictEqual(["github.com", undefined]);
  });
});
