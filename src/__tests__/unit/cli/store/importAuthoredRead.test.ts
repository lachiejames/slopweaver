/**
 * The authored leg's read of one listed file, over real temp files: a file deleted since the walk is `vanished`,
 * one still there that will not read is `unreadable`, and the vanished paths leave the present set and are named.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listedFilesStillPresent,
  readListedFile,
  vanishedListedFileNotes,
} from "../../../../cli/commands/store/importAuthoredRead.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with a `talk` directory. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "authored-read-"));
  homes.push(home);
  mkdirSync(join(home, "talk"));
  return home;
}

describe("readListedFile", () => {
  it("reads a file that is there, with its exact bytes and mtime", () => {
    const home = freshHome();
    const path = join(home, "talk/chair-wake.json");
    const at = new Date("2026-10-22T15:30:00.000Z");
    writeFileSync(path, "{}\n");
    utimesSync(path, at, at);

    expect(readListedFile({ path })).toEqual({ bytes: Buffer.from("{}\n"), fileModifiedAt: at, kind: "read" });
  });

  it("calls a listed file deleted before the read vanished — the chair-wake lock race (ENOENT)", () => {
    const home = freshHome();
    const path = join(home, "talk/chair-wake.json.lock");
    writeFileSync(path, "");
    rmSync(path);

    expect(readListedFile({ path })).toEqual({ kind: "vanished" });
  });

  it("calls a file whose directory became a file vanished (ENOTDIR)", () => {
    const home = freshHome();
    writeFileSync(join(home, "talk/was-a-directory"), "");

    expect(readListedFile({ path: join(home, "talk/was-a-directory/child.json") })).toEqual({ kind: "vanished" });
  });

  it("keeps a failure with something still at the path a refusal (EISDIR)", () => {
    const home = freshHome();
    mkdirSync(join(home, "talk/became-a-directory"));

    expect(readListedFile({ path: join(home, "talk/became-a-directory") })).toEqual({
      kind: "unreadable",
      reason: expect.stringContaining("EISDIR"),
    });
  });
});

describe("listedFilesStillPresent", () => {
  it("drops exactly the vanished paths and keeps walk order", () => {
    expect(
      listedFilesStillPresent({
        listed: ["talk/b.json", "talk/chair-wake.json.lock", "briefs/a.md"],
        vanished: ["talk/chair-wake.json.lock"],
      }),
    ).toEqual(["talk/b.json", "briefs/a.md"]);
  });
});

describe("vanishedListedFileNotes", () => {
  it("says nothing when no file vanished", () => {
    expect(vanishedListedFileNotes({ paths: [] })).toEqual([]);
  });

  it("names every vanished path in walk order", () => {
    expect(vanishedListedFileNotes({ paths: ["talk/chair-wake.json.lock", "briefs/a.md"] })).toEqual([
      "2 file(s) deleted between the walk and the read, not stored: talk/chair-wake.json.lock, briefs/a.md",
    ]);
  });
});
