/**
 * The repo's one atomic, crash-durable file replace.
 *
 * Every case is a real temp-dir round trip, which `testing.md` allows for a genuine fixture. What CANNOT be
 * asserted from user space is the durability itself — whether the bytes reached the device is a question
 * only a power cut answers, and `fsyncSync` succeeding is the whole of the observable evidence. So these
 * cover the properties that ARE observable and that a regression would break: the exact bytes land, the
 * directory is created, nothing is left staged, an existing file is fully replaced rather than overwritten
 * in place, chunks concatenate in order, the modes are honoured, and a failure cleans up after itself.
 *
 * The durable append moved to `appendLines({ durable: true })`, whose fsync, mode and fresh-line cases are in
 * `appendSeparator.test.ts`.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicTempWriterPid,
  ensureDirectory,
  fsyncDirectories,
  fsyncFile,
  removeEntry,
  renameStagedFile,
  writeFileAtomic,
  writeFileAtomicStream,
} from "../../../lib/writeAtomic.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slopweaver-write-atomic-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("removeEntry", () => {
  it("removes one file and leaves its siblings", () => {
    writeFileSync(join(dir, "held.lock"), "123\n");
    writeFileSync(join(dir, "kept.txt"), "kept\n");
    removeEntry({ path: join(dir, "held.lock") });
    expect(readdirSync(dir)).toEqual(["kept.txt"]);
  });

  it("removes a directory with everything inside it", () => {
    mkdirSync(join(dir, "packet", "repo"), { recursive: true });
    writeFileSync(join(dir, "packet", "repo", "README.md"), "acme\n");
    removeEntry({ path: join(dir, "packet") });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("answers quietly for a name already gone", () => {
    removeEntry({ path: join(dir, "never-made.lock") });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("atomicTempWriterPid", () => {
  const uuid = "8f6ba4bd-fa70-43b2-bcc0-03df559d2394";

  it("reads the writer pid out of a staged write of exactly the target", () => {
    expect(atomicTempWriterPid({ name: `compact.jsonl.17469.${uuid}.tmp`, target: "compact.jsonl" })).toBe(17469);
  });

  it("answers undefined for anything that is not one of the target's staged writes", () => {
    const target = "compact.jsonl";
    expect(atomicTempWriterPid({ name: "compact.jsonl", target })).toBeUndefined();
    expect(atomicTempWriterPid({ name: "compact.jsonl.tmp", target })).toBeUndefined();
    expect(atomicTempWriterPid({ name: `other.jsonl.17469.${uuid}.tmp`, target })).toBeUndefined();
    expect(atomicTempWriterPid({ name: `compact.jsonl.x.17469.${uuid}.tmp`, target })).toBeUndefined();
    expect(atomicTempWriterPid({ name: `compact.jsonl.pid.${uuid}.tmp`, target })).toBeUndefined();
    expect(atomicTempWriterPid({ name: `compact.jsonl.17469.${uuid}.tmp.bak`, target })).toBeUndefined();
  });

  it("parses the very name writeFileAtomicStream stages under, back to this process", () => {
    const path = join(dir, "compact.jsonl");
    const staged: string[] = [];
    writeFileAtomicStream({
      path,
      produce: ({ write }) => {
        write({ text: "x\n" });
        staged.push(...readdirSync(dir));
      },
    });
    expect(staged).toHaveLength(1);
    expect(atomicTempWriterPid({ name: staged[0]!, target: "compact.jsonl" })).toBe(process.pid);
  });
});

describe("writeFileAtomic", () => {
  it("writes the exact bytes it was given", () => {
    const path = join(dir, "cursor.json");
    writeFileAtomic({ contents: '{"cursor":"2026-08-26"}\n', path });
    expect(readFileSync(path, "utf8")).toBe('{"cursor":"2026-08-26"}\n');
  });

  it("creates every missing parent directory", () => {
    const path = join(dir, "live", "slack", "dispatches", "C1-1.json");
    writeFileAtomic({ contents: "{}\n", path });
    expect(readFileSync(path, "utf8")).toBe("{}\n");
  });

  it("leaves no staging file behind", () => {
    const path = join(dir, "watermark.json");
    writeFileAtomic({ contents: "one\n", path });
    expect(readdirSync(dir)).toEqual(["watermark.json"]);
  });

  it("replaces an existing file whole, rather than overwriting its front", () => {
    const path = join(dir, "watermark.json");
    writeFileSync(path, "a much longer previous generation of this file\n", "utf8");
    writeFileAtomic({ contents: "short\n", path });
    expect(readFileSync(path, "utf8")).toBe("short\n");
  });

  it("concatenates an iterable of chunks in order", () => {
    const path = join(dir, "vectors.jsonl");
    writeFileAtomic({ contents: ["a\n", "b\n", "c\n"], path });
    expect(readFileSync(path, "utf8")).toBe("a\nb\nc\n");
  });

  it("treats a string as one chunk, never as its characters", () => {
    const path = join(dir, "one.txt");
    writeFileAtomic({ contents: "abc", path });
    expect(readFileSync(path, "utf8")).toBe("abc");
  });

  it("writes an empty file when given no chunks", () => {
    const path = join(dir, "empty.jsonl");
    writeFileAtomic({ contents: [], path });
    expect(readFileSync(path, "utf8")).toBe("");
  });

  it("honours the file mode", () => {
    const path = join(dir, "owner-directives.json");
    writeFileAtomic({ contents: "{}\n", fileMode: 0o600, path });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("lands the file at its final path already carrying the staged mtime, since the rename keeps it", () => {
    const path = join(dir, "plan-one.json");
    const stagedMtime = new Date("2026-11-06T01:00:00.000Z");
    writeFileAtomic({ contents: "{}\n", path, stagedMtime });
    expect(statSync(path).mtimeMs).toBe(stagedMtime.getTime());
  });

  it("honours the directory mode on a directory it creates", () => {
    const path = join(dir, "judgement", "owner-directives.json");
    writeFileAtomic({ contents: "{}\n", dirMode: 0o700, fileMode: 0o600, path });
    expect(statSync(join(dir, "judgement")).mode & 0o777).toBe(0o700);
  });

  it("is unaffected by a leftover staging file from an earlier crash", () => {
    const path = join(dir, "watermark.json");
    writeFileSync(`${path}.999.leftover.tmp`, "junk from a killed process\n", "utf8");
    writeFileAtomic({ contents: "fresh\n", path });
    expect(readFileSync(path, "utf8")).toBe("fresh\n");
  });

  it("throws, and stages nothing, when the parent path is a file rather than a directory", () => {
    const blocked = join(dir, "not-a-directory");
    writeFileSync(blocked, "", "utf8");
    expect(() => {
      writeFileAtomic({ contents: "{}\n", path: join(blocked, "child.json") });
    }).toThrow();
    expect(readdirSync(dir)).toEqual(["not-a-directory"]);
  });

  it("removes its staging file when the rename cannot land", () => {
    // The target path is an existing DIRECTORY, so the write succeeds and the rename fails — the one
    // ordering that can leave a staged file behind if the failure path forgets to clean up.
    const path = join(dir, "occupied");
    mkdirSync(join(path, "child"), { recursive: true });
    expect(() => {
      writeFileAtomic({ contents: "{}\n", path });
    }).toThrow();
    expect(readdirSync(dir)).toEqual(["occupied"]);
  });
});

describe("writeFileAtomicStream", () => {
  it("concatenates every write in the order the producer made them", () => {
    const path = join(dir, "compact.jsonl");
    writeFileAtomicStream({
      path,
      produce: ({ write }) => {
        write({ text: "a\n" });
        write({ text: "b\n" });
        write({ text: "c\n" });
      },
    });
    expect(readFileSync(path, "utf8")).toBe("a\nb\nc\n");
  });

  it("writes an empty file when the producer writes nothing", () => {
    const path = join(dir, "empty.jsonl");
    writeFileAtomicStream({ path, produce: () => undefined });
    expect(readFileSync(path, "utf8")).toBe("");
  });

  it("leaves the previous file untouched when the producer throws part-way through", () => {
    // The property bronze compaction depends on: a corrupt line found after megabytes are already staged
    // must abort with the target exactly as it was, and nothing staged left behind.
    const path = join(dir, "compact.jsonl");
    writeFileSync(path, "the previous generation\n", "utf8");
    expect(() => {
      writeFileAtomicStream({
        path,
        produce: ({ write }) => {
          write({ text: "x".repeat(4 * 1024 * 1024) });
          throw new Error("aborted mid-stream");
        },
      });
    }).toThrow("aborted mid-stream");
    expect(readFileSync(path, "utf8")).toBe("the previous generation\n");
    expect(readdirSync(dir)).toEqual(["compact.jsonl"]);
  });

  it("creates every missing parent directory and honours both modes", () => {
    const path = join(dir, "bronze", "slack", "compact.jsonl");
    writeFileAtomicStream({
      dirMode: 0o700,
      fileMode: 0o600,
      path,
      produce: ({ write }) => {
        write({ text: "{}\n" });
      },
    });
    expect(readFileSync(path, "utf8")).toBe("{}\n");
    expect(statSync(join(dir, "bronze", "slack")).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("renameStagedFile", () => {
  it("moves the staged bytes onto the destination and leaves the staged path gone", () => {
    const staged = join(dir, "kind.jsonl.publishing");
    const destination = join(dir, "kind.jsonl");
    writeFileSync(destination, "the previous generation\n", "utf8");
    writeFileSync(staged, "the next generation\n", "utf8");
    renameStagedFile({ flushDirectory: true, from: staged, to: destination });
    expect(readFileSync(destination, "utf8")).toBe("the next generation\n");
    expect(readdirSync(dir)).toEqual(["kind.jsonl"]);
  });

  it("moves the bytes just the same when the caller defers the directory flush", () => {
    const staged = join(dir, "kind.jsonl.publishing");
    const destination = join(dir, "kind.jsonl");
    writeFileSync(staged, "the next generation\n", "utf8");
    renameStagedFile({ flushDirectory: false, from: staged, to: destination });
    fsyncDirectories({ paths: [destination] });
    expect(readFileSync(destination, "utf8")).toBe("the next generation\n");
    expect(readdirSync(dir)).toEqual(["kind.jsonl"]);
  });

  it("throws when the staged file is not there, having moved nothing", () => {
    const destination = join(dir, "kind.jsonl");
    writeFileSync(destination, "the previous generation\n", "utf8");
    expect(() => {
      renameStagedFile({ flushDirectory: true, from: join(dir, "absent.publishing"), to: destination });
    }).toThrow("ENOENT");
    expect(readFileSync(destination, "utf8")).toBe("the previous generation\n");
  });
});

describe("fsyncDirectories", () => {
  it("accepts several paths in one directory, and a directory that is not there, without throwing", () => {
    mkdirSync(join(dir, "nested"), { recursive: true });
    const paths = [join(dir, "a.jsonl"), join(dir, "b.jsonl"), join(dir, "nested", "c.jsonl")];
    fsyncDirectories({ paths });
    fsyncDirectories({ paths: [join(dir, "gone", "d.jsonl")] });
    expect(readdirSync(dir)).toEqual(["nested"]);
  });
});

describe("ensureDirectory", () => {
  it("makes every missing ancestor, and a second call over the same tree changes nothing", () => {
    const deepest = join(dir, "ledgers", "linear-documents");
    ensureDirectory({ directory: deepest });
    ensureDirectory({ directory: deepest });
    expect(readdirSync(dir)).toEqual(["ledgers"]);
    expect(readdirSync(join(dir, "ledgers"))).toEqual(["linear-documents"]);
    expect(statSync(deepest).isDirectory()).toBe(true);
  });

  it("throws EEXIST when the path is already a regular file", () => {
    writeFileSync(join(dir, "ledgers"), "", "utf8");
    expect(() => ensureDirectory({ directory: join(dir, "ledgers") })).toThrow("EEXIST");
  });
});

describe("fsyncFile", () => {
  it("flushes a file without changing it, and throws on one that is not there", () => {
    const path = join(dir, "hand.jsonl");
    writeFileSync(path, "one\n", "utf8");
    fsyncFile({ path });
    expect(readFileSync(path, "utf8")).toBe("one\n");
    expect(() => fsyncFile({ path: join(dir, "absent.jsonl") })).toThrow("ENOENT");
  });
});
