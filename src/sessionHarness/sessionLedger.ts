/**
 * The production ledger effects `./recordingHarness.ts` writes through: the real session log under one state home,
 * the wall clock, and stderr for the one warning a lost row earns.
 */
import { logger } from "../lib/logger.js";
import { isRecord } from "../lib/parsers.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { foldSessions, parseSessionLog } from "../sessions/session.js";
import { openRowForSession } from "../sessions/sessionRow.js";
import { appendSessionEvent, readSessionLogTextStrict } from "../sessions/sessionStore.js";
import type { SessionLedgerDeps } from "./recordingHarness.js";

/**
 * Which of the log's unreadable lines carry this session's id or its handle — so a row the ledger cannot read is
 * never taken for one it does not hold (a row written before the session harness carries only the handle), while an
 * unreadable line naming neither stays silent.
 *
 * @param text the raw log
 * @param lineNumbers the 1-based line numbers the parser could not read
 * @param sessionId the session being parked
 * @param handle the session's handle, the one key a row with no recorded id is bound by
 * @returns the unreadable line numbers naming it, in order
 */
export function linesNamingSession({
  text,
  lineNumbers,
  sessionId,
  handle,
}: {
  text: string;
  lineNumbers: readonly number[];
  sessionId: string;
  handle: string;
}): readonly number[] {
  if (lineNumbers.length === 0) {
    return [];
  }
  const lines = text.split("\n");
  const needles = [sessionId, handle];
  return lineNumbers.filter((n) => lineNames({ line: lines[n - 1]!, needles }));
}

/**
 * Whether one unreadable line names any of `needles`. A line that is a JSON object is judged by its DECODED string
 * fields, so an escaped spelling (its hyphen written as a unicode escape) still names `id-2`. Any other line names a needle when the needle's
 * quoted spelling is in its raw text or, for a line that decodes to some other JSON value (a bare string, an array),
 * when it is any string that value decodes to.
 */
function lineNames({ line, needles }: { line: string; needles: readonly string[] }): boolean {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "an unreadable session ledger line", text: line });
  } catch {
    return needles.some((needle) => line.includes(JSON.stringify(needle)));
  }
  if (!isRecord(parsed)) {
    const decoded = decodedStrings({ value: parsed });
    return needles.some((needle) => decoded.has(needle) || line.includes(JSON.stringify(needle)));
  }
  return Object.values(parsed).some((value) => typeof value === "string" && needles.includes(value));
}

/** Every string a decoded JSON value holds — itself, an element, a key or a field — walked without recursion. */
function decodedStrings({ value }: { value: unknown }): ReadonlySet<string> {
  const found = new Set<string>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === "string") {
      found.add(next);
    } else if (Array.isArray(next)) {
      // One push per element: a spread of a line-sized array would overflow the argument limit.
      for (const element of next) {
        pending.push(element);
      }
    } else if (isRecord(next)) {
      for (const [key, field] of Object.entries(next)) {
        pending.push(key, field);
      }
    }
  }
  return found;
}

/**
 * The real session ledger under one state home.
 *
 * @param home the state home, or `undefined` for the resolved default
 * @returns the ledger effects
 */
export function sessionLedgerDeps({ home }: { home: string | undefined }): SessionLedgerDeps {
  const at = home === undefined ? {} : { home };
  return {
    append: ({ event }) => {
      appendSessionEvent({ event, ...at });
    },
    nowIso: () => new Date().toISOString(),
    openSessionKey: ({ session }) => {
      // Throws on a log present and unreadable, which the recorder warns about; an absent log tracks nothing.
      const text = readSessionLogTextStrict(at);
      const { events, unreadable } = parseSessionLog({ text });
      const row = openRowForSession({ handle: session.handle, items: foldSessions({ events }), sessionId: session.id });
      if (row !== undefined) {
        return row.sessionKey;
      }
      const naming = linesNamingSession({
        handle: session.handle,
        lineNumbers: unreadable,
        sessionId: session.id,
        text,
      });
      if (naming.length > 0) {
        throw new Error(`line(s) ${naming.join(", ")} name session ${session.id} (${session.handle}) and do not read`);
      }
      return undefined;
    },
    warn: ({ message }) => {
      logger.error({ msg: message });
    },
  };
}
