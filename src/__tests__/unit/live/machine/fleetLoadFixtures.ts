/**
 * A reduced process snapshot for `src/live/machine/fleetLoad.ts` and `reap.ts`, modelled on the stalled-session
 * load incident: two live sessions, one of them wedged on nineteen parallel PreToolUse hooks, and a dead
 * seat's orphaned shells still burning CPU under `launchd`. A plain module, not a `*.test.ts`, so importing
 * it never registers a second copy of anyone's tests.
 *
 * Every argv shape here was captured live on this machine the same day — a session's `--session-id`, a tool
 * shell's `source ~/.claude/shell-snapshots/snapshot-zsh-<ms>-<rand>.sh`, and a hook shim's
 * `scripts/pretooluse-<name>.sh`.
 */
import type { ProcessRow } from "../../../../live/standing/processes.js";

/** The dead seat's snapshot — no un-reparented process sources it, which is what makes its shells reapable. */
export const DEAD_SEAT = "/Users/a/.claude/shell-snapshots/snapshot-zsh-1789700000000-dead11.sh";

/** The wedged session's snapshot, still sourced by a live shell. */
export const BUSY_SEAT = "/Users/a/.claude/shell-snapshots/snapshot-zsh-1789710000000-busy22.sh";

/** The quiet session's snapshot. */
const QUIET_SEAT = "/Users/a/.claude/shell-snapshots/snapshot-zsh-1789711000000-quiet3.sh";

/** The wedged session's own id — the one a culprit clause must name. */
export const WEDGED_SESSION_ID = "aaaaaaaa-1111-2222-3333-444444444444";

/** The quiet session's id. */
export const QUIET_SESSION_ID = "bbbbbbbb-5555-6666-7777-888888888888";

/** One `/bin/zsh -c source <snapshot> … && eval '<command>'` row, as Claude Code spells a Bash tool call. */
function toolShell({
  pid,
  ppid,
  seat,
  command,
}: {
  pid: number;
  ppid: number;
  seat: string;
  command: string;
}): ProcessRow {
  return {
    argv: `/bin/zsh -c source ${seat} 2>/dev/null || true && setopt NO_EXTENDED_GLOB && eval '${command}'`,
    pid,
    ppid,
  };
}

/** One PreToolUse hook shim row, as it runs under a session's own `claude` process. */
function hook({ pid, ppid, script }: { pid: number; ppid: number; script: string }): ProcessRow {
  return { argv: `bash /Users/a/.claude/plugins/data/slopweaver/mirror/current/scripts/${script}.sh`, pid, ppid };
}

/**
 * The tsx LOADER child one hook firing spawns under its own shim — captured live, where pid
 * 93104 (`…/.bin/tsx …/hooks/pretooluse-main-checkout-edit-guard.ts`) held child pid 93353 running the same
 * hook path through tsx's preflight and loader. Its argv names the same script, so a count that does not
 * filter to ROOTS reads one firing as two tool calls.
 */
function hookLoaderChild({ pid, ppid, script }: { pid: number; ppid: number; script: string }): ProcessRow {
  return {
    argv:
      "/Users/a/.proto/node/bin/node --require /Users/a/cli-deps/node_modules/tsx/dist/preflight.cjs " +
      `--import file:///Users/a/cli-deps/node_modules/tsx/dist/loader.mjs /Users/a/mirror/current/hooks/${script}.ts`,
    pid,
    ppid,
  };
}

/**
 * The snapshot: a wedged session (pid 100) with three concurrent copies of one hook script and two of
 * another — one of them carrying its tsx loader child, so a root-blind count reads four poll-gate calls
 * where three fired — a quiet session (pid 200) with one, and three orphaned shells from a dead seat, one
 * of them with a child.
 */
export const INCIDENT_PROCESSES: readonly ProcessRow[] = [
  { argv: "/sbin/launchd", pid: 1, ppid: 0 },
  { argv: `/Users/a/.local/bin/claude --session-id ${WEDGED_SESSION_ID} --settings {}`, pid: 100, ppid: 99 },
  hook({ pid: 101, ppid: 100, script: "pretooluse-poll-gate" }),
  hook({ pid: 102, ppid: 100, script: "pretooluse-poll-gate" }),
  hook({ pid: 103, ppid: 100, script: "pretooluse-poll-gate" }),
  hook({ pid: 104, ppid: 100, script: "pretooluse-admit" }),
  hook({ pid: 105, ppid: 100, script: "pretooluse-admit" }),
  hookLoaderChild({ pid: 111, ppid: 101, script: "pretooluse-poll-gate" }),
  toolShell({ command: "yarn test", pid: 110, ppid: 100, seat: BUSY_SEAT }),
  { argv: `/Users/a/.local/bin/claude --session-id ${QUIET_SESSION_ID} --settings {}`, pid: 200, ppid: 199 },
  hook({ pid: 201, ppid: 200, script: "pretooluse-poll-gate" }),
  toolShell({ command: "git status", pid: 210, ppid: 200, seat: QUIET_SEAT }),
  toolShell({ command: "while true; do yarn test; done", pid: 300, ppid: 1, seat: DEAD_SEAT }),
  toolShell({ command: "while true; do yarn lint; done", pid: 301, ppid: 1, seat: DEAD_SEAT }),
  { argv: "node /Users/a/repo/node_modules/.bin/vitest run", pid: 302, ppid: 300 },
  toolShell({ command: "sleep 9999", pid: 310, ppid: 1, seat: BUSY_SEAT }),
];

/** `top -l 2 -s 1 -stats pid,cpu`, reduced: the first sample reads zero, as top's always does. */
export const INCIDENT_TOP_CPU_TEXT = [
  "Processes: 2 total, 1 running, 1 sleeping, 10 threads ",
  "CPU usage: 27.23% user, 16.19% sys, 56.57% idle ",
  "",
  "PID    %CPU",
  "100    0.0 ",
  "300    0.0 ",
  "Processes: 8 total, 4 running, 4 sleeping, 40 threads ",
  "CPU usage: 60.00% user, 30.00% sys, 10.00% idle ",
  "",
  "PID    %CPU",
  "100    40.0",
  "101    5.0",
  "110    5.0",
  "200    2.0",
  "300    11.0",
  "301    12.0",
  "302    20.0",
  "310    1.0",
  "",
].join("\n");

/** `ps -ax -o pid=,etime=`, reduced: the wedged session's hooks have been running 43 minutes. */
export const INCIDENT_ETIME_TEXT = [
  "  100    2:11:04",
  "  101      43:12",
  "  102      41:02",
  "  103      40:55",
  "  104      39:00",
  "  105      38:10",
  "  111      43:11",
  "  110      44:00",
  "  200       5:00",
  "  201       0:01",
  "  300  1-02:00:00",
  "  301    3:00:00",
  "  310      10:00",
  "",
].join("\n");
