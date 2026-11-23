/*
 * Which call files a read opens, decided from their write times: the newest few, those written since an instant, or
 * every file until none older-written can hold a newer call anyone spoke on — and, when a `speaking` read stops, any
 * file appended to since it was listed.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chosenFiles, spokenEnough, writtenSinceListed } from "../../../talk/callReadWindow.js";

const MINUTE = 60_000;
const OPENED = Date.parse("2026-10-10T16:00:00.000Z");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "call-read-window-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** A call file last written at `atMs`. */
function written({ name, atMs }: { name: string; atMs: number }): { path: string; mtimeMs: number } {
  const path = join(dir, name);
  writeFileSync(path, "{}\n");
  utimesSync(path, atMs / 1000, atMs / 1000);
  return { mtimeMs: atMs, path };
}

describe("spokenEnough", () => {
  it("stops only at a file written more than a minute before the newest-few-th speaking call opened", () => {
    expect([
      spokenEnough({ file: { mtimeMs: OPENED - 2 * MINUTE }, speaking: 1, spokenOpened: [OPENED] }),
      spokenEnough({ file: { mtimeMs: OPENED - MINUTE / 2 }, speaking: 1, spokenOpened: [OPENED] }),
      spokenEnough({ file: { mtimeMs: OPENED - 2 * MINUTE }, speaking: 2, spokenOpened: [OPENED] }),
    ]).toEqual([true, false, false]);
  });
});

describe("chosenFiles", () => {
  it("visits the newest-written first, cut to a limit or to those written since an instant", () => {
    const touched = [
      { mtimeMs: 1000, name: "a" },
      { mtimeMs: 3000, name: "c" },
      { mtimeMs: 2000, name: "b" },
    ];
    expect([
      chosenFiles({ keep: { speaking: 1 }, touched }).map((file) => file.name),
      chosenFiles({ keep: { limit: 2 }, touched }).map((file) => file.name),
      chosenFiles({ keep: { sinceIso: new Date(2000).toISOString() }, touched }).map((file) => file.name),
    ]).toEqual([
      ["c", "b", "a"],
      ["c", "b"],
      ["c", "b"],
    ]);
  });
});

describe("writtenSinceListed", () => {
  // An older call's file was appended to after the listing, and the read stopped on its stale write time.
  it("opens a file written since it was listed past the floor, or gone, and never one unchanged", () => {
    const stale = OPENED - 30 * MINUTE;
    const appended = { ...written({ atMs: OPENED + 5 * MINUTE, name: "appended.jsonl" }), mtimeMs: stale };
    const unchanged = written({ atMs: stale, name: "unchanged.jsonl" });
    const touchedBelow = { ...written({ atMs: stale + MINUTE, name: "below.jsonl" }), mtimeMs: stale };
    const gone = { mtimeMs: stale, path: join(dir, "gone.jsonl") };
    expect(
      writtenSinceListed({ rest: [appended, unchanged, touchedBelow, gone], speaking: 1, spokenOpened: [OPENED] }).map(
        (file) => file.path,
      ),
    ).toEqual([appended.path, gone.path]);
  });
});
