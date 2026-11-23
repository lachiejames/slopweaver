/*
 * What the export-store test files share: the four bytes a zip opens with, archive edges that never run, a fake
 * archive edge that copies files so no test launches `unzip`, and the throwaway directories each case writes an export
 * root into, removed after every case by the `afterEach` that `useTempDirs()` registers.
 *
 * The synthetic export is NOT shared: each test file mints its own. The unit lane reuses a fork across files, so this
 * module's body runs once, and a copy minted here would sit in the first file's temp root, removed when that file ends.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import type { ChatgptArchiveDeps } from "../../../../../corpus/chatgpt/archive.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { err, ok } from "../../../../../lib/result.js";

/** The four bytes every zip with members opens with. */
export const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const dirs: string[] = [];

/** Register the `afterEach` that removes every directory minted since the last case. Call it once per test file. */
export function useTempDirs(): void {
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A fresh temp directory, removed after the test.
 *
 * @returns the new directory's absolute path
 */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-store-"));
  dirs.push(dir);
  return dir;
}

/** Archive edges that never run: for the directory and single-file paths. */
export const NO_ZIP: ChatgptArchiveDeps = {
  extractZipMember: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
  listZip: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
};

/**
 * Archive edges over one "zip" whose members are files in `contents`, keyed by member name.
 *
 * @param zipPath the one zip path these edges answer for; any other is refused as unreadable
 * @param contents the folder whose files stand in for the zip's members
 * @returns the archive edges
 */
export function fakeZip({ zipPath, contents }: { zipPath: string; contents: string }): ChatgptArchiveDeps {
  return {
    extractZipMember: ({ zipPath: asked, member, toPath }) => {
      if (asked !== zipPath) {
        return err(ChatgptExportErrors.archiveUnreadable({ detail: "unknown zip", path: asked }));
      }
      copyFileSync(join(contents, member), toPath);
      return ok(undefined);
    },
    listZip: ({ zipPath: asked }) => {
      if (asked !== zipPath) {
        return err(ChatgptExportErrors.archiveUnreadable({ detail: "unknown zip", path: asked }));
      }
      return ok(readdirSync(contents, { recursive: true, withFileTypes: false }).map(String));
    },
  };
}
