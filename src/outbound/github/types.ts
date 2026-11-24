/**
 * The GitHub PULL-REQUEST vocabulary: the C3 description.
 *
 * ## The shape, in the order a reader meets it
 *
 * Three DERIVED badges (risk, problem, proof), the explainer directly under them, **Proof of the problem** and
 * **Proof of the solution** (each a screenshot, or a public reason there is none, at most two sentences, its heading
 * then reading `: not shown`), **Checks** as dot points with any labelled groups nested after them, **Not checked, and
 * why**, then a `<details>` fold holding ONLY what someone needs to re-run it, and no fold at all when there is nothing
 * to re-run. No table, no origin, no grade, no anchor, no
 * Codex leftovers: none of those is published (`AGENTS.md` rule 7).
 *
 * ## Why the body shape is fixed rather than free
 *
 * The body has an EXECUTABLE contract: `src/prformat/prBodyGate.ts` accepts this repository's own pull request only
 * as the exact canonical render of a form, so the form is the typed pre-image of one specific document, and
 * `./parse.ts` inverts `./render.ts` byte for byte.
 *
 * ## What travels in a badge hover
 *
 * Badges are computed (`./derive.ts`), never authored. Three facts have no visible section of their own and ride
 * the hovers instead, so a read-back recovers them: the top risk item (its worst case and its check), when and by
 * whom the problem was seen and what was seen (or why it was not), and who ran each screenshot. The risk items below
 * the top one are kept by the form for the write but are not published; a read-back recovers the top item alone,
 * with its kind canonicalised to its level, which renders the same bytes.
 *
 * ## Why a cell is a list of runs and not a string
 *
 * Emphasis is STRUCTURAL — an {@link Inline} run — and the renderer owns the tags, so a caller cannot emit markup.
 * Hover text is plain (an HTML `title` attribute shows no markup), so every field a hover carries is a string.
 */

/**
 * One run of cell content. The renderer owns every tag; the caller supplies text and a kind.
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
 * The routing fields — where the pull request goes. Together these are the branch locus, the duplicate-guard key.
 */
export interface PrTarget {
  readonly owner: string;
  readonly repo: string;
  /** The branch being merged INTO. */
  readonly base: string;
  /** The branch being merged FROM. */
  readonly head: string;
}

/**
 * Which layout a C3 body's bytes are in. Every write renders the CURRENT one (`./render.ts`'s `CURRENT_LAYOUT`);
 * the earlier one is still READ, and judged by the rules of its own time, so a body published before a layout change
 * is never retroactively refused:
 *
 * - `1` — `###` headings, each check its own paragraph, the proof hover's fixed "nothing on screen changes" opening.
 * - `2` — `##` headings, a proof heading reading `: not shown` over a reason, a Checks heading over dot points with
 *   labelled groups nested after them, and every content rule in `./descriptionWords.ts`.
 */
export type BodyLayout = 1 | 2;

/** How bad a risk is, as its badge shows it. */
export type Level = "low" | "medium" | "high";

/**
 * Which kind of worst case a risk item names. The author picks the KIND and the level follows from it, so nobody
 * picks a level:
 *
 * - `loses-leaks-or-changes-off-machine` — high: the worst case loses or leaks data, or changes something off this
 *   machine.
 * - `something-working-breaks` — medium: something that worked starts refusing, slows or reports wrong.
 * - `only-tests-docs-or-dev-tooling` — low: only tests, docs or dev tooling can break.
 */
export type WorstKind =
  "loses-leaks-or-changes-off-machine" | "something-working-breaks" | "only-tests-docs-or-dev-tooling";

/** A UTC calendar day, `YYYY-MM-DD`. */
export type IsoDay = string;

/** Whether somebody checked a risk item, and with what. An unchecked item says why it was not checked. */
export type RiskCheck =
  { readonly kind: "checked"; readonly check: string } | { readonly kind: "unchecked"; readonly why: string };

/**
 * One way this pull request could go wrong once merged. Never rendered as a section: the TOP item decides the risk
 * badge's level and writes its hover ("Worst case …. <check>."), so both fields are one plain sentence each.
 */
export interface RiskItem {
  /** The worst outcome, one sentence with no closing full stop, at most 20 words. */
  readonly worst: string;
  readonly worstKind: WorstKind;
  /** At most 25 words, one sentence with no closing full stop. */
  readonly check: RiskCheck;
}

/** The ranked risks; the first is the top one. */
export interface RiskSection {
  /** One to five items, ranked so the level their kind implies never rises. */
  readonly items: readonly RiskItem[];
}

/** Who ran a one-off act the description reports: a sign-in, a live run, a screenshot. */
export type ProofActor = "owner" | "agent";

/**
 * When the problem was seen on a real run, by whom, and what was seen — or why it was not seen yet.
 *
 * `by: "unrecorded"` is the honest answer when nothing records who ran it; the badge hover says so rather than
 * crediting anyone.
 */
export type ProblemSeen =
  | {
      readonly kind: "seen";
      readonly on: IsoDay;
      readonly by: ProofActor | "unrecorded";
      /** What was seen, one plain sentence with no closing full stop. */
      readonly what: string;
    }
  | {
      readonly kind: "not-seen";
      /** Why it was not seen on a real run yet, one plain sentence with no closing full stop. */
      readonly why: string;
    };

/**
 * An image hosted as a GitHub user attachment. `width` is the display width the renderer writes; absent, GitHub
 * picks.
 */
export interface ImageRun {
  readonly kind: "image";
  readonly url: string;
  readonly alt: string;
  readonly width?: number | undefined;
}

/**
 * One proof slot: a real screenshot with the line it proves and who ran it, or a public reason there is none, at most
 * two sentences.
 */
export type ProofSlot =
  | {
      readonly kind: "screenshot";
      /** The one line saying what the image proves, rendered above it. At most 25 words. */
      readonly proves: Content;
      readonly image: ImageRun;
      readonly runBy: ProofActor;
    }
  | {
      readonly kind: "reason";
      /**
       * Why there is no screenshot, then optionally where the proof is instead: at most two sentences and 25 words
       * (`PROOF_REASON_SENTENCES`, `./formRules.ts`). The second points at the checks or a linked record, never a
       * test, whose common shapes are refused (`PROOF_IS_TEST_SENTENCE`, `./descriptionWords.ts`).
       */
      readonly reason: Content;
    };

/**
 * Whether this change shows anything on screen: `nothing-on-screen` makes two reason slots read `proof: tests only`
 * (grey) rather than `proof: not run yet` (amber). A screenshot in either slot means `screen-change`.
 */
export type VisualProof = "screen-change" | "nothing-on-screen";

/** One check that was not run, and why — a list item under "Not checked, and why". */
export interface UncheckedItem {
  /** What was not checked, at most 15 words; it may not carry ". " (the item is split there). */
  readonly check: Content;
  /** Why, at most 30 words. */
  readonly why: Content;
}

/**
 * One item of the re-run fold: a command, a long test list, or a short note on how to re-run it. Images and claims
 * are unrepresentable here, because anything a reader could disagree with stays above the fold.
 */
export type RerunItem =
  | { readonly kind: "command"; readonly lang: string; readonly text: string }
  | { readonly kind: "tests"; readonly items: readonly Content[] }
  | { readonly kind: "note"; readonly content: Content };

/**
 * A labelled group of checks, rendered as a dot point with its checks nested under it ("Still refused", "Unchanged").
 */
export interface CheckGroup {
  /** The group's label, a few words with no closing punctuation. */
  readonly label: Content;
  /** One to eight checks, each one sentence. */
  readonly items: readonly Content[];
}

/** The authored body of a C3 pull request. */
export interface PrBody {
  readonly risk: RiskSection;
  readonly problemSeen: ProblemSeen;
  /** What broke, for whom, and what this changes, in plain sentences. At most 70 words. */
  readonly explainer: Content;
  readonly visualProof: VisualProof;
  readonly problemProof: ProofSlot;
  readonly solutionProof: ProofSlot;
  /**
   * Each check with no screenshot, one sentence each, rendered as dot points under the Checks heading: the base
   * group every reader needs. May be empty.
   */
  readonly checks: readonly Content[];
  /** Checks that fall into labelled groups, nested after the base ones. Absent or empty, there are none. */
  readonly checkGroups?: readonly CheckGroup[] | undefined;
  /** May be empty; the section is then absent. */
  readonly notChecked: readonly UncheckedItem[];
  /** May be empty; the fold is then absent. */
  readonly rerun: readonly RerunItem[];
}

/** What a caller fills in: the body plus its title, routing and draft state. */
export interface PrFormDraft extends PrBody {
  /** Single line. */
  readonly title: string;
  readonly target: PrTarget;
  readonly draft: boolean;
}

/**
 * A draft the door has accepted for a write. C3 carries no write stamp — no byte of the body depends on the day it
 * was written — so this is the draft itself; the name stays for the write path's signatures.
 */
export type PrForm = PrFormDraft;

/**
 * A field-level edit to a live C3 body — the surgical-merge primitive.
 *
 * Updating a pull-request description replaces the whole body, so anything the caller did not re-supply would be
 * destroyed. An edit therefore names ONLY what changes; everything else is carried from the form the live body
 * recovers to. Each set field replaces its section whole; `appendChecks` and `appendNotChecked` add after what is
 * there. Naming one field both ways is refused.
 *
 * NO `draft` (REST cannot change it), NO `target` (a different base or head is a different pull request).
 */
export interface PrFormEdit {
  readonly title?: string | undefined;
  readonly risk?: RiskSection | undefined;
  readonly problemSeen?: ProblemSeen | undefined;
  readonly explainer?: Content | undefined;
  readonly visualProof?: VisualProof | undefined;
  readonly problemProof?: ProofSlot | undefined;
  readonly solutionProof?: ProofSlot | undefined;
  readonly checks?: readonly Content[] | undefined;
  readonly checkGroups?: readonly CheckGroup[] | undefined;
  readonly notChecked?: readonly UncheckedItem[] | undefined;
  readonly rerun?: readonly RerunItem[] | undefined;
  readonly appendChecks?: readonly Content[] | undefined;
  readonly appendNotChecked?: readonly UncheckedItem[] | undefined;
}
