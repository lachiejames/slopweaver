/**
 * The Nightfall atlas's own failure kinds.
 *
 * A discriminated union rather than `readonly string[]` because callers branch here: a generation the publish
 * gate refused is a different act from a compiled registry that disagrees with itself, and a verb that could
 * not tell them apart would print the same remedy for both. `.claude/rules/error-handling.md`
 * carries the rule and the restraint that goes with it — a one-variant union invented for its own sake is
 * the ceremony that pattern exists to avoid, and this one has two real variants.
 */

/** The publish gate refused the whole generation rather than redacting it. */
export interface NightfallPublishRefusedError {
  readonly code: "PUBLISH_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The compiled registry disagrees with itself — a table edited by hand, or a naming rule that moved. */
export interface NightfallRegistryInvalidError {
  readonly code: "REGISTRY_INVALID";
  readonly message: string;
  /** What the check found, in its own words. */
  readonly detail: string;
}

/** Anything the Nightfall atlas can fail with. */
export type NightfallAtlasError = NightfallPublishRefusedError | NightfallRegistryInvalidError;

/** How every Nightfall atlas failure is constructed. */
export const NightfallAtlasErrors = {
  publishRefused: ({ reasons }: { reasons: readonly string[] }): NightfallPublishRefusedError => ({
    code: "PUBLISH_REFUSED",
    message: `the Nightfall generation was refused rather than published: ${reasons.join("; ")}`,
    reasons,
  }),
  registryInvalid: ({ detail }: { detail: string }): NightfallRegistryInvalidError => ({
    code: "REGISTRY_INVALID",
    detail,
    message: `the compiled Nightfall surface registry is not self-consistent: ${detail} — regenerate it with yarn tsx tools/generateNightfallSurfaces.ts`,
  }),
} as const;
