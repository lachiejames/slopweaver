/**
 * What `handover settle` says after the row is written — its receipt, then the RUN's residue. The RUN behind the row is a separate ending, closed here
 * only when nobody can close it otherwise: its holder is dead, or it was parked or released and never claimed. Split from `./settleRowRun.ts` (the file-size ratchet) along that seam — the row's
 * settlement is finished before anything in this file runs, and nothing here writes the row.
 */
import type { HandoverDoc } from "../../../handover/doc.js";
import { type RunEvent, runStateOf } from "../../../handover/ledger.js";
import { planReap, reapCandidateOf } from "../../../handover/reap.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import type { AskSettlement } from "../../../handover/rowKind.js";
import { currentSessionIds } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { type CardPlan, cardOutcomeLine } from "../../../handover/settleCard.js";
import {
  releasedCycleEnding,
  releasedCycleMoved,
  releasedCycleOf,
  settleReapedLines,
  settleReleasedLines,
  settleRunResidue,
  settleRunResidueLines,
} from "../../../handover/settleEnding.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { nowIso } from "./lifecycleRunCore.js";
import { applyReap, reapLivenessSeams } from "./reapRun.js";

/** Where `handover settle`'s receipt and residue lines go — stdout for the verb, a caller's own channel in-process. */
export type SettleOut = (args: { line: string }) => void;

/**
 * An in-process caller's own refusal, asked under the settle's lock of the row exactly as it is about to be written
 * over — `github landing --register` holds a row a seat or a person has reached since it looked.
 */
export type SettlePrecondition = (args: { doc: HandoverDoc; home: string }) => string | undefined;

/** The settlement `settle` just wrote — what decides the ending of a cycle nobody holds. */
export interface SettledAs {
  readonly settlement: AskSettlement;
  readonly witness: string;
  readonly reason: string | undefined;
}

/**
 * End an open cycle nobody holds with the ending the settlement implies, or leave it for the caller.
 *
 * Decided over the read the residue came from, and re-checked by `releasedCycleMoved` INSIDE `applyRowEvent`, over
 * the read its own transition checks use — so a reseat claiming the run in between is refused rather than closed
 * The window between that read and the append is the accepted residue
 * `../../../handover/staleHolder.ts` states for a reap.
 *
 * @param events the journal as `reportRunResidue` read it
 * @param runsDir the runs directory the journal lives in
 * @param settled the settlement just written
 * @returns the exit code when this cycle was released and handled, `undefined` when it is not released
 */
function endReleasedCycle({
  events,
  out,
  runsDir,
  settled,
  slug,
}: {
  events: readonly RunEvent[];
  out: SettleOut;
  runsDir: string;
  settled: SettledAs;
  slug: string;
}): number | undefined {
  const decided = releasedCycleOf({ events });
  if (decided === undefined) {
    return undefined;
  }
  const ending = releasedCycleEnding({ ...settled, atIso: nowIso() });
  const appended = applyRowEvent({
    event: ending,
    precondition: ({ events: now, unreadable }) => releasedCycleMoved({ decided, events: now, unreadable }),
    runsDir,
    slug,
  });
  if (appended.isErr()) {
    logger.error({
      msg:
        `handover settle: the settlement is written, but the released run was not closed: ${appended.error.message} ` +
        `— read it with \`slopweaver handover resume ${slug}\``,
    });
    return EXIT_ERROR;
  }
  settleReleasedLines({
    ending: ending.kind,
    releasedAtIso: decided.releasedAtIso,
    releasedBy: decided.releasedBy,
    slug,
  }).forEach((line) => {
    out({ line });
  });
  return EXIT_OK;
}

/**
 * The receipt a written settlement prints: the row is settled, and what became of the relay's card when it had one.
 *
 * @param plan what the settle did to the relay's card, when the row named one
 * @returns the lines, in order
 */
export function settledReceiptLines({
  slug,
  settlement,
  witness,
  plan,
}: {
  slug: string;
  settlement: AskSettlement;
  witness: string;
  plan: CardPlan;
}): readonly string[] {
  const cardLine = cardOutcomeLine({ plan });
  const settled = `handover settle: ${slug} is settled ${settlement} (witness: ${witness})`;
  return cardLine === undefined ? [settled] : [settled, cardLine];
}

/**
 * Say what settling did NOT end, or end it when nobody else ever can. The row is closed; the RUN is a
 * separate ending, so a session reading only the success line above is one that leaves its workspace
 * unreapable — `../../../handover/settleEnding.ts` carries the measurement and the repro.
 *
 * An open cycle whose writer the reaper would call DEAD is closed here with the reaper's own decision and
 * event, because the NEXT lines would be addressed to a session that no longer exists. Every other open cycle
 * keeps the NEXT lines: a live holder finishes its own run, and an `unknown` one is never reaped.
 *
 * An open cycle nobody HOLDS — parked at rest or released — is closed here too, with the ending the settlement
 * implies (`releasedCycleEnding`), for the same reason: no session can follow a NEXT line on a released run.
 *
 * @param home the state home the journal lives under
 * @param slug the row just settled
 * @param out where the residue lines go — stdout for the verb, a caller's own channel in-process
 * @param settled the settlement just written, which decides the ending of a cycle nobody holds
 * @returns the verb's exit code — an unreadable journal or a refused reap is an error even though the
 *   settlement is written
 */
export async function reportRunResidue({
  home,
  slug,
  out,
  settled,
}: {
  home: string;
  slug: string;
  out: SettleOut;
  settled: SettledAs;
}): Promise<number> {
  const runsDir = stateHomePaths({ home }).runs;
  const events = readSettledJournal({ runsDir, slug });
  if (typeof events === "number") {
    return events;
  }
  const residue = settleRunResidue({ run: runStateOf({ events }) });
  const open = residue.kind === "open" || residue.kind === "waiting-on-owner";
  // The registry is read only for a cycle that is still open — the one case a reap can follow from.
  const candidate = open
    ? reapCandidateOf({
        events,
        selfSessionIds: currentSessionIds({ env: process.env }),
        slug,
        unreadableLines: [],
        ...reapLivenessSeams(),
      })
    : undefined;
  const plan = planReap({ candidates: candidate === undefined ? [] : [candidate] });
  const reaped = plan.reapable[0];
  if (reaped === undefined && open) {
    const released = endReleasedCycle({ events, out, runsDir, settled, slug });
    if (released !== undefined) {
      return released;
    }
  }
  if (reaped === undefined) {
    settleRunResidueLines({ residue, slug }).forEach((line) => {
      out({ line });
    });
    return EXIT_OK;
  }
  const failures = await applyReap({ home, nowIso: nowIso(), plan });
  if (failures.length > 0) {
    failures.forEach((failure) => {
      logger.error({ msg: `handover settle: the settlement is written, but the dead run was not reaped: ${failure}` });
    });
    return EXIT_ERROR;
  }
  settleReapedLines({ deadSessionId: reaped.deadSessionId, lastEventIso: reaped.lastEventIso, slug }).forEach(
    (line) => {
      out({ line });
    },
  );
  return EXIT_OK;
}

/**
 * Read the settled row's run journal whole, refusing one with undecodable lines.
 *
 * @param runsDir the runs directory the journal lives in
 * @returns every decoded event, or the exit code of the error already logged
 */
function readSettledJournal({ runsDir, slug }: { runsDir: string; slug: string }): readonly RunEvent[] | number {
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    logger.error({ msg: `handover settle: the settlement is written, but ${journal.error.message}` });
    return EXIT_ERROR;
  }
  if (journal.value.unreadable.length > 0) {
    // An open cycle derived from only the lines that decoded is a guess, and the one it would miss could be the
    // very ending it is about to duplicate — so neither a reap nor a NEXT line is printed over it.
    logger.error({
      msg:
        `handover settle: the settlement is written, but the run journal has undecodable line(s) ` +
        `${journal.value.unreadable.join(", ")}, so its run ending cannot be judged — read it with ` +
        `\`slopweaver handover resume ${slug}\``,
    });
    return EXIT_ERROR;
  }
  return journal.value.events;
}
