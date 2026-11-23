import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { locateExport } from "../../../../../cli/commands/chatgpt/exportLocation.js";
import type { ChatgptArchiveDeps } from "../../../../../corpus/chatgpt/archive.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { err } from "../../../../../lib/result.js";
import { FUTURE, syntheticExportAt } from "../../../../chatgptFixture.js";

/** The synthetic export: a split one, two numbered conversations files. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

/** Archive edges for a test with no zip in it. */
const NO_ZIP: ChatgptArchiveDeps = {
  extractZipMember: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "no zip", path: zipPath })),
  listZip: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "no zip", path: zipPath })),
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh folder, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-locate-"));
  dirs.push(dir);
  return dir;
}

describe("locateExport", () => {
  it("takes a folder that is one whole export as named", () => {
    expect(locateExport({ archive: NO_ZIP, downloadsDir: tempDir(), from: FIXTURE })).toEqual({
      kind: "paths",
      paths: [FIXTURE],
    });
  });

  it("refuses one part of a split export, or a folder missing a part, by its own reason, never searching it", () => {
    const missingPart = tempDir();
    copyFileSync(join(FIXTURE, "conversations-001.json"), join(missingPart, "conversations-001.json"));
    const named = join(FIXTURE, "conversations-000.json");
    const located = [named, missingPart].map((from) =>
      locateExport({ archive: NO_ZIP, downloadsDir: tempDir(), from }),
    );
    expect(located).toEqual([
      {
        kind: "unreadable",
        line:
          `chatgpt: could not take in ${named}: ` +
          ChatgptExportErrors.unsafeMember({
            member: "conversations-001.json",
            why: "a conversations file beside conversations-000.json, so naming one file would leave the rest unread — name the folder",
          }).message,
        malformed: true,
      },
      {
        kind: "unreadable",
        line:
          `chatgpt: could not take in ${missingPart}: ` +
          ChatgptExportErrors.unsafeMember({
            member: "conversations-001.json",
            why: "a numbered run with no file numbered 0, so a whole file of the owner's history would go unread",
          }).message,
        malformed: true,
      },
    ]);
  });

  it("refuses a path that does not exist by that reason", () => {
    const gone = join(tempDir(), "gone.zip");
    expect(locateExport({ archive: NO_ZIP, downloadsDir: tempDir(), from: gone })).toEqual({
      kind: "unreadable",
      line: `chatgpt: could not take in ${gone}: ${ChatgptExportErrors.exportPathMissing({ path: gone }).message}`,
      malformed: true,
    });
  });

  it("searches a folder holding no conversations file for export zips, and says when it finds none", () => {
    const empty = tempDir();
    expect(locateExport({ archive: NO_ZIP, downloadsDir: tempDir(), from: empty })).toEqual({
      kind: "none",
      looked: empty,
    });
    const downloads = tempDir();
    expect(locateExport({ archive: NO_ZIP, downloadsDir: downloads, from: undefined })).toEqual({
      kind: "none",
      looked: downloads,
    });
  });
});
