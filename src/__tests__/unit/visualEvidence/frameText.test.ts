/**
 * Frame text: the reading order a scan reads, the redaction rule that drops only a WHOLLY covered item, and the
 * browser walk cropped into final-image pixels with `incomplete` as a real arm.
 */
import { describe, expect, it } from "vitest";

import {
  type FrameText,
  frameTextLines,
  frameTextSchema,
  frameTextWithout,
  pageFrameText,
  rectCovers,
  transcriptFrameText,
} from "../../../visualEvidence/frameText.js";

const FRAME: FrameText = {
  items: [
    { rect: { height: 10, width: 40, x: 60, y: 0 }, text: "world" },
    { rect: { height: 10, width: 40, x: 0, y: 20 }, text: "token=FIXTURE" },
    { rect: { height: 10, width: 40, x: 0, y: 0 }, text: "hello" },
  ],
  kind: "exact",
  origin: "terminal-screen",
};

describe("frameTextLines", () => {
  it("orders items top to bottom then left to right, joining one top edge with a space", () => {
    expect(frameTextLines({ frameText: FRAME })).toBe("hello world\ntoken=FIXTURE");
  });

  it("is empty for a frame with no text", () => {
    expect(frameTextLines({ frameText: { items: [], kind: "exact", origin: "terminal-screen" } })).toBe("");
  });

  it("keeps items at the same place on lines of their own, in recorded order", () => {
    const whole = { height: 10, width: 10, x: 0, y: 0 };
    const frameText: FrameText = {
      items: [
        { rect: whole, text: "token=" },
        { rect: whole, text: "FIXTURE" },
      ],
      kind: "exact",
      origin: "recording-transcript",
    };
    expect(frameTextLines({ frameText })).toBe("token=\nFIXTURE");
  });
});

describe("transcriptFrameText", () => {
  const frame = { heightPx: 600, widthPx: 1200 };

  it("keeps every distinct non-blank line in first-shown order, dropping box-drawing separators", () => {
    const transcript = "$ yarn test\n\n────────────\n$ yarn test\nTests  12 passed  \n";
    expect(transcriptFrameText({ frame, transcript })).toStrictEqual({
      items: [
        { rect: { height: 600, width: 1200, x: 0, y: 0 }, text: "$ yarn test" },
        { rect: { height: 600, width: 1200, x: 0, y: 0 }, text: "Tests  12 passed" },
      ],
      kind: "exact",
      origin: "recording-transcript",
    });
  });

  it("is incomplete, naming why, with no transcript or one holding no text", () => {
    expect(transcriptFrameText({ frame, transcript: null })).toStrictEqual({
      items: [],
      kind: "incomplete",
      origin: "recording-transcript",
      reasons: ["the recorder wrote no transcript beside the video"],
    });
    expect(transcriptFrameText({ frame, transcript: "\n────\n" })).toMatchObject({
      kind: "incomplete",
      reasons: ["the recorder's transcript holds no text"],
    });
  });
});

describe("rectCovers and frameTextWithout", () => {
  it("covers only when every edge is inside, a shared edge included", () => {
    const outer = { height: 10, width: 10, x: 0, y: 0 };
    expect(rectCovers({ inner: outer, outer })).toBe(true);
    expect(rectCovers({ inner: { height: 10, width: 11, x: 0, y: 0 }, outer })).toBe(false);
    expect(rectCovers({ inner: { height: 2, width: 2, x: 9, y: 9 }, outer })).toBe(false);
  });

  it("drops an item one burned rectangle wholly covers and keeps one it only partly covers", () => {
    const wholly = frameTextWithout({ burned: [{ height: 12, width: 50, x: 0, y: 19 }], frameText: FRAME });
    expect(wholly.items.map((item) => item.text)).toEqual(["world", "hello"]);
    expect(wholly.kind).toBe("exact");
    const partly = frameTextWithout({ burned: [{ height: 12, width: 20, x: 0, y: 19 }], frameText: FRAME });
    expect(partly.items.map((item) => item.text)).toEqual(["world", "token=FIXTURE", "hello"]);
  });

  it("keeps the incomplete arm and its reasons through a redaction", () => {
    const incomplete: FrameText = { ...FRAME, kind: "incomplete", reasons: ["an iframe sits in the crop"] };
    expect(frameTextWithout({ burned: [{ height: 40, width: 200, x: 0, y: 0 }], frameText: incomplete })).toEqual({
      items: [],
      kind: "incomplete",
      origin: "terminal-screen",
      reasons: ["an iframe sits in the crop"],
    });
  });
});

describe("pageFrameText", () => {
  const crop = { height: 100, width: 200, x: 20, y: 10 };

  it("scales and clips nodes into crop pixels, drops nodes outside it, and slices the caption band per line", () => {
    const frame = pageFrameText({
      caption: { bandHeightPx: 40, lines: ["first", "second"] },
      crop,
      scale: 2,
      walk: {
        nodes: [
          { rect: { height: 5, width: 20, x: 15, y: 10 }, text: "inside" },
          { rect: { height: 5, width: 20, x: 5, y: 50 }, text: "cut by the left edge" },
          { rect: { height: 5, width: 5, x: 200, y: 200 }, text: "outside" },
          { rect: { height: 5, width: 5, x: 20, y: 20 }, text: "   " },
        ],
        opaque: [{ height: 10, width: 10, x: 300, y: 300 }],
        truncated: false,
      },
    });
    expect(frame).toEqual({
      items: [
        { rect: { height: 10, width: 40, x: 10, y: 10 }, text: "inside" },
        { rect: { height: 10, width: 30, x: 0, y: 90 }, text: "cut by the left edge" },
        { rect: { height: 20, width: 200, x: 0, y: 100 }, text: "first" },
        { rect: { height: 20, width: 200, x: 0, y: 120 }, text: "second" },
      ],
      kind: "exact",
      origin: "page-visible-text",
    });
  });

  it("says incomplete, with each reason, for a truncated walk and an opaque region in the crop", () => {
    const frame = pageFrameText({
      caption: { bandHeightPx: 0, lines: [] },
      crop,
      scale: 1,
      walk: { nodes: [], opaque: [{ height: 10, width: 10, x: 30, y: 30 }], truncated: true },
    });
    expect(frame).toEqual({
      items: [],
      kind: "incomplete",
      origin: "page-visible-text",
      reasons: [
        "the page held more text nodes than the capture walks, so the rest were not read",
        "an iframe or shadow root sits inside the crop, and its text is not readable from the page",
      ],
    });
  });
});

describe("frameTextSchema", () => {
  it("refuses an incomplete frame with no reason and an item with no text", () => {
    const noReason = { items: [], kind: "incomplete", origin: "terminal-screen", reasons: [] };
    expect(frameTextSchema.safeParse(noReason).success).toBe(false);
    const emptyItem = {
      items: [{ rect: { height: 1, width: 1, x: 0, y: 0 }, text: "" }],
      kind: "exact",
      origin: "terminal-screen",
    };
    expect(frameTextSchema.safeParse(emptyItem).success).toBe(false);
    expect(frameTextSchema.safeParse(FRAME).success).toBe(true);
  });
});
