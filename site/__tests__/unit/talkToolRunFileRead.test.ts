/*
 * `file_read` through `runTalkTool`: a picture goes to the image seam and comes back as an image, a text window stays
 * an ordinary answer, and a picture whose bytes do not match its size is refused before the seam is reached.
 */
import { describe, expect, it } from "vitest";

import { runTalkTool } from "../../components/voice/talkToolRun";
import type { ToolSeams } from "../../components/voice/talkToolRunTypes";
import { seams, TOKEN } from "../talkToolSeams";

describe("runTalkTool — file_read", () => {
  /** The verb's answer for an eight-byte PNG signature. */
  const PNG_PAYLOAD = { base64: "iVBORw0KGgo=", kind: "image", mediaType: "image/png", path: "/tmp/card.png", size: 8 };

  /** The one image output the picture seam hands back. */
  const IMAGE_OUTPUT = [
    { detail: "high" as const, image_url: "data:image/webp;base64,UklGRg==", type: "input_image" as const },
  ];

  /**
   * Seams whose verb answers as given, and whose picture seam records what it was handed.
   *
   * @param answer what the verb route answered
   * @param handed where the picture seam records each image
   * @returns the seams
   */
  function fileSeams({ answer, handed }: { answer: unknown; handed: unknown[] }): ToolSeams {
    return {
      ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
      fileImage: async ({ image }) => {
        handed.push(image);
        return { answer: undefined, detail: "1229×768 of /tmp/card.png", output: IMAGE_OUTPUT };
      },
      verb: async () => ({ answer, detail: "read", refused: false }),
    };
  }

  it("hands a picture to the image seam and answers with the image, counted as a read", async () => {
    const handed: unknown[] = [];
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "file_read",
      rawArguments: JSON.stringify({ path: "/tmp/card.png" }),
      seams: fileSeams({ answer: PNG_PAYLOAD, handed }),
    });
    expect(handed).toEqual([{ base64: "iVBORw0KGgo=", mediaType: "image/png", path: "/tmp/card.png", size: 8 }]);
    expect([ran.image, ran.readText, ran.refused]).toEqual([IMAGE_OUTPUT, true, false]);
  });

  it("leaves a text window an ordinary answer, and refuses a malformed picture without reaching the seam", async () => {
    const handed: unknown[] = [];
    const window = {
      kind: "text",
      outline: [{ from: 44_613, level: 2, text: "Options you could bring back" }],
      path: "/tmp/notes.md",
      text: "hello",
    };
    const text = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "file_read",
      rawArguments: JSON.stringify({ path: "/tmp/notes.md" }),
      seams: fileSeams({ answer: window, handed }),
    });
    const bad = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "file_read",
      rawArguments: JSON.stringify({ path: "/tmp/card.png" }),
      seams: fileSeams({ answer: { ...PNG_PAYLOAD, size: 9 }, handed }),
    });
    expect([text.answer, text.image, text.refused]).toEqual([window, undefined, false]);
    expect([bad.answer, bad.refused, handed]).toEqual([
      { refused: "file_read answered a picture whose bytes do not match its 9-byte size" },
      true,
      [],
    ]);
  });
});
