/**
 * The call quarantine ledger, `$SLOPWEAVER_HOME/talk/call-quarantine.jsonl` (`0600`): one row per console-voice call
 * whose file is gone and whose loss was accepted on the record, so `talk unread` reads past it instead of refusing
 * every read of the owner's words forever.
 *
 * ## Why a ledger, and never an edit of the index or a cursor
 *
 * The call index (`./callStore.ts`'s `callIndexPath`) and each reader's cursor are the witnesses that a call
 * existed: they are why a deleted file is refused rather than read as a call that never was. Editing either to make
 * a read go through would destroy exactly that witness. A quarantine row is a SECOND witness beside them — who
 * accepted the loss, when, and why — and the index and cursors are never touched. MEASURED: a seat
 * removed four e2e test-call files from the real home by hand, and every supervisor read of the owner's words was refused
 * from then until this ledger existed (`skills/supervisor/reference/voice-unread.md`).
 *
 * ## Strict, like the index
 *
 * A line that is not byte for byte the one the verb writes for its row (`quarantineLine`), a second row for one call,
 * a blank interior line or a tail with no newline is damage, and the whole ledger is refused: skipping a line would
 * forget a quarantine, and the read would refuse a call it had accepted, or worse, a reader could be handed a
 * hand-written row it cannot tell from one the verb wrote.
 */
import { dirname, join } from "node:path";

import { z } from "zod";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { stateHomePaths } from "../stateHome.js";

import { isCallId } from "./callId.js";
import { type CallQuarantineError, CallQuarantineErrors } from "./callQuarantineErrors.js";
import { isMissing } from "./unreadCursorStore.js";

/** One accepted loss. */
export interface CallQuarantineRow {
  /** The call whose file is gone. */
  readonly callId: string;
  /** What removed it and why its words are not the owner's, or are lost — as whoever accepted it said. */
  readonly reason: string;
  /** When the loss was accepted, canonical ISO. */
  readonly atIso: string;
  /** The visible session that accepted it, or `null` when the environment named none. */
  readonly session: string | null;
}

/**
 * Whether text is blank by Unicode's own White_Space property, which `trim()` is not — it leaves U+0085 standing.
 *
 * @returns whether nothing but whitespace is there
 */
export function isBlank({ text }: { text: string }): boolean {
  return /^\p{White_Space}*$/u.test(text);
}

const rowSchema = z.strictObject({
  atIso: z.string().refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value, {
    message: "atIso is not a canonical ISO instant",
  }),
  callId: z.string().refine((callId) => isCallId({ callId }), { message: "callId is not a v4 UUID" }),
  reason: z.string().refine((reason) => !isBlank({ text: reason }), { message: "reason is empty" }),
  // Opaque, as `grantSessionId` resolves it (`../hatch/grantSession.ts`): any id but a blank one.
  session: z
    .string()
    .refine((session) => !isBlank({ text: session }), { message: "session is blank" })
    .nullable(),
});

/**
 * Why a row would be refused by every read of the ledger, or `undefined` when it would be read — the writer asks
 * this before appending, so it never writes a row its own reader refuses.
 *
 * @returns the first refusal, or `undefined`
 */
export function quarantineRowProblem({ row }: { row: CallQuarantineRow }): string | undefined {
  const parsed = rowSchema.safeParse(row);
  return parsed.success ? undefined : parsed.error.issues[0]!.message;
}

/**
 * `$home/talk/call-quarantine.jsonl`, beside the call index — derived from the state-home contract's `talk/`
 * directory, as the index is.
 *
 * @returns the ledger's path
 */
export function callQuarantinePath({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "call-quarantine.jsonl");
}

/**
 * The one line `talk quarantine` writes for a row, fields in a fixed order. A read accepts a line only when it is
 * exactly this, so a row JSON would parse but the verb never wrote — a member given twice, reordered, re-spaced — is
 * damage rather than a row whose meaning `JSON.parse` picked (a second `callId` member would otherwise win silently).
 *
 * @returns the row's line, without its newline
 */
export function quarantineLine({ row }: { row: CallQuarantineRow }): string {
  const { atIso, callId, reason, session } = row;
  return safeJsonStringify({ label: "call quarantine row", value: { atIso, callId, reason, session } });
}

/**
 * Whether an append to the call must be refused because the ledger closes it. A ledger that reads names it by row;
 * a damaged one names it if its raw text carries the id at all, so damage never reopens a quarantined call to a
 * line that a later repair and a second removal would leave unread. Every read refuses a damaged
 * ledger meanwhile, and a call it does not name keeps writing, so a live call never loses its words to this.
 *
 * @param home the Slopweaver home
 * @param callId the call about to be appended to
 * @returns whether the call is closed, or `undefined` when the ledger cannot be read at all and cannot say
 */
export function ledgerClosesCall({ home, callId }: { home: string; callId: string }): boolean | undefined {
  const ledger = readCallQuarantine({ home });
  if (ledger.isOk()) {
    return ledger.value.some((row) => row.callId === callId);
  }
  let named = false;
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ line }) => {
        if (line.includes(callId)) {
          named = true;
        }
      },
      path: callQuarantinePath({ home }),
    });
    return named;
  } catch {
    return undefined;
  }
}

/**
 * Parse one ledger line into a row.
 *
 * @param line the line's text
 * @param lineNumber where the line sits, 1-based, for the refusal
 * @param path the ledger the line came from, for the refusal
 * @returns the row, or the ledger refused as damaged at that line
 */
function quarantineRowOf({
  line,
  lineNumber,
  path,
}: {
  line: string;
  lineNumber: number;
  path: string;
}): Result<CallQuarantineRow, CallQuarantineError> {
  let value: unknown;
  try {
    value = safeJsonParse({ label: "call quarantine row", text: line });
  } catch {
    return err(CallQuarantineErrors.ledgerMalformed({ path, why: `line ${String(lineNumber)}: not JSON` }));
  }
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) {
    const why = `line ${String(lineNumber)}: ${parsed.error.issues[0]!.message}`;
    return err(CallQuarantineErrors.ledgerMalformed({ path, why }));
  }
  if (quarantineLine({ row: parsed.data }) !== line) {
    const why = `line ${String(lineNumber)} is not the line talk quarantine writes for its row`;
    return err(CallQuarantineErrors.ledgerMalformed({ path, why }));
  }
  return ok(parsed.data);
}

/**
 * Every row the ledger holds, in order — none when there is no ledger yet. Refused whole on any damage.
 *
 * @param home the Slopweaver home
 * @returns the rows, or why the ledger cannot be trusted
 */
export function readCallQuarantine({
  home,
}: {
  home: string;
}): Result<readonly CallQuarantineRow[], CallQuarantineError> {
  const path = callQuarantinePath({ home });
  const rows: CallQuarantineRow[] = [];
  let blankAt: number | undefined;
  let last = "";
  let damage: CallQuarantineError | undefined;
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ line, index }) => {
        last = line;
        if (damage !== undefined) {
          return;
        }
        // Only the slice after the final newline may be empty, so a second blank, or a row after one, is damage.
        if (blankAt !== undefined) {
          damage = CallQuarantineErrors.ledgerMalformed({ path, why: `line ${String(blankAt + 1)} is blank` });
          return;
        }
        if (line === "") {
          blankAt = index;
          return;
        }
        const row = quarantineRowOf({ line, lineNumber: index + 1, path });
        if (row.isErr()) {
          damage = row.error;
          return;
        }
        // `talk quarantine` refuses a second row under the ledger lock, so one here was written by hand.
        const earlier = rows.findIndex((kept) => kept.callId === row.value.callId);
        if (earlier !== -1) {
          damage = CallQuarantineErrors.ledgerMalformed({
            path,
            why: `line ${String(index + 1)} quarantines ${row.value.callId} again`,
          });
          return;
        }
        rows.push(row.value);
      },
      path,
      strictUtf8: true,
    });
  } catch (cause) {
    return isMissing({ cause }) ? ok([]) : err(CallQuarantineErrors.io({ cause, path }));
  }
  if (damage !== undefined) {
    return err(damage);
  }
  if (last !== "") {
    return err(CallQuarantineErrors.ledgerMalformed({ path, why: "its last line has no newline" }));
  }
  return ok(rows);
}
