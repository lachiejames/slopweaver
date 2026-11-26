/**
 * `cmux takeover` over a GONE predecessor: a chair the supervisor pin record names whose host no longer holds it
 * (`../../../supervisor/gonePredecessor.ts`). Gate (c) and step 5 for that case, beside `./takeoverRow.ts`'s live ones.
 *
 * Gate (c) is the same test a live predecessor passes: its run must have reached a terminal phase. A chair that died
 * mid-run reaches one through `handover reap`, whose `orphaned` event is written only once the live-session registry
 * proves its writer gone, so the host's silence alone never retires a chair. It is stricter in two ways, since no host
 * stands behind a gone chair to contradict a wrong read: a journal holding any line this checkout cannot decode
 * refuses, and the close is folded over the ledger first and must end exactly the one row. Step 5 has nothing to
 * close in any host, so it ends the chair's open ledger row, which is what a close would have written.
 */

import { predecessorRunNotFinishedRefusal } from "../../../cmux/takeover.js";
import { hasUnansweredDispatch } from "../../../handover/attention.js";
import { currentCycle, type RunPhase, runStateOf } from "../../../handover/ledger.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { appendSessionEvent, readSessionLogText } from "../../../sessions/sessionStore.js";
import type { SupervisorPinTarget } from "../../../sessions/supervisorPin.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  gonePredecessorCloseEvent,
  gonePredecessorCloseReach,
  gonePredecessorLabel,
  gonePredecessorLedgerRow,
} from "../../../supervisor/gonePredecessor.js";
import { runNote } from "./takeoverRow.js";

/** Gate (c)'s passing arm for a gone predecessor: its label, the slug step 6 closes and the row step 5 ends. */
export interface GonePredecessorRun {
  readonly label: string;
  readonly slug: string;
  readonly row: SessionItem;
}

/**
 * Gate (c) for a gone predecessor: its one open ledger row by the exact id the pin record carries, then the same
 * terminal-phase check a live predecessor's run passes.
 *
 * @param home the state home the ledger and journals live under
 * @param target where the pin record says the chair was hosted
 * @returns the predecessor's label, slug and row, or the refusal that stops the takeover
 */
export function gonePredecessorRunGate({
  home,
  target,
}: {
  home: string | undefined;
  target: SupervisorPinTarget;
}): { readonly refusal: string } | GonePredecessorRun {
  const label = gonePredecessorLabel({ target });
  const { events } = parseSessionLog({ text: readSessionLogText(home === undefined ? {} : { home }) });
  const found = gonePredecessorLedgerRow({ rows: foldSessions({ events }), target });
  if (found.isErr()) {
    return { refusal: found.error.message };
  }
  const row = found.value;
  const { slug } = row;
  if (slug === undefined) {
    return { refusal: `${label}'s ledger row names no handover slug, so its run cannot be confirmed finished` };
  }
  const phase = goneRunPhase({ home, label, slug });
  if ("refusal" in phase) {
    return phase;
  }
  const { runPhase } = phase;
  logger.out({
    line: `cmux takeover: step 3/6 — predecessor run: ${runNote({ runPhase, slug })}, its host no longer holds it`,
  });
  const refusal = predecessorRunNotFinishedRefusal({ predecessorRef: label, runPhase, slug });
  if (refusal !== undefined) {
    return { refusal };
  }
  const reach = gonePredecessorCloseReach({ events, row });
  if (reach !== 1) {
    return {
      refusal: `ending ${label}'s ledger row (${slug}) would end ${String(reach)} open row(s), not exactly that one — end the right one by hand and move the pin yourself`,
    };
  }
  return { label, row, slug };
}

/**
 * A gone predecessor's run phase, read only from a journal every line of which decoded: an older terminal cycle
 * standing before a line this checkout cannot read says nothing about the latest run, so that journal refuses.
 *
 * @returns the phase (`undefined` when the journal holds no run), or the refusal that stops the takeover
 */
function goneRunPhase({
  home,
  label,
  slug,
}: {
  home: string | undefined;
  label: string;
  slug: string;
}): { readonly refusal: string } | { readonly runPhase: RunPhase | undefined } {
  const journal = readRunJournal({ runsDir: stateHomePaths(home === undefined ? {} : { home }).runs, slug });
  if (journal.isErr()) {
    return { refusal: `${label}'s run journal (${slug}) could not be read — ${journal.error.message}` };
  }
  const { events, unreadable } = journal.value;
  if (unreadable.length > 0) {
    return {
      refusal: `${label}'s run journal (${slug}) holds ${String(unreadable.length)} line(s) this checkout could not decode (line ${unreadable.join(", ")}), so its latest run cannot be read finished — pull, or repair the journal`,
    };
  }
  if (hasUnansweredDispatch({ events })) {
    return {
      refusal: `${label}'s run journal (${slug}) ends on a dispatch nothing answered, so a newer attempt may be under way — abandon that dispatch first (\`slopweaver handover abandon ${slug}\`)`,
    };
  }
  if (currentCycle({ events }).length === 0) {
    return { runPhase: undefined };
  }
  return { runPhase: runStateOf({ events }).phase };
}

/**
 * Step 5 for a gone predecessor: no host holds it, so end its open ledger row, naming its id the way a close of a
 * parked session does, so the fold lands on exactly that row. The ledger is read again and the close folded over it
 * once more just before the append, since a row written after gate (c) could share the chair's address; the append
 * itself is not locked, so this narrows that window rather than closing it.
 *
 * @param home the state home the ledger lives under
 * @param run the gated predecessor
 * @param nowIso when the row is ended
 * @returns true when the row was ended, false when the recheck printed why it was left open
 */
export function endGonePredecessorRow({
  home,
  run,
  nowIso,
}: {
  home: string | undefined;
  run: GonePredecessorRun;
  nowIso: string;
}): boolean {
  const homeOption = home === undefined ? {} : { home };
  const { events } = parseSessionLog({ text: readSessionLogText(homeOption) });
  const reach = gonePredecessorCloseReach({ events, row: run.row });
  if (reach !== 1) {
    logger.error({
      msg: `cmux takeover: step 5/6 — ${run.label}'s ledger row would now end ${String(reach)} open row(s), not exactly that one, so it was left open — end the right one by hand`,
    });
    return false;
  }
  appendSessionEvent({ event: gonePredecessorCloseEvent({ row: run.row, tsIso: nowIso }), ...homeOption });
  logger.out({ line: `cmux takeover: step 5/6 — ${run.label} is already gone; ended its ledger row` });
  return true;
}
