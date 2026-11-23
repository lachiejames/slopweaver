/*
 * The effectful half the `readSlackThread` test files share: a downloader that writes a stub file into the
 * read's own files root, the `deps` builder whose default downloader is that one, and the per-case files
 * roots, each one `mkdtempSync` directory under the test file's temp sandbox, removed after every case by the
 * `afterEach` that `useTempRoots()` registers.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import { ok } from "#lib/result.js";

import type { DownloadFile } from "../../../../../live/slack/download.js";
import type { ReadSlackThreadOptions } from "../../../../../live/slack/readThread.js";
import { apiServing, THREAD } from "./fixtures.js";

/**
 * A downloader that records what it was asked for and writes a stub file. Injected, not mocked.
 *
 * @param calls the list each requested filename is pushed onto, in request order
 * @returns a downloader writing `bytes-of <url>` to the destination and answering the expected byte count
 */
export function recordingDownloader({ calls }: { calls: string[] }): DownloadFile {
  return async ({ url, filename, destinationDir, expectedBytes = 1 }) => {
    calls.push(filename);
    const localPath = join(destinationDir, filename);
    writeFileSync(localPath, `bytes-of ${url}`);
    return ok({ bytes: expectedBytes, localPath });
  };
}

/**
 * The read's injected seams: a one-message thread, a recording downloader and a fixed clock, any overridden.
 *
 * @param over the seams this case replaces
 * @returns the `deps` a `readSlackThread` call takes
 */
export const deps = (over: Partial<ReadSlackThreadOptions["deps"]> = {}): ReadSlackThreadOptions["deps"] => ({
  api: apiServing({ messages: [{ text: "parent", ts: THREAD, user: "U1" }] }),
  downloadFile: recordingDownloader({ calls: [] }),
  nowIso: () => "2026-08-03T00:00:00.000Z",
  ...over,
});

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/**
 * Register the `afterEach` that removes every files root minted since the last case. Call it once, at the top
 * of a test file whose cases call {@link tempRoot}.
 */
export function useTempRoots(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * Mint a fresh files root for one read, recorded for removal after the case.
 *
 * @returns the new directory's absolute path
 */
export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-readthread-"));
  fixtureDirs.push(root);
  return root;
}
