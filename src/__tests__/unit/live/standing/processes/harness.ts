/*
 * The argv fixtures more than one process-snapshot test file reads, written the way `ps -ax -o pid=,ppid=,args=`
 * prints them. A plain module, not a `*.test.ts`, so no test registers twice. It was split out when the
 * process-snapshot suite became one file per behaviour.
 *
 * The argv fixtures here are cut down from a real reading rather than invented: the listener's own
 * tsx line, and a `claude` line carrying the `--settings` JSON blob that made a naive line parser necessary.
 */
import type { ProcessRow } from "../../../../../live/standing/processes.js";

/** The listener's real argv shape, shortened. */
export const LISTENER_ARGV =
  "/node --require /wt/28aug/node_modules/tsx/dist/preflight.cjs /wt/28aug/bin/../src/cli/index.ts listen --follow";

/** A `claude` argv carrying the settings blob, shortened. */
export const CLAUDE_ARGV =
  '/claude --session-id 60aa20c0-d689 --settings {"hooks":{"Stop":[]}} --plugin-dir /wt/26aug-b --model opus';

/** A snapshot: a listener whose parent is a claude session. */
export const SNAPSHOT: readonly ProcessRow[] = [
  { argv: CLAUDE_ARGV, pid: 42246, ppid: 1 },
  { argv: "/bin/zsh", pid: 61048, ppid: 42246 },
  { argv: LISTENER_ARGV, pid: 61202, ppid: 61048 },
];
