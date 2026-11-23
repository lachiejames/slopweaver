/**
 * Picking the file a download click produced — the PURE half, over directory listings passed in as values.
 *
 * ## Why this is a directory watch and not Playwright's own download event
 *
 * MEASURED twice against the owner's real Chrome through the extension relay — once on a
 * `data:` link and once on an `http` link carrying `download`:
 * `TimeoutError: page.waitForEvent: Timeout 20000ms exceeded while waiting for event "download"` — while the
 * bytes landed in `~/Downloads` **every single time** (`spike.txt`, `spike (1).txt`, `payload.txt`, the last
 * of them 34 bytes and byte-identical to the fixture's payload). The owner's Chrome performs the download itself,
 * outside Playwright's control, so `download.saveAs()` and `download.suggestedFilename()` are unreachable on
 * this relay and every line of documentation about them is about a browser Playwright launched.
 *
 * Reproduce: click any `download` link through the relay and watch `~/Downloads` rather than the event.
 *
 * ## What that costs, stated rather than discovered
 *
 * Attribution becomes an INFERENCE. A file that appears in a watched directory while a click was being made
 * is probably that click's, and it is not provably that click's — a download the owner started in
 * another tab lands in the same place and looks identical. So:
 *
 * - Two or more new settled files is an AMBIGUITY, reported as one, never a guess at the newest.
 * - A receipt labels its provenance `directory-observed`, never `browser-confirmed`.
 * - A caller who knows the filename may say so, which narrows the window without pretending to close it.
 *
 * ## "Settled" is stability, not size
 *
 * Chrome writes a `.crdownload` beside the real name while a transfer is in flight, so an in-progress file
 * is excluded by NAME. But a file can also be complete and small, so a nonzero size is not the test: the
 * test is that its size has not moved between two observations {@link DOWNLOAD_SETTLE_MS} apart. A zero-byte
 * download is a legitimate download of an empty file, and reporting it as "not finished" would be wrong.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";

/**
 * How long a file's size must stay put before it counts as finished.
 *
 * A POLICY default, stated as one rather than dressed as a measurement. Long enough that a paused or slow
 * write is not read as a finished one, short enough that an ordinary small download is not waited on twice
 * for nothing.
 */
export const DOWNLOAD_SETTLE_MS = 750;

/** Chrome's own in-flight suffix. A file wearing it is a transfer, never a result. */
const IN_FLIGHT_SUFFIXES = [".crdownload", ".part", ".download"] as const;

/** One file as a directory listing described it at one instant. */
export interface DownloadFile {
  readonly name: string;
  readonly bytes: number;
}

/** What one directory held at one instant. */
export interface DownloadDirectoryObservation {
  readonly atIso: string;
  readonly files: readonly DownloadFile[];
}

/** The file a click is judged to have produced. */
export interface DownloadSelection {
  readonly name: string;
  readonly bytes: number;
  /**
   * How the file was attributed to the click. One value today, and named rather than implied so a receipt
   * cannot read as a browser confirmation it is not.
   */
  readonly provenance: "directory-observed";
}

/**
 * Whether a filename is a transfer in flight rather than a finished file.
 *
 * @param name the filename as the directory listing spells it
 * @returns true when it is a partial download
 */
export function isInFlightDownload({ name }: { name: string }): boolean {
  return IN_FLIGHT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Pick the one file a download click produced, from a baseline and what was seen afterwards.
 *
 * A candidate is a file that was NOT in the baseline, is not in flight, and whose size is identical in the
 * last two observations. Exactly one candidate is an answer; none is a timeout; more than one is an
 * ambiguity — and the last two are the same typed error carrying the count, because the caller's correction
 * for both is to say which file it expected.
 *
 * @param baseline what the directory held before the click
 * @param observations what it held afterwards, oldest first; the last two decide stability
 * @param directory the directory being watched, so a refusal can name it
 * @param expectName the filename the caller said to expect, when it named one
 * @returns the file, or why one could not be told apart
 */
export function selectDownloadCandidate({
  baseline,
  observations,
  directory,
  expectName,
}: {
  baseline: readonly DownloadFile[];
  observations: readonly DownloadDirectoryObservation[];
  directory: string;
  expectName: string | undefined;
}): Result<DownloadSelection, BrowserActionError> {
  const known = new Set(baseline.map((file) => file.name));
  const latest = observations.at(-1);
  const previous = observations.at(-2);
  if (latest === undefined || previous === undefined) {
    return err(
      BrowserActionErrors.downloadNotResolved({
        candidates: 0,
        directory,
        names: [],
        ...(expectName === undefined ? {} : { expected: expectName }),
      }),
    );
  }
  const stable = new Map(previous.files.map((file) => [file.name, file.bytes]));
  const candidates = latest.files.filter(
    (file) =>
      !known.has(file.name) &&
      !isInFlightDownload({ name: file.name }) &&
      stable.get(file.name) === file.bytes &&
      (expectName === undefined || file.name === expectName),
  );
  const only = candidates.length === 1 ? candidates[0] : undefined;
  if (only === undefined) {
    return err(
      BrowserActionErrors.downloadNotResolved({
        candidates: candidates.length,
        directory,
        names: candidates.map((file) => file.name),
        ...(expectName === undefined ? {} : { expected: expectName }),
      }),
    );
  }
  return ok({ bytes: only.bytes, name: only.name, provenance: "directory-observed" });
}
