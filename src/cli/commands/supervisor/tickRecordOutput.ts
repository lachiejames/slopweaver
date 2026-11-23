/**
 * What a successful `supervisor tick-record` prints: one stdout line naming what it stored, or the same facts as a
 * `--json` document, and on stderr every stretch of the owner's the voice gate passed as still being spoken. Pure, so the
 * shell in `./tickRecordRun.ts` only writes it.
 */
import type { SupervisorTickRow } from "../../../supervisor/tickTypes.js";
import type { VoiceUnreadVerdict } from "../../../supervisor/voiceUnreadGate.js";
import type { UnreadWord } from "../../../talk/unreadWords.js";
import { stillSpokenLines, stillSpokenOf } from "./tickRecordVoice.js";

/**
 * Everything a recorded tick prints.
 *
 * @param json whether `--json` asked for the document instead of the line
 * @param ledger where the row was written
 * @param row the recorded row
 * @param voice the voice gate's verdict, which names every stretch still being spoken
 * @returns the stderr lines naming each still-spoken stretch, and the one stdout line
 */
export function recordedReport({
  json,
  ledger,
  row,
  voice,
}: {
  json: boolean;
  ledger: string;
  row: SupervisorTickRow;
  voice: VoiceUnreadVerdict;
}): { readonly diagnostics: readonly string[]; readonly out: string } {
  const stillSpoken = stillSpokenOf({ voice });
  return {
    diagnostics: stillSpokenLines({ stillSpoken }).map((line) => `supervisor tick-record: ${line}`),
    out: json ? recordedJson({ ledger, row, stillSpoken }) : recordedLine({ ledger, row }),
  };
}

/**
 * The one line a successful run prints, naming what it stored rather than only that it stored something.
 *
 * @param row the recorded row
 * @param ledger where it was written
 * @returns the line
 */
export function recordedLine({ row, ledger }: { row: SupervisorTickRow; ledger: string }): string {
  const bytes = row.stats.judgementUtf8Bytes + row.stats.structuredUtf8Bytes;
  return (
    `supervisor tick-record: recorded tick ${row.tickId} to ${ledger} — ` +
    `${String(row.ownerTurns.turns.length)} owner turn(s) stored verbatim (${row.ownerTurns.status}), ` +
    `${String(row.actions.length)} action(s), ${String(row.judgements.length)} judgement(s) ` +
    `at ${String(row.stats.judgementUtf8Bytes)} of ${String(bytes)} bytes`
  );
}

/**
 * The `--json` document a successful run prints: the same facts as {@link recordedLine}, one per field, plus the
 * pointer of every stretch the voice gate passed as still being spoken.
 *
 * @param row the recorded row
 * @param ledger where it was written
 * @param stillSpoken the stretches recorded past as still being spoken
 * @returns the document, serialised
 */
export function recordedJson({
  row,
  ledger,
  stillSpoken,
}: {
  row: SupervisorTickRow;
  ledger: string;
  stillSpoken: readonly UnreadWord[];
}): string {
  return JSON.stringify({
    finalisedIso: row.finalisedIso,
    judgements: row.judgements.length,
    ledger,
    ownerTurnStatus: row.ownerTurns.status,
    ownerTurns: row.ownerTurns.turns.length,
    stillSpoken: stillSpoken.map((word) => word.pointer),
    tickId: row.tickId,
  });
}
