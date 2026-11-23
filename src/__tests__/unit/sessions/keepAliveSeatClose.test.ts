/**
 * `keepAliveOnlyCloseDecision` over the retired chair as measured (`./keepAliveChairFixture.ts`).
 */
import { describe, expect, it } from "vitest";
import { err, ok } from "../../../lib/result.js";
import { ProcessTableErrors } from "../../../live/standing/processTableErrors.js";
import { keepAliveForceNote, keepAliveOnlyCloseDecision } from "../../../sessions/keepAliveSeatClose.js";
import {
  BARE_KEEP_ALIVE,
  bashToolArgv,
  CHAIR_HOSTS,
  CHAIR_TREE,
  CHAIR_WATCH,
  CHAIR_WATCH_ONLY,
  COVERED,
  chairScreen,
  claudeRow,
  NO_SHELL,
  ONE_SHELL,
  PIPED_CHAIR_TREE,
  PIPED_KEEP_ALIVE,
  SOLE,
  SUCCESSOR_QUEUED,
  shellRow,
  ugrepRow,
  watchRows,
} from "./keepAliveChairFixture.js";

const TWO_SHELLS = chairScreen({ footer: "⏵⏵ bypass permissions on · 2 shells · ← 3 agents · ↓ to manage" });
const SHELL_AND_MONITOR = chairScreen({ footer: "⏵⏵ bypass permissions on · 1 shell, 1 monitor · ← 3 agents" });

/** Nothing else retiring in this pass — takeover's case, and a sweep's first chair. */
const NONE = new Set<number>();

describe("keepAliveOnlyCloseDecision", () => {
  it("forces a chair whose one shell is its keep-alive while a successor's queued watch covers it", () => {
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: ONE_SHELL,
      table: COVERED,
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({ coverPids: [67939], kind: "force", seatWatchPids: [85912] });
  });

  it("takes a running watch outside the chair as cover too", () => {
    const running = ok([...CHAIR_WATCH, ...watchRows({ child: 20566, launcher: 20565, wait: false })]);
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: ONE_SHELL,
      table: running,
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({ coverPids: [20566], kind: "force", seatWatchPids: [85912] });
  });

  it("holds the chair that runs the only keep-alive on the machine", () => {
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table: SOLE, tree: CHAIR_TREE });
    expect(decision).toEqual({
      detail: "it holds the only keep-alive (pid 85912); start one elsewhere with `claude watch --wait` first",
      kind: "held",
      reason: "sole-keep-alive",
    });
  });

  // Argv alone once made a SIGSTOPed watch cover for the machine's only running one.
  it("never takes a stopped or zombie watch outside the chair as cover", () => {
    for (const state of ["T", "T+", "Z"]) {
      const stopped = ok([...CHAIR_WATCH, ...watchRows({ child: 20566, launcher: 20565, state, wait: true })]);
      const decision = keepAliveOnlyCloseDecision({
        retiring: NONE,
        screen: ONE_SHELL,
        table: stopped,
        tree: CHAIR_TREE,
      });
      expect(decision).toMatchObject({ kind: "held", reason: "sole-keep-alive" });
    }
  });

  // A watch in a chair the same sweep closed once counted as cover for the next one.
  it("holds a chair whose only cover sits in a seat this pass already closed, naming that cover", () => {
    const decision = keepAliveOnlyCloseDecision({
      retiring: new Set([67939]),
      screen: ONE_SHELL,
      table: COVERED,
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({
      detail: "its only cover (pid 67939) sits in a seat this pass closed; the next pass re-reads",
      kind: "held",
      reason: "cover-retiring",
    });
  });

  // A closed seat's tree listed the cover's launcher and not its loop, which the table places
  // under it.
  it("holds a chair whose only cover runs under a launcher a seat this pass closed held", () => {
    const decision = keepAliveOnlyCloseDecision({
      retiring: new Set([67938]),
      screen: ONE_SHELL,
      table: COVERED,
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({
      detail: "its only cover (pid 67939) sits in a seat this pass closed; the next pass re-reads",
      kind: "held",
      reason: "cover-retiring",
    });
  });

  // A watch cmux's tree omitted, which the table places under the seat's own watch, dies with
  // the seat — it was once taken for cover from outside it.
  it("never takes a watch the table places under the seat's own watch as cover", () => {
    const nested = watchRows({ child: 20566, launcher: 20565, wait: true }).map((row) =>
      row.pid === 20565 ? { ...row, ppid: 85912 } : row,
    );
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: ONE_SHELL,
      table: ok([...CHAIR_WATCH, ...nested]),
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({
      detail:
        "it holds the only keep-alive (pid 85912, pid 20566); start one elsewhere with `claude watch --wait` first",
      kind: "held",
      reason: "sole-keep-alive",
    });
  });

  it("still forces when a second cover survives the seats this pass closed", () => {
    const two = ok([...CHAIR_WATCH, ...SUCCESSOR_QUEUED, ...watchRows({ child: 20566, launcher: 20565, wait: true })]);
    const decision = keepAliveOnlyCloseDecision({
      retiring: new Set([67939]),
      screen: ONE_SHELL,
      table: two,
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({ coverPids: [20566], kind: "force", seatWatchPids: [85912] });
  });

  it("never reads an unrelated process outside the chair as cover", () => {
    const unrelated = ok([...CHAIR_WATCH, { argv: "/bin/sleep 600", pid: 777, ppid: 1, state: "S", tty: "??" }]);
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: ONE_SHELL,
      table: unrelated,
      tree: CHAIR_TREE,
    });
    expect(decision).toMatchObject({ kind: "held", reason: "sole-keep-alive" });
  });

  it("holds a chair whose footer counts a shell that is not a keep-alive", () => {
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: TWO_SHELLS,
      table: COVERED,
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({
      detail: "its footer counts 2 shell(s); its tree holds 1, 1 of them running a keep-alive",
      kind: "held",
      reason: "other-background-shell",
    });
  });

  // A watch hung straight off `claude` once stood in for the footer's one shell, a real
  // shell running `sleep`.
  it("never counts a watch outside any shell as the footer's shell", () => {
    const offShell = [
      {
        ...CHAIR_TREE[0]!,
        children: [
          { children: [{ children: [], name: "node", pid: 85912 }], name: "node", pid: 84992 },
          { children: [{ children: [], name: "sleep", pid: 90001 }], name: "zsh", pid: 90000 },
        ],
      },
    ];
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table: COVERED, tree: offShell });
    expect(decision).toEqual({
      detail: "its footer counts 1 shell(s); its tree holds 1, 0 of them running a keep-alive",
      kind: "held",
      reason: "other-background-shell",
    });
  });

  // `claude watch & sleep 600` is one shell, one watch — and work the close would kill.
  it("holds a chair whose keep-alive shell also runs other work, naming that process", () => {
    const shared = [
      {
        ...CHAIR_TREE[0]!,
        children: [
          ...CHAIR_TREE[0]!.children.slice(0, 1),
          {
            children: [
              { children: [{ children: [], name: "node", pid: 85912 }], name: "node", pid: 84992 },
              { children: [], name: "sleep", pid: 90001 },
            ],
            name: "zsh",
            pid: 84990,
          },
        ],
      },
    ];
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table: COVERED, tree: shared });
    expect(decision).toEqual({
      detail: "its keep-alive's shell also runs pid 90001 (sleep)",
      kind: "held",
      reason: "watch-shell-shared",
    });
  });

  // Two watches in one shell matched "2 shells" while a second shell ran `sleep`.
  it("counts the shells that host a watch, never the watches, against the footer", () => {
    const twoShells = chairScreen({ footer: "⏵⏵ bypass permissions on · 2 shells · ← 3 agents · ↓ to manage" });
    const crowded = [
      {
        ...CHAIR_TREE[0]!,
        children: [
          {
            children: [
              { children: [{ children: [], name: "node", pid: 85912 }], name: "node", pid: 84992 },
              { children: [{ children: [], name: "node", pid: 20566 }], name: "node", pid: 20565 },
            ],
            name: "zsh",
            pid: 84990,
          },
          { children: [{ children: [], name: "sleep", pid: 90001 }], name: "zsh", pid: 84995 },
        ],
      },
    ];
    const table = ok([
      ...CHAIR_WATCH,
      ...watchRows({ child: 20566, launcher: 20565, wait: true }),
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: twoShells, table, tree: crowded });
    expect(decision).toEqual({
      detail: "its footer counts 2 shell(s); its tree holds 2, 1 of them running a keep-alive",
      kind: "held",
      reason: "other-background-shell",
    });
  });

  // `claude watch & while :; do :; done` starts no child; only the shell's own state shows it.
  it("holds a chair whose keep-alive shell is running rather than asleep on its watch", () => {
    const running = ok([
      claudeRow({ pid: 42315 }),
      shellRow({ pid: 84990, state: "R" }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: ONE_SHELL,
      table: running,
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({
      detail: "its keep-alive's shell (pid 84990) reads R, not asleep on its watch",
      kind: "held",
      reason: "watch-shell-awake",
    });
  });

  it("holds a chair whose keep-alive shell the process table does not list", () => {
    const unlisted = ok([claudeRow({ pid: 42315 }), ...CHAIR_WATCH_ONLY, ...SUCCESSOR_QUEUED]);
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: ONE_SHELL,
      table: unlisted,
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({
      detail: "its keep-alive's shell (pid 84990) is missing from the process table, not asleep on its watch",
      kind: "held",
      reason: "watch-shell-awake",
    });
  });

  it("forces when the keep-alive shell has gone idle, as macOS prints a long sleep", () => {
    const idle = ok([
      claudeRow({ pid: 42315 }),
      shellRow({ pid: 84990, state: "Is" }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table: idle, tree: CHAIR_TREE });
    expect(decision).toEqual({ coverPids: [67939], kind: "force", seatWatchPids: [85912] });
  });

  // A shell asleep in its own builtin starts no child and reads `S` like one waiting on its
  // watch; only its command string shows the work.
  it.each([
    { argv: "/bin/zsh -c zmodload zsh/zselect; claude watch & zselect -t 60000", shape: "a builtin beside the watch" },
    { argv: bashToolArgv({ command: `${BARE_KEEP_ALIVE} | tail -f` }), shape: "a pipeline into a following tail" },
    { argv: bashToolArgv({ command: `${BARE_KEEP_ALIVE} | sh` }), shape: "a pipeline into a shell" },
    { argv: bashToolArgv({ command: `${BARE_KEEP_ALIVE} > out.log` }), shape: "a redirect to a file" },
    { argv: bashToolArgv({ command: "claude watch --wait" }), shape: "a watch not run through slopweaver" },
    { argv: bashToolArgv({ command: `${BARE_KEEP_ALIVE}; sleep 600` }), shape: "a command after the watch" },
  ])("holds a chair whose keep-alive shell's own command is $shape", ({ argv }) => {
    const table = ok([
      claudeRow({ pid: 42315 }),
      shellRow({ argv, pid: 84990 }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: CHAIR_TREE });
    expect(decision).toEqual({
      detail:
        "its keep-alive's shell (pid 84990) runs something other than `slopweaver claude watch` and admitted read-only filters",
      kind: "held",
      reason: "watch-shell-command",
    });
  });

  // MEASURED (`ps -o command= -p <a keep-alive shell's pid>`): every live chair started its watch through the boot chain's grep prefix, and
  // all 50 retired ones stayed open because this read as more than a keep-alive.
  it("forces the measured chair whose keep-alive runs through the boot chain's grep, its ugrep owned", () => {
    const table = ok([
      claudeRow({ pid: 42315 }),
      shellRow({ argv: bashToolArgv({ command: PIPED_KEEP_ALIVE }), pid: 84990 }),
      ugrepRow({ pid: 84993 }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: PIPED_CHAIR_TREE });
    expect(decision).toEqual({ coverPids: [67939], kind: "force", seatWatchPids: [85912] });
  });

  it("forces a chair whose keep-alive runs through grep then tail, each filter process owned", () => {
    const table = ok([
      claudeRow({ pid: 42315 }),
      shellRow({ argv: bashToolArgv({ command: `${PIPED_KEEP_ALIVE} | tail -20` }), pid: 84990 }),
      ugrepRow({ pid: 84993 }),
      { ...ugrepRow({ pid: 84994 }), argv: "tail -20" },
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: PIPED_CHAIR_TREE });
    expect(decision).toEqual({ coverPids: [67939], kind: "force", seatWatchPids: [85912] });
  });

  it.each([
    { argv: "/bin/zsh -c slopweaver claude watch", shape: "a plain shell running it bare" },
    { argv: `${bashToolArgv({ command: BARE_KEEP_ALIVE })}   `, shape: "the Bash-tool shell padded by ps" },
    { argv: bashToolArgv({ command: BARE_KEEP_ALIVE, legacy: true }), shape: "the pre-2.1.323 Bash-tool shell" },
    { argv: bashToolArgv({ command: "/opt/bin/slopweaver claude watch" }), shape: "the Bash-tool shell, no --wait" },
  ])("forces when the keep-alive shell's command is $shape", ({ argv }) => {
    const table = ok([
      claudeRow({ pid: 42315 }),
      shellRow({ argv, pid: 84990 }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: CHAIR_TREE });
    expect(decision).toEqual({ coverPids: [67939], kind: "force", seatWatchPids: [85912] });
  });

  // The table is read after the tree, so work the shell started between them shows only there.
  it("holds a chair whose keep-alive shell runs work only the later process-table read shows", () => {
    const table = ok([
      ...CHAIR_WATCH,
      { argv: "/bin/sleep 600", pid: 90001, ppid: 84990, state: "S", tty: "ttys012" },
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: CHAIR_TREE });
    expect(decision).toEqual({
      detail: "its keep-alive's shell also runs pid 90001 (sleep)",
      kind: "held",
      reason: "watch-shell-shared",
    });
  });

  it("forces when the table shows the shell's watch launcher and what the watch started, and nothing else", () => {
    const table = ok([
      ...CHAIR_HOSTS,
      ...CHAIR_WATCH_ONLY.map((row) => (row.pid === 84992 ? { ...row, ppid: 84990 } : row)),
      { argv: "/Users/owner/.local/bin/claude -p probe", pid: 91000, ppid: 85912, state: "S", tty: "ttys012" },
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: CHAIR_TREE });
    expect(decision).toEqual({ coverPids: [67939], kind: "force", seatWatchPids: [85912] });
  });

  // A watch shell under a `python` root once counted as the seat's own.
  it("holds a chair whose tree root is not its own claude, naming that root", () => {
    const foreign = [{ ...CHAIR_TREE[0]!, name: "python", pid: 500 }];
    const table = ok([
      { argv: "/usr/bin/python3 serve.py", pid: 500, ppid: 1, state: "S+", tty: "ttys012" },
      shellRow({ pid: 84990 }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: foreign });
    expect(decision).toEqual({
      detail: "its tree's root pid 500 (python) is not its own claude",
      kind: "held",
      reason: "root-not-claude",
    });
  });

  // Any node script under a directory named for the package once passed as the seat's claude.
  it("holds a chair whose root runs some other script from a directory named for Claude Code's package", () => {
    const table = ok([
      {
        argv: "/usr/local/bin/node /tmp/@anthropic-ai/claude-code/evil.js",
        pid: 42315,
        ppid: 1,
        state: "S+",
        tty: "ttys012",
      },
      shellRow({ pid: 84990 }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: CHAIR_TREE });
    expect(decision).toEqual({
      detail: "its tree's root pid 42315 (2.1.318) is not its own claude",
      kind: "held",
      reason: "root-not-claude",
    });
  });

  it("takes a root running Claude Code's npm package under node as its claude", () => {
    const table = ok([
      {
        argv: "/usr/local/bin/node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
        pid: 42315,
        ppid: 1,
        state: "S+",
        tty: "ttys012",
      },
      shellRow({ pid: 84990 }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table, tree: CHAIR_TREE });
    expect(decision).toEqual({ coverPids: [67939], kind: "force", seatWatchPids: [85912] });
  });

  it("forces when everything in the keep-alive's shell is the watch or something it started", () => {
    const probing = [
      {
        ...CHAIR_TREE[0]!,
        children: [
          ...CHAIR_TREE[0]!.children.slice(0, 1),
          {
            children: [
              {
                children: [{ children: [{ children: [], name: "claude", pid: 91000 }], name: "node", pid: 85912 }],
                name: "node",
                pid: 84992,
              },
            ],
            name: "zsh",
            pid: 84990,
          },
        ],
      },
    ];
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table: COVERED, tree: probing });
    expect(decision).toEqual({ coverPids: [67939], kind: "force", seatWatchPids: [85912] });
  });

  it("holds a chair whose one shell runs something other than a watch", () => {
    const elsewhere = ok([...CHAIR_HOSTS, ...SUCCESSOR_QUEUED]);
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: ONE_SHELL,
      table: elsewhere,
      tree: CHAIR_TREE,
    });
    expect(decision).toMatchObject({ kind: "held", reason: "other-background-shell" });
  });

  it("holds a chair with a Monitor running beside the keep-alive", () => {
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: SHELL_AND_MONITOR,
      table: COVERED,
      tree: CHAIR_TREE,
    });
    expect(decision).toMatchObject({ kind: "held", reason: "monitor-running" });
  });

  it("holds a screen with no background shell, which the ordinary idle close already owns", () => {
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: NO_SHELL, table: COVERED, tree: CHAIR_TREE });
    expect(decision).toMatchObject({ kind: "held", reason: "no-background-shell" });
  });

  it("holds a chair mid-turn", () => {
    const working = chairScreen({ footer: "⏵⏵ bypass permissions on · 1 shell · esc to interrupt" }).replace(
      "❯ ",
      "✶ Working…",
    );
    const decision = keepAliveOnlyCloseDecision({ retiring: NONE, screen: working, table: COVERED, tree: CHAIR_TREE });
    expect(decision).toMatchObject({ kind: "held", reason: "not-at-rest" });
  });

  it("holds an unreadable screen", () => {
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: undefined,
      table: COVERED,
      tree: CHAIR_TREE,
    });
    expect(decision).toMatchObject({ kind: "held", reason: "screen-unreadable" });
  });

  it("holds an unread or empty process tree", () => {
    const unread = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table: COVERED, tree: undefined });
    const empty = keepAliveOnlyCloseDecision({ retiring: NONE, screen: ONE_SHELL, table: COVERED, tree: [] });
    expect(unread).toMatchObject({ reason: "tree-unreadable" });
    expect(empty).toMatchObject({ reason: "tree-unreadable" });
  });

  it("holds an unreadable process table", () => {
    const decision = keepAliveOnlyCloseDecision({
      retiring: NONE,
      screen: ONE_SHELL,
      table: err(ProcessTableErrors.unreadable({ cause: new Error("ps exited 1") })),
      tree: CHAIR_TREE,
    });
    expect(decision).toEqual({
      detail: "the process table did not read: the process table could not be read (ps exited 1)",
      kind: "held",
      reason: "snapshot-unreadable",
    });
  });
});

describe("keepAliveForceNote", () => {
  it("names the retiring watch and the one covering for it", () => {
    expect(keepAliveForceNote({ decision: { coverPids: [67939], kind: "force", seatWatchPids: [85912] } })).toBe(
      "its keep-alive (pid 85912) retires with it; pid 67939 keeps the stores alive",
    );
  });
});
