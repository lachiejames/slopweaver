/**
 * `handover close`'s terminal write, held under the row's closing lock (`./closingLock.ts`) behind the uncarded-page
 * gate — the same stretch `handover finish` and `handover settle` hold. `close` records that a row SHIPPED and ends
 * it, so a close that skipped either half would end a row whose page never reached the owner's Queue: without the gate on
 * any journal, and without the lock between `page publish`'s open-run read and its artifact write.
 */
import type { HandoverDoc } from "../../../handover/doc.js";
import { type RunEvent, runStateOf } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { acquireClosingLock } from "./closingLock.js";
import { type PageReachReaders, uncardedPageGateRefuses } from "./uncardedPageGate.js";

/** A caller's own refusal, asked under the closing lock: why the row is left, or undefined to close it. */
export type ClosePrecondition = (args: { doc: HandoverDoc; runsDir: string }) => string | undefined;

/**
 * Take the row's closing lock, ask the caller's precondition, refuse an uncarded page artifact, and append the
 * `closed` event — after `--artifact`'s pointer when one is given, which the gate judges as a candidate first, so a
 * page named on the close itself is gated rather than recorded behind it.
 *
 * @param doc the row being closed
 * @param home the state home holding the lock, the registers and any `file:` page
 * @param runsDir where the row's journal lives
 * @param summary what shipped, already trimmed
 * @param artifact the pointer `--artifact` names, already trimmed; absent when none was given
 * @param nowIso the instant the lock and the events carry
 * @param readers how the lock-in ledger and hand register are read; the install's own when absent
 * @param precondition a caller's refusal judged under the lock, so a seat picking the row up after the caller read
 *   the board is seen; none for a hand close
 * @returns the journal path written, or the exit code to stop on
 */
export function closeUnderClosingLock({
  doc,
  home,
  runsDir,
  summary,
  artifact,
  nowIso,
  readers,
  precondition,
}: {
  doc: HandoverDoc;
  home: string;
  runsDir: string;
  summary: string;
  artifact?: string | undefined;
  nowIso: string;
  readers?: PageReachReaders | undefined;
  precondition?: ClosePrecondition | undefined;
}): { readonly path: string } | number {
  const lock = acquireClosingLock({ home, nowIso, slug: doc.slug });
  if (lock.isErr()) {
    logger.error({ msg: `handover close: a settle, finish or page publish of ${doc.slug} is running — ${lock.error}` });
    return EXIT_ERROR;
  }
  try {
    if (refusedUnderLock({ artifact, doc, home, precondition, readers, runsDir })) {
      return EXIT_ERROR;
    }
    if (artifact !== undefined) {
      const pointed = append({
        event: { atIso: nowIso, kind: "artifact", url: artifact },
        runsDir,
        slug: doc.slug,
        verb: "close",
      });
      if (typeof pointed === "number") {
        return pointed;
      }
    }
    return append({
      event: { atIso: nowIso, kind: "closed", residue: [], summary },
      runsDir,
      slug: doc.slug,
      verb: "close",
    });
  } finally {
    lock.value.release();
  }
}

/** Whether the close is refused under the lock: the caller's precondition, then the uncarded-page gate, each printing why. */
function refusedUnderLock({
  doc,
  home,
  runsDir,
  artifact,
  readers,
  precondition,
}: {
  doc: HandoverDoc;
  home: string;
  runsDir: string;
  artifact: string | undefined;
  readers: PageReachReaders | undefined;
  precondition: ClosePrecondition | undefined;
}): boolean {
  const held = precondition === undefined ? undefined : precondition({ doc, runsDir });
  if (held !== undefined) {
    logger.error({ msg: `handover close: ${doc.slug} was left — ${held}` });
    return true;
  }
  return uncardedPageGateRefuses({
    candidate: artifact === undefined ? { kind: "artifact" } : { kind: "settlement", witness: artifact },
    doc,
    home,
    readers,
    runsDir,
    verb: "close",
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
  });
}

/** Append one event, printing why it would not land. */
function append({
  event,
  runsDir,
  slug,
  verb,
}: {
  event: RunEvent;
  runsDir: string;
  slug: string;
  verb: string;
}): { readonly path: string } | number {
  const written = applyRowEvent({ event, runsDir, slug });
  if (written.isErr()) {
    logger.error({ msg: `handover ${verb}: ${written.error.message}` });
    return EXIT_ERROR;
  }
  return { path: written.value.path };
}

/**
 * `handover artifact`'s write, under the row's closing lock so it never lands between a closer's page-gate read and
 * its terminal write. On a row already CLOSED the new pointer is gated as a candidate first: a page
 * pointed at after the close would otherwise sit on a closed row having met no gate.
 *
 * @param doc the row whose artifact is recorded
 * @param home the state home holding the lock, the registers and any `file:` page
 * @param runsDir where the row's journal lives
 * @param url the pointer to record, already trimmed
 * @param nowIso the instant the lock and the event carry
 * @param readers how the lock-in ledger and hand register are read; the install's own when absent
 * @returns the journal path written, or the exit code to stop on
 */
export function artifactUnderClosingLock({
  doc,
  home,
  runsDir,
  url,
  nowIso,
  readers,
}: {
  doc: HandoverDoc;
  home: string;
  runsDir: string;
  url: string;
  nowIso: string;
  readers?: PageReachReaders | undefined;
}): { readonly path: string } | number {
  const lock = acquireClosingLock({ home, nowIso, slug: doc.slug });
  if (lock.isErr()) {
    logger.error({ msg: `handover artifact: ${doc.slug} is being closed, so nothing was written — ${lock.error}` });
    return EXIT_ERROR;
  }
  try {
    const journal = readRunJournal({ runsDir, slug: doc.slug });
    const closed =
      journal.isOk() &&
      journal.value.events.length > 0 &&
      runStateOf({ events: journal.value.events }).phase === "closed";
    const candidate = { kind: "settlement", witness: url } as const;
    if (
      closed &&
      uncardedPageGateRefuses({
        candidate,
        doc,
        home,
        readers,
        runsDir,
        verb: "artifact",
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
      })
    ) {
      return EXIT_ERROR;
    }
    return append({ event: { atIso: nowIso, kind: "artifact", url }, runsDir, slug: doc.slug, verb: "artifact" });
  } finally {
    lock.value.release();
  }
}
