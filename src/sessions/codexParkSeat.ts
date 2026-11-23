/**
 * Which Codex thread a parking seat IS, for `session close-done` — pure, and positive-evidence only.
 *
 * `./parkSeat.ts` binds a Claude Code seat through Claude's session registry. Codex keeps no such registry, so a
 * Codex seat is bound by the two things a live thread does leave (`../measurement/codexSessions.ts`): its own idle
 * composer on the screen, and a Codex process holding the thread's rollout or writer lock. Every fact fails closed:
 *
 * - the screen reads as Codex at rest under Codex's own measured patterns (`../cmux/turnState.ts`): a running turn
 *   or a queued line is a working seat, and anything else proves nothing;
 * - only a thread the run's CURRENT cycle names under the `codex` host is asked about — a launch or a claim — so a
 *   Claude session's id is never offered to the Codex observer;
 * - exactly one of those threads is held by a process inside the workspace's own process tree, whose start stamp
 *   reads as a time.
 *
 * Absence proves nothing, so a thread no process was seen holding is UNMEASURED and keeps the seat, never idle.
 */
import { classifyTurnScreen } from "../cmux/turnState.js";
import { currentCycle, type RunEvent } from "../handover/ledger.js";
import type { CodexThreadObserver } from "../measurement/codexSessions.js";
import { lstartToIso, type SeatIdentity } from "./parkSeat.js";

/** What the screen and Codex's open files say about a seat with no Claude Code session in its tree. */
export type CodexParkSeatReading =
  | { readonly kind: "identified"; readonly identity: SeatIdentity & { readonly kind: "identified" } }
  | { readonly kind: "working"; readonly state: "running" | "queued" }
  | { readonly kind: "unmeasured"; readonly why: string };

/**
 * Every thread the run's current cycle names under the Codex host, oldest first, each once. A `resumed` line carries
 * no host of its own and a hostless `launched` predates cross-host ownership, so neither names a Codex thread.
 *
 * @returns the thread ids
 */
export function codexThreadsOf({ events }: { events: readonly RunEvent[] }): readonly string[] {
  const threads: string[] = [];
  for (const event of currentCycle({ events })) {
    const codex = (event.kind === "launched" || event.kind === "claimed") && event.host === "codex";
    if (codex && !threads.includes(event.sessionId)) {
      threads.push(event.sessionId);
    }
  }
  return threads;
}

/**
 * The Codex thread a seat runs, bound to the process holding it, or why it is working or cannot be named.
 *
 * @param events the run journal's events, in order
 * @param observeThread what Codex's open files say about one thread; asked only for the cycle's Codex threads
 * @param screen the seat's screen as just read
 * @param starts each running pid's start stamp, from one `ps` listing under `TZ=UTC LC_ALL=C`
 * @param treePids every pid in the workspace's process tree
 * @returns the identified Codex seat, a working one, or why it is UNMEASURED
 */
export function readCodexParkSeat({
  events,
  observeThread,
  screen,
  starts,
  treePids,
}: {
  events: readonly RunEvent[];
  observeThread: CodexThreadObserver;
  screen: string;
  starts: ReadonlyMap<number, string>;
  treePids: readonly number[];
}): CodexParkSeatReading {
  const state = classifyTurnScreen({ host: "codex", screen });
  if (state === "running" || state === "queued") {
    return { kind: "working", state };
  }
  if (state !== "idle") {
    return { kind: "unmeasured", why: "its screen shows no Codex composer at rest" };
  }
  const threads = codexThreadsOf({ events });
  if (threads.length === 0) {
    return { kind: "unmeasured", why: "its run's current cycle names no Codex thread" };
  }
  const { held, missed } = heldInTree({ observeThread, threads, treePids });
  const [only] = held;
  if (only === undefined) {
    return { kind: "unmeasured", why: `no Codex thread of its run is held in its process tree (${missed.join("; ")})` };
  }
  if (held.length > 1) {
    const names = held.map((entry) => `${entry.threadId} pid ${String(entry.pid)}`).join(", ");
    return {
      kind: "unmeasured",
      why: `${String(held.length)} Codex threads of its run are held in its tree (${names})`,
    };
  }
  const stamp = starts.get(only.pid);
  const startedIso = stamp === undefined ? undefined : lstartToIso({ text: stamp });
  if (startedIso === undefined) {
    return { kind: "unmeasured", why: `the start of pid ${String(only.pid)}, holding ${only.threadId}, does not read` };
  }
  return {
    identity: {
      host: "codex",
      kind: "identified",
      pid: only.pid,
      sessionId: only.threadId,
      startedIso,
      status: "idle",
    },
    kind: "identified",
  };
}

/**
 * Which of the run's Codex threads a process inside the seat's own tree holds, and why each other one is not.
 *
 * @param threads the run's current-cycle Codex threads, each asked about once
 * @returns the held threads with their holders, and one line per thread not held in the tree
 */
function heldInTree({
  observeThread,
  threads,
  treePids,
}: {
  observeThread: CodexThreadObserver;
  threads: readonly string[];
  treePids: readonly number[];
}): { readonly held: readonly { readonly threadId: string; readonly pid: number }[]; readonly missed: string[] } {
  const pids = new Set(treePids);
  const held: { readonly threadId: string; readonly pid: number }[] = [];
  const missed: string[] = [];
  for (const threadId of threads) {
    const seen = observeThread({ threadId });
    if (seen.kind === "not-observed") {
      missed.push(`${threadId}: ${seen.why}`);
    } else if (pids.has(seen.pid)) {
      held.push({ pid: seen.pid, threadId });
    } else {
      missed.push(`${threadId}: held by pid ${String(seen.pid)}, outside its process tree`);
    }
  }
  return { held, missed };
}
