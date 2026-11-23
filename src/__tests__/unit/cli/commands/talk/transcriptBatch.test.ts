/*
 * `talk transcript`'s batch on the way in: `-` reads the batch from stdin under the file rules, a named path reads the
 * file, and masking refuses the batch when the private denylist is there but unreadable rather than append it
 * unmasked.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { maskedBatch, readBatch, STDIN_FILE, sanitiseBatch } from "../../../../../cli/commands/talk/transcriptBatch.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { CallEntry } from "../../../../../talk/callRecord.js";

/** A GitHub token shape, built at run time so this file never carries one. */
const TOKEN = "ghp_" + "Z".repeat(30);

const SAID: CallEntry = {
  atIso: "2026-11-03T01:00:02.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "merge the pool fix",
  who: "owner",
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-batch-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A stdin that yields the given chunks. */
async function* stdin(...chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("readBatch", () => {
  it("reads `-` from stdin, across chunks", async () => {
    const line = JSON.stringify(SAID);
    const read = await readBatch({ entriesFile: STDIN_FILE, input: stdin(line.slice(0, 10), `${line.slice(10)}\n`) });
    expect(unwrap(read)).toEqual([SAID]);
  });

  it("refuses a piped line that is not a call line, naming stdin", async () => {
    const refused = unwrapErr(await readBatch({ entriesFile: STDIN_FILE, input: stdin("{}\n") }));
    expect([refused.code, refused.message]).toEqual(["CALL_ENTRIES_INVALID", expect.stringContaining("stdin")]);
  });

  it("reads a named batch file", async () => {
    const path = join(home, "batch.jsonl");
    writeFileSync(path, `${JSON.stringify(SAID)}\n`);
    expect(unwrap(await readBatch({ entriesFile: path }))).toEqual([SAID]);
  });
});

describe("maskedBatch", () => {
  it("refuses a malformed batch file for good, and a denylist it cannot read as worth posting again", async () => {
    const path = join(home, "batch.jsonl");
    writeFileSync(path, "{}\n");
    const malformed = unwrapErr(await maskedBatch({ entriesFile: path, home, origin: undefined }));
    expect([malformed.error.code, malformed.exit]).toEqual(["CALL_ENTRIES_INVALID", EXIT_USAGE]);
    writeFileSync(path, `${JSON.stringify(SAID)}\n`);
    mkdirSync(join(home, "hygiene-denylist.txt"));
    const unreadable = unwrapErr(await maskedBatch({ entriesFile: path, home, origin: undefined }));
    expect([unreadable.error.code, unreadable.exit]).toEqual(["CALL_DENYLIST_UNREADABLE", EXIT_ERROR]);
  });

  it("reads, masks and hands back a good batch", async () => {
    const path = join(home, "batch.jsonl");
    writeFileSync(path, `${JSON.stringify({ ...SAID, text: TOKEN })}\n`);
    const masked = unwrap(await maskedBatch({ entriesFile: path, home, origin: undefined }));
    expect(masked).toEqual({
      denylist: [],
      entries: [{ ...SAID, text: "[REDACTED:github-oauth-token]" }],
      redactions: [{ count: 1, label: "github-oauth-token" }],
      toolAnswersDropped: 0,
    });
  });
});

describe("sanitiseBatch", () => {
  it("masks against the home's denylist, and hands that denylist on for the store's last look", () => {
    writeFileSync(join(home, "hygiene-denylist.txt"), "acmesecretword\n");
    const sanitised = unwrap(sanitiseBatch({ entries: [{ ...SAID, text: `acmesecretword and ${TOKEN}` }], home }));
    expect(sanitised.entries).toEqual([{ ...SAID, text: "[REDACTED:denylist] and [REDACTED:github-oauth-token]" }]);
    expect(sanitised.denylist).toEqual(["acmesecretword"]);
  });

  it("masks credentials alone when the home has no denylist", () => {
    const sanitised = unwrap(sanitiseBatch({ entries: [{ ...SAID, text: `acmesecretword ${TOKEN}` }], home }));
    expect(sanitised.entries).toEqual([{ ...SAID, text: "acmesecretword [REDACTED:github-oauth-token]" }]);
  });

  it("refuses the batch when the denylist is there but unreadable", () => {
    mkdirSync(join(home, "hygiene-denylist.txt"));
    const refused = unwrapErr(sanitiseBatch({ entries: [SAID], home }));
    expect([refused.code, refused.message]).toEqual([
      "CALL_DENYLIST_UNREADABLE",
      expect.stringContaining("nothing appended: "),
    ]);
  });

  it("refuses the batch when the denylist is a dangling link, rather than mask against nothing", () => {
    symlinkSync(join(home, "gone-denylist.txt"), join(home, "hygiene-denylist.txt"));
    const refused = unwrapErr(sanitiseBatch({ entries: [{ ...SAID, text: "acmesecretword" }], home }));
    expect([refused.code, refused.message]).toEqual([
      "CALL_DENYLIST_UNREADABLE",
      expect.stringContaining("dangling link"),
    ]);
  });
});
