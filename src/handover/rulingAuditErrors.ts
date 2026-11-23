/**
 * Every reason `handover audit-rulings` could not read the register it was asked to account for.
 *
 * Its own union per `.claude/rules/error-handling.md`: these are facts about the INPUT to an audit — a
 * directory that would not list, a journal line that did not decode, a manifest entry whose evidence does not
 * hold — and each one is a reason the report may not claim completeness. A caller branches on `code` to say
 * what to repair. None is a policy refusal, so none has an escape hatch: an audit that could be told to
 * ignore a broken input would print a clean zero over it, which is the one outcome it exists to prevent.
 *
 * A source that fails `./ruling.ts`'s own check is carried as that module's typed error, whole, rather than
 * re-worded here — the reader applies the writer's rule, and so reports it in the writer's terms.
 *
 * Pure: every factory takes already-read values.
 */

import type { RulingIntegrityError } from "./rulingErrors.js";

/** Fields every audit problem carries, so a reader can print or locate one without a switch. */
interface ProblemBase {
  readonly message: string;
  /** The row it concerns, when it concerns one. */
  readonly slug: string | null;
  /** The file or directory it concerns, when it concerns one. */
  readonly path: string | null;
}

/** A directory the audit had to list could not be listed, so every row under it is unaccounted for. */
export interface DirectoryUnreadableProblem extends ProblemBase {
  readonly code: "DIRECTORY_UNREADABLE";
}

/** A markdown file under the board would not parse or was not a regular readable file. */
export interface DocUnreadableProblem extends ProblemBase {
  readonly code: "DOC_UNREADABLE";
}

/** A `.jsonl` under `runs/` whose name is not a slug a row could have. */
export interface UnsafeJournalNameProblem extends ProblemBase {
  readonly code: "UNSAFE_JOURNAL_NAME";
}

/** Two documents claim one slug, so which row a ruling belongs to is not decided. */
export interface DuplicateSlugProblem extends ProblemBase {
  readonly code: "DUPLICATE_SLUG";
  readonly paths: readonly string[];
}

/** A journal could not be opened at all. */
export interface JournalUnreadableProblem extends ProblemBase {
  readonly code: "JOURNAL_UNREADABLE";
}

/** A journal opened, and some of its lines did not decode — any of them could be a ruling. */
export interface JournalLineUnreadableProblem extends ProblemBase {
  readonly code: "JOURNAL_LINE_UNREADABLE";
  readonly lines: readonly number[];
}

/** The parser reported a defect in a row document's front matter, so what it declares is not trustworthy. */
export interface DocMalformedProblem extends ProblemBase {
  readonly code: "DOC_MALFORMED";
  readonly defects: readonly string[];
}

/** A row document's authored ruling carries a byte the UTF-8 decoder had to replace. */
export interface DocBytesReplacedProblem extends ProblemBase {
  readonly code: "DOC_BYTES_REPLACED";
}

/** A journal line decoded, and carries a byte the UTF-8 decoder had to replace — so its text is not its text. */
export interface JournalBytesReplacedProblem extends ProblemBase {
  readonly code: "JOURNAL_BYTES_REPLACED";
  readonly atIsos: readonly string[];
}

/** The manifest file could not be read. */
export interface ManifestUnreadableProblem extends ProblemBase {
  readonly code: "MANIFEST_UNREADABLE";
}

/** The manifest was read and is not a valid manifest. */
export interface ManifestInvalidProblem extends ProblemBase {
  readonly code: "MANIFEST_INVALID";
  readonly issues: readonly string[];
}

/** A manifest entry names a row no document on the board or in its archive claims. */
export interface RowMissingProblem extends ProblemBase {
  readonly code: "ROW_MISSING";
  readonly entryIndex: number;
}

/** A manifest entry's source answer does not check out under `./ruling.ts`'s own source rule. */
export interface SourceInvalidProblem extends ProblemBase {
  readonly code: "SOURCE_INVALID";
  readonly entryIndex: number;
  readonly integrity: RulingIntegrityError;
}

/** More than one ruling on the journal claims this source, so no single one of them is its representation. */
export interface SourceRepresentationAmbiguousProblem extends ProblemBase {
  readonly code: "SOURCE_REPRESENTATION_AMBIGUOUS";
  readonly entryIndex: number;
  readonly found: number;
}

/** The ruling that claims this source records different words than the manifest reviewed. */
export interface RulingWordsMismatchProblem extends ProblemBase {
  readonly code: "RULING_WORDS_MISMATCH";
  readonly entryIndex: number;
}

/** The ruling that claims this source points somewhere other than the manifest's anchor. */
export interface RulingAnchorMismatchProblem extends ProblemBase {
  readonly code: "RULING_ANCHOR_MISMATCH";
  readonly entryIndex: number;
  readonly expected: string;
  readonly actual: string;
}

/** Every way an audit's input can be incomplete or incoherent. */
export type RulingAuditProblem =
  | DirectoryUnreadableProblem
  | DocUnreadableProblem
  | DocBytesReplacedProblem
  | DocMalformedProblem
  | UnsafeJournalNameProblem
  | DuplicateSlugProblem
  | JournalUnreadableProblem
  | JournalLineUnreadableProblem
  | JournalBytesReplacedProblem
  | ManifestUnreadableProblem
  | ManifestInvalidProblem
  | RowMissingProblem
  | SourceInvalidProblem
  | SourceRepresentationAmbiguousProblem
  | RulingWordsMismatchProblem
  | RulingAnchorMismatchProblem;

/** The discriminant alone, for a manifest check listing why it could not decide. */
export type RulingAuditProblemCode = RulingAuditProblem["code"];

/** Build one of this domain's problems — the shape the store, the classifier and every test construct. */
export const RulingAuditProblems = {
  directoryUnreadable: ({ path, cause }: { path: string; cause: string }): DirectoryUnreadableProblem => ({
    code: "DIRECTORY_UNREADABLE",
    message: `could not list ${path} (${cause}) — every row under it is unaccounted for`,
    path,
    slug: null,
  }),
  docBytesReplaced: ({ path, slug }: { path: string; slug: string }): DocBytesReplacedProblem => ({
    code: "DOC_BYTES_REPLACED",
    message:
      `the ruling authored in ${path} carries the Unicode replacement character, so those bytes were not ` +
      "valid UTF-8 and what it says now is not what was written",
    path,
    slug,
  }),
  docMalformed: ({
    defects,
    path,
    slug,
  }: {
    defects: readonly string[];
    path: string;
    slug: string;
  }): DocMalformedProblem => ({
    code: "DOC_MALFORMED",
    defects,
    message: `${path} did not parse cleanly, so what it declares cannot be trusted: ${defects.join("; ")}`,
    path,
    slug,
  }),
  docUnreadable: ({ path }: { path: string }): DocUnreadableProblem => ({
    code: "DOC_UNREADABLE",
    message: `${path} is not a readable handover doc — a ruling on its row cannot be accounted for`,
    path,
    slug: null,
  }),
  duplicateSlug: ({ paths, slug }: { paths: readonly string[]; slug: string }): DuplicateSlugProblem => ({
    code: "DUPLICATE_SLUG",
    message: `${String(paths.length)} documents claim the slug "${slug}": ${paths.join(", ")}`,
    path: null,
    paths,
    slug,
  }),
  journalBytesReplaced: ({
    atIsos,
    path,
    slug,
  }: {
    atIsos: readonly string[];
    path: string;
    slug: string;
  }): JournalBytesReplacedProblem => ({
    atIsos,
    code: "JOURNAL_BYTES_REPLACED",
    message:
      `${String(atIsos.length)} event(s) in ${path} (${atIsos.join(", ")}) carry the Unicode replacement ` +
      "character, so those bytes were not valid UTF-8 and what they say now is not what was written",
    path,
    slug,
  }),
  journalLineUnreadable: ({
    lines,
    path,
    slug,
  }: {
    lines: readonly number[];
    path: string;
    slug: string;
  }): JournalLineUnreadableProblem => ({
    code: "JOURNAL_LINE_UNREADABLE",
    lines,
    message:
      `${path} has ${String(lines.length)} line(s) that did not decode (${lines.join(", ")}) — any of them ` +
      "could be a ruling, so this row's rulings are not fully known",
    path,
    slug,
  }),
  journalUnreadable: ({
    cause,
    path,
    slug,
  }: {
    cause: string;
    path: string;
    slug: string;
  }): JournalUnreadableProblem => ({
    code: "JOURNAL_UNREADABLE",
    message: `could not read ${path} (${cause}) — this row's rulings are unknown`,
    path,
    slug,
  }),
  manifestInvalid: ({ issues, path }: { issues: readonly string[]; path: string }): ManifestInvalidProblem => ({
    code: "MANIFEST_INVALID",
    issues,
    message: `${path} is not a valid ruling manifest: ${issues.join("; ")}`,
    path,
    slug: null,
  }),
  manifestUnreadable: ({ cause, path }: { cause: string; path: string }): ManifestUnreadableProblem => ({
    code: "MANIFEST_UNREADABLE",
    message: `could not read the manifest ${path} (${cause})`,
    path,
    slug: null,
  }),
  rowMissing: ({ entryIndex, slug }: { entryIndex: number; slug: string }): RowMissingProblem => ({
    code: "ROW_MISSING",
    entryIndex,
    message: `manifest entry ${String(entryIndex)} names "${slug}", and no document on the board or in its archive claims it`,
    path: null,
    slug,
  }),
  rulingAnchorMismatch: ({
    actual,
    entryIndex,
    expected,
    slug,
  }: {
    actual: string;
    entryIndex: number;
    expected: string;
    slug: string;
  }): RulingAnchorMismatchProblem => ({
    actual,
    code: "RULING_ANCHOR_MISMATCH",
    entryIndex,
    expected,
    message: `manifest entry ${String(entryIndex)}: the ruling on "${slug}" is anchored at ${actual}, not ${expected}`,
    path: null,
    slug,
  }),
  rulingWordsMismatch: ({ entryIndex, slug }: { entryIndex: number; slug: string }): RulingWordsMismatchProblem => ({
    code: "RULING_WORDS_MISMATCH",
    entryIndex,
    message: `manifest entry ${String(entryIndex)}: the ruling on "${slug}" that claims this source records different words`,
    path: null,
    slug,
  }),
  sourceInvalid: ({
    entryIndex,
    integrity,
    slug,
  }: {
    entryIndex: number;
    integrity: RulingIntegrityError;
    slug: string;
  }): SourceInvalidProblem => ({
    code: "SOURCE_INVALID",
    entryIndex,
    integrity,
    message: `manifest entry ${String(entryIndex)} on "${slug}": ${integrity.message}`,
    path: null,
    slug,
  }),
  sourceRepresentationAmbiguous: ({
    entryIndex,
    found,
    slug,
  }: {
    entryIndex: number;
    found: number;
    slug: string;
  }): SourceRepresentationAmbiguousProblem => ({
    code: "SOURCE_REPRESENTATION_AMBIGUOUS",
    entryIndex,
    found,
    message: `manifest entry ${String(entryIndex)}: ${String(found)} rulings on "${slug}" claim the same source`,
    path: null,
    slug,
  }),
  unsafeJournalName: ({ path }: { path: string }): UnsafeJournalNameProblem => ({
    code: "UNSAFE_JOURNAL_NAME",
    message: `${path} is not named for any row a slug could name`,
    path,
    slug: null,
  }),
} as const;
