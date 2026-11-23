/**
 * Why the identity roster could not be read or written. The roster's own union, scoped to this one register
 * (`.claude/rules/error-handling.md`: no shared base type across domains) — a caller branches on `code` and
 * prints `message`.
 *
 * Three kinds, because a caller does three different things about them: an unreachable store means WHO a handle
 * names is unknown, so nothing that addresses a person proceeds; a malformed document is a defect to fix in the
 * document; a revision conflict is a writer that lost a race and must re-read before it judges again.
 */

/** The store could not be selected, opened or queried, so the roster is unknown. */
export interface IdentityRosterStoreUnavailableError {
  readonly code: "IDENTITY_ROSTER_STORE_UNAVAILABLE";
  readonly message: string;
}

/** A roster document — the retired file, a replacement or the stored row — is not a roster. */
export interface IdentityRosterMalformedError {
  readonly code: "IDENTITY_ROSTER_MALFORMED";
  readonly message: string;
  /** Where the document came from: a path, or `the store's identity-roster row`. */
  readonly source: string;
  /** Every problem found, each naming its entry by index and never by value. */
  readonly problems: readonly string[];
}

/** Another writer moved the roster first; nothing was written. */
export interface IdentityRosterRevisionConflictError {
  readonly code: "IDENTITY_ROSTER_REVISION_CONFLICT";
  readonly message: string;
  /** The revision the writer read; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/** Every way reading or writing the identity roster fails. */
export type IdentityRosterError =
  IdentityRosterStoreUnavailableError | IdentityRosterMalformedError | IdentityRosterRevisionConflictError;

/** Where a stored document is said to come from, spelled once for a decoder and a test. */
export const STORED_ROSTER_SOURCE = "the store's identity-roster row";

/** The factories every roster failure is built by. */
export const IdentityRosterErrors = {
  malformed: ({ problems, source }: { problems: readonly string[]; source: string }): IdentityRosterMalformedError => ({
    code: "IDENTITY_ROSTER_MALFORMED",
    message: `${source} is not an identity roster: ${problems.join("; ")}`,
    problems,
    source,
  }),
  revisionConflict: ({ expectedRevision }: { expectedRevision: number }): IdentityRosterRevisionConflictError => ({
    code: "IDENTITY_ROSTER_REVISION_CONFLICT",
    expectedRevision,
    message:
      `the identity roster changed while this replacement was prepared (read at revision ` +
      `${String(expectedRevision)}), so nothing was written; run \`slopweaver identity roster show\` and judge the ` +
      "replacement again against what is there now.",
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): IdentityRosterStoreUnavailableError => ({
    code: "IDENTITY_ROSTER_STORE_UNAVAILABLE",
    message:
      `this install keeps its identity roster in the store, and the store could not ${doing}, so who a handle ` +
      "names is UNKNOWN — nothing that addresses a person proceeds on a guess (`slopweaver store status` says " +
      `what the store is doing). The store said: ${reason}`,
  }),
} as const;
