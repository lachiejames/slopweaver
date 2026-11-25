/**
 * `needsSeparator` is true only for an existing, non-empty file whose LAST BYTE is not LF. A missing or empty
 * file needs none; CRLF ends in LF, so it needs none either; a lone CR does. `appendLines` is the append every
 * line-oriented file goes through: it puts a record on a fresh line after a torn tail, buffered or durable, and
 * with `noFollow` refuses a symlink at its path rather than appending into the link's target.
 */
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendLines, descriptorNeedsSeparator, needsSeparator } from "../../../lib/appendSeparator.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "appendsep-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write `content` to a fresh journal file in the temp directory and answer its path. */
function journalWith({ content }: { content: string }): string {
  const path = join(dir, "journal.jsonl");
  writeFileSync(path, content, "utf8");
  return path;
}

describe("needsSeparator", () => {
  it("answers false for a file that does not exist yet", () => {
    expect(needsSeparator({ path: join(dir, "absent.jsonl") })).toBe(false);
  });

  it("answers false for an empty file", () => {
    expect(needsSeparator({ path: journalWith({ content: "" }) })).toBe(false);
  });

  it("answers false for a file ending in a newline", () => {
    expect(needsSeparator({ path: journalWith({ content: '{"a":1}\n' }) })).toBe(false);
  });

  it("answers false for a file ending in CRLF, because its last byte is LF", () => {
    expect(needsSeparator({ path: journalWith({ content: '{"a":1}\r\n' }) })).toBe(false);
  });

  it("answers true for a file whose last line was cut off before its newline", () => {
    expect(needsSeparator({ path: journalWith({ content: '{"a":1}\n{"b":' }) })).toBe(true);
  });

  it("answers true for a file ending in a lone carriage return", () => {
    expect(needsSeparator({ path: journalWith({ content: '{"a":1}\r' }) })).toBe(true);
  });

  it("answers false for a directory, which cannot be read as a file", () => {
    expect(needsSeparator({ path: dir })).toBe(false);
  });

  it("answers false for a file it may not read, leaving the decision to whatever the caller does next", () => {
    const path = journalWith({ content: '{"a":1}\n' });
    chmodSync(path, 0o200);
    expect(needsSeparator({ path })).toBe(false);
  });
});

describe("descriptorNeedsSeparator", () => {
  // A macOS sandbox denial of file-read-data (EPERM) is answered as EACCES is; neither is reproducible without a
  // sandbox profile, so the mode-0200 cases below witness the shared branch.
  /** Open `path` write-only for append and answer the probe on that held descriptor. */
  function probeAt({ path }: { path: string }): boolean {
    const fd = openSync(path, "a");
    try {
      return descriptorNeedsSeparator({ fd, path });
    } finally {
      closeSync(fd);
    }
  }

  it("answers true for a write-only descriptor whose file was cut off mid-line", () => {
    expect(probeAt({ path: journalWith({ content: '{"a":1}\n{"b":' }) })).toBe(true);
  });

  it("answers false for a descriptor whose file ends in a newline", () => {
    expect(probeAt({ path: journalWith({ content: '{"a":1}\n' }) })).toBe(false);
  });

  it("answers false for an empty file, which has no tail to separate from", () => {
    expect(probeAt({ path: journalWith({ content: "" }) })).toBe(false);
  });

  it("answers true for a write-only file it may not read, so a record never fuses onto a tail it could not see", () => {
    const path = journalWith({ content: '{"a":1}\n' });
    chmodSync(path, 0o200);
    expect(probeAt({ path })).toBe(true);
  });

  it("probes the file a symlink reaches, as the held open did, rather than refusing the link", () => {
    const target = journalWith({ content: '{"a":1}\n{"b":' });
    const link = join(dir, "link.jsonl");
    symlinkSync(target, link);
    expect(probeAt({ path: link })).toBe(true);
  });

  it("refuses with noFollow a name swapped for a link to the held file, which the default probe follows", () => {
    const path = journalWith({ content: '{"a":1}\n{"b":' });
    const fd = openSync(path, "a");
    try {
      const moved = join(dir, "moved.jsonl");
      renameSync(path, moved);
      symlinkSync(moved, path);
      expect(descriptorNeedsSeparator({ fd, path })).toBe(true);
      expect(() => descriptorNeedsSeparator({ fd, noFollow: true, path })).toThrow(/ELOOP/u);
    } finally {
      closeSync(fd);
    }
  });

  it("throws when the name now reaches a different file than the held descriptor", () => {
    const path = journalWith({ content: '{"a":1}\n{"b":' });
    const fd = openSync(path, "a");
    try {
      renameSync(path, join(dir, "moved.jsonl"));
      writeFileSync(path, "fresh\n", "utf8");
      expect(() => descriptorNeedsSeparator({ fd, path })).toThrow(/was replaced between its append open/u);
    } finally {
      closeSync(fd);
    }
  });
});

describe("appendLines", () => {
  describe.each([
    { durable: false, name: "buffered", noFollow: false },
    { durable: true, name: "durable", noFollow: false },
    { durable: false, name: "buffered, noFollow", noFollow: true },
    { durable: true, name: "durable, noFollow", noFollow: true },
  ])("$name", ({ durable, noFollow }) => {
    it("starts the record on a fresh line on a file it may append to but not read, rather than throwing", () => {
      const path = journalWith({ content: '{"a":1}\n{"b":' });
      chmodSync(path, 0o200);
      appendLines({ durable, noFollow, path, text: '{"c":3}\n' });
      chmodSync(path, 0o600);
      expect(readFileSync(path, "utf8")).toBe('{"a":1}\n{"b":\n{"c":3}\n');
    });

    it("starts the record on a fresh line after a torn tail, so both lines survive apart", () => {
      const path = journalWith({ content: '{"a":1}\n{"b":' });
      appendLines({ durable, noFollow, path, text: '{"c":3}\n' });
      expect(readFileSync(path, "utf8")).toBe('{"a":1}\n{"b":\n{"c":3}\n');
    });

    it("adds nothing before the record when the tail is whole", () => {
      const path = journalWith({ content: '{"a":1}\n' });
      appendLines({ durable, noFollow, path, text: '{"c":3}\n' });
      expect(readFileSync(path, "utf8")).toBe('{"a":1}\n{"c":3}\n');
    });

    it("terminates a record written without its newline, so the next append cannot fuse with it", () => {
      const path = journalWith({ content: "" });
      appendLines({ durable, noFollow, path, text: '{"c":3}' });
      appendLines({ durable, noFollow, path, text: '{"d":4}' });
      expect(readFileSync(path, "utf8")).toBe('{"c":3}\n{"d":4}\n');
    });

    it("creates an absent file with the mode it is given", () => {
      const path = join(dir, "created.jsonl");
      appendLines({ durable, mode: 0o600, noFollow, path, text: "one\ntwo\n" });
      expect(readFileSync(path, "utf8")).toBe("one\ntwo\n");
      expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it("leaves an existing file's mode as it was", () => {
      const path = journalWith({ content: "one\n" });
      chmodSync(path, 0o644);
      appendLines({ durable, mode: 0o600, noFollow, path, text: "two\n" });
      expect(statSync(path).mode & 0o777).toBe(0o644);
    });

    it("writes nothing at all for empty text, not even a separator onto a torn tail", () => {
      const path = journalWith({ content: '{"b":' });
      appendLines({ durable, noFollow, path, text: "" });
      expect(readFileSync(path, "utf8")).toBe('{"b":');
    });

    it("still creates an absent file for empty text, with its mode, as an empty appendFileSync did", () => {
      const path = join(dir, "empty.jsonl");
      appendLines({ durable, mode: 0o600, noFollow, path, text: "" });
      expect(readFileSync(path, "utf8")).toBe("");
      expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it("still throws for empty text when the file's directory is missing", () => {
      expect(() => {
        appendLines({ durable, noFollow, path: join(dir, "missing", "x.jsonl"), text: "" });
      }).toThrow(/ENOENT/u);
    });

    it("throws rather than appending blind when the path is a directory it cannot append to", () => {
      expect(() => {
        appendLines({ durable, noFollow, path: dir, text: "x\n" });
      }).toThrow(/EISDIR/u);
    });
  });

  describe.each([
    { durable: false, name: "buffered" },
    { durable: true, name: "durable" },
  ])("a symlink at the path, $name", ({ durable }) => {
    /** A target file carrying distinctive bytes, and a link to it at the path an append is aimed at. */
    function linkedTarget(): { link: string; target: string } {
      const target = join(dir, "artifact.md");
      writeFileSync(target, "# written once\nthe witness\n", "utf8");
      const link = join(dir, "ledger.jsonl");
      symlinkSync(target, link);
      return { link, target };
    }

    it("is refused with noFollow, leaving its target byte-for-byte as it was and the link in place", () => {
      const { link, target } = linkedTarget();
      const before = readFileSync(target);
      expect(() => {
        appendLines({ durable, noFollow: true, path: link, text: '{"row":1}\n' });
      }).toThrow(/ELOOP/u);
      expect(readFileSync(target).equals(before)).toBe(true);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
    });

    it("is still followed by default, appending into its target, for a caller that reaches its file through a link", () => {
      const { link, target } = linkedTarget();
      appendLines({ durable, path: link, text: '{"row":1}\n' });
      expect(readFileSync(target, "utf8")).toBe('# written once\nthe witness\n{"row":1}\n');
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
    });
  });
});
