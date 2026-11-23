/**
 * Putting a console card back on their queue — `talk restore`, the undo of `./cardLandApply.ts`'s landing and of a
 * Queue walk's move (`./cardMoveApply.ts`). One card-wide `restored` row lifts both; an ask a move alone took off is
 * re-asked by nothing, since a move writes no ruling.
 *
 * ## Restoring an ask re-asks it, and never deletes the ruling
 *
 * A landed ask is off their queue because its ruling is newer than its question. A restore appends a fresh
 * `question` event restating the open question whole — its current text, shape, stakes, draft and examples, then
 * its picture on a `question-shot` line, since a fresh question inherits none — so the
 * question is newer than the ruling again, and `ownerWait` reads it as theirs. History stays: the ruling, the
 * landing and the dispatch row are all still on disk. The residue, stated: the restated question has no Slack
 * post handle, so `handover correct` will re-post rather than edit the DM message the first asking left.
 *
 * The card stays visible, but not as a fresh question: the currency board reads the ruling made before an identical
 * re-ask (`rulingBeforeRepeatedQuestion`, `../../../handover/heldQuestion.ts`), and the Queue draws it as a check-in.
 *
 * The re-ask goes in BEFORE the restore's ledger row, the order a landing keeps too (`./cardLandApply.ts`): a ledger
 * append that fails after it leaves the ask asked and its landing still active, and the verb says it failed. Running
 * the restore again finishes it — the restated question is newer than the ruling now, so it reads `still-asked`,
 * asks nothing twice, and appends the row.
 */
import type { HandShot } from "../../../hand/shot.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { answeringRuling } from "../../../handover/ownerWait.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { latestRulingEvent, type RulingIdentity, rulingIdentityOf } from "../../../handover/ruling.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  activeCardLandings,
  type CardLandedRow,
  type CardLandingRow,
  type CardRestoredRow,
  cardKeyParts,
  landedAnchors,
} from "../../../talk/cardLanding.js";
import { type CardLandingError, CardLandingErrors } from "../../../talk/cardLandingErrors.js";
import {
  appendCardLanding,
  holdCardLandingLock,
  readCardLandings,
  refusedCardLanding,
} from "../../../talk/cardLandingStore.js";
import { activeCardMoves } from "../../../talk/cardMoveLedger.js";
import { readCardMoves } from "../../../talk/cardMoveStore.js";
import { exampleFields } from "../handover/askExampleFlags.js";

/** Where and why a card is put back. */
export interface RestoreCardInput {
  readonly home: string;
  readonly cardKey: string;
  readonly anchor: string;
  readonly why: string;
  readonly nowIso: string;
}

/**
 * What restoring an ask did to its question. Only a ruling a lifted landing wrote is undone: a later ruling that
 * came from anywhere else is their own answer, so the ask stays answered and the verb says whose ruling kept it.
 */
export type AskRestore =
  | { readonly kind: "re-asked" }
  | { readonly kind: "still-asked" }
  | { readonly kind: "ruled-elsewhere"; readonly anchor: string }
  | { readonly kind: "not-waiting"; readonly disposition: string };

/** What a restore came to. */
export interface RestoreCardOutcome {
  readonly restored: CardRestoredRow;
  /** How many active landings it lifted. */
  readonly lifted: number;
  /** How many of the Queue walk's moves it lifted (`src/talk/cardMoveLedger.ts`). */
  readonly movesLifted: number;
  /** What became of an ask's question; `undefined` for every other kind of card. */
  readonly ask: AskRestore | undefined;
}

/**
 * Lift a card's landings so they no longer hold it off their queue, re-asking an ask whose landing ruled it, then record the
 * restore. An ask a ruling from elsewhere answered stays answered, and the outcome names that ruling.
 *
 * @param input the card, and where and why the restore was decided
 * @returns what was lifted, or why the card cannot be put back
 */
export function restoreCard({ input }: { input: RestoreCardInput }): Result<RestoreCardOutcome, CardLandingError> {
  const parts = cardKeyParts({ cardKey: input.cardKey });
  if (parts === undefined) {
    return err(CardLandingErrors.cardKeyInvalid({ cardKey: input.cardKey }));
  }
  const lock = holdCardLandingLock({ home: input.home });
  if (lock.isErr()) {
    return err(lock.error);
  }
  try {
    return restoreCardHeld({ input, parts });
  } finally {
    lock.value();
  }
}

/**
 * {@link restoreCard} under the ledger's lock: read the active landings, check the ledger takes the restore, re-ask,
 * append the restore.
 *
 * @param parts the card's register and its id in it
 * @returns what was lifted, or why the card cannot be put back
 */
function restoreCardHeld({
  input,
  parts,
}: {
  input: RestoreCardInput;
  parts: { readonly kind: string; readonly id: string };
}): Result<RestoreCardOutcome, CardLandingError> {
  const ledger = readCardLandings({ home: input.home });
  if (ledger.isErr()) {
    return err(ledger.error);
  }
  const lifted = activeCardLandings({ rows: ledger.value.rows }).filter((row) => row.cardKey === input.cardKey);
  // A Queue walk's move is lifted by the same row: a restore is card-wide, at or after the instant it took the card off.
  const moves = readCardMoves({ home: input.home });
  if (moves.isErr()) {
    return err(moves.error);
  }
  const movesLifted = activeCardMoves({ landings: ledger.value.rows, moves: moves.value.rows }).filter(
    (row) => row.cardKey === input.cardKey,
  ).length;
  if (lifted.length === 0 && movesLifted === 0) {
    return err(CardLandingErrors.cardNotLanded({ cardKey: input.cardKey }));
  }
  const restored: CardRestoredRow = {
    anchor: input.anchor,
    atIso: input.nowIso,
    cardKey: input.cardKey,
    kind: "restored",
    why: input.why,
  };
  const refused = refusedCardLanding({ home: input.home, row: restored });
  if (refused !== undefined) {
    return err(refused);
  }
  let ask: AskRestore | undefined;
  if (parts.kind === "ask") {
    const asked = reAskIfRuledByLanding({
      landed: landingRulings({ cardKey: input.cardKey, lifted, rows: ledger.value.rows }),
      home: input.home,
      nowIso: input.nowIso,
      slug: parts.id,
    });
    if (asked.isErr()) {
      return err(asked.error);
    }
    ask = asked.value;
  }
  return appendCardLanding({ home: input.home, row: restored }).map(() => ({
    ask,
    lifted: lifted.length,
    movesLifted,
    restored,
  }));
}

/**
 * Re-ask an ask when the ruling that took it off their queue is one a landing wrote. An ask whose question is
 * newer than every ruling, or whose newest ruling came from somewhere else, is left exactly as it is — a later ruling
 * under the same anchor included, since only its anchor, decision instant and words together say a landing wrote
 * it.
 *
 * @param landed the ruling each lifted landing wrote, as `rulingKey` gives it
 * @returns what became of its question
 */
function reAskIfRuledByLanding({
  slug,
  home,
  landed,
  nowIso,
}: {
  slug: string;
  home: string;
  landed: ReadonlySet<string>;
  nowIso: string;
}): Result<AskRestore, CardLandingError> {
  const runsDir = stateHomePaths({ home }).runs;
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return err(CardLandingErrors.boardWriteFailed({ slug, why: journal.error.message }));
  }
  const disposition = runDisposition({
    events: journal.value.events,
    unreadableLines: journal.value.unreadable,
  });
  if (disposition.kind !== "waiting-on-owner") {
    return ok({ disposition: disposition.kind, kind: "not-waiting" });
  }
  const standing = newestRuling({ events: journal.value.events });
  const newest = answeringRuling({ run: disposition, standing });
  if (standing === undefined || newest === undefined) {
    return ok({ kind: "still-asked" });
  }
  if (!landed.has(rulingKey(newest))) {
    return ok({ anchor: newest.anchor, kind: "ruled-elsewhere" });
  }
  if (disposition.actionUnreadable) {
    return err(
      CardLandingErrors.restoreUnshaped({ slug, why: "its draft does not read, so it cannot be restated whole" }),
    );
  }
  const askedIso = askedAfter({ nowIso, rulingIsos: [newest.decidedIso, standing.decidedIso] });
  if (askedIso === undefined) {
    const why = "its ruling is dated at the last instant a date can hold, so no question can be asked after it";
    return err(CardLandingErrors.restoreUnshaped({ slug, why }));
  }
  const written = applyRowEvent({ event: restatedQuestion({ askedIso, disposition }), runsDir, slug });
  if (written.isErr()) {
    return err(CardLandingErrors.boardWriteFailed({ slug, why: written.error.message }));
  }
  const { question, shot } = disposition;
  return restorePicture({ askedIso, question, runsDir, shot, slug }).map((): AskRestore => ({ kind: "re-asked" }));
}

/**
 * The fresh `question` a restore appends: the open question whole — its text, shape, stakes, draft and examples.
 *
 * @param askedIso the instant {@link askedAfter} chose, after every ruling it must follow
 * @param disposition the run as it waits on them, which the restated question copies
 * @returns the event to append
 */
function restatedQuestion({
  askedIso,
  disposition,
}: {
  askedIso: string;
  disposition: Extract<ReturnType<typeof runDisposition>, { kind: "waiting-on-owner" }>;
}): RunEvent {
  const { shape, action, illustration } = disposition;
  return {
    atIso: askedIso,
    kind: "question",
    question: disposition.question,
    ...(shape === undefined ? {} : { lean: shape.lean, options: shape.options, problem: shape.problem }),
    ...(shape?.stakes === undefined ? {} : { stakes: shape.stakes }),
    ...(action === undefined ? {} : { action }),
    ...(illustration === undefined ? {} : exampleFields({ set: illustration })),
  };
}

/**
 * Give a restated question its picture back — a fresh `question` inherits none (`openQuestion.ts`), so without
 * this line the re-asked card would show no picture.
 *
 * @param askedIso the restated question's instant, which the picture line shares
 * @param question the restated question's exact text, the binding `question-shot` keys on
 * @param shot the picture the landed card showed, `undefined` when it had none
 * @returns nothing on success, or a write failure naming the verb that attaches it again
 */
function restorePicture({
  askedIso,
  question,
  runsDir,
  shot,
  slug,
}: {
  askedIso: string;
  question: string;
  runsDir: string;
  shot: HandShot | undefined;
  slug: string;
}): Result<void, CardLandingError> {
  if (shot === undefined) {
    return ok(undefined);
  }
  const pictured = applyRowEvent({ event: { atIso: askedIso, kind: "question-shot", question, shot }, runsDir, slug });
  if (pictured.isErr()) {
    const why = `it was re-asked without its picture (${pictured.error.message}) — slopweaver handover shot ${slug} attaches it again`;
    return err(CardLandingErrors.boardWriteFailed({ slug, why }));
  }
  return ok(undefined);
}

/**
 * When the restated question is asked: now, or just after the ruling it undoes when that is not yet past — a ruling
 * stamped ahead of the clock, or a clock gone back since, would otherwise still be the newer and keep the ask off their
 * queue while the restore said it was re-asked. After the row's STANDING ruling too, not only the one
 * the landing wrote: a restated question is a fresh `question` that no reshape re-cut, so every ruling on the journal
 * competes for it again, and one a reshape had read, decided ahead of the clock, would answer it.
 *
 * @param rulingIsos the decision instants it must follow — the ruling the lifted landing wrote, and the standing one
 * @returns the question's instant, always later than every one of them — or `undefined` for a ruling at the last
 *   instant a `Date` holds, which nothing can follow, so the restore refuses rather than throwing
 */
function askedAfter({ nowIso, rulingIsos }: { nowIso: string; rulingIsos: readonly string[] }): string | undefined {
  const after = Math.max(...rulingIsos.map((iso) => Date.parse(iso))) + 1;
  if (Date.parse(nowIso) >= after) {
    return nowIso;
  }
  const asked = new Date(after);
  if (Number.isNaN(asked.getTime())) {
    return undefined;
  }
  return asked.toISOString();
}

/**
 * The ruling a row reads — `src/handover/ruling.ts`'s own pick, so the board and a restore cannot disagree about
 * which ruling took an ask off their queue.
 *
 * @returns its anchor, decision instant and words, or `undefined` when the journal holds no ruling
 */
function newestRuling({ events }: { events: readonly RunEvent[] }): RulingIdentity | undefined {
  const event = latestRulingEvent({ events });
  return event === undefined ? undefined : rulingIdentityOf({ event });
}

/**
 * The ruling each lifted utterance wrote on its ask, keyed by `rulingKey`. Only an utterance's FIRST landing on the
 * card wrote one — the shorter first words, the ruling that is kept; a row it grew into later reused that row's work
 * and wrote none, so a ruling matching a grown row came from elsewhere and stays.
 *
 * @param lifted the active landings being lifted
 * @param rows the whole ledger, in file order
 * @returns the keys
 */
function landingRulings({
  cardKey,
  lifted,
  rows,
}: {
  cardKey: string;
  lifted: readonly CardLandedRow[];
  rows: readonly CardLandingRow[];
}): ReadonlySet<string> {
  const liftedAnchors = new Set(lifted.flatMap((row) => landedAnchors({ row })));
  const onCard = rows.filter((row): row is CardLandedRow => row.kind === "landed" && row.cardKey === cardKey);
  const wrote = onCard.filter((row, at) => {
    const own = landedAnchors({ row });
    const grown = onCard.slice(0, at).some((before) => landedAnchors({ row: before }).some((one) => own.includes(one)));
    return !grown && own.some((one) => liftedAnchors.has(one));
  });
  return new Set(wrote.map((row) => rulingKey({ anchor: row.anchor, decidedIso: row.decidedIso, words: row.words })));
}

/**
 * One ruling's identity, as a landing writes it: its anchor, decision instant and words.
 *
 * @returns the three joined by NUL
 */
function rulingKey({ anchor, decidedIso, words }: RulingIdentity): string {
  return `${anchor}\0${decidedIso}\0${words}`;
}
