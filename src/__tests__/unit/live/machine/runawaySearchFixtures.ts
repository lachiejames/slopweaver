/**
 * A reduced process snapshot of the runaway-search incident for `src/live/machine/runawaySearch.ts`: one LIVE
 * seat whose tool shells hold `ugrep` children 20 to 58 minutes old at about half a core each, beside every
 * search shape the criterion must leave alone. A plain module, not a `*.test.ts`.
 *
 * The argv shapes are the incident's own, read off `pgrep -fl grep` in the seat's transcript:
 * Claude Code 2.1.310's `grep` runs as `ugrep -G --ignore-files --hidden -I --exclude-dir=.git …`, and its
 * tool shell sources `~/.claude/shell-snapshots/snapshot-zsh-<ms>-<rand>.sh`.
 */
import type { ProcessRow } from "../../../../live/standing/processes.js";

/** The incident seat's session id. */
export const RUNAWAY_SESSION_ID = "5d37a1a9-79cf-49dc-9b6f-c8e2b31d3bb0";

/** The incident seat's live snapshot. */
const SEAT = "/Users/a/.claude/shell-snapshots/snapshot-zsh-1792900000000-grep01.sh";

/** The bronze file the incident's searches read, 17.5 GB. */
const SLACK_BRONZE = "/Users/a/.slopweaver/corpus/bronze/slack/compact.jsonl";

/** Claude Code's `grep`, as `ps` prints it. */
function ugrep({ pid, ppid, pattern }: { pid: number; ppid: number; pattern: string }): ProcessRow {
  return {
    argv: `ugrep -G --ignore-files --hidden -I --exclude-dir=.git -o -i -P ${pattern} ${SLACK_BRONZE}`,
    pid,
    ppid,
  };
}

/** One tool shell under a session, as Claude Code spells a Bash tool call. */
function toolShell({ pid, ppid, command }: { pid: number; ppid: number; command: string }): ProcessRow {
  return { argv: `/bin/zsh -c source ${SEAT} 2>/dev/null || true && eval '${command}' < /dev/null`, pid, ppid };
}

/**
 * The snapshot. Selected: 511 and 521 (old, hot, under a live seat's tool shell). Left alone: 531 (an idle
 * stream filter), 541 (too young), 551 (too cold), 560 (a direct `claude → rg` child — the Grep tool's shape,
 * no tool shell), 601 (the owner's own terminal's grep), 701 (a tool shell with no session left — `./reap.ts`'s orphan
 * class, not this one), and 900 (the reaper's own ancestor).
 */
export const RUNAWAY_PROCESSES: readonly ProcessRow[] = [
  { argv: "/sbin/launchd", pid: 1, ppid: 0 },
  { argv: `/Users/a/.local/bin/claude --session-id ${RUNAWAY_SESSION_ID} --settings {}`, pid: 500, ppid: 499 },
  toolShell({ command: "grep -o -i -P ...", pid: 510, ppid: 500 }),
  ugrep({ pattern: ".{0,300}(escalate_triage|nc).{0,400}", pid: 511, ppid: 510 }),
  toolShell({ command: "grep -c nonconformit ...", pid: 520, ppid: 500 }),
  ugrep({ pattern: "nonconformit", pid: 521, ppid: 520 }),
  toolShell({ command: "tail -n0 -F f5627195.err | grep -E --line-buffered x", pid: 530, ppid: 500 }),
  { argv: "ugrep -G --line-buffered -E x", pid: 531, ppid: 530 },
  { argv: "tail -n0 -F /Users/a/.slopweaver/listener/logs/f5627195.err", pid: 532, ppid: 530 },
  toolShell({ command: "grep young ...", pid: 540, ppid: 500 }),
  ugrep({ pattern: "young", pid: 541, ppid: 540 }),
  toolShell({ command: "grep cold ...", pid: 550, ppid: 500 }),
  ugrep({ pattern: "cold", pid: 551, ppid: 550 }),
  { argv: "/Users/a/.local/share/claude/versions/2.1.310/rg --json needle /Users/a/repo", pid: 560, ppid: 500 },
  { argv: "-zsh", pid: 599, ppid: 598 },
  { argv: `grep -c needle ${SLACK_BRONZE}`, pid: 601, ppid: 599 },
  toolShell({ command: "grep orphan ...", pid: 700, ppid: 1 }),
  ugrep({ pattern: "orphan", pid: 701, ppid: 700 }),
  toolShell({ command: "grep ancestor ...", pid: 890, ppid: 500 }),
  { argv: "/usr/bin/grep ancestor /Users/a/notes", pid: 900, ppid: 890 },
];

/** `top`'s second sample, reduced to the rows that matter. */
export const RUNAWAY_TOP_CPU_TEXT = [
  "Processes: 2 total ",
  "",
  "PID    %CPU",
  "511    0.0 ",
  "Processes: 20 total ",
  "",
  "PID    %CPU",
  "511    52.3",
  "521    48.0",
  "531    0.0",
  "541    61.0",
  "551    19.9",
  "560    95.0",
  "601    70.0",
  "701    55.0",
  "900    40.0",
  "",
].join("\n");

/** `ps -ax -o pid=,etime=`, reduced: the selected pair are 58 and 20 minutes old. */
export const RUNAWAY_ETIME_TEXT = [
  "  511      58:00",
  "  521      20:00",
  "  531    3:00:00",
  "  541       9:59",
  "  551      40:00",
  "  560      30:00",
  "  601      30:00",
  "  701      30:00",
  "  900      30:00",
  "",
].join("\n");
