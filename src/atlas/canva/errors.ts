/**
 * The Canva atlas's own failure kinds.
 *
 * A discriminated union rather than `readonly string[]` because callers genuinely branch here: a sync whose
 * store refused the write is a different act from one whose compiled registry disagrees with its own naming
 * rules, and a verb that could not tell them apart would print the same remedy for both — "regenerate the
 * table" is useless advice for a permissions problem. `.claude/rules/error-handling.md` carries the rule and
 * the restraint that goes with it.
 */

/** The atlas's own directory could not be created or written. */
export interface CanvaStoreUnwritableError {
  readonly code: "STORE_UNWRITABLE";
  readonly message: string;
  /** Every reason the store reported, in its own words. */
  readonly reasons: readonly string[];
}

/** The compiled registry disagrees with itself — a table edited by hand, or a naming rule that moved. */
export interface CanvaRegistryInvalidError {
  readonly code: "REGISTRY_INVALID";
  readonly message: string;
  /** What the check found, in its own words. */
  readonly detail: string;
}

/**
 * The generation already on disk could not be READ, so a publish cannot say what it would replace.
 *
 * Distinct from {@link CanvaStoreUnwritableError} because the remedies are opposite: an unwritable store is
 * a permissions or disk problem, while an unreadable generation is one a NEWER build published or one a
 * hand-edit broke — where the answer is `atlas canva restore` or a newer binary, never a retry.
 */
export interface CanvaStoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
  /** Every reason the reader gave, in its own words — including its own supersede advice. */
  readonly reasons: readonly string[];
}

/** Anything the Canva atlas can fail with. */
export type CanvaAtlasError = CanvaStoreUnwritableError | CanvaStoreUnreadableError | CanvaRegistryInvalidError;

/** How every Canva atlas failure is constructed. */
export const CanvaAtlasErrors = {
  registryInvalid: ({ detail }: { detail: string }): CanvaRegistryInvalidError => ({
    code: "REGISTRY_INVALID",
    detail,
    message: `the compiled Canva surface registry is not self-consistent: ${detail} — regenerate it with yarn tsx tools/generateCanvaSurfaces.ts --spec-dir <dir>`,
  }),
  storeUnreadable: ({ reasons }: { reasons: readonly string[] }): CanvaStoreUnreadableError => ({
    code: "STORE_UNREADABLE",
    message: `the Canva atlas generation on disk could not be read: ${reasons.join("; ")}`,
    reasons,
  }),
  storeUnwritable: ({ reasons }: { reasons: readonly string[] }): CanvaStoreUnwritableError => ({
    code: "STORE_UNWRITABLE",
    message: `the Canva atlas store could not be written: ${reasons.join("; ")}`,
    reasons,
  }),
} as const;
