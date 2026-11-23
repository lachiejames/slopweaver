/**
 * Whether the session a run journal names as its writer is still alive — the one classifier every surface uses.
 *
 * This used to live as a private function inside the claim CLI, which meant the ONLY verb that knew a dead
 * holder was claimable was `claim` itself: `release`, `abandon`, `finish`, `resume` and the hook brief all
 * rendered a stand-off that told the reader to release in the owning session — impossible when that session is
 * dead. Extracting the classifier lets every renderer share one verdict instead of each surface re-deriving
 * (and disagreeing about) what "gone" means.
 *
 * The decision tree is deliberately host-aware, and none of it is new policy:
 *
 * - A HOSTLESS journal (predates host-labelled ownership) has no registry to check, so a dead OS pid is the only
 *   signal available. An alive-or-absent pid proves nothing — the recorded pid belongs to whichever short-lived
 *   CLI process wrote the line, so "alive" may be a recycled pid and "absent" is just an old journal.
 * - A CODEX writer is `live` when a Codex process holds its thread's rollout or writer lock open, and `unknown`
 *   otherwise, never `dead`: Codex has no live-thread registry, so absence proves nothing — see
 *   {@link ../measurement/codexSessions}. Its recorded pid is never consulted; the dispatch model does not make
 *   it trustworthy proof either way.
 * - A CLAUDE CODE writer is judged by the live-session registry, where presence proves life and absence proves
 *   death only when every registry file decoded — see {@link ../measurement/sessions}.
 *
 * Pure: every effect (the pid probe, the registry read and the Codex open-file scan) is injected, so every rule is
 * testable without a process table or a registry directory. The Codex observation is a function the classifier
 * calls only for a Codex writer, so no other caller pays for the scan.
 */

import type { CodexThreadObservation } from "../measurement/codexSessions.js";
import type { Measured } from "../measurement/status.js";
import type { RunWriter, WriterLiveness } from "./runOwner.js";

/**
 * Classify a run writer's liveness from injected pid and registry evidence.
 *
 * @param writer the journal's current writer
 * @param processAlive whether an OS pid is alive — consulted only for hostless legacy journals
 * @param sessionLive whether a session id is in the live registry — consulted only for Claude Code writers
 * @param codexThread what Codex's open files say about a thread — consulted only for Codex writers
 * @returns the three-way verdict; `unknown` always carries why the measurement fell short
 */
export function classifyWriterLiveness({
  writer,
  processAlive,
  sessionLive,
  codexThread,
}: {
  writer: RunWriter;
  processAlive: (args: { pid: number }) => boolean;
  sessionLive: (args: { sessionId: string }) => Measured<boolean>;
  codexThread: (args: { threadId: string }) => CodexThreadObservation;
}): WriterLiveness {
  if (writer.host === undefined) {
    return writer.pid !== undefined && !processAlive({ pid: writer.pid })
      ? { kind: "dead" }
      : { kind: "unknown", why: "the journal predates host-labelled ownership" };
  }
  if (writer.host === "codex") {
    const observed = codexThread({ threadId: writer.sessionId });
    return observed.kind === "live" ? { kind: "live" } : { kind: "unknown", why: observed.why };
  }
  if (writer.host !== "claude-code") {
    return { kind: "unknown", why: "the journal predates host-labelled ownership" };
  }
  const verdict = sessionLive({ sessionId: writer.sessionId });
  if (!verdict.known) {
    return { kind: "unknown", why: verdict.why };
  }
  return verdict.value ? { kind: "live" } : { kind: "dead" };
}
