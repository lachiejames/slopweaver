/**
 * The effectful half of `profile-unloaded`: read the load ledger, every Claude transcript written in the window, and
 * the hand register, then judge.
 *
 * All three reads are local, so a pass opens no connection (monitors read local state only). A source that is there and could not be
 * read is `unmeasurable`, never `clear`: a clear read off a transcript it could not open would be the silent failure
 * this monitor exists to end.
 */
import { mergeObservations, observationOfRow, type ProfileLoadObservation } from "../context/loadLedger.js";
import { readProfileLoads, transcriptProfileObservations } from "../context/loadLedgerStore.js";
import { surveySessions } from "../transcripts/source.js";

import { readHeldKeys } from "./heldKeys.js";
import { evaluateProfileUnloaded, PROFILE_UNLOADED, PROFILE_UNLOADED_WINDOW_MS } from "./profileUnloaded.js";
import type { MonitorReading } from "./types.js";

/** Every transcript written since `sinceMs`: whose it is, what it says of the profile hook, and what went unread. */
function recentTranscriptObservations({ projectsDir, sinceMs }: { projectsDir: string; sinceMs: number }): {
  problems: string[];
  running: Set<string>;
  transcript: ProfileLoadObservation[];
} {
  const problems: string[] = [];
  const running = new Set<string>();
  const transcript: ProfileLoadObservation[] = [];
  const survey = surveySessions({ projectsDir });
  if (survey.isErr()) {
    return { problems: [survey.error.message], running, transcript };
  }
  for (const dir of survey.value.unreadableDirs) {
    problems.push(`the transcript directory ${dir} could not be listed, so a session in it went unseen`);
  }
  for (const session of survey.value.sessions.filter((each) => each.lastWriteMs >= sinceMs)) {
    running.add(session.sessionId);
    const read = transcriptProfileObservations({ fileSessionId: session.sessionId, path: session.path });
    if (read.isErr()) {
      problems.push(...read.error);
      continue;
    }
    transcript.push(...read.value);
  }
  return { problems, running, transcript };
}

/**
 * The observations of every session still running: each transcript written inside the window, its own profile-hook
 * runs and failures, and every ledger row of a session that either wrote a transcript or recorded a load inside it,
 * merged so a ledger row outranks the transcript's own copy of the same load.
 *
 * @param home the state home the ledger lives under
 * @param projectsDir where Claude Code keeps transcripts
 * @param nowMs the instant the window ends at
 * @returns the observations, or every reason one source could not be read
 */
export function runningSessionObservations({
  home,
  projectsDir,
  nowMs,
}: {
  home: string;
  projectsDir: string;
  nowMs: number;
}): { readonly observations: readonly ProfileLoadObservation[]; readonly problems: readonly string[] } {
  const sinceMs = nowMs - PROFILE_UNLOADED_WINDOW_MS;
  const { problems, running, transcript } = recentTranscriptObservations({ projectsDir, sinceMs });
  const ledger = readProfileLoads({ home });
  if (ledger.isErr()) {
    problems.push(...ledger.error);
    return { observations: transcript, problems };
  }
  if (ledger.value.undecodable > 0) {
    problems.push(`${String(ledger.value.undecodable)} line(s) of the profile load ledger are not a load row`);
  }
  for (const row of ledger.value.rows) {
    if (Date.parse(row.atIso) >= sinceMs) {
      running.add(row.sessionId);
    }
  }
  const observations = mergeObservations({
    ledger: ledger.value.rows.filter((row) => running.has(row.sessionId)).map((row) => observationOfRow({ row })),
    transcript,
  });
  return { observations: observations.filter((observation) => running.has(observation.sessionId)), problems };
}

/**
 * Read and evaluate `profile-unloaded`.
 *
 * @param home the state home
 * @param projectsDir where Claude Code keeps transcripts
 * @param nowMs the instant to judge at
 * @param neverConfigured whether this machine never selected a store nor read a profile: a first boot has no profile
 *   to have lost, its calls are never held, so its failed boot load is no note
 * @returns the reading — any source that could not be read is `unmeasurable`, never `clear`
 */
export function readProfileUnloaded({
  home,
  projectsDir,
  nowMs,
  neverConfigured,
}: {
  home: string;
  projectsDir: string;
  nowMs: number;
  neverConfigured: () => boolean;
}): MonitorReading {
  if (neverConfigured()) {
    return { monitorId: "profile-unloaded", state: "clear" };
  }
  const held = readHeldKeys({ definition: PROFILE_UNLOADED, home });
  if (held.isErr()) {
    return { because: held.error, monitorId: "profile-unloaded", state: "unmeasurable" };
  }
  const read = runningSessionObservations({ home, nowMs, projectsDir });
  const reading = evaluateProfileUnloaded({
    dismissed: held.value.dismissed,
    observations: read.observations,
    shown: held.value.shown,
  });
  // A failure SEEN is worth the note even when another source went unread — the note is the point, and holding it
  // back over a missing half would trade a known failure for silence. Only a pass that saw none is unmeasurable.
  if (read.problems.length > 0 && reading.state !== "firing") {
    return { because: read.problems.join("; "), monitorId: "profile-unloaded", state: "unmeasurable" };
  }
  return reading;
}
