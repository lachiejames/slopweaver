/**
 * The fleet briefing's VOCABULARY — the typed pre-image of the page at
 * `skills/supervisor/reference/fleet-briefing-shape.md`.
 *
 * Slopweaver renders these pages from a typed form rather than only gating HTML a session hand-wrote: a typed
 * form is the right tool for this. `src/briefing/check.ts` stays as the READER for a hand-written page; this
 * is the writer's side, and its whole claim is that a wall of text cannot be authored at all rather than
 * being caught after it is.
 *
 * ## The fold is a FIELD, not a place in a string
 *
 * On the hand-written page a card's depth lived inside its `what` cell as a `<details>` a composer had to
 * remember to open and close, and the gate then measured the cell with that element removed. Here the depth
 * is {@link BriefingFold}, its own field, so "above the fold" is a type distinction rather than a parsing
 * one: every cap in `../../briefing/caps.ts` is counted over fields that CANNOT contain a fold, and the fold
 * is uncapped because nothing forces a reader through it.
 *
 * That is the same discipline `skills/github/reference/pull-requests.md` puts on a pull-request
 * description, which is the owner's own instruction for this form — outcome above the fold, evidence and
 * provenance folded, a word cap on each cell a reader cannot escape.
 *
 * ## Why a cell is a list of runs and not a string
 *
 * Same reason as `../github/types.ts`: the real page carries `<strong>`, `<code>` and links in nearly every
 * block, so a renderer that escaped a plain string would emit `&lt;strong&gt;` and produce a page the owner
 * does not write. Emphasis is STRUCTURAL and the renderer owns every tag, which closes the injection
 * question for free — a caller supplies text and a kind, never markup, so it can never emit a `</details>`
 * that would move its own words above the fold.
 */

// The one import this file carries. `held` is the proposal queue's own vocabulary
// (`../../knowledge/voice/types.ts`), and a second copy of it here would be a page that could describe a
// hold the queue cannot record.
import type { HandChecklistItem } from "../../hand/checklist.js";
import type { BeliefHold } from "../../knowledge/voice/types.js";
import type { CodeOwnerSlice } from "../../review/codeOwnerSlice.js";
import type { WaitingTier } from "../../waiting/rank.js";

/**
 * One run of cell content. The renderer owns every tag; the caller supplies text and a kind.
 *
 * The set is exactly what the live page uses — plain text, `<strong>`, `<code>` and a link — rather than a
 * general markup vocabulary nobody needs.
 */
export type BriefingInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly url: string }
  | { readonly kind: "anchor"; readonly text: string; readonly target: BriefingAnchorTarget };

/**
 * An id a run may jump to, which is the progressive-disclosure move the one-index page needs.
 *
 * The briefing is meant to be the single place the owner looks: a couple of artifacts at most, and ideally
 * one place generally. A page that is the index of everything is a page a card has to be able to point DOWN
 * into — react now on the thing, and the detail is further down the same page rather than behind a second
 * link. The target is a plain string rather than a closed union because {@link BriefingSection} may mint its
 * own; `./schema.ts` refuses an anchor whose target no section on THIS page defines, which is the check a
 * union could not make.
 */
type BriefingAnchorTarget = string;

/**
 * The ids the renderer always emits, one per fixed section, in page order.
 *
 * A section that is conditionally on the page (`your-list` without a list, `awaiting` with nothing awaiting)
 * contributes its id only when it renders — `./schema.ts` computes the live set per form, so an anchor into
 * a section this page does not carry is refused rather than rendering as a link that scrolls nowhere.
 */
export const YOUR_LIST_ID = "your-list";
/** The react-now block's own id, so a row further down can point back up at the cards. */
export const REACT_NOW_ID = "react-now";
/** The team-facing grouping's own id — the cards whose work a colleague is on the other end of. */
export const TEAM_FACING_ID = "react-now-team";
/** The me-facing grouping's own id — the cards nobody but the owner sees the work of. */
export const ME_FACING_ID = "react-now-me";
/** The alignment line's id. */
export const ALIGNMENT_ID = "alignment";
/** The recent block's id. */
export const RECENT_ID = "recent";
/**
 * The role a {@link BriefingQuotedNote}'s own fold carries, so the plain-wording gate can skip its contents.
 *
 * NOT one of {@link FIXED_SECTION_IDS}: those are the ids an anchor may point at and a composed section may
 * not mint, and this is stamped on a `<details>` INSIDE a note rather than on a section. It is a
 * `data-section` role for the reason {@link YOUR_LIST_ID} is one — `../../briefing/sectionQualityHtml.ts`
 * reads roles off the rendered page and has no other way to tell whose words a fold holds.
 */
export const QUOTED_NOTE_ID = "quoted";

/**
 * The summary on the alignment section's intake fold.
 *
 * The RENDERER's line, never the composer's, exactly like the react-now grouping contract lines: this fold
 * is what a page states about turns the owner typed that nothing on the board witnesses, and a composer who
 * could write the summary could soften it into something a reader skips.
 *
 * It lives here rather than in `./render.ts` because `./sectionQuality.ts` projects the same fold out of the
 * FORM and both halves have to word it identically — a summary spelled twice is the two halves of this gate
 * disagreeing about which disclosure level a sentence sits at.
 */
export const INTAKE_SUMMARY = "owner intake — every turn the owner typed, and whether a row holds it";

/**
 * The class the LEDE carries beside `sub`, so the reader can tell it from every other `p.sub` on the page.
 *
 * The page carries a `p.sub` under each react-now grouping heading, under the ranked index and under the
 * owner's list, all of them the renderer's own contract lines. The plain-wording lede cap has to land on the
 * lede and on nothing else, and a rule that took "the first `p.sub`" would move the moment a heading did.
 */
export const LEDE_CLASS = "lede";

/**
 * The name both halves of the gate print for the `recent` section.
 *
 * The heading's own words rather than the fold's summary, which counts the landings and so would name the
 * same section differently on every page.
 */
export const RECENT_SECTION_NAME = '"done since you last looked"';
/** The ranked open-artifact index's own id, inside the react-now block. */
export const OPEN_ARTIFACTS_ID = "react-now-artifacts";
/** The waiting grouping's own id — the cards that wait on a session and are not the owner's to answer yet. */
export const WAITING_ID = "react-now-waiting";
/** The atlas-and-corpus freshness section's own id. */
export const FRESHNESS_SECTION_ID = "freshness";
/** The "Nothing stale" section's own id — everything the owner owns, moving, waiting on a named person, or asking them. */
export const NOTHING_STALE_SECTION_ID = "nothing-stale";

/** The autonomy ledger section's own id — what was done for the owner under graduated autonomy, and why. */
export const AUTONOMY_ID = "autonomy-ledger";

/**
 * The hand-steps section's own id — every step waiting on the owner's own hands, with the command to paste.
 *
 * Named for what the rows ARE rather than for the register they come from: `hand-steps` would read on the
 * page as a category of work, while the section is a list of things only the owner can do.
 */
export const HAND_STEPS_ID = "waiting-on-you";
/**
 * The correction block's own id — the proposed beliefs the owner is being asked to mark.
 *
 * Named `owner-beliefs` rather than `corrections` because `../../briefing/corrections.ts` and
 * `./corrections.ts` already own that word on this page, and they mean something else entirely: the marks
 * saying what CHANGED between two published versions of the briefing. Two sections called corrections would
 * make every one of those comments ambiguous.
 */
export const OWNER_BELIEFS_ID = "owner-beliefs";

/**
 * The quiz block's own id — the one question this sweep is asking the owner.
 */
export const QUIZ_ID = "quiz";

/** Every fixed section id, so a composer's own section cannot collide with one. */
export const FIXED_SECTION_IDS: readonly string[] = [
  YOUR_LIST_ID,
  REACT_NOW_ID,
  TEAM_FACING_ID,
  ME_FACING_ID,
  OPEN_ARTIFACTS_ID,
  WAITING_ID,
  ALIGNMENT_ID,
  AUTONOMY_ID,
  HAND_STEPS_ID,
  OWNER_BELIEFS_ID,
  QUIZ_ID,
  RECENT_ID,
  FRESHNESS_SECTION_ID,
  NOTHING_STALE_SECTION_ID,
];

/** The content of one cell: an ordered list of runs, never empty. */
export type BriefingContent = readonly BriefingInline[];

/**
 * One image, embedded as a `data:` URI rather than a path on the composer's own machine.
 *
 * A react-now card carrying a drafted Slack post with three screenshots must render them INSIDE the card so
 * it looks like the Slack post would if sent, never a file path the owner has to go find. A composer may
 * still WRITE `path` in the JSON form they fill in — `../../briefing/images.ts` resolves every `path` into
 * `data` before the form ever reaches {@link briefingFormSchema}, so this type (and the schema, and the
 * renderer) only ever sees the resolved `data:image/(png|jpeg|gif|webp);base64,…` string. Two input
 * spellings, one typed shape, for the same reason a resolved bare reference becomes a `link` run rather
 * than the schema learning to parse a bare number itself.
 */
interface BriefingImageBlock {
  readonly kind: "image";
  /** Alt text for a reader who cannot see the image. Required — there is no silent fallback. */
  readonly alt: string;
  readonly caption?: string | undefined;
  readonly data: string;
}

/**
 * One block inside a fold: a paragraph, a real list, an image, a draft, something to paste, or a fold of its
 * own.
 *
 * A list is a block kind rather than prose a composer numbers by hand, because the page budget refuses more
 * than `BLOCK_MAX_ENUMERATORS` inline numbers in one paragraph and the rule behind that cap is that a
 * numbered set of items IS a list. Making it representable only as a list is the version of that rule a
 * composer cannot get wrong. An image is the same idea applied to a screenshot: the only way to put one on
 * the page, so it can never arrive as a bare path typed into a text run. A paste block is that idea applied
 * to a value the owner has to get into some other box — see {@link BriefingPasteBlock}.
 *
 * The `fold` member is a readability mechanism rather than a convenience: a card whose one fold held fifteen
 * ranked items read as a wall. Without it, a composer with more depth than one fold could hold had exactly
 * one representable shape, a longer paragraph, so the caps pushed depth INTO folds and the folds had no
 * second level to push it into. Nesting is what makes progressive disclosure recursive instead of one deep.
 */
export type BriefingBlock =
  | { readonly kind: "para"; readonly content: BriefingContent }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly BriefingContent[] }
  | { readonly kind: "fold"; readonly fold: BriefingFold }
  | BriefingImageBlock
  | BriefingDraftBlock
  | BriefingPasteBlock;

/**
 * A value the owner has to move somewhere else verbatim, rendered so that moving it is one click.
 *
 * The motivating card asked the owner to paste 25 OAuth scope URIs into the Google Admin console, where a
 * simple copy button was the right affordance: the text was hard to read and the overflow was ridiculous.
 *
 * MEASURED on that card (card 2 of the me-facing grouping): its fold carried 26 `code` runs inside one
 * paragraph, the last of them the comma-joined line the owner actually had to paste, 1,661 bytes long. A
 * `code` run is `white-space: nowrap` in the page chrome, so that one run made the whole page body scroll
 * sideways, and nothing on the page offered to copy it — the owner had to select 1,661 characters of
 * wrapped-nowhere monospace by hand.
 *
 * Both halves of that are shape rather than styling, which is why this is a block kind and not advice:
 *
 * - **`text` is one opaque string, not a run vocabulary.** It is the bytes the owner pastes, so nothing here
 *   may split, emphasise or re-space it — the same discipline {@link BriefingDraftBlock} already carries for
 *   a surface's own words. A composer who had to assemble it from runs is a composer who can get a separator
 *   wrong, which is exactly how the comma-joined line came to be typed twice.
 * - **`label` names what it is**, because the block is a `<pre>` a reader meets with no sentence around it.
 *   The renderer builds the copy control; a composer supplies no markup and no button text.
 *
 * A paste block always sits inside a fold ({@link BriefingFold}), so it never spends a word of anyone's
 * above-the-fold budget.
 */
export interface BriefingPasteBlock {
  readonly kind: "paste";
  /** What this block hands the owner, as they would name it, such as the scope list. */
  readonly label: string;
  /** The exact bytes to copy. Rendered verbatim, wrapped, and never re-spaced. */
  readonly text: string;
}

/**
 * Every surface a drafted piece of outbound work can be shown as. One member today — the react-now card's
 * own worked example, a drafted Slack post sent as the owner — with room to grow toward the other two: a
 * Notion body, a pull-request description.
 */
export type BriefingDraftSurface = "slack-as-me";

/**
 * A draft the owner is being asked to approve, rendered the way its own surface would show it — never a
 * file path to go find.
 *
 * A draft belongs INSIDE the card, rendered as its surface renders it, exactly as an image does. `text` is
 * plain — no run vocabulary — because it IS the surface's own words, not prose this renderer composes;
 * `./render.ts` owns only how it is framed, never what it says.
 */
interface BriefingDraftBlock {
  readonly kind: "draft";
  readonly surface: BriefingDraftSurface;
  readonly text: string;
}

/**
 * A collapsed region: the summary a reader clicks, and the blocks behind it.
 *
 * Held to a SHAPE, and to no length. A composed fold carries at most `../../briefing/caps.ts`'s
 * `FOLD_MAX_BLOCKS`, nests at most `FOLD_NEST_MAX_DEPTH` deep, and reads text before images; the prose
 * inside those blocks is left alone. A QUOTED fold — a projection of the owner's own recorded question —
 * carries not even the block count, for the reason `./vocabulary.ts`'s `quotedFoldSchema` gives.
 *
 * Per-cell word and sentence caps stood briefly and came off: 88% of what they refused was the folded
 * archive nobody reads unfolded, and a per-cell cap optimises for a counter rather than for a reader.
 * `../../briefing/caps.ts` carries both measurements, so neither half of that is re-derived from scratch.
 */
export interface BriefingFold {
  readonly summary: string;
  readonly blocks: readonly BriefingBlock[];
}

/**
 * What a card is ABOUT, named the way a row must name one: its key with its own title beside it, linked, so
 * the owner never opens the link to find out what the card concerns.
 *
 * ## Why it is its own field and not the first run of `what`
 *
 * Because the title is the SUBJECT's words, not the composer's, and the two are held to different rules. A
 * card's `dl.f` cells go through the voice pass (`../voice/aboveFold.ts`), which refuses a colon introducing
 * a list and a sentence over one breath — reasonable rules for prose a session wrote and wrong ones for a
 * pull-request title somebody else typed, which is routinely `feat: a, b and c`. A page rendering 36 cards
 * would then be refused by one colleague's title.
 *
 * So it renders as the `div.bg` line `../../briefing/reactNowCard.ts` never reads as a field, exactly as a
 * row of the owner's list already carries its own title. It IS charged against the card's above-the-fold
 * word budget, because a reader meets it.
 *
 * `text` carries the whole label — key and title together — inside the link, which is also what keeps a
 * title carrying its own parenthesised number from reaching the page as a bare reference.
 */
export interface BriefingCardSubject {
  /** The visible label: the key, then the subject's own title — or `no page …` when there is no page. */
  readonly text: string;
  /**
   * The subject's own page, ABSENT when the subject has none.
   *
   * Optional rather than required: a card whose subject had no page of its own used to have to invent a
   * url, and what it reached for was the briefing page itself — so the absence now has a representation,
   * and `../../briefing/cardSubject.ts` refuses a url pointing back at this page. A url-less subject's
   * `text` must begin `no page`, and its card owes a `detail` fold.
   */
  readonly url?: string | undefined;
}

/** One lettered option on a react-now card. The letter is STRUCTURE; the text is one sentence of prose. */
export interface BriefingOption {
  readonly letter: string;
  readonly text: string;
}

/**
 * Whether a card is the owner's to answer NOW, or waits on a session that has not finished.
 *
 * ## The rule
 *
 * A card that says "react to this one" but, on reading, says it is still working and not ready makes the
 * owner squint to tell whether it is ready, while many of the cards underneath it probably are. So a card
 * that is not ready is not put at the top.
 *
 * ## A discriminated union, because a waiting card owes two facts
 *
 * A flat `{ ready: boolean, session?, event? }` would admit a card claiming to wait on nothing — the same
 * defect {@link BriefingArtifactValidity} refuses one field over. A card that is not answerable yet has to
 * say WHOSE work it waits on and WHAT event ends the wait, because those two are what let the owner decide
 * whether to wait or to intervene. `session` names the worktree, handoff or workspace doing the work;
 * `event` is the one thing that has to happen, in the owner's vocabulary rather than the fleet's.
 *
 * ## The ORDER is structure, not a composer's ordering
 *
 * `./render.ts` partitions the block by this field: every ready card renders first, in the two groupings'
 * own order, and every waiting card renders below them under one heading of its own. That is the same call
 * {@link BriefingReactNow} makes about the groupings — *ready above waiting* is then something the renderer
 * cannot forget rather than a rule a composer has to remember. `../../briefing/reactNowCard.ts` refuses a
 * page arranged the other way, which is what keeps a hand-written page honest.
 */
export type BriefingCardReadiness =
  | { readonly state: "ready" }
  | {
      readonly state: "waiting";
      /** Whose work it waits on — a worktree, handoff or workspace the owner could go and look at. */
      readonly session: string;
      /** The one thing that has to happen before the card is the owner's to answer. */
      readonly event: string;
    };

/**
 * WHERE a card's premise was read from, and when — the field that gives a card an age.
 *
 * A card served a day old reads as stale, and the owner has been served stale cards on the react-now block
 * before. Without this field, a card had nowhere to record when the world it describes was last looked at,
 * and `../../briefing/openPageCards.ts` had a ranked page's `landedIso` in its hand and dropped it.
 *
 * Three arms rather than one instant, because the three sources answer different questions and a single
 * field would have to lie about two of them. An artifact carries a landing AND a last-moved instant — the
 * first is the age the owner recognises, the second is what a ruling lapses against
 * (`../../briefing/openArtifacts.ts`). A pull request has neither, only the instant its state was read. A
 * hand-written card has whatever instant its composer last checked the world at. The age is computed from
 * whichever of those the arm names; `../../briefing/cardPremise.ts` owns that choice so the renderer and the
 * gate cannot disagree about it.
 */
export type BriefingCardPremise =
  | {
      readonly kind: "artifact";
      /** When the page first landed in front of the owner — the instant its age is measured from. */
      readonly landedIso: string;
      /** When it last moved. Absent for a page nobody has republished. */
      readonly updatedIso?: string | undefined;
    }
  | {
      readonly kind: "pull-request";
      /** When the pull request's state was read. Deliberately not called a landing. */
      readonly observedIso: string;
    }
  | {
      readonly kind: "composed";
      /** When the composer last checked that the world this card describes still exists. */
      readonly readIso: string;
    };

/**
 * One react-now card: everything the owner has to read to decide, and one optional fold for the rest.
 *
 * `question` is a plain string rather than {@link BriefingContent} because the renderer numbers it and the
 * gate reads it as one sentence — emphasis inside a question buys nothing and would let a composer smuggle
 * a second clause past the sentence count as markup.
 */
export interface BriefingCard {
  readonly question: string;
  readonly what: BriefingContent;
  readonly whyYou: BriefingContent;
  readonly options: readonly BriefingOption[];
  readonly lean: BriefingContent;
  readonly ifSilent: BriefingContent;
  /** What the card is about, named with its own title. See {@link BriefingCardSubject}. */
  readonly subject?: BriefingCardSubject | undefined;
  /** The card's depth, rendered inside the `what` cell behind a summary the reader chooses to open. */
  readonly detail?: BriefingFold | undefined;
  /** Whether the card is the owner's to answer now. See {@link BriefingCardReadiness}. */
  readonly readiness: BriefingCardReadiness;
  /** When the world this card describes was last read. See {@link BriefingCardPremise}. */
  readonly premise: BriefingCardPremise;
}

/**
 * The react-now block's two groupings — the AUDIENCE SPLIT, carried by the type rather than by a convention.
 *
 * The separate ranked-list artifact is retired and everything it did is folded into this block: react-now
 * has two groupings, team-facing on top, me-facing below.
 *
 * **The split is AUDIENCE, and only audience.**
 *
 * - **`teamFacing`** reaches a person other than the owner — a colleague's review, a Slack ask, a shared
 *   branch.
 * - **`meFacing`** reaches nobody else: the owner's own tooling, their own pages. It carries one extra
 *   refusal the other grouping does not: it may not end by putting the last step in the owner's hands — see
 *   `../../briefing/ownHandAction.ts`.
 *
 * The split does NOT declare autonomy: the fleet progresses the owner's own team-facing pull requests
 * without waiting on them, and what needs their answer is stated per card. Do not derive permission,
 * completion or urgency from which array a card is in; `readiness` says whether a card is answerable and
 * the card's own words say what it wants.
 *
 * ## Why two arrays and not one array with an `audience` field
 *
 * Because *team-facing on top* is then structure rather than an ordering a renderer has to remember, and
 * because a card cannot be in neither grouping — the split is total by construction. `./render.ts` renders
 * `teamFacing` first and states each grouping's own contract in words the composer cannot supply, so the
 * audience is on the page the owner reads rather than only in this comment. `./schema.ts` caps the two
 * TOGETHER at `REACT_NOW_MAX_CARDS`, because the thing being bounded is the block the owner scrolls, not
 * either half of it.
 *
 * Both may be empty. That is the honest quiet state the shape reference already calls real, and the
 * renderer still emits the block rather than omitting it.
 */
export interface BriefingReactNow {
  /** Cards whose work a colleague is on the other end of, rendered first. */
  readonly teamFacing: readonly BriefingCard[];
  /** Cards whose work nobody but the owner sees, rendered below the team-facing ones. */
  readonly meFacing: readonly BriefingCard[];
  /**
   * The RANKED INDEX of every open artifact awaiting the owner's reaction, rendered under the two groupings.
   *
   * See {@link BriefingOpenArtifact}. Empty is a real state — no session has a page open on the owner — and
   * the index simply does not render, exactly as an empty grouping does not.
   */
  readonly openArtifacts: readonly BriefingOpenArtifact[];
}

/**
 * Whether an open artifact is still worth the owner's reaction, and if not, what took it out.
 *
 * ## It is DERIVED from the lock-in ledger, never composed
 *
 * A composer may not type "superseded" any more than it may type the eyebrow's freshness instants: a
 * validity mark a composer can write is one that can read as valid on a page the owner's own steer already
 * invalidated, which is the exact failure this whole shape exists to close. `../../briefing/openArtifacts.ts`
 * computes every mark from the rows the owner actually gave, and `./schema.ts` does not care which of the
 * three it receives — what makes the mark trustworthy is that one function produces all of them from one
 * ledger.
 *
 * ## Three marks, because three is what a ruling can do to a page
 *
 * `valid` — nothing on record touches it, or what did has LAPSED because the page moved since the ruling
 * ({@link ../../sessionStart/lockIn.resolutionHolds} decides that, and it is the same lapse the owner's list
 * uses). `partly-ruled` — a ruling still holds, so some of what the page asks is already answered, and the
 * page is worth opening with that in mind rather than cold. `superseded` — the ruling that holds points at
 * ANOTHER page, so this one is finished and the mark says where the live version went.
 */
export type BriefingArtifactValidity =
  | { readonly mark: "valid" }
  | {
      readonly mark: "partly-ruled";
      /** The day of the ruling, so the mark carries its own provenance rather than asserting one. */
      readonly ruledIso: string;
      /** What the ruling amounted to, in the lock-in ledger's own vocabulary. */
      readonly outcome: string;
    }
  | {
      readonly mark: "superseded";
      /** The page that replaced this one, as the owner would recognise it. */
      readonly by: string;
      /** That page's own address, when the ruling recorded one. */
      readonly byUrl?: string | undefined;
    };

/**
 * One open artifact in the ranked react-now index: where it is, what it wants, when it landed, and whether
 * the owner's own later steer has already taken it out.
 *
 * ## The failure it answers
 *
 * Ten to fifteen artifacts get created and opened in different tabs over a couple of hours, and the owner is
 * then unsure which to react to first because earlier steering invalidated some of them. The react-now
 * section points to all of those artifacts, each with a link, so nobody has to guess where to look next.
 *
 * Two separate defects, and this shape answers both. The pages were INVISIBLE — the `awaiting` band caps at
 * {@link ../../briefing/caps.AWAITING_MAX_ITEMS} three, so twelve of fifteen open pages fell into a fold
 * nobody reads. And the visible ones were UNJUDGED — nothing marked a page the owner's own later steer had
 * already settled, so choosing what to open next was guesswork from memory.
 *
 * ## Why `rank` is a field rather than array order
 *
 * The same reason {@link BriefingYourRow} carries one: the index is a PROJECTION of an ordered list, and a
 * page showing 1, 2 and 4 is showing a list nobody ranked. `./schema.ts` refuses a gap, so the number a
 * reader sees is the number the ranking gave it.
 *
 * ## Why `landedIso` is an instant and not a reading of a clock
 *
 * `BriefingArtifactLink.since` is a free string, because the standing band is durable furniture and "since
 * Tuesday" is how the owner reads it. This band is not that: it is a couple of hours of pages and the whole
 * question is which came last, so it carries the instant and `./render.ts` stamps it. Same call the eyebrow
 * makes for the same reason — a freshness claim a composer writes is one that can be wrong.
 */
export interface BriefingOpenArtifact {
  /** Its place in the ranking, from 1, with no gaps. */
  readonly rank: number;
  /** The page's own name, as the owner would recognise it. */
  readonly label: string;
  readonly url: string;
  /** One sentence: what the session that opened it wants from the owner. */
  readonly ask: BriefingContent;
  /** When the page landed in front of the owner, as an instant a clock can parse. */
  readonly landedIso: string;
  /**
   * When the page last moved, when anything has republished it.
   *
   * Carried through the ranking rather than dropped at it, because a card projected from this row needs BOTH
   * instants: `landedIso` is the age the owner recognises and this is what a ruling lapses against. The
   * reading distinguishes them (`../../briefing/openArtifacts.ts`'s `OpenArtifactReading`); dropping this
   * half is half of why a projected card had no age at all.
   */
  readonly updatedIso?: string | undefined;
  /** Whether the owner's own later steer has already taken it out. Derived — see {@link BriefingArtifactValidity}. */
  readonly validity: BriefingArtifactValidity;
}

/**
 * One block below the line: a headline a reader meets, and optionally a fold carrying the rest.
 *
 * The same shape serves the recent block, an earlier-today entry and a history entry, because on the live
 * page all three render as the identical `.need` element with the landed accent. One shape rather than
 * three keeps a cap from meaning different things in different sections.
 *
 * @internal — one arm of {@link BriefingNote}; every caller names the union, never an arm directly.
 */
export interface BriefingComposedNote {
  /** Absent on this arm, which is what makes the two arms discriminable without a note ever spelling `lane`. */
  readonly lane?: undefined;
  readonly headline: BriefingContent;
  readonly detail?: BriefingFold | undefined;
}

/**
 * One note whose FOLD holds RECORDED text — the owner's own words, or another verb's own line — never
 * composed prose.
 *
 * The lane is a discriminator rather than a style, and what it changes is which rules the detail is held to.
 * Every rule it lifts is worded as an instruction to a composer, and a projection has no composer to
 * instruct: the only way to satisfy one over a record is to rewrite the record.
 *
 * **The detail is a quoted fold** (`./vocabulary.ts`'s `quotedFoldSchema`), so the bare-key-link rule, the
 * fold's block count, and the packed-enumeration and truncated-ellipsis refusals do not reach it — the same
 * split `../../briefing/yourList.ts`'s rows already take, for the reason that file gives.
 *
 * **The detail's contents are skipped by the plain-wording gate, the bare-reference scan and the two
 * whole-page prose budgets.** `./render.ts` stamps {@link QUOTED_NOTE_ID} on that fold so every reader of the
 * rendered bytes agrees with the form about which folds hold a record; the owner's own list is already
 * skipped by role for this reason (`../../briefing/sectionQualityHtml.ts`).
 *
 * ## The scope is the RECORD, and everything around it stays gated
 *
 * MEASURED by rendering the live tick ledger through `briefing render --ticks`: thirteen refusals, every one
 * of them a fleet word inside a string some OTHER verb or work item had already written — a handover titled
 * "Finding row …", a watch row's own clause, a recorded ruling using `the tick`. None was a word this
 * projection chose, and each could only have been cleared by editing what was recorded.
 *
 * So this lane exempts the QUOTATION and nothing else. The note's headline and the fold's own summary are
 * composed by the projection and stay held to the plain-wording rule like any other cell, so what a reader
 * meets before opening anything is still judged on how it reads.
 *
 * @internal — one arm of {@link BriefingNote}; every caller names the union, never an arm directly.
 */
export interface BriefingQuotedNote {
  readonly lane: "quoted";
  readonly headline: BriefingContent;
  readonly detail?: BriefingFold | undefined;
}

/** One note below the line: composed by a session, or a quoted projection of the owner's own words. */
export type BriefingNote = BriefingComposedNote | BriefingQuotedNote;

/**
 * One collapsed section below the line: a summary, and the notes inside it.
 *
 * `id` is what an {@link BriefingAnchorTarget} points at, so a react-now card can send the owner to this
 * section's own detail further down the same page rather than to a second artifact. Optional, because most
 * sections are never pointed at; when present it is a slug, and it may not collide with one of
 * {@link FIXED_SECTION_IDS}.
 */
export interface BriefingSection {
  readonly summary: string;
  readonly notes: readonly BriefingNote[];
  readonly id?: string | undefined;
}

/**
 * One row of the OWNER's list: something tasked to them, as `slopweaver session-start` ranked it.
 *
 * ## Why this is typed facts and not composed content
 *
 * session-start is the owner's action queue and the handover board is the FLEET's, and the answer to "look
 * in one place" is ONE VIEW over the two registers rather than one merged register. A view is only honest
 * while nothing composes it — so a row carries the verb's own fields and `../../briefing/yourList.ts` maps
 * them one to one, with `./render.ts` owning the layout. Every other section on this page is prose a
 * supervisor wrote; this one is a projection, and a supervisor who could retype it would be free to
 * disagree with the verb, which is the drift surface this design exists to remove.
 *
 * `where` is a string rather than a URL because the verb's own `where` is not always one — a board row's is
 * `slopweaver handover resume <slug>`, which is a command the owner runs. {@link BriefingYourRow.link}
 * carries the permalink when there is one, and the renderer shows a command as `<code>` instead.
 */
export interface BriefingYourRow {
  /** The item's stable `<source>:<nativeId>` — the value `session-start lock-in --item` takes. */
  readonly identity: string;
  /** The row's 1-based place on the owner's list, as the verb ranked it. */
  readonly rank: number;
  /** The row's own short question, shortened at a word boundary by the verb's own `headline`. */
  readonly headline: BriefingContent;
  /** The person the ask came from, in the verb's own words. */
  readonly who: string;
  /** Where it lives: a permalink when the source has one, otherwise the command that opens it. */
  readonly where: string;
  /** Whether `where` is a URL the renderer may link, rather than a command it must show as code. */
  readonly link: boolean;
  /** When the item last moved by its source's own clock — the `--against` a lock-in row is recorded with. */
  readonly whenIso: string;
  /** The verb's own one-clause explanation of the rank. */
  readonly why: string;
  readonly score: number;
  /** Whether the action on this row is to CLOSE something rather than to do it. */
  readonly closing: boolean;
  /** The subject's own title, when its source names one. */
  readonly title?: string | undefined;
  /**
   * The owner's code-owner share of the one pull request a review ask names, shown directly under the headline. Only a
   * Slack ask carries one, and a Slack ask carries no title, so the line takes the place a title would hold.
   */
  readonly codeOwnerSlice?: CodeOwnerSlice | undefined;
  /** The whole recorded question and the lock-in affordance, folded. */
  readonly detail?: BriefingFold | undefined;
}

/**
 * The OWNER's list: the top rows of their own action queue, and an honest count of what is not shown.
 *
 * `notShown` is the field that keeps this a view rather than a truncation. A real list can run to dozens of
 * ranked rows and the page shows `YOUR_LIST_MAX_ROWS` of them, so a page that said nothing about the
 * remainder would read as "this is everything" — which is the failure `../../sessionStart/reconcile.ts`
 * already refuses to commit when it says `gone` never means `done`.
 */
export interface BriefingYourList {
  /** How the list was produced, stated so a reader can reproduce it — the verb, its flags and its instant. */
  readonly source: string;
  /**
   * When the session-start run behind the list read the world: the list's OWN age, which its section
   * summary states. Never the page's clock. A list a failed run left a day old is one stale half of a page
   * whose cards were read minutes ago, and the eyebrow's red clause names that half.
   */
  readonly readIso: string;
  readonly rows: readonly BriefingYourRow[];
  /** How many ranked rows this page is not showing. Zero when it shows all of them. */
  readonly notShown: number;
  /**
   * What the run behind the list skipped at its `--deadline` (`../../sessionStart/deadline.ts`) — a leg, or the
   * live re-read — present only when it skipped something. The section summary names it, so a list cut short
   * under load never reads as the whole list just because it is fresh.
   */
  readonly cutShort?: readonly string[] | undefined;
}

/**
 * One other artifact holding something for the owner, and what is waiting for them there.
 *
 * The briefing directs the owner to those artifacts and says react now when there is something to be done on
 * another artifact. So `pending` is not decoration — `./render.ts` turns a pending entry into a directive
 * line INSIDE the react-now block, which is the one place on this page the owner is already reading, and
 * the react-now block can no longer claim nothing is open while one of these is.
 *
 * `waitingOn` is required on every entry, pending or not. A standing link with nothing said about it is a
 * bookmark, and a bookmark on this page is the link farm {@link AWAITING_MAX_ITEMS} exists to refuse.
 */
export interface BriefingArtifactLink {
  /** The artifact's own name, as the owner would recognise it. */
  readonly label: string;
  readonly url: string;
  /** One sentence: what is waiting for the owner there. */
  readonly waitingOn: BriefingContent;
  /** Whether something there needs the owner's reaction NOW, which promotes it to a directive above the line. */
  readonly pending: boolean;
  /** Since when it has been waiting, as a reading of a clock rather than an instant. */
  readonly since?: string | undefined;
}

/**
 * The header eyebrow's facts, which are the page's staleness signal (rule 7 of the supervisor contract).
 *
 * ## The two instants are FIELDS a verb fills, not a sentence a composer writes
 *
 * `lastSweep` was once a free string — the eyebrow stated freshness the way the owner reads it and a
 * composer supplied the words. That is the shape the owner stopped trusting: having to ask whether the
 * artifact being read is actually up to date hurts trust in the very thing they react to. A freshness claim
 * a composer can write is one that can read as current on a stale page.
 *
 * So the eyebrow carries the same two ISO fields the retired ranked-list page carried, stamped through
 * `./stamp.ts`, and `./schema.ts` refuses a form that writes either. They are two different facts and the
 * page states both, because conflating them cannot say the thing that matters: a page rendered a minute ago
 * over a pass recorded four hours ago is stale in the only sense that counts.
 *
 * `refreshedIso` is the recorded pass behind the page, never a snapshot one half of it was built from. The
 * owner's list run is a snapshot: when session-start failed on GitHub its file stayed a day old, the eyebrow
 * inherited that day, and every card read after it was refused as dated in the future. A snapshot states
 * its own age in its own section and, past the ceiling, in the eyebrow's red clause.
 */
export interface BriefingHeader {
  readonly workspace: string;
  readonly handoff: string;
  readonly model: string;
  readonly pinnedAt: string;
  /** When the newest recorded pass behind this page was finalised, or this render's instant with none. */
  readonly refreshedIso: string;
  /** When this page was rendered, and so became ready for the owner to read. */
  readonly readyIso: string;
  /** Whether the supervisor is in sleep mode, which the eyebrow states rather than implies. */
  readonly sleeping: boolean;
  /** The one line under the title, saying how many things need the owner's word. */
  readonly lede: BriefingContent;
  /**
   * Every half of this page whose snapshot was past the ceiling, stated in the eyebrow in red.
   *
   * Absent on a page every snapshot of which was fresh, which is the ordinary case and carries no clause at
   * all. Present only when `briefing render`'s stale-snapshot hatch was taken: without it the run refuses
   * and there is no page, so this field is what stops the override from making the staleness invisible.
   *
   * INJECTED, exactly like {@link BriefingHeader.refreshedIso} — a composer that could write its own
   * staleness verdict is a composer that can claim a day-old section is current, which is the whole defect.
   */
  readonly staleSnapshots?: readonly BriefingStaleSnapshot[] | undefined;
}

/**
 * One stale half of the page, as the eyebrow states it.
 *
 * `label` is the owner's word for the section (`your list`, `open pages`) and never the flag that supplied it
 * or the path it came from: a path under a home directory is what the hygiene gate keeps off an outbound
 * surface, and the flag means nothing to the reader. The terminal refusal carries both — see
 * `../../cli/staleSnapshotDoor.ts`.
 */
export interface BriefingStaleSnapshot {
  readonly label: string;
  /** How far past the snapshot this render's clock is, in milliseconds. */
  readonly ageMs: number;
}

/**
 * The alignment line: what the fleet is actually working, set against what the board says is most urgent.
 *
 * REQUIRED on every page, and that requirement is the mechanical fix for work in flight drifting from what
 * the owner wants done. The rule: when the same feedback comes up multiple times it is time for a
 * mechanical fix. An instruction telling the sweep to check does not close it, because a session that must
 * remember will stop remembering and nothing will notice. Making this field non-optional means the sweep
 * cannot publish a briefing at all without stating the comparison — the forcing is at the door rather than
 * in a skill.
 *
 * `headline` is generated by `../../handover/reconcile.ts` rather than composed, and is capped by
 * `../../briefing/caps.ts`'s `ALIGNMENT_MAX_WORDS` because a composer may still replace it. `detail` is the
 * fold, uncapped like every other fold, holding which session is on which row.
 *
 * ## Why the owner-intake sentence is a FIELD of its own
 *
 * `intake` is the other half of `slopweaver handover reconcile --json` — its `intakeClause`, saying how many
 * turns the owner typed into the supervisor chain nothing on the board witnesses. It was once appended to
 * `headline`, and the two halves of this gate then contradicted each other: MEASURED with the maximal
 * report of each, the reconciliation's own sentence was then 50 words and the intake sentence 44 across two
 * when it discloses a coverage gap, so the joined line ran to 94 words and 3 sentences against caps of 55 and 2.
 * The sweep contract said that generated line goes into this field VERBATIM and the render REFUSED it, so
 * the only way to publish was to rewrite a generated sentence by hand — which is what a sweep did.
 *
 * It is REQUIRED for the same reason `headline` is: the forcing is at the door, so a page cannot state what
 * the fleet is working while staying silent about what the owner said that nobody wrote down. It is
 * rendered inside a fold the RENDERER owns rather than above the line, which is what keeps it out of the
 * capped line — and a composer cannot rename or soften that fold's summary, the same call the react-now
 * grouping contract lines make.
 *
 * **It stays a sibling FIELD even if this cell ever becomes a list of blocks.** Two named fields say two
 * different things — `headline` is what the board computed, `intake` is what the owner typed — and a block
 * list would let a composer reorder or merge them back into the one comma-spliced sentence this split
 * exists to end. The naming is the guarantee; the fold summary alone is not.
 */
interface BriefingAlignment {
  readonly headline: BriefingContent;
  /** The owner-intake sentence, rendered folded — `slopweaver handover reconcile --json`'s `intakeClause`. */
  readonly intake: BriefingContent;
  readonly detail?: BriefingFold | undefined;
}

/**
 * One act taken under graduated autonomy, projected for the page from the register's own row.
 *
 * ## It is a PROJECTION, and the composer cannot write it
 *
 * The same call `{@link BriefingYourList}` and `{@link BriefingOpenArtifact}` make, for the same reason. This
 * section exists so the owner can steer the fleet retroactively; a supervisor free to retype a row could
 * disagree with what the acting session actually recorded, and the row the owner is judging would then be
 * the supervisor's account of an act rather than the act. `briefing render --autonomy-ledger` reads
 * `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl` and `../../briefing/autonomy.ts` maps it one field at a time; a
 * form that writes `autonomy` itself is refused.
 *
 * ## Why the labels are here and the raw fields are too
 *
 * `kindLabel`, `subjectLabel` and `sessionLabel` are DERIVED (`../../autonomy/label.ts`) and are what the
 * visible line reads. `subject`, `bySession` and `actionId` come through untouched, because the fold shows
 * the exact values and the link has to point at the real URL. A projection that kept only the labels would
 * have quietly made the page the authority on what happened.
 *
 * ## A refused act is still an act
 *
 * `kind` carries its own honesty — `press-merge-when-ready-refused` is a real recorded kind — and nothing in
 * the projection or the renderer may present one as a success. `witness` is the authority on what actually
 * happened, which is why it is required rather than optional.
 */
export interface BriefingAutonomyRow {
  /** The register's own id for this act. What the owner names when giving a steer, so it is on the page. */
  readonly actionId: string;
  /** What was done, as words — the kind slug with its separators opened out. */
  readonly kindLabel: string;
  /** The short name of the thing acted on: `owner/repo#number`, a Slack channel and message, or a host path. */
  readonly subjectLabel: string;
  /** The checkable id itself, which is what the line links to. */
  readonly subject: string;
  /** When the act was taken. Stamped by `./render.ts`, never a clock reading a composer wrote. */
  readonly doneIso: string;
  /** The short form of the acting session's name — its workspace when it has one. */
  readonly sessionLabel: string;
  /** The acting session's full name, shown in the fold so the short label costs the owner nothing. */
  readonly bySession: string;
  /**
   * The act in words the OWNER reads, when the row carries one — what was done, to what, and why it mattered.
   *
   * First inside the fold rather than on the visible line, which is a budget fact rather than a ranking: the
   * line is three derived labels and `autonomyRowAboveFoldWords` counts it, so a sentence per act there would
   * spend the page budget every other section shares. Opening the fold is what the owner does to find out
   * what happened, and this is what they should meet when they do.
   */
  readonly said?: string | undefined;
  /** What made it obvious the owner would want it. The FLEET's note, folded beneath the said and uncapped. */
  readonly why: string;
  /** The verb that was run and the line it printed. Folded, rendered as code. */
  readonly witness: string;
  /** The board row it was done on, when the acting session was executing one. */
  readonly run?: string | undefined;
  /** The owner's own latest word on this act, when given. Folded beneath the why it answers. */
  readonly steer?: string | undefined;
}

/**
 * The autonomy ledger section: what the fleet did for the owner under graduated autonomy, newest first.
 *
 * It is not an audit log that happens to be visible — it is a STEERING surface, similar to the react-now
 * page but simpler, showing what the fleet took under graduated autonomy so the owner has the chance to give
 * a retroactive steer. It lives on this page rather than on one of its own because the owner looks at this
 * briefing many times a day.
 *
 * `notShown` is what keeps it a view rather than a truncation, exactly as it is on {@link BriefingYourList}:
 * the register keeps every act forever and the page shows {@link AUTONOMY_MAX_ROWS} of them, so a page
 * silent about the remainder would read as "this is everything the fleet did".
 *
 * Empty is a real, honest state — an install where nothing has been done autonomously — and the section
 * simply does not render, the same call an empty open-artifact index makes.
 */
export interface BriefingAutonomy {
  readonly rows: readonly BriefingAutonomyRow[];
  /** How many recorded acts this page is not showing. Zero when it shows all of them. */
  readonly notShown: number;
}

/**
 * One open hand step, projected for the page out of the hand register's own row.
 *
 * ## Why the command is on the PAGE and not only on the floating note
 *
 * A floating macOS note cannot be clicked, copied from or pressed, and a note that says something was copied
 * to the clipboard may not have put it there. The deeper fact is that a note is a PROCESS: it dies with a
 * logout, it can land off a display that changed shape, and a build landed after it was drawn cannot reach
 * it. A page is bytes. So the command the owner has to run reaches them on both surfaces, and the page is
 * the one that cannot go stale in a way they have no way to notice.
 *
 * ## It is a PROJECTION, and the composer cannot write it
 *
 * The same call {@link BriefingAutonomy} and {@link BriefingYourList} make. A composer free to retype the
 * command would be a composer who can get a flag wrong on a line the owner is being asked to paste into a
 * shell — and the whole value here is that the bytes on the page are the bytes the register holds. Filled by
 * `briefing render --hand-steps`; a form that writes `handSteps` itself is refused.
 *
 * `literal` is OPTIONAL because a step's own shape makes it optional: some steps are a click in a console,
 * not a command. `../../briefing/handSteps.ts` gives those rows no paste block rather than pasting the
 * witness — an empty `<pre>` offering to copy the verb that SETTLES the step would be handing the owner the
 * wrong command at the moment they are looking for the right one.
 */
export interface BriefingHandStepRow {
  /** The step's own id, which is what `slopweaver hand done <id>` names. */
  readonly id: string;
  /** One sentence: what only the owner's hands can do. */
  readonly what: string;
  /** What is waiting on it, in the register's own words. */
  readonly unblocks: string;
  /** When it was posted, so a reader can see how long it has been waiting. */
  readonly postedIso: string;
  /** Where the owner does it, when the step named somewhere — "any terminal", "the GCP console". */
  readonly where?: string | undefined;
  /** A page the owner has to open to do it. */
  readonly url?: string | undefined;
  /** The exact command, when the step carries one. Rendered as a paste block, never re-spaced. */
  readonly literal?: string | undefined;
  /** The script the owner runs through, one line at a time, each command its own paste block (`../../hand/checklist.ts`). */
  readonly checklist?: readonly HandChecklistItem[] | undefined;
  /** How the fleet will know it happened — the verb that settles the step. */
  readonly witness: string;
  /** Where the one ranking of what waits on the owner (`../../waiting/rank.ts`) places it; a check-in is drawn as one. */
  readonly tier: WaitingTier;
}

/**
 * Every open hand step, and an honest count of the ones this page is not showing.
 *
 * Empty is a real and common state — nothing is waiting on the owner's hands — and the section simply does
 * not render, the same call {@link BriefingAutonomy} makes.
 */
export interface BriefingHandSteps {
  readonly rows: readonly BriefingHandStepRow[];
  /** How many open steps this page is not showing. Zero when it shows all of them. */
  readonly notShown: number;
  /**
   * How many register lines could not be read at all, so a step may be open that no row here covers.
   *
   * The whole reason this is a COUNT on the section rather than a refusal of the render: one unparseable
   * line once made every `hand` verb exit 1, and the owner's floating card became uncloseable by any verb
   * while it sat on their screen. A page that refused over the same line would repeat that defect on the
   * surface the owner trusts most. A page that carried the line's absence silently would be worse — it would
   * read as "nothing is waiting on you". So the count is rendered, and the section renders on its strength
   * even with no rows at all.
   */
  readonly unreadable: number;
}

/**
 * One proposed belief of the owner's, projected for the page from the queue's own row.
 *
 * ## It is a PROJECTION, and the composer cannot write it
 *
 * The same call {@link BriefingYourList} and {@link BriefingOpenArtifact} make, and here it is the whole
 * point. This block exists so the owner's own corrections have somewhere to land — the page's words,
 * `"where what you learned gets corrected and kept"`. A supervisor free to retype a row could disagree with
 * the claim the reviewing session actually proposed, and the thing the owner would then be marking is the
 * supervisor's account of a belief rather than the belief. So every field comes from
 * `$SLOPWEAVER_HOME/knowledge/proposals.jsonl` one at a time, `../../briefing/ownerBeliefs.ts` maps it, and
 * `../../cli/commands/briefing/renderCore.ts` refuses a form that writes the section itself.
 *
 * ## Why the QUOTE is carried and not only the claim
 *
 * Because the claim is a session's sentence and the quote is the OWNER's, and the difference is the whole
 * reason a mark of `wrong` is informative. Asked to judge a claim with nothing but the claim in front of
 * them, the owner is judging whether they agree with it today; asked to judge it beside the words it was
 * read out of, they are judging whether the fleet read them correctly, which is what
 * {@link BriefingOwnerBeliefsRow.held} and the three marks are about. The quote sits inside the fold, so it
 * costs nothing until the owner wants it.
 *
 * `wrapped` travels with the row for the reason the queue records it: a turn FILE is something a supervisor
 * wrote around the owner's words, so a quote from one is a span that occurs in the unit rather than a
 * sentence the owner is proven to have said. A block that hid that distinction would invite a correction of
 * a belief nobody established was theirs.
 */
export interface BriefingOwnerBeliefsRow {
  /** The queue's own id for this proposal. What the owner names when answering, so it is on the visible line. */
  readonly proposalId: string;
  /** Which system the claim is about — the register's own domain slug. */
  readonly domain: string;
  /** The belief, in one sentence, as the reviewing session composed it. Never re-worded here. */
  readonly claim: string;
  /** The span of the OWNER's words it was read from. Folded — see the type's own note on why it is carried. */
  readonly quote: string;
  /** How firmly the words showed the owner held it. */
  readonly held: BeliefHold;
  /** Whether the owner's words reached the queue inside something a supervisor wrote around them. */
  readonly wrapped: boolean;
  /** The unit the quote came from, shown in the fold so a reader can go and find the whole thing. */
  readonly unitId: string;
  /** When the session reviewed the unit. Stamped by `./render.ts`, never a clock a composer read. */
  readonly reviewedAtIso: string;
}

/**
 * The correction block: the proposed beliefs waiting on the owner's mark, and an honest count of the rest.
 *
 * A correction block sits below react-now, where each belief takes right, wrong, or partly in a single
 * click. The click is the affordance the page can honestly offer: the briefing is published HTML and cannot
 * call back, so the row carries its id and the three marks as lettered options, and the owner answers the
 * way they answer everything else on this page — a word to the pinned supervisor, which a session records
 * with `slopweaver knowledge answer`.
 *
 * `notShown` is what keeps this a view rather than a truncation, exactly as it is on {@link BriefingYourList}:
 * the queue keeps every open proposal and the page shows {@link OWNER_BELIEFS_MAX_ROWS} of them, so a page
 * silent about the remainder would read as "this is everything the fleet thinks you believe".
 *
 * Empty is a real, honest state — every proposal answered, or none made yet — and the section simply does
 * not render, the same call an empty open-artifact index makes.
 */
export interface BriefingOwnerBeliefs {
  readonly rows: readonly BriefingOwnerBeliefsRow[];
  /** How many open proposals this page is not showing. Zero when it shows all of them. */
  readonly notShown: number;
}

/**
 * The one question this sweep asks the owner, projected for the page from the quiz ledger's own row.
 *
 * The page carries one quiz question per sweep. It runs the OPPOSITE way to {@link BriefingOwnerBeliefs}
 * one field above it — that block asks whether the fleet read the owner's words correctly, and can
 * therefore only surface a belief already stated; this one takes a claim the FLEET learned the hard way and
 * asks whether it is true, which is the only way to reach what the owner believes about something they
 * never thought to mention.
 *
 * ## It is a PROJECTION, and a self-check rather than an invigilated test
 *
 * `briefing render --knowledge-quiz --sweep <tick-id>` reads
 * `$SLOPWEAVER_HOME/knowledge/quiz.jsonl`, and a form that writes `quiz` itself is refused — the question
 * being answered has to be the question the ledger recorded, or the id on the page names nothing.
 *
 * The fleet's own answer is on the page, inside the fold. That is deliberate: the briefing is static HTML
 * the owner can read end to end, and a design that depended on their not opening a fold would be lying about
 * what an artifact is. What the ledger records is what the owner SAID, and the value is the DISAGREEMENT — a
 * claim where their answer and the fleet's verdict come apart is a row worth having on both sides of the
 * register.
 *
 * ## Why the fleet's whole recording travels
 *
 * `fleetVerdict` alone would make the fold a bare yes or no. The owner is being asked to judge a claim, and
 * what makes that judgeable is the EVIDENCE behind the fleet's answer and the command that settles it again —
 * both of which are the register's own fields, carried rather than summarised.
 */
export interface BriefingQuiz {
  /** The ledger's own id for this question. What the owner's answer names, so it is on the visible line. */
  readonly quizId: string;
  /** The register's claim id, shown in the fold so a reader can go and find every recording of it. */
  readonly lessonId: string;
  /** Which system the claim is about. */
  readonly domain: string;
  /** The fleet's claim, verbatim. Never re-worded into a question — the owner judges what was recorded. */
  readonly claim: string;
  /** What the fleet currently believes. Folded — the answer the owner is checking against. */
  readonly fleetVerdict: "confirmed" | "refuted";
  /** What the fleet actually observed. Folded, and uncapped — it is what makes the claim judgeable. */
  readonly fleetEvidence: string;
  /** When the fleet's recording was made. Stamped by `./render.ts`, never a clock a composer read. */
  readonly fleetRecordedAtIso: string;
  /**
   * What it costs when this one is not known, as the register's own tier.
   *
   * Absent for a TRACE, which has no tier by construction: a trace reports where the fleet looked rather
   * than what it concluded, so there is no harm ladder to place it on, and inventing a rung would be the
   * fabricated judgement `../../store/schema/memories.ts` refuses at the database.
   */
  readonly tier?: 1 | 2 | 3 | 4 | undefined;
  /** The question a TRACE's probe was run for. Absent for a lesson. */
  readonly traceQuestion?: string | undefined;
  /** The exact probe a TRACE ran. Absent for a lesson. */
  readonly traceProbe?: string | undefined;
  /** Whether that probe paid or came back empty. Absent for a lesson. */
  readonly traceOutcome?: "paid" | "empty" | undefined;
  /** The command that settles the claim again, when the fleet's row carries one. */
  readonly fleetRepro?: string | undefined;
  /** What the fleet's evidence does NOT establish, when its row carries a caveat. */
  readonly fleetCaveat?: string | undefined;
}

/**
 * The whole page.
 *
 * An EMPTY `reactNow` — both groupings empty — is a real, intentional state that renders as "nothing open
 * above the line right now", per the shape reference. It is not an error, and the renderer never omits the
 * block.
 *
 * ## react-now comes FIRST, and that is a rule rather than a field order
 *
 * `yourList` once rendered above the cards. The rule that replaced it is the retired ranked-list page's own:
 * what went wrong can be useful info, but it should not be more prominent than what the owner is actually
 * supposed to react to. So the react-now block is the first heading on the page and nothing sits above it,
 * which `../../briefing/shape.ts` reads back off the rendered bytes.
 */
export interface BriefingForm {
  readonly header: BriefingHeader;
  /**
   * The OWNER's list, first among the sections and fed by the session-start verb rather than composed.
   *
   * Optional, because a sweep may render before that verb has run and a page that invented the owner's queue
   * would be worse than one that omits it. `briefing render --your-list` is how it is filled.
   */
  readonly yourList?: BriefingYourList | undefined;
  /** The two groupings, team-facing first. See {@link BriefingReactNow} for what the split means. */
  readonly reactNow: BriefingReactNow;
  /**
   * Every other artifact holding something for the owner. May be empty; an entry with `pending` set becomes
   * a directive above the line.
   */
  readonly awaiting: readonly BriefingArtifactLink[];
  /** The forced work-versus-board comparison. Required — see {@link BriefingAlignment}. */
  readonly alignment: BriefingAlignment;
  /**
   * What the fleet did for the owner under graduated autonomy, and why — see {@link BriefingAutonomy}.
   *
   * Filled by `briefing render --autonomy-ledger` from the register, never composed. It carries a DEFAULT
   * rather than being required, for the reason `reactNow.openArtifacts` does: a supervisor mid-sweep on a
   * `form.json` written before this field existed must still be able to render, and a gate that took the
   * briefing away is a gate that made the page worse. The default is an EMPTY section, which renders nothing
   * and claims nothing.
   */
  readonly autonomy: BriefingAutonomy;

  /**
   * Every step waiting on the owner's own hands, each with the exact command to paste — see
   * {@link BriefingHandSteps}.
   *
   * Filled by `briefing render --hand-steps` from the hand register, never composed. It carries a DEFAULT
   * rather than being required, for the reason `autonomy` one field above does: a supervisor mid-sweep on a
   * `form.json` written before this field existed must still be able to render, and a gate that took the
   * briefing away is a gate that made the page worse. The default is an EMPTY section, which renders
   * nothing and claims nothing.
   */
  readonly handSteps: BriefingHandSteps;

  /**
   * What the fleet thinks the OWNER believes, waiting on their mark — see {@link BriefingOwnerBeliefs}.
   *
   * Filled by `briefing render --owner-beliefs` from the proposal queue, never composed. It carries a
   * DEFAULT rather than being required, for the reason `reactNow.openArtifacts` does: a supervisor mid-sweep
   * on a `form.json` written before this field existed must still be able to render, and a gate that took
   * the briefing away is a gate that made the page worse. The default is an EMPTY block, which renders
   * nothing and claims nothing.
   */
  readonly ownerBeliefs: BriefingOwnerBeliefs;
  /**
   * The one question this sweep is asking the owner — see {@link BriefingQuiz}.
   *
   * Filled by `briefing render --knowledge-quiz --sweep <tick-id>` from the quiz ledger, never composed.
   * ABSENT rather than defaulted, unlike `ownerBeliefs` one field above: an empty block there is a real
   * state the projection can express, while "no question this sweep" has no row shape at all — the ledger
   * records that as its own event and the page simply carries nothing.
   */
  readonly quiz?: BriefingQuiz | undefined;
  readonly recent: readonly BriefingNote[];
  /**
   * Every atlas and corpus source, with its cadence and whether it is late — PROJECTED, never composed.
   *
   * A composer may not author it and the schema refuses one who tries: every count in its summary is
   * derived from the roster and the recorded outcomes (`../../briefing/freshness.ts`), and a hand-typed
   * number here would be free to disagree with the schedule it claims to describe — which is the exact
   * failure the section exists to end. Filled by `briefing render --freshness`, absent when the run did not
   * ask for it.
   */
  readonly freshness?: BriefingSection | undefined;
  /**
   * Everything the owner owns across five surfaces, and how much of it is known stale — PROJECTED, never composed.
   *
   * Refused from a composer for the same reason as {@link BriefingForm.freshness}: its leading count is
   * derived from local documents other standing rows wrote (`../../briefing/nothingStale.ts`), and it only
   * REPORTS. Filled by `briefing render --nothing-stale`.
   */
  readonly nothingStale?: BriefingSection | undefined;
  readonly earlierToday?: BriefingSection | undefined;
  readonly history: readonly BriefingSection[];
}
