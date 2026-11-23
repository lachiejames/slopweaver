/**
 * The pure half of retiring a seat's board row: is the row on disk still the untouched row this seat registered, and
 * what are its bytes once it reads `status: cancelled`.
 *
 * ## Why a seat retires its own row
 *
 * MEASURED on a `bump-fix-*` row: `automation seat` claimed the firing, registered
 * `automations-seat-<id>` carrying `run-due --claim-id <token>`, and `cmux spawn` was deferred by the spawn
 * backoff (exit 4). The seat released its claim — and left the row `status: ready`. A chair then spawned that row
 * directly; the seated session's `run-due` was refused ("no open attempt on this row carries this token"), the slot
 * stayed due and the boot was spent for nothing (`$SLOPWEAVER_HOME/runs/automations-seat-<id>.jsonl`).
 *
 * A released claim leaves no record a later `run-due` could tell from a forged token, so the token cannot be revived;
 * the row that carries it has to stop being seatable instead. `cancelled` is the existing closed-not-shipped terminal
 * every spawn door refuses (`handover/permanentRefusal.ts`), the one `handover withdraw` writes for a registered ask
 * whose premise dissolved — never a settlement, which would read as the owner's answer or (`declined`) need the owner's anchor.
 *
 * ## Exactly the row this seat wrote, untouched
 *
 * Cancelling is only safe on a row nobody has picked up. So the row must still be a clean, ready, unsettled ask under
 * the seat's slug, whose ask is byte for byte the one the seat registered (so it carries exactly the tokens the seat
 * minted), and have NO journal line at all — a `dispatched` or
 * `started` line means a chair or a session is on it, and that is somebody's work.
 *
 * Pure: text, a parsed journal and the seat's facts in; text or a typed refusal out.
 */
import { err, ok, type Result } from "#lib/result.js";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields } from "../../../handover/frontmatter.js";
import type { ParsedLedger } from "../../../handover/ledger.js";
import { permanentRefusalOf } from "../../../handover/permanentRefusal.js";
import { type SeatRetirementError, SeatRetirementErrors } from "./seatRetirementErrors.js";

/**
 * The row's bytes with `status: cancelled` and a one-line reason, or why this seat may not cancel it.
 *
 * @param text the row's current bytes, decoded
 * @param path the row's file, which the parser and the front-matter writer name their problems by
 * @param slug the slug the seat registered the row under
 * @param ask the one-line summary the seat registered the row with, which carries every claim token it minted
 * @param journal the row's run journal as it reads now — empty when no run, dispatch or tag ever touched it
 * @param why what stopped the session opening, one line, which the row's `statusSummary` records
 * @returns the cancelled row's bytes, or the refusal naming what made it not this seat's to cancel
 */
export function retiredSeatRowText({
  text,
  path,
  slug,
  ask,
  journal,
  why,
}: {
  readonly text: string;
  readonly path: string;
  readonly slug: string;
  readonly ask: string;
  readonly journal: ParsedLedger;
  readonly why: string;
}): Result<string, SeatRetirementError> {
  const notOurs = untouchedRowRefusal({ ask, journal, path, slug, text, why });
  if (notOurs !== undefined) {
    return err(SeatRetirementErrors.notOurs({ detail: notOurs, slug }));
  }
  const edited = editFrontMatterFields({
    path,
    remove: [],
    set: [
      { key: "status", value: "cancelled" },
      { key: "statusSummary", value: JSON.stringify(`Retired by its automation seat, no session opened: ${why}`) },
    ],
    text,
  });
  if (edited.isErr()) {
    return err(SeatRetirementErrors.io({ detail: edited.error.message, slug }));
  }
  const problems = parseHandoverDoc({ path, text: edited.value }).problems;
  if (problems.length > 0) {
    return err(
      SeatRetirementErrors.io({ detail: `the cancelled row would be malformed: ${problems.join("; ")}`, slug }),
    );
  }
  return ok(edited.value);
}

/** Why the row is not the untouched one this seat registered, or `undefined` when it is. */
function untouchedRowRefusal({
  text,
  path,
  slug,
  ask,
  journal,
  why,
}: {
  readonly text: string;
  readonly path: string;
  readonly slug: string;
  readonly ask: string;
  readonly journal: ParsedLedger;
  readonly why: string;
}): string | undefined {
  if (why.trim().length === 0 || /[\r\n]/u.test(why)) {
    return "the retirement reason must be one non-empty line";
  }
  if (ask.length === 0) {
    return "the seat names no ask to find on it";
  }
  const doc = parseHandoverDoc({ path, text });
  if (doc.problems.length > 0) {
    return `it is malformed: ${doc.problems.join("; ")}`;
  }
  if (doc.slug !== slug) {
    return `it holds the row "${doc.slug}"`;
  }
  if (doc.kind !== "ask" || doc.status !== "ready") {
    return `it is a ${doc.kind} row at status ${doc.status}, not a ready ask`;
  }
  if (journal.events.length > 0 || journal.unreadable.length > 0) {
    return "its journal carries a line, so a chair or a session has touched it";
  }
  const refusal = permanentRefusalOf({ doc, events: [], rerunAllowed: false, unreadableLines: [] });
  if (refusal !== undefined) {
    return refusal.reason;
  }
  // The ASK — the `summary:` the register wrote — must be BYTE FOR BYTE the one this seat registered, never merely
  // carry its tokens. Every parse of the tokens out of it was fooled in turn: a body comment, a longer
  // prefixed token, a repeated one, the flag as a suffix, a shell-quoted flag.
  // Equality has no grammar to fool.
  if (doc.summary !== ask) {
    return "its ask is not the one this seat registered";
  }
  return undefined;
}
