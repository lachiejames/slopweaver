/**
 * The effectful shell for `skillReminder.ts`'s pure core: read the per-session marker, decide, print, and
 * write the marker back — all best-effort and fail-open. This is an advisory nudge, never a gate: any I/O
 * failure (missing home, unreadable/unwritable marker file) silently skips the reminder rather than
 * affecting the governed verb's own exit code.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { stateHomePaths } from "../stateHome.js";
import {
  governedVerbFor,
  hasBeenReminded,
  parseSkillReminderState,
  reminderMessage,
  withReminded,
} from "./skillReminder.js";

/**
 * Print a one-time-per-session reminder naming a governed verb's owning skill, if this exact verb has not
 * already been reminded in this session. A no-op for an ungoverned verb, or when no session id is
 * available (a plain-terminal invocation has no assistant to remind).
 *
 * @param noun the CLI noun being dispatched
 * @param verb the CLI verb being dispatched
 * @param sessionId the current session id (`CLAUDE_CODE_SESSION_ID`), or `undefined` outside a live session
 * @param home the Slopweaver state home to read/write the dedup marker under
 * @param writeLine where to print the reminder (defaults to stderr) — injected so this is unit-tested
 * @returns nothing
 */
export function maybeRemindGovernedVerb({
  noun,
  verb,
  sessionId,
  home,
  writeLine = (line) => {
    process.stderr.write(`${line}\n`);
  },
}: {
  noun: string;
  verb: string;
  sessionId: string | undefined;
  home: string;
  writeLine?: (line: string) => void;
}): void {
  if (sessionId === undefined) {
    return;
  }
  const governed = governedVerbFor({ noun, verb });
  if (governed === undefined) {
    return;
  }
  const key = `${noun} ${verb}`;
  const markerPath = stateHomePaths({ home }).skillRemindersJson;
  let raw: string | undefined;
  try {
    raw = readFileSync(markerPath, "utf8");
  } catch {
    raw = undefined;
  }
  const state = parseSkillReminderState({ raw });
  if (hasBeenReminded({ key, sessionId, state })) {
    return;
  }
  writeLine(reminderMessage({ governed, noun, verb }));
  try {
    writeFileSync(markerPath, JSON.stringify(withReminded({ key, sessionId, state })));
  } catch {
    // best-effort marker only — a failed write just means this session gets reminded again next call
  }
}
