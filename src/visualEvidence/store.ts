/**
 * Where image records live: one append-only file per artifact DIGEST, under an explicit home.
 *
 * ## Indexed by digest, which is what makes a failure un-hideable
 *
 * A record's filename is its artifact's digest, so the lookup key is a property of the bytes rather than of
 * anything a caller says. Renaming the file, citing another receipt, omitting the receipt, or switching
 * from `turn answer` to `slack post --media` all resolve the same file. There is no index keyed by path or
 * by receipt for a caller to route around, because there is no such index.
 *
 * ## Append-only, and ANY failure is terminal
 *
 * A second look at the same bytes appends rather than replaces, so the trail of what was observed survives
 * — including a look that found a defect after an earlier one passed. `./admission.ts` asks first whether
 * ANY record for the digest failed, and only chooses between passes when none did; a later `passed` line
 * can therefore never overturn an earlier `failed` one. This module never reorders or prunes.
 *
 * Two producers write here and both are looks at the FINAL bytes: the composing session through
 * `slopweaver browser image-record`, and — for a failure only — the reviewing session, through
 * `../live/turn/answerImageObservations.ts`, when its verdict says it opened an attachment and found it
 * unfit. The second is what makes a reviewer's "unreadable" outlive the one send it was written about.
 *
 * ## A record that will not parse is unbelievable, never absent
 *
 * Absence is hatchable and corruption is not, so this returns a typed failure for a malformed line rather
 * than an empty list. Reading a bad record as "no record" would hand it the missing-record exception, which
 * is the one arm the owner said must have no way past it.
 *
 * Its one sub-path is declared in `../stateHome.ts` like every other, so the home's layout stays a single
 * contract rather than a literal each store repeats.
 *
 * ## The `home` is always explicit
 *
 * Per `.claude/rules/testing.md`, nothing here resolves the ambient `$SLOPWEAVER_HOME`: every function
 * takes the home it writes under, so a test writes into its own `mkdtempSync` directory and the guard that
 * fails a test writing into the real home has nothing to catch.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { type ImageAdmissionError, ImageAdmissionErrors } from "./errors.js";
import { imageRecordSchema } from "./schema.js";
import type { ImageRecord } from "./types.js";

/**
 * The directory image records live in, under a given home.
 *
 * @param home the state home to resolve under
 * @returns the absolute directory path
 */
export function imageRecordsDir({ home }: { home: string }): string {
  return stateHomePaths({ home }).visualEvidenceRecords;
}

/**
 * The file holding every record for one artifact.
 *
 * The `sha256:` prefix is stripped for the filename because a colon is legal on darwin and confusing
 * everywhere else; the digest inside each record is the authority either way.
 *
 * @param home the state home to read or write under
 * @param digest the artifact digest, `sha256:` prefixed
 * @returns the absolute path to that artifact's record file
 */
export function imageRecordPath({ home, digest }: { home: string; digest: string }): string {
  return join(imageRecordsDir({ home }), `${digest.replace(/^sha256:/, "")}.jsonl`);
}

/** What one line of a record file turned out to be. A blank line is `skip`, not an issue. */
type LineRead =
  | { readonly kind: "record"; readonly record: ImageRecord }
  | { readonly kind: "issue"; readonly issue: string }
  | { readonly kind: "skip" };

/**
 * Decode and validate one line of a record file.
 *
 * Split out of {@link readImageRecords} so the streaming callback stays a hand-off and neither function
 * carries the whole decode-validate-classify branch set.
 *
 * @param line the raw line, without its newline
 * @param path the file it came from, named in any issue so a reader can go and look
 * @param index the 0-based line number the stream reported
 * @returns the record, the reason it is not one, or that the line was blank
 */
function recordOnLine({ line, path, index }: { line: string; path: string; index: number }): LineRead {
  if (line.trim() === "") {
    return { kind: "skip" };
  }
  const at = `${path} line ${String(index + 1)}`;
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `image record at ${path}`, text: line });
  } catch (error) {
    return { issue: `${at}: ${error instanceof Error ? error.message : String(error)}`, kind: "issue" };
  }
  const parsed = imageRecordSchema.safeParse(decoded);
  if (!parsed.success) {
    return { issue: `${at}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`, kind: "issue" };
  }
  return { kind: "record", record: parsed.data };
}

/**
 * Whether a failed read means the record file is ABSENT, or merely could not be read.
 *
 * The distinction is the whole gate. Absence reaches the missing-record arm, which the `unread-image`
 * hatch may waive; an unreadable store must never get there, because a failure record that exists but
 * cannot be read is still a failure. So exactly one error code is absence — `ENOENT` — and everything else,
 * including an error with no code at all, fails closed. `EACCES` (a directory that cannot be searched),
 * `ENOTDIR` (a file where the records directory should be) and `EIO` are all "could not establish", and
 * "could not establish" is not "fine".
 *
 * Deleting the store outright does read as absence, and that is the stated residue rather than a gap: local
 * records are auditable, not tamper-proof against a process that can edit the state home, and a process
 * that can remove the directory could equally rewrite a record.
 *
 * @param error what the read threw
 * @returns `absent` only for a genuine ENOENT, otherwise `unreadable`
 * @internal exported so the classification has a witness that does not depend on the filesystem — a
 * `chmod 000` test is silently meaningless when the suite runs as root.
 */
export function recordReadFailure({ error }: { error: unknown }): "absent" | "unreadable" {
  const hasCode = typeof error === "object" && error !== null && "code" in error;
  if (hasCode && error.code === "ENOENT") {
    return "absent";
  }
  return "unreadable";
}

/**
 * Every record held for one artifact, in the order they were written.
 *
 * @param home the state home to read under
 * @param digest the artifact digest to look up
 * @returns the records, empty when none exist, or why what is there cannot be believed
 */
export function readImageRecords({
  home,
  digest,
}: {
  home: string;
  digest: string;
}): Result<readonly ImageRecord[], ImageAdmissionError> {
  const path = imageRecordPath({ digest, home });
  const records: ImageRecord[] = [];
  const issues: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        const read = recordOnLine({ line, path, index });
        if (read.kind === "record") {
          records.push(read.record);
          return;
        }
        if (read.kind === "issue") {
          issues.push(read.issue);
        }
      },
      path,
    });
  } catch (error) {
    // NOT `existsSync` first. It answers `false` both for a file that is absent AND for one whose directory
    // cannot be searched, so a record that is present but unreadable came back as no record — the hatchable
    // arm — and a known-bad image went out through `SLOPWEAVER_ALLOW_UNREAD_IMAGE`. `chmod 000` on the records
    // directory reproduces it. Only a genuine ENOENT is absence; see
    // `recordReadFailure`.
    if (recordReadFailure({ error }) === "absent") {
      return ok([]);
    }
    return err(ImageAdmissionErrors.storeFailed({ cause: error }));
  }
  if (issues.length > 0) {
    return err(ImageAdmissionErrors.evidenceInvalid({ issues }));
  }
  return ok(records);
}

/**
 * Append one record for its artifact.
 *
 * A `failed` record is written exactly as readily as a passing one, and its caller must not roll it back
 * when admission then refuses the send: the record is the durable fact that somebody looked, and a
 * refusal is a consequence of it rather than a reason to forget it. That ordering is what makes the
 * no-hatch arm reachable at all.
 *
 * @param home the state home to write under
 * @param record the record to append
 * @returns nothing; `IMAGE_EVIDENCE_INVALID` for a record the read schema would refuse, which is never
 *   written; `IMAGE_STORE_FAILED` when the store itself could not be written
 */
export function appendImageRecord({
  home,
  record,
}: {
  home: string;
  record: ImageRecord;
}): Result<null, ImageAdmissionError> {
  // The write edge runs the READ schema before a byte lands. `ImageRecord` types every digest as `string`,
  // so a producer whose own parse edge is looser than `imageRecordSchema` compiles, writes, and poisons
  // every later read of that digest — one bad row and `recordOnLine` refuses the file. MEASURED:
  // `image-record` admitted a bare hex `crop.sourceDigest`, and `automation run-due --media`
  // burned a slot attempt on the read-back. Three producers append here; refusing once, here, is what
  // makes the invariant hold for the next one too.
  const believable = imageRecordSchema.safeParse(record);
  if (!believable.success) {
    return err(
      ImageAdmissionErrors.evidenceInvalid({
        issues: believable.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    );
  }
  try {
    const encoded = safeJsonStringify({ label: "image record", value: record });
    mkdirSync(imageRecordsDir({ home }), { recursive: true });
    const path = imageRecordPath({ digest: record.artifact.digest, home });
    // Through `appendLines`, which starts the record on a fresh line. MEASURED in review of the
    // reviewer-observation change: a file whose final line had no trailing newline took the next record as `}{`
    // and NEITHER row parsed, so one bad append poisoned every later read of that digest.
    appendLines({ path, text: `${encoded}\n` });
  } catch (error) {
    return err(ImageAdmissionErrors.storeFailed({ cause: error }));
  }
  return ok(null);
}
