/**
 * The OPEN-PULL-REQUEST leg: one react-now card per open pull request of the owner's, split into the two
 * groupings, each naming the next step in that pull request's own lifecycle.
 *
 * React-now's scope is progressing ALL of the owner's open pull requests — chasing reviews, fixing CI,
 * unblocking proofs, and giving steers — and it may run to fifty cards while it does. MEASURED: 36 open on
 * the work repository. This is the chase logic's single home. Nothing here waits on a human review by the
 * owner (`AGENTS.md` rule 10): codeowners is the review check, and the owner reads their own team-facing
 * pull requests before they go in front of people.
 *
 * ## It PROJECTS the session-start run, and composes nothing about the act
 *
 * Every act on a card is `../sessionStart/githubLeg.ts`'s own `doneWhen`, carried through. That leg already
 * consumes `../review/reviewState.ts`'s recommendation rather than re-deriving whose move a pull request is
 * from `ci`, `undrafted` and `codeRabbit` — see its module header for the three ways that derivation was
 * already wrong by the time it first shipped — so a second opinion composed here would be the same mistake
 * one layer up. What this module does is presentation: which grouping a pull request belongs in, and how one
 * act becomes a card the owner can answer in one word.
 *
 * That is also why it reads the SESSION-START document rather than `github review-state --json`. The
 * seven answers are upstream of the act; the act is what a card asks about, and it exists exactly once.
 *
 * ## Every open pull request, not the ten that ranked — less what the owner has already settled
 *
 * `ranking.ranked` is the top slice and `ranking.dropped` is everything rule zero suppressed or the ranker
 * cut — a pull request sitting with a colleague is DROPPED from the owner's list by design, and it is precisely the
 * one a chase card exists for. So both arrays are read, which is what makes "all the owner's open pull requests"
 * true rather than "the ones that made the list". What is NOT carded is a pull request the run's own
 * `standing` marks as ruled or in flight — see {@link HELD_BACK_STANDINGS} for the night that bought that
 * rule, and the section below for the stack, which the leg suppresses before this projection sees it.
 *
 * ## Which grouping, decided mechanically
 *
 * The item's own `state` is the recommendation `../review/reviewState.ts` produced. One of its arms means
 * nobody is ever asked to review — `self-merges` (a repository whose sole codeowner is its sole author) —
 * and that is the me-facing grouping. Everything else reaches a colleague and is team-facing. Reading the recommendation is the same
 * read `githubLeg` makes; deciding it from a base branch here would be the re-derivation the leg's own
 * header bans.
 *
 * ## A stacked pull request has no card of its own — the bottom of its stack carries it
 *
 * Nothing in a stack gets a review ask until the bottom pull request lands, one at a time. The leg answers
 * `stacked` for a pull request whose base is not the repository's default branch, and a card for one would
 * put a step in front of the owner that is, by that rule, not a step yet. So the grouping skips it, and the
 * bottom pull request's card carries the whole chain in its fold — the leg's background names every pull
 * request queued behind the bottom, which is where the owner reads the stack.
 *
 * ## Three hazards this module is shaped around, all of them measured on the real gate
 *
 * - **A reference must never reach the page as plain text.** `./bareRef.ts` refuses one, and a card's
 *   `question` is a plain string that cannot carry a link. So the question spells the pull request
 *   `acme-admin 16359`, which is not a reference shape at all, and the linked `owner/repo#number` lives in the
 *   card's subject line and its fold.
 * - **A colleague's pull-request title is not our prose.** It goes in {@link BriefingCardSubject}, which the
 *   voice pass never reads — a title of the ordinary `feat: a, b and c` shape would otherwise refuse the
 *   whole page over one colleague's commit message.
 * - **The act's own tail is a list, or an em dash.** Two arms of `prDoneWhen` end in a colon and a taxonomy
 *   (`… before merging: 5 of 7 rules, owed by …`), which the colon-list rule says to move below the fold;
 *   three more end in an em dash and a gloss, and the operator's private literal rules ban that character
 *   above the fold. So the question carries the act up to {@link ACT_TAIL} and the fold carries it whole.
 *
 * Pure — no I/O, no clock. The caller reads the document; this only ever sees it as parsed JSON.
 */
import { z } from "zod";

import { absentAs } from "#lib/absent.js";
import { err, ok, type Result } from "../lib/result.js";
import type {
  BriefingCard,
  BriefingContent,
  BriefingFold,
  BriefingOption,
  BriefingReactNow,
} from "../outbound/briefing/types.js";
import { LOCK_IN_OUTCOMES, LOCK_IN_REASONS } from "../sessionStart/lockIn.js";
import { type Standing, standingLabel } from "../sessionStart/standing.js";
import { type BriefingError, BriefingErrors } from "./errors.js";
import { splitSentences } from "./text.js";

/**
 * The slice of `session-start --json` this leg reads: both halves of the ranking, and each item's own
 * fields.
 *
 * A slice rather than the whole document, for the reason `./yourList.ts` gives: the verb reports leg counts,
 * movements and limits this leg does not read, and a schema demanding them would refuse a document a later
 * version widened.
 */
const itemSchema = z.object({
  background: z.string().min(1).optional(),
  doneWhen: z.string().min(1),
  nativeId: z.string().min(1),
  repo: z.string().min(1).optional(),
  source: z.string().min(1),
  state: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  whenIso: z.string().min(1),
  where: z.string().min(1),
  who: z.string().min(1),
});

/**
 * Where the run says the row already stands — the same union `../sessionStart/standing.ts` writes, read
 * back so `standingLabel` can say why a card was held back in the ONE set of words that module owns. A
 * standing this build does not know is read as `untouched`, which cards the pull request rather than
 * silently hiding it.
 */
const standingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("untouched") }),
  z.object({
    atIso: z.string().min(1),
    kind: z.literal("ruled"),
    outcome: z.enum(LOCK_IN_OUTCOMES),
    reason: z.enum(LOCK_IN_REASONS).optional(),
  }),
  z.object({
    joinedBy: z.enum(["branch", "anchor"]),
    kind: z.literal("in-flight"),
    sessionKey: z.string().min(1).optional(),
    slug: z.string().min(1),
  }),
]);

const entrySchema = z.object({
  item: itemSchema,
  standing: standingSchema.catch({ kind: "untouched" }).optional(),
});

const sessionStartDocument = z.object({
  ranking: z.object({
    dropped: z.array(entrySchema),
    ranked: z.array(entrySchema),
  }),
});

/**
 * One open pull request, as this leg reads it out of the document.
 *
 * @internal — exported so this module's own tests build a fixture the compiler checks against the slice,
 * rather than a `Record<string, unknown>` that would drift from it silently.
 */
export type OpenPrItem = z.infer<typeof itemSchema>;

/** The source a pull-request item declares. Anything else on the owner's list is somebody else's leg. */
const GITHUB_SOURCE = "github";

/** The recommendation arms that mean nobody is ever asked to review — the me-facing grouping. */
const NOBODY_REVIEWS = new Set(["self-merges"]);

/** The recommendation arm whose card lives on another pull request — the bottom of its stack. */
const CARRIED_BY_STACK_BOTTOM = "stacked";

/** `owner/repo#<number>`, so the leg can spell the same pull request without minting a bare reference. */
const NATIVE_ID = /^(?<owner>[^/\s]+)\/(?<repo>[^#\s]+)#(?<number>\d{1,7})$/;

/** Every `owner/repo#<number>` inside running prose, for {@link plainRefs}. */
const NATIVE_IDS_IN_PROSE = /(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)#(?<number>\d{1,7})/g;

/**
 * How this leg says which pull request a card is about, in a spelling that is not a reference.
 *
 * `acme/acme-admin#<number>` reaches `./bareRef.ts` as a reference it must refuse when it sits in plain
 * text, and a card's `question` is a plain string with no link run available to it. `acme-admin 16359` names
 * the same thing, reads the same way out loud, and matches no pattern in
 * `../outbound/linkify/bareRefs.ts` — so it is safe wherever prose goes, while the real reference stays a
 * link in the subject line and the fold.
 *
 * @param nativeId the item's `owner/repo#number`
 * @returns the plain spelling, or the id unchanged when it is not shaped like one
 *
 * @internal — exported for its own tests; no caller outside this module names it.
 */
export function plainRef({ nativeId }: { nativeId: string }): string {
  const parsed = NATIVE_ID.exec(nativeId);
  const repo = parsed?.groups?.["repo"];
  const number = parsed?.groups?.["number"];
  if (repo === undefined || number === undefined) {
    return nativeId;
  }
  return `${repo} ${number}`;
}

/**
 * Every reference in a sentence, spelled the plain way — not only the card's own.
 *
 * The leg's sentences name OTHER pull requests too: the bottom of a stack lists the five queued behind it,
 * and a stacked row names the bottom it waits on. Replacing only the item's own id left those as bare
 * references in the fold, which is exactly the shape `./bareRef.ts` refuses on the page.
 *
 * @param text the leg's own sentence
 * @returns the sentence with every `owner/repo#number` spelled `repo number`
 */
function plainRefs({ text }: { text: string }): string {
  return text.replaceAll(
    NATIVE_IDS_IN_PROSE,
    (_match, _owner: string, repo: string, number: string) => `${repo} ${number}`,
  );
}

/**
 * Where the act stops being one claim: a colon introducing a taxonomy, or an em dash introducing a gloss.
 *
 * MEASURED on a live sweep of all 34 open pull requests. Both cuts are the gate's own
 * instruction rather than a truncation dressed up:
 *
 * - `prDoneWhen`'s blocked and codeowner arms end in a colon and a list — `… before merging: 5 of 7 rules,
 *   owed by @a @b` — which `../outbound/voice/aboveFold.ts`'s colon-list rule says to move below the fold;
 * - its ask, chase and answered arms end in an em dash and a gloss — `… — nobody has been asked yet` — and
 *   the operator's own private literal rule bans that character in authored prose above the fold. Five of
 *   the 34 cards were refused on it, by name, before this cut existed.
 */
const ACT_TAIL = /[:—]/;

/**
 * The act, shortened to the one claim a question can carry: the reference spelled plainly, and the tail
 * {@link ACT_TAIL} finds left for the fold.
 *
 * The whole sentence is in the card's fold either way, so nothing is lost anywhere on the page.
 *
 * @param doneWhen the leg's own act sentence
 * @param nativeId the item's `owner/repo#number`, replaced with its plain spelling
 * @returns the act, ready to be asked as a question
 *
 * @internal — exported for its own tests; no caller outside this module names it.
 */
export function shortAct({ doneWhen, nativeId }: { doneWhen: string; nativeId: string }): string {
  const plain = plainRefs({ text: doneWhen.replaceAll(nativeId, plainRef({ nativeId })) });
  const tail = ACT_TAIL.exec(plain);
  const cut = tail === null ? plain : plain.slice(0, tail.index);
  return cut
    .replace(/\s+/g, " ")
    .replace(/[.!?,]+$/, "")
    .trim();
}

/**
 * The recommendation the leg recorded, or undefined when this item carries no state at all.
 *
 * Undefined rather than an empty string, because "no state was recorded" and "the state is the empty
 * string" are different facts and only the first can actually happen — `state` is optional on an item, and
 * a card whose state sentence read as a blank would be this module inventing a fact it does not have.
 */
function recommendationOf({ item }: { item: OpenPrItem }): string | undefined {
  const head = item.state?.split(",")[0]?.trim();
  return head === undefined || head.length === 0 ? undefined : head;
}

/** Whether this pull request's next step is on another pull request entirely — the bottom of its stack. */
function carriedByStackBottom({ item }: { item: OpenPrItem }): boolean {
  return recommendationOf({ item }) === CARRIED_BY_STACK_BOTTOM;
}

/** Whether this pull request is one nobody else reviews, which is what puts it in the me-facing grouping. */
function nobodyReviews({ item }: { item: OpenPrItem }): boolean {
  const recommendation = recommendationOf({ item });
  return recommendation !== undefined && NOBODY_REVIEWS.has(recommendation);
}

/**
 * The state sentence, in words rather than in the recommendation's own token.
 *
 * `already-asked` is a fact about the pull request and not a sentence, and a card that printed the token
 * would be asking the owner to hold the vocabulary of a verb they do not run. The map is presentation over
 * `../review/reviewState.ts`'s `AskRecommendation`; an arm it has not learnt yet falls back to the token, so
 * a new recommendation shows up on the page as itself rather than silently reading as one of these.
 */
const STATE_SENTENCE: Readonly<Record<string, string>> = {
  "already-asked": "Someone was asked to review it and has not answered",
  blocked: "Something is stopping it going out for review",
  bump: "The reviewer who was asked has gone quiet",
  conflicting: "It conflicts with its base branch, so it cannot merge as it stands",
  "self-merges": "That repository self-merges, so nobody else reviews it",
  "send-ask": "Nobody has been asked to review it yet",
  stacked: "It sits on another pull request in a stack, so nobody is asked until the bottom lands",
  "still-draft": "It is still a draft",
  unknown: "This run could not tell whether anybody was asked",
};

/** The clause the leg appends when CodeRabbit's green is for an earlier push. */
const STALE_CLAUSE = "CodeRabbit's green is for an earlier push";

/** The state sentence for one recommendation, stated honestly when there is no recommendation to state. */
function stateSentence({ recommendation }: { recommendation: string | undefined }): string {
  if (recommendation === undefined) {
    return "This run recorded no state for it";
  }
  return absentAs({ value: STATE_SENTENCE[recommendation], whenAbsent: `Its state is ${recommendation}` });
}

/** The item's state, split into the recommendation and whatever caveat the leg appended after it. */
function stateParts({ item }: { item: OpenPrItem }): {
  readonly recommendation: string | undefined;
  readonly stale: boolean;
} {
  return { recommendation: recommendationOf({ item }), stale: item.state?.includes("earlier push") === true };
}

/**
 * The `what` cell: what state the pull request is in, and how long it has been there.
 *
 * Two sentences at least, because the form requires two, and never more than three — the third exists only
 * when CodeRabbit's green is stale, which reads green while not being green and is the one caveat worth a
 * reader's attention above the fold.
 */
function whatContent({ item }: { item: OpenPrItem }): BriefingContent {
  const { recommendation, stale } = stateParts({ item });
  const sentence = stateSentence({ recommendation });
  const moved = `It last moved on ${item.whenIso}`;
  const staleTail = stale ? ` ${STALE_CLAUSE}.` : "";
  return [{ kind: "text", text: `${sentence}. ${moved}.${staleTail}` }];
}

/**
 * The `why you` cell: why this pull request is in front of the owner, said in the card's own words.
 *
 * No arm of this cell may say the work is waiting on the owner (`AGENTS.md` rule 10): the fleet rebases,
 * restacks and progresses the owner's own team-facing pull requests itself, so neither arm asks for
 * approval before a send or a force push.
 */
function whyYouContent({ teamFacing, conflicting }: { teamFacing: boolean; conflicting: boolean }): BriefingContent {
  if (conflicting) {
    return [
      {
        kind: "text",
        text: "Nothing can land until it is rebased, and whether the rebased branch still ships what you wanted is yours to say.",
      },
    ];
  }
  // Both arms NAME the warrant rather than describing the situation. A card exists only where the
  // supervisor cannot decide, so `why you` has to say which of the owner's rules conflict or what fact only
  // the owner holds — "it moved without you and this is the report" says neither. A leg that cards EVERY
  // open pull request produces cards for decisions nobody needs the owner for, so each card's wording names
  // its own actual warrant.
  const text = teamFacing
    ? "It reaches a colleague, so whether this is the ask you want made of them is yours to say."
    : "Nobody else reviews this one, so a change of approach is yours to call and nothing else will catch it.";
  return [{ kind: "text", text }];
}

/**
 * Whether this pull request conflicts with its base — the one state that goes ahead of any ask.
 *
 * MEASURED: two of the owner's open pull requests were CONFLICTING on GitHub and both were carded as
 * "land it yourself", because the recommendation read `self-merges` before it ever looked at mergeability.
 * The card hoists it; under rule 10 the rebase itself is the fleet's to do, not the owner's to authorise.
 */
function isConflicting({ item }: { item: OpenPrItem }): boolean {
  return recommendationOf({ item }) === "conflicting";
}

/**
 * The options, which are the same four (or three) on every card of a grouping — deliberately.
 *
 * A card's options are the answers the owner can give in one word, and for a pull request being progressed they do
 * not vary with the pull request: let it run, redirect it, hold it, or stop. Inventing a bespoke fourth
 * option per card would be this module composing judgement it does not have, and it would make fifty cards
 * fifty different vocabularies to read. Under `AGENTS.md` rule 10 option A is a STEER and not a permission
 * grant — silence does not hold the work — which is why it reads the same way on both groupings.
 *
 * No option names the pull request, carries a colon, or puts two capitalised words together — those are the
 * three shapes `../outbound/voice/aboveFold.ts` and `./reactNowCard.ts` refuse in an option body.
 */
const TEAM_FACING_OPTIONS: readonly BriefingOption[] = [
  { letter: "A", text: "Fine, carry on with that step." },
  { letter: "B", text: "No, do something else instead." },
  { letter: "C", text: "Hold it where it is for now." },
  { letter: "D", text: "Close it without finishing the work." },
];

const ME_FACING_OPTIONS: readonly BriefingOption[] = [
  { letter: "A", text: "Fine, keep going." },
  { letter: "B", text: "Change the approach on the next push." },
  { letter: "C", text: "Stop work on this one." },
];

/** The `lean` cell: what happens by default, said as the option letter the owner would otherwise have to work out. */
function leanContent({ teamFacing }: { teamFacing: boolean }): BriefingContent {
  const text = teamFacing
    ? "Option A, unless the step above is the wrong one."
    : "Option A, since nothing here is waiting on you.";
  return [{ kind: "text", text }];
}

/**
 * The `if silent` cell — what happens when the owner says nothing, which is the same on both groupings: the
 * work carries on. A card that said "Nothing is sent and the pull request stays exactly where it is" would
 * claim the owner's silence is a hold. The two arms differ only in what comes back to the owner, not in
 * whether the work moves.
 */
function ifSilentContent({ teamFacing }: { teamFacing: boolean }): BriefingContent {
  const text = teamFacing
    ? "The step goes ahead and this card comes back the next time this page is rebuilt."
    : // "next sweep" is fleet vocabulary, and rule 1 of the card gate refuses it — the owner is being told
      // when the card returns in a word that only means something inside this repository.
      "The work carries on and this card comes back the next time this page is rebuilt.";
  return [{ kind: "text", text }];
}

/**
 * The words the leg's own `who` field is for a pull request nobody has been asked about.
 *
 * MEASURED on a live sweep: the leg fills `who` with `your own pull request` when the
 * item is not sitting with a colleague, and the obvious sentence read _"It sits with your own pull request"_
 * on 20 of the 34 cards. `who` is a PERSON on the arms that name one, and a provenance note on the arms that
 * do not, so a card has to say which rather than treating both as a name.
 */
const SELF_ORIGIN = "your own pull request";

/** Who the pull request is sitting with, and when it last moved, in one sentence that reads either way. */
function sitsWith({ item }: { item: OpenPrItem }): string {
  if (item.who === SELF_ORIGIN) {
    return `Nobody else is sitting on it. It last moved ${item.whenIso}.`;
  }
  return `It sits with ${item.who}, and last moved ${item.whenIso}.`;
}

/** The link label a fold must carry: the key with the subject's own title beside it. */
function subjectLabel({ item }: { item: OpenPrItem }): string {
  return item.title === undefined ? item.nativeId : `${item.nativeId} — ${item.title}`;
}

/**
 * The card's fold: the linked pull request, the whole act sentence, then what the thing is and who it sits
 * with as a bulleted list of one sentence each.
 *
 * The act appears twice on purpose — shortened in the question, whole here. The question has to be one
 * breath and the taxonomy after a colon is what a reader opens the fold for, so cutting it above and keeping
 * it below is the fold doing its job rather than the same words twice.
 *
 * Every reference inside is spelled plainly, so the only resolvable one on the card is the link in this
 * fold's first block — which carries the title beside the key, as the composed-fold rule requires.
 *
 * ## Why every generated sentence is a BULLET rather than the paragraphs it used to be
 *
 * The shape is a fold that reads at a glance: short labelled lines or a bulleted list of at most one
 * sentence each. Nothing in the form requires it; this leg keeps it because a bullet per fact is the
 * readable arrangement for what it emits.
 *
 * That matters most here because nothing upstream bounds these sentences' length. Three of the generator's
 * arms grow with data: `prBackground`'s stack clause names one reference per pull request queued behind the
 * bottom and its requested clause names every reviewer GitHub has out — MEASURED against that leg's own
 * tests, the bottom of a stack of six is **40 words** before the reviewer clause — while `conflictingAct`
 * lists every conflicting path and `answeredAskAct` every codeowner rule still owed. Splitting on the same
 * `SENTENCE_END` `../briefing/text.ts` counts with makes every item exactly one sentence however long the
 * data inside it grows, which is a property of the output rather than a workaround for a gate.
 *
 * The link block stays a paragraph of its own because it is a CITATION: one link, alone, carrying the
 * subject's own title beside its key, which is what the composed fold's bare-key-link rule asks for. A
 * colleague's title is not our prose to shorten, and no cap here would make us.
 */
function cardFold({ item }: { item: OpenPrItem }): BriefingFold {
  const whole = plainRefs({ text: item.doneWhen }).replace(/\s+/g, " ").trim();
  const background =
    item.background === undefined ? "" : plainRefs({ text: item.background }).replace(/\s+/g, " ").trim();
  const facts = [
    ...splitSentences({ text: whole }),
    ...splitSentences({ text: background }),
    ...splitSentences({ text: sitsWith({ item }) }),
  ];
  return {
    blocks: [
      { content: [{ kind: "link", text: subjectLabel({ item }), url: item.where }], kind: "para" },
      { items: facts.map((fact) => [{ kind: "text" as const, text: fact }]), kind: "list", ordered: false },
    ],
    summary: "the whole next step, what it is, and where it lives",
  };
}

/**
 * One open pull request as a react-now card.
 *
 * @param item the pull-request item, as the session-start run recorded it
 * @param teamFacing whether a colleague is on the other end, which decides the options and the card's wording
 * @returns the card
 *
 * @internal — exported for its own tests; no caller outside this module names it.
 */
export function openPrCard({ item, teamFacing }: { item: OpenPrItem; teamFacing: boolean }): BriefingCard {
  return {
    detail: cardFold({ item }),
    ifSilent: ifSilentContent({ teamFacing }),
    lean: leanContent({ teamFacing }),
    options: teamFacing ? TEAM_FACING_OPTIONS : ME_FACING_OPTIONS,
    question: `${shortAct({ doneWhen: item.doneWhen, nativeId: item.nativeId })}?`,
    // THE AGE. `whenIso` is when the run last saw this pull request move, which is the only instant this leg
    // holds — so the premise arm is `pull-request` and names it `observedIso` rather than calling it a
    // landing. A card that cannot say when its world was read is a card the owner has to date by opening
    // the thing it is about.
    premise: { kind: "pull-request" as const, observedIso: item.whenIso },
    // READY, and derived rather than authored. A pull request only reaches this leg once it is OPEN and
    // standing — the standings below are what keep every other one off the page — so the card is about a
    // thing that exists now, not about work a session has yet to finish.
    readiness: { state: "ready" },
    subject: { text: subjectLabel({ item }), url: item.where },
    what: whatContent({ item }),
    whyYou: whyYouContent({ conflicting: isConflicting({ item }), teamFacing }),
  };
}

/**
 * The standings that keep a pull request OFF the page, and why each does.
 *
 * MEASURED: a projection that knows nothing about the owner's rulings re-asks things already ruled on or
 * deferred (seven of eight cards in one run). `briefing-contract.md`
 * rule 6 — a ruled item is REMOVED from above the line the moment it is ruled — is enforced here by reading
 * the run's own `standing`, never by a composer remembering.
 *
 * A STACKED pull request is absent from this set on purpose: `../review/stack.ts` judges the stack against
 * the repository's default branch and the leg suppresses the row before it reaches here, so a second test on
 * a sibling's head would only be a weaker duplicate of it.
 */
const HELD_BACK_STANDINGS: ReadonlySet<string> = new Set(["ruled", "in-flight"]);

/**
 * One pull request the projection held back, with the run's own reason.
 *
 * @internal — surfaced on the verb's diagnostics so a held-back card is countable rather than silent.
 */
export interface HeldBackPullRequest {
  readonly nativeId: string;
  readonly why: string;
}

/**
 * What the projection produced: the two groupings, and every pull request it deliberately left off.
 *
 * @internal — `openPrReactNow`'s return type; callers destructure it rather than annotate with it.
 */
export interface OpenPrProjection {
  /**
   * The two CARD groupings only.
   *
   * `Pick` rather than the whole {@link BriefingReactNow} because this leg projects pull requests, and the
   * block's third field — the ranked open-artifact index — is about pages a session left open on the owner, which
   * no pull-request read can see. A projection typed as the whole block would have had to invent an empty
   * index and then silently overwrite a composed one, which is the exact replace-rather-than-append failure
   * `../cli/commands/briefing/renderCore.ts` already refuses to make with the cards.
   */
  readonly groupings: Pick<BriefingReactNow, "meFacing" | "teamFacing">;
  readonly heldBack: readonly HeldBackPullRequest[];
}

/**
 * The parsed standing as the union `standingLabel` takes, with no optional field carrying an explicit
 * `undefined` — zod's `.optional()` admits one, and the union's own fields are absent-or-present.
 */
function toStanding({ parsed }: { parsed: z.infer<typeof standingSchema> }): Standing {
  switch (parsed.kind) {
    case "ruled":
      return {
        atIso: parsed.atIso,
        kind: "ruled",
        outcome: parsed.outcome,
        ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
      };
    case "in-flight":
      return {
        joinedBy: parsed.joinedBy,
        kind: "in-flight",
        slug: parsed.slug,
        ...(parsed.sessionKey === undefined ? {} : { sessionKey: parsed.sessionKey }),
      };
    case "untouched":
      return parsed;
    default: {
      const unreachable: never = parsed;
      return unreachable;
    }
  }
}

/**
 * The reason a held-back entry carries: the standing's own label, worded once by the run that judged it.
 *
 * Only a standing {@link isHeldBack} accepted reaches here, and `ruled` and `in-flight` both label; the
 * assertion is that guarantee written down rather than an empty string standing in for a defect.
 */
function heldBackWhy({ parsed }: { parsed: z.infer<typeof standingSchema> }): string {
  return standingLabel({ standing: toStanding({ parsed }) })!;
}

/** Whether one entry is a pull request the page must not card, per the run's own standing. */
function isHeldBack({ entry }: { entry: z.infer<typeof entrySchema> }): boolean {
  const standing = entry.standing?.kind;
  return standing !== undefined && HELD_BACK_STANDINGS.has(standing);
}

/**
 * Every open pull request the document carries, ranked and dropped alike, split into cards and held back —
 * less the stacked ones, whose card is the bottom of their stack's.
 */
function openPullRequests({ document }: { document: z.infer<typeof sessionStartDocument> }): {
  readonly items: readonly OpenPrItem[];
  readonly heldBack: readonly HeldBackPullRequest[];
} {
  const seen = new Set<string>();
  const items: OpenPrItem[] = [];
  const heldBack: HeldBackPullRequest[] = [];
  for (const entry of [...document.ranking.ranked, ...document.ranking.dropped]) {
    const { item } = entry;
    if (item.source !== GITHUB_SOURCE || seen.has(item.nativeId) || carriedByStackBottom({ item })) {
      continue;
    }
    seen.add(item.nativeId);
    if (isHeldBack({ entry })) {
      heldBack.push({ nativeId: item.nativeId, why: heldBackWhy({ parsed: entry.standing! }) });
      continue;
    }
    items.push(item);
  }
  return { heldBack, items };
}

/**
 * Project one `session-start --json` document into the react-now block's two groupings.
 *
 * A pull request the run marked `ruled` or `in-flight` is not carded and is named in `heldBack` instead, so
 * the page never re-asks what the owner already answered. A stacked one never reaches here — the leg suppressed it
 * on `../review/stack.ts`'s default-branch test.
 *
 * @param document the parsed `slopweaver session-start --json` output
 * @returns the two groupings and what was held back, or one line per reason the document could not be read
 */
export function openPrReactNow({ document }: { document: unknown }): Result<OpenPrProjection, BriefingError> {
  const parsed = sessionStartDocument.safeParse(document);
  if (!parsed.success) {
    return err(
      BriefingErrors.sessionStartDocumentInvalid({
        issues: parsed.error.issues.map((issue) => {
          const where = issue.path.join(".");
          return `  ${where === "" ? "document" : where}: ${issue.message}`;
        }),
      }),
    );
  }
  const { heldBack, items } = openPullRequests({ document: parsed.data });
  const meFacing = items.filter((item) => nobodyReviews({ item }));
  // A CONFLICTING pull request is team-facing whatever repository it is in, and it goes AHEAD of every review
  // ask, because nothing else on that pull request can happen until it is rebased. The rebase itself is the
  // fleet's own act (`AGENTS.md` rule 10); only the hoist is the card's.
  const conflicting = items.filter((item) => isConflicting({ item }));
  const teamFacing = items.filter((item) => !nobodyReviews({ item }) && !isConflicting({ item }));
  return ok({
    groupings: {
      meFacing: meFacing.map((item) => openPrCard({ item, teamFacing: false })),
      teamFacing: [...conflicting, ...teamFacing].map((item) => openPrCard({ item, teamFacing: true })),
    },
    heldBack,
  });
}
