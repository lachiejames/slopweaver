/*
 * `isClaudeWatchProcess` — whether the pid a keep-alive record names is really this checkout's standing
 * `claude watch` loop, rather than a reused pid, another tree's watcher, another verb or a one-shot run. It was
 * split out when the process-snapshot suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { isClaudeWatchProcess, type ProcessRow } from "../../../../../live/standing/processes.js";

describe("isClaudeWatchProcess — a live pid is not a live WATCHER", () => {
  const CWD = "/wt/keep-alive";
  const WATCHER: ProcessRow = {
    argv: `node --import tsx ${CWD}/src/cli/index.ts claude watch --interval 5`,
    pid: 4242,
    ppid: 100,
  };

  it("recognises this loop running out of the checkout the record names", () => {
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [WATCHER] })).toBe(true);
  });

  // The whole point. `pidAlive` is `process.kill(pid, 0)`, true for a process "ours or not", and pids are
  // reused — so a watcher killed a second after stamping its record leaves a fresh record over a number
  // the OS has handed to something else, which without this reads as a healthy keep-alive.
  it("refuses a REUSED pid running something else entirely", () => {
    const reused: ProcessRow = { argv: "/bin/sleep 600", pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [reused] })).toBe(false);
  });

  it("refuses a DIFFERENT watcher, started from another tree, being credited to this record", () => {
    const elsewhere: ProcessRow = { argv: "node /wt/other/src/cli/index.ts claude watch", pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [elsewhere] })).toBe(false);
  });

  // Not deliberate impersonation — asking the corpus about this very feature is ordinary use, and its
  // argv legitimately contains the words `claude watch` after a DIFFERENT verb. Searching the whole argv
  // would credit that query with a reused pid and report a healthy keep-alive over a machine with none,
  // so the verb is anchored to the tokens immediately after the CLI entrypoint.
  it("refuses another verb whose own free-text ARGUMENT happens to be `claude watch`", () => {
    const query: ProcessRow = {
      argv: `node --import tsx ${CWD}/src/cli/index.ts facts claude watch`,
      pid: 4242,
      ppid: 1,
    };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [query] })).toBe(false);
  });

  // The sharper version of the same class: a question that embeds the FULL entrypoint path. Only reading
  // the FIRST occurrence — the one that launched the process — separates how a process was started from
  // what its arguments happen to mention.
  it("refuses a query whose own text embeds the entrypoint path and the verb", () => {
    const query: ProcessRow = {
      argv: `node ${CWD}/src/cli/index.ts facts why does ${CWD}/src/cli/index.ts claude watch stall`,
      pid: 4242,
      ppid: 1,
    };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [query] })).toBe(false);
  });

  it("accepts the launcher spelling bin/slopweaver produces", () => {
    const viaBin: ProcessRow = { argv: `node ${CWD}/bin/../src/cli/index.ts claude watch`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [viaBin] })).toBe(true);
  });

  it("refuses another verb of the same CLI in the right tree", () => {
    const gauge: ProcessRow = { argv: `node ${CWD}/src/cli/index.ts claude gauge`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [gauge] })).toBe(false);
  });

  it("refuses a pid that is not in the table at all", () => {
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 999, processes: [WATCHER] })).toBe(false);
  });
});

describe("isClaudeWatchProcess — the same verb is not always a STANDING session", () => {
  const CWD = "/wt/keep-alive";

  // Both are ordinary hand-run invocations from the same tree, which makes them realistic occupants of a
  // reused pid. Neither keeps a store alive: --dry-run writes nothing at all, and --once has exited by
  // the time anyone reads the record. Accepting either reports `watching` over a machine refreshing
  // nothing, which is the same false-alive verdict the pid check exists to remove.
  it("refuses a --dry-run loop, which writes nothing", () => {
    const dry: ProcessRow = { argv: `node ${CWD}/src/cli/index.ts claude watch --dry-run`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [dry] })).toBe(false);
  });

  it("refuses a --once loop, which is a one-shot probe rather than a standing session", () => {
    const once: ProcessRow = { argv: `node ${CWD}/src/cli/index.ts claude watch --once --json`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [once] })).toBe(false);
  });

  it("refuses a --help invocation, which the CLI intercepts before the handler loads", () => {
    const help: ProcessRow = { argv: `node ${CWD}/src/cli/index.ts claude watch --help`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [help] })).toBe(false);
  });

  it("still accepts the indefinite loop, whatever interval it carries", () => {
    const real: ProcessRow = { argv: `node ${CWD}/src/cli/index.ts claude watch --interval 5`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [real] })).toBe(true);
  });

  it("does not mistake a worktree whose own PATH contains the word once", () => {
    const cwd = "/wt/run-once-experiment";
    const real: ProcessRow = { argv: `node ${cwd}/src/cli/index.ts claude watch`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd, pid: 4242, processes: [real] })).toBe(true);
  });

  it("refuses an --interval the verb's parser refuses, which exits before it can loop", () => {
    const bad: ProcessRow = { argv: `node ${CWD}/src/cli/index.ts claude watch --interval 0`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [bad] })).toBe(false);
  });

  it("still accepts a --wait watch, which becomes the standing session once admitted", () => {
    const waiter: ProcessRow = { argv: `node ${CWD}/src/cli/index.ts claude watch --wait`, pid: 4242, ppid: 1 };
    expect(isClaudeWatchProcess({ cwd: CWD, pid: 4242, processes: [waiter] })).toBe(true);
  });
});
