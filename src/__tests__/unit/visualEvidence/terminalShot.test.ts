/**
 * The terminal shot: terminal text cleaned the way a screen shows it, a line range refused when it cannot be kept,
 * and the render through real Jimp whose receipt records exactly the words drawn and the crop out of the whole text.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import { frameTextLines } from "../../../visualEvidence/frameText.js";
import { wholeFrameProblem } from "../../../visualEvidence/imageChecks.js";
import { imageDigestOf } from "../../../visualEvidence/imageIo.js";
import { metadataChunksIn } from "../../../visualEvidence/pngMetadata.js";
import {
  MAX_TERMINAL_LINE_CHARS,
  renderTerminalShot,
  selectTerminalLines,
  TERMINAL_PADDING_PX,
  terminalScreenLines,
} from "../../../visualEvidence/terminalShot.js";

const SCREEN = "$ yarn test\n\u001b[32m PASS \u001b[0m unit/a.test.ts\nTests  12 passed\n$ \n\n";

describe("terminalScreenLines", () => {
  it("strips colour escapes, drops trailing blank lines and trims each line's end", () => {
    expect(terminalScreenLines({ text: SCREEN })).toEqual([
      "$ yarn test",
      " PASS  unit/a.test.ts",
      "Tests  12 passed",
      "$",
    ]);
  });

  it("keeps what follows a carriage return, expands a tab to the next stop, and drops other control characters", () => {
    expect(terminalScreenLines({ text: "50%\r100%\r\nab\tc\u0007d" })).toEqual(["100%", "ab      cd"]);
  });

  it("strips an OSC title sequence", () => {
    expect(terminalScreenLines({ text: "\u001b]0;acme title\u0007done" })).toEqual(["done"]);
  });
});

describe("selectTerminalLines", () => {
  const lines = ["one", "two", "", "four"];

  it("keeps every line when no range is given, and the range asked for otherwise", () => {
    expect(unwrap(selectTerminalLines({ lines, range: undefined }))).toEqual({
      kept: lines,
      range: { from: 1, to: 4 },
    });
    expect(unwrap(selectTerminalLines({ lines, range: { from: 2, to: 2 } }))).toEqual({
      kept: ["two"],
      range: { from: 2, to: 2 },
    });
  });

  it("refuses empty text, a range off the text, a blank selection and an over-long line, each by name", () => {
    expect(
      visualEvidenceErrorLines({ error: unwrapErr(selectTerminalLines({ lines: [], range: undefined })) }),
    ).toContain("the terminal text holds no lines to draw");
    expect(
      visualEvidenceErrorLines({ error: unwrapErr(selectTerminalLines({ lines, range: { from: 3, to: 9 } })) }),
    ).toContain("lines 3-9 do not lie inside the text's 4 lines");
    expect(
      visualEvidenceErrorLines({ error: unwrapErr(selectTerminalLines({ lines, range: { from: 3, to: 3 } })) }),
    ).toContain("every kept line is blank, so the picture would show nothing");
    const long = ["x".repeat(MAX_TERMINAL_LINE_CHARS + 1)];
    expect(
      visualEvidenceErrorLines({ error: unwrapErr(selectTerminalLines({ lines: long, range: undefined })) }),
    ).toContain(
      `line 1 is ${String(MAX_TERMINAL_LINE_CHARS + 1)} characters; at most ${String(MAX_TERMINAL_LINE_CHARS)} are drawn legibly`,
    );
  });
});

describe("renderTerminalShot", () => {
  it("renders the kept lines, records each drawn word as frame text, and crops out of the whole text", async () => {
    const shot = unwrap(
      await renderTerminalShot({
        capturedAtIso: "2026-11-17T01:00:00.000Z",
        label: "acme test pane",
        out: "/tmp/terminal.png",
        range: { from: 2, to: 3 },
        text: SCREEN,
      }),
    );
    const { receipt } = shot;
    expect(metadataChunksIn({ bytes: shot.bytes })).toEqual([]);
    expect(receipt.final.artifact.digest).toBe(imageDigestOf({ bytes: shot.bytes }));
    expect(receipt.captureId).toBe(`cap-${receipt.final.artifact.digest.slice(7, 23)}`);
    expect(receipt.verb).toBe("browser terminal-shot");
    expect(receipt.detail).toEqual({ label: "acme test pane", lines: { from: 2, to: 3 }, sourceLines: 4 });
    expect(receipt.frameText.kind).toBe("exact");
    expect(frameTextLines({ frameText: receipt.frameText })).toBe("PASS unit/a.test.ts\nTests 12 passed");
    expect(receipt.frameText.items[0]!.rect.y).toBe(TERMINAL_PADDING_PX);
    expect(receipt.cropRect.height).toBe(receipt.final.artifact.heightPx);
    expect(receipt.cropRect.height).toBeLessThan(receipt.source.heightPx);
    expect(wholeFrameProblem({ cropRect: receipt.cropRect, source: receipt.source })).toBe(null);
  });

  it("records a whole-text render as the whole frame, which the crop rule refuses", async () => {
    const { receipt } = unwrap(
      await renderTerminalShot({
        capturedAtIso: "2026-11-17T01:00:00.000Z",
        label: "acme test pane",
        out: "/tmp/terminal.png",
        range: undefined,
        text: SCREEN,
      }),
    );
    expect(receipt.cropRect).toEqual({ height: receipt.source.heightPx, width: receipt.source.widthPx, x: 0, y: 0 });
    expect(wholeFrameProblem({ cropRect: receipt.cropRect, source: receipt.source })).not.toBe(null);
  });
});
