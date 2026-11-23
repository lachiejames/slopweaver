/**
 * The two lines `fleet resume` types into a seat it brought back, and the one reader that knows them — kept in one
 * module so the generator and the reader cannot drift apart.
 *
 * `cmux send` types a line as a keystroke would, so the record reads `promptSource: "typed"` and
 * `origin.kind: "human"` (or, mid-turn, a `queued_command` with a human origin): nothing structural separates it from
 * the owner's own turn, and its text is the only signal. MEASURED on a supervisor chair: two resumes
 * were read as the owner's words, and `handover currency` held 30 of 37 Queue cards off "fresh" because
 * "you have said things since it was asked that could bear on it". Reproduce with
 * `slopweaver handover currency --json | jq '[.rows[] | select(.since.words | length > 0)] | length'` before a resume
 * is marked `no-ask`.
 *
 * The reader matches the WHOLE line, attempt id included, never an opening: "The fleet was restarted and …" is a
 * sentence a person could type themselves. The residue, stated rather than discovered: a person who
 * types a generated line verbatim, word for word, reads as the nudge, because no record field tells the two apart
 * What that drops is the nudge's own instruction, never words of the owner's.
 *
 * Pure.
 */

/** What the chair's line says before its attempt id. */
const CHAIR_HEAD =
  "The fleet was restarted and you have been resumed first; every other seat waits on you. " +
  "Reorient per skills/supervisor/reference/reboot.md § Reoriented, then run " +
  "`slopweaver supervisor reoriented --attempt ";

/** What the chair's line says after its attempt id. */
const CHAIR_TAIL = "`.";

/** An attempt id as `fleet resume` mints it (`randomUUID()`, `../cli/commands/fleet/resumeRun.ts`), version 4 and its variant bits included, never a looser token. */
const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The one line typed into each other seat once it is back. */
export const WORKER_NUDGE_LINE =
  "The fleet was restarted and this seat has been resumed. Re-read your handover's journal and carry on from where it stopped.";

/**
 * The one line typed into the supervisor once it is back: what happened, what to do, and the verb that says done.
 *
 * @param attemptId the attempt the acknowledgement must name
 * @returns the line
 */
export function chairNudgeLine({ attemptId }: { attemptId: string }): string {
  return `${CHAIR_HEAD}${attemptId}${CHAIR_TAIL}`;
}

/**
 * Whether a turn's text is exactly a line `fleet resume` typed, rather than a person's words.
 *
 * @returns true for the worker line, or the chair line carrying a minted attempt id
 */
export function isFleetNudge({ text }: { text: string }): boolean {
  if (text === WORKER_NUDGE_LINE) {
    return true;
  }
  if (!text.startsWith(CHAIR_HEAD) || !text.endsWith(CHAIR_TAIL)) {
    return false;
  }
  return ATTEMPT_ID.test(text.slice(CHAIR_HEAD.length, text.length - CHAIR_TAIL.length));
}
