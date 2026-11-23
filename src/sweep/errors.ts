/**
 * The sweep ledger's own typed failure union.
 *
 * A union rather than `readonly string[]` because every kind here is BRANCHED ON, which is the test
 * `.claude/rules/error-handling.md` sets: `sweep apply` exits differently on a candidate it cannot find than
 * on a ledger it cannot write, and a REGISTER verb that refused the act is its own kind because that refusal
 * is the underlying verb working — never a sweep failure to paper over. The sharpest of these is
 * {@link LedgerUnreachableError}: a rail whose read failure were reported as "nothing has been deleted" would
 * tell a session it is safe to delete again, which is the one wrong answer this rail cannot afford.
 */

/** The ledger exists but could not be read — permissions, a stale mount, an ACL. Never "empty". */
export interface LedgerUnreachableError {
  readonly code: "LEDGER_UNREACHABLE";
  readonly message: string;
  readonly path: string;
}

/** A stored line is not a complete sweep row. Carries the line number so it can be fixed, not guessed at. */
export interface CorruptLedgerRowError {
  readonly code: "CORRUPT_LEDGER_ROW";
  readonly message: string;
  readonly lineNumber: number;
  readonly why: string;
}

/** No candidate on the current sweep carries the named slug, so there is nothing to act on. */
export interface UnknownCandidateError {
  readonly code: "UNKNOWN_CANDIDATE";
  readonly message: string;
  readonly slug: string;
}

/** The candidate's verdict carries no act — `UNWITNESSED` and `KEEP` are deliberately unactable. */
export interface UnactableVerdictError {
  readonly code: "UNACTABLE_VERDICT";
  readonly message: string;
  readonly slug: string;
  readonly verdict: string;
}

/**
 * The register verb the act routes to refused it — a second close, or a settle on a row that is not an ask.
 *
 * Kept as its own kind because it is the house shape for the effectful half of a destructive verb
 * (`../worktree/pruneApply.ts`): the underlying tool's refusals stay refusals, and are never re-judged here.
 */
export interface RegisterVerbRefusedError {
  readonly code: "REGISTER_VERB_REFUSED";
  readonly message: string;
  readonly slug: string;
  readonly verbLine: string;
  readonly exitCode: number;
}

/** The board could not be scanned, so there is nothing to classify. */
export interface RowFileError {
  readonly code: "ROW_FILE";
  readonly message: string;
  readonly path: string;
}

/** One of the two flags that carry the owner's decline into `sweep apply`. */
export type DeclineAuthorityFlag = "--reason" | "--anchor";

/**
 * A `settle` act was asked for without the owner's words or the anchor to where the owner gave them.
 *
 * Its own kind because the act it guards is a `declined` settlement, which is the owner's judgement alone
 * (`../handover/rowKind.ts` `declineNeedsAnchor`): the classifier's witness is evidence that the row cannot earn
 * its keep, never the owner's word that it will not be done, so the sweep refuses before any register verb runs rather
 * than inventing either value.
 */
export interface DeclineAuthorityRequiredError {
  readonly code: "DECLINE_AUTHORITY_REQUIRED";
  readonly message: string;
  readonly slug: string;
  readonly verdict: string;
  readonly missing: readonly DeclineAuthorityFlag[];
}

/** `--reason` or `--anchor` was passed for an act that is not a decline, where it would be silently ignored. */
export interface DeclineAuthorityInapplicableError {
  readonly code: "DECLINE_AUTHORITY_INAPPLICABLE";
  readonly message: string;
  readonly slug: string;
  readonly verdict: string;
}

/** Every way a sweep act can fail. */
export type SweepError =
  | LedgerUnreachableError
  | CorruptLedgerRowError
  | UnknownCandidateError
  | UnactableVerdictError
  | RegisterVerbRefusedError
  | RowFileError
  | DeclineAuthorityRequiredError
  | DeclineAuthorityInapplicableError;

/** The factories every sweep failure is built through, so a test constructs one the way the code does. */
export const SweepErrors = {
  corruptLedgerRow: ({ lineNumber, why }: { lineNumber: number; why: string }): CorruptLedgerRowError => ({
    code: "CORRUPT_LEDGER_ROW",
    lineNumber,
    message: `sweep ledger line ${String(lineNumber)} is not a complete row: ${why}`,
    why,
  }),
  declineAuthorityInapplicable: ({
    slug,
    verdict,
  }: {
    slug: string;
    verdict: string;
  }): DeclineAuthorityInapplicableError => ({
    code: "DECLINE_AUTHORITY_INAPPLICABLE",
    message:
      `${slug} is ${verdict}, whose act is not a decline — --reason and --anchor carry only the owner's decline; ` +
      "put anything the witness does not say in --why",
    slug,
    verdict,
  }),
  declineAuthorityRequired: ({
    slug,
    verdict,
    missing,
  }: {
    slug: string;
    verdict: string;
    missing: readonly DeclineAuthorityFlag[];
  }): DeclineAuthorityRequiredError => ({
    code: "DECLINE_AUTHORITY_REQUIRED",
    message:
      `${slug} is ${verdict}, and its act is \`handover settle --as declined\`, which only the owner decides — ` +
      `missing ${missing.join(" and ")}. Ask the owner whether to settle it and why, then re-run with ` +
      '--reason "<the owner\'s words>" --anchor "<where the owner said it>"; the sweep never writes either for them',
    missing,
    slug,
    verdict,
  }),
  ledgerUnreachable: ({ path, cause }: { path: string; cause: string }): LedgerUnreachableError => ({
    code: "LEDGER_UNREACHABLE",
    message: `the sweep ledger at ${path} could not be read — ${cause}. Refusing rather than reporting it empty`,
    path,
  }),
  registerVerbRefused: ({
    slug,
    verbLine,
    exitCode,
  }: {
    slug: string;
    verbLine: string;
    exitCode: number;
  }): RegisterVerbRefusedError => ({
    code: "REGISTER_VERB_REFUSED",
    exitCode,
    message: `\`${verbLine}\` refused ${slug} with exit ${String(exitCode)} — its own output above says why, and it stands`,
    slug,
    verbLine,
  }),
  rowFile: ({ path, cause }: { path: string; cause: string }): RowFileError => ({
    code: "ROW_FILE",
    message: `the board row at ${path} could not be handled — ${cause}`,
    path,
  }),
  unactableVerdict: ({ slug, verdict }: { slug: string; verdict: string }): UnactableVerdictError => ({
    code: "UNACTABLE_VERDICT",
    message: `${slug} is ${verdict}, which carries no act here — its witness on \`sweep board\` says what a person does next`,
    slug,
    verdict,
  }),
  unknownCandidate: ({ slug }: { slug: string }): UnknownCandidateError => ({
    code: "UNKNOWN_CANDIDATE",
    message: `no row on this sweep is named ${slug} — re-run \`slopweaver sweep board\` for current candidates`,
    slug,
  }),
} as const;
