/**
 * The owner-turn receipt journal on disk: `$SLOPWEAVER_HOME/ledgers/supervisor/owner-turn-receipts.jsonl`.
 *
 * Beside the tick ledger rather than under `handovers/`, because what it holds is a LOG of deliveries rather
 * than the owner's own rulings — `../stateHome.ts` carries that distinction and why `queue/` and `promises/`
 * sit outside `ledgers/` while this belongs inside it.
 *
 * Read with `readJsonlLines` and appended one line at a time, per `.claude/rules/typescript-patterns.md`:
 * its size comes from how many turns a fleet of chairs has been shown, which is data, not code.
 *
 * Both failures come back as an `IngestError` off `../lib/safeBoundary.ts`'s `safeFs`, which is the shared
 * infra-boundary error `.claude/rules/error-handling.md` reserves for exactly this: a filesystem call that
 * failed is not a domain fact about receipts, and authoring a sentence about it here would be a second,
 * weaker claim about what the operating system already said.
 */
import { existsSync, mkdirSync } from "node:fs";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import type { IngestError } from "../lib/ingestError.js";
import { ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import {
  type OwnerTurnReceipt,
  parseOwnerTurnReceipt,
  type ReadableTurn,
  readTurnPointers,
} from "./ownerTurnReceipts.js";
import type { VisibleSupervisorSession } from "./session.js";
import { supervisorLedgerDir } from "./tickStore.js";

/** The mode every ledger file in this repository is written with. */
const FILE_MODE = 0o600;

/**
 * Where the receipts live.
 *
 * @internal — read by this module and its own tests; a caller reaches for the two verbs below.
 * @param home the state home (defaults to the resolved home)
 * @returns the journal's absolute path
 */
export function ownerTurnReceiptPath({ home }: { home?: string } = {}): string {
  return `${supervisorLedgerDir(home === undefined ? {} : { home })}/owner-turn-receipts.jsonl`;
}

/**
 * Every receipt on record.
 *
 * A file that is not there yields none — a fresh install has shown nobody anything — while any other read
 * failure is reported, because a chair booting on a silently empty journal would be told it had read
 * everything.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the rows in file order, or the boundary error that stopped the read
 */
export function readOwnerTurnReceipts({ home }: { home?: string } = {}): Result<
  readonly OwnerTurnReceipt[],
  IngestError
> {
  const path = ownerTurnReceiptPath(home === undefined ? {} : { home });
  if (!existsSync(path)) {
    return ok([]);
  }
  const rows: OwnerTurnReceipt[] = [];
  return safeFs({
    execute: () => {
      readJsonlLines({
        onLine: ({ line }) => {
          const row = parseOwnerTurnReceipt({ line });
          if (row !== undefined) {
            rows.push(row);
          }
        },
        path,
      });
      return rows;
    },
    operation: "readOwnerTurnReceipts",
    path,
  });
}

/**
 * Which of the window's turns this session has been shown, read off the journal on disk.
 *
 * A journal that will not read yields NONE rather than everything: the safe direction is to show the owner
 * their turns again, never to report a chair as having read what nobody can prove it was shown.
 *
 * @param turns the window's turns, so a ruling read under another copy's pointer counts
 * @param session the session asking, by host and id
 * @param home the state home (defaults to the resolved home)
 * @returns the pointers of the turns it has been shown
 */
export function readTurnsShown({
  turns,
  session,
  home,
}: {
  turns: readonly ReadableTurn[];
  session: VisibleSupervisorSession;
  home?: string;
}): ReadonlySet<string> {
  const receipts = readOwnerTurnReceipts(home === undefined ? {} : { home });
  if (receipts.isErr()) {
    return new Set<string>();
  }
  return readTurnPointers({ receipts: receipts.value, session, turns });
}

/**
 * Append one receipt per turn just printed.
 *
 * @param receipts the rows to record, in print order
 * @param home the state home (defaults to the resolved home)
 * @returns the path written, or the boundary error that stopped the append
 */
export function appendOwnerTurnReceipts({
  receipts,
  home,
}: {
  receipts: readonly OwnerTurnReceipt[];
  home?: string;
}): Result<string, IngestError> {
  const dir = supervisorLedgerDir(home === undefined ? {} : { home });
  const path = ownerTurnReceiptPath(home === undefined ? {} : { home });
  if (receipts.length === 0) {
    return ok(path);
  }
  return safeFs({
    execute: () => {
      mkdirSync(dir, { mode: 0o700, recursive: true });
      appendLines({
        mode: FILE_MODE,
        path,
        text: `${receipts.map((receipt) => JSON.stringify(receipt)).join("\n")}\n`,
      });
      return path;
    },
    operation: "appendOwnerTurnReceipts",
    path,
  });
}
