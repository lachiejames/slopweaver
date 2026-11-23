/**
 * The shapes `handover audit-rulings` reads and reports — the acquired input, one row's accounting, one
 * manifest entry's verdict, and the whole report its `--json` prints.
 *
 * Kept apart from the classifier so the store that fills the input and the verb that prints the report can
 * both name them without importing each other.
 */

import type { HandoverDoc } from "./doc.js";
import type { RunEvent } from "./ledger.js";
import type { RulingEvidence } from "./ruling.js";
import type { RulingAuditProblem, RulingAuditProblemCode } from "./rulingAuditErrors.js";
import type { RulingManifest } from "./rulingManifest.js";

/** Which directory a document was found in. */
export type RulingAuditLocation = "active" | "archive";

/** One document claiming a slug. A slug with two of these is a duplicate, never a merge. */
export interface RulingAuditDocOccurrence {
  readonly location: RulingAuditLocation;
  readonly path: string;
  readonly doc: HandoverDoc;
}

/** What reading a row's journal produced: its decoded events and the lines that did not decode, or a failure. */
export type RulingAuditJournal =
  | { readonly kind: "read"; readonly events: readonly RunEvent[]; readonly unreadableLines: readonly number[] }
  | { readonly kind: "failed"; readonly cause: string };

/** Everything acquired about one slug, from whichever of the board, the archive, `runs/` or the manifest named it. */
export interface RulingAuditInputRow {
  readonly slug: string;
  readonly docs: readonly RulingAuditDocOccurrence[];
  readonly journalPath: string;
  readonly journal: RulingAuditJournal;
}

/** The whole acquired input, including every failure to acquire part of it. */
export interface RulingAuditInput {
  readonly handoverDir: string;
  readonly runsDir: string;
  readonly manifestPath: string | null;
  /** `null` when none was asked for, and when one was asked for and could not be read or parsed. */
  readonly manifest: RulingManifest | null;
  /** One per slug, sorted by slug. */
  readonly rows: readonly RulingAuditInputRow[];
  /** Failures that belong to no single row: a directory, an unreadable doc, the manifest itself. */
  readonly problems: readonly RulingAuditProblem[];
}

/** One `answered` event, and whether exactly one backfilled ruling names it as its source. */
export interface RulingAuditAnswer {
  readonly sourceAtIso: string;
  readonly answer: string;
  readonly state: "represented" | "unclassified-answer";
}

/** One row's accounting. */
export interface RulingAuditRow {
  readonly slug: string;
  readonly docs: readonly { readonly location: RulingAuditLocation; readonly path: string }[];
  readonly journalPath: string;
  /** What the row reads as decided today — `latestRuling`'s own answer. `null` when nothing has ruled. */
  readonly effective: RulingEvidence | null;
  /** Every other ruling the row has recorded, in journal order, and an authored pair an event has displaced. */
  readonly history: readonly RulingEvidence[];
  readonly answers: readonly RulingAuditAnswer[];
}

/** Where a decided manifest entry's ruling stands on its row: the ruling read today, or an earlier one. */
export type RulingPlacement = "effective" | "historical";

/** One manifest entry's verdict, in manifest order. */
export type RulingManifestCheck =
  | {
      readonly status: "decided";
      readonly entryIndex: number;
      readonly slug: string;
      readonly sourceAtIso: string;
      readonly placement: RulingPlacement;
      readonly recordedAtIso: string;
    }
  | {
      readonly status: "confirmed-unrepresented";
      readonly entryIndex: number;
      readonly slug: string;
      readonly sourceAtIso: string;
    }
  | {
      readonly status: "incomplete";
      readonly entryIndex: number;
      readonly slug: string;
      readonly sourceAtIso: string;
      readonly codes: readonly RulingAuditProblemCode[];
    };

/** Said in every report, because a zero here must never read as "searched, and found none". */
export const CANDIDATE_NOTICE = {
  enabled: false,
  message: "Candidate discovery is not performed; an unclassified answer is not asserted to be a ruling or not one.",
  schemaVersion: 1,
} as const;

/** The whole report. */
export interface RulingAuditReport {
  readonly schemaVersion: 1;
  /** True exactly when no problem was found — every input needed for this report was read and coherent. */
  readonly complete: boolean;
  readonly scope: {
    readonly handoverDir: string;
    readonly runsDir: string;
    readonly manifestPath: string | null;
    readonly includesArchive: true;
    readonly includesJournalOnly: true;
  };
  readonly counts: {
    readonly rows: number;
    readonly effective: number;
    readonly historical: number;
    readonly unclassifiedAnswers: number;
    readonly candidates: 0;
    readonly manifestEntries: number;
    readonly decided: number;
    readonly confirmedUnrepresented: number;
    readonly manifestIncomplete: number;
    readonly incompleteInputs: number;
  };
  readonly rows: readonly RulingAuditRow[];
  readonly manifest: readonly RulingManifestCheck[];
  readonly problems: readonly RulingAuditProblem[];
  readonly candidateNotice: typeof CANDIDATE_NOTICE;
}
