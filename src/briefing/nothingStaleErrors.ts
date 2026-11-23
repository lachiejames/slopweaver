/**
 * The typed refusals of the Fleet Briefing's "Nothing stale" section (`./nothingStale.ts`).
 *
 * Its own domain: the error-handling rule allows no union shared across domains, and a document the section
 * could not read is NOT one of these — that is card data, named under "could not see", never a refusal. What
 * remains is a refusal of SHAPE: the section never trims to fit, so the message names every item it would
 * otherwise have had to drop.
 */

/** The section, fully built, weighs more than its measured byte budget. */
export interface NothingStaleSectionOverBudgetError {
  readonly code: "SECTION_OVER_BUDGET";
  readonly message: string;
  readonly bytes: number;
  readonly cap: number;
  /** Every item identity past the point the budget ran out, in the order the section lists them. */
  readonly overflowIdentities: readonly string[];
}

/** The briefing's own fixed-id section schema refused what the projection built. */
export interface NothingStaleSectionSchemaRefusedError {
  readonly code: "SECTION_SCHEMA_REFUSED";
  readonly message: string;
  /** Each schema issue as `path: message`, carried forward rather than flattened to one line. */
  readonly issues: readonly string[];
}

/** Every way the section refuses to render. */
export type NothingStaleSectionError = NothingStaleSectionOverBudgetError | NothingStaleSectionSchemaRefusedError;

/** The only constructors for {@link NothingStaleSectionError}, so a test builds one the way the code does. */
export const NothingStaleSectionErrors = {
  sectionOverBudget: ({
    bytes,
    cap,
    overflowIdentities,
  }: {
    bytes: number;
    cap: number;
    overflowIdentities: readonly string[];
  }): NothingStaleSectionOverBudgetError => ({
    bytes,
    cap,
    code: "SECTION_OVER_BUDGET",
    message:
      `the Nothing stale section is ${String(bytes)} bytes, over its cap of ${String(cap)}; it trims nothing, ` +
      `and would have had to drop ${String(overflowIdentities.length)} item(s): ${overflowIdentities.join(", ")}`,
    overflowIdentities,
  }),
  sectionSchemaRefused: ({ issues }: { issues: readonly string[] }): NothingStaleSectionSchemaRefusedError => ({
    code: "SECTION_SCHEMA_REFUSED",
    issues,
    message: `the briefing's section schema refused the Nothing stale section: ${issues.join("; ")}`,
  }),
} as const;
