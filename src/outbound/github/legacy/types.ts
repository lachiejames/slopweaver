/**
 * The GitHub PULL-REQUEST vocabulary: a reading-order body — risk first, then what the change does and why,
 * then the code.
 *
 * ## Why the body shape is fixed rather than free
 *
 * The body has an EXECUTABLE contract: `src/prformat/prBodyGate.ts` runs on every pull request in CI and accepts
 * a reading-order body only as the exact canonical render of a form. So the form is not "a way to write
 * markdown" — it is the typed pre-image of one specific document.
 *
 * ## The badges are derived, never authored
 *
 * The three badges a reader meets first are computed by `./derive.ts`, so a badge and the section it summarises
 * cannot disagree. Three facts are not derivable from the sections and travel in the badge tooltips instead: the
 * day the door stamped the body (`writtenOn`), the day the problem was last seen, and the reviewer's verdict.
 * That is what lets `./parse.ts` read a body back into the exact form that rendered it.
 *
 * ## Why a cell is a list of runs and not a string
 *
 * Emphasis is STRUCTURAL — an {@link Inline} run — and the renderer owns the tags. A caller cannot emit a
 * `</td>` or a `<table>` because it never supplies markup, only text and a kind. The one addition is
 * {@link EvidenceRun}: an image may sit inside an EVIDENCE cell — Before-and-after evidence, the click-through's
 * destination, or a proven claim's evidence — because a claim can rest on a screenshot, and a screenshot of
 * evidence renders as the picture wherever the body states a claim. The visible Proof section ({@link ProofItem})
 * is the other home, for a screenshot that needs its own width. Nowhere else, and never below the fold.
 *
 * ## Word counts are the gate's, not ours
 *
 * Caps are counted by `src/prformat`'s own `countWords` against the RENDERED cell. Tags are stripped, so
 * `<code>x</code>` contributes `x` and an `<a href=…>text</a>` contributes its text but not its URL.
 */

/**
 * One run of cell content. The renderer owns every tag; the caller supplies text and a kind.
 *
 * The set is exactly what the repository's real pull requests use — plain text, `<strong>`, `<em>`,
 * `<code>` and a link — rather than a general markup vocabulary nobody needs.
 */
export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "em"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly url: string };

/** The content of one cell: an ordered list of runs, never empty. */
export type Content = readonly Inline[];

/**
 * A block of the collapsed Longer notes.
 *
 * No table block and no raw-HTML block: both would let a caller emit structure the renderer does not own.
 */
export type ProofBlock = ProofBlockLeaf | ProofDetailsBlock;

/** The three block kinds that may appear anywhere, including nested inside a {@link ProofDetailsBlock}. */
export type ProofBlockLeaf =
  | { readonly kind: "para"; readonly content: Content }
  | { readonly kind: "code"; readonly lang: string; readonly text: string }
  /** Representable so a read-back can name it; `./formRules.ts` refuses it, because media is never folded. */
  | ImageRun;

/**
 * A collapsed `<details>` block — the sanctioned home for notes over the word cap.
 *
 * One level only: `blocks` holds leaf kinds, never another `details`.
 */
interface ProofDetailsBlock {
  readonly kind: "details";
  /** Single line — shares its line with the `<summary>` tag, so a newline would be dropped silently. */
  readonly summary: string;
  readonly blocks: readonly ProofBlockLeaf[];
}

/**
 * The routing fields — where the pull request goes.
 *
 * Together these are the **branch locus**, and the locus is the duplicate-guard key. It is deliberately not
 * a content hash: a retried create whose form changed slightly must still be recognised as the same intent,
 * and a content-derived key would let it open a second pull request.
 */
export interface PrTarget {
  readonly owner: string;
  readonly repo: string;
  /** The branch being merged INTO. */
  readonly base: string;
  /** The branch being merged FROM. */
  readonly head: string;
}

/** How bad, or how likely, a risk item is. */
export type Level = "low" | "medium" | "high";

/** A risk item's rank, P0 most urgent. */
export type Priority = 0 | 1 | 2 | 3 | 4;

/** A UTC calendar day, `YYYY-MM-DD`. */
export type IsoDay = string;

/** Whether somebody checked a risk item, and with what. An unchecked item says why it was not checked. */
type RiskCheck =
  { readonly kind: "checked"; readonly check: Content } | { readonly kind: "unchecked"; readonly why: Content };

/** One way this pull request could go wrong once merged. */
export interface RiskItem {
  /** The worst outcome, at most 15 words. */
  readonly worst: Content;
  readonly impact: Level;
  readonly likelihood: Level;
  /** Who or what it reaches, at most 12 words. */
  readonly reach: Content;
  readonly priority: Priority;
  /** At most 25 words. */
  readonly check: RiskCheck;
}

/** The section a reader meets first. */
export interface RiskSection {
  /** The prose after the derived bold verdict, at most 50 words. */
  readonly line: Content;
  /** One to five items, ranked so priority never decreases. */
  readonly items: readonly RiskItem[];
  /** At most 50 words. */
  readonly blastRadius: Content;
}

/** When the problem was last observed — or the admission that it never was. */
export type ProblemSeen = { readonly kind: "seen"; readonly on: IsoDay } | { readonly kind: "unevidenced" };

/**
 * An image, hosted as a GitHub user attachment: a run inside an evidence cell, or a Proof item's picture.
 *
 * `width` is the display width in pixels the renderer writes on the `<img>`, because GitHub sizes an unsized
 * image to its container — a claims-table cell squeezes a screenshot to the column. Absent, GitHub picks.
 *
 * @internal — named only through the exported content types that carry it
 */
export interface ImageRun {
  readonly kind: "image";
  readonly url: string;
  readonly alt: string;
  readonly width?: number | undefined;
}

/** One run of an evidence cell: any inline run, or an image. */
export type EvidenceRun = Inline | ImageRun;

/** An evidence cell's runs, never empty. */
export type EvidenceContent = readonly EvidenceRun[];

/** One column of the Before-and-after table. */
interface BeforeAfterSide {
  readonly where: Content;
  readonly evidence: EvidenceContent;
}

/** The problem as it was seen, beside this pull request's fix. */
export interface BeforeAfter {
  readonly problem: BeforeAfterSide;
  readonly fix: BeforeAfterSide;
}

/** A command that fails on the base branch and passes on this one. */
export interface FailsOnMain {
  /** Single line. */
  readonly command: string;
  /** A 7-to-40 character hex prefix of the base commit it failed on. */
  readonly mainSha: string;
}

/**
 * A click-through of the shipped control on the running build of this branch: the gold proof a pull request
 * changing a clickable surface owes (`./formClickThrough.ts`). Before merging, on the checked-out
 * branch, drive a browser against the running build, click the control, check it opens the page you meant.
 */
export interface ClickThrough {
  /** The control that was clicked, at most 25 words. */
  readonly control: Content;
  /** A 7-to-40 character hex prefix of the commit the running build was built from; it must match the gold anchor. */
  readonly commit: string;
  /** What the click opened: at least one screenshot, hosted as a GitHub user attachment. */
  readonly destination: EvidenceContent;
}

/**
 * How one claim stands: proven with evidence, a gap nobody checked, or checked and failed. Only the proven arm's
 * evidence is an evidence cell, so a screenshot of the proof renders as the picture in the claims table; a gap or
 * a failure states why proof is absent, and carries none.
 */
export type ClaimProof =
  | { readonly kind: "proven"; readonly evidence: EvidenceContent }
  | { readonly kind: "gap"; readonly why: Content }
  | { readonly kind: "failed"; readonly why: Content };

/** One row of the Other claims table. */
export interface Claim {
  readonly claim: Content;
  readonly proof: ClaimProof;
}

/**
 * One item of the visible Proof section: a screenshot under its caption, at a width the author picks rather than
 * squeezed into a table column. Supporting material, never a grade source — the badges stay derived from the
 * risks, claims and review.
 */
export interface ProofItem {
  /** At most 25 words. */
  readonly caption: Content;
  readonly image: ImageRun;
}

/** The grade a reviewer can give the claims. */
export type ReviewGrade = "gold" | "silver" | "bronze" | "unproven";

/** A reviewer's verdict on the claims — the reviewer's act, never the author's. */
export interface Review {
  readonly grade: ReviewGrade;
  /** Single line, carrying neither ` · ` nor `: `, because the tooltip it renders into splits on both. */
  readonly reviewer: string;
  /** At most 20 words, single line, no ` · `. */
  readonly why: string;
}

/**
 * The commit a gold claim was proved against, and optionally the patch id that survives a rebase.
 *
 * Gold is the grade that lets an agent merge its own pull request without the maintainer, so CI compares the
 * commit against the pull request's real head SHA; the patch id is what it falls back to when a plain rebase
 * moved the commit without touching the diff.
 */
export interface GoldAnchor {
  readonly commit: string;
  readonly patchId?: string | undefined;
}

/**
 * One row of the Who reviews what table: who is asked, and what they look at.
 *
 * Each reviewer is pointed at their own files, and one at the whole change except those files. `./reviewerTable.ts` derives
 * the rows from the diff and CODEOWNERS; a person picked for a team stands in for it.
 */
export interface ReviewerRow {
  /** The `@login` or `@org/team` tokens tagged; any ONE of them covers the row, as any one owner of a rule does. */
  readonly who: readonly string[];
  /** The CODEOWNERS tokens a picked person stands in for, shown untagged. Empty when nobody was picked. */
  readonly standsInFor: readonly string[];
  /** The changed files this row looks at, or everything the other rows do not name. */
  readonly look: { readonly kind: "files"; readonly files: readonly string[] } | { readonly kind: "rest" };
}

/**
 * One Codex review finding the change lands with after its second and last review pass (the owner's cap).
 * `codex status --check` prints each one; the landing verbs read them back off the body
 * (`../../codex/reviewLeftovers.ts`).
 */
export interface ReviewLeftoverEntry {
  /** The review row's artifact id — the identity the landing verbs match on. */
  readonly artifactId: string;
  readonly pass: string;
  readonly propertyId: string;
  /** What is still wrong, in one plain-text line. */
  readonly description: string;
}

/** The authored body of a reading-order pull request. */
export interface PrBody {
  /** Who reviews which files, present only when the change touches more than one owner's files. */
  readonly reviewers?: readonly ReviewerRow[] | undefined;
  readonly risk: RiskSection;
  /** The findings still standing after the second and last Codex review pass, rendered right after the risk. */
  readonly reviewLeftovers?: readonly ReviewLeftoverEntry[] | undefined;
  /** Where this pull request came from: a link, a transcript pointer, or "observed by … on …, no ask". */
  readonly origin: Content;
  readonly problemSeen: ProblemSeen;
  /** At most 50 words. */
  readonly problem: Content;
  /** At most 50 words. */
  readonly change: Content;
  readonly beforeAfter?: BeforeAfter | undefined;
  readonly failsOnMain?: FailsOnMain | undefined;
  /** The click-through of the shipped control; gold on a pull request changing a clickable surface needs one. */
  readonly clickThrough?: ClickThrough | undefined;
  /** May be empty; the section still renders so its heading's anchor resolves. */
  readonly claims: readonly Claim[];
  /** One to eight captioned screenshots, rendered visibly after Other claims and never folded. */
  readonly proof?: readonly ProofItem[] | undefined;
  /** One to five bullets of at most 25 words. */
  readonly whyApproach?: readonly Content[] | undefined;
  /** One to eight items of at most 25 words. */
  readonly whereToLook: readonly Content[];
  /** Collapsed below the fold; no image anywhere in them, at most 100 words outside a nested details block. */
  readonly notes?: readonly ProofBlock[] | undefined;
  readonly goldAnchor?: GoldAnchor | undefined;
  readonly review?: Review | undefined;
}

/** A body plus the day the door stamped it — everything a body's bytes carry. */
export interface StampedPrBody extends PrBody {
  readonly writtenOn: IsoDay;
}

/** What a caller fills in: the body plus its title, routing and draft state. */
export interface PrFormDraft extends PrBody {
  /** Single line. */
  readonly title: string;
  readonly target: PrTarget;
  readonly draft: boolean;
}

/** A draft the door has stamped with the UTC day it was written. */
export interface PrForm extends PrFormDraft {
  readonly writtenOn: IsoDay;
}

/** The owner and repository a gold anchor's commit link points into. */
export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

/** The optional body fields an edit may remove outright. */
export type RemovableField =
  | "beforeAfter"
  | "failsOnMain"
  | "clickThrough"
  | "proof"
  | "whyApproach"
  | "notes"
  | "goldAnchor"
  | "review"
  | "reviewers"
  | "reviewLeftovers";

/**
 * A field-level edit to a live reading-order body — the surgical-merge primitive.
 *
 * Updating a pull-request description replaces the whole body, so anything the caller did not re-supply would
 * be destroyed. An edit therefore names ONLY what changes; everything else is carried from the form the live
 * body recovers to. Absent means "leave it alone". Each set field replaces its section whole; `appendClaims`
 * and `appendNotes` add after what is there; `remove` drops an optional section. Naming one field in two of
 * those is refused, because the two would disagree about what the field ends as.
 *
 * NO `draft`: GitHub's REST `PATCH /pulls/{n}` cannot change draft state, so accepting it would report a change
 * that did not happen. NO `writtenOn`: the door stamps it. NO `target`: changing the base or head is a different
 * pull request, not a description edit.
 */
export interface PrFormEdit {
  readonly title?: string | undefined;
  /** The whole Who reviews what table, replaced; `github pr reviewers` derives it. */
  readonly reviewers?: readonly ReviewerRow[] | undefined;
  readonly risk?: RiskSection | undefined;
  /** The whole leftovers list, replaced; `codex status --check` prints the entries. */
  readonly reviewLeftovers?: readonly ReviewLeftoverEntry[] | undefined;
  readonly origin?: Content | undefined;
  readonly problemSeen?: ProblemSeen | undefined;
  readonly problem?: Content | undefined;
  readonly change?: Content | undefined;
  readonly beforeAfter?: BeforeAfter | undefined;
  readonly failsOnMain?: FailsOnMain | undefined;
  readonly clickThrough?: ClickThrough | undefined;
  readonly claims?: readonly Claim[] | undefined;
  readonly proof?: readonly ProofItem[] | undefined;
  readonly whyApproach?: readonly Content[] | undefined;
  readonly whereToLook?: readonly Content[] | undefined;
  readonly notes?: readonly ProofBlock[] | undefined;
  readonly goldAnchor?: GoldAnchor | undefined;
  /** The reviewer's verdict — the one way a review reaches a body. */
  readonly review?: Review | undefined;
  readonly appendClaims?: readonly Claim[] | undefined;
  readonly appendProof?: readonly ProofItem[] | undefined;
  readonly appendNotes?: readonly ProofBlock[] | undefined;
  readonly remove?: readonly RemovableField[] | undefined;
}
