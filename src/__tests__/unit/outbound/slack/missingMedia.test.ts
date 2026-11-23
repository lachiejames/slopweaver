import { describe, expect, it } from "vitest";

import {
  type MissingUpload,
  missingMediaBlock,
  missingMediaSentence,
  wrapperWithMissingMediaNote,
} from "../../../../outbound/slack/missingMedia.js";
import type { SlackCardWrapper } from "../../../../outbound/slack/types.js";

const STUCK: MissingUpload = {
  fileId: "F_STUCK_1",
  filename: "pr-checks.png",
  reason: "Slack never finished processing it in 27 poll(s) over 118.2s",
};

const WRAPPER: SlackCardWrapper = {
  blocks: [{ text: { text: "The answer.", type: "mrkdwn" }, type: "section" }],
  color: "#6b21e8",
  fallback: "The answer.",
};

describe("missingMediaSentence", () => {
  it("names the file, its Slack id and the phase the wait died in", () => {
    expect(missingMediaSentence({ missing: [STUCK] })).toBe(
      "1 image could not be attached to this message: pr-checks.png (F_STUCK_1) — " +
        "Slack never finished processing it in 27 poll(s) over 118.2s",
    );
  });

  it("counts in the plural and separates each file", () => {
    expect(
      missingMediaSentence({ missing: [STUCK, { fileId: "F2", filename: "b.png", reason: "files.info refused" }] }),
    ).toBe(
      "2 images could not be attached to this message: pr-checks.png (F_STUCK_1) — " +
        "Slack never finished processing it in 27 poll(s) over 118.2s; b.png (F2) — files.info refused",
    );
  });

  it("stops listing after three and counts the rest, so it can never become a wall", () => {
    const missing = ["a", "b", "c", "d", "e"].map((name) => ({ fileId: `F_${name}`, filename: name, reason: "stuck" }));

    expect(missingMediaSentence({ missing })).toBe(
      "5 images could not be attached to this message: a (F_a) — stuck; b (F_b) — stuck; c (F_c) — stuck; " +
        "and 2 more",
    );
  });

  it("is empty when nothing is missing", () => {
    expect(missingMediaSentence({ missing: [] })).toBe("");
  });
});

describe("missingMediaBlock", () => {
  it("is a warning-marked mrkdwn context block", () => {
    expect(missingMediaBlock({ missing: [STUCK] })).toEqual({
      elements: [
        {
          text:
            ":warning: 1 image could not be attached to this message: pr-checks.png (F_STUCK_1) — " +
            "Slack never finished processing it in 27 poll(s) over 118.2s",
          type: "mrkdwn",
        },
      ],
      type: "context",
    });
  });

  it("escapes mrkdwn control characters in a filename rather than showing markup", () => {
    const block = missingMediaBlock({ missing: [{ fileId: "F1", filename: "<a>&b.png", reason: "stuck" }] });

    expect(block).toEqual({
      elements: [
        {
          text: ":warning: 1 image could not be attached to this message: &lt;a&gt;&amp;b.png (F1) — stuck",
          type: "mrkdwn",
        },
      ],
      type: "context",
    });
  });
});

describe("wrapperWithMissingMediaNote", () => {
  it("appends the note as the LAST block, so it can never displace what is above the fold", () => {
    const noted = wrapperWithMissingMediaNote({ missing: [STUCK], wrapper: WRAPPER });

    expect(noted.blocks.length).toBe(2);
    expect(noted.blocks[0]).toEqual(WRAPPER.blocks[0]);
    expect(noted.blocks[1]).toEqual(missingMediaBlock({ missing: [STUCK] }));
  });

  it("keeps the wrapper's colour and fallback untouched", () => {
    const noted = wrapperWithMissingMediaNote({ missing: [STUCK], wrapper: WRAPPER });

    expect(noted.color).toBe("#6b21e8");
    expect(noted.fallback).toBe("The answer.");
  });

  it("returns the very same wrapper when nothing is missing", () => {
    expect(wrapperWithMissingMediaNote({ missing: [], wrapper: WRAPPER })).toBe(WRAPPER);
  });
});
