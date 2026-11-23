/**
 * Where `audit publications` keeps what it found: one owner-only directory per run under the state home's
 * `publicationAuditReports` (`findings.jsonl`, `summary.json`), and `latest.json` beside them — the last run's whole
 * sanitised report, which the `publication-leak` monitor reads. Directories are `0700` and files `0600`, each written
 * atomically.
 *
 * Every record here is the sanitised shape (`./types.ts`): a class, a door, a link and a coordinate-only id. The
 * matched text is never in hand by the time anything is written, so no file of this area can carry it.
 *
 * `latest.json` is written for every run, complete or not, and carries each door's coverage: the monitor decides
 * from that whether a run may settle a finding it no longer sees, so a partial run never reads as a clean one.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { z } from "zod";

import { PRIVATE_TERM_CLASSES } from "../../hygiene/privateTerms.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic, writeFileAtomicStream } from "../../lib/writeAtomic.js";
import type { InstallationStateKind } from "../../outbound/privacyCheck.js";
import { stateHomePaths } from "../../stateHome.js";

import {
  PUBLICATION_DOORS,
  type PublicationClass,
  type PublicationCounts,
  type PublicationDoorCoverage,
  type PublicationFinding,
} from "./types.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** The files one run writes, and the pointer the monitor reads. */
export const PUBLICATION_AUDIT_FINDINGS_FILE = "findings.jsonl";
export const PUBLICATION_AUDIT_SUMMARY_FILE = "summary.json";
export const PUBLICATION_AUDIT_LATEST_FILE = "latest.json";

/** One run's sanitised report — the whole of what `latest.json` holds. */
export interface PublicationAuditReport {
  readonly schemaVersion: 1;
  readonly readAtIso: string;
  /** The run's directory, relative to the state home. */
  readonly run: string;
  readonly coverage: readonly PublicationDoorCoverage[];
  readonly counts: PublicationCounts;
  readonly withheldLinks: number;
  readonly findings: readonly PublicationFinding[];
}

/** Why the store could not write or read a report. */
export type PublicationAuditStoreError =
  | { readonly code: "REPORT_WRITE_FAILED"; readonly message: string }
  | { readonly code: "REPORT_ABSENT"; readonly message: string }
  | { readonly code: "REPORT_UNREADABLE"; readonly message: string }
  | { readonly code: "REPORT_MALFORMED"; readonly message: string };

/** The store's refusals, each built where its wording lives. Never carries a report's content. */
export const PublicationAuditStoreErrors = {
  absent: (): PublicationAuditStoreError => ({
    code: "REPORT_ABSENT",
    message: "no publication audit has run here — run `slopweaver audit publications`",
  }),
  malformed: ({ why }: { why: string }): PublicationAuditStoreError => ({
    code: "REPORT_MALFORMED",
    message: `the last publication audit report is not the expected shape: ${why}`,
  }),
  unreadable: ({ cause }: { cause: unknown }): PublicationAuditStoreError => ({
    code: "REPORT_UNREADABLE",
    message: `the last publication audit report could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  writeFailed: ({ cause }: { cause: unknown }): PublicationAuditStoreError => ({
    code: "REPORT_WRITE_FAILED",
    message: `could not write the publication audit report: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;

const doorSchema = z.enum(PUBLICATION_DOORS);

/** Every installation-state kind, keyed so the compiler refuses a kind the privacy check adds and this list misses. */
const INSTALLATION_STATE_KINDS: Readonly<Record<InstallationStateKind, true>> = {
  "home-path": true,
  "machine-temp-path": true,
  "observed-by": true,
  "session-id": true,
  "transcript-pointer": true,
};

/** A hygiene class's label: the plain lowercase slug `core.ts` carries, or `unnamed`. */
const HYGIENE_LABEL = /^[a-z0-9][a-z0-9-]*$/u;

/**
 * Whether a stored class is one the audit can write: a known installation-state kind, a hygiene slug, or a known
 * private-term class.
 *
 * @param value the stored field, unchecked
 * @returns true when it is a {@link PublicationClass}
 */
function isPublicationClass(value: unknown): value is PublicationClass {
  if (typeof value !== "string") {
    return false;
  }
  const slash = value.indexOf("/");
  const category = value.slice(0, slash);
  const rest = value.slice(slash + 1);
  if (category === "installation-state") {
    return Object.hasOwn(INSTALLATION_STATE_KINDS, rest);
  }
  if (category === "hygiene") {
    return HYGIENE_LABEL.test(rest);
  }
  return category === "private-term" && PRIVATE_TERM_CLASSES.some((known) => known === rest);
}

const findingSchema = z.strictObject({
  className: z.custom<PublicationClass>(isPublicationClass, { message: "not a publication class" }),
  door: doorSchema,
  fields: z.array(z.string().regex(/^[a-z_]+(?:\.[a-z_]+)*$/u)),
  findingId: z.string().regex(/^[0-9a-f]{16}$/u),
  link: z.url().nullable(),
});

const coverageSchema = z.strictObject({
  attachmentsNotSwept: z.number().int().nonnegative(),
  door: doorSchema,
  gaps: z.array(z.string()),
  objects: z.number().int().nonnegative(),
  state: z.enum(["complete", "partial", "not-swept"]),
  texts: z.number().int().nonnegative(),
});

const reportSchema = z.strictObject({
  counts: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())),
  coverage: z.array(coverageSchema),
  findings: z.array(findingSchema),
  readAtIso: z.iso.datetime(),
  run: z.string(),
  schemaVersion: z.literal(1),
  withheldLinks: z.number().int().nonnegative(),
});

/**
 * The directory one run writes into. Pure.
 *
 * @param home the state home
 * @param readAtIso when the run read
 * @param nonce a per-run random suffix, so two runs in one second never share a directory
 * @returns the absolute directory, and the same path relative to the home for printing
 */
export function publicationAuditRunDirectory({
  home,
  readAtIso,
  nonce,
}: {
  home: string;
  readAtIso: string;
  nonce: string;
}): { absolute: string; homeRelative: string } {
  const instant = readAtIso.replace(/[-:.]/gu, "");
  const absolute = join(stateHomePaths({ home }).publicationAuditReports, `${instant}-${nonce}`);
  return { absolute, homeRelative: relative(home, absolute) };
}

/** Write one owner-only JSON document atomically. */
function writeJson({ path, value, label }: { path: string; value: unknown; label: string }): void {
  writeFileAtomic({
    contents: `${safeJsonStringify({ label, space: 2, value })}\n`,
    dirMode: DIRECTORY_MODE,
    exactMode: true,
    fileMode: FILE_MODE,
    path,
  });
}

/**
 * Write one run's findings and summary into its directory, then point `latest.json` at the whole report.
 *
 * @param home the state home
 * @param directory the run directory, from {@link publicationAuditRunDirectory}
 * @param report the run's sanitised report
 * @returns nothing on success, or why the write failed
 */
export function writePublicationAudit({
  home,
  directory,
  report,
}: {
  home: string;
  directory: string;
  report: PublicationAuditReport;
}): Result<void, PublicationAuditStoreError> {
  try {
    writeFileAtomicStream({
      dirMode: DIRECTORY_MODE,
      exactMode: true,
      fileMode: FILE_MODE,
      path: join(directory, PUBLICATION_AUDIT_FINDINGS_FILE),
      produce: ({ write }) => {
        for (const finding of report.findings) {
          write({ text: `${JSON.stringify(finding)}\n` });
        }
      },
    });
    const { findings: _findings, ...summary } = report;
    writeJson({
      label: "the publication audit summary",
      path: join(directory, PUBLICATION_AUDIT_SUMMARY_FILE),
      value: { ...summary, findings: report.findings.length },
    });
    writeJson({
      label: "the publication audit report",
      path: join(stateHomePaths({ home }).publicationAuditReports, PUBLICATION_AUDIT_LATEST_FILE),
      value: report,
    });
  } catch (error) {
    return err(PublicationAuditStoreErrors.writeFailed({ cause: error }));
  }
  return ok(undefined);
}

/**
 * Read the last run's report back, validated.
 *
 * @param home the state home
 * @returns the report, or why there is none to read: absent, unreadable or malformed are three different answers
 */
export function readLatestPublicationAudit({
  home,
}: {
  home: string;
}): Result<PublicationAuditReport, PublicationAuditStoreError> {
  const path = join(stateHomePaths({ home }).publicationAuditReports, PUBLICATION_AUDIT_LATEST_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return err(PublicationAuditStoreErrors.absent());
    }
    return err(PublicationAuditStoreErrors.unreadable({ cause: error }));
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "the publication audit report", text: raw });
  } catch {
    return err(PublicationAuditStoreErrors.malformed({ why: "not JSON" }));
  }
  const checked = reportSchema.safeParse(parsed);
  if (!checked.success) {
    const where = checked.error.issues.map((issue) => issue.path.join(".")).join(", ");
    return err(PublicationAuditStoreErrors.malformed({ why: `fields ${where}` }));
  }
  return ok(checked.data);
}
