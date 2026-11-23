/**
 * Which single supervisor transcript an intake read is scoped to, and the pin record read as a chain link — the two
 * reads of the pin `./intakeRead.ts` and `./ownerWindowGaps.ts` share.
 */
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { scanSessions } from "../sessions/liveSessionStore.js";
import { readSupervisorPin } from "../sessions/supervisorPinStore.js";
import { findTranscript } from "../transcripts/source.js";
import type { SupervisorLink } from "./chain.js";
import { readSupervisorChainEvents } from "./chainStore.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";
import { readRecordedChair } from "./recordedChairHost.js";

/**
 * Which transcript the check reads when a caller names ONE session, and why that one.
 *
 * @internal — only {@link resolveIntakeScope}'s callers and its test read it.
 */
export interface IntakeScope {
  readonly sessionId: string;
  /** The floor turns are read from, or `undefined` for the whole transcript. */
  readonly sinceIso: string | undefined;
  /** `pin` when the supervisor pin chose the session; `explicit` when the caller named it. */
  readonly source: "pin" | "explicit";
}

/**
 * The current pin as a chain link, so the live supervisor is walked even when the journal never caught it.
 *
 * A machine whose pin was last moved before the journal existed, or by hand in cmux, has a live supervisor
 * and no link for it. Folding the pin record in here means the chain read is never WORSE than the single
 * -session read it replaced, whatever the journal holds.
 *
 * @param home the state home, where the pin record lives
 * @returns the one link, or nothing when no pin is recorded
 */
export function pinAsLink({ home }: { home: string }): readonly SupervisorLink[] {
  const pin = readSupervisorPin({ home });
  if (pin === undefined) {
    return [];
  }
  const { pinnedAtIso, session, workspaceId, workspaceRef } = pin;
  return [{ pinnedAtIso, session, source: "pin", workspaceId, workspaceRef }];
}

/**
 * Decide which single transcript is in scope.
 *
 * @param home the state home, where the pin record lives
 * @param claudeHome `~/.claude`, where the live-session registry lives
 * @param sessionId an explicit Claude session, or `undefined` to follow the pin; an id with no Claude transcript that
 *   names a Codex thread the pin or chain records is refused, while a Claude transcript carrying it is read
 * @param sinceIso an explicit floor, or `undefined` for the scope's own default
 * @returns the scope, or why none could be established
 */
export function resolveIntakeScope({
  home,
  claudeHome,
  sessionId,
  sinceIso,
}: {
  home: string;
  claudeHome: string;
  sessionId: string | undefined;
  sinceIso: string | undefined;
}): Result<IntakeScope, SupervisorCoreError> {
  if (sessionId !== undefined) {
    // `--session` names a Claude Code session, so a Claude transcript carrying the id IS the session asked for,
    // whatever Codex thread shares it. Only an id with no Claude transcript that names a recorded
    // Codex chair is refused, so the caller hears which host holds it rather than "no transcript".
    const claudeTranscript = findTranscript({ projectsDir: join(claudeHome, "projects"), sessionId }).isOk();
    const links = claudeTranscript ? [] : [...readSupervisorChainEvents({ home }), ...pinAsLink({ home })];
    if (links.some((link) => link.session.host === "codex" && link.session.id === sessionId)) {
      return err(SupervisorCoreErrors.sessionIsCodex({ sessionId }));
    }
    return ok({ sessionId, sinceIso, source: "explicit" });
  }
  // The strict read first: a damaged or mixed pin or chain line could be a newer record naming a Codex chair, so the
  // pin's Claude session is never read as the chair past one.
  const recorded = readRecordedChair({ home });
  if (recorded.kind === "unresolved") {
    return err(SupervisorCoreErrors.chairUnresolved({ why: recorded.why }));
  }
  const pin = readSupervisorPin({ home });
  if (pin === undefined) {
    return err(SupervisorCoreErrors.pinMissing());
  }
  if (pin.session.host === "codex") {
    return err(SupervisorCoreErrors.pinOnCodex({ sessionId: pin.session.id }));
  }
  const live = scanSessions({ sessionsDir: join(claudeHome, "sessions") }).records.some(
    (record) => record.sessionId === pin.session.id,
  );
  if (!live) {
    return err(SupervisorCoreErrors.pinNotLive({ sessionId: pin.session.id }));
  }
  // With no `--since`, the window opens at the instant this session took the pin.
  if (sinceIso === undefined) {
    return ok({ sessionId: pin.session.id, sinceIso: pin.pinnedAtIso, source: "pin" });
  }
  return ok({ sessionId: pin.session.id, sinceIso, source: "pin" });
}
