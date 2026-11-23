/**
 * Watching a download directory, and working out which file one click produced.
 *
 * `./download.ts` is the pure half — which candidate a set of observations selects, and why. This is the
 * effectful shell: the directory listings, the settle watch and the copy to `--out`.
 *
 * ## Why a download is WATCHED rather than awaited
 *
 * MEASURED twice: `page.waitForEvent("download")` never fires over the extension relay
 * (`TimeoutError` at 20s, on a `data:` link and an `http` link alike) while the bytes land in `~/Downloads`
 * every time. The owner's Chrome performs the download itself, outside Playwright's control, so `download.saveAs()`
 * is unreachable here and every piece of Playwright documentation about it describes a browser Playwright
 * launched. Attribution is therefore an INFERENCE, labelled `directory-observed` in the receipt, and no
 * caller may quote it as a browser confirmation.
 */
import { copyFileSync, constants as fsConstants, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";
import {
  DOWNLOAD_SETTLE_MS,
  type DownloadDirectoryObservation,
  type DownloadFile,
  type DownloadSelection,
  selectDownloadCandidate,
} from "./download.js";

/**
 * How long a download click is watched for before the watch gives up.
 *
 * @internal — exported for the unit test that drives {@link watchDownloadDir} against an injected clock.
 */
export const DOWNLOAD_WATCH_MS = 20_000;

/** What a download was asked to produce, as much of the request as this file needs. */
export interface DownloadRequest {
  /** The interaction, so a non-download asks nothing of the directory at all. */
  readonly kind: string;
  /** The directory the browser puts downloads in. */
  readonly downloadDir: string | undefined;
  /** The filename the caller expects, when one was named. */
  readonly expectName: string | undefined;
  /** Where the file is copied to. */
  readonly downloadOut: string | undefined;
}

/**
 * List one directory as the download watcher sees it.
 *
 * @param directory the directory to read
 * @returns the files it holds, or an empty list when it cannot be read
 */
export function listDownloadDir({ directory }: { directory: string }): readonly DownloadFile[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({ bytes: sizeOf({ path: join(directory, entry.name) }), name: entry.name }));
  } catch {
    return [];
  }
}

/**
 * One file's size, or `-1` when it went away between the listing and the stat.
 *
 * `-1` rather than `0`, because a zero-byte download is a legitimate result and the settle test compares two
 * readings for equality — a vanished file reading as zero twice would settle as an empty download.
 *
 * @param path the file
 * @returns its size in bytes, or `-1`
 */
function sizeOf({ path }: { path: string }): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

/**
 * Watch a directory until a new file settles, or the deadline passes.
 *
 * Synchronous polling with a busy wait rather than a timer, because `no-headless` bans the asynchronous
 * child-process capabilities this module would otherwise be built on and the whole lane is deliberately one
 * blocking command at a time. The loop is bounded by {@link DOWNLOAD_WATCH_MS}.
 *
 * @param directory the directory to watch
 * @param baseline what it held before the click
 * @param nowMs the clock, injected so a test can drive it
 * @param sleep how the loop waits, injected for the same reason
 * @returns the observations taken, oldest first
 * @internal — exported for the unit test that drives it against an injected clock rather than a real wait.
 */
export function watchDownloadDir({
  directory,
  baseline,
  nowMs,
  sleep,
}: {
  directory: string;
  baseline: readonly DownloadFile[];
  nowMs: () => number;
  sleep: (ms: number) => void;
}): readonly DownloadDirectoryObservation[] {
  const known = new Set(baseline.map((file) => file.name));
  const deadline = nowMs() + DOWNLOAD_WATCH_MS;
  const observations: DownloadDirectoryObservation[] = [];
  while (nowMs() < deadline) {
    sleep(DOWNLOAD_SETTLE_MS);
    observations.push({ atIso: new Date(nowMs()).toISOString(), files: listDownloadDir({ directory }) });
    const latest = observations.at(-1);
    const previous = observations.at(-2);
    const settled =
      latest !== undefined &&
      previous !== undefined &&
      latest.files.some(
        (file) =>
          !known.has(file.name) && previous.files.some((was) => was.name === file.name && was.bytes === file.bytes),
      );
    if (settled) {
      return observations;
    }
  }
  return observations;
}

/**
 * Work out which file a download click produced, when this was one.
 *
 * @param request the download fields of the interaction
 * @param baseline what the watched directory held before the click
 * @param sleep how the watch waits
 * @returns the file, `null` when this was not a download, or the typed failure
 */
export function resolveDownload({
  request,
  baseline,
  sleep,
}: {
  request: DownloadRequest;
  baseline: readonly DownloadFile[];
  sleep: (ms: number) => void;
}): Result<DownloadSelection | null, BrowserActionError> {
  if (request.kind !== "download" || request.downloadDir === undefined) {
    return ok(null);
  }
  const observations = watchDownloadDir({
    baseline,
    directory: request.downloadDir,
    nowMs: () => Date.now(),
    sleep,
  });
  const selected = selectDownloadCandidate({
    baseline,
    directory: request.downloadDir,
    expectName: request.expectName,
    observations,
  });
  if (selected.isErr()) {
    return err(selected.error);
  }
  if (request.downloadOut !== undefined) {
    try {
      // `COPYFILE_EXCL` rather than a plain copy, so an existing file at the destination is a refusal rather
      // than a silent overwrite: the caller named a path it expects to be new, and a download that quietly
      // replaced a file would be the kind of unasked-for act nothing here is entitled to take. The browser's
      // own copy is LEFT in the download directory — it is the owner's, in the place the owner expects to find it.
      copyFileSync(join(request.downloadDir, selected.value.name), request.downloadOut, fsConstants.COPYFILE_EXCL);
    } catch (error: unknown) {
      // The download HAPPENED; only the copy failed. So this is the download arm rather than a client
      // failure, and it points the caller at the file rather than at the command.
      return err(
        BrowserActionErrors.downloadNotResolved({
          candidates: 1,
          directory: request.downloadDir,
          names: [selected.value.name],
        }),
      );
    }
  }
  return ok(selected.value);
}
