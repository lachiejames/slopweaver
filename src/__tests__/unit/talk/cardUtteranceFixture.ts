/**
 * The call lines `cardUtterance.test.ts` builds its cases from, written the way `site/lib/talkTranscript.ts` writes
 * them: snapshots that repeat an id, then a final.
 */
import { type CallEntry, OWNER_SPEAKER } from "../../../talk/callRecord.js";

/**
 * One segment line at a fixed hour, offset by `at`.
 *
 * @param at the minute and second past 15:00, as `mm:ss`
 * @param open the card open when the line was said, or none
 * @returns the segment line
 */
export const said = ({
  at,
  id,
  text,
  final = true,
  who = OWNER_SPEAKER,
  open,
}: {
  at: string;
  id: string;
  text: string;
  final?: boolean;
  who?: typeof OWNER_SPEAKER | "voice";
  open: string | undefined;
}): CallEntry => ({ atIso: `2026-09-25T15:${at}.000Z`, final, id, kind: "segment", open, text, who });

/** The close line the call ends on. */
export const CLOSED: CallEntry = { atIso: "2026-09-25T15:59:00.000Z", kind: "closed", why: null };
