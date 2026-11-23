import { describe, expect, it } from "vitest";

import { ANIMATED_GIF_OVERRIDE } from "../../../admit/animatedGifGate.js";
import { ATTACHMENT_OVERRIDES, attachmentFindings, attachmentGates } from "../../../admit/attachmentGates.js";
import { INVENTED_VISUAL_OVERRIDE } from "../../../admit/inventedVisualGate.js";
import { gifWithFrames } from "../../gifFixtures.js";

describe("the attachment door's gates", () => {
  it("waives every gate it composes, and nothing else", () => {
    expect(ATTACHMENT_OVERRIDES).toBe(`${INVENTED_VISUAL_OVERRIDE},${ANIMATED_GIF_OVERRIDE}`);
  });

  it("previews the animated-GIF finding for a looping recording", () => {
    const file = { bytes: gifWithFrames({ frames: 3, loop: true }), ref: "cassette.gif", siblings: [] };
    expect(attachmentFindings({ file }).map((finding) => finding.code)).toStrictEqual(["ANIMATED_GIF"]);
  });

  it("raises nothing for a still GIF", () => {
    const file = { bytes: gifWithFrames({ frames: 1 }), ref: "still.gif", siblings: [] };
    expect(attachmentFindings({ file })).toStrictEqual([]);
  });

  it("composes both gates over readable bytes, and only the invented-visual one over unreadable bytes", () => {
    expect(attachmentGates({ file: { bytes: gifWithFrames({ frames: 1 }), ref: "a.gif", siblings: [] } })).toHaveLength(
      2,
    );
    expect(attachmentGates({ file: { bytes: undefined, ref: "a.gif", siblings: [] } })).toHaveLength(1);
  });
});
