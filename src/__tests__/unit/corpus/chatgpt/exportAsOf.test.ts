import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ChatgptExportErrors } from "../../../../corpus/chatgpt/errors.js";
import { readCertifiedAsOf, writeCertifiedAsOf } from "../../../../corpus/chatgpt/exportAsOf.js";
import { heldExports, importChatgptExport } from "../../../../corpus/chatgpt/exportStore.js";
import { err, unwrap, unwrapErr } from "../../../../lib/result.js";
import { FUTURE, syntheticExportAt } from "../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../noProtection.js";

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** An export root holding the synthetic export, answering it and its content hash. */
function heldRoot(): { root: string; contentHash: string } {
  const root = mkdtempSync(join(tmpdir(), "chatgpt-as-of-"));
  dirs.push(root);
  const archive = {
    extractZipMember: ({ zipPath }: { zipPath: string }) =>
      err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
    listZip: ({ zipPath }: { zipPath: string }) =>
      err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
  };
  unwrap(importChatgptExport({ ...UNPROTECTED, archive, from: FIXTURE, nowIso: "2026-10-16T03:00:00.000Z", root }));
  return { contentHash: heldExports({ root }).exports[0]!.contentHash, root };
}

describe("the certified as-of", () => {
  it("reads back the instant written against the newest held export", () => {
    const { root, contentHash } = heldRoot();
    unwrap(writeCertifiedAsOf({ asOfIso: "2026-10-16T05:00:00.000Z", contentHash, root }));
    expect(unwrap(readCertifiedAsOf({ root }))).toBe("2026-10-16T05:00:00.000Z");
  });

  it("refuses when no sync ever certified one", () => {
    const { root } = heldRoot();
    expect(unwrapErr(readCertifiedAsOf({ root })).code).toBe("AS_OF_UNREADABLE");
    expect(unwrapErr(readCertifiedAsOf({ root })).message).toContain("ENOENT");
  });

  it("refuses a record that dates another export", () => {
    const { root } = heldRoot();
    unwrap(writeCertifiedAsOf({ asOfIso: "2026-10-16T05:00:00.000Z", contentHash: "b".repeat(64), root }));
    expect(unwrapErr(readCertifiedAsOf({ root })).message).toContain(
      "it dates export bbbbbbbbbbbb, which is not the newest held",
    );
  });

  it("refuses a record that is not the shape a sync writes", () => {
    const { root, contentHash } = heldRoot();
    writeFileSync(join(root, "as-of.json"), JSON.stringify({ asOfIso: "2026-10-16T05:00:00.000Z", contentHash }));
    expect(unwrapErr(readCertifiedAsOf({ root })).code).toBe("AS_OF_UNREADABLE");
    expect(unwrapErr(readCertifiedAsOf({ root })).message).toContain("schemaVersion");
  });

  it("refuses a record reached through a link, never reading what it points at", () => {
    const { root, contentHash } = heldRoot();
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    const target = join(elsewhere, "as-of.json");
    writeFileSync(target, JSON.stringify({ asOfIso: "2026-10-16T05:00:00.000Z", contentHash, schemaVersion: 1 }));
    symlinkSync(target, join(root, "as-of.json"));
    expect(unwrapErr(readCertifiedAsOf({ root })).message).toContain("not a regular file");
  });
});
