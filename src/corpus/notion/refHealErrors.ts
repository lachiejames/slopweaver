/**
 * Why one mangled content ref could not be healed.
 *
 * A union because the four are different KINDS with different remedies. No candidate and several candidates
 * are both "the store cannot say which file this ref meant", but the first means the bytes were never kept
 * (a re-pull is the only fix) while the second means the pattern is too loose to choose (never guess). A
 * size mismatch and a digest mismatch are both "the one candidate is not the file the ref described", and
 * the second additionally means something wrote over the store.
 *
 * Scoped to the ref heal, per the no-shared-base rule; it is not `NotionBodyError` and does not extend it.
 */

/** No stored file matches the mangled digest's shape. */
export interface RefHealNoCandidateError {
  readonly code: "NO_CANDIDATE";
  readonly message: string;
  readonly mangled: string;
}

/** More than one stored file matches, so choosing one would be a guess. */
export interface RefHealAmbiguousError {
  readonly code: "AMBIGUOUS";
  readonly message: string;
  readonly mangled: string;
  readonly candidates: readonly string[];
}

/** The one candidate's size is not the byte count the ref itself recorded. */
export interface RefHealSizeMismatchError {
  readonly code: "SIZE_MISMATCH";
  readonly message: string;
  readonly digest: string;
  readonly recorded: string;
  readonly actual: number;
}

/** The one candidate does not hash to its own name, so the store's copy is not the bytes it names. */
export interface RefHealDigestMismatchError {
  readonly code: "DIGEST_MISMATCH";
  readonly message: string;
  readonly digest: string;
  readonly actual: string;
}

/** Every way healing one ref can be refused. */
export type RefHealError =
  RefHealNoCandidateError | RefHealAmbiguousError | RefHealSizeMismatchError | RefHealDigestMismatchError;

/** The factory the real code calls, so a test built the same way catches one that stops matching its type. */
export const RefHealErrors = {
  ambiguous: ({ mangled, candidates }: { mangled: string; candidates: readonly string[] }): RefHealAmbiguousError => ({
    candidates,
    code: "AMBIGUOUS",
    mangled,
    message: `sha256:${mangled} matches ${String(candidates.length)} stored files — refusing to choose one`,
  }),
  digestMismatch: ({ digest, actual }: { digest: string; actual: string }): RefHealDigestMismatchError => ({
    actual,
    code: "DIGEST_MISMATCH",
    digest,
    message: `stored file ${digest} hashes to ${actual} — the store's copy is not the bytes it names`,
  }),
  noCandidate: ({ mangled }: { mangled: string }): RefHealNoCandidateError => ({
    code: "NO_CANDIDATE",
    mangled,
    message: `sha256:${mangled} matches no stored file — only a re-pull of its page can restore it`,
  }),
  sizeMismatch: ({
    digest,
    recorded,
    actual,
  }: {
    digest: string;
    recorded: string;
    actual: number;
  }): RefHealSizeMismatchError => ({
    actual,
    code: "SIZE_MISMATCH",
    digest,
    message: `stored file ${digest} is ${String(actual)} bytes, the ref recorded ${recorded}`,
    recorded,
  }),
} as const;
