/**
 * The streaming JSON-array splitter: every element of a top-level array handed over as its own text, whatever
 * the chunk boundaries, and a document that is not one whole array refused rather than half-read.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonArraySplitter } from "../../../lib/jsonArrayElements.js";
import { JsonArrayErrors } from "../../../lib/jsonArrayErrors.js";
import { readJsonArrayElements } from "../../../lib/jsonArrayFile.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** Split `text` fed `size` characters at a time, answering every element in order. */
function splitInChunks({ text, size }: { text: string; size: number }): readonly string[] {
  const splitter = createJsonArraySplitter();
  const out: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    out.push(...unwrap(splitter.push({ chunk: text.slice(index, index + size) })));
  }
  unwrap(splitter.end());
  return out;
}

const DOCUMENT = '[ {"a":1,"b":"x]}"} , {"c":[1,{"d":"\\"}"}]}, "plain", 42, true, null, [1,[2]] ]\n';
const ELEMENTS = ['{"a":1,"b":"x]}"}', '{"c":[1,{"d":"\\"}"}]}', '"plain"', "42", "true", "null", "[1,[2]]"];

describe("createJsonArraySplitter", () => {
  it("hands over every element of an array whole, brackets and quotes inside strings ignored", () => {
    expect(splitInChunks({ size: DOCUMENT.length, text: DOCUMENT })).toEqual(ELEMENTS);
  });

  it("answers the same elements whatever the chunk boundaries", () => {
    for (const size of [1, 2, 3, 7, 13]) {
      expect(splitInChunks({ size, text: DOCUMENT })).toEqual(ELEMENTS);
    }
  });

  it("answers no elements for an empty array, and accepts a leading byte-order mark", () => {
    expect(splitInChunks({ size: 1, text: "﻿ [ ]" })).toEqual([]);
  });

  it("refuses a document that is not an array", () => {
    const splitter = createJsonArraySplitter();
    expect(unwrapErr(splitter.push({ chunk: '{"a":1}' }))).toEqual(JsonArrayErrors.notAnArray({ opensWith: "{" }));
    expect(JsonArrayErrors.notAnArray({ opensWith: "{" }).message).toBe(
      'not a JSON array: the document opens with "{"',
    );
  });

  it("refuses an array that never closes, because a cut-short export must not read as whole", () => {
    const splitter = createJsonArraySplitter();
    expect(unwrap(splitter.push({ chunk: '[{"a":1},{"b":' }))).toEqual(['{"a":1}']);
    expect(unwrapErr(splitter.end()).code).toBe("UNCLOSED");
  });

  it("refuses text after the array closes, naming where", () => {
    const splitter = createJsonArraySplitter();
    expect(unwrapErr(splitter.push({ chunk: "[1] [2]" }))).toEqual({
      code: "TRAILING_TEXT",
      message: "text after the array closed, at character 4",
      offset: 4,
    });
  });

  it("refuses a misplaced or missing comma, so a corrupt list never reads as fewer whole elements", () => {
    const cases = [
      { char: ",", offset: 1, text: "[,{}]" },
      { char: ",", offset: 4, text: "[{},,{}]" },
      { char: "]", offset: 4, text: "[{},]" },
      { char: "{", offset: 4, text: "[{} {}]" },
      { char: '"', offset: 4, text: '[[1]"a"]' },
    ];
    expect(cases.map(({ text }) => unwrapErr(createJsonArraySplitter().push({ chunk: text })))).toEqual(
      cases.map(({ char, offset }) => JsonArrayErrors.misplacedSeparator({ char, offset })),
    );
    expect(JsonArrayErrors.misplacedSeparator({ char: "{", offset: 4 }).message).toBe(
      'not a whole JSON array: "{" at character 4 breaks the comma-separated element list',
    );
  });

  it("refuses a trailing comma after a scalar, whatever the chunk boundaries", () => {
    const splitter = createJsonArraySplitter();
    expect(unwrap(splitter.push({ chunk: "[1," }))).toEqual(["1"]);
    expect(unwrapErr(splitter.push({ chunk: "]" }))).toEqual(
      JsonArrayErrors.misplacedSeparator({ char: "]", offset: 3 }),
    );
  });

  it("refuses an empty document", () => {
    expect(unwrapErr(createJsonArraySplitter().end()).code).toBe("EMPTY_DOCUMENT");
  });

  it("hands over an element exactly at the cap", () => {
    const splitter = createJsonArraySplitter({ maxElementChars: 9 });
    expect(unwrap(splitter.push({ chunk: '[{"a":"x"},' }))).toEqual(['{"a":"x"}']);
  });

  it("refuses an element past the cap while it is still open, before it is ever joined", () => {
    // One enormous element can be the whole document, so the refusal has to fire mid-element, chunk by chunk.
    const splitter = createJsonArraySplitter({ maxElementChars: 9 });
    expect(unwrap(splitter.push({ chunk: '[{"a":"' }))).toEqual([]);
    expect(unwrapErr(splitter.push({ chunk: "xxxxx" }))).toEqual(JsonArrayErrors.elementTooLarge({ limit: 9 }));
  });

  it("refuses an element past the cap that closes inside the chunk that carried it over", () => {
    const splitter = createJsonArraySplitter({ maxElementChars: 9 });
    expect(unwrapErr(splitter.push({ chunk: '[{"a":"xy"}]' }))).toEqual(JsonArrayErrors.elementTooLarge({ limit: 9 }));
    expect(JsonArrayErrors.elementTooLarge({ limit: 9 }).message).toBe(
      "an element passed 9 characters before it closed, so it was refused rather than read whole",
    );
  });
});

describe("readJsonArrayElements", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reads a file element by element, a multi-byte character intact", () => {
    dir = mkdtempSync(join(tmpdir(), "jae-"));
    const path = join(dir, "conversations.json");
    writeFileSync(path, '[{"title":"café ☕"},{"title":"two"}]');
    const seen: string[] = [];
    const read = readJsonArrayElements({
      onElement: ({ text }) => {
        seen.push(text);
        return true;
      },
      path,
    });
    expect(unwrap(read)).toEqual({ elements: 2, stoppedEarly: false });
    expect(seen).toEqual(['{"title":"café ☕"}', '{"title":"two"}']);
  });

  it("keeps a character whole when it is split across two reads", () => {
    dir = mkdtempSync(join(tmpdir(), "jae-"));
    const path = join(dir, "conversations.json");
    // `["` is two bytes, so the two bytes of `é` straddle the 1 MiB read boundary.
    const padding = "a".repeat(1024 * 1024 - 3);
    writeFileSync(path, `["${padding}é"]`);
    const seen: string[] = [];
    const read = readJsonArrayElements({
      onElement: ({ text }) => {
        seen.push(text.slice(-3));
        return true;
      },
      path,
    });
    expect([unwrap(read), seen]).toEqual([{ elements: 1, stoppedEarly: false }, ['aé"']]);
  });

  it("refuses a file that is not UTF-8 by name, never reading a replacement character in its place", () => {
    dir = mkdtempSync(join(tmpdir(), "jae-"));
    const path = join(dir, "conversations.json");
    writeFileSync(path, Buffer.concat([Buffer.from('[{"title":"bad '), Buffer.from([0xff]), Buffer.from(' title"}]')]));
    const seen: string[] = [];
    const read = readJsonArrayElements({
      onElement: ({ text }) => {
        seen.push(text);
        return true;
      },
      path,
    });
    expect([unwrapErr(read), seen]).toEqual([JsonArrayErrors.notUtf8({ path }), []]);
    expect(unwrapErr(read).message).toBe(
      `${path} is not UTF-8: it holds a byte no character is, which would be read as U+FFFD and pass for clean text`,
    );
  });

  it("stops when the callback says so", () => {
    dir = mkdtempSync(join(tmpdir(), "jae-"));
    const path = join(dir, "conversations.json");
    writeFileSync(path, "[1,2,3]");
    const read = readJsonArrayElements({ onElement: () => false, path });
    expect(unwrap(read)).toEqual({ elements: 1, stoppedEarly: true });
  });

  it("names the file when it cannot be opened", () => {
    dir = mkdtempSync(join(tmpdir(), "jae-"));
    const path = join(dir, "absent.json");
    const read = readJsonArrayElements({ onElement: () => true, path });
    expect(unwrapErr(read).code).toBe("FILE_UNREADABLE");
    expect(unwrapErr(read).message).toContain(`cannot open ${path}`);
  });

  it("prefixes a splitter refusal with the file it was found in", () => {
    dir = mkdtempSync(join(tmpdir(), "jae-"));
    const path = join(dir, "conversations.json");
    writeFileSync(path, '[{"a":1},');
    const read = readJsonArrayElements({ onElement: () => true, path });
    expect(unwrapErr(read)).toEqual({
      code: "UNCLOSED",
      message: `${path}: the array never closed: the document ends inside it, so it was cut short`,
    });
  });
});
