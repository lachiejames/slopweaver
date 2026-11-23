/**
 * `slopweaver talk find-card <words>...` — is there already a card for this: every board row ranked against the owner's words
 * by what it is about, the best named with where it stands, or one line saying there is none.
 *
 * Why it exists, and why it matches on topic and never on the slug, is `src/talk/cardFind.ts`. This file is the
 * reading, and its one decision is WHERE the board is composed. `handover list` composes all of it — every journal,
 * every declarative probe — in about ten seconds on a board of 7,065 docs
 * (`time slopweaver handover list --json | wc -c`), against the sixteen seconds the voice's verb tool gives a child
 * (`./verbRun.ts`). So every doc's text and journal is read — the journal for the question an open ask puts to the
 * owner — ONCE, 32 files at a time (`scanBoardConcurrently`, `journalEvidenceConcurrently`): a serial read, which
 * opened every doc a second time for the owner's words, took the call past those sixteen seconds on 10,264 docs (the
 * measurement is `docs/console/voice-finds-a-card-by-topic.md`). Only the rows the owner's words reached, with
 * every row their `blockedBy` reaches (`compositionRoots`), are composed
 * through `composeBoardModels` exactly as `handover list` runs it: their declarative probes, under a budget of their
 * own. A `command:` probe is never run, as `handover list` runs none without `--probe`. A run waiting on the owner's word whose
 * doc left the board is searched too, swept exactly as `handover list` sweeps it, because the Queue draws it. It writes
 * nothing.
 */
import { archivedDependencies, type JournalEvidence, journalEvidenceConcurrently } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { DetachedAsk } from "../../../handover/detachedAsk.js";
import { type HandoverDoc, isTerminalDocStatus } from "../../../handover/doc.js";
import { OWNER_WAIT_KIND } from "../../../handover/ownerWait.js";
import { scanBoardConcurrently } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import type { DraftMediaOf } from "../../../outbound/slack/draftProof.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { stateHomePaths } from "../../../stateHome.js";
import { boardRowOwnerWords } from "../../../talk/boardRow.js";
import { type CardText, compositionRoots, type FoundCard, findCards, rowWordMemo } from "../../../talk/cardFind.js";
import { cardFindLines, type PlacedCard } from "../../../talk/cardFindLines.js";
import type { PlacedDraft } from "../../../talk/queueDraftFind.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { publishedWaitOf } from "../handover/listJsonWait.js";
import { recoveredModels, recoverListJournals } from "../handover/listRecovery.js";
import { deadlineIn, probeStates } from "../handover/probeSweep.js";
import { heldMediaOf } from "../slack/draftMediaEvidence.js";
import { talkHomeOf } from "./args.js";
import { parseFindCardArgs } from "./findCardArgs.js";
import { cardRowsOf, heldDraftsFound, heldDraftsOf } from "./findCardReads.js";
import { TALK_FIND_CARD_USAGE } from "./knowUsage.js";
import { talkPositionalArgsErrorLines } from "./positionalArgsErrors.js";

/** How many argv entries precede the verb's own arguments: `[node, bin, "talk", "find-card", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * How many of the best text matches among rows not authored finished are composed onto the board. A pool of their
 * own, because 4,618 of 7,066 rows were DONE on a measured board and a topic raised before gathers closed rows:
 * one pool, cut at forty, held one live row (`talk find-card voice capability tools access agents verbs browser`).
 */
const LIVE_POOL = 24;

/** How many of the best text matches among rows authored finished are composed, for "that one is already done". */
const CLOSED_POOL = 6;

/**
 * The probe sweep's budget over those matches, inside the voice verb tool's sixteen-second child deadline. It is
 * checked BETWEEN docs, as `handover list`'s is, so one declarative probe blocked inside a read (a `present:` aimed at
 * a FIFO) is bounded only by that child deadline: the gateway kills the verb and the voice
 * ends the turn on a miss. A row the budget never reached is named as written and marked unchecked.
 */
const PROBE_DEADLINE_SECONDS = 8;

/**
 * Run the `talk find-card` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkFindCard(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_FIND_CARD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFindCardArgs({ rest });
  if (parsed.isErr()) {
    talkPositionalArgsErrorLines({ error: parsed.error }).forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_FIND_CARD_USAGE });
    return EXIT_USAGE;
  }
  const { home: named, json, words } = parsed.value;
  const home = talkHomeOf({ home: named });
  const handoverDir = resolveHandoverDir({ dir: undefined, home });
  const scan = await scanBoardConcurrently({ handoverDir, keep: boardRowOwnerWords });
  if (scan.isErr()) {
    logger.error({ msg: `talk find-card: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  // A register that would not read is an error, never "no draft": the Queue cannot draw one either, and a miss said
  // off a failed read is the same wrong answer again.
  const held = heldDraftsOf({ home });
  if (held.isErr()) {
    logger.error({ msg: `talk find-card: ${held.error}` });
    return EXIT_ERROR;
  }
  const runsDir = stateHomePaths({ home }).runs;
  const found = searchBoard({
    docs: scan.value.docs,
    handoverDir,
    held: held.value,
    journals: await journalEvidenceConcurrently({ docs: scan.value.docs, runsDir }),
    mediaOf: heldMediaOf({ home }),
    runsDir,
    scanUnreadable: scan.value.unreadable,
    scannedOwnerWords: scan.value.kept,
    words,
  });
  printFound({ found, json, words });
  return EXIT_OK;
}

/** What one search found, as `searchBoard` returns it. */
type BoardSearch = ReturnType<typeof searchBoard>;

/** Prints one search's answer: its lines and what it could not read, or the one `--json` document. */
function printFound({ found, json, words }: { found: BoardSearch; json: boolean; words: readonly string[] }): void {
  const { drafts, draftsSearched, placed, rowsMatching, rowsSearched, search, unreadable, unresolved } = found;
  const lines = cardFindLines({
    closeAtTop: search.closeAtTop,
    drafts,
    draftsSearched,
    placed,
    rowsSearched,
    said: words,
    unsearchable: search.unsearchable,
  });
  if (json) {
    const answer = { answer: lines.join("\n"), cards: placed, closeAtTop: search.closeAtTop, drafts };
    const counts = { draftsSearched, matching: rowsMatching, matchingDrafts: drafts.length, rowsSearched };
    logger.out({
      line: JSON.stringify({
        ...answer,
        ...counts,
        searched: search.searched,
        unreadable,
        unresolvedProbes: unresolved,
      }),
    });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
  if (unreadable.length > 0) {
    logger.out({
      line: `  ${String(unreadable.length)} board doc(s) would not read whole, so a match there may be missed`,
    });
  }
  if (unresolved > 0) {
    logger.out({ line: `  ${String(unresolved)} row(s)' probes did not finish; their state is as authored` });
  }
}

/** Each run waiting on the owner's word whose doc left the board, as the topic search reads it: the question it asks. */
function detachedRows({ asks }: { asks: readonly DetachedAsk[] }): readonly CardText[] {
  return asks.map((ask): CardText => ({
    askedIso: ask.askedIso,
    path: ask.journal,
    slug: ask.slug,
    texts: [ask.question],
  }));
}

/**
 * Search every row the Queue could draw — the board's docs, and the runs waiting on the owner's word whose doc left the board,
 * swept exactly as `handover list` sweeps them, so none is answered "there is no card for that yet" — and place the best matches.
 */
function searchBoard({
  docs,
  handoverDir,
  held,
  journals: boardJournals,
  mediaOf,
  runsDir,
  scannedOwnerWords,
  scanUnreadable,
  words,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  held: readonly SlackDraftItem[];
  /** Every board doc's journal, read once by the caller. */
  journals: ReadonlyMap<string, JournalEvidence>;
  mediaOf: DraftMediaOf;
  runsDir: string;
  scanUnreadable: readonly string[];
  /** The owner's words the scan took off every board doc's text, keyed by path. */
  scannedOwnerWords: ReadonlyMap<string, readonly string[]>;
  words: readonly string[];
}): {
  drafts: readonly PlacedDraft[];
  draftsSearched: number;
  placed: readonly PlacedCard[];
  rowsMatching: number;
  rowsSearched: number;
  search: ReturnType<typeof findCards>;
  unreadable: readonly string[];
  unresolved: number;
} {
  const recovery = recoverListJournals({
    claimed: new Set(docs.map((doc) => doc.slug)),
    handoverDir,
    liveUnreadable: scanUnreadable,
    runsDir,
  });
  const journals = new Map([...boardJournals, ...recovery.journals]);
  const recovered = recoveredModels({ docs, handoverDir, journals, probeStates: new Map(), recovery });
  const read = cardRowsOf({ docs: [...docs, ...recovered.map((model) => model.doc)], journals, scannedOwnerWords });
  const rows = [...read.rows, ...detachedRows({ asks: recovery.detachedAsks })];
  // One memo across both rankings, so the board's rows are counted once.
  const counted = rowWordMemo();
  const search = findCards({ counted, rows, words });
  const { drafts, queued } = heldDraftsFound({ counted, docs, held, mediaOf, rows, words });
  const offBoard = { detachedAsks: recovery.detachedAsks, recovered };
  const { placed, unresolved } = placeFound({ docs, found: search.found, handoverDir, journals, offBoard });
  return {
    drafts,
    draftsSearched: queued.length,
    placed,
    rowsMatching: search.found.length,
    rowsSearched: rows.length,
    search,
    unreadable: [...scanUnreadable, ...read.unreadable],
    unresolved,
  };
}

/**
 * The best live and closed matches placed on the board: composed with every row their `blockedBy` reaches, exactly as
 * `handover list` composes them, each marked unchecked when the probe budget never reached it or a row it waits on.
 * Keyed by file, never by slug: two docs may carry one slug, and the board places each.
 */
function placeFound({
  docs,
  found,
  handoverDir,
  journals,
  offBoard,
}: {
  docs: readonly HandoverDoc[];
  found: readonly FoundCard[];
  handoverDir: string;
  journals: ReadonlyMap<string, JournalEvidence>;
  offBoard: OffBoard;
}): { placed: readonly PlacedCard[]; unresolved: number } {
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  const docsBySlug = Map.groupBy(docs, (doc) => doc.slug);
  const authoredDone = new Set(docs.filter((doc) => isTerminalDocStatus(doc.status)).map((doc) => doc.path));
  const reached = [
    ...found.filter((card) => !authoredDone.has(card.path)).slice(0, LIVE_POOL),
    ...found.filter((card) => authoredDone.has(card.path)).slice(0, CLOSED_POOL),
  ].toSorted((a, b) => b.score - a.score);
  const onBoard = reached.filter((card) => byPath.has(card.path));
  const roots = compositionRoots({ board: docs, found: onBoard.map((card) => card.slug) }).flatMap((slug) =>
    docsBySlug.get(slug)!,
  );
  const deadline = deadlineIn({ seconds: PROBE_DEADLINE_SECONDS });
  const sweep = probeStates({ base: undefined, deadline, docs: roots, runCommands: false });
  const resolutionDocs = [...docs, ...archivedDependencies({ docs, handoverDir })];
  const models = composeBoardModels({ journals, probeStates: sweep.states, resolutionDocs, roots });
  const sectionByPath = new Map(models.map((model) => [model.doc.path, model.section]));
  // The Queue draws off this verdict, not the section, so a card is "on the owner's Queue" only when `handover list --json`
  // would publish it as theirs (a row the owner had already ruled on, named as a card, is refused by open_card).
  const waitByPath = new Map(models.map((model) => [model.doc.path, publishedWaitOf({ model }).wait.kind]));
  // A row the budget cut the sweep short of composes as written, and so does any row waiting on one:
  // each such card says so rather than reading as the section `handover list` would give it.
  const uncheckedSlugs = new Set(
    roots
      .filter((doc) => (doc.doneWhen.length > 0 || doc.outputs.length > 0) && doc.repo !== undefined)
      .filter((doc) => !sweep.states.has(doc.path))
      .map((doc) => doc.slug),
  );
  const placed = reached.map((card): PlacedCard => {
    if (!byPath.has(card.path)) {
      return offBoardPlaced({ card, offBoard });
    }
    return {
      matched: card.matched,
      ownerWait: waitByPath.get(card.path)!,
      section: sectionByPath.get(card.path)!,
      slug: card.slug,
      summary: byPath.get(card.path)!.summary,
      unchecked: compositionRoots({ board: docs, found: [card.slug] }).some((slug) => uncheckedSlugs.has(slug)),
    };
  });
  return { placed, unresolved: sweep.unresolved };
}

/** The waiting runs whose doc left the board, as `handover list` recovers them (`../handover/listRecovery.ts`). */
interface OffBoard {
  /** An archived doc's run still waiting on the owner, composed in its own pass and never probed. */
  readonly recovered: readonly BoardModel[];
  /** A waiting run whose doc is gone: the Queue draws it as the owner's, WAITING ON OWNER (`site/lib/detachedAskRow.ts`). */
  readonly detachedAsks: readonly DetachedAsk[];
}

/** A found row that is not a board doc, placed where `handover list --json` publishes it. */
function offBoardPlaced({ card, offBoard }: { card: FoundCard; offBoard: OffBoard }): PlacedCard {
  const model = offBoard.recovered.find((recovered) => recovered.doc.path === card.path);
  if (model !== undefined) {
    return {
      matched: card.matched,
      ownerWait: publishedWaitOf({ model }).wait.kind,
      section: model.section,
      slug: card.slug,
      summary: model.doc.summary,
      unchecked: false,
    };
  }
  const ask = offBoard.detachedAsks.find((detached) => detached.journal === card.path)!;
  return {
    matched: card.matched,
    ownerWait: OWNER_WAIT_KIND,
    section: "WAITING ON OWNER",
    slug: card.slug,
    summary: ask.question,
    unchecked: false,
  };
}

export const talkFindCardCommand = defineCommand({ run: runTalkFindCard });
