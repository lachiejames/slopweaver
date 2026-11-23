/**
 * The half of `sweep board` that is about THEM rather than the board: the `UNCARDED` judgement over terminal rows
 * (`../../../sweep/uncarded.ts`), the `--queue` daily card (`../../../sweep/dailyQueue.ts`), and taking the sweep's
 * own earlier cards back off their Queue once a later pass contradicts them (`../../../sweep/cardRetirement.ts`).
 * Split out of `./boardRun.ts` along that seam, so the verb's file holds the pass and this one holds what reaches
 * their Queue.
 */
import { type JournalEvidence } from "../../../handover/assemble.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { handPageStepsOf } from "../../../handover/pageDelivery.js";
import { closureSettlePrecondition } from "../../../review/closureRowState.js";
import { retiredSweepCards } from "../../../sweep/cardRetirement.js";
import { type SweepCandidate } from "../../../sweep/classify.js";
import { sweepQueuePlan } from "../../../sweep/dailyQueue.js";
import { pagesCardedOnBoard, uncardedCandidate } from "../../../sweep/uncarded.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { settleAskRow } from "../handover/settleRowRun.js";
import { type PageReachReaders } from "../handover/uncardedPageGate.js";

import {
  type AutomaticActDeps,
  type AutomaticActKind,
  performAutomaticActs,
  productionAutomaticActDeps,
} from "./automaticActs.js";
import { registerVerbArgv } from "./registerVerbCall.js";

/** What retiring one of the sweep's own cards is, as both ledgers record it. */
const CARD_RETIRE_KIND: AutomaticActKind = {
  flag: "--queue",
  kind: "retire-own-sweep-card",
  said: "I took an earlier board-sweep card off your Queue: a later sweep found nothing left on it, or today's card carries what is.",
  session: "sweep board --queue",
  why: "the card was only that morning's reading of the board, and a later reading contradicts it, and a card must say what it is about, which a stale one no longer does",
};

/**
 * The `UNCARDED` candidates among the terminal rows, judged against the registers read once for the whole pass.
 *
 * @param models every composed row, which the board-wide carded-page map is built over
 * @param terminal the closed rows in the requested cohort, the only ones this verdict judges
 * @param journals each row's journal, keyed by slug
 * @param home the resolved state home a `file:` page must live under
 * @param pageReach the lock-in ledger and hand register readers
 * @returns the candidates, or none with one line per register that would not read
 */
export function uncardedCandidates({
  pageReach,
  home,
  journals,
  models,
  terminal,
}: {
  pageReach: PageReachReaders;
  home: string;
  journals: ReadonlyMap<string, JournalEvidence>;
  models: readonly BoardModel[];
  terminal: readonly BoardModel[];
}): { candidates: readonly SweepCandidate[]; unread: readonly string[] } {
  const ruled = pageReach.ruledIdentities({ home });
  const steps = pageReach.handSteps({ home });
  if (ruled.isErr() || steps.isErr()) {
    return { candidates: [], unread: [...(ruled.isErr() ? ruled.error : []), ...(steps.isErr() ? steps.error : [])] };
  }
  const facts = {
    cardedOnBoard: pagesCardedOnBoard({ home, journals, models }),
    handPageSteps: handPageStepsOf({ home, steps: steps.value }),
    ruledIdentities: ruled.value,
  };
  const candidates = terminal.flatMap((model) => {
    const journal = journals.get(model.doc.slug);
    // A row nobody ever ran has no journal; its settlement and artifact are still judged.
    const events = journal === undefined ? [] : journal.events;
    const candidate = uncardedCandidate({ events, facts, home, model });
    return candidate === undefined ? [] : [candidate];
  });
  return { candidates, unread: [] };
}

/** The seams `--queue` writes through. */
export interface QueueDailyCardDeps {
  readonly now: () => Date;
  readonly registerQueueRow: ({ argv }: { argv: readonly string[] }) => Promise<number>;
  readonly writeDiagnostic: (line: string) => void;
  /** The settle, sweep ledger and autonomy ledger an own card is retired through. */
  readonly retire: AutomaticActDeps;
}

/**
 * Register the pass's daily Queue card, or say why there is none — then retire the sweep's own cards this pass
 * contradicts. Nothing is retired when today's card would not register: an earlier card is the only one the owner has then.
 *
 * @param candidates every row the pass classified, after its acts
 * @param deps the clock, the registrar, the retirement writes and the diagnostic channel
 * @param docs the docs the pass scanned, which say whether today's card is already on the board
 * @param home the resolved state home the card registers into
 * @returns `EXIT_OK` when the card is registered, already there or not needed, else the error exit
 */
export async function queueDailyCard({
  candidates,
  deps,
  docs,
  home,
}: {
  candidates: readonly SweepCandidate[];
  deps: QueueDailyCardDeps;
  docs: readonly HandoverDoc[];
  home: string;
}): Promise<number> {
  const nowIso = deps.now().toISOString();
  const plan = sweepQueuePlan({ candidates, home, nowIso });
  if (plan === undefined) {
    deps.writeDiagnostic("sweep board: --queue registered nothing — no UNCARDED page");
  } else if (docs.some((doc) => doc.slug === plan.slug)) {
    deps.writeDiagnostic(`sweep board: --queue left ${plan.slug} as it is — today's card is already on the board`);
  } else {
    const code = await deps.registerQueueRow({ argv: plan.argv });
    if (code !== EXIT_OK) {
      deps.writeDiagnostic(
        `sweep board: --queue could not register ${plan.slug} (exit ${String(code)}) — both documents are written; re-run with --write --queue`,
      );
      return EXIT_ERROR;
    }
    deps.writeDiagnostic(`sweep board: --queue registered ${plan.slug} — ${String(plan.uncarded)} uncarded page(s)`);
  }
  const retired = retiredSweepCards({ candidates, nowIso, plan });
  if (retired.length === 0) {
    return EXIT_OK;
  }
  const outcome = await performAutomaticActs({
    acts: retired.map(({ candidate, witness }) => ({
      act: "settle" as const,
      call: registerVerbArgv({
        rest: [candidate.slug, "--as", "answered", "--witness", witness, "--home", home],
        verb: "settle",
      }),
      candidate,
      reason: "SWEEP_CARD_RETIRED" as const,
      witness,
    })),
    deps: deps.retire,
    kind: CARD_RETIRE_KIND,
  });
  // A card a seat holds is left and the pass is still clean; an act no ledger recorded is a failed run.
  return outcome.stopped ? EXIT_ERROR : EXIT_OK;
}

/**
 * The real retirement writes over one home: `handover settle --as answered`, re-judged at the write against nobody
 * being on the card, then both ledgers.
 *
 * @param home the state home the board and both ledgers live under
 * @returns the production retirement dependencies
 */
export function productionCardRetireDeps({ home }: { home: string }): AutomaticActDeps {
  return productionAutomaticActDeps({
    home,
    runVerb: ({ act, out }) => settleAskRow({ argv: act.call.argv, out, precondition: closureSettlePrecondition }),
  });
}
