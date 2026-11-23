/**
 * The whole briefing gate in one pure call: the react-now cards, the page budget, the one-index sections, the
 * bare-reference scan, each card's live pull-request premise, and how to print them.
 *
 * Several halves rather than one because they measure different things — a card's fields, the page around
 * them, the owner's own list and the artifacts the page sends the owner to, every reference sitting in the text as
 * plaintext, and whether the world a card describes still exists — and a composer fixes each differently.
 * One entry point rather than several because a publish step that had to remember to run all of them would
 * eventually run fewer, which is the failure the gate exists to remove.
 *
 * Every half is pure. The freshness half is the only one that needs something no file can supply — what
 * GitHub says about a pull request right now — so it takes that as a VALUE the edge read, rather than
 * reaching for a transport itself. See `./prPremise.ts`.
 */
import type { SilentRow } from "../live/automation/silentRows.js";
import type { PrPremise } from "../live/github/prPremise.js";
import type { ExactVoiceRule } from "../outbound/voice/exactRules.js";
import { type AlignmentCheck, checkAlignment } from "./alignment.js";
import { type AutonomyCheck, checkAutonomy } from "./autonomyCheck.js";
import { type BareRefPageCheck, checkBareRefs } from "./bareRef.js";
import { type BlockedAskCheck, type BlockedAskPremise, checkBlockedAsks, NO_BLOCKED_ASKS } from "./blockedAsks.js";
import { type CorrectionsCheck, checkCorrections } from "./corrections.js";
import { checkFoldResidue, type FoldResidueCheck } from "./draftContent.js";
import { checkOneIndex, type OneIndexCheck } from "./oneIndex.js";
import { checkOwnerBeliefs, type OwnerBeliefsCheck } from "./ownerBeliefsCheck.js";
import { checkPageBudget, type PageBudgetCheck } from "./pageBudget.js";
import { checkPrPremises, NO_PR_PREMISE, type PrPremiseCheck } from "./prPremise.js";
import { checkQuiz, type QuizCheck } from "./quizCheck.js";
import { CARD_FIELD_LABELS, checkReactNowCards, type ReactNowCheck } from "./reactNowCard.js";
import type { SectionQualityCheck } from "./sectionQuality.js";
import { checkBriefingSections } from "./sectionQualityHtml.js";
import { type BriefingShapeCheck, checkBriefingShape } from "./shape.js";
import { checkSilentRows, NO_SILENT_ROWS, type SilentRowCheck } from "./silentRows.js";

/**
 * What checking one fleet-briefing artifact found, card by card, page-wide, section by section, and
 * reference by reference.
 *
 * @internal — the shape {@link checkBriefing} and {@link renderBriefingCheck} share; the CLI edge passes it
 * straight from one to the other.
 */
export interface BriefingCheck {
  readonly alignment: AlignmentCheck;
  /** The autonomy ledger's rows: their act ids, their order and their count — see `./autonomyCheck.ts`. */
  readonly autonomy: AutonomyCheck;
  readonly cards: ReactNowCheck;
  /** Whether the page's computed correction marks still add up — see `./corrections.ts`. */
  readonly corrections: CorrectionsCheck;
  /** The correction block's beliefs: their ids, their marks and their count — see `./ownerBeliefsCheck.ts`. */
  readonly ownerBeliefs: OwnerBeliefsCheck;
  /** The quiz block: one question, its ledger id, and a folded answer — see `./quizCheck.ts`. */
  readonly quiz: QuizCheck;
  readonly page: PageBudgetCheck;
  readonly bareRefs: BareRefPageCheck;
  /** Every bot turn waiting on the owner that react-now does not link. */
  readonly blockedAsks: BlockedAskCheck;
  readonly foldResidue: FoldResidueCheck;
  readonly oneIndex: OneIndexCheck;
  /** Whether each card's pull request is still in the state the card was written for. */
  readonly prPremise: PrPremiseCheck;
  /**
   * How every section OUTSIDE the cards reads: the card gate's plain-wording and ask-framing rules, over the
   * lede, the ranked open-pages index, the alignment line and every collapsed log section.
   */
  readonly sections: SectionQualityCheck;
  /** The ordering, grouping and freshness rules the retired ranked-list page brought with it. */
  readonly shape: BriefingShapeCheck;
  /** Every standing scheduled row that has gone quiet and that react-now does not name. */
  readonly silentRows: SilentRowCheck;
}

/** The empty bare-reference result — what {@link checkBriefing} returns when `applyBareRefs` is false. */
const NO_BARE_REFS: BareRefPageCheck = { defects: [] };

/**
 * Check one fleet-briefing artifact against every rule the gate owns.
 *
 * @param html the whole artifact file
 * @param rules the operator's private exact voice rules, empty when none are configured
 * @param applyVoice whether the packing and voice pass runs at all; the caps never move
 * @param applyBareRefs whether the bare-reference scan runs at all, lifted by the same
 *   `bare-refs` grant every other outbound door honours
 * @param blocked every ask currently waiting on the owner; absent means that leg does not run at all,
 *   which is what a caller with no readable ask-lifecycle log passes
 * @param prStates what the live pull-request read answered, keyed by `owner/repo#number`; absent means the
 *   freshness leg does not run at all, which is what a caller with no credential and its break-glass pass
 * @returns every half's own result: the page's shape, the cards, the page budget, the one-index sections,
 *   the alignment line, the corrections marks, the bare references, the fold residue and each card's live
 *   premise
 */
export function checkBriefing({
  html,
  rules,
  applyVoice,
  applyBareRefs,
  applyFraming,
  blocked,
  nowIso,
  prStates,
  silent,
}: {
  html: string;
  rules: readonly ExactVoiceRule[];
  applyVoice: boolean;
  applyBareRefs: boolean;
  /** Whether the four card-framing rules run, lifted by `CARD_FRAMING_OVERRIDE_ENV` at the door. */
  applyFraming: boolean;
  blocked?: readonly BlockedAskPremise[] | undefined;
  /** The instant a card's premise age is judged against — the caller's clock, never one read here. */
  nowIso: string;
  prStates?: ReadonlyMap<string, PrPremise> | undefined;
  /** Every scheduled row past its own silence threshold; absent means that leg does not run at all. */
  silent?: readonly SilentRow[] | undefined;
}): BriefingCheck {
  return {
    alignment: checkAlignment({ html }),
    autonomy: checkAutonomy({ html }),
    ownerBeliefs: checkOwnerBeliefs({ html }),
    quiz: checkQuiz({ html }),
    bareRefs: applyBareRefs ? checkBareRefs({ html }) : NO_BARE_REFS,
    blockedAsks: blocked === undefined ? NO_BLOCKED_ASKS : checkBlockedAsks({ blocked, html }),
    cards: checkReactNowCards({ applyFraming, applyVoice, html, nowIso, rules }),
    corrections: checkCorrections({ html }),
    foldResidue: checkFoldResidue({ html }),
    oneIndex: checkOneIndex({ html }),
    page: checkPageBudget({ html }),
    prPremise: prStates === undefined ? NO_PR_PREMISE : checkPrPremises({ html, states: prStates }),
    sections: checkBriefingSections({ applyFraming, html }),
    shape: checkBriefingShape({ html }),
    silentRows: silent === undefined ? NO_SILENT_ROWS : checkSilentRows({ html, silent }),
  };
}

/**
 * Whether the gate refuses the file.
 *
 * @param result what {@link checkBriefing} found
 * @returns true when anything must be fixed before the artifact is published
 */
export function briefingRefused({ result }: { result: BriefingCheck }): boolean {
  return (
    result.alignment.defects.length > 0 ||
    result.autonomy.defects.length > 0 ||
    result.cards.parseProblems.length > 0 ||
    result.cards.defects.length > 0 ||
    result.corrections.defects.length > 0 ||
    result.ownerBeliefs.defects.length > 0 ||
    result.quiz.defects.length > 0 ||
    result.page.defects.length > 0 ||
    result.bareRefs.defects.length > 0 ||
    result.blockedAsks.defects.length > 0 ||
    result.foldResidue.defects.length > 0 ||
    result.oneIndex.defects.length > 0 ||
    result.prPremise.defects.length > 0 ||
    result.sections.defects.length > 0 ||
    result.shape.defects.length > 0 ||
    result.silentRows.defects.length > 0
  );
}

/**
 * Render a check's result as human-readable lines: parse problems, one line per defect, then a summary.
 *
 * The CLI edge is the only caller that needs anything printable; this stays a pure projection so a test can
 * assert on it without shelling out.
 *
 * @param result what {@link checkBriefing} found
 * @returns the lines to print, in order
 */
export function renderBriefingCheck({ result }: { result: BriefingCheck }): readonly string[] {
  if (result.cards.parseProblems.length > 0) {
    return [...result.cards.parseProblems];
  }
  const defectLines = briefingDefectLines({ result });
  const total = defectLines.length;
  if (total === 0) {
    return cleanSummary({ result });
  }
  return [
    ...defectLines,
    `${String(total)} defect(s) across ` +
      `${String(result.cards.cardsChecked)} card(s) checked, the page's shape, the alignment line, the page ` +
      "budget, the one-index budgets, the corrections marks, the autonomy ledger, the correction block, the quiz, the bare-reference scan, " +
      "the fold-residue scan, every section outside the cards, the blocks waiting on the owner, the " +
      "standing rows that have gone quiet and the " +
      "live pull-request premises",
  ];
}

/**
 * Every defect the gate found, as printable lines, in the order a reader should fix them.
 *
 * The order is the point rather than an accident: the page's SHAPE first (nothing else matters on a page
 * arranged wrongly), then the alignment line, then the blocks waiting on the owner — which are about work that has
 * stopped, not about how a card reads — then the per-card and per-page findings.
 *
 * @param result what {@link checkBriefing} found
 * @returns one line per defect, in fix order
 */
function briefingDefectLines({ result }: { result: BriefingCheck }): readonly string[] {
  return [
    ...result.shape.defects.map((defect) => `shape (${defect.rule}): ${defect.reason}`),
    ...result.alignment.defects.map((defect) => `alignment (${defect.rule}): ${defect.reason}`),
    ...result.autonomy.defects.map((defect) => `autonomy ledger (${defect.rule}): ${defect.reason}`),
    ...result.blockedAsks.defects.map(
      (defect) => `blocked on the owner (${defect.channel}/${defect.messageTs}): ${defect.reason}`,
    ),
    ...result.silentRows.defects.map((defect) => `gone quiet (${defect.recipeId}): ${defect.reason}`),
    ...result.cards.defects.map(
      (defect) =>
        `card ${String(defect.card)} ("${defect.question}"): ${CARD_FIELD_LABELS[defect.field]} — ${defect.reason}`,
    ),
    ...result.sections.defects.map((defect) => `section (${defect.rule}): ${defect.reason}`),
    ...result.page.defects.map((defect) => `page (${defect.budget}): ${defect.reason}`),
    ...result.oneIndex.defects.map((defect) => `one index (${defect.rule}): ${defect.reason}`),
    ...result.corrections.defects.map((defect) => `corrections (${defect.rule}): ${defect.reason}`),
    ...result.ownerBeliefs.defects.map((defect) => `correction block (${defect.rule}): ${defect.reason}`),
    ...result.quiz.defects.map((defect) => `quiz (${defect.rule}): ${defect.reason}`),
    ...result.bareRefs.defects.map((defect) => `bare reference in ${defect.where}: ${defect.reason}`),
    ...result.foldResidue.defects.map(
      (defect) => `card ${String(defect.card)} fold (${defect.kind}): ${defect.reason}`,
    ),
    ...result.prPremise.defects.map(
      (defect) => `card ${String(defect.card)} ("${defect.question}"): stale premise — ${defect.reason}`,
    ),
  ];
}

/**
 * What a clean page prints: one line per leg, each stating what it MEASURED rather than the word "clean".
 *
 * Every leg says its own number because a summary that only says "no defects" cannot be told apart from a
 * leg that did not run — the distinction {@link blockedSummary} and {@link premiseSummary} exist to make.
 *
 * @param result what {@link checkBriefing} found
 * @returns the summary lines, in order
 */
function cleanSummary({ result }: { result: BriefingCheck }): readonly string[] {
  return [
    `${String(result.cards.cardsChecked)} card(s) checked under react-now, no defects`,
    "shape: react-now first, the groupings in order, both instants stated",
    `page: ${String(result.page.aboveFoldWords)} words and ` +
      `${String(result.page.unfoldedBlocks)} unfolded block(s) above the fold outside the cards, inside budget`,
    `alignment: stated in ${String(result.alignment.aboveFoldWords)} words above the fold`,
    `sections: ${String(result.sections.scopesChecked)} level(s) outside the cards read, every fleet word ` +
      "glossed where you can see it",
    autonomySummary({ result }),
    `one index: ${String(result.oneIndex.yourListRows)} row(s) of yours in ` +
      `${String(result.oneIndex.yourListWords)} words, ${String(result.oneIndex.awaitingItems)} artifact(s) ` +
      "linked, every anchor lands",
    correctionsSummary({ result }),
    ownerBeliefsSummary({ result }),
    quizSummary({ result }),
    "bare references: none found",
    "fold residue: none found",
    blockedSummary({ result }),
    silentRowSummary({ result }),
    premiseSummary({ result }),
  ];
}

/**
 * The gone-quiet leg's own summary line, which says whether it RAN as well as what it found.
 *
 * Zero silent rows is the common case and reads as clean, so the line distinguishes "every standing row is
 * posting" from "this caller did not look". That distinction is the whole finding this leg exists because
 * of, one level up: a reader who cannot tell a measured zero from an unmeasured one has exactly the problem
 * `definition-runs.json` gave the owner when "has not run for two days" and "ran twice" were the same bytes.
 *
 * @param result what {@link checkBriefing} found
 * @returns the one summary line
 */
function silentRowSummary({ result }: { result: BriefingCheck }): string {
  if (result.silentRows.rowsChecked === 0) {
    return "gone quiet: every standing row is posting on its cadence, or the recipe store was not read";
  }
  return `gone quiet: ${String(result.silentRows.rowsChecked)} row(s) have stopped, every one named in react-now`;
}

/**
 * The autonomy ledger's own summary line, which distinguishes an empty register from a page with no section.
 *
 * Both render as zero rows and they are not the same thing: an install where nothing has been done
 * autonomously is correct and quiet, while a page rendered without `--autonomy-ledger` is one where the whole
 * steering surface silently did not appear. The line cannot tell them apart from the bytes alone, so it says
 * so rather than reporting a clean count that would read as the first.
 *
 * @param result what {@link checkBriefing} found
 * @returns the one line the clean summary prints for the autonomy leg
 */
function autonomySummary({ result }: { result: BriefingCheck }): string {
  if (result.autonomy.rowsChecked === 0) {
    return "autonomy ledger: nothing has been done autonomously, or the page was rendered without --autonomy-ledger";
  }
  return `autonomy ledger: ${String(result.autonomy.rowsChecked)} act(s) shown, newest first, each with its act id`;
}

/**
 * The correction block's own summary line, which distinguishes an empty queue from a page with no block.
 *
 * Both render as zero rows and they are not the same thing: a queue with nothing open means the owner has answered
 * everything the fleet proposed, which is the state this whole mechanism is trying to reach, while a page
 * rendered without `--owner-beliefs` is one where the block silently did not appear. The line cannot tell
 * them apart from the bytes alone, so it says so rather than reporting a clean count that would read as the
 * first.
 *
 * @param result what {@link checkBriefing} found
 * @returns the one line the clean summary prints for the correction block
 */
function ownerBeliefsSummary({ result }: { result: BriefingCheck }): string {
  if (result.ownerBeliefs.rowsChecked === 0) {
    return "correction block: nothing is waiting on your mark, or the page was rendered without --owner-beliefs";
  }
  return (
    `correction block: ${String(result.ownerBeliefs.rowsChecked)} belief(s) waiting on your mark, each with ` +
    "its proposal id and all three marks"
  );
}

/**
 * The quiz block's own summary line, which distinguishes a sweep that asked from one that did not.
 *
 * Zero questions is the common case on a page rendered without `--knowledge-quiz`, and it is also what an
 * install whose register holds no two-sided fleet lesson looks like. The line cannot tell them apart from
 * the bytes alone, so it says so rather than reporting a clean count that would read as the second.
 *
 * @param result what {@link checkBriefing} found
 * @returns the one line the clean summary prints for the quiz block
 */
function quizSummary({ result }: { result: BriefingCheck }): string {
  if (result.quiz.questionsAsked === 0) {
    return "quiz: this sweep asked nothing, or the page was rendered without --knowledge-quiz";
  }
  return "quiz: one question asked, with its ledger id and my own answer folded";
}

/**
 * The blocked-ask leg's own summary line, which says whether it RAN as well as what it found.
 *
 * Zero blocks checked is the common case and reads as clean, so the line distinguishes "nothing is waiting
 * on the owner" from "this caller did not look" — a check that silently did not run reads identically to a check
 * that passed, which is the exact class of quiet omission the leg exists to close.
 *
 * @param result what {@link checkBriefing} found
 * @returns the one summary line
 */
function blockedSummary({ result }: { result: BriefingCheck }): string {
  if (result.blockedAsks.blocksChecked === 0) {
    return "blocked on the owner: nothing waiting on them, or the ask-lifecycle log was not read";
  }
  return `blocked on the owner: ${String(result.blockedAsks.blocksChecked)} waiting, every one linked from react-now`;
}

/**
 * The corrections leg's own summary line, which says whether the page is STAMPED as well as what it found.
 *
 * A first publish carries no marks and that is correct rather than empty: there is no version the owner has already
 * read for it to be wrong about. Saying so is the point — "no marks" and "nothing to mark against" are the
 * two states a publisher most needs told apart here.
 *
 * @param result what {@link checkBriefing} found
 * @returns the one line the clean summary prints for the corrections leg
 */
function correctionsSummary({ result }: { result: BriefingCheck }): string {
  if (!result.corrections.stamped) {
    return "corrections: not stamped — a first publish, or a republish that skipped `briefing corrections`";
  }
  return `corrections: ${String(result.corrections.marks)} marked spot(s), and the strip's own count agrees`;
}

/**
 * The freshness leg's own summary line, which says whether it RAN as well as what it found.
 *
 * A leg that reports nothing when it is switched off is indistinguishable from one that looked and found
 * nothing, and those are the two states a composer most needs told apart here: the whole point of this half
 * is that an unverified premise is not a fresh one.
 *
 * @param result what {@link checkBriefing} found
 * @returns the one line the passing render prints for the premise leg
 */
function premiseSummary({ result }: { result: BriefingCheck }): string {
  if (result.prPremise.refsChecked === 0) {
    return "live premises: no card names a pull request, or the freshness leg did not run";
  }
  return `live premises: ${String(result.prPremise.refsChecked)} card(s) name a pull request, all still open`;
}
