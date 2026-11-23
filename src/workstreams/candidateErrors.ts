/**
 * The candidates-and-reactions failure union, apart from the register's own (`./errors.ts`).
 *
 * A union because the kinds are BRANCHED ON: a write that is owed exits differently from one refused outright. There
 * is no "no candidates yet" kind: a home with neither a stated-candidates file nor a mined one reads as an empty
 * catalog, which every listing already says as nothing to answer.
 */
import { errorMessage } from "#lib/errorMessage.js";

import type { WorkstreamStoreError } from "./store/errors.js";

/** The candidates file or the reactions ledger is there but will not read. */
export interface CandidatesUnreadableError {
  readonly code: "CANDIDATES_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The candidates document parsed but breaks the schema or a cross-check; every problem is named. */
export interface CandidatesInvalidError {
  readonly code: "CANDIDATES_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** The owner's words did not read as reactions; the whole batch is refused and nothing is written. */
export interface ReactionRefusedError {
  readonly code: "REACTION_REFUSED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Another writer holds the register lock. */
export interface RegisterBusyError {
  readonly code: "REGISTER_BUSY";
  readonly message: string;
  readonly why: string;
}

/** The register refused or failed the promotion a yes needed; no reaction was recorded. */
export interface RegisterRefusedError {
  readonly code: "REGISTER_REFUSED";
  readonly message: string;
  readonly cause: WorkstreamStoreError;
}

/** The owner's words were recorded, but the register write a yes needed then failed: the promotion is owed. */
export interface PromotionOwedError {
  readonly code: "PROMOTION_OWED";
  readonly message: string;
  readonly candidates: readonly string[];
  readonly cause: WorkstreamStoreError;
}

/** A definition of done did not resolve against its candidate; nothing was recorded. */
export interface DefinitionRefusedError {
  readonly code: "DEFINITION_REFUSED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** A definition was recorded, but carrying it onto the accepted candidate's tile then failed: the tile owes it. */
export interface DefinitionOwedError {
  readonly code: "DEFINITION_OWED";
  readonly message: string;
  readonly candidate: string;
  readonly cause: WorkstreamStoreError;
}

/** A title or a proposal named something that is not there, or said nothing; nothing was recorded. */
export interface AmendmentRefusedError {
  readonly code: "AMENDMENT_REFUSED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** A title was recorded, but carrying it onto the entry the candidate became then failed: the entry owes it. */
export interface TitleOwedError {
  readonly code: "TITLE_OWED";
  readonly message: string;
  readonly candidate: string;
  readonly cause: WorkstreamStoreError;
}

/** A candidates file or a reaction row could not be written. */
export interface CandidatesWriteFailedError {
  readonly code: "CANDIDATES_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

export type CandidatesError =
  | CandidatesUnreadableError
  | CandidatesInvalidError
  | ReactionRefusedError
  | RegisterBusyError
  | RegisterRefusedError
  | PromotionOwedError
  | DefinitionRefusedError
  | DefinitionOwedError
  | AmendmentRefusedError
  | TitleOwedError
  | CandidatesWriteFailedError;

/** The one place every candidates failure is built. */
export const CandidatesErrors = {
  definitionOwed: ({ candidate, cause }: { candidate: string; cause: WorkstreamStoreError }): DefinitionOwedError => ({
    candidate,
    cause,
    code: "DEFINITION_OWED",
    message:
      `the definition is recorded, but the register write failed, so ${candidate}'s tile does not say it yet — ` +
      `re-run the same \`slopweaver workstreams define\`, which appends nothing and repairs the tile; ${cause.message}`,
  }),
  amendmentRefused: ({ problems }: { problems: readonly string[] }): AmendmentRefusedError => ({
    code: "AMENDMENT_REFUSED",
    message: `nothing recorded — ${problems.join("; ")}`,
    problems,
  }),
  titleOwed: ({ candidate, cause }: { candidate: string; cause: WorkstreamStoreError }): TitleOwedError => ({
    candidate,
    cause,
    code: "TITLE_OWED",
    message:
      `the title is recorded, but the register write failed, so the entry ${candidate} became does not carry it yet — ` +
      `re-run the same \`slopweaver workstreams retitle\`, which appends nothing and repairs the entry; ${cause.message}`,
  }),
  definitionRefused: ({ problems }: { problems: readonly string[] }): DefinitionRefusedError => ({
    code: "DEFINITION_REFUSED",
    message: `no definition recorded — ${problems.join("; ")}`,
    problems,
  }),
  invalid: ({ problems }: { problems: readonly string[] }): CandidatesInvalidError => ({
    code: "CANDIDATES_INVALID",
    message: `the workstream candidates do not validate — ${problems.join("; ")}`,
    problems,
  }),
  statedInvalid: ({ path, problems }: { path: string; problems: readonly string[] }): CandidatesInvalidError => ({
    code: "CANDIDATES_INVALID",
    message: `the stated candidates in ${path} do not validate — ${problems.join("; ")}`,
    problems,
  }),
  reactionRefused: ({ problems }: { problems: readonly string[] }): ReactionRefusedError => ({
    code: "REACTION_REFUSED",
    message: `nothing recorded — ${problems.join("; ")}`,
    problems,
  }),
  promotionOwed: ({
    candidates,
    cause,
  }: {
    candidates: readonly string[];
    cause: WorkstreamStoreError;
  }): PromotionOwedError => ({
    candidates,
    cause,
    code: "PROMOTION_OWED",
    message:
      `the owner's words are recorded, but the register write failed, so ${candidates.join(", ")} owe a promotion — ` +
      `re-run \`slopweaver workstreams react --candidate <id> --as <the same word>\` for each, an abandoned one ` +
      `with its --reason and --anchor; ${cause.message}`,
  }),
  registerBusy: ({ why }: { why: string }): RegisterBusyError => ({
    code: "REGISTER_BUSY",
    message: `the workstreams register is being written by another process — nothing recorded; ${why}`,
    why,
  }),
  registerRefused: ({ cause }: { cause: WorkstreamStoreError }): RegisterRefusedError => ({
    cause,
    code: "REGISTER_REFUSED",
    message: `a yes could not become a register entry, so nothing was recorded — ${cause.message}`,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): CandidatesUnreadableError => ({
    cause,
    code: "CANDIDATES_UNREADABLE",
    message: `could not read ${path} — refusing rather than drawing it empty: ${errorMessage({ error: cause })}`,
    path,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): CandidatesWriteFailedError => ({
    cause,
    code: "CANDIDATES_WRITE_FAILED",
    message: `could not write ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;
