/*
 * The fixtures the cold-seat tests share: the bound session, the measured bare tab and its grafted shell, a tab
 * running claude, cmux's saved binding, the on-disk transcript check, and the 0.65.2 process table with its grafted
 * login shell.
 */
import type { CmuxProcess } from "../../../../cmux/client.js";
import type { CmuxResumeBinding } from "../../../../cmux/resumeBinding.js";
import type { TtyProcessRow } from "../../../../live/standing/processes.js";

export const BOUND = "a0000096-0000-4000-8000-000000000103";

/** The measured bare tab: one shell at its prompt, and nothing else. */
export const BARE_SHELL: readonly CmuxProcess[] = [{ children: [], name: "zsh", pid: 10 }];
/**
 * `BARE_SHELL` once grafted against a table row spelling the shell `-/bin/zsh`: the graft names an attributed node
 * by the table's row, so the bare `zsh` cmux reports becomes the path the row holds.
 */
export const GRAFTED_SHELL: readonly CmuxProcess[] = [{ children: [], name: "-/bin/zsh", pid: 10 }];
export const RUNNING_CLAUDE: readonly CmuxProcess[] = [
  { children: [{ children: [], name: "2.1.287", pid: 393 }], name: "zsh", pid: 10 },
];

/**
 * The binding cmux saves for a worker tab.
 *
 * @returns that binding, with every field `over` names replaced
 */
export function binding(over: Partial<CmuxResumeBinding> = {}): CmuxResumeBinding {
  return {
    argv: `--model opus --resume ${BOUND}`,
    checkpointId: BOUND,
    cwd: "/wt/seat",
    source: "resume_binding",
    ...over,
  };
}

/**
 * Every transcript is on disk.
 *
 * @returns true, whichever transcript is asked about
 */
export const ALL_ON_DISK = (): boolean => true;

/**
 * The process table behind the tab MEASURED on cmux 0.65.2 (`ps -ax -o pid=,ppid=,tty=,args=`): cmux
 * itself on no tty, the tab's `login` and its login shell on the tab's tty, and an unrelated process the tab's surface
 * never lists. Every other test's tab sits on `ttys005`, so these rows are never on it.
 */
export const TABLE: readonly TtyProcessRow[] = [
  { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 60470, ppid: 1, state: "S", tty: "??" },
  {
    argv: "/usr/bin/login -flp ada /bin/bash --noprofile --norc -c exec -l /bin/zsh",
    pid: 60561,
    ppid: 60470,
    state: "Ss",
    tty: "ttys003",
  },
  { argv: "-/bin/zsh", pid: 60562, ppid: 60561, state: "S", tty: "ttys003" },
  { argv: "/usr/sbin/distnoted", pid: 596, ppid: 1, state: "S", tty: "??" },
];

/** The grafted tree of a 0.65.2 tab at its prompt: the shell under the `login` that started it. */
export const LOGIN_SHELL: readonly CmuxProcess[] = [
  { children: [{ children: [], name: "-/bin/zsh", pid: 60562 }], name: "/usr/bin/login", pid: 60561 },
];
