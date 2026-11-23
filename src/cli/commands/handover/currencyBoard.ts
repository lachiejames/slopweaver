/**
 * `handover currency`'s board half: the board composed the way `handover list --json` composes it, and the asks the
 * Queue draws off it — each board row waiting on the owner with a question, and each detached ask.
 *
 * The board covers what the Queue draws from these same files, so a board file or run journal that will not read
 * does not refuse the reading: the console draws no card from either, and one it still holds from an earlier poll
 * finds no row and reads "not checked as it stands" — never fresh. Refusing would blank every card's ranking over one
 * bad file (declined, the reason pinned by `currencyBoard.test.ts`).
 */
import { archivedDependencies, type JournalEvidence, journalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { CurrencyAsk } from "../../../handover/currency.js";
import type { DetachedAsk } from "../../../handover/detachedAsk.js";
import type { DocProbeState, HandoverDoc } from "../../../handover/doc.js";
import { rulingBeforeRepeatedQuestion } from "../../../handover/heldQuestion.js";
import { OWNER_WAIT_KIND } from "../../../handover/ownerWait.js";
import type { RulingIdentity } from "../../../handover/ruling.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { publishedWaitOf } from "./listJsonWait.js";
import { recoveredModels, recoverListJournals } from "./listRecovery.js";

/**
 * When an ask's facts were last re-checked: the later of the doc's still-real instant and the run's own reconfirm.
 *
 * `handover reconfirm` writes the front matter on a row with no run and journals `question-reconfirmed` on one
 * that has a run, so reading the doc alone left every reconfirmed run-backed card "not confirmed" (two reconfirmed
 * cards still read so minutes later). The run half is
 * absent once a new question replaces the reconfirmed one (`openQuestion.ts`), so a re-ask is never confirmed by
 * a check of the question it replaced. Both halves are also bound by time: under a waiting run each counts only from
 * the instant the run asked its open question, so neither a check of the registered ask the run superseded
 * nor a reconfirm of an earlier asking of the same text confirms the question open now.
 *
 * @param model the composed row
 * @returns the later instant, or `undefined` when neither source carries one for the question open now
 */
export function askStillRealIsoOf({ model }: { model: Pick<BoardModel, "doc" | "run"> }): string | undefined {
  const { doc, run } = model;
  if (run.kind !== "waiting-on-owner") {
    return doc.stillRealIso;
  }
  const askedMs = Date.parse(run.askedIso);
  const docChecksThisQuestion = doc.stillRealIso !== undefined && Date.parse(doc.stillRealIso) >= askedMs;
  const fromDoc = docChecksThisQuestion ? doc.stillRealIso : undefined;
  const runChecksThisQuestion = run.reconfirmed !== undefined && Date.parse(run.reconfirmed.atIso) >= askedMs;
  const fromRun = runChecksThisQuestion ? run.reconfirmed.atIso : undefined;
  if (fromRun === undefined) {
    return fromDoc;
  }
  if (fromDoc === undefined) {
    return fromRun;
  }
  return Date.parse(fromRun) > Date.parse(fromDoc) ? fromRun : fromDoc;
}

/**
 * Every ask the board publishes as waiting on the owner with a question — the cards the Queue draws, a detached ask's
 * included, with nothing it does not carry: no anchor, no done-check, no re-confirmation.
 *
 * @param models the composed board
 * @param detachedAsks the runs waiting on the owner with no readable doc
 * @returns the asks
 */
function waitingAsks({
  models,
  detachedAsks,
  journals,
  runsDir,
}: {
  models: readonly BoardModel[];
  detachedAsks: readonly DetachedAsk[];
  journals: ReadonlyMap<string, JournalEvidence>;
  runsDir: string;
}): CurrencyAsk[] {
  const asks: CurrencyAsk[] = [];
  for (const model of models) {
    const published = publishedWaitOf({ model });
    if (published.wait.kind === OWNER_WAIT_KIND && published.question !== undefined) {
      const { anchor, doneWhen, slug } = model.doc;
      asks.push({
        anchor,
        askedIso: published.questionAskedIso,
        doneWhen,
        sameQuestionRuling: sameQuestionRulingOf({
          askedIso: published.questionAskedIso,
          journal: journals.get(slug),
          question: published.question,
        }),
        slug,
        stillRealIso: askStillRealIsoOf({ model }),
      });
    }
  }
  const onBoard = new Set(models.map((model) => model.doc.slug));
  for (const { askedIso, question, slug } of detachedAsks) {
    if (!onBoard.has(slug)) {
      asks.push({
        anchor: undefined,
        askedIso,
        doneWhen: [],
        // Its journal is all that is left of it, and it is enough to carry the owner's ruling.
        sameQuestionRuling: sameQuestionRulingOf({
          askedIso,
          journal: detachedEvidenceOf({ runsDir, slug }),
          question,
        }),
        slug,
        stillRealIso: undefined,
      });
    }
  }
  return asks;
}

/**
 * A detached ask's journal, read again — the recovery that found it keeps only its question. A journal that will not
 * read now (rewritten since that read) carries no ruling, so its card stays the owner's: the safe direction.
 */
function detachedEvidenceOf({ runsDir, slug }: { runsDir: string; slug: string }): JournalEvidence | undefined {
  const read = readRunJournal({ runsDir, slug });
  if (read.isErr()) {
    return undefined;
  }
  return { events: read.value.events, unreadableLines: read.value.unreadable };
}

/** The ruling an ask's journal holds on an earlier asking of its same words — none with no journal or no instant. */
function sameQuestionRulingOf({
  askedIso,
  journal,
  question,
}: {
  askedIso: string | undefined;
  journal: JournalEvidence | undefined;
  question: string;
}): RulingIdentity | undefined {
  if (askedIso === undefined || journal === undefined) {
    return undefined;
  }
  return rulingBeforeRepeatedQuestion({ askedIso, events: journal.events, question });
}

/**
 * The board with no probe sweep — the tick runs no doc's shell. A run waiting on the owner whose doc the scan did not hold
 * is recovered as `handover list` recovers it (`./listRecovery.ts`): its archived root composes in its own pass, and a
 * run with no readable doc at all is a detached ask the Queue still draws (`site/lib/detachedAskRow.ts`), so a doc
 * that will not read never takes its card out of the reading.
 *
 * @param docs the board's docs
 * @param handoverDir the board's directory, for archived dependencies and the archive
 * @param home the state home the run journals are read under
 * @param unreadable the board files the scan could not read
 * @returns the asks waiting on the owner; every doc's placement, in board order, then the recovered ones; the journals read
 */
export function currencyBoardOf({
  docs,
  handoverDir,
  home,
  unreadable,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  home: string;
  unreadable: readonly string[];
}): {
  asks: readonly CurrencyAsk[];
  models: readonly BoardModel[];
  journals: ReturnType<typeof journalEvidence>;
} {
  const runsDir = stateHomePaths({ home }).runs;
  const recovery = recoverListJournals({
    claimed: new Set(docs.map((doc) => doc.slug)),
    handoverDir,
    liveUnreadable: unreadable,
    runsDir,
  });
  const journals = new Map([...journalEvidence({ docs, runsDir }), ...recovery.journals]);
  const probeStates = new Map<string, DocProbeState>();
  const models = [
    ...composeBoardModels({
      journals,
      probeStates,
      resolutionDocs: [...docs, ...archivedDependencies({ docs, handoverDir })],
      roots: docs,
    }),
    ...recoveredModels({ docs, handoverDir, journals, probeStates, recovery }),
  ];
  return { asks: waitingAsks({ detachedAsks: recovery.detachedAsks, journals, models, runsDir }), journals, models };
}
