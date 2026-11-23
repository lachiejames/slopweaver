/**
 * The pure half of the owner-judgement store: how a directive or correction becomes a stored version, how the
 * ACTIVE versions project back into the portable {@link OwnerDirectiveOverlay}, and how a memory event becomes
 * the shapes the planning half (`./ownerJudgementPlan.ts`) turns a memory event into. Zero I/O — the rows module
 * (`./ownerDirectiveRows.ts`) speaks SQL, and `./ownerDirectiveStore.ts` orders the steps.
 *
 * ## The projection is the fingerprint's input, so it carries the domain fields only
 *
 * A store export fingerprints the overlay (`../store/transfer/retained.ts`), so the projection rebuilds exactly
 * what the legacy file held — id, text, source `{file, contentHash, modified}` and a correction's subject — sorted
 * by id the way the merges sort, and runs it through {@link parseOwnerDirectiveOverlay} so key order and bounds
 * are the parse edge's own. A row's `row_id`, `state`, `origin`, `recorded_at` and `import_question_id` never enter it, and
 * only an ACTIVE version projects at all.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";

import { type ImportMarker, markerRefusal } from "../store/registerImport.js";

import { type OwnerDirectiveError, OwnerDirectiveErrors } from "./ownerDirective.errors.js";
import {
  OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
  type OwnerCorrection,
  type OwnerDirective,
  type OwnerDirectiveOverlay,
  type OwnerDirectiveRemoval,
  ownerCorrectionSchema,
  ownerDirectiveSchema,
  parseOwnerDirectiveOverlay,
} from "./ownerDirective.js";

/** Whether one version steers anything. */
export type JudgementInstructionState = "active" | "inactive";

/**
 * Every writer a version can name, in the order the store's `owner_judgement_origin` type declares them.
 * `store-import` is an applied store import's, written by `./ownerJudgementImport.ts` alone.
 */
export const OWNER_JUDGEMENT_ORIGINS = ["legacy-file", "memory", "store-import"] as const;

/** Which writer produced one version; it never changes, so a retired legacy version still says `legacy-file`. */
export type OwnerJudgementOrigin = (typeof OWNER_JUDGEMENT_ORIGINS)[number];

/** One stored directive version, as the rows module reads it — a concrete shape, not a Drizzle inference. */
export interface StoredOwnerDirective {
  readonly rowId: string;
  readonly directiveId: string;
  readonly state: JudgementInstructionState;
  readonly origin: OwnerJudgementOrigin;
  readonly text: string;
  readonly sourceFile: string;
  readonly sourceContentHash: string;
  readonly sourceModified: string | null;
}

/** One stored correction version, its subject spread into columns. */
export interface StoredOwnerCorrection {
  readonly rowId: string;
  readonly correctionId: string;
  readonly state: JudgementInstructionState;
  readonly origin: OwnerJudgementOrigin;
  readonly text: string;
  readonly sourceFile: string;
  readonly sourceContentHash: string;
  readonly sourceModified: string | null;
  readonly subjectSource: string;
  readonly subjectContainer: string;
  readonly subjectSourceId: string;
  readonly subjectUrl: string | null;
}

/** What a read of both tables returned. */
export interface StoredOwnerJudgement {
  readonly directives: readonly StoredOwnerDirective[];
  readonly corrections: readonly StoredOwnerCorrection[];
}

/** One instruction the legacy file carried, as the one-time import inserts it. */
export type OwnerJudgementRecord =
  | { readonly kind: "directive"; readonly directive: OwnerDirective }
  | { readonly kind: "correction"; readonly correction: OwnerCorrection };

/** The state transitions one memory event makes: whose active version retires, and which versions activate. */
export interface OwnerJudgementTransition {
  readonly retireDirectives: readonly string[];
  readonly activateDirectives: readonly OwnerDirective[];
  readonly retireCorrections: readonly string[];
  readonly activateCorrections: readonly OwnerCorrection[];
}

/** Every overlay change observed in one hook event. */
export interface OwnerDirectiveChanges {
  readonly directives: readonly OwnerDirective[];
  readonly corrections: readonly OwnerCorrection[];
  readonly removals: readonly OwnerDirectiveRemoval[];
}

/** Whether syncing explicit memories changed the stored owner judgement. */
export interface OwnerDirectiveSyncOutcome {
  readonly kind: "unchanged" | "written";
  /** How many directives are active once the event is applied. */
  readonly directiveCount: number;
}

/** The overlay with nothing in it — what an empty authority projects to. */
export const EMPTY_OWNER_DIRECTIVE_OVERLAY: OwnerDirectiveOverlay = {
  corrections: [],
  directives: [],
  schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
};

/**
 * One directive as the columns of a stored version.
 *
 * @param state whether the version steers
 * @param origin the writer producing it — `legacy-file` for the one-time import, `memory` for a memory event
 * @returns the version, less the row id the store assigns
 */
export function directiveRowOf({
  directive,
  state,
  origin,
}: {
  directive: OwnerDirective;
  state: JudgementInstructionState;
  origin: OwnerJudgementOrigin;
}): Omit<StoredOwnerDirective, "rowId"> {
  return {
    directiveId: directive.id,
    origin,
    sourceContentHash: directive.source.contentHash,
    sourceFile: directive.source.file,
    sourceModified: directive.source.modified,
    state,
    text: directive.text,
  };
}

/**
 * One correction as the columns of a stored version; an absent subject URL is null.
 *
 * @param state whether the version steers
 * @param origin the writer producing it — `legacy-file` for the one-time import, `memory` for a memory event
 * @returns the version, less the row id the store assigns
 */
export function correctionRowOf({
  correction,
  state,
  origin,
}: {
  correction: OwnerCorrection;
  state: JudgementInstructionState;
  origin: OwnerJudgementOrigin;
}): Omit<StoredOwnerCorrection, "rowId"> {
  return {
    correctionId: correction.id,
    origin,
    sourceContentHash: correction.source.contentHash,
    sourceFile: correction.source.file,
    sourceModified: correction.source.modified,
    state,
    subjectContainer: correction.subject.container,
    subjectSource: correction.subject.source,
    subjectSourceId: correction.subject.sourceId,
    subjectUrl: unsetFieldAsNull({ key: "url", record: correction.subject }),
    text: correction.text,
  };
}

/**
 * The rows the one-time import inserts for a home file's instructions: every one an active `legacy-file` version.
 *
 * @param records the file's directives and corrections
 * @returns the directive rows and the correction rows, each in file order
 */
export function importedRowsOf({ records }: { records: readonly OwnerJudgementRecord[] }): {
  readonly directives: readonly Omit<StoredOwnerDirective, "rowId">[];
  readonly corrections: readonly Omit<StoredOwnerCorrection, "rowId">[];
} {
  const directives = records.flatMap((record) =>
    record.kind === "directive"
      ? [directiveRowOf({ directive: record.directive, origin: "legacy-file", state: "active" })]
      : [],
  );
  const corrections = records.flatMap((record) =>
    record.kind === "correction"
      ? [correctionRowOf({ correction: record.correction, origin: "legacy-file", state: "active" })]
      : [],
  );
  return { corrections, directives };
}

/**
 * Decode one stored directive version strictly, through the same schema a memory's directive passes.
 *
 * @param row the stored version
 * @returns the directive, or the row named by its row id and logical id
 */
export function directiveOfRow({ row }: { row: StoredOwnerDirective }): Result<OwnerDirective, OwnerDirectiveError> {
  const parsed = ownerDirectiveSchema.safeParse({
    id: row.directiveId,
    source: { contentHash: row.sourceContentHash, file: row.sourceFile, modified: row.sourceModified },
    text: row.text,
  });
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    OwnerDirectiveErrors.rowUnreadable({
      id: row.directiveId,
      issues: parsed.error.issues.map((issue) => issue.message),
      rowId: row.rowId,
      table: "owner_directive",
    }),
  );
}

/**
 * Decode one stored correction version strictly; a null subject URL is absent, never an empty string.
 *
 * @param row the stored version
 * @returns the correction, or the row named by its row id and logical id
 */
export function correctionOfRow({ row }: { row: StoredOwnerCorrection }): Result<OwnerCorrection, OwnerDirectiveError> {
  const subject = {
    container: row.subjectContainer,
    source: row.subjectSource,
    sourceId: row.subjectSourceId,
    ...(row.subjectUrl === null ? {} : { url: row.subjectUrl }),
  };
  const parsed = ownerCorrectionSchema.safeParse({
    id: row.correctionId,
    source: { contentHash: row.sourceContentHash, file: row.sourceFile, modified: row.sourceModified },
    subject,
    text: row.text,
  });
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    OwnerDirectiveErrors.rowUnreadable({
      id: row.correctionId,
      issues: parsed.error.issues.map((issue) => issue.message),
      rowId: row.rowId,
      table: "owner_correction",
    }),
  );
}

/**
 * Decode every ACTIVE version of one kind, refusing the whole read on the first that will not decode.
 *
 * @returns the decoded values sorted by id, or the refusal
 */
function decodeActive<R extends { readonly state: JudgementInstructionState }, T extends { readonly id: string }>({
  rows,
  decode,
}: {
  rows: readonly R[];
  decode: (row: R) => Result<T, OwnerDirectiveError>;
}): Result<readonly T[], OwnerDirectiveError> {
  const decoded: T[] = [];
  for (const row of rows) {
    if (row.state !== "active") {
      continue;
    }
    const value = decode(row);
    if (value.isErr()) {
      return err(value.error);
    }
    decoded.push(value.value);
  }
  return ok(decoded.toSorted((left, right) => left.id.localeCompare(right.id)));
}

/**
 * The portable overlay the ACTIVE versions project to — an inactive version never appears in it.
 *
 * @param stored both tables as read
 * @returns the overlay, or the first row that will not decode, or the overlay's own bound refused
 */
export function overlayOfActiveRows({
  stored,
}: {
  stored: StoredOwnerJudgement;
}): Result<OwnerDirectiveOverlay, OwnerDirectiveError> {
  const directives = decodeActive({ decode: (row) => directiveOfRow({ row }), rows: stored.directives });
  if (directives.isErr()) {
    return err(directives.error);
  }
  const corrections = decodeActive({ decode: (row) => correctionOfRow({ row }), rows: stored.corrections });
  if (corrections.isErr()) {
    return err(corrections.error);
  }
  return parseOwnerDirectiveOverlay({
    value: {
      corrections: corrections.value,
      directives: directives.value,
      schemaVersion: OWNER_DIRECTIVE_OVERLAY_SCHEMA_VERSION,
    },
  });
}

/**
 * Judge the owner-judgement marker as a snapshot read it, after the one-time import has already run. A missing
 * marker means the import this read followed was undone, and a count below the marker means imported rows were
 * lost: either way the snapshot's active rows are not the register, so they are refused rather than exported.
 *
 * @param marker the marker and its counted rows, read inside the snapshot, or undefined when none stands
 * @returns the refusal, or undefined when the snapshot's rows may stand
 */
export function snapshotMarkerRefusal({
  marker,
}: {
  marker: ImportMarker | undefined;
}): OwnerDirectiveError | undefined {
  if (marker === undefined) {
    return OwnerDirectiveErrors.storeUnavailable({
      doing: "read the owner-judgement import marker inside the reading snapshot",
      reason: "the marker the import wrote is gone",
    });
  }
  const refused = markerRefusal({ marker });
  if (refused === undefined) {
    return undefined;
  }
  return OwnerDirectiveErrors.importMarkerInconsistent(refused.markerInconsistency);
}

/**
 * Every instruction a legacy overlay holds, as the import records it inserts.
 *
 * @param overlay the parsed legacy overlay
 * @returns its directives, then its corrections, in file order
 */
export function importRecordsOf({ overlay }: { overlay: OwnerDirectiveOverlay }): readonly OwnerJudgementRecord[] {
  return [
    ...overlay.directives.map((directive): OwnerJudgementRecord => ({ directive, kind: "directive" })),
    ...overlay.corrections.map((correction): OwnerJudgementRecord => ({ correction, kind: "correction" })),
  ];
}
