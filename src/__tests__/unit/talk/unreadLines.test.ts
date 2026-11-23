/**
 * The bytes-to-lines half of `talk unread`'s read: whole lines handed over in order with their offsets, the bytes after
 * the last newline counted rather than handed over, and a line decoded only when it parses whole.
 */
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodedLine, forEachWholeLine, type PlacedLine } from "../../../talk/unreadLines.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("forEachWholeLine", () => {
  it("hands over each whole line with its offset and counts the bytes after the last newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-unread-lines-"));
    dirs.push(dir);
    const path = join(dir, "call.jsonl");
    writeFileSync(path, "ab\ncde\nfg");
    const fd = openSync(path, "r");
    const lines: { offset: number; text: string }[] = [];
    const onLine = (line: PlacedLine): void => {
      lines.push({ offset: line.byteOffset, text: line.bytes.toString("utf8") });
    };
    const trailing = forEachWholeLine({ end: 9, fd, onLine, start: 0 });
    closeSync(fd);
    expect({ lines, trailing }).toEqual({
      lines: [
        { offset: 0, text: "ab" },
        { offset: 3, text: "cde" },
      ],
      trailing: 2,
    });
  });
});

describe("decodedLine", () => {
  const open = { atIso: "2026-10-12T05:04:00.000Z", kind: "open", model: "m", sessionId: "x", voice: "v" };

  it("decodes a call line into its text and entry", () => {
    const text = JSON.stringify(open);
    expect(decodedLine({ bytes: Buffer.from(text, "utf8") })).toEqual({ entry: open, text });
  });

  it("prints bytes that are not UTF-8 as hex and parses none of them", () => {
    expect(decodedLine({ bytes: Buffer.from([0xff]) })).toEqual({ entry: undefined, text: "not UTF-8, as hex: ff" });
  });

  it("hands back a line that is not a call line as text alone", () => {
    expect(decodedLine({ bytes: Buffer.from("not json", "utf8") })).toEqual({ entry: undefined, text: "not json" });
  });
});
