/**
 * `sweep board --close-shipped` — the board sweep closes a `SHIPPED` row itself, journalled, and never cards it.
 *
 * ## Why this verdict is automatic now
 *
 * A daily card asking the owner whether to close a row whose own witness already says the work is in asks about
 * landing something they already ruled on: it is a card with nothing to decide. A SHIPPED witness is a closed
 * journal event — a session saying the work is in — or every declared probe passing; closing on it is rule 10's
 * "obvious to a session that knows the owner → do it, recorded". The act is the one `sweep apply` already runs for
 * SHIPPED (`./applyRun.ts` `actCall`), so there is one close, never a second spelling of it.
 *
 * ## What bounds it
 *
 * - **Capped per pass** at {@link AUTOMATIC_ACT_CAP} (`./automaticActs.ts`); the rest are printed for the next pass.
 * - **Re-judged under the row's closing lock**: a row whose run reads `active` (parked included) or
 *   `waiting-on-owner`, a row a seat was dispatched to that has not started yet, or one whose journal will not read,
 *   is left — a seat that picked it up after the board was read ends it itself. Residue: a lifecycle verb journals a
 *   run's start without the closing lock, so a start landing between that read and the append is not seen, and
 *   `cmux spawn` journals its `dispatched` line only once the workspace is open and its pickup is delivered, so a
 *   close landing in the seconds before that line is not seen either.
 * - **Every gate `handover close` holds stands** — the uncarded-page gate refuses a row whose page never reached the
 *   owner's Queue, and that row is left, printed, while the pass moves on.
 * - **Journalled twice**: the sweep ledger (`sweep list`) and the autonomy ledger the Fleet Briefing's "done for
 *   you, without asking" section reads.
 * - **Unprobed**: the scheduled pass never runs `command:` probes, so a SHIPPED verdict there rests on the journal
 *   or on file/commit probes — the risk the old card named (a probe passing for the wrong reason) is what the
 *   ledger's witness makes findable afterwards, not something a card prevented.
 */
import { hasUnansweredDispatch } from "../../../handover/attention.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { readRunJournal } from "../../../handover/runStore.js";
import type { SweepCandidate } from "../../../sweep/classify.js";
import { closeRowInProcess } from "../handover/closeRun.js";
import { type ClosePrecondition } from "../handover/closeUnderLock.js";

import { actCall } from "./applyRun.js";
import {
  type AutomaticAct,
  type AutomaticActDeps,
  type AutomaticActKind,
  type AutomaticActOutcome,
  performAutomaticActs,
  productionAutomaticActDeps,
} from "./automaticActs.js";

/** What a `--close-shipped` act is, as both ledgers record it. */
const SHIPPED_CLOSE_KIND: AutomaticActKind = {
  flag: "--close-shipped",
  kind: "close-shipped-board-row",
  said: "I closed a board row whose own record already said the work was in, without carding it to you.",
  session: "sweep board --close-shipped",
  why: "its run journal records the close, or every probe it declares passes, and a shipped row is landing the owner already ruled on, so it needs no Queue card",
};

/**
 * The acts `--close-shipped` performs: one `handover close` per SHIPPED row, built exactly as `sweep apply` builds it.
 *
 * @param candidates every row the pass classified
 * @param home the state home the board lives under
 * @returns one act per SHIPPED row, in board order
 */
function shippedCloseActs({
  candidates,
  home,
}: {
  candidates: readonly SweepCandidate[];
  home: string;
}): readonly AutomaticAct[] {
  return candidates
    .filter((candidate) => candidate.verdict === "SHIPPED")
    .flatMap((candidate) => {
      const routed = actCall({ candidate, declineAnchor: undefined, declineReason: undefined, dir: undefined, home });
      if (routed.isErr() || routed.value === undefined) {
        return [];
      }
      return [
        { act: "close" as const, call: routed.value, candidate, reason: candidate.verdict, witness: candidate.witness },
      ];
    });
}

/**
 * Why a SHIPPED row is left as its journal reads under the closing lock, or undefined to close it.
 *
 * @param doc the row as `handover close` read it
 * @param runsDir where its journal lives
 * @returns the hold, or undefined when nobody is on the row
 */
const shippedClosePrecondition: ClosePrecondition = ({ doc, runsDir }) => {
  const journal = readRunJournal({ runsDir, slug: doc.slug });
  if (journal.isErr()) {
    return "its journal would not read, so nothing here is sure the row is unattended";
  }
  const run = runDisposition({ events: journal.value.events, unreadableLines: journal.value.unreadable }).kind;
  if (run === "active" || run === "waiting-on-owner" || run === "unreadable") {
    return `its run is ${run}, and that run ends it`;
  }
  // A seat `cmux spawn` sent but which has not started yet reads `never-started`; its `dispatched` line is the hold.
  if (hasUnansweredDispatch({ events: journal.value.events })) {
    return "a seat was dispatched to it and has not started yet, so that seat ends it";
  }
  return undefined;
};

/**
 * Close every SHIPPED row, one at a time, up to the cap.
 *
 * @param candidates every row the pass classified
 * @param home the state home the board lives under
 * @param deps the writes
 * @returns the rows closed and how many closes ran
 */
export async function closeShippedRows({
  candidates,
  home,
  deps,
}: {
  candidates: readonly SweepCandidate[];
  home: string;
  deps: AutomaticActDeps;
}): Promise<AutomaticActOutcome> {
  return performAutomaticActs({ acts: shippedCloseActs({ candidates, home }), deps, kind: SHIPPED_CLOSE_KIND });
}

/**
 * The real writes over one home: `handover close` re-judged under its lock, the sweep ledger and the autonomy ledger.
 *
 * @param home the state home both ledgers live under
 * @returns the production dependencies for {@link closeShippedRows}
 */
export function productionShippedCloseDeps({ home }: { home: string }): AutomaticActDeps {
  return productionAutomaticActDeps({
    home,
    runVerb: ({ act, out }) => closeRowInProcess({ argv: act.call.argv, out, precondition: shippedClosePrecondition }),
  });
}
