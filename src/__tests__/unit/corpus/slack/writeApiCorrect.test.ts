/**
 * The `chat.update` arguments `slack correct` sends: the message addressed by its own ts, only the optional parts the
 * corrected body carries, the attached files re-sent by id, and nothing of `correctClaim`'s own bookkeeping.
 */
import { describe, expect, it } from "vitest";

import { correctionUpdateArgs } from "../../../../corpus/slack/writeApiCorrect.js";

const POSTED = { channel: "C0CHAN", ts: "1712345678.000100" };

describe("correctionUpdateArgs", () => {
  it("sends a block-less correction as text alone, without struckIn", () => {
    expect(
      correctionUpdateArgs({ corrected: { struckIn: "text", text: "it was ~c~" }, fileIds: [], posted: POSTED }),
    ).toEqual({ channel: "C0CHAN", text: "it was ~c~", ts: "1712345678.000100" });
  });

  it("carries blocks, attachments, metadata and the attached file ids when the message had them", () => {
    const metadata = { event_payload: { renderer: "r" }, event_type: "t" };
    const attachment = { blocks: [{ type: "divider" }], fallback: "f" };
    expect(
      correctionUpdateArgs({
        corrected: {
          attachments: [attachment],
          blocks: [{ type: "divider" }],
          metadata,
          struckIn: "rich-text",
          text: "f",
        },
        fileIds: ["F01"],
        posted: POSTED,
      }),
    ).toEqual({
      attachments: [attachment],
      blocks: [{ type: "divider" }],
      channel: "C0CHAN",
      file_ids: ["F01"],
      metadata,
      text: "f",
      ts: "1712345678.000100",
    });
  });
});
