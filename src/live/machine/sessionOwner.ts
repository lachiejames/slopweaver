/**
 * Which live Claude Code session a process belongs to — the attribution half of `slopweaver machine capacity`,
 * pure, and split from `./capacity.ts` along the seam it already had.
 *
 * ## Why a process's PARENT CHAIN, and not only its own argv, decides fleet
 *
 * MEASURED: a bot turn's shell ran a `python3 -` heredoc that read the multi-gigabyte Slack
 * `compact.jsonl` whole. `ps` printed its argv as `Python -` — nothing in it names claude, cmux or slopweaver —
 * so the capacity verb reported `top foreign hog 'Python' at <tens of> GB` at the 12-swapfile hold, and the chair found the
 * session that owned it by hand, through a `ppid` chain and `lsof`. A memory panic's largest footprint was the
 * same shape: a fleet-spawned `Python` at tens of GiB. The static `whole-file-json` gate reads TypeScript and cannot
 * see a heredoc, so that gauge is the class's only runtime witness, and a witness that cannot name the session
 * leaves the one act that ends the incident — stopping that session's tool call — to a hand search.
 *
 * The join is Claude Code's own registry, `~/.claude/sessions/<pid>.json`, by exact pid: an interactive cmux
 * session's argv need not carry `--session-id`, and `\bclaude\b` over an argv also matches every `.claude/`
 * path. Residue, stated: a session whose registry file is missing or unreadable owns nothing here, so its child
 * reads foreign exactly as before, and a pid reused after its session exited is not detectable from a `ps`
 * snapshot. Reproduce a chain with `ps -o pid=,ppid=,args= -p <pid>`, walking upward.
 */
import type { ProcessRow } from "../standing/processes.js";

/** A live Claude Code session, as its own registry file names it — what a process is attributed to. */
export interface ClaudeSession {
  /** The `claude` process's own pid — the registry file's name. */
  readonly pid: number;
  readonly sessionId: string;
  /** The session's working directory, so a reader sees WHICH worktree without a second lookup. */
  readonly cwd: string;
}

/** How far up a parent chain the session walk climbs — a cycle in a racing `ps` snapshot must not hang a gauge. */
const MAX_SESSION_HOPS = 24;

/**
 * The Claude Code session a process is, or descends from: walk the parent chain, itself first, to the first
 * pid a registry file names. A pid missing from the snapshot, a self-parented row or {@link MAX_SESSION_HOPS}
 * ends the walk with no owner.
 *
 * @param processes the `ps` snapshot, for each row's `ppid`
 * @param sessions every live session the registry names, keyed by the `claude` process's pid
 * @param pid the process to attribute
 * @returns the owning session, or `undefined` when the chain reaches none
 */
export function owningSessionOf({
  processes,
  sessions,
  pid,
}: {
  processes: readonly ProcessRow[];
  sessions: readonly ClaudeSession[];
  pid: number;
}): ClaudeSession | undefined {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  // A record with no session id cannot name anyone, and `parseSessionFile` defaults an absent id to "".
  const sessionByPid = new Map(
    sessions.filter((session) => session.sessionId.length > 0).map((session) => [session.pid, session]),
  );
  let current: number | undefined = pid;
  for (let hop = 0; hop < MAX_SESSION_HOPS && current !== undefined; hop++) {
    // The row is required BEFORE the registry is asked: a registry file outliving its process (the pane's own
    // `gone` state) must not own a child whose parent pid names nothing in this snapshot.
    const row = byPid.get(current);
    if (row === undefined) {
      return undefined;
    }
    const session = sessionByPid.get(current);
    if (session !== undefined) {
      return session;
    }
    current = row.ppid === row.pid ? undefined : row.ppid;
  }
  return undefined;
}

/**
 * How a report line names a session: its id, then the last segment of its working directory — the worktree a
 * reader recognises — so the owner of a hog is actionable from the line alone.
 *
 * @param session the session to name
 * @returns `session <id> in <cwd basename>`, or just `session <id>` when the registry recorded no cwd
 */
export function sessionPhrase({ session }: { session: ClaudeSession }): string {
  // `split` always yields at least one segment, so the last one always exists.
  const where = session.cwd.replace(/\/+$/u, "").split("/").at(-1)!;
  return where.length === 0 ? `session ${session.sessionId}` : `session ${session.sessionId} in ${where}`;
}
