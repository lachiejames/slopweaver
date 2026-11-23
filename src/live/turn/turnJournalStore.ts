/**
 * Where one turn's own journal lives on disk — append-only, keyed exactly like `./dispatchStore.ts` keys a
 * dispatch record, so an ask's worker, its dispatch, its review and its text history all answer to one name.
 *
 * An append (`appendLines`) rather than a read-modify-write, for the same reason `./progressLog.ts` uses it: more
 * than one process may write this file — every `turn resume` the worker runs — and a read-modify-write
 * between two loses whichever row lost the race. A single append of one line under the platform's own
 * atomic-append guarantee cannot.
 *
 * The pure half — the row shape, the parse and the line rendering — is `./turnJournal.ts`.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AskIdentity } from "../ask/identity.js";
import { parseTurnJournalLine, type TurnJournalRow, turnJournalLine } from "./turnJournal.js";

/**
 * Where one ask's journal file lands.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns the absolute path
 */
export function turnJournalPath({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): string {
  return join(stateHomePaths({ home }).live.slack.turnJournal, `${askIdentity.channel}-${askIdentity.messageTs}.jsonl`);
}

/**
 * Append one row to an ask's journal, creating the directory on first write.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @param row the row to append
 */
export function appendTurnJournalRow({
  askIdentity,
  home,
  row,
}: {
  askIdentity: AskIdentity;
  home: string;
  row: TurnJournalRow;
}): void {
  const path = turnJournalPath({ askIdentity, home });
  mkdirSync(dirname(path), { recursive: true });
  appendLines({ path, text: turnJournalLine({ row }) });
}

/**
 * Read one ask's whole journal back. An absent or unreadable file is an EMPTY journal, never an error — a
 * turn that has never edited a reviewed answer has nothing to say here, which is the ordinary case.
 *
 * The read STREAMS, through `readJsonlLines`. A journal's size is a property of how long its turn ran and
 * how often its author rewrote, never of anything in the code that shaped it, which is exactly the class
 * `.claude/rules/typescript-patterns.md` keeps out of a single JS string.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns every row that parsed, in file order
 */
export function readTurnJournal({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): readonly TurnJournalRow[] {
  const rows: TurnJournalRow[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        const row = parseTurnJournalLine({ line });
        if (row !== undefined) {
          rows.push(row);
        }
      },
      path: turnJournalPath({ askIdentity, home }),
    });
  } catch {
    return [];
  }
  return rows;
}
