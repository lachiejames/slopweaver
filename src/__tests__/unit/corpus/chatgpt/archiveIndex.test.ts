/**
 * A scheduled `chatgpt sync` with nothing new extracts nothing: the archive index recognises an unchanged file as the
 * export it already became, so a pass's work follows the archives that changed, never every export the owner kept. The zip
 * edge is a plain fake that copies fixture files and COUNTS each extraction; every file and stat is real.
 */
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type ChatgptExportVerbDeps, runChatgptSync } from "../../../../cli/commands/chatgpt/exportRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../cli/exitCodes.js";
import type { ChatgptArchiveDeps } from "../../../../corpus/chatgpt/archive.js";
import { takeInArchive } from "../../../../corpus/chatgpt/archiveIndex.js";
import { heldExports } from "../../../../corpus/chatgpt/exportStore.js";
import { ok, unwrap } from "../../../../lib/result.js";

/** The committed synthetic export. */
const FIXTURE = join(import.meta.dirname, "../../../fixtures/chatgpt/synthetic-export");

/** The four bytes every zip with members opens with. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-index-"));
  dirs.push(dir);
  return dir;
}

/** A zip edge whose every zip is one `conversations.json`, copied from the fixture file `listings` names. */
function countingZip({ listings }: { listings: Record<string, string> }): {
  archive: ChatgptArchiveDeps;
  extracted: string[];
} {
  const extracted: string[] = [];
  return {
    archive: {
      // Each zip holds one whole `conversations.json`: the fixture file its listing names.
      extractZipMember: ({ toPath, zipPath }) => {
        extracted.push(zipPath);
        copyFileSync(join(FIXTURE, listings[zipPath]!), toPath);
        return ok(undefined);
      },
      listZip: () => ok(["conversations.json"]),
    },
    extracted,
  };
}

/** A zip-shaped file at `path`, last modified at `iso`. */
function zipAt({ path, iso }: { path: string; iso: string }): void {
  writeFileSync(path, ZIP_MAGIC);
  utimesSync(path, new Date(iso), new Date(iso));
}

/** The set of export hashes a root holds. */
function held({ root }: { root: string }): ReadonlySet<string> {
  return new Set(heldExports({ root }).exports.map((stored) => stored.contentHash));
}

describe("takeInArchive", () => {
  it("extracts an unchanged archive once, then recognises it by its file alone", () => {
    const root = tempDir();
    const zip = join(tempDir(), "export.zip");
    zipAt({ iso: "2026-10-16T02:00:00.000Z", path: zip });
    const { archive, extracted } = countingZip({ listings: { [zip]: "conversations-000.json" } });
    const first = unwrap(
      takeInArchive({ archive, from: zip, heldHashes: held({ root }), nowIso: "2026-10-16T03:00:00.000Z", root }),
    );
    expect(first.kind).toBe("imported");
    const second = unwrap(
      takeInArchive({ archive, from: zip, heldHashes: held({ root }), nowIso: "2026-10-17T03:00:00.000Z", root }),
    );
    expect(second).toEqual({
      contentHash: heldExports({ root }).exports[0]!.contentHash,
      kind: "known",
      modifiedIso: "2026-10-16T02:00:00.000Z",
    });
    expect(extracted).toEqual([zip]);
  });

  it("takes a rewritten archive in again, though its size and modified time were put back", () => {
    const root = tempDir();
    const zip = join(tempDir(), "export.zip");
    zipAt({ iso: "2026-10-16T02:00:00.000Z", path: zip });
    const { archive, extracted } = countingZip({ listings: { [zip]: "conversations-000.json" } });
    unwrap(takeInArchive({ archive, from: zip, heldHashes: held({ root }), nowIso: "2026-10-16T03:00:00.000Z", root }));
    // Same bytes back, same mtime back: only the change time moved, and that alone is a miss.
    zipAt({ iso: "2026-10-16T02:00:00.000Z", path: zip });
    const again = unwrap(
      takeInArchive({ archive, from: zip, heldHashes: held({ root }), nowIso: "2026-10-17T03:00:00.000Z", root }),
    );
    expect(again.kind).toBe("imported");
    expect(extracted).toEqual([zip, zip]);
  });

  it("takes an archive in again once the export it became is no longer held", () => {
    const root = tempDir();
    const zip = join(tempDir(), "export.zip");
    zipAt({ iso: "2026-10-16T02:00:00.000Z", path: zip });
    const { archive, extracted } = countingZip({ listings: { [zip]: "conversations-000.json" } });
    unwrap(takeInArchive({ archive, from: zip, heldHashes: held({ root }), nowIso: "2026-10-16T03:00:00.000Z", root }));
    const directory = heldExports({ root }).exports[0]!.directory;
    renameSync(directory, join(tempDir(), "moved-aside"));
    const again = unwrap(
      takeInArchive({ archive, from: zip, heldHashes: held({ root }), nowIso: "2026-10-17T03:00:00.000Z", root }),
    );
    expect(again.kind).toBe("imported");
    expect(extracted).toEqual([zip, zip]);
  });

  it("reads an index that will not parse as empty, and rewrites it whole on the next take-in", () => {
    const root = tempDir();
    const zip = join(tempDir(), "export.zip");
    zipAt({ iso: "2026-10-16T02:00:00.000Z", path: zip });
    const { archive, extracted } = countingZip({ listings: { [zip]: "conversations-000.json" } });
    unwrap(takeInArchive({ archive, from: zip, heldHashes: held({ root }), nowIso: "2026-10-16T03:00:00.000Z", root }));
    writeFileSync(join(root, "archive-index.json"), "{");
    expect(
      unwrap(
        takeInArchive({ archive, from: zip, heldHashes: held({ root }), nowIso: "2026-10-17T03:00:00.000Z", root }),
      ).kind,
    ).toBe("imported");
    expect(JSON.parse(readFileSync(join(root, "archive-index.json"), "utf8")).entries.length).toBe(1);
    expect(extracted).toEqual([zip, zip]);
  });
});

describe("a scheduled sync over kept exports", () => {
  it("extracts only the archive that arrived since the last pass, never the ones the owner kept", async () => {
    const home = tempDir();
    const downloads = tempDir();
    const older = join(downloads, "chatgpt-export.zip");
    const newer = join(downloads, "chatgpt-export (1).zip");
    zipAt({ iso: "2026-10-15T02:00:00.000Z", path: older });
    const { archive, extracted } = countingZip({
      listings: { [newer]: "conversations-001.json", [older]: "conversations-000.json" },
    });
    const deps = ({ nowIso }: { nowIso: string }): ChatgptExportVerbDeps => ({
      archive,
      downloadsDir: downloads,
      nowIso: () => nowIso,
      runVerb: () => Promise.resolve(EXIT_OK),
    });
    expect(await runChatgptSync({ deps: deps({ nowIso: "2026-10-15T03:00:00.000Z" }), rest: ["--home", home] })).toBe(
      EXIT_OK,
    );
    zipAt({ iso: "2026-10-16T02:00:00.000Z", path: newer });
    expect(await runChatgptSync({ deps: deps({ nowIso: "2026-10-16T03:00:00.000Z" }), rest: ["--home", home] })).toBe(
      EXIT_OK,
    );
    expect(await runChatgptSync({ deps: deps({ nowIso: "2026-10-16T04:00:00.000Z" }), rest: ["--home", home] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(extracted).toEqual([older, newer]);
  });
});
