/**
 * Why a `hand post` invocation's flags do not describe one step — the verb's own typed union, one per bounded
 * module (`.claude/rules/error-handling.md`). Each is a usage problem the verb prints, prefixed `hand post:`,
 * before any step is built or written.
 */

/** Both posting forms were passed: `--row` and `--standalone`. */
export interface FormsBothError {
  readonly code: "FORMS_BOTH";
  readonly message: string;
}

/** Neither posting form was passed. */
export interface FormMissingError {
  readonly code: "FORM_MISSING";
  readonly message: string;
}

/** Both tiers were passed: `--check-in` and `--blocks`. */
export interface TiersBothError {
  readonly code: "TIERS_BOTH";
  readonly message: string;
}

/** Neither tier was passed — the step would rank as whatever an absent mark happens to mean. */
export interface TierMissingError {
  readonly code: "TIER_MISSING";
  readonly message: string;
}

/** Both addresses that name the note's link were passed: `--open` and `--url`. */
export interface LinksBothError {
  readonly code: "LINKS_BOTH";
  readonly message: string;
}

/** `--open` named something no console deep link can be minted from. */
export interface LinkUnmintableError {
  readonly code: "LINK_UNMINTABLE";
  readonly message: string;
  /** Each problem the link minter named, printed one diagnostic line apiece. */
  readonly problems: readonly string[];
}

/** `--shot` without a `--box`, or a `--box` without the `--shot` it is drawn on. */
export interface ShotUnpairedError {
  readonly code: "SHOT_UNPAIRED";
  readonly message: string;
}

/** Every way `hand post`'s flags are refused before a step is built. */
export type HandPostArgsError =
  | FormsBothError
  | FormMissingError
  | TiersBothError
  | TierMissingError
  | LinksBothError
  | LinkUnmintableError
  | ShotUnpairedError;

/** The factories for {@link HandPostArgsError}. */
export const HandPostArgsErrors = {
  formMissing: (): FormMissingError => ({
    code: "FORM_MISSING",
    message:
      "say which board row this step unblocks with --row <slug>, so the card leaves the owner's queue the moment that " +
      "row is done — or --standalone when no board row owns it. Exactly one of the two",
  }),
  formsBoth: (): FormsBothError => ({
    code: "FORMS_BOTH",
    message: "--row and --standalone are the two posting forms — pass exactly one, never both",
  }),
  linkUnmintable: ({ problems }: { problems: readonly string[] }): LinkUnmintableError => ({
    code: "LINK_UNMINTABLE",
    message: problems.join("; "),
    problems,
  }),
  linksBoth: (): LinksBothError => ({
    code: "LINKS_BOTH",
    message: "--open mints the link --url would carry — pass one of the two, never both",
  }),
  shotUnpaired: ({ hasShot }: { hasShot: boolean }): ShotUnpairedError => ({
    code: "SHOT_UNPAIRED",
    message: hasShot
      ? "--shot needs at least one --box x,y,width,height=label — a picture with no box shows the owner nothing to grab"
      : "--box is drawn on a picture — pass the provider page's PNG with --shot",
  }),
  tierMissing: (): TierMissingError => ({
    code: "TIER_MISSING",
    message:
      "say which tier this step is in: --blocks when work is stopped on the owner, or --check-in when the fleet " +
      "already did it and asks whether it was right (a dogfood try, an evaluation) — every surface leads " +
      "with a blocker and ranks a check-in last. Exactly one of the two",
  }),
  tiersBoth: (): TiersBothError => ({
    code: "TIERS_BOTH",
    message: "--check-in and --blocks are the two tiers — pass exactly one, never both",
  }),
} as const;

/**
 * The diagnostic lines one refusal prints, before the verb's `hand post:` prefix — a minted-link refusal one per
 * problem, as the minter named them, every other refusal its one message.
 *
 * @param error the refusal
 * @returns the lines, in order
 */
export function handPostArgsLines({ error }: { error: HandPostArgsError }): readonly string[] {
  if (error.code === "LINK_UNMINTABLE") {
    return error.problems;
  }
  return [error.message];
}
