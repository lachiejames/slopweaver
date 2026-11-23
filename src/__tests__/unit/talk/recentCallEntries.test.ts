/*
 * `readRecentCallEntries` — every call file written since an instant, read as raw lines with its unparsed-line count,
 * for a reader that cuts the owner's utterances out of them. A file last written before the floor is never opened.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { callsDir, readRecentCallEntries } from "../../../talk/callStore.js";

const OLD_CALL = "9b2f1c3e-4d5a-4b6c-8d7e-0f1a2b3c4d5e";
const NEW_CALL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const LINE =
  '{"atIso":"2026-11-08T13:55:41.000Z","final":true,"id":"s-1","kind":"segment","open":"ask:abc","text":"I have saved it","who":"owner"}';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-recent-calls-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readRecentCallEntries", () => {
  it("reads only files written since the floor, counting a torn line", () => {
    const dir = callsDir({ home });
    mkdirSync(dir, { mode: 0o700, recursive: true });
    const oldPath = join(dir, `${OLD_CALL}.jsonl`);
    writeFileSync(oldPath, `${LINE}\n`, { mode: 0o600 });
    utimesSync(oldPath, new Date("2026-11-01T00:00:00.000Z"), new Date("2026-11-01T00:00:00.000Z"));
    const newPath = join(dir, `${NEW_CALL}.jsonl`);
    writeFileSync(newPath, `${LINE}\n{"atIso":"2026-11-08T13:5`, { mode: 0o600 });
    utimesSync(newPath, new Date("2026-11-08T14:00:00.000Z"), new Date("2026-11-08T14:00:00.000Z"));

    const read = unwrap(readRecentCallEntries({ home, sinceIso: "2026-11-07T11:04:00.000Z" }));
    expect(read.unreadable).toEqual([]);
    expect(read.calls.map((call) => [call.callId, call.entries.length, call.skipped])).toEqual([[NEW_CALL, 1, 1]]);
    expect(read.calls[0]!.entries[0]!.kind).toBe("segment");
  });

  it("reads nothing, and fails nothing, when no call was ever written", () => {
    expect(unwrap(readRecentCallEntries({ home, sinceIso: "2026-11-07T11:04:00.000Z" }))).toEqual({
      calls: [],
      unreadable: [],
    });
  });
});
