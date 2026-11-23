/**
 * The typed refusals of the self-improvement briefing section (`./briefingSection.ts`).
 *
 * Its own domain rather than an arm of `./errors.ts`, which scopes itself to the telemetry read: the
 * error-handling rule allows no union shared across domains. Every variant is a REFUSAL of shape — the section
 * never trims to fit, so a caller branches on which budget was crossed and displays the message, which names
 * what the section would otherwise have had to drop.
 */

/** More findings reached the section than it may carry. */
export interface TooManyFindingsError {
  readonly code: "TOO_MANY_FINDINGS";
  readonly message: string;
  readonly cap: number;
  /** Every finding id the section would have had to drop, in the order it received them. */
  readonly overflowIds: readonly string[];
}

/** One finding's headline runs over its word budget. */
export interface HeadlineOverBudgetError {
  readonly code: "HEADLINE_OVER_BUDGET";
  readonly message: string;
  readonly id: string;
  readonly words: number;
  readonly cap: number;
}

/** The section as a whole puts more words above the fold than its budget. */
export interface AboveFoldOverBudgetError {
  readonly code: "ABOVE_FOLD_OVER_BUDGET";
  readonly message: string;
  readonly words: number;
  readonly cap: number;
  /** Every finding's headline and its word count, in the order received, so the refusal names what it would have cut. */
  readonly headlines: readonly { readonly id: string; readonly words: number }[];
}

/** The briefing's own section schema refused what the renderer built. */
export interface SectionSchemaRefusedError {
  readonly code: "SECTION_SCHEMA_REFUSED";
  readonly message: string;
  /** Each schema issue as `path: message`, carried forward rather than flattened to one line. */
  readonly issues: readonly string[];
}

/** What one finding's note can be refused for on its own, before the section is assembled. */
export type NoteRefusal = HeadlineOverBudgetError | SectionSchemaRefusedError;

/** One or more findings' notes were refused on their own; every one is carried, never only the first. */
export interface NotesRefusedError {
  readonly code: "NOTES_REFUSED";
  readonly message: string;
  /** Every note refusal, in the order the findings were received, a finding with two failures carrying both. */
  readonly refusals: readonly NoteRefusal[];
}

/** Every way the section refuses to render. */
export type SelfImprovementSectionError =
  AboveFoldOverBudgetError | NotesRefusedError | SectionSchemaRefusedError | TooManyFindingsError;

/** The only constructors for {@link SelfImprovementSectionError}, so a test builds one the way the code does. */
export const SelfImprovementSectionErrors = {
  aboveFoldOverBudget: ({
    words,
    cap,
    headlines,
  }: {
    words: number;
    cap: number;
    headlines: readonly { readonly id: string; readonly words: number }[];
  }): AboveFoldOverBudgetError => ({
    cap,
    code: "ABOVE_FOLD_OVER_BUDGET",
    headlines,
    message:
      `the self-improvement section puts ${String(words)} words above the fold, over its budget of ` +
      `${String(cap)}; its headlines were ${headlines.map((headline) => `${headline.id} (${String(headline.words)} words)`).join(", ")}. ` +
      "Nothing was cut — shorten the collectors' summaries, or surface fewer findings.",
    words,
  }),
  headlineOverBudget: ({ id, words, cap }: { id: string; words: number; cap: number }): HeadlineOverBudgetError => ({
    cap,
    code: "HEADLINE_OVER_BUDGET",
    id,
    message:
      `finding ${id}'s headline runs to ${String(words)} words, over the cap of ${String(cap)}. Nothing was ` +
      "cut — the collector that wrote its summary is the thing to shorten.",
    words,
  }),
  notesRefused: ({ refusals }: { refusals: readonly NoteRefusal[] }): NotesRefusedError => ({
    code: "NOTES_REFUSED",
    message:
      `${String(refusals.length)} refusal(s) across the self-improvement section's findings; nothing was rendered: ` +
      refusals.map((refusal) => refusal.message).join(" | "),
    refusals,
  }),
  sectionSchemaRefused: ({ issues }: { issues: readonly string[] }): SectionSchemaRefusedError => ({
    code: "SECTION_SCHEMA_REFUSED",
    issues,
    message: `the briefing's section schema refused the self-improvement section: ${issues.join("; ")}`,
  }),
  tooManyFindings: ({ cap, overflowIds }: { cap: number; overflowIds: readonly string[] }): TooManyFindingsError => ({
    cap,
    code: "TOO_MANY_FINDINGS",
    message:
      `the self-improvement section carries at most ${String(cap)} findings and was handed ` +
      `${String(cap + overflowIds.length)}; it would have dropped ${overflowIds.join(", ")}. Nothing was ` +
      "rendered — rank and cap before rendering, and the rest stay in the backlog.",
    overflowIds,
  }),
} as const;
