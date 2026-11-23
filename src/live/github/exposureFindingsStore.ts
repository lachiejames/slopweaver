/**
 * Where `github exposure sweep` keeps what it found: one owner-only directory per run under the state home's
 * `githubExposureReports`, holding `findings.jsonl` (one finding per line, matched text included), `uploads.jsonl`
 * (one upload per line with every place linking it) and `summary.json` (the coverage and the counts). Directories are `0700` and files `0600`, each written atomically.
 *
 * The directory name is the run's instant, a digest of the repository and a nonce, never the repository's own
 * name. This is the only place a finding is written; the verb's output carries counts and this directory's
 * home-relative name.
 */

import { createHash } from "node:crypto";
import { join, relative } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic, writeFileAtomicStream } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { GithubExposureSweep } from "./exposureSweep.js";
import { githubExposureUploadCounts } from "./exposureUploads.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** Why one sweep's report could not be written into its run directory. */
export interface GithubExposureReportWriteError {
  readonly code: "REPORT_WRITE_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** The report store's refusal, built where its wording lives. */
const GithubExposureReportErrors = {
  writeFailed: ({ cause }: { cause: unknown }): GithubExposureReportWriteError => ({
    cause,
    code: "REPORT_WRITE_FAILED",
    message: `could not write the sweep report: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;

/** The three files one run writes. */
export const GITHUB_EXPOSURE_FINDINGS_FILE = "findings.jsonl";
export const GITHUB_EXPOSURE_SUMMARY_FILE = "summary.json";
export const GITHUB_EXPOSURE_UPLOADS_FILE = "uploads.jsonl";

/** Stream one record per line into one owner-only file of the run directory. */
function writeJsonl({ path, records }: { path: string; records: readonly unknown[] }): void {
  writeFileAtomicStream({
    dirMode: DIRECTORY_MODE,
    exactMode: true,
    fileMode: FILE_MODE,
    path,
    produce: ({ write }) => {
      for (const record of records) {
        write({ text: `${JSON.stringify(record)}\n` });
      }
    },
  });
}

/**
 * The directory one sweep run writes into. Pure.
 *
 * @param home the state home
 * @param readAtIso when the run read
 * @param repository the `owner/name` swept, digested so the name never appears in the path
 * @param nonce a per-run random suffix, so two runs in one second never share a directory
 * @returns the absolute directory, and the same path relative to the home for printing
 */
export function githubExposureRunDirectory({
  home,
  readAtIso,
  repository,
  nonce,
}: {
  home: string;
  readAtIso: string;
  repository: string;
  nonce: string;
}): { absolute: string; homeRelative: string } {
  const instant = readAtIso.replace(/[-:.]/gu, "");
  const digest = createHash("sha256").update(repository).digest("hex").slice(0, 12);
  const absolute = join(stateHomePaths({ home }).githubExposureReports, `${instant}-${digest}-${nonce}`);
  return { absolute, homeRelative: relative(home, absolute) };
}

/**
 * Write one sweep's findings, uploads and summary into its run directory.
 *
 * @param directory the run directory, from {@link githubExposureRunDirectory}
 * @param complete whether every surface's text was read, as the report decides it
 * @returns nothing on success, or why the write failed (nothing is printed from the findings either way)
 */
export function writeGithubExposureSweep({
  directory,
  sweep,
  complete,
}: {
  directory: string;
  sweep: GithubExposureSweep;
  complete: boolean;
}): Result<void, GithubExposureReportWriteError> {
  const counts = githubExposureUploadCounts({ uploads: sweep.uploads });
  try {
    writeJsonl({ path: join(directory, GITHUB_EXPOSURE_FINDINGS_FILE), records: sweep.findings });
    writeJsonl({ path: join(directory, GITHUB_EXPOSURE_UPLOADS_FILE), records: sweep.uploads });
    writeFileAtomic({
      contents: `${safeJsonStringify({
        label: "the exposure sweep summary",
        space: 2,
        value: {
          calls: sweep.calls,
          complete,
          findings: sweep.findings.length,
          readAtIso: sweep.readAtIso,
          repository: sweep.repository,
          schemaVersion: 2,
          surfaces: sweep.surfaces,
          uploadLinks: counts.links,
          uploads: counts.uploads,
        },
      })}\n`,
      dirMode: DIRECTORY_MODE,
      exactMode: true,
      fileMode: FILE_MODE,
      path: join(directory, GITHUB_EXPOSURE_SUMMARY_FILE),
    });
  } catch (error) {
    return err(GithubExposureReportErrors.writeFailed({ cause: error }));
  }
  return ok(undefined);
}
