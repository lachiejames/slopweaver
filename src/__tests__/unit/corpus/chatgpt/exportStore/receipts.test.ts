/**
 * An export's receipt: a separate fact from the import, written last and private, read as absent when torn or
 * borrowed from another export, forgotten on a replay, and never written or removed through a linked folder.
 */
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { forgetReceipts, hasReceipt, writeReceipt } from "../../../../../corpus/chatgpt/exportReceipts.js";
import { heldExports, importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { FUTURE, syntheticExportAt } from "../../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../../noProtection.js";
import { NO_ZIP, tempDir, useTempDirs } from "./harness.js";

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

useTempDirs();

describe("receipts", () => {
  it("is a separate fact from the import, written last, private", () => {
    const root = join(tempDir(), "exports");
    const { stored } = unwrap(
      importChatgptExport({ ...UNPROTECTED, archive: NO_ZIP, from: FIXTURE, nowIso: "x", root }),
    );
    expect(hasReceipt({ contentHash: stored.contentHash, root })).toBe(false);
    expect(
      writeReceipt({
        ...UNPROTECTED,
        contentHash: stored.contentHash,
        nowIso: "2026-10-17T02:00:00.000Z",
        root,
      }).isOk(),
    ).toBe(true);
    expect(hasReceipt({ contentHash: stored.contentHash, root })).toBe(true);
    const path = join(root, "receipts", `${stored.contentHash}.json`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      contentHash: stored.contentHash,
      schemaVersion: 1,
      syncedAtIso: "2026-10-17T02:00:00.000Z",
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // The receipts folder is not mistaken for an export.
    expect(heldExports({ root }).unreadable).toEqual([]);
  });

  it("refuses a receipts folder that is a symbolic link, writing nothing through it", () => {
    const root = join(tempDir(), "exports");
    const elsewhere = tempDir();
    mkdirSync(root, { recursive: true });
    symlinkSync(elsewhere, join(root, "receipts"));
    const hash = "b".repeat(64);
    expect(unwrapErr(writeReceipt({ ...UNPROTECTED, contentHash: hash, nowIso: "x", root }))).toEqual(
      ChatgptExportErrors.exportStoreFailed({
        cause: new Error("the receipts folder is a symbolic link, and a receipt is never written through one"),
        path: join(root, "receipts", `${hash}.json`),
      }),
    );
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("reads a torn receipt as no receipt, so the next sync retries", () => {
    const root = join(tempDir(), "exports");
    const hash = "a".repeat(64);
    mkdirSync(join(root, "receipts"), { recursive: true });
    writeFileSync(join(root, "receipts", `${hash}.json`), '{"contentHash":');
    expect(hasReceipt({ contentHash: hash, root })).toBe(false);
  });

  it("reads another export's receipt, copied or linked to this one's path, as no receipt", () => {
    const root = join(tempDir(), "exports");
    const [a, b, c] = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    unwrap(writeReceipt({ ...UNPROTECTED, contentHash: a, nowIso: "2026-10-17T02:00:00.000Z", root }));
    copyFileSync(join(root, "receipts", `${a}.json`), join(root, "receipts", `${b}.json`));
    unwrap(writeReceipt({ ...UNPROTECTED, contentHash: c, nowIso: "2026-10-17T02:00:00.000Z", root }));
    rmSync(join(root, "receipts", `${c}.json`));
    symlinkSync(join(root, "receipts", `${a}.json`), join(root, "receipts", `${c}.json`));
    expect(hasReceipt({ contentHash: a, root })).toBe(true);
    expect(hasReceipt({ contentHash: b, root })).toBe(false);
    expect(hasReceipt({ contentHash: c, root })).toBe(false);
  });

  it("forgets every receipt on a replay, leaving anything else in the folder, and counts what it removed", () => {
    const root = join(tempDir(), "exports");
    const [a, b] = ["a".repeat(64), "b".repeat(64)];
    unwrap(writeReceipt({ ...UNPROTECTED, contentHash: a, nowIso: "2026-10-17T02:00:00.000Z", root }));
    unwrap(writeReceipt({ ...UNPROTECTED, contentHash: b, nowIso: "2026-10-17T02:00:00.000Z", root }));
    writeFileSync(join(root, "receipts", "notes.json"), "{}");
    expect(unwrap(forgetReceipts({ ...UNPROTECTED, root }))).toBe(2);
    expect([hasReceipt({ contentHash: a, root }), hasReceipt({ contentHash: b, root })]).toEqual([false, false]);
    expect(readdirSync(join(root, "receipts"))).toEqual(["notes.json"]);
    expect(unwrap(forgetReceipts({ ...UNPROTECTED, root: join(tempDir(), "never-synced") }))).toBe(0);
  });

  it("removes nothing through a receipts folder that is a symbolic link", () => {
    const root = join(tempDir(), "exports");
    const elsewhere = tempDir();
    writeFileSync(join(elsewhere, `${"a".repeat(64)}.json`), "{}");
    mkdirSync(root, { recursive: true });
    symlinkSync(elsewhere, join(root, "receipts"));
    expect(unwrapErr(forgetReceipts({ ...UNPROTECTED, root })).code).toBe("EXPORT_STORE_FAILED");
    expect(readdirSync(elsewhere)).toEqual([`${"a".repeat(64)}.json`]);
  });
});

describe("receipts on the owner's protect list", () => {
  it("writes no receipt, and forgets none, under a receipts folder the list marks read-only", () => {
    const root = join(tempDir(), "exports");
    const receipts = join(root, "receipts");
    const hash = "a".repeat(64);
    unwrap(writeReceipt({ ...UNPROTECTED, contentHash: hash, nowIso: "2026-10-17T02:00:00.000Z", root }));
    const protection: OwnerProtectionResolver = () =>
      ok([{ addedIso: "2026-11-01T00:00:00.000Z", mode: "read-only", path: receipts, why: "kept as it is" }]);
    const path = join(receipts, `${"b".repeat(64)}.json`);
    expect(
      unwrapErr(writeReceipt({ contentHash: "b".repeat(64), home: tempDir(), nowIso: "x", protection, root })),
    ).toEqual(
      ChatgptExportErrors.exportProtected({
        lines: [
          `refusing to write the ChatGPT receipt ${path}: it would write to ${path}, which the owner's protect ` +
            `list marks read-only at ${receipts} (kept as it is)`,
        ],
      }),
    );
    expect(unwrapErr(forgetReceipts({ home: tempDir(), protection, root })).code).toBe("EXPORT_PROTECTED");
    expect(readdirSync(receipts)).toEqual([`${hash}.json`]);
  });
});
