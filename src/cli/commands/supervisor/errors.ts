/**
 * The typed failures the `slopweaver supervisor` verbs author themselves: a flag tail they refuse, a state-doc
 * edit that stops before or while publishing, and a tick draft that cannot be read, built or written.
 *
 * ONE union for the whole verb directory per `.claude/rules/error-handling.md`: `state-amend`/`state-fold`/`state-archive`
 * and `tick-draft`/`tick-record` each split into a pure Core and an effectful Run, and both halves raise from
 * here. A list a foreign parser or the tick ledger's own door hands back rides as `reasons`, and
 * {@link supervisorErrorLines} gives it back one line per problem, exactly as the string list it replaced.
 */
import { DERIVE_SUMMARY_HINT } from "../../../supervisor/outcomes/summaryMarker.js";

/** The shared flag parser refused the tail; `reasons` carries each of its refusals. */
export interface SupervisorFlagsRefusedError {
  readonly code: "FLAGS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A flag the verb cannot run without was not given. */
export interface SupervisorFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A value flag was the last token, with no value after it. */
export interface SupervisorFlagValueMissingError {
  readonly code: "FLAG_VALUE_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** One filesystem step of a state-doc edit threw; `label` names the step and the path it was on. */
export interface SupervisorStepFailedError {
  readonly code: "STEP_FAILED";
  readonly message: string;
  readonly label: string;
  readonly cause: unknown;
}

/** The state doc no longer holds the bytes the edit was rendered against. */
export interface SupervisorDocChangedError {
  readonly code: "DOC_CHANGED";
  readonly message: string;
  readonly path: string;
}

/** The archive name is taken by something that is not a regular file, or is not ours to reuse. */
export interface SupervisorArchiveUnusableError {
  readonly code: "ARCHIVE_UNUSABLE";
  readonly message: string;
  readonly path: string;
}

/** The archive name resolves, links followed, to the state doc itself. */
export interface SupervisorArchiveAliasesDocError {
  readonly code: "ARCHIVE_ALIASES_DOC";
  readonly message: string;
  readonly path: string;
  readonly resolved: string;
}

/** A document a tick verb reads could not be read or parsed as JSON; `label` names which. */
export interface SupervisorDocumentUnreadableError {
  readonly code: "DOCUMENT_UNREADABLE";
  readonly message: string;
  readonly label: string;
  readonly cause: unknown;
}

/** `--actions` or `--judgements` parsed and is not a JSON array; `reasons` names each that is not. */
export interface SupervisorDraftInputsNotArraysError {
  readonly code: "DRAFT_INPUTS_NOT_ARRAYS";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** One or more source documents are the wrong shape for their source; `reasons` is the reader's own list. */
export interface SupervisorDraftSourcesRefusedError {
  readonly code: "DRAFT_SOURCES_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A document is not a `supervisor tick-record` draft; `reasons` is the heading and one indented line per issue. */
export interface SupervisorNotATickDraftError {
  readonly code: "NOT_A_TICK_DRAFT";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The assembled draft fails the tick ledger's own door; `reasons` is the heading and its refusals, indented. */
export interface SupervisorDraftWouldBeRefusedError {
  readonly code: "DRAFT_WOULD_BE_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The serialised draft plus its trailing newline is longer than `tick-record` will read back. */
export interface SupervisorDraftOverReadLimitError {
  readonly code: "DRAFT_OVER_READ_LIMIT";
  readonly message: string;
  readonly length: number;
  readonly cap: number;
}

/**
 * The successor summary `state-archive` must verify could not be read; `inner` is the read step's own failure and
 * `hint` says how to derive one, so the refusal names both what broke and the next move.
 */
export interface SupervisorSummaryUnreadableError {
  readonly code: "SUMMARY_UNREADABLE";
  readonly message: string;
  readonly inner: SupervisorError;
  readonly hint: string;
}

/**
 * An archiving edit published its archive and then could not replace the doc; `inner` is the replace step's own
 * failure and `residue` says the archive is there and a re-run of the same command reuses it.
 */
export interface SupervisorDocUnwrittenAfterPublishError {
  readonly code: "DOC_UNWRITTEN_AFTER_PUBLISH";
  readonly message: string;
  readonly inner: SupervisorError;
  readonly archivePath: string;
  readonly residue: string;
}

/** Every failure this verb directory authors. */
export type SupervisorError =
  | SupervisorDocUnwrittenAfterPublishError
  | SupervisorSummaryUnreadableError
  | SupervisorFlagsRefusedError
  | SupervisorFlagMissingError
  | SupervisorFlagValueMissingError
  | SupervisorStepFailedError
  | SupervisorDocChangedError
  | SupervisorArchiveUnusableError
  | SupervisorArchiveAliasesDocError
  | SupervisorDocumentUnreadableError
  | SupervisorDraftInputsNotArraysError
  | SupervisorDraftSourcesRefusedError
  | SupervisorNotATickDraftError
  | SupervisorDraftWouldBeRefusedError
  | SupervisorDraftOverReadLimitError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SupervisorErrors = {
  archiveAliasesDoc: ({ path, resolved }: { path: string; resolved: string }): SupervisorArchiveAliasesDocError => ({
    code: "ARCHIVE_ALIASES_DOC",
    message: `${path} resolves to the state doc itself (${resolved}) — nothing was written; pick another --archive name`,
    path,
    resolved,
  }),
  archiveDiffers: ({ path }: { path: string }): SupervisorArchiveUnusableError => ({
    code: "ARCHIVE_UNUSABLE",
    message: `${path} already exists with different contents — pick another --archive name; nothing was written`,
    path,
  }),
  archiveNotRegular: ({ path, kind }: { path: string; kind: string }): SupervisorArchiveUnusableError => ({
    code: "ARCHIVE_UNUSABLE",
    message: `${path} is a ${kind}, not a regular file — nothing was written; pick another --archive name`,
    path,
  }),
  archiveTakenConcurrently: ({ path }: { path: string }): SupervisorArchiveUnusableError => ({
    code: "ARCHIVE_UNUSABLE",
    message: `${path} was created by another writer while this archive was being published; nothing of ours was written`,
    path,
  }),
  docUnwrittenAfterPublish: ({
    archivePath,
    inner,
  }: {
    archivePath: string;
    inner: SupervisorError;
  }): SupervisorDocUnwrittenAfterPublishError => {
    // A doc another writer changed renders a DIFFERENT archive on the re-run, so the one published here cannot
    // be reused: it holds the pre-change text, the doc still holds every row, and the re-run needs a new name.
    const residue =
      inner.code === "DOC_CHANGED"
        ? `the archive IS published at ${archivePath} from the doc as it was before the other writer's change; the doc still holds every row — re-run with a new --archive name`
        : `the archive IS published at ${archivePath}; re-running this same command reuses it while the doc still holds what it held, and if another writer has changed the doc since, re-run with a new --archive name`;
    return {
      archivePath,
      code: "DOC_UNWRITTEN_AFTER_PUBLISH",
      inner,
      message: `${inner.message} — ${residue}`,
      residue,
    };
  },
  docChanged: ({ path }: { path: string }): SupervisorDocChangedError => ({
    code: "DOC_CHANGED",
    message: `${path} changed while this edit was being prepared — nothing was written to it; re-run`,
    path,
  }),
  documentUnreadable: ({ label, cause }: { label: string; cause: unknown }): SupervisorDocumentUnreadableError => ({
    cause,
    code: "DOCUMENT_UNREADABLE",
    label,
    message: `${label}: ${cause instanceof Error ? cause.message : "unknown error"}`,
  }),
  draftInputsNotArrays: ({
    actionsPath,
    judgementsPath,
  }: {
    actionsPath: string | undefined;
    judgementsPath: string | undefined;
  }): SupervisorDraftInputsNotArraysError => {
    const reasons = [
      ...(actionsPath === undefined ? [] : [`--actions ${actionsPath} is not a JSON array of tick actions`]),
      ...(judgementsPath === undefined ? [] : [`--judgements ${judgementsPath} is not a JSON array of judgements`]),
    ];
    return { code: "DRAFT_INPUTS_NOT_ARRAYS", message: reasons.join("; "), reasons };
  },
  draftOverReadLimit: ({ length, cap }: { length: number; cap: number }): SupervisorDraftOverReadLimitError => ({
    cap,
    code: "DRAFT_OVER_READ_LIMIT",
    length,
    message:
      `the draft serialises to ${String(length)} characters, and the file's trailing newline would put it ` +
      `over the ${String(cap)}-character limit \`supervisor tick-record\` reads it back under — so it would be ` +
      "written and then refused. Record fewer actions or judgements in one tick.",
  }),
  draftSourcesRefused: ({ reasons }: { reasons: readonly string[] }): SupervisorDraftSourcesRefusedError => ({
    code: "DRAFT_SOURCES_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  draftWouldBeRefused: ({ refusals }: { refusals: readonly string[] }): SupervisorDraftWouldBeRefusedError => ({
    code: "DRAFT_WOULD_BE_REFUSED",
    message: `the draft would be refused by tick-record: ${refusals.join("; ")}`,
    reasons: ["the draft would be refused by tick-record:", ...refusals.map((line) => `  ${line}`)],
  }),
  flagsRefused: ({ reasons }: { reasons: readonly string[] }): SupervisorFlagsRefusedError => ({
    code: "FLAGS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  notATickDraft: ({ issues }: { issues: readonly string[] }): SupervisorNotATickDraftError => ({
    code: "NOT_A_TICK_DRAFT",
    message: `the draft is not a \`supervisor tick-record\` draft: ${issues.join("; ")}`,
    reasons: ["the draft is not a `supervisor tick-record` draft:", ...issues.map((issue) => `  ${issue}`)],
  }),
  reconciliationUnreadable: ({ cause }: { cause: unknown }): SupervisorDocumentUnreadableError => ({
    cause,
    code: "DOCUMENT_UNREADABLE",
    label: "the reconciliation",
    message: cause instanceof Error ? cause.message : "the reconciliation could not be read",
  }),
  rowValueMissing: (): SupervisorFlagValueMissingError => ({
    code: "FLAG_VALUE_MISSING",
    flag: "--row",
    message: "--row needs a value",
  }),
  stateDocPathMissing: (): SupervisorFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--path",
    message: "--path is required — name the state doc to measure",
  }),
  stepFailed: ({ label, cause }: { label: string; cause: unknown }): SupervisorStepFailedError => ({
    cause,
    code: "STEP_FAILED",
    label,
    message: `${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  summaryUnreadable: ({ inner }: { inner: SupervisorError }): SupervisorSummaryUnreadableError => ({
    code: "SUMMARY_UNREADABLE",
    hint: DERIVE_SUMMARY_HINT,
    inner,
    message: `${inner.message} — ${DERIVE_SUMMARY_HINT}`,
  }),
} as const;

/**
 * The lines a {@link SupervisorError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function supervisorErrorLines({ error }: { error: SupervisorError }): readonly string[] {
  if (
    error.code === "FLAGS_REFUSED" ||
    error.code === "DRAFT_INPUTS_NOT_ARRAYS" ||
    error.code === "DRAFT_SOURCES_REFUSED" ||
    error.code === "NOT_A_TICK_DRAFT" ||
    error.code === "DRAFT_WOULD_BE_REFUSED"
  ) {
    return error.reasons;
  }
  if (error.code === "SUMMARY_UNREADABLE") {
    return [...supervisorErrorLines({ error: error.inner }), error.hint];
  }
  if (error.code === "DOC_UNWRITTEN_AFTER_PUBLISH") {
    return [...supervisorErrorLines({ error: error.inner }), error.residue];
  }
  return [error.message];
}
