/**
 * Why an install's `gmail triage` policy could not be read or written: the one typed union every refusal of
 * `./triageRuleStore.ts` and `gmail triage-rules` goes through, and the factory that builds each variant.
 */

/** A rule document — the retired file, or a `--set` file handed to `gmail triage-rules` — could not be read at all. */
export interface GmailTriageRulesUnreadableError {
  readonly code: "TRIAGE_RULES_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** A rule document was read but is not the declared shape. */
export interface GmailTriageRulesMalformedError {
  readonly code: "TRIAGE_RULES_MALFORMED";
  readonly message: string;
  /** Where the document came from: a file path, or the store's row. */
  readonly source: string;
  readonly issues: readonly string[];
}

/** The store that holds the rules could not be selected, reached or queried. Nothing was read or written. */
export interface GmailTriageRulesStoreUnavailableError {
  readonly code: "TRIAGE_RULES_STORE_UNAVAILABLE";
  readonly message: string;
}

/** Another writer changed the rules between this writer's read and its compare-and-set. Nothing was written. */
export interface GmailTriageRulesRevisionConflictError {
  readonly code: "TRIAGE_RULES_REVISION_CONFLICT";
  readonly message: string;
  /** The revision this writer read and pinned to; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/** Why the install's triage rules could not be read or written. */
export type GmailTriageRulesError =
  | GmailTriageRulesUnreadableError
  | GmailTriageRulesMalformedError
  | GmailTriageRulesStoreUnavailableError
  | GmailTriageRulesRevisionConflictError;

/** The factory every refusal of the triage policy goes through. */
export const GmailTriageRulesErrors = {
  malformed: ({ source, issues }: { source: string; issues: readonly string[] }): GmailTriageRulesMalformedError => ({
    code: "TRIAGE_RULES_MALFORMED",
    issues,
    message: `${source} is not a gmail triage rule document (${issues.join("; ")})`,
    source,
  }),
  unreadable: ({ path, detail }: { path: string; detail: string }): GmailTriageRulesUnreadableError => ({
    code: "TRIAGE_RULES_UNREADABLE",
    detail,
    message: `${path} could not be read (${detail})`,
    path,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): GmailTriageRulesStoreUnavailableError => ({
    code: "TRIAGE_RULES_STORE_UNAVAILABLE",
    message:
      `this install's gmail triage rules live in the store, and the store could not ${doing}, so which mail is ` +
      `already ruled is UNKNOWN — refusing rather than triaging as if none were (\`slopweaver store status\` says ` +
      `what the store is doing). The store said: ${reason}`,
  }),
  revisionConflict: ({ expectedRevision }: { expectedRevision: number }): GmailTriageRulesRevisionConflictError => ({
    code: "TRIAGE_RULES_REVISION_CONFLICT",
    expectedRevision,
    message:
      `the gmail triage rules changed while this change was being prepared (read at revision ` +
      `${String(expectedRevision)}), so nothing was written; list them again and decide whether it still applies`,
  }),
} as const;

/** What the store's row is called when it is the source of a refusal. */
export const STORED_RULES_SOURCE = "the store's gmail-triage-rules row";
