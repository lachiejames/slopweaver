/**
 * Listing and reading the exports held: newest activity first, dated from when the owner came by them, every one read
 * whether receipted or not, and the whole read refused while any held export will not read.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { currentAsOfIso } from "../../../../../corpus/chatgpt/exportFreshness.js";
import { writeReceipt } from "../../../../../corpus/chatgpt/exportReceipts.js";
import { exportsToRead, heldExports, importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { FUTURE, syntheticExportAt, syntheticFileAlone } from "../../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../../noProtection.js";
import { fakeZip, NO_ZIP, tempDir, useTempDirs, ZIP_MAGIC } from "./harness.js";

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

useTempDirs();

describe("heldExports and exportsToRead", () => {
  it("lists every held export newest import first, and names one whose manifest will not read", () => {
    const root = join(tempDir(), "exports");
    const older = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-001.json", modifiedIso: FUTURE }),
        nowIso: "2026-10-01T00:00:00.000Z",
        root,
      }),
    );
    const newer = unwrap(
      importChatgptExport({ ...UNPROTECTED, archive: NO_ZIP, from: FIXTURE, nowIso: "2026-10-17T00:00:00.000Z", root }),
    );
    mkdirSync(join(root, "f".repeat(64)));
    const held = heldExports({ root });
    expect(held.exports.map((one) => one.contentHash)).toEqual([newer.stored.contentHash, older.stored.contentHash]);
    expect(held.unreadable.length).toBe(1);
    expect(held.unreadable[0]!).toContain("no readable manifest.json");
  });

  it("reads every held export, newest first, receipted or not", () => {
    // A receipt never narrows the read: the ingest weighs every export's version of each chat, and one left out
    // would let an older copy win (corpus/chatgpt/conversationMerge.ts).
    const root = join(tempDir(), "exports");
    const take = ({ from, nowIso }: { from: string; nowIso: string }): string =>
      unwrap(importChatgptExport({ ...UNPROTECTED, archive: NO_ZIP, from, nowIso, root })).stored.contentHash;
    const oldest = take({
      from: syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE }),
      nowIso: "2026-10-01T00:00:00.000Z",
    });
    const middle = take({
      from: syntheticFileAlone({ member: "conversations-001.json", modifiedIso: FUTURE }),
      nowIso: "2026-10-05T00:00:00.000Z",
    });
    const newest = take({ from: FIXTURE, nowIso: "2026-10-17T00:00:00.000Z" });
    expect(unwrap(exportsToRead({ root })).map((one) => one.contentHash)).toEqual([newest, middle, oldest]);
    unwrap(writeReceipt({ ...UNPROTECTED, contentHash: middle, nowIso: "2026-10-05T01:00:00.000Z", root }));
    unwrap(writeReceipt({ ...UNPROTECTED, contentHash: newest, nowIso: "2026-10-17T01:00:00.000Z", root }));
    expect(unwrap(exportsToRead({ root })).map((one) => one.contentHash)).toEqual([newest, middle, oldest]);
  });

  it("orders by the newest activity an export holds, never by when it was taken in", () => {
    // An older export saved again, copied, or named with --from after a newer one stays older.
    const root = join(tempDir(), "exports");
    const later = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-001.json", modifiedIso: FUTURE }),
        nowIso: "2026-10-01T00:00:00.000Z",
        root,
      }),
    ).stored;
    const earlier = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE }),
        nowIso: "2026-10-17T00:00:00.000Z",
        root,
      }),
    ).stored;
    expect(later.latestActivityIso).toBe("2026-09-23T21:47:40.000Z");
    expect(earlier.latestActivityIso).toBe("2026-09-22T18:03:20.000Z");
    expect(heldExports({ root }).exports.map((one) => one.contentHash)).toEqual([
      later.contentHash,
      earlier.contentHash,
    ]);
  });

  it("dates an export from when the owner came by its files, never from when it was taken in", () => {
    const root = join(tempDir(), "exports");
    const august = syntheticExportAt({ modifiedIso: "2026-08-01T00:00:00.000Z" });
    const folder = unwrap(
      importChatgptExport({ ...UNPROTECTED, archive: NO_ZIP, from: august, nowIso: "2026-10-17T00:00:00.000Z", root }),
    );
    expect([folder.stored.acquiredAtIso, folder.stored.importedAtIso]).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-10-17T00:00:00.000Z",
    ]);
    const zip = join(tempDir(), "export.zip");
    writeFileSync(zip, ZIP_MAGIC);
    utimesSync(zip, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
    const zipped = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: fakeZip({ contents: syntheticExportAt({ modifiedIso: FUTURE }), zipPath: zip }),
        from: zip,
        nowIso: "2026-10-17T00:00:00.000Z",
        root: join(tempDir(), "exports"),
      }),
    );
    expect(zipped.stored.acquiredAtIso).toBe("2026-07-01T00:00:00.000Z");
  });

  it("keeps the export the owner came by later the newer when both hold chats running equally late", () => {
    // The owner exported, deleted an older chat, exported again; the earlier archive is then taken in after the later one.
    const root = join(tempDir(), "exports");
    const earlierExport = syntheticExportAt({ modifiedIso: "2026-10-01T00:00:00.000Z" });
    const later = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-001.json", modifiedIso: "2026-10-10T00:00:00.000Z" }),
        nowIso: "2026-10-10T01:00:00.000Z",
        root,
      }),
    ).stored;
    const straggler = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: earlierExport,
        nowIso: "2026-10-16T00:00:00.000Z",
        root,
      }),
    ).stored;
    expect(straggler.latestActivityIso).toBe(later.latestActivityIso);
    const held = heldExports({ root });
    expect(held.exports.map((one) => one.contentHash)).toEqual([later.contentHash, straggler.contentHash]);
    expect(held.unreadable).toEqual([]);
    expect(currentAsOfIso({ newest: held.exports[0]!, nowIso: "2026-10-16T00:00:00.000Z", seen: [] })).toBe(
      "2026-10-10T00:00:00.000Z",
    );
  });

  it("reads two exports that tie on their latest chat and on when the owner came by them, listed in hash order", () => {
    const root = join(tempDir(), "exports");
    const both = syntheticExportAt({ modifiedIso: "2026-10-10T00:00:00.000Z" });
    const whole = unwrap(
      importChatgptExport({ ...UNPROTECTED, archive: NO_ZIP, from: both, nowIso: "2026-10-10T01:00:00.000Z", root }),
    ).stored;
    const part = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-001.json", modifiedIso: "2026-10-10T00:00:00.000Z" }),
        nowIso: "2026-10-16T00:00:00.000Z",
        root,
      }),
    ).stored;
    const byHash = [whole.contentHash, part.contentHash].toSorted().toReversed();
    expect(heldExports({ root }).unreadable).toEqual([]);
    expect(unwrap(exportsToRead({ root })).map((one) => one.contentHash)).toEqual(byHash);
  });

  it("names a held export whose member was deleted, resized or swapped for a link, never listing it", () => {
    const cases = [
      { damage: ({ path }: { path: string }) => rmSync(path), says: "conversations.json cannot be read" },
      { damage: ({ path }: { path: string }) => writeFileSync(path, "[]"), says: "conversations.json is 2 bytes" },
      {
        damage: ({ path }: { path: string }) => {
          const copy = `${path}.copy`;
          copyFileSync(path, copy);
          rmSync(path);
          symlinkSync(copy, path);
        },
        says: "conversations.json is not a regular file",
      },
    ];
    expect(cases.length).toBe(3);
    for (const { damage, says } of cases) {
      const root = join(tempDir(), "exports");
      const { stored } = unwrap(
        importChatgptExport({
          ...UNPROTECTED,
          archive: NO_ZIP,
          from: syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE }),
          nowIso: "x",
          root,
        }),
      );
      damage({ path: stored.files[0]! });
      const held = heldExports({ root });
      expect(held.exports).toEqual([]);
      expect(held.unreadable.length).toBe(1);
      expect(held.unreadable[0]!).toContain(says);
    }
  });

  it("refuses to read an export whose member changed under the same size", () => {
    const root = join(tempDir(), "exports");
    const { stored } = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE }),
        nowIso: "x",
        root,
      }),
    );
    const member = stored.files[0]!;
    const bytes = readFileSync(member);
    bytes[1] = bytes[1]! ^ 1;
    writeFileSync(member, bytes);
    expect(heldExports({ root }).exports.length).toBe(1);
    const refused = unwrapErr(exportsToRead({ root }));
    expect(refused.code).toBe("HELD_EXPORT_UNREADABLE");
    expect(refused.message).toContain("its members no longer hash to its name");
  });

  it("refuses the whole read while a held export will not read, never passing it over", () => {
    const root = join(tempDir(), "exports");
    unwrap(
      importChatgptExport({ ...UNPROTECTED, archive: NO_ZIP, from: FIXTURE, nowIso: "2026-10-17T00:00:00.000Z", root }),
    );
    mkdirSync(join(root, "f".repeat(64)));
    const refused = unwrapErr(exportsToRead({ root }));
    expect(refused.code).toBe("HELD_EXPORT_UNREADABLE");
    expect(refused.message).toContain(`1 held export(s) under ${root} will not read`);
  });

  it("refuses with the owner's one step when nothing was ever taken in", () => {
    expect(unwrapErr(exportsToRead({ root: join(tempDir(), "never") }))).toEqual(
      ChatgptExportErrors.noImportedExport(),
    );
  });
});
