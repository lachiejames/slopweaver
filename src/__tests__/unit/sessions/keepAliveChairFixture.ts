/**
 * A retired supervisor chair as measured, shared by every keep-alive close case: its screen at rest
 * with the one shell its `claude watch` runs in (`slopweaver cmux read-screen --workspace workspace:1000031202`), its
 * cmux process tree with the watch's node under the chair's own `claude`
 * (`slopweaver cmux processes --workspace workspace:1000031202 --json`), and `ps` rows for that watch and a successor's
 * queued one. Pids are those reads'; paths are synthetic. Its shell runs the keep-alive bare, as canon starts it; the
 * piped form every chair's boot chain writes (`PIPED_KEEP_ALIVE`) adds a `ugrep` child beside the watch.
 */
import type { CmuxProcess } from "../../../cmux/client.js";
import { ok } from "../../../lib/result.js";
import type { TtyProcessRow } from "../../../live/standing/processes.js";
import type { WatchTable } from "../../../sessions/keepAliveSeatClose.js";

const MAIN = "/Users/owner/dev/slopweaver";

/**
 * The retired chair's screen, cut to its last answer, prompt and footer.
 *
 * @param footer the mode footer's text, which carries the background counts
 * @returns the screen
 */
export function chairScreen({ footer }: { footer: string }): string {
  return [
    "⏺ Hand-off complete. The successor supervisor holds the pin.",
    "",
    "✻ Cogitated for 21s · done 4:35 am · 1 shell still running",
    "───────────────────────────────────────────────────────────────────────────",
    "❯ ",
    "───────────────────────────────────────────────────────────────────────────",
    `  ${footer}`,
  ].join("\n");
}

/** The measured screen: at rest, one background shell. */
export const ONE_SHELL = chairScreen({ footer: "⏵⏵ bypass permissions on · 1 shell · ← 3 agents · ↓ to manage" });

/** The same chair with no background work at all. */
export const NO_SHELL = chairScreen({ footer: "⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents" });

/** The tree cmux attributed to chair 366: its `claude`, an MCP server, and the watch's shell under it. */
export const CHAIR_TREE: readonly CmuxProcess[] = [
  {
    children: [
      { children: [], name: "trajectory", pid: 44500 },
      {
        children: [{ children: [{ children: [], name: "node", pid: 85912 }], name: "node", pid: 84992 }],
        name: "zsh",
        pid: 84990,
      },
    ],
    name: "2.1.318",
    pid: 42315,
  },
];

/**
 * One standing watch as `ps` lists it: the tsx launcher and the node child that runs the loop.
 *
 * @param launcher the launcher's pid
 * @param child the loop's own pid, which the chair's tree holds
 * @param wait whether it was started queued with `--wait`
 * @param state the `ps` state both rows print — `S+` sleeping in the foreground, `T` stopped by a signal
 * @returns the two rows
 */
export function watchRows({
  launcher,
  child,
  wait,
  state = "S+",
}: {
  launcher: number;
  child: number;
  wait: boolean;
  state?: string;
}): TtyProcessRow[] {
  const tail = wait ? "claude watch --wait" : "claude watch";
  return [
    {
      argv: `/node ${MAIN}/bin/../node_modules/.bin/tsx ${MAIN}/bin/../src/cli/index.ts ${tail}`,
      pid: launcher,
      ppid: 1,
      state,
      tty: "ttys012",
    },
    {
      argv: `/node --require ${MAIN}/node_modules/tsx/dist/preflight.cjs ${MAIN}/bin/../src/cli/index.ts ${tail}`,
      pid: child,
      ppid: launcher,
      state,
      tty: "ttys012",
    },
  ];
}

/**
 * Claude Code's Bash-tool shell around one command, as `ps -o command=` printed each live keep-alive's shell on the
 * chair — snapshot and cwd paths synthetic. Claude Code 2.1.323 writes `\builtin setopt`; earlier releases wrote a
 * bare `setopt`, which `legacy` reproduces.
 *
 * @param command what the tool ran, which sits inside `eval '…'`, its own single quotes written `'"'"'`
 * @param legacy whether to write the options line as releases before 2.1.323 did
 * @returns the shell's argv
 */
export function bashToolArgv({ command, legacy = false }: { command: string; legacy?: boolean }): string {
  const setopt = legacy
    ? "setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true"
    : "\\builtin setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL NO_BRACE_CCL NO_MAGIC_EQUAL_SUBST 2>/dev/null || true";
  return [
    "/bin/zsh -c source /Users/owner/.claude/shell-snapshots/snapshot-zsh-1-abc.sh 2>/dev/null || true",
    setopt,
    "{ \\builtin unalias -- 'which'; \\builtin unset -f -- 'which'; } >/dev/null 2>&1 || true",
    "{ \\builtin unalias -- 'unsetenv'; \\builtin unset -f -- 'unsetenv'; } >/dev/null 2>&1 || true",
    `eval '${command}' < /dev/null`,
    "pwd -P >| /tmp/claude-1a2b-cwd",
  ].join(" && ");
}

/** The keep-alive as standing-sessions.md tells a chair to start it. */
export const BARE_KEEP_ALIVE = `SLOPWEAVER_CLI_DIR=${MAIN} ${MAIN}/bin/slopweaver claude watch --wait`;

/**
 * The keep-alive as the supervisor boot chain's prefix starts it, as it sits inside the Bash tool's `eval '…'`: a
 * workspace id, the CLI dir, stderr joined, and a `grep` dropping `slopweaver:` lines, as every live chair's shell was
 * measured (`ps -o command= -p <a keep-alive shell's pid>`). The workspace id is synthetic.
 */
export const PIPED_KEEP_ALIVE = `CMUX_WORKSPACE_ID=00000000-0000-4000-8000-000000000000 ${BARE_KEEP_ALIVE} 2>&1 | grep -v '"'"'^slopweaver:'"'"'`;

/**
 * The bundled `ugrep` a written `grep` runs as, a direct child of the keep-alive's shell, as `ps` printed it.
 *
 * @param ppid its shell's pid
 * @returns the row
 */
export function ugrepRow({ pid, ppid = 84990 }: { pid: number; ppid?: number }): TtyProcessRow {
  return {
    argv: "ugrep -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn -v ^slopweaver:",
    pid,
    ppid,
    state: "S",
    tty: "ttys012",
  };
}

/** Chair 366's tree with a `ugrep` (pid 84993, which cmux titles by Claude Code's version) beside the watch. */
export const PIPED_CHAIR_TREE: readonly CmuxProcess[] = [
  {
    ...CHAIR_TREE[0]!,
    children: [
      CHAIR_TREE[0]!.children[0]!,
      {
        ...CHAIR_TREE[0]!.children[1]!,
        children: [...CHAIR_TREE[0]!.children[1]!.children, { children: [], name: "2.1.323", pid: 84993 }],
      },
    ],
  },
];

/**
 * A shell's own `ps` row — `Ss` is a session leader asleep on its children, as `ps -ax -o pid=,stat=,comm=` prints a
 * background shell waiting on its command.
 *
 * @param pid the shell's pid, which the seat's tree holds
 * @param state its `ps` state — `R` for one running builtins itself
 * @param argv its command line — the bare keep-alive in Claude Code's Bash-tool shell by default
 * @returns the row
 */
export function shellRow({
  pid,
  state = "Ss",
  argv = bashToolArgv({ command: BARE_KEEP_ALIVE }),
}: {
  pid: number;
  state?: string;
  argv?: string;
}): TtyProcessRow {
  return { argv, pid, ppid: 42315, state, tty: "ttys012" };
}

/**
 * A seat's own Claude Code row, as `ps -o args=` prints it — cmux titles the same node by its version.
 *
 * @param pid the root pid the seat's tree holds
 * @returns the row
 */
export function claudeRow({ pid }: { pid: number }): TtyProcessRow {
  return { argv: "/Users/owner/.local/bin/claude --session-id synthetic", pid, ppid: 1, state: "S+", tty: "ttys012" };
}

/** Chair 366's live watch, pid 85912 under launcher 84992 — its loop alone, with no shell or `claude` row. */
export const CHAIR_WATCH_ONLY = watchRows({ child: 85912, launcher: 84992, wait: false });

/** Chair 366's own `claude` (42315) and the shell 84990 its watch runs in. */
export const CHAIR_HOSTS = [claudeRow({ pid: 42315 }), shellRow({ pid: 84990 })];

/** Every row chair 366 holds: its `claude`, the watch's shell and the watch. */
export const CHAIR_WATCH = [...CHAIR_HOSTS, ...CHAIR_WATCH_ONLY];

/** A successor's queued `--wait` watch, outside the chair. */
export const SUCCESSOR_QUEUED = watchRows({ child: 67939, launcher: 67938, wait: true });

/** The table with the chair's watch and the successor's queued one — the chair is covered. */
export const COVERED: WatchTable = ok([...CHAIR_WATCH, ...SUCCESSOR_QUEUED]);

/** The table with the chair's watch alone — it is the only keep-alive. */
export const SOLE: WatchTable = ok(CHAIR_WATCH);
