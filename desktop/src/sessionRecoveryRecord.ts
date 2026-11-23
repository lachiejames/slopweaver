/**
 * The app's recovery journal, as records: what each row says, the strict decoder every row passes, and the pure fold
 * from a journal's lines to what it knows about each session. No filesystem here (`sessionRecoveryStore.ts` has it).
 *
 * The journal is recovery STATE, never the session ledger: the ledger under `$SLOPWEAVER_HOME` keeps its one writer
 * (`src/sessionHarness/recordingHarness.ts`), and nothing here is a lifecycle the fleet reads. A row says only what
 * a later run of the app needs to resume a session it hosted and to recognise the processes that session left: the
 * vendor's own transcript id, the launch it was opened with, and the process group its worker led.
 */
import { err, ok, type Result } from "neverthrow";

import { type AppLaunchSpec, isAppLaunchSpec } from "./sessionControlProtocol";
import type { WorkerLaunchConfig } from "./sessionWorker/workerWire";

/** A session came up: the vendor's transcript id and the launch it was opened with. */
export interface SessionOpenedRow {
  readonly kind: "opened";
  readonly atIso: string;
  readonly sessionId: string;
  /** The vendor's own id for the transcript, the one a resume names. */
  readonly vendorSessionId: string;
  readonly spec: AppLaunchSpec;
}

/** A session's worker started, leading a process group of its own. */
export interface SessionGroupRow {
  readonly kind: "group-started";
  readonly atIso: string;
  readonly sessionId: string;
  /** The group's id: its worker's pid. */
  readonly pgid: number;
  /** The executables a process of this group may run, so a later run never ends a stranger that reused the id. */
  readonly expectedExecutables: readonly string[];
}

/**
 * A resume read one of the session's recorded groups as gone. Every `group-started` row for that id written before it
 * is done with, so a retried resume or a later run never reads whoever took the id since as the session's own.
 */
export interface SessionGroupEndedRow {
  readonly kind: "group-ended";
  readonly atIso: string;
  readonly sessionId: string;
  /** The group's id, as its `group-started` row recorded it. */
  readonly pgid: number;
}

/** A session was stopped and its process group proven gone. */
export interface SessionClosedRow {
  readonly kind: "closed";
  readonly atIso: string;
  readonly sessionId: string;
}

/** One row of the recovery journal. */
export type SessionRecoveryEvent = SessionOpenedRow | SessionGroupRow | SessionGroupEndedRow | SessionClosedRow;

/** What the journal knows about one session. */
export interface RecoveredSession {
  readonly sessionId: string;
  /** Its `opened` row, absent for a session that never came up. */
  readonly opened: SessionOpenedRow | undefined;
  /**
   * Every group its workers led that no later `group-ended` row retired, nor a later `group-started` row of any session
   * named again, oldest first.
   */
  readonly groups: readonly SessionGroupRow[];
  /** Whether it was stopped with its group proven gone. */
  readonly closed: boolean;
}

/** A whole journal, folded. */
export interface RecoveryJournal {
  readonly sessions: ReadonlyMap<string, RecoveredSession>;
  /** The 1-based numbers of the lines no row decodes from — a torn last write included — which no reader may skip. */
  readonly malformedLines: readonly number[];
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactly({ value, keys }: { value: Readonly<Record<string, unknown>>; keys: readonly string[] }): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function rowOf({ value }: { value: Readonly<Record<string, unknown>> }): SessionRecoveryEvent | undefined {
  const { atIso, sessionId } = value;
  if (!isNonEmpty(atIso) || !isNonEmpty(sessionId)) {
    return undefined;
  }
  if (value["kind"] === "opened") {
    const { vendorSessionId, spec } = value;
    const valid =
      hasExactly({ keys: ["kind", "atIso", "sessionId", "vendorSessionId", "spec"], value }) &&
      isNonEmpty(vendorSessionId) &&
      isAppLaunchSpec(spec);
    return valid ? { atIso, kind: "opened", sessionId, spec, vendorSessionId } : undefined;
  }
  if (value["kind"] === "group-started") {
    const { pgid, expectedExecutables } = value;
    const valid =
      hasExactly({ keys: ["kind", "atIso", "sessionId", "pgid", "expectedExecutables"], value }) &&
      typeof pgid === "number" &&
      Number.isSafeInteger(pgid) &&
      pgid > 1 &&
      Array.isArray(expectedExecutables) &&
      expectedExecutables.length > 0 &&
      expectedExecutables.every((path) => isNonEmpty(path));
    return valid ? { atIso, expectedExecutables, kind: "group-started", pgid, sessionId } : undefined;
  }
  if (value["kind"] === "group-ended") {
    const { pgid } = value;
    const valid =
      hasExactly({ keys: ["kind", "atIso", "sessionId", "pgid"], value }) &&
      typeof pgid === "number" &&
      Number.isSafeInteger(pgid) &&
      pgid > 1;
    return valid ? { atIso, kind: "group-ended", pgid, sessionId } : undefined;
  }
  const closed = value["kind"] === "closed" && hasExactly({ keys: ["kind", "atIso", "sessionId"], value });
  return closed ? { atIso, kind: "closed", sessionId } : undefined;
}

/**
 * One journal line as a row, refused unless it is valid UTF-8, byte for byte what the app's writer produces (so no
 * duplicated key and no byte-order mark), and exactly one of the four shapes with no other key.
 * The bytes are decoded strictly: a lenient decoder would turn a corrupt byte into U+FFFD and let a damaged line
 * read as a row naming a session that was never written.
 *
 * @param line one line of the journal as its raw bytes, newline excluded
 * @returns the row, or why the line is not one
 */
export function decodeRecoveryLine({ line }: { line: Uint8Array }): Result<SessionRecoveryEvent, string> {
  let text: string;
  try {
    // `ignoreBOM` KEEPS a leading byte-order mark rather than silently dropping it, so a line the app's writer could
    // never have produced fails below instead of reading as the row after it.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(line);
  } catch {
    return err("the line is not UTF-8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err("the line is not JSON");
  }
  // Exactly the text the app's writer would produce for what it parsed to, or no row: `JSON.parse` keeps the LAST of a
  // duplicated key, so `{"kind":"opened","kind":"closed",…}` would otherwise read as a closed row.
  if (JSON.stringify(parsed) !== text) {
    return err("the line is not written as the app writes a row");
  }
  const row = isObject(parsed) ? rowOf({ value: parsed }) : undefined;
  return row === undefined ? err("the line is not an opened, group-started, group-ended or closed row") : ok(row);
}

function withRow({
  session,
  row,
}: {
  session: RecoveredSession | undefined;
  row: SessionRecoveryEvent;
}): RecoveredSession {
  if (session === undefined) {
    return withRow({ row, session: { closed: false, groups: [], opened: undefined, sessionId: row.sessionId } });
  }
  const base = session;
  if (row.kind === "opened") {
    return { ...base, opened: row };
  }
  if (row.kind === "group-started") {
    return { ...base, groups: [...base.groups, row] };
  }
  if (row.kind === "group-ended") {
    // Only the rows written so far: a later `group-started` naming the same id is a newer worker handed it again.
    return { ...base, groups: base.groups.filter((group) => group.pgid !== row.pgid) };
  }
  return { ...base, closed: true };
}

/**
 * Drop every row so far, of any session, naming a group id a new `group-started` row names again. The kernel hands a
 * pid out again only once no process group holds it as an id, so the earlier group was gone by the time this worker
 * led one, and a resume of the earlier session reading the id would otherwise end the newer worker's group as its own.
 */
function retireGroupId({ pgid, sessions }: { pgid: number; sessions: Map<string, RecoveredSession> }): void {
  for (const [sessionId, session] of sessions) {
    if (session.groups.some((group) => group.pgid === pgid)) {
      sessions.set(sessionId, { ...session, groups: session.groups.filter((group) => group.pgid !== pgid) });
    }
  }
}

/**
 * Fold a journal's lines into what it knows about each session, in the order its rows were written.
 *
 * @param lines the journal's lines as raw bytes, newlines excluded; none is a journal with no sessions
 * @returns each session's rows, and every line that decodes to none
 */
export function foldRecoveryJournal({ lines }: { lines: readonly Uint8Array[] }): RecoveryJournal {
  const sessions = new Map<string, RecoveredSession>();
  const malformedLines: number[] = [];
  for (const [index, line] of lines.entries()) {
    const decoded = decodeRecoveryLine({ line });
    if (decoded.isErr()) {
      malformedLines.push(index + 1);
      continue;
    }
    const row = decoded.value;
    if (row.kind === "group-started") {
      retireGroupId({ pgid: row.pgid, sessions });
    }
    sessions.set(row.sessionId, withRow({ row, session: sessions.get(row.sessionId) }));
  }
  return { malformedLines, sessions };
}

/**
 * The executables a session's process group may run: the app's own executable, which runs the worker and the Codex
 * adapter as Node, and the vendor binary the worker drives.
 *
 * @param config the worker's launch configuration
 * @param execPath the app's own executable
 * @returns both paths, the app's first
 */
export function expectedExecutablesOf({
  config,
  execPath,
}: {
  config: WorkerLaunchConfig;
  execPath: string;
}): readonly string[] {
  return [execPath, config.vendor === "claude" ? config.claudePath : config.codexPath];
}
