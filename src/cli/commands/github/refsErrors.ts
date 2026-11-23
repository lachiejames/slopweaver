/**
 * The failures of the two remote-ref write verbs, `github branch delete` and `github tag create`, once they
 * are inside the door. Distinct because a caller reads them differently: a provider failure is retryable, a
 * refusal on re-read means the world changed under the dry run, and an unconfirmed write means something MAY
 * already have changed. Every message says what was left in place, because these verbs make two writes and
 * GitHub gives no transaction over them.
 */

/** A provider read or write failed. */
export interface RefProviderFailedError {
  readonly code: "REF_PROVIDER_FAILED";
  readonly message: string;
}

/** The fresh read inside the door no longer supports the act the preflight decided. */
export interface RefStateChangedError {
  readonly code: "REF_STATE_CHANGED";
  readonly message: string;
}

/** A write was sent and GitHub accepted it, but the read-back does not show the state it should have made. */
export interface RefUnconfirmedError {
  readonly code: "REF_UNCONFIRMED";
  readonly message: string;
}

export type GithubRefsError = RefProviderFailedError | RefStateChangedError | RefUnconfirmedError;

/**
 * The note every post-tag failure carries, so a partial effect is never silent. It says what GitHub ACCEPTED, not
 * that the tag is there now: the read-back that would say so is what failed.
 */
function keptSuffix({ kept }: { kept: { tag: string; tip: string } | undefined }): string {
  return kept === undefined
    ? ""
    : ` — GitHub accepted tag ${kept.tag} at ${kept.tip}; read it back before any retry or cleanup`;
}

export const GithubRefsErrors = {
  providerFailed: ({
    step,
    cause,
    kept,
  }: {
    step: string;
    cause: string;
    kept: { tag: string; tip: string } | undefined;
  }): RefProviderFailedError => ({
    code: "REF_PROVIDER_FAILED",
    message: `${step} failed: ${cause}${keptSuffix({ kept })}`,
  }),
  stateChanged: ({
    what,
    kept,
  }: {
    what: string;
    kept: { tag: string; tip: string } | undefined;
  }): RefStateChangedError => ({
    code: "REF_STATE_CHANGED",
    message: `refused on a fresh read: ${what}${keptSuffix({ kept })}`,
  }),
  unconfirmed: ({
    ref,
    readBack,
    expected,
    kept,
  }: {
    ref: string;
    readBack: string;
    expected: string;
    kept: { tag: string; tip: string } | undefined;
  }): RefUnconfirmedError => ({
    code: "REF_UNCONFIRMED",
    message: `GitHub accepted the write but ${ref} reads back ${readBack}, not ${expected}${keptSuffix({ kept })}`,
  }),
} as const;
