/**
 * The gold-debt ledger's own typed failure union.
 *
 * A union rather than `readonly string[]` because these kinds are BRANCHED ON, which is the test
 * `.claude/rules/error-handling.md` sets: `gold owe` exits differently on a row it could not build than on
 * a register it could not write, `gold settle` has to answer "no debt carries that pull request" and
 * "that debt is already settled" as their own kinds rather than as sentences, and every reader must be able
 * to tell an unreadable register from an empty one — a list claiming nothing is owed because a read failed
 * is the silent wrong answer this register exists to prevent.
 *
 * No shared base with `../autonomy/errors.ts`, per the same rule: each domain's union stands alone.
 */

import { errorMessage } from "../lib/errorMessage.js";

/** A field is absent, empty, too long, or not the shape its own rule requires. */
export interface InvalidFieldError {
  readonly code: "INVALID_FIELD";
  readonly message: string;
  readonly field: string;
}

/** The pull request is not a github.com pull-request URL, so the row names nothing a reader can open. */
export interface UnresolvablePullRequestError {
  readonly code: "UNRESOLVABLE_PULL_REQUEST";
  readonly message: string;
  readonly pullRequest: string;
}

/** The grade is not one a merge can leave gold owed at. `gold` lands here on purpose. */
export interface InvalidGradeError {
  readonly code: "INVALID_GRADE";
  readonly message: string;
  readonly grade: string;
}

/** A stored line is neither a complete debt nor a complete settlement. Carries the line to inspect. */
export interface CorruptRowError {
  readonly code: "CORRUPT_ROW";
  readonly message: string;
  readonly lineNumber: number;
  /** What the validation objected to, so the line can be fixed rather than guessed at. */
  readonly why: string;
}

/** A settlement names a pull request the register holds no debt for. */
export interface UnknownDebtError {
  readonly code: "UNKNOWN_DEBT";
  readonly message: string;
  readonly reference: string;
}

/** The debt named is already settled, and one debt is settled once. */
export interface AlreadySettledError {
  readonly code: "ALREADY_SETTLED";
  readonly message: string;
  readonly debtId: string;
  readonly settledIso: string;
}

/**
 * Two debt rows name one pull request and DISAGREE about it.
 *
 * Not the same as a repeat: a byte-identical row is an idempotent recording — a session retrying its own
 * append after a crash — and folds to one debt. This fires only when the fields differ, which means the
 * register is carrying two accounts of one merge and a settlement could not say which it pays.
 */
export interface DebtConflictError {
  readonly code: "DEBT_CONFLICT";
  readonly message: string;
  readonly debtId: string;
  /** Which field first disagreed, so the two rows can be compared rather than diffed by eye. */
  readonly field: string;
}

/** Another session holds the ledger's write lock. Contention, not corruption — the caller may retry. */
export interface LedgerBusyError {
  readonly code: "LEDGER_BUSY";
  readonly message: string;
}

/** The register could not be read or appended to. Never conflated with an EMPTY register. */
export interface StoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** Every way this domain fails. */
export type GoldDebtError =
  | InvalidFieldError
  | UnresolvablePullRequestError
  | InvalidGradeError
  | CorruptRowError
  | UnknownDebtError
  | AlreadySettledError
  | DebtConflictError
  | LedgerBusyError
  | StoreUnreadableError;

/** Constructors for {@link GoldDebtError}. The only place a gold-debt error is built. */
export const GoldDebtErrors = {
  invalidField: ({ field, why }: { field: string; why: string }): InvalidFieldError => ({
    code: "INVALID_FIELD",
    field,
    message: `${field} ${why}`,
  }),
  unresolvablePullRequest: ({ pullRequest }: { pullRequest: string }): UnresolvablePullRequestError => ({
    code: "UNRESOLVABLE_PULL_REQUEST",
    message:
      `"${pullRequest}" is not a pull request a reader can open. A debt names the MERGED pull request that ` +
      "owes the gold, as its full URL — `https://github.com/<owner>/<repo>/pull/<number>`. Never a bare " +
      "#number, never a repo#number, and never prose",
    pullRequest,
  }),
  invalidGrade: ({ grade }: { grade: string }): InvalidGradeError => ({
    code: "INVALID_GRADE",
    grade,
    message:
      `"${grade}" is not a grade that leaves gold owed — it is \`silver\` or \`bronze\`. A pull request ` +
      "merged at `gold` owes nothing, so there is no debt to record and nothing a settlement could ever pay",
  }),
  corruptRow: ({ lineNumber, why }: { lineNumber: number; why: string }): CorruptRowError => ({
    code: "CORRUPT_ROW",
    lineNumber,
    message:
      `line ${String(lineNumber)} of the gold-debt ledger is neither a complete debt nor a complete ` +
      `settlement: ${why}`,
    why,
  }),
  unknownDebt: ({ reference }: { reference: string }): UnknownDebtError => ({
    code: "UNKNOWN_DEBT",
    message:
      `no gold debt in the ledger names ${reference} — run \`slopweaver gold debts\` to see what does, or ` +
      "`slopweaver gold owe` to record it first",
    reference,
  }),
  alreadySettled: ({ debtId, settledIso }: { debtId: string; settledIso: string }): AlreadySettledError => ({
    code: "ALREADY_SETTLED",
    debtId,
    message:
      `${debtId} was already settled at ${settledIso} — a debt is settled once. If that settlement was ` +
      "wrong, say so on the pull request itself rather than writing a second one over it",
    settledIso,
  }),
  debtConflict: ({ debtId, field }: { debtId: string; field: string }): DebtConflictError => ({
    code: "DEBT_CONFLICT",
    debtId,
    field,
    message:
      `the ledger already carries a DIFFERENT debt for ${debtId} — the two disagree about ${field}. One ` +
      "pull request owes one gold, or a settlement cannot say which account it pays",
  }),
  ledgerBusy: ({ why }: { why: string }): LedgerBusyError => ({
    code: "LEDGER_BUSY",
    message: `another session is writing the gold-debt ledger right now (${why}) — nothing was written; try again`,
  }),
  storeUnreadable: ({ path, cause }: { path: string; cause: unknown }): StoreUnreadableError => ({
    cause,
    code: "STORE_UNREADABLE",
    message:
      `could not read the gold-debt ledger at ${path}: ${errorMessage({ error: cause })} — refusing rather ` +
      "than reporting nothing owed",
    path,
  }),
} as const;
