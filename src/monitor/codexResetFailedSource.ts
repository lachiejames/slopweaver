/**
 * The effectful edge of `codex-reset-failed`: read the reset claims journal and hand it to the pure evaluator
 * (`./codexResetFailed.ts`). A journal that is not there yet is an empty one — nothing has been claimed, so nothing
 * failed — and one that cannot be read is unmeasurable, never clear.
 */
import { readCodexResetJournal } from "../codex/resetJournalStore.js";

import { evaluateCodexResetFailed } from "./codexResetFailed.js";
import type { MonitorReading } from "./types.js";

/**
 * Read and judge the reset claims journal.
 *
 * @param home the state home whose journal is read
 * @param nowIso the instant of the pass
 * @returns the monitor's reading
 */
export function readCodexResetFailed({ home, nowIso }: { home: string; nowIso: string }): MonitorReading {
  const journal = readCodexResetJournal({ home });
  if (journal.isErr()) {
    return evaluateCodexResetFailed({ nowIso, rows: { kind: "unreadable", why: journal.error.message } });
  }
  return evaluateCodexResetFailed({ nowIso, rows: { kind: "read", rows: journal.value } });
}
