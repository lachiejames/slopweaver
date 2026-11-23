/**
 * The shapes `handover backfill-rulings` plans and reports — one verdict per reviewed answer, and the whole
 * report its `--json` prints.
 *
 * Kept apart from the classifier so the effectful shell and the verb can name them without importing it.
 */

import type { Result } from "#lib/result.js";

import type { RulingEvent } from "./ledger.js";
import type { RowEventWritten } from "./rowEvent.js";
import type { RowWriteError } from "./rowEventErrors.js";
import type { RulingAuditProblem, RulingAuditProblemCode } from "./rulingAuditErrors.js";
import type { RulingAuditInput, RulingAuditReport, RulingPlacement } from "./rulingAuditTypes.js";
import type { RulingBackfillFailure } from "./rulingBackfillErrors.js";
import type { RulingManifestEntry } from "./rulingManifest.js";

/** What one reviewed answer's entry came to, in manifest order. */
export type RulingBackfillEntry =
  /** Nothing on the row represents this answer, and the append seam accepts the event that would. */
  | { readonly status: "append"; readonly entryIndex: number; readonly entry: RulingManifestEntry }
  /** The row already carries exactly this reconstruction, so there is nothing to write. */
  | {
      readonly status: "already-recorded";
      readonly entryIndex: number;
      readonly entry: RulingManifestEntry;
      readonly recordedAtIso: string;
      readonly placement: RulingPlacement;
    }
  /** Something about this row is not known well enough to write onto it. Nothing was attempted. */
  | {
      readonly status: "refused";
      readonly entryIndex: number;
      readonly entry: RulingManifestEntry;
      readonly codes: readonly RulingAuditProblemCode[];
      readonly failure: RulingBackfillFailure | null;
    }
  /** The event was appended and read back. */
  | {
      readonly status: "appended";
      readonly entryIndex: number;
      readonly entry: RulingManifestEntry;
      readonly recordedAtIso: string;
      readonly journalPath: string;
    }
  /** The append was ATTEMPTED and did not report success, which is not the same as nothing being written. */
  | {
      readonly status: "failed";
      readonly entryIndex: number;
      readonly entry: RulingManifestEntry;
      readonly failure: RulingBackfillFailure;
    };

/** What the planner decided, over the state it read. */
export interface RulingBackfillPlan {
  readonly audit: RulingAuditReport;
  readonly entries: readonly RulingBackfillEntry[];
}

/** The whole report, in both modes. */
export interface RulingBackfillReport {
  readonly schemaVersion: 1;
  readonly mode: "plan" | "apply";
  /**
   * No problem was observed and no entry was refused or failed.
   *
   * It says nothing about whether anything was WRITTEN: a clean plan is complete and has appended nothing.
   * A run can append every entry and still be incomplete, because the audit found an unrelated row it could
   * not read — that row's problem is true, and it does not stop this backfill.
   */
  readonly complete: boolean;
  readonly scope: {
    readonly handoverDir: string;
    readonly runsDir: string;
    readonly manifestPath: string | null;
  };
  readonly counts: {
    readonly manifestEntries: number;
    readonly append: number;
    readonly alreadyRecorded: number;
    readonly refused: number;
    readonly appended: number;
    readonly failed: number;
  };
  readonly entries: readonly RulingBackfillEntry[];
  /** Every problem the audit observed, whether or not it bore on an entry. */
  readonly problems: readonly RulingAuditProblem[];
}

/** The effects the writer needs, injected so the sequencing can be tested without a clock. */
export interface RulingBackfillDeps {
  /** Re-read the board and the journals as they stand NOW, carrying the manifest already parsed. */
  readonly readCurrentInput: () => RulingAuditInput;
  /** The one write path — `./rowEvent.ts`'s `applyRowEvent`, passed by reference in production. */
  readonly append: (args: {
    event: RulingEvent;
    runsDir: string;
    slug: string;
  }) => Result<RowEventWritten, RowWriteError>;
  /** One clock sample, taken only when an append is still eligible. */
  readonly recordingInstant: () => string;
}
