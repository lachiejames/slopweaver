/**
 * The launch the app's recovery journal recorded for one session, read and never acted on: what `launch.inspect`
 * answers, so a spawn plans a resume on the routed login the session opened on (for Codex, its `$CODEX_HOME`) rather
 * than routing that plan afresh and having the resume refused for naming a different one (`sessionResume.ts`).
 *
 * Pure: the folded journal in, the recorded spec or a named refusal out. It refuses exactly where a resume would —
 * a journal with any line no row decodes from, a session that never came up, a session that was stopped — so an
 * answer here is never a launch the resume it plans would then refuse for the journal's own reasons.
 */
import { err, ok, type Result } from "neverthrow";

import type { AppLaunchSpec } from "./sessionControlProtocol";
import type { RecoveryJournal } from "./sessionRecoveryRecord";

/** Why the journal offers no recorded launch for a session. */
export interface RecordedSpecRefusal {
  /**
   * `JOURNAL_MALFORMED`: a line decodes to no row, which may be the `closed` that would forbid a resume.
   * `SESSION_UNRECORDED`: no `opened` row for that session. `SESSION_CLOSED`: it was stopped from its card or a close.
   */
  readonly code: "JOURNAL_MALFORMED" | "SESSION_UNRECORDED" | "SESSION_CLOSED";
  readonly message: string;
}

/**
 * The launch the recovery journal recorded for an exact session, as it was opened.
 *
 * @param journal the recovery journal, folded
 * @param sessionId the app's own id for the session, as the spawn's open ledger row records it
 * @returns the recorded launch spec, or the refusal naming which check failed
 */
export function recordedSpecOf({
  journal,
  sessionId,
}: {
  journal: RecoveryJournal;
  sessionId: string;
}): Result<AppLaunchSpec, RecordedSpecRefusal> {
  if (journal.malformedLines.length > 0) {
    const lines = journal.malformedLines.join(", ");
    return err({
      code: "JOURNAL_MALFORMED",
      message: `the recovery journal has lines no row decodes from (${lines}), so no session's launch is read from it`,
    });
  }
  const session = journal.sessions.get(sessionId);
  if (session?.opened === undefined) {
    return err({
      code: "SESSION_UNRECORDED",
      message: `the recovery journal records no session ${sessionId} that came up, so it holds no launch to resume`,
    });
  }
  if (session.closed) {
    return err({
      code: "SESSION_CLOSED",
      message: `session ${sessionId} was stopped from its card or a close, so its launch is not offered for a resume`,
    });
  }
  return ok(session.opened.spec);
}
