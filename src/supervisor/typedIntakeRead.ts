/**
 * The effectful edge of the typed console intake (`./typedIntake.ts`): read the ledger, discover typed owner turns in the
 * call files written since its floor, append what is new, judge what is pending, and append what was covered.
 *
 * An ABSENT ledger is a fresh install and reads as no events, exactly as `./intakeStore.ts` reads the mark ledger. A
 * PRESENT one that cannot be read, or an append that fails, makes the whole typed half unavailable rather than zero:
 * a sweep reading it as empty would say every typed turn was witnessed.
 *
 * Two concurrent readers may append the same `observed` line twice. The fold keys on the pointer, so a duplicate is
 * inert, and no lock is taken. A `scanned` line is appended only when every call file read, so a file that would not
 * read is scanned again next time rather than stepped past.
 */
import { mkdirSync } from "node:fs";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { readRecentCallEntries } from "../talk/callStore.js";
import { offShapeTypedSegmentCount, typedOwnerTurnCandidates } from "../talk/typedOwnerIntake.js";
import type { IntakeMark, RowAnchors } from "./intake.js";
import {
  coveredEvents,
  newlyObserved,
  parseTypedIntakeLine,
  pendingTypedTurns,
  type TypedIntakeEvent,
  type TypedIntakeFinding,
  type TypedIntakeReport,
  typedDiscoveryFloor,
  witnessTypedTurns,
} from "./typedIntake.js";

/** Owner-only permissions, matching `./intakeStore.ts`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** A thrown value's message. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Read the typed intake ledger, one line at a time.
 *
 * @param home the state home
 * @returns every decodable event and the undecodable count; empty when the ledger is absent, an error when present and
 *   unreadable
 */
function readTypedIntakeJournal({
  home,
}: {
  home: string;
}): Result<{ events: readonly TypedIntakeEvent[]; undecodable: number }> {
  const path = stateHomePaths({ home }).typedIntakeJsonl;
  const events: TypedIntakeEvent[] = [];
  let undecodable = 0;
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ line }) => {
        if (line.trim() === "") {
          return;
        }
        const event = parseTypedIntakeLine({ line });
        if (event === undefined) {
          undecodable += 1;
        } else {
          events.push(event);
        }
      },
      path,
    });
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok({ events: [], undecodable: 0 });
    }
    return err([`typed console intake at ${path} could not be read: ${causeText({ cause })}`]);
  }
  return ok({ events, undecodable });
}

/**
 * Append events to the typed intake ledger.
 *
 * @param home the state home
 * @param events the lines to append; none appends nothing
 * @returns nothing, or why the append failed
 */
function appendTypedIntakeEvents({
  home,
  events,
}: {
  home: string;
  events: readonly TypedIntakeEvent[];
}): Result<void> {
  if (events.length === 0) {
    return ok(undefined);
  }
  const paths = stateHomePaths({ home });
  try {
    mkdirSync(paths.sessions, { mode: DIR_MODE, recursive: true });
    const text = events.map((event) => `${JSON.stringify(event)}\n`).join("");
    appendLines({ mode: FILE_MODE, path: paths.typedIntakeJsonl, text });
    return ok(undefined);
  } catch (cause) {
    return err([`typed console intake at ${paths.typedIntakeJsonl} could not be written: ${causeText({ cause })}`]);
  }
}

/**
 * Discover, remember and judge the owner's typed console turns.
 *
 * @param home the state home, where the call files and both ledgers live
 * @param sinceIso a floor the caller asked for; it can widen discovery, never narrow what is already remembered
 * @param nowIso the instant grace is judged at and the scan is recorded through
 * @param rows the board, narrowed to its pointer-bearing fields
 * @param marks the intake mark ledger
 * @returns the typed half of the intake report
 */
export function readTypedIntake({
  home,
  sinceIso,
  nowIso,
  rows,
  marks,
}: {
  home: string;
  sinceIso: string | undefined;
  nowIso: string;
  rows: readonly RowAnchors[];
  marks: readonly IntakeMark[];
}): TypedIntakeReport {
  const judged = judgeTypedIntake({ home, marks, nowIso, rows, sinceIso });
  if (judged.isErr()) {
    return { kind: "unavailable", why: judged.error.join("; ") };
  }
  return { finding: judged.value, kind: "read" };
}

/** {@link readTypedIntake}'s steps, as one `Result`. */
function judgeTypedIntake({
  home,
  sinceIso,
  nowIso,
  rows,
  marks,
}: {
  home: string;
  sinceIso: string | undefined;
  nowIso: string;
  rows: readonly RowAnchors[];
  marks: readonly IntakeMark[];
}): Result<TypedIntakeFinding> {
  const journal = readTypedIntakeJournal({ home });
  if (journal.isErr()) {
    return err(journal.error);
  }
  const floorIso = typedDiscoveryFloor({ events: journal.value.events, nowIso, sinceIso });
  const recent = readRecentCallEntries({ home, sinceIso: floorIso });
  if (recent.isErr()) {
    return err([`the call files could not be listed: ${recent.error.message}`]);
  }
  const callsUnreadable = [
    ...recent.value.unreadable,
    ...recent.value.calls.flatMap((call) =>
      call.skipped > 0 ? [`${call.callId}: ${String(call.skipped)} line(s) did not parse`] : [],
    ),
  ];
  const candidates = typedOwnerTurnCandidates({ calls: recent.value.calls, floorIso });
  const observed = newlyObserved({ candidates, events: journal.value.events });
  const scanned: readonly TypedIntakeEvent[] =
    callsUnreadable.length === 0 ? [{ kind: "scanned", throughIso: nowIso }] : [];
  const appended = appendTypedIntakeEvents({ events: [...observed, ...scanned], home });
  if (appended.isErr()) {
    return err(appended.error);
  }
  const unreadable = [...callsUnreadable];
  if (journal.value.undecodable > 0) {
    unreadable.push(`typed intake ledger: ${String(journal.value.undecodable)} line(s) did not decode`);
  }
  const offShape = offShapeTypedSegmentCount({ calls: recent.value.calls, floorIso });
  if (offShape > 0) {
    unreadable.push(`${String(offShape)} typed segment(s) with an id the page does not mint, counted and never named`);
  }
  const finding = witnessTypedTurns({
    discoveredFromIso: floorIso,
    marks,
    nowIso,
    rows,
    turns: pendingTypedTurns({ events: [...journal.value.events, ...observed] }),
    unreadable,
  });
  const covered = appendTypedIntakeEvents({ events: coveredEvents({ finding, nowIso }), home });
  if (covered.isErr()) {
    return err(covered.error);
  }
  return ok(finding);
}
