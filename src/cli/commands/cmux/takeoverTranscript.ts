/**
 * Gate (a)'s transcript leg — the I/O half of `../../../cmux/takeover.ts`'s second witness.
 *
 * Read only when the hook-event leg did not witness. It resolves THIS session's own transcript from the ambient
 * `CLAUDE_CODE_SESSION_ID` (the same boundary gate (a2) records owner-turn receipts against), walks it lazily
 * through the existing transcript reader, and feeds only decoded records to the pure predicate, which stops at
 * the first `ScheduleWakeup` tool_use. Every way the file cannot be read is a named `unread` leg rather than a
 * pass or a throw; a fully-read negative whose stream reported problems is `incomplete`, never a clean no
 * (`../../../supervisor/chainScan.ts`'s precedent). A decoded witness is positive evidence and stands whatever
 * other lines failed to decode, as the hook leg's positive match stands across a buffer gap.
 *
 * What this leg reads is bounded to a regular file named by the bare id directly under a project directory:
 * the finder's `statSync` and the reader's `fstatSync` both follow a symbolic link, so a link planted under
 * `~/.claude/projects` — the file itself, or the project directory above it — would have pointed the witness
 * at any file on the machine. The found path is resolved with `realpathSync` and must equal
 * the same relative name resolved under the projects directory's own real path, so a link anywhere in the
 * chain below the projects directory is refused before the reader opens anything.
 *
 * Five residues, stated rather than discovered. The file's CONTENT is Claude Code's own write: a regular file at
 * the id's name whose records name another session is read as this session's, because whoever can
 * write that file can as easily write records naming this id, so checking a record's session id would guard
 * nothing a writer inside `~/.claude/projects` could not forge. The check and the open are two syscalls, so another process
 * on this machine swapping the entry between them is not caught: that process
 * already owns the account's home and is the partial-protection residue `.claude/rules/journalled-grants.md`
 * names, not a boundary this leg can close. Which entries carry the id's name is the shared finder's contract
 * and the filesystem's — a dangling link is not an entry to `statSync`, and a case-folding volume maps the id
 * to a file spelt differently; the leg names the file by the id and takes the
 * one the filesystem maps that name to. And how the shared reader splits bytes into readings — a final line
 * without its newline, an oversized prefix — is the reader's own contract (`transcripts/source.ts`), which
 * this leg takes as given. And a mutation of a built-in prototype inside the verb's own process (`Object.prototype.undecoded` hides every record, `Array.prototype.some` witnesses on none) is
 * code already running in the process, which no leg that reads a file bounds; the discriminant below only
 * chooses which side such a mutation fails on.
 */
import { realpathSync } from "node:fs";
import { join, relative } from "node:path";

import { sweepArmedInTranscript, type TranscriptLeg } from "../../../cmux/takeover.js";
import { isBareSessionId } from "../../../sessions/liveSessionStore.js";
import { CLAUDE_CODE_SESSION_ID_ENV, type VisibleSupervisorSession } from "../../../supervisor/session.js";
import type { LineReading, TranscriptRecord } from "../../../transcripts/record.js";
import { findOnlyTranscript, transcriptReadings } from "../../../transcripts/source.js";

/**
 * The decoded records of a reading stream; an undecoded line is not a record and is skipped.
 *
 * The discriminant tested is `undecoded`, not `record`: `in` sees inherited keys, so a `record` planted on
 * `Object.prototype` would have turned every undecoded line into a forged witness,
 * while a planted `undecoded` only hides real records — the side that fails closed.
 */
function* decodedRecords({ readings }: { readings: Iterable<LineReading> }): Generator<TranscriptRecord> {
  for (const reading of readings) {
    if (!("undecoded" in reading)) {
      yield reading.record;
    }
  }
}

/**
 * Why a Codex chair's transcript leg is unread: the second witness is a Claude Code `ScheduleWakeup` tool_use, and a
 * Codex thread has no such record. What arms a Codex chair's sweep is slice 4c's to define, not this leg's to guess,
 * so the hook-event leg is a Codex chair's only witness until then.
 */
const CODEX_SWEEP_LEG_UNREAD =
  "a Codex chair's rollout carries no Claude Code ScheduleWakeup record, so only the hook-event leg can witness its sweep";

/**
 * Read this session's own transcript for the sweep arm.
 *
 * The SESSION is the takeover's one detection; the id is also read RAW from the environment, because a padded id is
 * not the id Claude Code set and detection trims. A raw id that is not the detected session is refused
 * rather than read, so this leg, the receipts and the pin can never name two sessions.
 *
 * @param env the process environment, read for the raw session id
 * @param session the visible session the takeover detected
 * @param projectsDir where Claude Code keeps transcripts; defaults to `~/.claude/projects`
 * @returns what the transcript leg found
 */
export function readTranscriptLeg({
  env,
  session,
  projectsDir,
}: {
  env: NodeJS.ProcessEnv;
  session: VisibleSupervisorSession;
  projectsDir: string;
}): TranscriptLeg {
  if (session.host === "codex") {
    return { kind: "unread", why: CODEX_SWEEP_LEG_UNREAD };
  }
  const sessionId = env[CLAUDE_CODE_SESSION_ID_ENV];
  if (sessionId === undefined || sessionId.trim().length === 0) {
    return { kind: "unread", why: `this process carries no ${CLAUDE_CODE_SESSION_ID_ENV}` };
  }
  if (!isBareSessionId({ sessionId })) {
    return {
      kind: "unread",
      why: `${CLAUDE_CODE_SESSION_ID_ENV} "${sessionId}" is not a bare session id, so no transcript is looked up`,
    };
  }
  if (sessionId !== session.id) {
    return {
      kind: "unread",
      why: `${CLAUDE_CODE_SESSION_ID_ENV} is not the session ${session.id} the takeover detected`,
    };
  }
  const path = findOnlyTranscript({ projectsDir, sessionId });
  if (path.isErr()) {
    return { kind: "unread", why: path.error.message };
  }
  let real: string;
  let expected: string;
  try {
    real = realpathSync(path.value);
    expected = join(realpathSync(projectsDir), relative(projectsDir, path.value));
  } catch (cause) {
    return { kind: "unread", why: `${path.value} could not be resolved (${String(cause)})` };
  }
  if (real !== expected) {
    return {
      kind: "unread",
      why: `${path.value} resolves to ${real} through a symbolic link, so it is not this session's own transcript`,
    };
  }
  const stream = transcriptReadings({ path: path.value });
  if (stream.isErr()) {
    return { kind: "unread", why: stream.error.message };
  }
  const witness = sweepArmedInTranscript({ records: decodedRecords({ readings: stream.value.readings }) });
  if (witness !== undefined) {
    return { kind: "witnessed", lineNumber: witness.lineNumber };
  }
  if (stream.value.problems.length > 0) {
    return { kind: "incomplete", problems: stream.value.problems };
  }
  return { kind: "no-tool-use" };
}
