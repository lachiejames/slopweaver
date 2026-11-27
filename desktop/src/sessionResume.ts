/**
 * Whether the app may resume a session it hosted before, and what the processes its last worker led say about it, with
 * no Electron, journal file or process table in it (`sessionResumeShell.ts` reads those).
 *
 * A resume is EXACT: it names the app's own id for the session, and the recovery journal must hold that session as
 * having come up and never been stopped, opened with the same vendor, directory, ledger home and routed login the
 * spawn now asks for. Anything less is refused, never answered with a fresh transcript the caller did not ask for. A
 * journal with any line no row decodes from is refused whole: a torn row may be the `closed` that would forbid it.
 *
 * Before the new worker starts, every process group the session's workers led must be gone. A group still listed is
 * ended only when every process in it runs an executable the journal recorded for that session and its leader started
 * no later than the row naming it; a group holding any other process is refused and named, never signalled, because
 * its id may have been reused by a stranger. Another session's later worker handed the same id retires the row itself
 * (`sessionRecoveryRecord.ts`), since those run the very executables this one does.
 */
import { err, ok, type Result } from "neverthrow";

import type { AppLaunchSpec } from "./sessionControlProtocol";
import type { RecoveryJournal, SessionGroupRow } from "./sessionRecoveryRecord";

/** What a resume continues: the vendor's transcript, and every process group the session's workers led. */
export interface ResumeTarget {
  readonly vendorSessionId: string;
  readonly groups: readonly SessionGroupRow[];
}

/** One process in the table, as `ps -axo pid=,pgid=,lstart=,comm=` lists it. */
export interface RecoveryProcess {
  readonly pid: number;
  readonly pgid: number;
  /** When it started, to the second, so a pid handed on to a later process reads as another process. */
  readonly started: string;
  /** The executable it runs. */
  readonly command: string;
}

/** What a recorded process group holds now. */
export type GroupClassification =
  | { readonly kind: "gone" }
  | { readonly kind: "owned"; readonly identities: readonly string[] }
  | { readonly kind: "ambiguous"; readonly strangers: readonly RecoveryProcess[] };

/**
 * One process told apart from any later process given the same pid.
 *
 * @param process a process as the table listed it
 * @returns its pid and start time together
 */
export function processIdentity({ process }: { process: RecoveryProcess }): string {
  return `${String(process.pid)} ${process.started}`;
}

/** The first field a resume names differently from the launch the journal recorded, if one does. */
function identityMismatch({ recorded, asked }: { recorded: AppLaunchSpec; asked: AppLaunchSpec }): string | undefined {
  if (recorded.vendor !== asked.vendor) {
    return "vendor";
  }
  if (recorded.directory !== asked.directory) {
    return "directory";
  }
  if (recorded.ledgerHome !== asked.ledgerHome) {
    return "ledger home";
  }
  // A transcript that ran against one state home never resumes against another: its verbs read and wrote that home.
  if (recorded.stateHome !== asked.stateHome) {
    return "state home";
  }
  if (recorded.vendor === "codex" && asked.vendor === "codex" && recorded.codexHome !== asked.codexHome) {
    return "Codex home";
  }
  const claudeRoute =
    recorded.vendor === "claude" &&
    asked.vendor === "claude" &&
    credentialRoute({ spec: recorded }) !== credentialRoute({ spec: asked });
  return claudeRoute ? "credential route" : undefined;
}

/** A Claude launch's whole credential route as one comparable string: its kind, store and any token file. */
function credentialRoute({ spec }: { spec: AppLaunchSpec & { vendor: "claude" } }): string {
  const { credential } = spec;
  const tokenFile = credential.kind === "setup-token" ? credential.tokenFilePath : "";
  return JSON.stringify([credential.kind, credential.secureStorageDir, tokenFile]);
}

/**
 * The transcript a resume continues, or why the journal does not allow it.
 *
 * @param journal the recovery journal, folded
 * @param sessionId the app's own id for the session, as the spawn's open ledger row records it
 * @param spec the launch the spawn asks for now
 * @returns the vendor transcript and the session's groups, or why it may not be resumed
 */
export function resumeTargetOf({
  journal,
  sessionId,
  spec,
}: {
  journal: RecoveryJournal;
  sessionId: string;
  spec: AppLaunchSpec;
}): Result<ResumeTarget, string> {
  if (journal.malformedLines.length > 0) {
    const lines = journal.malformedLines.join(", ");
    return err(`the recovery journal has lines no row decodes from (${lines}), so no session is resumed from it`);
  }
  const session = journal.sessions.get(sessionId);
  if (session?.opened === undefined) {
    return err(
      `the recovery journal records no session ${sessionId} that came up, so there is no transcript to resume`,
    );
  }
  if (session.closed) {
    return err(`session ${sessionId} was stopped from its card or a close, so it is not resumed`);
  }
  const mismatch = identityMismatch({ asked: spec, recorded: session.opened.spec });
  if (mismatch !== undefined) {
    return err(`session ${sessionId} was opened with a different ${mismatch}, so it is not resumed`);
  }
  return ok({ groups: session.groups, vendorSessionId: session.opened.vendorSessionId });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A collapsed `lstart`: weekday, month, day of month, `hh:mm:ss`, year. */
const STARTED = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/u;

/**
 * A start time as `ps` prints it under `TZ=UTC` (weekday, month, day of month, `hh:mm:ss`, year), on the epoch in
 * milliseconds.
 *
 * @param started the start time, its whitespace collapsed as {@link parseProcessTable} leaves it
 * @returns the instant, or undefined when the text is not one
 */
export function startedEpochMs({ started }: { started: string }): number | undefined {
  const match = STARTED.exec(started);
  if (match === null) {
    return undefined;
  }
  const monthIndex = MONTHS.findIndex((name) => name === match[1]);
  if (monthIndex < 0) {
    return undefined;
  }
  const [day, hours, minutes, seconds, year] = match.slice(2).map(Number);
  return Date.UTC(year!, monthIndex, day, hours, minutes, seconds);
}

/**
 * Whether the group's leader (the process whose pid is the group id) started after the row naming the group was
 * written. The session's own leader started before its row, which is written once the worker is spawned, so a later
 * leader is whoever the id was handed to since. `ps` gives whole seconds, so a stranger started within the same
 * second as the row is not caught here; the expected executables and the journal's retired ids still are.
 */
function leaderStartedAfterRow({
  members,
  pgid,
  rowAtIso,
}: {
  members: readonly RecoveryProcess[];
  pgid: number;
  rowAtIso: string;
}): boolean {
  const leader = members.find((process) => process.pid === pgid);
  if (leader === undefined) {
    return false;
  }
  const startedMs = startedEpochMs({ started: leader.started });
  // A start time that does not read as one cannot prove the leader is the session's own.
  return startedMs === undefined || startedMs > Date.parse(rowAtIso);
}

/**
 * What one recorded process group holds now.
 *
 * @param pgid the group's id, as its row recorded it
 * @param processes the whole process table, its start times read under `TZ=UTC`
 * @param expectedExecutables the executables the row says a process of the group may run
 * @param rowAtIso when the row naming the group was written; a leader started after it is not the session's
 * @param known the identities an earlier read of this group called owned, absent on the first read; a process
 *   outside them joined the group since, so it may be whoever was handed the group id once the session's ended
 * @returns gone when no process is in it; owned when every process in it runs an expected executable, its leader
 *   started no later than the row and, after the first read, each was owned on an earlier one; else ambiguous, with
 *   every process that is not
 */
export function classifyRecoveryGroup({
  pgid,
  processes,
  expectedExecutables,
  rowAtIso,
  known,
}: {
  pgid: number;
  processes: readonly RecoveryProcess[];
  expectedExecutables: readonly string[];
  rowAtIso: string;
  known?: ReadonlySet<string>;
}): GroupClassification {
  const members = processes.filter((process) => process.pgid === pgid);
  if (members.length === 0) {
    return { kind: "gone" };
  }
  const lateLeader = leaderStartedAfterRow({ members, pgid, rowAtIso });
  const strangers = members.filter(
    (process) =>
      !expectedExecutables.includes(process.command) ||
      (lateLeader && process.pid === pgid) ||
      (known !== undefined && !known.has(processIdentity({ process }))),
  );
  if (strangers.length > 0) {
    return { kind: "ambiguous", strangers };
  }
  return { kind: "owned", identities: members.map((process) => processIdentity({ process })) };
}

/**
 * One line of `ps -axo pid=,pgid=,lstart=,comm=` under the C locale and UTC: two numbers, the start time as five fields
 * (weekday, month, day of month padded with a space, `hh:mm:ss`, year), then the executable, which may hold spaces.
 */
const PROCESS_LINE =
  /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S.*)$/u;

/**
 * The process table `ps -axo pid=,pgid=,lstart=,comm=` printed under the C locale.
 *
 * @param text what it printed
 * @returns every process it listed, or the first line that is not one, so a table read wrong is never half trusted
 */
export function parseProcessTable({ text }: { text: string }): Result<readonly RecoveryProcess[], string> {
  const processes: RecoveryProcess[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const match = PROCESS_LINE.exec(line);
    if (match === null) {
      return err(`the process table has a line that is not a pid, a group, a start time and a command: ${line}`);
    }
    processes.push({
      command: match[4]!.trimEnd(),
      pgid: Number(match[2]),
      pid: Number(match[1]),
      started: match[3]!.replaceAll(/\s+/gu, " "),
    });
  }
  return ok(processes);
}
