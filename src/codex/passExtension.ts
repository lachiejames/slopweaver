/**
 * A SUPERVISOR-APPROVED REVIEW-PASS EXTENSION — one row that admits ONE exact diff to review, in one lane, on one
 * branch of one repository, past the two-pass cap (`./reviewPassCap.ts`).
 *
 * ## The ruling it carries
 *
 * A pass past the cap is the pinned supervisor's to approve, for one run on one branch, recorded with its reason,
 * and it reaches the owner only when the approach itself carries a big trade-off. This row is the only way past the
 * cap: an owner card would spend the owner's attention on a routine call, and no variable opens a diff known to be
 * past it, since one any session could set would let a seat grant itself a pass. Only the pinned supervisor writes
 * a row (`./passExtensionGrant.ts`), and the gate honours a row only while its grantor holds the pin.
 *
 * ## Bound to the diff the supervisor approved
 *
 * A row names the full sha256 of the diff the seat was refused on, which the refusal prints for exactly this. The
 * gate admits a diff past the cap only when a row names THAT diff, so a row admits one pass and nothing else: a
 * later fix is a new diff the supervisor never saw, and is refused until it approves that one too. A retry of the
 * approved diff, or another property over it, is the same pass, which is the cap's own definition of a pass. A
 * rebase that moves the diff's index lines moves its sha256 too, which costs only a refusal. So a row needs no
 * "spent" mark: what it can admit is fixed when it is written.
 *
 * The gate does not filter on `run`, because review admission knows the branch and the diff and no run identity.
 * A later run on the same branch is admitted by an old row only for the identical diff that row approved — the same
 * pass. `run` is what `codex extend` holds to one extension per run and lane, and what an audit reads.
 *
 * ## One per run and lane, and a second names the first
 *
 * `codex extend` records one extension for a run's lane, counted across every repository. Each further one for the
 * same run and lane must carry `after`, the id of the latest one before it, with its own reason, so every further
 * approval is a deliberate act that says why the last was not enough rather than a repeated command. The chain has
 * no fixed length; each link is the supervisor's call.
 *
 * ## Scoped by repository as well as branch
 *
 * `$SLOPWEAVER_HOME` is shared by every repository on the machine. Each row carries the canonical
 * `git rev-parse --git-common-dir` of the checkout it was granted for, and a reader matches only its own. A path
 * deleted and recreated in place inherits its old rows: stated residue, since no durable clone id exists to bind to.
 *
 * ## What it does not carry across
 *
 * A row names the branch by its literal name, so a renamed branch keeps its passes (`./branchContinuity.ts`) but not
 * its extensions: a rename only ever REFUSES a pass a row would have allowed. Admission only: the landing floor
 * (`./ledgerReviewHalf.ts`) is not moved by a row, so an extension permits a pass and never obliges one.
 *
 * Pure: no filesystem. The store is `./passExtensionStore.ts`.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { parseVisibleSession, type VisibleSupervisorSession } from "../supervisor/session.js";
import type { ReviewLane } from "./reviewLane.js";

/** The one schema version this build writes and reads. A row with any other grants nothing. */
const PASS_EXTENSION_SCHEMA_VERSION = 1;

/** A full lowercase sha256, the only diff identity a row may name. */
const FULL_SHA256 = /^[0-9a-f]{64}$/;

/**
 * Whether a value names a lane this build holds a cap for, so a decoder refuses any other.
 *
 * @param value the field as read
 * @returns true for `general` or `baseline-bump-witness`
 */
export function isReviewLane(value: unknown): value is ReviewLane {
  return value === "general" || value === "baseline-bump-witness";
}

/**
 * Whether a value is a full lowercase sha256 — what a refusal prints and a row must name.
 *
 * @param value the candidate digest
 * @returns true for exactly 64 lowercase hex digits
 */
export function isFullSha256(value: unknown): value is string {
  return typeof value === "string" && FULL_SHA256.test(value);
}

/** One extra review pass the pinned supervisor approved, for one exact diff. */
export interface CodexPassExtension {
  readonly schemaVersion: typeof PASS_EXTENSION_SCHEMA_VERSION;
  readonly id: string;
  /** The canonical shared `.git` of the repository the run's checkout belongs to — what a reader matches on. */
  readonly gitCommonDir: string;
  /** The checkout the grant was read from, for a reader of `codex extend --list`. */
  readonly repoRoot: string;
  /** The branch the run's journal recorded at its latest `handover start`, never one a caller typed. */
  readonly branch: string;
  readonly lane: ReviewLane;
  /** The full sha256 of the one diff this row admits past the cap. */
  readonly diffSha256: string;
  /** The handover run the extension is for. */
  readonly run: string;
  /** Why the supervisor approved it, in the supervisor's words. */
  readonly reason: string;
  /** The id of the run's previous extension in this lane, required on every one after the first. */
  readonly after: string | undefined;
  /** The pinned supervisor session that recorded it. */
  readonly grantedBy: VisibleSupervisorSession;
  readonly atIso: string;
}

/** A register line that is not an object. */
export interface PassExtensionNotObjectError {
  readonly code: "NOT_AN_OBJECT";
  readonly message: string;
}

/** A row whose schema version, lane, grantor, instant or digest this build cannot accept. */
export interface PassExtensionInvalidFieldError {
  readonly code: "INVALID_FIELD";
  readonly message: string;
  readonly field: "schemaVersion" | "lane" | "grantedBy" | "atIso" | "diffSha256" | "after";
}

/** A row missing a required text field, or carrying one that says nothing. */
export interface PassExtensionMissingFieldsError {
  readonly code: "MISSING_FIELDS";
  readonly message: string;
  readonly fields: readonly string[];
}

/** A register file that exists and could not be read at all. */
export interface PassExtensionRegisterUnreadableError {
  readonly code: "REGISTER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** An append that did not reach the register. */
export interface PassExtensionAppendFailedError {
  readonly code: "APPEND_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Every way reading or writing an extension row fails. */
export type PassExtensionError =
  | PassExtensionNotObjectError
  | PassExtensionInvalidFieldError
  | PassExtensionMissingFieldsError
  | PassExtensionRegisterUnreadableError
  | PassExtensionAppendFailedError;

/** Factories for {@link PassExtensionError}, so every message is worded in one place. */
export const PassExtensionErrors = {
  appendFailed: ({ path, cause }: { path: string; cause: string }): PassExtensionAppendFailedError => ({
    code: "APPEND_FAILED",
    message: `the extension was not recorded at ${path}: ${cause}`,
    path,
  }),
  invalidField: ({
    field,
    why,
  }: {
    field: PassExtensionInvalidFieldError["field"];
    why: string;
  }): PassExtensionInvalidFieldError => ({ code: "INVALID_FIELD", field, message: `${field} ${why}` }),
  missingFields: ({ fields }: { fields: readonly string[] }): PassExtensionMissingFieldsError => ({
    code: "MISSING_FIELDS",
    fields,
    message: `missing or blank: ${fields.join(", ")}`,
  }),
  notAnObject: (): PassExtensionNotObjectError => ({ code: "NOT_AN_OBJECT", message: "the line is not an object" }),
  registerUnreadable: ({ path, cause }: { path: string; cause: string }): PassExtensionRegisterUnreadableError => ({
    code: "REGISTER_UNREADABLE",
    message: `the pass-extension register at ${path} would not read: ${cause}`,
    path,
  }),
} as const;

/**
 * Whether a field says anything: at least one letter or digit, so a reason of blank-rendering characters is refused.
 *
 * @param text the field
 * @returns true when it carries a letter or digit
 */
export function legibleText({ text }: { text: string }): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** A required string field, or `undefined` when it is absent, not a string, or says nothing. */
function legibleField({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string" || !legibleText({ text: value })) {
    return undefined;
  }
  return value;
}

/**
 * Decode one row strictly. A row that will not decode grants nothing, and the reader says so.
 *
 * @param value one parsed register line
 * @returns the extension, or which check it failed
 */
export function decodePassExtension({ value }: { value: unknown }): Result<CodexPassExtension, PassExtensionError> {
  if (!isRecord(value)) {
    return err(PassExtensionErrors.notAnObject());
  }
  if (value["schemaVersion"] !== PASS_EXTENSION_SCHEMA_VERSION) {
    const why = `${String(value["schemaVersion"])} is not one this build reads`;
    return err(PassExtensionErrors.invalidField({ field: "schemaVersion", why }));
  }
  const lane = value["lane"];
  if (!isReviewLane(lane)) {
    return err(PassExtensionErrors.invalidField({ field: "lane", why: `${String(lane)} is not a review lane` }));
  }
  const grantedBy = parseVisibleSession({ value: value["grantedBy"] });
  if (grantedBy === undefined) {
    return err(PassExtensionErrors.invalidField({ field: "grantedBy", why: "names no visible session" }));
  }
  const atIso = legibleField({ value: value["atIso"] });
  if (atIso === undefined || parseStrictIsoInstantMs({ text: atIso }) === undefined) {
    return err(PassExtensionErrors.invalidField({ field: "atIso", why: "is not a strict ISO instant" }));
  }
  const diffSha256 = value["diffSha256"];
  if (!isFullSha256(diffSha256)) {
    return err(PassExtensionErrors.invalidField({ field: "diffSha256", why: "is not a full lowercase sha256" }));
  }
  const rawAfter = value["after"];
  const after = legibleField({ value: rawAfter });
  if (rawAfter !== undefined && after === undefined) {
    return err(PassExtensionErrors.invalidField({ field: "after", why: "is present and names no extension id" }));
  }
  return textFields({ value }).map((text) => ({
    ...text,
    after,
    atIso,
    diffSha256,
    grantedBy,
    lane,
    schemaVersion: PASS_EXTENSION_SCHEMA_VERSION,
  }));
}

/** The required free-text fields of a row. */
type TextFields = Pick<CodexPassExtension, "branch" | "gitCommonDir" | "id" | "reason" | "repoRoot" | "run">;

/**
 * Read a row's required free-text fields, naming every one that is missing or blank at once.
 *
 * @param value the row, already known to be an object
 * @returns the fields, or the error naming each that said nothing
 */
function textFields({ value }: { value: Record<string, unknown> }): Result<TextFields, PassExtensionError> {
  const branch = legibleField({ value: value["branch"] });
  const gitCommonDir = legibleField({ value: value["gitCommonDir"] });
  const id = legibleField({ value: value["id"] });
  const reason = legibleField({ value: value["reason"] });
  const repoRoot = legibleField({ value: value["repoRoot"] });
  const run = legibleField({ value: value["run"] });
  if (
    branch === undefined ||
    gitCommonDir === undefined ||
    id === undefined ||
    reason === undefined ||
    repoRoot === undefined ||
    run === undefined
  ) {
    const fields = Object.entries({ branch, gitCommonDir, id, reason, repoRoot, run })
      .filter(([, field]) => field === undefined)
      .map(([name]) => name);
    return err(PassExtensionErrors.missingFields({ fields }));
  }
  return ok({ branch, gitCommonDir, id, reason, repoRoot, run });
}

/**
 * The row that admits one exact diff past the cap in one lane on one branch of one repository, if any.
 *
 * @param rows every decoded row, in file order
 * @param gitCommonDir the canonical shared `.git` of the checkout asking
 * @param diffSha256 the full sha256 of the diff about to be reviewed
 * @returns the earliest matching row, or `undefined` when the supervisor approved no such pass
 */
export function approvalFor({
  rows,
  branch,
  gitCommonDir,
  lane,
  diffSha256,
}: {
  rows: readonly CodexPassExtension[];
  branch: string;
  gitCommonDir: string;
  lane: ReviewLane;
  diffSha256: string;
}): CodexPassExtension | undefined {
  return rows.find(
    (row) =>
      row.branch === branch && row.gitCommonDir === gitCommonDir && row.lane === lane && row.diffSha256 === diffSha256,
  );
}

/**
 * The extensions one run already holds in one lane, across every repository, in grant order — what decides whether
 * the next one must name the one before it. Not narrowed by repository: one per run and lane is the run's budget,
 * so naming another checkout with `--repo` must not start a fresh sequence.
 *
 * @param rows every decoded row, in file order
 * @returns the run's rows in that lane, oldest first
 */
export function runExtensions({
  rows,
  run,
  lane,
}: {
  rows: readonly CodexPassExtension[];
  run: string;
  lane: ReviewLane;
}): readonly CodexPassExtension[] {
  return rows.filter((row) => row.run === run && row.lane === lane);
}
