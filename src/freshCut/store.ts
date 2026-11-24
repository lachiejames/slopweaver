/**
 * Where a fresh cut's record and its verifications live: `$home/fresh-cuts/<record-id>/`, owner-only. The record is
 * written once, after every check on the new repository passed; each verification adds a report beside it and never
 * rewrites the record.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { type FreshCutRecord, type FreshCutVerification, freshCutRecordSchema } from "./core.js";
import { type FreshCutError, FreshCutErrors } from "./errors.js";

/** Directories this store makes: owner-only, since a report names the files a private term sits in. */
const DIRECTORY_MODE = 0o700;

/** Files this store writes: owner-only, for the same reason. */
const FILE_MODE = 0o600;

/**
 * The directory one cut's record and reports sit in.
 *
 * @param home the state home
 * @param recordId the cut's id
 * @returns the absolute directory
 */
function freshCutDirectory({ home, recordId }: { home: string; recordId: string }): string {
  return join(stateHomePaths({ home }).freshCuts, recordId);
}

/**
 * Write a cut's record, owner-only and atomically.
 *
 * @param home the state home
 * @param record what `produce` returned once every check on the new repository passed
 * @returns the path written, or why it could not be
 */
export function writeFreshCutRecord({
  home,
  record,
}: {
  home: string;
  record: FreshCutRecord;
}): Result<string, FreshCutError> {
  const path = join(freshCutDirectory({ home, recordId: record.recordId }), "record.json");
  return writeOwnerOnly({ path, text: `${JSON.stringify(record, null, 2)}\n` });
}

/**
 * Read and validate a cut's record. A missing, unparseable or malformed record refuses: a verification of a cut
 * nobody can say the origin of is not one.
 *
 * @param home the state home
 * @param recordId the cut's id, as `fresh-cut produce` printed it
 * @returns the record, or why it could not be read
 */
export function readFreshCutRecord({
  home,
  recordId,
}: {
  home: string;
  recordId: string;
}): Result<FreshCutRecord, FreshCutError> {
  const path = join(freshCutDirectory({ home, recordId }), "record.json");
  let json: unknown;
  try {
    // One small record this store wrote itself, so a whole-file parse is bounded by the schema below.
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return err(FreshCutErrors.recordUnreadable({ path, why: error instanceof Error ? error.message : String(error) }));
  }
  const parsed = freshCutRecordSchema.safeParse(json);
  if (!parsed.success || parsed.data.recordId !== recordId) {
    return err(FreshCutErrors.recordUnreadable({ path, why: "it is not a fresh-cut record for that id" }));
  }
  return ok(parsed.data);
}

/**
 * Write one verification's report beside its record, named for the instant it ran.
 *
 * @param home the state home
 * @param verification the finished verification
 * @returns the path written, or why it could not be
 */
export function writeFreshCutVerification({
  home,
  verification,
}: {
  home: string;
  verification: FreshCutVerification;
}): Result<string, FreshCutError> {
  const stamp = verification.verifiedAtIso.replaceAll(":", "-");
  const path = join(freshCutDirectory({ home, recordId: verification.recordId }), `verify-${stamp}.json`);
  return writeOwnerOnly({ path, text: `${JSON.stringify(verification, null, 2)}\n` });
}

/** A full git object id, SHA-1 or SHA-256. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A count a report carries. */
const countSchema = z.number().int().nonnegative();

/**
 * The whole verification report `fresh-cut verify` writes. The standing of a cut is judged on three of its fields, but
 * every field is checked, and `clear` must mean no findings: a file carrying a `clear` status and nothing else is not a
 * verification, and reading it as one would let it publish a cut nothing scanned.
 */
const verificationReportSchema = z
  .object({
    destinationTreeSha: z.string().regex(OBJECT_ID),
    exemptions: z
      .object({
        "code-owner": countSchema,
        "documentation-address": countSchema,
        "own-address": countSchema,
        "owner-reference": countSchema,
      })
      .strict(),
    filesScanned: countSchema,
    findings: z.array(
      z.discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("hygiene"), label: z.string().min(1), line: countSchema, path: z.string() })
          .strict(),
        z
          .object({
            className: z.string().min(1),
            kind: z.literal("private-term"),
            line: countSchema,
            path: z.string(),
          })
          .strict(),
      ]),
    ),
    recordId: z.uuid(),
    reviewedAccepted: countSchema,
    reviewedResidueSha256: z.string().regex(/^[0-9a-f]{64}$/),
    schemaVersion: z.literal(2),
    sourceTreeSha: z.string().regex(OBJECT_ID),
    status: z.enum(["clear", "refused"]),
    verifiedAtIso: z.iso.datetime(),
  })
  .strict()
  .refine((report) => (report.status === "clear") === (report.findings.length === 0));

/** Where the cuts carrying one root stand: none recorded, recorded but never verified, or their latest verification. */
export type CutRootStanding =
  | { readonly kind: "no-record" }
  | { readonly kind: "unverified"; readonly recordIds: readonly string[] }
  | {
      readonly kind: "verified";
      readonly recordId: string;
      readonly status: "clear" | "refused";
      readonly verifiedAtIso: string;
    };

/** One verification, as the standing of a cut is judged on it. */
type VerifiedStanding = Extract<CutRootStanding, { kind: "verified" }>;

/**
 * The latest verification of any cut whose root is `rootSha`, across every record carrying it: the register binds a
 * root, not a record, so an older clear verification of one record never outranks a newer refusal of another.
 * Fails closed: a record or report that cannot be read refuses, because skipping it could skip the very
 * verification that refused, and two latest reports at one instant that disagree refuse as well.
 *
 * @param home the state home
 * @param rootSha the full sha of the root a repository is bound to
 * @returns where the cuts carrying that root stand, or why it could not be read
 */
export function cutRootStanding({
  home,
  rootSha,
}: {
  home: string;
  rootSha: string;
}): Result<CutRootStanding, FreshCutError> {
  const root = stateHomePaths({ home }).freshCuts;
  if (!existsSync(root)) {
    return ok({ kind: "no-record" });
  }
  const recordIds: string[] = [];
  const reports: VerifiedStanding[] = [];
  const directories = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const recordId of directories.map((entry) => entry.name).toSorted()) {
    const record = readFreshCutRecord({ home, recordId });
    if (record.isErr()) {
      return err(record.error);
    }
    if (record.value.rootSha !== rootSha) {
      continue;
    }
    recordIds.push(recordId);
    const read = reportsOf({ directory: join(root, recordId), recordId });
    if (read.isErr()) {
      return err(read.error);
    }
    for (const report of read.value) {
      reports.push(report);
    }
  }
  if (recordIds.length === 0) {
    return ok({ kind: "no-record" });
  }
  return latestOf({ recordIds, reports });
}

/**
 * The latest of a root's verifications, refusing a tie at the latest instant whose results disagree.
 *
 * @param recordIds every record carrying the root
 * @param reports every verification of those records
 * @returns the standing, or the conflict
 */
function latestOf({
  recordIds,
  reports,
}: {
  recordIds: readonly string[];
  reports: readonly VerifiedStanding[];
}): Result<CutRootStanding, FreshCutError> {
  if (reports.length === 0) {
    return ok({ kind: "unverified", recordIds });
  }
  const instants = reports.map((report) => Date.parse(report.verifiedAtIso));
  const at = instants.reduce((latestSoFar, instant) => Math.max(latestSoFar, instant));
  const latest = reports.filter((_, index) => instants[index] === at);
  const first = latest[0]!;
  if (latest.some((report) => report.status !== first.status)) {
    const ids = Array.from(new Set(latest.map((report) => report.recordId)));
    return err(FreshCutErrors.verificationConflict({ at: first.verifiedAtIso, recordIds: ids }));
  }
  return ok(first);
}

/**
 * Every verification report in one cut's directory.
 *
 * @param directory the cut's directory
 * @param recordId the cut's id, which every report in it must carry
 * @returns each report's standing, or why one could not be read
 */
function reportsOf({
  directory,
  recordId,
}: {
  directory: string;
  recordId: string;
}): Result<readonly VerifiedStanding[], FreshCutError> {
  const reports: VerifiedStanding[] = [];
  for (const name of readdirSync(directory).filter((entry) => /^verify-.+\.json$/.test(entry))) {
    const path = join(directory, name);
    let json: unknown;
    try {
      // One small report this store wrote itself; the schema below bounds what is kept.
      json = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return err(FreshCutErrors.verificationUnreadable({ path, why }));
    }
    const parsed = verificationReportSchema.safeParse(json);
    if (!parsed.success || parsed.data.recordId !== recordId) {
      return err(FreshCutErrors.verificationUnreadable({ path, why: "it is not a whole verification of that cut" }));
    }
    const { status, verifiedAtIso } = parsed.data;
    reports.push({ kind: "verified", recordId, status, verifiedAtIso });
  }
  return ok(reports);
}

/**
 * Write one owner-only file atomically.
 *
 * @param path the file
 * @param text its contents
 * @returns the path, or why it could not be written
 */
function writeOwnerOnly({ path, text }: { path: string; text: string }): Result<string, FreshCutError> {
  try {
    writeFileAtomic({ contents: text, dirMode: DIRECTORY_MODE, exactMode: true, fileMode: FILE_MODE, path });
    return ok(path);
  } catch (error) {
    return err(
      FreshCutErrors.recordWriteFailed({ cause: error instanceof Error ? error.message : String(error), path }),
    );
  }
}
