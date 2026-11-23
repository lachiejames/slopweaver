/**
 * Every register's ready value projected into ONE row shape, each row carrying its whole card.
 *
 * Lifted out of `components/console/Queue.tsx` so the sidebar badge can count exactly what the page lists
 * without importing the page — the two surfaces disagreeing about one number is the defect where the chip
 * says 0 while the header says 301 pending.
 *
 * The card itself is built by `site/lib/queueCard.ts`, which imports nothing and is unit-tested by the
 * root lane. This module is the wiring: it knows the register types, the provenance rule and the
 * work-context hint, and it knows nothing about how a card reads. Each register's rows are built beside it
 * (`./handStepRows.ts`, `./queueAskRow.ts`, `./heldReplyRows.ts`, `./parkedPostRows.ts`, `./reviewDraftRows.ts`,
 * `./importQuestionRows.ts`, `./landingRows.ts`, `./queueActRow.ts`); this file holds the row's shape and folds them.
 *
 * It is also where each row gets its TIER in the one ranking (`./waitingRank.ts`), and hands the rows back
 * ranked: what blocks a colleague first, the fleet's own stopped work next, check-ins last — the register
 * order and each register's own age order kept within a tier. The facts, per register:
 *
 * - **hand** — a check-in when its poster said so (`hand post --check-in`); team-facing when it is placed in
 *   `team`.
 * - **ask** — team-facing when it is placed in `team`. `handover list --json` publishes a row's kind
 *   as `ask` or `doc` only, never its `finding` origin, so a door needing the owner's word is reached by where it
 *   places, not by a kind.
 * - **draft** — always team-facing: a held reply is an answer a person asked for in a thread.
 * - **post** — always team-facing: it goes to people, under the owner's name. An ask or hand card naming a held draft
 *   absorbs its post card and is team-facing for it (`./queueDraftOwnership.ts`): one card per held draft.
 * - **review** — always team-facing: a review lands on a colleague's pull request, under the owner's name.
 * - **import** — never team-facing: a store import's question changes only this installation's own state.
 * - **pr** — team-facing when a colleague or the owner's word is next on it (provenance `team`, or a wait whose
 *   next act is `name-the-reviewer` with no pick of the owner's standing, whatever CodeRabbit is doing) or it is placed in
 *   `team`.
 * - **act** — always a check-in: the fleet already did it. One card per PATTERN of acts placed alike
 *   ({@link foldActs}), so two presses on one pull request, or seven rebases written up in one sentence, are one row.
 *
 * "Placed in `team`" is the row's `placement` (`./workspacePlacement.ts`), the same value the workspace filter
 * reads, so the tier and the switcher cannot disagree about which side a row is on. A finding is placed in `self` by
 * the default rule (`workspaceOfPlacement`), so it is never team-facing on that account.
 */

import type { Kind } from "../components/console/queueKinds";
import type { Board, BoardRow, HandStep } from "../components/live/read";
import type { AutonomyRow } from "../components/live/readAutonomy";
import type { ImportQuestionReading, ImportQuestionView } from "../components/live/readImportQuestions";
import type { LandingReading, LandingRow } from "../components/live/readLanding";
import type { ParkedReview } from "../components/live/readReviewDrafts";
import type { Reviewers } from "../components/live/readReviewers";
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { StandingAskReading } from "../components/live/readStandingAsks";
import type { HeldDraft } from "../components/live/readThread";
import type { LiveState } from "../components/live/useLive";
import { actReadsOf, foldActs, placementApart } from "./actGroups";
import type { QueueCardForm } from "./briefingCardForm";
import { withBriefingPages } from "./cardBriefingPages";
import type { LandedRow, MarkedRow } from "./cardLandings";
import { detachedAskRows, type QueueAskBoardRow } from "./detachedAskRow";
import type { AskPending, LinkedHandDecision, OpenedAskOffer } from "./handStepAsk";
import { handStepRows } from "./handStepRows";
import { heldReplyRows } from "./heldReplyRows";
import { importQuestionRows } from "./importQuestionRows";
import { landingRows } from "./landingRows";
import { withMachineIdForm } from "./machineIdForm";
import { askWhenIso, ownerAsksOf } from "./ownerAsks";
import { parkedPostRows } from "./parkedPostRows";
import type { Provenance } from "./provenance";
import { type ActCardForm, actRowOf } from "./queueActRow";
import { askRowOf } from "./queueAskRow";
import type { QueueCard } from "./queueCard";
import type { ActLinks } from "./queueCardActLinks";
import type { CardSource } from "./queueCardSource";
import { withCardTags } from "./queueCardTags";
import { oneCardPerHeldSlackDraft } from "./queueDraftOwnership";
import type { StoppingStamp } from "./queueStopping";
import type { QueueTags } from "./queueTagsInherited";
import { reviewDraftRows } from "./reviewDraftRows";
import type { NamedDraft } from "./slackDraftIds";
import { withStandingAsks } from "./standingAskSource";
import { rankWaiting, type WaitingTier } from "./waitingRank";
import type { WorkspacePlacement, WorkspacePlacer } from "./workspacePlacement";

/**
 * What every row in the one card carries, whichever register it came from — `triage` ({@link MarkedRow}) being the owner's
 * triage ruling, drawn as a pill so a parked card says why it is below the rest.
 */
export interface QueueRow extends QueueTags, LandedRow, MarkedRow {
  readonly kind: Kind;
  readonly id: string;
  /** `<kind>:<id>` — what `?open=` names, so a deep link is one string. */
  readonly key: string;
  /**
   * Other `?open=` keys this row answers to, after an exact {@link QueueRow.key} match found none
   * (`./queueOpen.ts`). A decision hand step answers to `ask:<slug>`, because the note's Open names the ask
   * it joined and the ask draws no row of its own. An act answers to `act:<id>` of every earlier act folded
   * into it ({@link foldActs}), so a link naming the first press on a pull request opens the one card. A held post
   * answers to `post:<id>` of every dropped cut re-cut into it (`./slackDraftIds.ts`), so a link a reading from
   * before the re-cut made opens the cut that stands. An ask or hand card that asks the owner to send a held draft answers
   * to that draft's `post:` keys, its own card absorbed (`./queueDraftOwnership.ts`). Absent on every other row.
   */
  readonly aliases?: readonly string[];
  /** On a held post carrying a hold or change of meaning: never folded, the card being where the owner reads why. */
  readonly saysWhyNotSent?: true;
  /** The row as the fleet-briefing card shape: question, what, why you, options, lean, if silent. */
  readonly card: QueueCard;
  readonly whenIso: string | undefined;
  /**
   * When something last CONFIRMED the row still stands — not when it was made. An ask's still-real check, the
   * landing reading a pull request came from, or the register read that still holds it. `undefined` on an
   * ask nobody has re-confirmed since it was asked, which the page says aloud (`./queueFreshness.ts`).
   */
  readonly verifiedIso: string | undefined;
  /** What did that confirming, in the words the row prints beside its age. */
  readonly verifiedBy: string;
  /**
   * The card's version as `handover currency` stamps its row's `floorIso` (`src/handover/currencyCards.ts`): a hand
   * step's posting, an ask's later of its asking and its still-real check, a draft's or review's own instant, a pull
   * request's last update — never a poll's instant, which would make every poll a new card. `undefined` on an act.
   */
  readonly currencyFloorIso: string | undefined;
  /** On a hand step opening an ask the owner already ruled on, when they ruled ({@link ruledAskIso}). Absent otherwise. */
  readonly ruledIso?: string;
  /**
   * When the owner pressed "Come back to it" on the card, from the deferral ledger (`./cardDeferrals.ts`): the page draws
   * it below every card not deferred. Absent on a card the owner has not deferred, or has put back.
   */
  readonly deferredIso?: string;
  /**
   * On a card blocking one of the owner's priorities, or a hand step marked as an automation that stopped, stamped by
   * `./queueStopping.ts` `withStopping` with which of the two it is: the first draws ahead of every card, the second
   * straight after the owner's priorities (`./queueFocus.ts` `queueOrdered`), and no deferral or spoken landing moves either
   * down. Absent on every other card.
   */
  readonly stopping?: StoppingStamp;
  readonly pill: string;
  /** The row's text — what `./cardReferences.ts` searches for a bare number. NEVER read to place the row. */
  readonly hint: string;
  /** Which workspace the row belongs to, from its fields alone ({@link boardRowPlacement} and its siblings). */
  readonly placement: WorkspacePlacement;
  /** Who raised it — the fleet, a review bot, a colleague — by the rule in `./provenance.ts`. */
  readonly provenance: Provenance;
  /** Where it ranks among everything waiting on the owner — the one ranking every surface shares. */
  readonly tier: WaitingTier;
  /** The Slack thread the row names — its published anchor, else the first permalink in its own prose. */
  readonly threadUrl: string | undefined;
  /**
   * Where the card came from — the owner's own words, or the fleet — which the expanded card leads with (`./queueCardSource.ts`).
   * A card whose anchor names the owner's words and carries none folds that refusal into its record's `form`.
   */
  readonly source: CardSource;
  readonly record:
    | {
        readonly kind: "hand";
        readonly step: HandStep;
        readonly decision: LinkedHandDecision | undefined;
        /** Every draft id the step, or the ask it opens, names — each resolved, whether or not an ask joined. */
        readonly drafts: readonly NamedDraft[];
        /**
         * Refused when the card carries text its record did not write (`./handCard.ts` `handCard`), or asks the owner to
         * react to a message drafted as them that it cannot draw (`./draftAsOwner.ts` `handDraftForm`).
         */
        readonly form: ActCardForm;
        /** What the ask the step opens offers, read off its board row whether or not it is shaped ({@link openedAskAction}). */
        readonly offered: OpenedAskOffer | undefined;
        /** Where the ask it opens stands while the board holding it is not in hand ({@link askPendingOf}). */
        readonly askPending: AskPending | undefined;
        /** The board reading in hand was observed before this step was posted, so the page reads the board again. */
        readonly boardStale: boolean;
      }
    | {
        readonly kind: "ask";
        readonly row: QueueAskBoardRow;
        /** Every draft id the ask's card names, each resolved — the draft it asks the owner to send, drawn on the card. */
        readonly drafts: readonly NamedDraft[];
        /** Refused when the card draws a field the board row does not hold (`./briefingCardForm.ts`). */
        readonly form: QueueCardForm;
      }
    | { readonly kind: "draft"; readonly draft: HeldDraft; readonly form: QueueCardForm }
    | { readonly kind: "post"; readonly post: ParkedDraft; readonly form: QueueCardForm }
    | { readonly kind: "review"; readonly review: ParkedReview; readonly form: QueueCardForm }
    | { readonly kind: "import"; readonly question: ImportQuestionView; readonly form: QueueCardForm }
    | {
        readonly kind: "pr";
        readonly row: LandingRow;
        readonly reading: LandingReading;
        readonly form: QueueCardForm;
      }
    | {
        readonly kind: "act";
        readonly act: AutonomyRow;
        readonly links: ActLinks;
        /** The branch the card looks its pull request up by when it opens ({@link actPullLookupBranch}). */
        readonly lookupBranch: string | undefined;
        /** Earlier acts of the same pattern, newest first — folded into this card ({@link foldActs}). */
        readonly earlier: readonly AutonomyRow[];
        /** Every subject the pattern's acts name, the newest act's first ({@link ActGroup}). */
        readonly subjects: readonly string[];
        /** Whether the panel may draw the card body at all ({@link ActCardForm}). */
        readonly form: ActCardForm;
      };
}

/**
 * Project each register's ready value into rows, ranked.
 *
 * @param reviewers the reviewer reading — an overlay on the landing register, not a register: it only withdraws a
 *   naming card whose reviewer the owner already picked
 * @param standing the owner's standing asks — an overlay too: it only names the words a card no particular steer of the
 *   owner's is behind rests on
 * @param placer the organisation's address readers, which place every row
 * @returns the rows — tier-first by the one ranking, then in each register's own order
 */
export function rowsOf({
  hands,
  board,
  drafts,
  posts,
  reviews,
  imports,
  landing,
  reviewers,
  acts,
  standing,
  placer,
}: {
  placer: WorkspacePlacer;
  hands: LiveState<readonly HandStep[]>;
  board: LiveState<Board>;
  drafts: LiveState<readonly HeldDraft[]>;
  posts: LiveState<readonly ParkedDraft[]>;
  reviews: LiveState<readonly ParkedReview[]>;
  /** The questions a store import staged and nobody has answered (`../components/live/readImportQuestions.ts`). */
  imports: LiveState<ImportQuestionReading>;
  landing: LiveState<LandingReading>;
  reviewers: LiveState<Reviewers>;
  acts: LiveState<readonly AutonomyRow[]>;
  standing: LiveState<StandingAskReading>;
}): readonly QueueRow[] {
  const out: Omit<QueueRow, keyof QueueTags>[] = [];
  let boardRows: readonly BoardRow[] = [];
  // The rows the ask loop reads: the board's own, plus a row for each run waiting on the owner whose doc left the board.
  let askable: readonly QueueAskBoardRow[] = [];
  if (board.phase === "ready") {
    boardRows = board.value.rows;
    askable = [...boardRows, ...detachedAskRows({ asks: board.value.detachedAsks, rows: boardRows })];
  }
  // The same rows, or `undefined` while the board is unread — which a card's source says aloud (`./queueCardSource.ts`).
  const readRows = board.phase === "ready" ? boardRows : undefined;
  // Every slug the ask loop below stands a row up for — `ownerAsksOf`, the same filter it runs.
  const askRowSlugs = new Set(ownerAsksOf({ rows: askable }).map((row) => row.slug));
  const { joined, rows: handRows } = handStepRows({ askRowSlugs, board, boardRows, hands, placer, posts, readRows });
  out.push(...handRows);
  if (board.phase === "ready") {
    // `ownerAsksOf` drops every row that is not waiting on the owner's word, and orders what is left oldest question
    // first. This page is the one pane answering "what needs my steer right now", so a row the owner has already
    // ruled on, one that is settled and one that is paused each stay on the handover board instead, and the
    // panel that prints a board row says why with `waitWord`. A detached ask
    // (`./detachedAskRow.ts`) sorts in among them by its own asked instant.
    for (const row of ownerAsksOf({ rows: askable })) {
      const question = row.question;
      if (question === undefined || joined.has(row)) {
        continue;
      }
      out.push(askRowOf({ placer, posts, question, row, whenIso: askWhenIso({ row }) }));
    }
  }
  out.push(...heldReplyRows({ drafts, placer }));
  out.push(...parkedPostRows({ posts, readRows }));
  out.push(...reviewDraftRows({ placer, reviews }));
  out.push(...importQuestionRows({ imports }));
  out.push(...landingRows({ landing, placer, readRows, reviewers }));
  if (acts.phase === "ready") {
    // Every row an act can link to is already built: an act never makes an `ask:` card of its own.
    const queueKeys = new Set(
      out.flatMap((row) => {
        if (row.aliases === undefined) {
          return [row.key];
        }
        return [row.key, ...row.aliases];
      }),
    );
    const reads = actReadsOf({ board, landing, placer });
    for (const group of foldActs({ acts: acts.value, apart: placementApart({ reads }) })) {
      out.push(actRowOf({ group, observedAtIso: acts.observedAtIso, queueKeys, reads }));
    }
  }
  // Every card no particular steer of the owner's is behind quotes the standing ask it rests on (`./standingAskSource.ts`),
  // before the machine-id form reads the line that ask's copy draws.
  const sourced = withStandingAsks({ rows: withCardTags({ board, rows: out }), standing });
  const tagged = sourced.map((row) => withMachineIdForm({ row }));
  // Once every gate has ruled, so a card refused for anything else never takes the post card that would still draw.
  // Every briefing the voice reads through a card is drawn on it, once each card's held drafts are settled, since a
  // draft the card absorbed is text the voice searches (`./cardBriefingPages.ts`).
  const owned = oneCardPerHeldSlackDraft({ rows: tagged }).map((row) => withBriefingPages({ row }));
  // An alias never names another row's own key: a board holding a second row under the joined slug keeps that
  // row, and the page filters by context before it resolves `?open=`, so exact-first there could not see it
  // (a counterexample). Dropping the alias here makes a shadow impossible on every filtered list.
  const keys = new Set(owned.map((row) => row.key));
  const unshadowed = owned.map((row) => {
    if (row.aliases === undefined || row.aliases.every((alias) => !keys.has(alias))) {
      return row;
    }
    return { ...row, aliases: row.aliases.filter((alias) => !keys.has(alias)) };
  });
  return rankWaiting({ items: unshadowed, tierOf: (row) => row.tier });
}
