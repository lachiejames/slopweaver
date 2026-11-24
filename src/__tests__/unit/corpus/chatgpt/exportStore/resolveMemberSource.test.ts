/**
 * Reading what an export path holds: an unzipped folder or a single file as members under a root, refusing a missing
 * path, a conversations file at any depth, an unlistable subfolder, and never following a link to a folder.
 */
import { chmodSync, copyFileSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { resolveMemberSource } from "../../../../../corpus/chatgpt/exportSource.js";
import { heldExports, importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { FUTURE, syntheticExportAt, syntheticFileAlone } from "../../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../../noProtection.js";
import { NO_ZIP, tempDir, useTempDirs } from "./harness.js";

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

useTempDirs();

describe("resolveMemberSource", () => {
  it("reads an unzipped folder as files under it, and a single file as files under its folder", () => {
    const folder = unwrap(resolveMemberSource({ archive: NO_ZIP, from: FIXTURE }));
    expect([folder.kind, folder.members.map((member) => member.member)]).toEqual([
      "files",
      ["conversations-000.json", "conversations-001.json"],
    ]);
    const alone = syntheticFileAlone({ member: "conversations-001.json", modifiedIso: FUTURE });
    const single = unwrap(resolveMemberSource({ archive: NO_ZIP, from: alone }));
    expect(single).toEqual({
      kind: "files",
      members: [{ member: "conversations.json", name: "conversations.json" }],
      root: dirname(alone),
    });
  });

  it("refuses a path that does not exist", () => {
    const missing = join(tempDir(), "gone");
    expect(unwrapErr(resolveMemberSource({ archive: NO_ZIP, from: missing }))).toEqual(
      ChatgptExportErrors.exportPathMissing({ path: missing }),
    );
  });

  it("sees a conversations file at any depth, refusing the folder rather than reading the rest as the export", () => {
    const folder = tempDir();
    copyFileSync(join(FIXTURE, "conversations-000.json"), join(folder, "conversations.json"));
    mkdirSync(join(folder, "export", "deep"), { recursive: true });
    copyFileSync(join(FIXTURE, "conversations-001.json"), join(folder, "export", "deep", "conversations-001.json"));
    expect(unwrapErr(resolveMemberSource({ archive: NO_ZIP, from: folder })).message).toContain(
      "a conversations file deeper than one folder down",
    );
    const root = tempDir();
    const imported = importChatgptExport({
      ...UNPROTECTED,
      archive: NO_ZIP,
      from: folder,
      nowIso: "2026-10-17T03:00:00.000Z",
      root,
    });
    expect(unwrapErr(imported).code).toBe("UNSAFE_MEMBER");
    expect(heldExports({ root }).exports).toEqual([]);
  });

  it("refuses a folder holding a subfolder that will not list, which may hold a conversations file", () => {
    const folder = tempDir();
    copyFileSync(join(FIXTURE, "conversations-000.json"), join(folder, "conversations.json"));
    const locked = join(folder, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      expect(unwrapErr(resolveMemberSource({ archive: NO_ZIP, from: folder }))).toEqual({
        ...unwrapErr(resolveMemberSource({ archive: NO_ZIP, from: folder })),
        code: "EXPORT_STORE_FAILED",
        path: locked,
      });
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it("lists a link to a folder without following it", () => {
    const folder = tempDir();
    copyFileSync(join(FIXTURE, "conversations-000.json"), join(folder, "conversations.json"));
    const elsewhere = tempDir();
    copyFileSync(join(FIXTURE, "conversations-001.json"), join(elsewhere, "conversations-001.json"));
    symlinkSync(elsewhere, join(folder, "linked"));
    const source = unwrap(resolveMemberSource({ archive: NO_ZIP, from: folder }));
    expect(source.members.map((member) => member.member)).toEqual(["conversations.json"]);
  });
});
