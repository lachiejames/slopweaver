/**
 * `slopweaver session record` / `list` / `close` — the supervisor's own ledger of the chats it knows about.
 */

import { logger } from "../../../lib/logger.js";
import { planChoiceLine } from "../../../sessions/planChoice.js";
import { foldSessions, parseSessionLog, type SessionEvent, type SessionItem } from "../../../sessions/session.js";
import { appendSessionEvent, readSessionLogText } from "../../../sessions/sessionStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { boolFlag, parseSessionArgs, type SessionVerb, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/** The current instant, as ISO-8601. Not injected: this is the effectful CLI edge, not the pure ledger below. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Append one event, carrying `--home` through only when the caller actually passed one. */
function record({ event, parsed }: { event: SessionEvent; parsed: ParsedFlags }): void {
  const home = stringFlag({ name: "home", parsed });
  appendSessionEvent({ event, ...(home === undefined ? {} : { home }) });
}

/** Parse one verb's flags, printing help/errors as it goes. Returns the exit code to stop on, or the flags. */
function parseVerb({ verb, argv }: { verb: SessionVerb; argv: readonly string[] }): ParsedFlags | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb }) });
    return EXIT_USAGE;
  }
  return parsed.value;
}

/**
 * `session record` — append a status note against a session key, registering it if this is the first event
 * anyone has recorded for that key.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionRecord(argv: readonly string[]): Promise<number> {
  const parsed = parseVerb({ argv, verb: "record" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const sessionKey = parsed.positionals[0];
  if (sessionKey === undefined) {
    logger.error({ msg: "session record: a session key is required" });
    logger.error({ msg: sessionUsage({ verb: "record" }) });
    return EXIT_USAGE;
  }
  const note = stringFlag({ name: "note", parsed });
  if (note === undefined || note.trim().length === 0) {
    logger.error({ msg: "session record: --note is required and must not be blank" });
    logger.error({ msg: sessionUsage({ verb: "record" }) });
    return EXIT_USAGE;
  }
  record({ event: { kind: "noted", note, sessionKey, tsIso: nowIso() }, parsed });
  logger.out({ line: `session record: noted ${sessionKey}` });
  return EXIT_OK;
}

/**
 * How a session's recorded boot model reads on its row.
 *
 * The three states are genuinely three different answers and the row says which: a pinned tier, a spawn that
 * deliberately took the launching user's saved default, and a row nothing recorded a model on at all. See
 * `sessions/session.ts`'s header for why the last is not the same as the middle.
 */
function renderBootModel({ item }: { item: SessionItem }): string {
  if (item.bootModel === undefined) {
    return "model=unrecorded";
  }
  return item.bootModel.kind === "pinned" ? `model=${item.bootModel.model}` : "model=inherited-default";
}

/**
 * One session, human-readable: its row, then — when the spawn recorded one — the plan it started on and the readings
 * that chose it, indented on a line of their own so the row itself stays one line.
 *
 * @param item the folded session
 * @returns the row, and the plan line beneath it when there is one
 */
export function renderSession({ item }: { item: SessionItem }): string {
  const parts = [`${item.sessionKey} — ${item.status}`];
  if (item.slug !== undefined) {
    parts.push(`slug=${item.slug}`);
  }
  parts.push(renderBootModel({ item }));
  if (item.workspaceRef !== undefined) {
    parts.push(item.workspaceRef);
  }
  if (item.latestNote !== undefined) {
    parts.push(`note: ${item.latestNote}`);
  }
  const row = parts.join("  ");
  if (item.planChoice === undefined) {
    return row;
  }
  return `${row}\n    ${planChoiceLine({ choice: item.planChoice })}`;
}

/**
 * `session list` — the current state of every session.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionList(argv: readonly string[]): Promise<number> {
  const parsed = parseVerb({ argv, verb: "list" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const home = stringFlag({ name: "home", parsed });
  const { events, unreadable } = parseSessionLog({
    text: readSessionLogText(home === undefined ? {} : { home }),
  });
  const items = foldSessions({ events });
  if (boolFlag({ name: "json", parsed })) {
    logger.out({ line: JSON.stringify({ sessions: items, unreadable }) });
  } else if (items.length === 0) {
    logger.out({ line: "No sessions tracked yet." });
  } else {
    items.forEach((item) => {
      logger.out({ line: renderSession({ item }) });
    });
  }
  if (unreadable.length > 0) {
    logger.error({ msg: `session list: ${String(unreadable.length)} line(s) of the ledger could not be read` });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * `session close` — mark a session closed by hand (a cmux-spawned session is closed automatically by
 * `cmux close`; this is for one registered without cmux).
 *
 * `--workspace` closes only the row that carries that workspace ref — the same targeting `cmux close` does
 * automatically — so closing one duplicate spawn of a slug never collapses its still-open sibling. Omit it to
 * keep the pre-existing whole-key close, for a session the caller cannot or does not need to name a workspace
 * for.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionClose(argv: readonly string[]): Promise<number> {
  const parsed = parseVerb({ argv, verb: "close" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const sessionKey = parsed.positionals[0];
  if (sessionKey === undefined) {
    logger.error({ msg: "session close: a session key is required" });
    logger.error({ msg: sessionUsage({ verb: "close" }) });
    return EXIT_USAGE;
  }
  const workspaceRef = stringFlag({ name: "workspace", parsed });
  record({
    event: { kind: "closed", sessionKey, tsIso: nowIso(), ...(workspaceRef === undefined ? {} : { workspaceRef }) },
    parsed,
  });
  logger.out({ line: `session close: closed ${sessionKey}` });
  return EXIT_OK;
}

export const sessionRecordCommand = defineCommand({ run: runSessionRecord });

export const sessionListCommand = defineCommand({ run: runSessionList });

export const sessionCloseCommand = defineCommand({ run: runSessionClose });
