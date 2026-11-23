/**
 * The Google Admin atlas's own failure kinds.
 *
 * A discriminated union rather than `readonly string[]` because callers branch here: a generation the publish
 * gate refused is a different act from a compiled registry that disagrees with itself, and a verb that could
 * not tell them apart would print the same remedy for both.
 * `.claude/rules/error-handling.md` carries the rule and the restraint that goes with it.
 */

/** The publish gate refused the whole generation rather than redacting it. */
export interface GoogleAdminPublishRefusedError {
  readonly code: "PUBLISH_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The compiled registry disagrees with itself — a table edited by hand, or a naming rule that moved. */
export interface GoogleAdminRegistryInvalidError {
  readonly code: "REGISTRY_INVALID";
  readonly message: string;
  /** What the check found, in its own words. */
  readonly detail: string;
}

/** Anything the Google Admin atlas can fail with. */
export type GoogleAdminAtlasError = GoogleAdminPublishRefusedError | GoogleAdminRegistryInvalidError;

/** How every Google Admin atlas failure is constructed. */
export const GoogleAdminAtlasErrors = {
  publishRefused: ({ reasons }: { reasons: readonly string[] }): GoogleAdminPublishRefusedError => ({
    code: "PUBLISH_REFUSED",
    message: `the Google Admin generation was refused rather than published: ${reasons.join("; ")}`,
    reasons,
  }),
  registryInvalid: ({ detail }: { detail: string }): GoogleAdminRegistryInvalidError => ({
    code: "REGISTRY_INVALID",
    detail,
    message: `the compiled Google Admin surface registry is not self-consistent: ${detail} — regenerate it with yarn tsx tools/generateGoogleAdminSurfaces.ts`,
  }),
} as const;
