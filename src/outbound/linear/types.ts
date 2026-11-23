/**
 * The Linear ISSUE vocabulary — Linear's own, deliberately NOT a reuse of `../artifact/types.ts`.
 *
 * The neutral form exists so a provider adds only a renderer, and for Slack that held. It does not hold here,
 * and the reason is structural rather than stylistic: **Linear positions media inside the prose.** A Slack
 * card carries `media` as a flat attachment bag because Slack renders attachments in one place regardless of
 * where the author put them; a Linear description is markdown, so an image sits at a byte offset and belongs
 * to the paragraph above it. Real tickets place an image before any heading, between sections, and nested
 * inside a list item. `UpdateArtifact` has no ordering, no sections, no checkboxes and no collapsible, so
 * expressing an issue through it would mean a positional convention smuggled into renderer code — an
 * undocumented second schema, which is strictly worse than an honest one.
 *
 * The ordering mechanism is the same one Slack uses for `detail`: an ORDERED array of discriminated blocks.
 * What differs is who controls headings. In {@link StructuredIssue} the sections are named fields and a
 * heading is unrepresentable, which is what keeps the shape enforceable. In {@link FreeformIssue} a heading
 * is a block, for the tickets that genuinely do not fit.
 *
 * ## Text is markdown here, and that inverts the Slack rule
 *
 * Slack's renderer emits `rich_text`, where markdown is INERT — so emphasis had to be structural (`bold:
 * true`) and a `*` in a text field was a form-fill bug. A Linear description IS markdown, so emphasis is
 * syntax and `**bold**` in a paragraph is correct authoring, not a defect. Do not port the run model here;
 * it would force every caller to rebuild markdown they already have.
 *
 * What the schema still refuses is STRUCTURE, never words: a line that opens a heading or a collapsible
 * delimiter. That distinction is the whole design. See `./schema.ts` for why each refusal exists.
 */

/** A paragraph of markdown. Emphasis, inline links and inline code are syntax and belong in `text`. */
interface ParaBlock {
  readonly kind: "para";
  readonly text: string;
}

/**
 * A bulleted list. The renderer supplies the `- `.
 *
 * An item is not merely a string, and that is the whole point: real tickets nest a screenshot UNDER a
 * specific step ("2. Select the CSV" followed by the image of the validation failure). With a flat
 * `string[]` the only options were to move the image after the entire list — losing which step it belongs
 * to — or to smuggle `![…](…)` into the item text, which bypasses the `media` discriminator, the MIME
 * embed-versus-link decision and the alt-text escaping. Both are worse than modelling it.
 */
export interface BulletsBlock {
  readonly kind: "bullets";
  readonly items: readonly ListItem[];
}

/**
 * One list item: its own line of markdown, plus anything nested beneath it.
 *
 * `nested` is deliberately {@link NestedBlock} — a heading cannot live inside a list item in any kind,
 * because a heading nested under a bullet escapes the list entirely.
 */
export interface ListItem {
  readonly text: string;
  readonly nested?: readonly NestedBlock[] | undefined;
}

/**
 * What may sit UNDER a list item: prose, media, code or a checklist — never a heading, and never another
 * bulleted list.
 *
 * Excluding bullets is what keeps the type acyclic, and it is not a workaround: a bullet inside a bullet is
 * sub-list nesting, a separate feature with its own indentation rules, and no measured ticket needed it. The
 * case this exists for is one level deep — a screenshot or a note belonging to a specific step.
 */
export type NestedBlock = ParaBlock | MediaBlock | CodeBlock | ChecklistBlock;

/** A checkbox list. `done` is the box state, so a caller never hand-writes `- [x]`. */
interface ChecklistBlock {
  readonly kind: "checklist";
  readonly items: readonly ChecklistItem[];
}

/** One checkbox. */
interface ChecklistItem {
  readonly text: string;
  readonly done: boolean;
}

/**
 * An attachment, positioned. `mime` is REQUIRED and load-bearing rather than metadata: an image renders as
 * `![alt](url)` and anything else as `[alt](url)`, because `![]()` around a PDF renders a broken image in
 * Linear. So the caller stating the type is what decides correct output, not a guess from the URL — and
 * Linear's asset URLs carry no file extension to guess from.
 */
interface MediaBlock {
  readonly kind: "media";
  readonly url: string;
  readonly alt: string;
  readonly mime: string;
}

/** A fenced code block. `lang` may be the empty string for an unlabelled fence. */
interface CodeBlock {
  readonly kind: "code";
  readonly lang: string;
  readonly text: string;
}

/** A `##` section heading. Representable ONLY inside {@link FreeformIssue}. */
interface HeadingBlock {
  readonly kind: "heading";
  readonly text: string;
}

/**
 * The blocks a NAMED section may hold. No heading: in the structured kind the sections are the fields, so a
 * caller-supplied heading could only ever escape the section it sits in.
 */
export type SectionBlock = ParaBlock | BulletsBlock | ChecklistBlock | MediaBlock | CodeBlock;

/** The blocks a freeform body may hold — {@link SectionBlock} plus the heading it is allowed to control. */
export type FreeformBlock = SectionBlock | HeadingBlock;

/**
 * One titled collapsible a reader opens on purpose: the supporting detail of a long proposal.
 *
 * A FIELD of the issue rather than a block kind, and that is structural: Linear's `+++` collapsibles do not
 * nest, and `aiPrompt` is itself one. As a block kind it would be reachable inside the AI prompt, under a list
 * item, or inside another of these, and each of those renders a delimiter that closes the outer block early.
 * As a top-level field it can only ever render at the top level, between the sections and the AI prompt.
 */
export interface DetailsBlock {
  /** The line a reader sees on the closed fold, rendered after `+++ `. */
  readonly title: string;
  readonly blocks: readonly SectionBlock[];
}

/**
 * The default issue shape: Problem, Solution, optional Acceptance criteria, and the required collapsible.
 *
 * `proofOfProblem` is the one addition to the owner's existing format, and it answers a specific waste: a
 * ticket is raised for a suspected problem, someone picks it up believing it, and it turns out not to be one.
 * It renders inside the Problem section with no heading of its own, because it is evidence for the problem
 * rather than a peer of it.
 *
 * Note this is proof the problem is REAL. It is not the owner's existing `## Proof` section, which states the
 * artefact the finished work must produce — a different thing that currently lives in three inconsistent
 * places (a section, an acceptance item, and a line inside the AI prompt) and is deliberately left alone here.
 */
export interface StructuredIssue {
  readonly kind: "structured";
  readonly problem: readonly SectionBlock[];
  readonly proofOfProblem?: readonly SectionBlock[] | undefined;
  readonly solution: readonly SectionBlock[];
  readonly acceptance?: readonly string[] | undefined;
  /** Optional folds for the human-facing detail, rendered after Acceptance criteria and before the AI prompt. */
  readonly details?: readonly DetailsBlock[] | undefined;
  readonly aiPrompt: readonly SectionBlock[];
}

/**
 * The escape hatch: one ordered body, headings allowed.
 *
 * It exists because a schema with no opt-out would make slopweaver worse than typing into Linear, which is
 * the bar it has to beat — and because real tickets exist that carry a lead blockquote, an image before any
 * heading, or a shape nobody has named yet. It still requires `aiPrompt`, so the progressive-disclosure
 * property that makes these tickets readable survives even the opt-out.
 */
export interface FreeformIssue {
  readonly kind: "freeform";
  readonly body: readonly FreeformBlock[];
  /** Optional folds for the human-facing detail, rendered after the body and before the AI prompt. */
  readonly details?: readonly DetailsBlock[] | undefined;
  readonly aiPrompt: readonly SectionBlock[];
}

/** Every issue body slopweaver can render, discriminated on `kind`. */
export type LinearIssueArtifact = StructuredIssue | FreeformIssue;

/**
 * The fields that are not body content but are part of a valid write.
 *
 * `priority` is a fixed 0-4 enum because Linear's priority scale is GLOBAL — there is no priority
 * configuration on a team, so it is the one field that needs no per-team resolution. `estimate` and `stateId`
 * are deliberately opaque here: a team's estimate scale is `Team.issueEstimationType`
 * (`notUsed`/`exponential`/`fibonacci`/`linear`/`tShirt`) and its workflow states are its own, so what counts
 * as valid depends on the destination team and cannot be a constant in this file.
 *
 * All three are OPTIONAL by owner decision: a ticket should be able to land in triage and be sized by whoever
 * picks it up. `triage` is a real Linear workflow-state type, so that is the product working normally rather
 * than an incomplete write.
 */
export interface LinearIssueFields {
  readonly title: string;
  readonly teamId: string;
  readonly priority?: LinearPriority | undefined;
  /** Omitted leaves the estimate alone, a number sets it, and `null` CLEARS it. */
  readonly estimate?: number | null | undefined;
  readonly stateId?: string | undefined;
  /**
   * WHICH project it sits in, with the same three states as `cycleId`: omitted leaves the project alone, an
   * id moves it there, and `null` DETACHES it from whatever project it is in — the only way to take an issue
   * back out of a project it was wrongly attached to without cancelling or archiving the issue itself.
   */
  readonly projectId?: string | null | undefined;
  readonly labelIds?: readonly string[] | undefined;
  /**
   * WHO to assign it to — a roster KEY, not a Linear user id, and the one field here that is deliberately
   * not the provider's own vocabulary.
   *
   * Every other opaque id on this form is copied from somewhere. An assignee is a PERSON, and a wrong one
   * puts work in a colleague's queue and their face on someone else's problem — so the form takes a key a
   * human can read and check (a canonical person id, a Linear user id, a Linear handle, `@handle`, or the
   * email on the Linear identity) and `../assigneeIndex.ts` resolves it against the CONFIRMED identity
   * roster, exact-match only. A key that does not resolve is refused, never guessed.
   *
   * The resolved id is what reaches `IssueCreateInput.assigneeId`; this field never does.
   *
   * `null` is the third state and it is not the same as omitting the field: omitting it means LEAVE THE
   * ASSIGNEE ALONE, while `null` means CLEAR IT. An update that could only ever set an assignee cannot
   * hand a ticket back to its team, which is half of what moving one to the backlog means.
   */
  readonly assignee?: string | null | undefined;
  /**
   * WHICH cycle it belongs to, with the same three states as `assignee`: omitted leaves the cycle alone,
   * an id moves it, and `null` REMOVES it from whatever cycle it is in.
   *
   * Unlike `assignee` this is the provider's own vocabulary, because a cycle has no roster to resolve
   * against and no person on the other end of getting it wrong.
   */
  readonly cycleId?: string | null | undefined;
  /**
   * WHICH issue this one sits under, with the same three states as `cycleId`: omitted leaves the parent
   * alone, an id nests it, and `null` DETACHES it. The provider's own vocabulary, for the reason `cycleId`
   * gives: no person is on the other end of getting it wrong.
   */
  readonly parentId?: string | null | undefined;
}

/** Linear's global priority scale. 0 is "No priority", which is also what omitting the field means. */
type LinearPriority = 0 | 1 | 2 | 3 | 4;

/** A complete write: the fields plus the body. */
export interface LinearIssueForm {
  readonly fields: LinearIssueFields;
  readonly artifact: LinearIssueArtifact;
}
