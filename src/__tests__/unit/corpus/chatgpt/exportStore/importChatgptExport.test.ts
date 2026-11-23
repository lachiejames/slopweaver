/**
 * Taking an export in: named by content, private, atomic and idempotent, refusing every shape it cannot read whole.
 * A zip is read through a fake archive edge that copies files, so no test launches `unzip`; the directory and
 * single-file paths run for real against the committed SYNTHETIC export.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { FUTURE, syntheticExportAt, syntheticFileAlone } from "../../../../chatgptFixture.js";
import { fakeZip, NO_ZIP, tempDir, useTempDirs, ZIP_MAGIC } from "./harness.js";

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

useTempDirs();

describe("importChatgptExport", () => {
  it("copies an unzipped export's conversations files under their content hash, private, with a manifest", () => {
    const root = join(tempDir(), "exports");
    const outcome = unwrap(
      importChatgptExport({ archive: NO_ZIP, from: FIXTURE, nowIso: "2026-10-17T01:00:00.000Z", root }),
    );
    expect(outcome.fresh).toBe(true);
    expect(outcome.stored.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.stored.directory).toBe(join(root, outcome.stored.contentHash));
    expect(outcome.stored.importedAtIso).toBe("2026-10-17T01:00:00.000Z");
    expect(outcome.stored.files).toEqual([
      join(outcome.stored.directory, "conversations-000.json"),
      join(outcome.stored.directory, "conversations-001.json"),
    ]);
    expect(readFileSync(outcome.stored.files[1]!, "utf8")).toBe(
      readFileSync(join(FIXTURE, "conversations-001.json"), "utf8"),
    );
    expect(readdirSync(outcome.stored.directory).toSorted()).toEqual([
      "conversations-000.json",
      "conversations-001.json",
      "manifest.json",
    ]);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(outcome.stored.files[0]!).mode & 0o777).toBe(0o600);
    expect(statSync(join(outcome.stored.directory, "manifest.json")).mode & 0o777).toBe(0o600);
    // The staging directory is gone: only the export remains under the root.
    expect(readdirSync(root)).toEqual([outcome.stored.contentHash]);
  });

  it("takes the same export in once: a second import, from a zip of the same files, writes nothing", () => {
    const root = join(tempDir(), "exports");
    const first = unwrap(
      importChatgptExport({ archive: NO_ZIP, from: FIXTURE, nowIso: "2026-10-17T01:00:00.000Z", root }),
    );
    const zipPath = join(tempDir(), "a1b2c3-2026-10-17-01-00-00.zip");
    writeFileSync(zipPath, ZIP_MAGIC);
    const again = unwrap(
      importChatgptExport({
        archive: fakeZip({ contents: FIXTURE, zipPath }),
        from: zipPath,
        nowIso: "2026-10-18T01:00:00.000Z",
        root,
      }),
    );
    expect(again.fresh).toBe(false);
    expect(again.stored.contentHash).toBe(first.stored.contentHash);
    // The first import's time stands: the second wrote nothing.
    expect(again.stored.importedAtIso).toBe("2026-10-17T01:00:00.000Z");
    expect(readdirSync(root)).toEqual([first.stored.contentHash]);
  });

  it("takes one conversations file in on its own", () => {
    const root = join(tempDir(), "exports");
    const outcome = unwrap(
      importChatgptExport({
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-001.json", modifiedIso: FUTURE }),
        nowIso: "2026-10-17T01:00:00.000Z",
        root,
      }),
    );
    expect(outcome.stored.files.map((file) => file.slice(outcome.stored.directory.length + 1))).toEqual([
      "conversations.json",
    ]);
  });

  it("refuses one part of a split export named on its own, so the rest is never left unread behind a receipt", () => {
    const root = join(tempDir(), "exports");
    const refused = ["conversations-001.json", "conversations-000.json"].map((name) =>
      unwrapErr(importChatgptExport({ archive: NO_ZIP, from: join(FIXTURE, name), nowIso: "x", root })),
    );
    expect(refused).toEqual([
      ChatgptExportErrors.unsafeMember({
        member: "conversations-001.json",
        why: "a numbered run with no file numbered 0, so a whole file of the owner's history would go unread",
      }),
      ChatgptExportErrors.unsafeMember({
        member: "conversations-001.json",
        why: "a conversations file beside conversations-000.json, so naming one file would leave the rest unread — name the folder",
      }),
    ]);
    expect(existsSync(root)).toBe(false);
  });

  it("refuses a named file beside a conversations file in a shape this reader does not know, never passing it over", () => {
    const root = join(tempDir(), "exports");
    const folder = tempDir();
    writeFileSync(join(folder, "conversations.json"), "[]");
    copyFileSync(join(FIXTURE, "conversations-000.json"), join(folder, "conversations-part-000.json"));
    const from = join(folder, "conversations.json");
    expect(unwrapErr(importChatgptExport({ archive: NO_ZIP, from, nowIso: "x", root }))).toEqual(
      ChatgptExportErrors.unsafeMember({
        member: "conversations-part-000.json",
        why: "a conversations file named in a shape this reader does not know, so its history would go unread",
      }),
    );
    expect(existsSync(root)).toBe(false);
  });

  it("refuses a path that does not exist, and a folder that is not an export, writing nothing", () => {
    const root = join(tempDir(), "exports");
    const missing = join(tempDir(), "nope.zip");
    expect(unwrapErr(importChatgptExport({ archive: NO_ZIP, from: missing, nowIso: "x", root }))).toEqual(
      ChatgptExportErrors.exportPathMissing({ path: missing }),
    );
    const notExport = tempDir();
    writeFileSync(join(notExport, "notes.json"), "[]");
    expect(unwrapErr(importChatgptExport({ archive: NO_ZIP, from: notExport, nowIso: "x", root })).code).toBe(
      "NOT_AN_EXPORT",
    );
    expect(existsSync(root)).toBe(false);
  });

  it("refuses a symbolic link standing in for a conversations file, and leaves no staging behind", () => {
    const root = join(tempDir(), "exports");
    const from = tempDir();
    symlinkSync(join(FIXTURE, "conversations-001.json"), join(from, "conversations.json"));
    expect(unwrapErr(importChatgptExport({ archive: NO_ZIP, from, nowIso: "x", root })).message).toContain(
      "a symbolic link",
    );
    expect(readdirSync(root)).toEqual([]);
  });

  it("refuses an export root that is a symbolic link, writing nothing through it", () => {
    const elsewhere = tempDir();
    const root = join(tempDir(), "exports");
    symlinkSync(elsewhere, root);
    expect(unwrapErr(importChatgptExport({ archive: NO_ZIP, from: FIXTURE, nowIso: "x", root }))).toEqual(
      ChatgptExportErrors.exportStoreFailed({
        cause: new Error("the export root is a symbolic link, and an export is never written through one"),
        path: root,
      }),
    );
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("keeps a re-zipped export folder's members flat under the hash", () => {
    const root = join(tempDir(), "exports");
    const contents = tempDir();
    mkdirSync(join(contents, "export"));
    copyFileSync(join(FIXTURE, "conversations-001.json"), join(contents, "export", "conversations.json"));
    const zipPath = join(tempDir(), "rezipped.zip");
    writeFileSync(zipPath, ZIP_MAGIC);
    const outcome = unwrap(
      importChatgptExport({ archive: fakeZip({ contents, zipPath }), from: zipPath, nowIso: "x", root }),
    );
    expect(outcome.stored.files).toEqual([join(outcome.stored.directory, "conversations.json")]);
  });
});
