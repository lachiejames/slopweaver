/**
 * Every Claude session on this machine, as its registry file and its transcript describe it.
 *
 * ## Two feeds, because neither one is sufficient
 *
 * `~/.claude/sessions/<pid>.json` is a registry Claude Code maintains itself: one file per live session,
 * deleted on a clean exit. It is perfect for MEMBERSHIP — a session appeared, a session vanished — and it
 * carries a `status` of `busy` / `idle` / `shell`.
 *
 * It is **not a heartbeat**, and that is the measurement this whole module is shaped around. Measured
 * 2026: `fs.watch` on that directory fired **zero** events across 25 seconds of continuous work, and the
 * author's own registry file was **25 minutes stale** while the session was working the entire time.
 * `statusUpdatedAt` moves on a TRANSITION, never on a tick. A reader built on it alone would show a frozen
 * `busy` and call it live.
 *
 * The transcript is the heartbeat. Measured the same day: an active session's JSONL grew **52,472 bytes in
 * 20 seconds**, a subagent's **21,485**. It advances at message and tool boundaries, which is as close to a
 * pulse as this system has. {@link SessionActivity} carries it beside the registry record.
 *
 * Pure: text in, values out. The filesystem lives in {@link ./sessionStore}.
 */
import { absentAsNumber } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";

/** One live session, as its registry file describes it. */
export interface SessionRecord {
  readonly pid: number;
  readonly sessionId: string;
  readonly cwd: string;
  /** `interactive` or `background`. */
  readonly kind: string;
  /** `cli` for a terminal session, `sdk-cli` for a headless `-p` turn. */
  readonly entrypoint: string;
  /** Claude Code's own short name for the session, e.g. a repo-derived label. */
  readonly name: string;
  /**
   * `busy` / `idle` / `shell`, or the empty string.
   *
   * Empty for every headless session: measured, an `sdk-cli` entrypoint publishes `status: null`
   * for its whole life, so an absent status never means idle.
   */
  readonly status: string;
  readonly startedAtMs: number;
  /**
   * When the process started, as `ps -o lstart=` prints it under `TZ=UTC LC_ALL=C` — what binds a pid to THIS
   * session rather than to whatever holds the pid now. Absent from a registry file that does not record it.
   */
  readonly procStart?: string;
}

/** A number field, or `undefined` when it was absent or the wrong type. */
function numberField({ record, name }: { record: Record<string, unknown>; name: string }): number | undefined {
  const value = record[name];
  return typeof value === "number" ? value : undefined;
}

/** A string field, or the empty string when absent or the wrong type. */
function stringField({ record, name }: { record: Record<string, unknown>; name: string }): string {
  const value = record[name];
  return typeof value === "string" ? value : "";
}

/**
 * Decode one registry file, or say why it could not be decoded.
 *
 * A file with no `pid` is REFUSED rather than defaulted: the pid is how liveness is asked of the operating
 * system, and a record keyed on a zero would report a dead session as alive.
 *
 * @param text the file's contents
 * @returns the session, or the reason it was refused
 */
export function parseSessionFile({ text }: { text: string }): SessionRecord | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "the session registry file is not readable JSON";
  }
  if (!isRecord(parsed)) {
    return "the session registry file does not hold an object";
  }
  const record = parsed;
  const pid = numberField({ name: "pid", record });
  if (pid === undefined) {
    return "the session registry file records no pid, so liveness could never be asked";
  }
  const procStart = stringField({ name: "procStart", record });
  return {
    cwd: stringField({ name: "cwd", record }),
    entrypoint: stringField({ name: "entrypoint", record }),
    kind: stringField({ name: "kind", record }),
    name: stringField({ name: "name", record }),
    pid,
    sessionId: stringField({ name: "sessionId", record }),
    startedAtMs: absentAsNumber({ value: numberField({ name: "startedAt", record }), whenAbsent: 0 }),
    status: stringField({ name: "status", record }),
    ...(procStart === "" ? {} : { procStart }),
  };
}

/** What the transcript says about a session's pulse. */
export interface SessionActivity {
  /** When the transcript was last written, or `undefined` when that could not be established. */
  readonly lastWriteMs: number | undefined;
  /** The human title the session gave itself, or `undefined` when it has not titled itself yet. */
  readonly title: string | undefined;
  /** Why the transcript could not be read, when it could not. */
  readonly why: string | undefined;
}

/**
 * The newest `ai-title` a transcript carries.
 *
 * Read by scanning backwards for the LAST occurrence, because a session re-titles itself as its subject
 * changes and the newest is the one that describes what the chat is about now. This is the reorientation
 * fix: "Triage and remediate 21 critical Dependabot alerts" tells the owner what a session is, and a
 * machine-derived name like `a-repo-b6` does not.
 *
 * @param text the transcript contents, or its tail
 * @returns the newest title, or `undefined` when the transcript carries none
 */
export function newestAiTitle({ text }: { text: string }): string | undefined {
  const matches = [...text.matchAll(/"type"\s*:\s*"ai-title"\s*,\s*"aiTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  const last = matches.at(-1)?.[1];
  if (last === undefined) {
    return undefined;
  }
  try {
    const unescaped: unknown = JSON.parse(`"${last}"`);
    return typeof unescaped === "string" ? unescaped : last;
  } catch {
    return last;
  }
}
