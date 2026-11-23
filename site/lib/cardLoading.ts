/**
 * Whether an opened queue card is still waiting on a read its content is derived from — pure, so the rule is a
 * unit test rather than a render.
 *
 * A card opened fresh must not spend its first ten to fifteen seconds looking unfinished before its derived content arrives.
 * MEASURED on a finding act opened fresh (`?open=act:finding-pr.<slug>`): at 3 s and at 12 s the panel drew
 * the ledger subject as its heading, "The board is still being read; …" and "Looking up the pull request
 * opened from branch …" above a live Approve button; the heading, the pull request and the card arrived with
 * the board (`handover list --json`, 22 s) and the by-branch lookup (`github search` then `github pr summary`,
 * 6.6 s + 5.9 s). Reproduce each with `time SLOPWEAVER_LAUNCHER_QUIET=1 slopweaver <argv>`.
 *
 * So a card whose derived fields are still arriving is drawn as ONE loading state and nothing else
 * (`../components/console/LoadingPanel.tsx`) — never a partial card, an absence sentence or an action on half
 * the facts. What counts is only a read IN FLIGHT WITH NOTHING IN HAND: a register that could not be read is not
 * loading, and the card draws the reason it gives, exactly as before; and an act whose branch the page already read
 * draws that answer while its opening reads the branch again (`./actPullCache.ts`) — loading over it would throw
 * away the read the queue made ahead of the opening, which is the whole cut.
 */

import type { Board, HandStep } from "../components/live/read";
import type { AutonomyRow } from "../components/live/readAutonomy";
import type { ImportQuestionReading } from "../components/live/readImportQuestions";
import type { LandingReading } from "../components/live/readLanding";
import type { ParkedReview } from "../components/live/readReviewDrafts";
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { HeldDraft } from "../components/live/readThread";
import type { LiveState } from "../components/live/useLive";
import type { ActPullState } from "./actPullVerb";
import type { AskPending } from "./handStepAsk";
import type { QueueRow } from "./queueRows";
import type { NamedDraft } from "./slackDraftIds";

/** One read an opened card is waiting on. */
export type CardLoadingWait =
  | { readonly kind: "own-register"; readonly register: QueueRow["kind"] }
  | { readonly kind: "opened-ask-board" }
  | { readonly kind: "thread-held-drafts" }
  | { readonly kind: "named-drafts"; readonly ids: readonly string[] }
  | { readonly kind: "act-board" }
  | { readonly kind: "act-landing" }
  | { readonly kind: "act-pull"; readonly branch: string };

/**
 * The named drafts still being read, as one wait, or none. The LIVE register decides, never the record: a row that
 * left its register stays open as the snapshot taken when it was opened, whose marks never update, and the panel
 * resolves every named id against the live register — so while it loads, EVERY named draft is being read, whatever
 * the snapshot once said of it.
 *
 * @param drafts the card's draft resolutions
 * @param posts the drafts register as the page holds it now
 * @returns the wait, or an empty list
 */
function draftWaits({
  drafts,
  posts,
}: {
  drafts: readonly NamedDraft[];
  posts: LiveState<readonly ParkedDraft[]>;
}): readonly CardLoadingWait[] {
  if (posts.phase !== "loading") {
    return [];
  }
  const ids = drafts.map((named) => named.id);
  if (ids.length === 0) {
    return [];
  }
  return [{ ids, kind: "named-drafts" }];
}

/**
 * The register an opened card's own row came from, as one wait while that register is loading, or none.
 *
 * A live row exists only once its register has read, so this fires only for a card left open as a snapshot after
 * its row went: nothing a snapshot holds says whether the register it came from has an answer now, and a card
 * drawn over a register with none would draw a body and actions no settled read backs.
 *
 * @param row the opened row
 * @param registers every register a row can come from, as the page holds it now
 * @returns the wait, or an empty list
 */
export function ownRegisterWait({
  row,
  registers,
}: {
  row: QueueRow;
  registers: {
    hands: LiveState<readonly HandStep[]>;
    board: LiveState<Board>;
    drafts: LiveState<readonly HeldDraft[]>;
    posts: LiveState<readonly ParkedDraft[]>;
    reviews: LiveState<readonly ParkedReview[]>;
    imports: LiveState<ImportQuestionReading>;
    landing: LiveState<LandingReading>;
    acts: LiveState<readonly AutonomyRow[]>;
  };
}): readonly CardLoadingWait[] {
  const own = {
    act: registers.acts,
    ask: registers.board,
    draft: registers.drafts,
    hand: registers.hands,
    import: registers.imports,
    post: registers.posts,
    pr: registers.landing,
    review: registers.reviews,
  } satisfies Record<QueueRow["kind"], LiveState<unknown>>;
  if (own[row.kind].phase !== "loading") {
    return [];
  }
  return [{ kind: "own-register", register: row.kind }];
}

/**
 * The Slack thread an opened card draws as its subject: an ask's own, or the one a decision step's ask is about —
 * the step floats that ask's card, so it leads with the same thread. A plain step that
 * merely names a link draws no thread.
 *
 * @param row the opened row
 * @returns the thread's link, or `undefined` when the card draws none
 */
export function drawnThreadOf({ row }: { row: QueueRow }): string | undefined {
  if (row.kind === "ask") {
    return row.threadUrl;
  }
  if (row.record.kind === "hand") {
    return row.record.decision?.threadUrl;
  }
  return undefined;
}

/**
 * The held-drafts register as one wait, for a card that draws its Slack thread ({@link drawnThreadOf}), while that
 * register loads. The thread says whether a draft is held for it, and with no answer in hand it would say none is,
 * beside the action that writes one. A draft card's own register is this one, so {@link ownRegisterWait}
 * holds it.
 *
 * @param row the opened row
 * @param drafts the held-drafts register as the page holds it now
 * @returns the wait, or an empty list
 */
export function threadDraftsWait({
  row,
  drafts,
}: {
  row: QueueRow;
  drafts: LiveState<readonly HeldDraft[]>;
}): readonly CardLoadingWait[] {
  if (drawnThreadOf({ row }) === undefined || drafts.phase !== "loading") {
    return [];
  }
  return [{ kind: "thread-held-drafts" }];
}

/**
 * Every read an opened card is still waiting on, in the order its line names them — empty once the card may draw.
 *
 * A hand step waits on the board only while the ask it opens is PENDING on a read: the board loading, or a retained
 * board being re-read. A retained board that already carries the ask's message blanks nothing, and a board read
 * before the step was posted is NOT a wait: the page re-reads it once and nothing guarantees that re-read lands
 * newer, so the card draws and says the ask is being read again rather than risk loading forever. An act waits on the board and the owner's open pull requests while either loads,
 * and on its by-branch lookup while that is in flight.
 *
 * @param row the opened row
 * @param board the board channel
 * @param landing the owner's open pull requests
 * @param posts the parked-drafts register a hand or ask card's named drafts resolve against
 * @param lookup the act's by-branch pull-request lookup, `idle` for every other row
 * @returns the waits, empty when nothing the card draws is still arriving
 */
export function cardLoading({
  row,
  board,
  landing,
  lookup,
  posts,
}: {
  row: QueueRow;
  board: LiveState<Board>;
  landing: LiveState<LandingReading>;
  lookup: ActPullState;
  posts: LiveState<readonly ParkedDraft[]>;
}): readonly CardLoadingWait[] {
  const record = row.record;
  if (record.kind === "hand") {
    const rereading = board.phase === "loading" || (board.phase === "ready" && board.refreshing === true);
    const askWait: CardLoadingWait[] = [];
    if (record.askPending !== undefined && rereading) {
      askWait.push({ kind: "opened-ask-board" });
    }
    return [...askWait, ...draftWaits({ drafts: record.drafts, posts })];
  }
  if (record.kind === "ask") {
    return draftWaits({ drafts: record.drafts, posts });
  }
  if (record.kind !== "act") {
    return [];
  }
  const waits: CardLoadingWait[] = [];
  if (board.phase === "loading") {
    waits.push({ kind: "act-board" });
  }
  if (landing.phase === "loading") {
    waits.push({ kind: "act-landing" });
  }
  if (lookup.phase === "loading") {
    waits.push({ branch: lookup.branch, kind: "act-pull" });
  }
  return waits;
}

/** What each register is called on the loading line, by the kind of row it makes. */
const OWN_REGISTER_PHRASE = {
  act: "what the fleet did without asking",
  ask: "the board",
  draft: "the held drafts",
  hand: "your hand steps",
  import: "the staged import questions",
  post: "the parked drafts",
  pr: "your open pull requests",
  review: "the parked reviews",
} as const satisfies Record<QueueRow["kind"], string>;

/**
 * What one wait is reading, in the words the loading line uses.
 *
 * @param wait the wait
 * @returns the phrase
 */
function waitPhrase({ wait }: { wait: CardLoadingWait }): string {
  switch (wait.kind) {
    case "own-register": {
      return OWN_REGISTER_PHRASE[wait.register];
    }
    case "thread-held-drafts": {
      return "the drafts held for its thread";
    }
    case "opened-ask-board":
    case "act-board": {
      return "the board";
    }
    case "named-drafts": {
      return `the drafts it names (${wait.ids.join(", ")})`;
    }
    case "act-landing": {
      return "your open pull requests";
    }
    case "act-pull": {
      return `the pull request opened from ${wait.branch}`;
    }
    default: {
      const unhandled: never = wait;
      return unhandled;
    }
  }
}

/**
 * The one line a loading card draws: what it is reading, each read once.
 *
 * @param waits the card's waits, at least one
 * @returns the line
 */
export function cardLoadingLine({ waits }: { waits: readonly CardLoadingWait[] }): string {
  const phrases = [...new Set(waits.map((wait) => waitPhrase({ wait })))];
  let named = phrases.join(", ");
  if (phrases.length > 1) {
    named = `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)!}`;
  }
  let arrive = "once it arrives";
  if (phrases.length > 1) {
    arrive = "once they arrive";
  }
  return `Reading ${named}. The card draws whole ${arrive}.`;
}

/**
 * Where a hand card's opened ask stands. Two cases mark it stale, with why, in place of a spinner whose read will
 * never land on the card:
 *
 * - a card left open after its step left the owner's hands is the snapshot taken when it was opened, and nothing re-reads
 *   its ask once the step is gone;
 * - a live card whose board predated its step reads the board again ONCE (`../components/console/useQueueRows.ts`),
 *   and the board is a single read, so once that re-read has landed and still predates the step, a spinner would
 *   stand forever.
 *
 * @param askPending the row's pending state, if its ask was not in hand
 * @param gone whether the step has left the register since the card was opened
 * @param stale whether the board in hand began its scan before the step was posted (`boardStale`)
 * @param board the board as the page holds it now
 * @param reread whether the one re-read has landed, when it has been asked
 * @returns what to draw, or `undefined` when the ask is in hand
 */
export function askPendingNow({
  askPending,
  gone,
  stale,
  board,
  reread,
}: {
  askPending: AskPending | undefined;
  gone: boolean;
  stale: boolean;
  board: LiveState<Board>;
  reread: { landed: boolean } | undefined;
}): AskPending | undefined {
  if (askPending === undefined) {
    return undefined;
  }
  if (gone) {
    return {
      phase: "not-measured",
      why: "this step left your hands before the board holding the ask it opens arrived, and nothing reads it here now",
    };
  }
  const settledAgain = stale && reread?.landed === true && board.phase === "ready" && board.refreshing !== true;
  if (settledAgain) {
    return {
      phase: "not-measured",
      why: "the board was read again and that read still began before this step was posted; reloading the page reads it",
    };
  }
  return askPending;
}
