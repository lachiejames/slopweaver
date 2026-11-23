/**
 * Every held export checked against its name on every pass, a receipted older one included, and the verified index
 * that lets a pass skip re-reading the ones whose members are unwritten since they last matched. Real files, real
 * stats; the index is forged only to show what it is trusted for.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ChatgptArchiveDeps } from "../../../../corpus/chatgpt/archive.js";
import { ChatgptExportErrors } from "../../../../corpus/chatgpt/errors.js";
import { writeReceipt } from "../../../../corpus/chatgpt/exportReceipts.js";
import { exportsToRead, importChatgptExport, type StoredExport } from "../../../../corpus/chatgpt/exportStore.js";
import { fileIdentity } from "../../../../corpus/chatgpt/fileIdentity.js";
import { damagedHeldExports } from "../../../../corpus/chatgpt/heldVerification.js";
import { err, unwrap, unwrapErr } from "../../../../lib/result.js";
import { syntheticExportAt, syntheticFileAlone } from "../../../chatgptFixture.js";

/** Archive edges that never run: the fixture is a folder. */
const NO_ZIP: ChatgptArchiveDeps = {
  extractZipMember: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
  listZip: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh export root, removed after the test. */
function exportRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-verified-"));
  dirs.push(dir);
  return join(dir, "exports");
}

/** Take one copy of the synthetic export in — the whole of it, or its second file alone. */
function held({ root, part, acquired }: { root: string; part: "whole" | "second"; acquired: string }): StoredExport {
  const from =
    part === "whole"
      ? syntheticExportAt({ modifiedIso: acquired })
      : syntheticFileAlone({ member: "conversations-001.json", modifiedIso: acquired });
  return unwrap(importChatgptExport({ archive: NO_ZIP, from, nowIso: "2026-10-17T00:00:00.000Z", root })).stored;
}

/** Flip one bit of a file, keeping its size — the rewrite no listing can see. */
function flipByte({ path }: { path: string }): void {
  const bytes = readFileSync(path);
  bytes[1] = bytes[1]! ^ 1;
  writeFileSync(path, bytes);
}

describe("exportsToRead", () => {
  it("refuses a receipted older export rewritten under the same size", () => {
    const root = exportRoot();
    const older = held({ acquired: "2026-10-01T00:00:00.000Z", part: "second", root });
    const newer = held({ acquired: "2026-10-10T00:00:00.000Z", part: "whole", root });
    for (const stored of [older, newer]) {
      unwrap(writeReceipt({ contentHash: stored.contentHash, nowIso: "2026-10-17T00:00:00.000Z", root }));
    }
    expect(unwrap(exportsToRead({ root })).map((stored) => stored.contentHash)).toEqual([
      newer.contentHash,
      older.contentHash,
    ]);
    flipByte({ path: older.files[0]! });
    const refused = unwrapErr(exportsToRead({ root }));
    expect(refused.code).toBe("HELD_EXPORT_UNREADABLE");
    expect(refused.message).toContain(`${older.directory}: no longer the export taken in`);
  });
});

describe("damagedHeldExports", () => {
  it("names no export while every one hashes to its name, and records each in the index", () => {
    const root = exportRoot();
    const stored = held({ acquired: "2026-10-01T00:00:00.000Z", part: "whole", root });
    expect(damagedHeldExports({ held: [stored], root })).toEqual([]);
    const index = JSON.parse(readFileSync(join(root, "verified-index.json"), "utf8"));
    expect(index.entries.map((entry: { contentHash: string }) => entry.contentHash)).toEqual([stored.contentHash]);
  });

  it("trusts an entry naming the members as they stand, and hashes in full once the index will not read", () => {
    const root = exportRoot();
    const stored = held({ acquired: "2026-10-01T00:00:00.000Z", part: "whole", root });
    flipByte({ path: stored.files[0]! });
    // An entry matching the rewritten members' identities is exactly what a hit trusts: this is what the index buys,
    // and why only a write it cannot see could get past it.
    const members = stored.files.map((path) => fileIdentity({ path })!);
    const forged = { entries: [{ contentHash: stored.contentHash, members }], schemaVersion: 1 };
    writeFileSync(join(root, "verified-index.json"), JSON.stringify(forged));
    expect(damagedHeldExports({ held: [stored], root })).toEqual([]);
    writeFileSync(join(root, "verified-index.json"), "{");
    const damage = damagedHeldExports({ held: [stored], root });
    expect(damage.length).toBe(1);
    expect(damage[0]!).toContain("no longer hash to its name");
  });

  it("re-hashes an export whose member was written since it matched, and drops its entry", () => {
    const root = exportRoot();
    const stored = held({ acquired: "2026-10-01T00:00:00.000Z", part: "whole", root });
    expect(damagedHeldExports({ held: [stored], root })).toEqual([]);
    flipByte({ path: stored.files[1]! });
    expect(damagedHeldExports({ held: [stored], root }).length).toBe(1);
    const index = JSON.parse(readFileSync(join(root, "verified-index.json"), "utf8"));
    expect(index.entries).toEqual([]);
  });
});
