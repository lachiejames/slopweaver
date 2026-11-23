/**
 * Decoding one whole journal LINE — the JSON, the two fields every event carries, then the kind's own decoder.
 *
 * Its own module so `./ledger.ts` stays the event vocabulary and the phase fold, and `./ledgerDecode.ts` the
 * per-kind decoders: this is the one entry point the whole-file read and every streaming reader share.
 *
 * Pure: no filesystem, no clock.
 */
import { isRecord } from "#lib/parsers.js";

import type { RunEvent } from "./ledger.js";
import { eventFromKind } from "./ledgerDecode.js";

/**
 * Decode one journal line, or `undefined` when it is not a usable event.
 *
 * Exported because a caller that must not hold the whole journal in one string cannot use `./ledger.ts`'s
 * `parseLedger`: `whole-file-json` refuses a `readFileSync` of a `.jsonl`, since an append-only stream has no
 * ceiling. Such a caller streams with `readJsonlLines` and decodes each line here, which is the same decode
 * `parseLedger` performs — one function, so the two readings cannot drift.
 *
 * @param line one raw line of a run journal
 * @returns the decoded event, or `undefined` for a blank, malformed or unknown-kind line
 */
export function decodeLedgerLine({ line }: { line: string }): RunEvent | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(payload) || typeof payload["kind"] !== "string" || typeof payload["atIso"] !== "string") {
    return undefined;
  }
  return eventFromKind({ kind: payload["kind"], payload });
}
