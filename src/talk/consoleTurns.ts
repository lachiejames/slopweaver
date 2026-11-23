/**
 * Every steer the owner gave the console, read as a SOURCE of their words — `profile words`'s console half. Unlike
 * `./relayStore.ts`'s receipt readers, which answer "what reached the board", this answers "what did the owner say", so it
 * keeps a steer whose registration failed and names every one it could not read rather than leaving it out.
 */
import type { Result } from "../lib/result.js";
import type { TalkError } from "./errors.js";
import { readRelayLedger, readTurn, type TurnRecord } from "./relayStore.js";
import { readEveryTurnFile } from "./turnFiles.js";

/**
 * Every receipted steer inside the window whose turn file is gone, and every reason the ledger could not say. A
 * receipt is appended when a relay registers, so a turn file deleted after it would otherwise vanish with nothing
 * to show it was ever there. A receipt staged before the floor, or at or after the ceiling, is
 * outside the window; one whose staging instant will not parse is kept, as it cannot be placed.
 *
 * The residue, stated rather than closed: `markRegistered` writes the turn file BEFORE the
 * receipt on purpose, so a crash between the two leaves a registered turn with no receipt, and if that file is later
 * lost too, nothing here names it. Closing it needs a record written before the turn file, a change to the relay
 * store's write path this reader does not make.
 */
function receiptsWithoutFile({
  floor,
  ceiling,
  home,
  present,
}: {
  floor: number;
  ceiling: number;
  home: string;
  present: ReadonlySet<string>;
}): readonly string[] {
  const ledger = readRelayLedger({ home });
  if (ledger.isErr()) {
    return [
      `the relay ledger would not read, so a receipted steer whose turn file is gone would not show: ${ledger.error.message}`,
    ];
  }
  const missing = ledger.value.rows
    .filter((row) => {
      const staged = Date.parse(row.stagedAtIso);
      return !present.has(row.turnId) && !(staged < floor) && !(staged >= ceiling);
    })
    .map((row) => `talk:${row.turnId} is receipted in the relay ledger but its turn file is gone`);
  if (ledger.value.undecoded > 0) {
    missing.push(
      `${String(ledger.value.undecoded)} relay ledger line(s) would not decode, so a receipted steer whose turn file is gone may not show`,
    );
  }
  return [...new Set(missing)];
}

/**
 * Every steer the owner gave the console, spoken or typed, staged inside `[sinceIso, untilIso)`, whatever became of it —
 * `readRelayTurns`'s `sinceIso` read keeps only the registered ones, and a steer whose registration failed is still
 * the owner's words. A turn file that will not read is named rather than failing the rest: nothing says whether it falls
 * inside the window, so it may hold one of the owner's. So is a turn whose staging instant will not parse, for the same
 * reason — a NaN floor comparison would otherwise drop it unseen — and a receipted turn whose
 * file is gone. The ceiling cuts here rather than only in the query, because a turn past it can still become a gap
 * (a relay with none of the owner's words), and a gap is never cut. A receipted turn whose file is on
 * disk but will not read is named once, by its read failure, never also as gone.
 *
 * @param home the Slopweaver home
 * @param sinceIso the floor its staging must be at or after
 * @param untilIso the ceiling, exclusive, its staging must be before
 * @returns the turns, oldest first, and why each unreadable file, undated turn or lost receipted turn was not read —
 *   or why the directory would not
 */
export function readConsoleTurns({
  home,
  sinceIso,
  untilIso,
}: {
  home: string;
  sinceIso: string;
  untilIso: string;
}): Result<{ readonly turns: readonly TurnRecord[]; readonly unreadable: readonly string[] }, TalkError> {
  const floor = Date.parse(sinceIso);
  const ceiling = Date.parse(untilIso);
  return readEveryTurnFile({ home, lowercaseOnly: true, readTurn }).map((read) => {
    const undated = read.turns.filter((turn) => Number.isNaN(Date.parse(turn.stagedAtIso)));
    return {
      turns: read.turns
        .filter((turn) => {
          const staged = Date.parse(turn.stagedAtIso);
          return staged >= floor && staged < ceiling;
        })
        .toSorted((a, b) => Date.parse(a.stagedAtIso) - Date.parse(b.stagedAtIso)),
      unreadable: [
        ...read.failures.map((failure) => failure.message),
        ...undated.map((turn) => `talk:${turn.turnId} carries no readable staging instant (${turn.stagedAtIso})`),
        // Case-folded: a receipted file under a capitalised name is already named above, never also as gone.
        ...receiptsWithoutFile({ ceiling, floor, home, present: new Set(read.onDisk.map((id) => id.toLowerCase())) }),
      ],
    };
  });
}
