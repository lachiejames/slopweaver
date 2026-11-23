/**
 * `readLocalText` reads one window out of an open descriptor, taking the bytes the picture sniff already read
 * rather than reading them again. The head passed here deliberately differs from the file on disk, so a re-read
 * would show up in the text.
 */
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { LocalFileErrors } from "../../../talk/localFileErrors.js";
import { readLocalText } from "../../../talk/localText.js";

describe("readLocalText", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "local-text-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  /** Read the whole of `content` as one window, handing over `head` as already read. */
  function readWhole({ content, head }: { content: string | Buffer; head: Buffer }): ReturnType<typeof readLocalText> {
    const path = join(dir, "file.txt");
    writeFileSync(path, content);
    const size = Buffer.byteLength(content);
    const fd = openSync(path, "r");
    try {
      return readLocalText({
        denylist: [],
        fd,
        head,
        path,
        planned: { end: size, nextFrom: null, start: 0, truncated: false },
        real: path,
        size,
      });
    } finally {
      closeSync(fd);
    }
  }

  it("uses the sniffed head for the opening bytes and reads only the rest", () => {
    const read = unwrap(readWhole({ content: "hello world\n", head: Buffer.from("HELLO") }));
    expect(read.text).toBe("HELLO world\n");
    expect(read.kind).toBe("text");
    expect(read.window).toEqual({ end: 12, nextFrom: null, start: 0, truncated: false });
  });

  it("refuses a window holding a NUL byte as binary", () => {
    expect(unwrapErr(readWhole({ content: Buffer.from([0x41, 0x00, 0x42]), head: Buffer.from([0x41]) }))).toEqual(
      LocalFileErrors.binary({ path: join(dir, "file.txt"), size: 3 }),
    );
  });
});
