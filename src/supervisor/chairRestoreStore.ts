/**
 * The ledger of `/model fable` sends the chair has made at itself — the state `./chairRestore.ts`'s
 * `exhausted` branch needs and deliberately does not hold.
 *
 * It exists for one failure only: a restore that never takes. The decision is pure and the count is not, so
 * the count lives here, one append-only file in `ledgers/supervisor/` beside the tick ledger, keyed by the
 * fallback instant rather than by the session — a second trip in the same chair gets its own budget instead
 * of inheriting a spent one.
 *
 * Append-only JSONL rather than a rewritten document, because two ticks racing on a read-modify-write of one
 * JSON object would lose an attempt, and losing an attempt is the direction that retries forever. Growth is
 * bounded by the thing it counts: at most {@link ./chairRestore.MAX_RESTORE_ATTEMPTS} rows per trip, and there
 * have been three trips in four days.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { isRecord } from "#lib/parsers.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { supervisorLedgerDir } from "./tickStore.js";

/** Owner-only permissions, matching `./intakeStore.ts` and the rest of `$SLOPWEAVER_HOME/supervisor`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** One `/model fable` send the chair made at its own workspace. */
interface ChairRestoreAttempt {
  readonly atIso: string;
  /** The `chairRestoreKey` this answered — session id and the fallback instant. */
  readonly key: string;
  readonly workspaceId: string;
}

/**
 * Where the attempts are recorded.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the absolute path of the attempts file
 */
export function chairRestoreAttemptsPath({ home }: { home: string }): string {
  return join(supervisorLedgerDir({ home }), "chair-restore-attempts.jsonl");
}

/**
 * How many sends have already answered one key.
 *
 * A file that is not there yet is ZERO attempts, which is a fact rather than a failure — no chair has tripped
 * on this install. Any other read failure is reported as zero too, and that direction is deliberate: it makes
 * the chair try the cheap remedy again rather than jump to spending a chair over an unreadable counter.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param key the `chairRestoreKey` to count
 * @returns how many attempts have been recorded against it
 */
export function countChairRestoreAttempts({ home, key }: { home: string; key: string }): number {
  const path = chairRestoreAttemptsPath({ home });
  let seen = 0;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (!line.includes(key)) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        if (isRecord(parsed) && parsed["key"] === key) {
          seen += 1;
        }
      },
      path,
    });
  } catch {
    return seen;
  }
  return seen;
}

/**
 * Record that a send was made.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param key the `chairRestoreKey` it answered
 * @param workspaceId the workspace it was typed into
 * @param nowIso the instant it was sent
 */
export function recordChairRestoreAttempt({
  home,
  key,
  workspaceId,
  nowIso,
}: {
  home: string;
  key: string;
  workspaceId: string;
  nowIso: string;
}): void {
  const path = chairRestoreAttemptsPath({ home });
  mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
  const row: ChairRestoreAttempt = { atIso: nowIso, key, workspaceId };
  appendLines({ mode: FILE_MODE, path, text: `${JSON.stringify(row)}\n` });
}
