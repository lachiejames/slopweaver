/**
 * The shared JSONL line reader, and the typed-row reader every sibling store now goes through.
 *
 * Why this file exists: `readJsonlRows` replaced `readFileSync(path, "utf8")` + `split("\n")` in
 * `members/`, `structures/` and `history/`. That construction stops working outright at V8's
 * `MAX_STRING_LENGTH` — `Cannot create a string longer than 0x1fffffe8 characters` — and holds a whole
 * file of transient heap long before it. The contract those callers depend on (blank lines skipped,
 * line-numbered warnings, `ENOENT` for an absent file, `split("\n")` semantics rather than `readline`'s)
 * has to survive the swap byte for byte, so it is asserted here rather than assumed.
 *
 * Real temp-dir round trips, which `testing.md` allows for a genuine fixture; no mocks anywhere.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READ_CHUNK_BYTES, readJsonlLines, readJsonlRows } from "../../../corpus/corpusStore.js";
import { isRecord } from "../../../lib/parsers.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slopweaver-jsonl-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Write a fixture file and return its path. */
function write({ content, name = "rows.jsonl" }: { content: string; name?: string }): string {
  const path = join(root, name);
  writeFileSync(path, content, "utf8");
  return path;
}

/** Read every line of a file into an array, the simplest use of the streaming reader. */
function linesOf({ path }: { path: string }): string[] {
  const seen: string[] = [];
  readJsonlLines({
    onLine: ({ line }) => {
      seen.push(line);
    },
    path,
  });
  return seen;
}

/** A per-line parser for the row tests: an object with a numeric `n`, or the reason it was rejected. */
function parseNumbered({ line }: { line: string }): { row: { n: number } } | { error: string } {
  const parsed: unknown = JSON.parse(line);
  if (!isRecord(parsed)) {
    return { error: "not an object" };
  }
  const n = parsed["n"];
  return typeof n === "number" ? { row: { n } } : { error: "no numeric n" };
}

describe("readJsonlLines", () => {
  it("delivers exactly what split(\\n) would, trailing empty slice included", () => {
    expect(linesOf({ path: write({ content: "a\nb\n" }) })).toEqual(["a", "b", ""]);
    expect(linesOf({ path: write({ content: "a\nb", name: "b.jsonl" }) })).toEqual(["a", "b"]);
    expect(linesOf({ path: write({ content: "", name: "c.jsonl" }) })).toEqual([""]);
    expect(linesOf({ path: write({ content: "\n\n", name: "d.jsonl" }) })).toEqual(["", "", ""]);
  });

  it("does NOT treat U+2028/U+2029 as line terminators, where readline would", () => {
    // The reason `history/store.ts` documented `split("\n")` and NOT `readline`: corpus payloads carry
    // arbitrary authored text, and a paragraph separator inside one is not a row boundary. Node's
    // `readline` splits on both of these; splitting on the 0x0a BYTE, as this reader does, cannot.
    const authored = "one\u2028two\u2029three";
    expect(linesOf({ path: write({ content: `${authored}\nlast\n` }) })).toEqual([authored, "last", ""]);
  });

  it("reads a file larger than one chunk, splitting no line and no code point", () => {
    // Wide characters at the split points, and a payload comfortably past the 8 MiB read window, so a
    // reader that cut a line — or cut a multi-byte sequence in half — produces mojibake here.
    const wide = `ü€𝄞${"x".repeat(1000)}`;
    const count = Math.ceil((READ_CHUNK_BYTES * 2) / Buffer.byteLength(`${wide}0\n`));
    const rows = Array.from({ length: count }, (_unused, i) => `${wide}${String(i)}`);
    const path = write({ content: `${rows.join("\n")}\n` });
    const read = linesOf({ path });
    expect(read).toHaveLength(count + 1);
    expect(read[0]).toBe(`${wide}0`);
    expect(read[count - 1]).toBe(`${wide}${String(count - 1)}`);
  });

  it("stops where onChunk says to, and calls it before the first read", () => {
    const path = write({ content: "a\nb\nc\n" });
    const seen: string[] = [];
    let calls = 0;
    readJsonlLines({
      onChunk: () => {
        calls += 1;
        return false;
      },
      onLine: ({ line }) => {
        seen.push(line);
      },
      path,
    });
    expect(calls).toBe(1);
    expect(seen).toEqual([]);
  });

  it("throws for a file that is not there, so a caller can type the failure itself", () => {
    expect(() => linesOf({ path: join(root, "absent.jsonl") })).toThrow();
  });

  it("reads through a symlink by default, and refuses one with ELOOP under noFollow", () => {
    const target = write({ content: "a\nb" });
    const link = join(root, "link.jsonl");
    symlinkSync(target, link);
    expect(linesOf({ path: link })).toEqual(["a", "b"]);
    expect(() => readJsonlLines({ noFollow: true, onLine: () => undefined, path: link })).toThrow("ELOOP");
    const seen: string[] = [];
    readJsonlLines({ noFollow: true, onLine: ({ line }) => seen.push(line), path: target });
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("readJsonlRows", () => {
  it("returns the parsed rows and skips blank lines without counting them", () => {
    const path = write({ content: '{"n":1}\n\n{"n":2}\n   \n{"n":3}\n' });
    const read = unwrap(readJsonlRows<{ n: number }>({ parseLine: parseNumbered, path }));
    expect(read.rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(read.warnings).toEqual([]);
  });

  it("numbers a rejected line by its 1-based position in the file", () => {
    const path = write({ content: '{"n":1}\n{"n":"two"}\n{"n":3}\n' });
    const read = unwrap(readJsonlRows<{ n: number }>({ parseLine: parseNumbered, path }));
    expect(read.rows).toEqual([{ n: 1 }, { n: 3 }]);
    expect(read.warnings).toEqual(["line 2: no numeric n"]);
  });

  it("reports an absent file as ENOENT, which callers read as `nothing stored yet`", () => {
    const error = unwrapErr(readJsonlRows<{ n: number }>({ parseLine: parseNumbered, path: join(root, "no.jsonl") }));
    expect(error.code).toBe("ENOENT");
  });

  it("carries a parser's own throw out as a typed failure rather than a crash", () => {
    // `JSON.parse` throws on a malformed line, and the sibling stores' parsers guard that themselves — but
    // the reader must not turn a parser bug into an unhandled exception mid-file either.
    const path = write({ content: "not json at all\n" });
    const error = unwrapErr(readJsonlRows<{ n: number }>({ parseLine: parseNumbered, path }));
    expect(error.operation).toBe("readJsonlRows");
  });

  it("reads a file spanning several chunks, in order", () => {
    const filler = "y".repeat(2000);
    const count = Math.ceil((READ_CHUNK_BYTES * 2) / (filler.length + 20));
    const rows = Array.from({ length: count }, (_unused, i) => JSON.stringify({ filler, n: i }));
    const path = write({ content: `${rows.join("\n")}\n` });
    const read = unwrap(readJsonlRows<{ n: number }>({ parseLine: parseNumbered, path }));
    expect(read.rows).toHaveLength(count);
    expect(read.rows[0]!.n).toBe(0);
    expect(read.rows[count - 1]!.n).toBe(count - 1);
    expect(read.warnings).toEqual([]);
  });
});
