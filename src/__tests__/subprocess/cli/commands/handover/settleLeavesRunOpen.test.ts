/**
 * `handover settle` must never read as the whole ending while the RUN it belongs to is still open.
 *
 * Measured (`handover-settle-no-ops-after-answer-and-reads-as-success`): a session that landed
 * its work, settled its ask row and stopped left its run cycle open, because `settle` writes `settlement:`
 * into the row's front-matter and nothing at all to the journal. `session close-done`'s `doneEvidenceOf`
 * gates all three of its done-anchors behind an ENDED journal deliberately, so the workspace was never
 * reaped. The verb's whole output at the time was one success line naming neither the run nor `finish`.
 *
 * This runs the SHIPPED verb over a throwaway home, which is the only way to prove what it prints: the pure
 * lines are unit-tested in `unit/handover/settleEnding.test.ts`, and a pure test cannot show that the CLI
 * reaches them.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { ASK_SHAPE } from "./askShapeArgs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with the two directories the board and the journals live in. */
function throwawayHome(): string {
  const home = mkdtempSync(join(tmpdir(), "settle-open-run-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(home, "runs"));
  return home;
}

function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      // The lesson gate reads the memories table, and this lane has no database.
      // The break-glass is the documented way past an unreachable store, which is exactly the situation a
      // throwaway home is in, and it leaves the journal shape these tests assert unchanged — the gate's own
      // branches, including that an outage REFUSES without it, are proven in `unit/handover/lessonsGate.test.ts`.
      SLOPWEAVER_ALLOW_NO_LESSONS: "1",
      TMPDIR: process.env["TMPDIR"]!,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/** Register one ask row on a fresh home, optionally opening a run cycle on it. */
function rowOn({ home, slug, start }: { home: string; slug: string; start: boolean }): void {
  const registered = run({
    args: [
      "handover",
      "register",
      "--home",
      home,
      "--ask",
      `Should ${slug} be done?`,
      ...ASK_SHAPE,
      "--slug",
      slug,
      "--asked-iso",
      "2026-09-07T00:00:00Z",
    ],
  });
  expect(registered.status).toBe(0);
  if (start) {
    expect(run({ args: ["handover", "start", slug, "--home", home] }).status).toBe(0);
  }
}

function settle({ home, slug }: { home: string; slug: string }): { status: number; stdout: string; stderr: string } {
  return run({
    args: [
      "handover",
      "settle",
      slug,
      "--home",
      home,
      "--as",
      "answered",
      "--witness",
      "https://example.invalid/p1",
      "--lessons",
      "none",
    ],
  });
}

describe("handover settle over an OPEN run", () => {
  it("names `handover finish` and why, instead of one success line that reads as the whole ending", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "open-run-row", start: true });

    const result = settle({ home, slug: "open-run-row" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("open-run-row is settled answered");
    expect(result.stdout).toContain("The RUN for open-run-row is still open");
    expect(result.stdout).toContain("session close-done");
    expect(result.stdout).toContain("slopweaver handover finish open-run-row");
  });

  it("still writes no `finished` event — the nudge reports the state, it does not close the run for you", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "open-run-row", start: true });

    settle({ home, slug: "open-run-row" });

    const journal = readFileSync(join(home, "runs", "open-run-row.jsonl"), "utf8");
    // The positive is the witness: without it, an empty or wrong path would satisfy the absence for free.
    expect(journal).toContain('"kind":"started"');
    expect(journal).not.toContain('"kind":"finished"');
  });

  it("puts `handover answer` first when the run is waiting on the owner, because settle clears neither", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "waiting-row", start: true });
    expect(
      run({ args: ["handover", "ask", "waiting-row", "--home", home, "--question", "which base?", ...ASK_SHAPE] })
        .status,
    ).toBe(0);

    const result = settle({ home, slug: "waiting-row" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('The run is WAITING ON THE OWNER: "which base?"');
    expect(result.stdout.indexOf("handover answer waiting-row")).toBeLessThan(
      result.stdout.indexOf("handover finish waiting-row"),
    );
  });

  it("says nothing about a run for a row nobody ever started — that settle IS the whole ending", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "bookkeeping-row", start: false });

    const result = settle({ home, slug: "bookkeeping-row" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("bookkeeping-row is settled answered");
    expect(result.stdout).not.toContain("handover finish");
  });
});

/**
 * Name a writer on the row's open cycle by appending the `launched` line a hostless legacy journal carries.
 *
 * Hostless is deliberate: `classifyWriterLiveness` judges such a writer by its pid ALONE, so the verdict
 * depends on nothing but the pid chosen here — never on this machine's real Claude Code session registry.
 */
function launchedBy({ home, slug, pid }: { home: string; slug: string; pid: number }): void {
  const line = { atIso: "2026-09-07T00:00:01.000Z", kind: "launched", pid, sessionId: "session-gone" };
  appendFileSync(join(home, "runs", `${slug}.jsonl`), `${JSON.stringify(line)}\n`);
}

/** Every event in a row's journal, decoded — so an assertion names exact values rather than substrings. */
interface JournalEvent {
  readonly kind: string;
  readonly atIso: string;
  readonly cycleEvents?: number;
  readonly deadSessionId?: string;
  readonly lastEventIso?: string;
}

function journalEvents({ home, slug }: { home: string; slug: string }): readonly JournalEvent[] {
  return readFileSync(join(home, "runs", `${slug}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalEvent);
}

/** A pid that is provably dead: its process has already exited and been waited on. */
function exitedPid(): number {
  const exited = spawnSync("true");
  expect(exited.status).toBe(0);
  return exited.pid;
}

describe("handover settle over an open run whose holder is DEAD", () => {
  it("closes the cycle with the reaper's `orphaned` ending, because nobody else ever can", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "dead-holder-row", start: true });
    launchedBy({ home, pid: exitedPid(), slug: "dead-holder-row" });

    const result = settle({ home, slug: "dead-holder-row" });

    expect(result.status).toBe(0);
    // Exact LINES rather than substrings of one blob: `toContain` over the split output is membership of an
    // exact value, so an extra or altered line fails rather than passing on a shared fragment.
    const events = journalEvents({ home, slug: "dead-holder-row" });
    expect(events.map((event) => event.kind)).toEqual(["started", "launched", "lessons", "orphaned"]);
    const lessons = events[2]!;
    const orphan = events[3]!;
    // Exactly the fields the ending carries, and each one's exact value. `lastEventIso` is the cycle's real
    // last event — the lessons row this settle wrote — rather than a constant a passing test could drift from.
    expect(Object.keys(orphan).toSorted()).toEqual(["atIso", "cycleEvents", "deadSessionId", "kind", "lastEventIso"]);
    expect(orphan.cycleEvents).toBe(3);
    expect(orphan.deadSessionId).toBe("session-gone");
    expect(orphan.lastEventIso).toBe(lessons.atIso);
    // Exact LINES rather than substrings of one blob: `toContain` over the split output is membership of an
    // exact value, so an altered or extra line fails instead of passing on a shared fragment.
    const lines = result.stdout.split("\n");
    expect(lines).toContain(
      "handover settle: dead-holder-row is settled answered (witness: https://example.invalid/p1)",
    );
    expect(lines).toContain(
      `  The RUN for dead-holder-row was held by session session-gone, which is DEAD (last event ${lessons.atIso}) and can`,
    );
    expect(lines).toContain(
      "  never finish it — so settle appended the `orphaned` ending `slopweaver handover reap` writes. Nothing is",
    );
    expect(lines).toContain("  left to claim.");
  });

  it("leaves nothing for `handover reap` to find afterwards — the two read the same decision", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "dead-holder-row", start: true });
    launchedBy({ home, pid: exitedPid(), slug: "dead-holder-row" });
    // The witness that the reap below CAN fire: before the settle, it would reap this very cycle. Exact LINES,
    // because "0 cycle(s) would be reaped" is a substring of "10 cycle(s) would be reaped".
    expect(run({ args: ["handover", "reap", "--dry-run", "--home", home] }).stdout.split("\n")).toContain(
      "  would reap dead-holder-row — session-gone died after 2026-09-07T00:00:01.000Z",
    );

    settle({ home, slug: "dead-holder-row" });

    expect(run({ args: ["handover", "reap", "--dry-run", "--home", home] }).stdout.split("\n")).toContain(
      "handover reap (dry run): 0 cycle(s) would be reaped; every open cycle's writer was judgeable; nothing was written",
    );
  });

  it("routes the doc to --dir and the orphaned ending to --home's runs, each where its own flag says", () => {
    const home = throwawayHome();
    const dir = mkdtempSync(join(tmpdir(), "settle-dir-"));
    homes.push(dir);
    const routing = ["--home", home, "--dir", dir];
    expect(
      run({
        args: [
          "handover",
          "register",
          ...routing,
          "--ask",
          "Should the split row be done?",
          ...ASK_SHAPE,
          "--slug",
          "split-row",
          "--asked-iso",
          "2026-09-07T00:00:00Z",
        ],
      }).status,
    ).toBe(0);
    expect(run({ args: ["handover", "start", "split-row", ...routing] }).status).toBe(0);
    launchedBy({ home, pid: exitedPid(), slug: "split-row" });

    const result = run({
      args: ["handover", "settle", "split-row", ...routing, "--as", "answered", "--witness", "w", "--lessons", "none"],
    });

    expect(result.status).toBe(0);
    // Exact LINE and exact EVENT: a substring would accept `settlement: answered-but-wrong` just as happily.
    expect(readFileSync(join(dir, "split-row.md"), "utf8").split("\n")).toContain("settlement: answered");
    expect(journalEvents({ home, slug: "split-row" }).map((event) => event.kind)).toEqual([
      "started",
      "launched",
      "lessons",
      "orphaned",
    ]);
  });

  it("refuses to judge a journal with an undecodable line, and appends no ending over it", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "torn-row", start: true });
    launchedBy({ home, pid: exitedPid(), slug: "torn-row" });
    appendFileSync(join(home, "runs", "torn-row.jsonl"), '{"kind":"trunc\n');

    const result = settle({ home, slug: "torn-row" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the run journal has undecodable line(s)");
    expect(readFileSync(join(home, "runs", "torn-row.jsonl"), "utf8")).not.toContain('"kind":"orphaned"');
  });

  it("never reaps a holder it cannot prove dead — a live pid keeps the NEXT lines and the open cycle", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "live-holder-row", start: true });
    launchedBy({ home, pid: process.pid, slug: "live-holder-row" });

    const result = settle({ home, slug: "live-holder-row" });

    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")).toContain(
      "  NEXT: settle ended the ask ROW. The RUN for live-holder-row is still open, so `session close-done` cannot",
    );
    expect(journalEvents({ home, slug: "live-holder-row" }).map((event) => event.kind)).toEqual([
      "started",
      "launched",
      "lessons",
    ]);
  });
});

/**
 * Run the shipped CLI as a Claude Code session whose live-session registry is a throwaway, readable and EMPTY
 * directory — so the registry reports every session id absent, and a complete registry reads absence as dead.
 */
function runAsSession({
  args,
  userHome,
  sessionId,
  codexThreadId,
}: {
  args: readonly string[];
  userHome: string;
  sessionId: string | undefined;
  codexThreadId?: string;
}): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      HOME: userHome,
      PATH: process.env["PATH"]!,
      // The lesson gate reads the memories table and this lane has no database — see the note on `run`.
      SLOPWEAVER_ALLOW_NO_LESSONS: "1",
      TMPDIR: process.env["TMPDIR"]!,
      ...(sessionId === undefined ? {} : { CLAUDE_CODE_SESSION_ID: sessionId }),
      ...(codexThreadId === undefined ? {} : { CODEX_THREAD_ID: codexThreadId }),
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("handover settle run by the session that holds the run", () => {
  it("never reaps its own caller, even though the registry reads that session absent", () => {
    const home = throwawayHome();
    const userHome = mkdtempSync(join(tmpdir(), "settle-user-"));
    homes.push(userHome);
    mkdirSync(join(userHome, ".claude", "sessions"), { recursive: true });
    rowOn({ home, slug: "self-row", start: false });
    expect(
      runAsSession({ args: ["handover", "start", "self-row", "--home", home], sessionId: "self-writer", userHome })
        .status,
    ).toBe(0);
    // The witness that the guard is what saves it: judged from OUTSIDE, the registry calls this writer dead.
    expect(
      runAsSession({ args: ["handover", "reap", "--dry-run", "--home", home], sessionId: undefined, userHome }).stdout,
    ).toContain("would reap self-row — self-writer died after");

    const result = runAsSession({
      args: [
        "handover",
        "settle",
        "self-row",
        "--home",
        home,
        "--as",
        "answered",
        "--witness",
        "w",
        "--lessons",
        "none",
      ],
      sessionId: "self-writer",
      userHome,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")).toContain(
      "  NEXT: settle ended the ask ROW. The RUN for self-row is still open, so `session close-done` cannot",
    );
    expect(journalEvents({ home, slug: "self-row" }).map((event) => event.kind)).toEqual([
      "started",
      "launched",
      "lessons",
    ]);
  });

  /**
   * The adversarial counterexample: with a Claude id AND a stale Codex thread id in one environment, the
   * single-identity read answers `undefined`, and a self-guard over `undefined` protects nobody. Reproduced
   * against the shipped CLI before the fix, where settle called its own caller dead and orphaned its run.
   */
  it("still protects its caller when a stale Codex thread id makes the environment ambiguous", () => {
    const home = throwawayHome();
    const userHome = mkdtempSync(join(tmpdir(), "settle-user-"));
    homes.push(userHome);
    mkdirSync(join(userHome, ".claude", "sessions"), { recursive: true });
    rowOn({ home, slug: "ambiguous-row", start: false });
    expect(
      runAsSession({ args: ["handover", "start", "ambiguous-row", "--home", home], sessionId: "self-writer", userHome })
        .status,
    ).toBe(0);

    const result = runAsSession({
      args: [
        "handover",
        "settle",
        "ambiguous-row",
        "--home",
        home,
        "--as",
        "answered",
        "--witness",
        "w",
        "--lessons",
        "none",
      ],
      codexThreadId: "leaked-codex-thread",
      sessionId: "self-writer",
      userHome,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")).toContain(
      "  NEXT: settle ended the ask ROW. The RUN for ambiguous-row is still open, so `session close-done` cannot",
    );
    expect(journalEvents({ home, slug: "ambiguous-row" }).map((event) => event.kind)).toEqual([
      "started",
      "launched",
      "lessons",
    ]);
  });

  it("does reap that same writer when a DIFFERENT session settles the row", () => {
    const home = throwawayHome();
    const userHome = mkdtempSync(join(tmpdir(), "settle-user-"));
    homes.push(userHome);
    mkdirSync(join(userHome, ".claude", "sessions"), { recursive: true });
    rowOn({ home, slug: "other-row", start: false });
    expect(
      runAsSession({ args: ["handover", "start", "other-row", "--home", home], sessionId: "gone-writer", userHome })
        .status,
    ).toBe(0);

    const result = runAsSession({
      args: [
        "handover",
        "settle",
        "other-row",
        "--home",
        home,
        "--as",
        "answered",
        "--witness",
        "w",
        "--lessons",
        "none",
      ],
      sessionId: "the-supervisor",
      userHome,
    });

    expect(result.status).toBe(0);
    const events = journalEvents({ home, slug: "other-row" });
    expect(events.map((event) => event.kind)).toEqual(["started", "launched", "lessons", "orphaned"]);
    expect(events[3]!.deadSessionId).toBe("gone-writer");
    expect(result.stdout.split("\n")).toContain(
      `  The RUN for other-row was held by session gone-writer, which is DEAD (last event ${events[2]!.atIso}) and can`,
    );
  });
});

describe("handover settle over a run its seat PARKED", () => {
  it("ends the cycle nobody holds, so the board stops reading the settled row as live", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "parked-row", start: true });
    launchedBy({ home, pid: process.pid, slug: "parked-row" });
    const parked = {
      atIso: "2026-09-07T00:00:02.000Z",
      branch: "parked-row",
      kind: "parked",
      screenTail: "",
      sessionId: "session-gone",
      workspaceRef: "workspace:9",
      worktree: "/w/parked-row",
    };
    appendFileSync(join(home, "runs", "parked-row.jsonl"), `${JSON.stringify(parked)}\n`);

    const result = settle({ home, slug: "parked-row" });

    expect(result.status).toBe(0);
    expect(journalEvents({ home, slug: "parked-row" }).map((event) => event.kind)).toEqual([
      "started",
      "launched",
      "parked",
      "lessons",
      "finished",
    ]);
    expect(result.stdout.split("\n")).toContain(
      "  it, so no session could follow a NEXT line — settle appended the `finished` ending this settlement",
    );
    expect(result.stdout).not.toContain("NEXT: settle ended the ask ROW");
  });
});

describe("a second handover settle", () => {
  it("names the `settlement:` field, so it cannot be read as the run's own `answered` event", () => {
    const home = throwawayHome();
    rowOn({ home, slug: "twice-row", start: false });
    expect(settle({ home, slug: "twice-row" }).status).toBe(0);

    const second = settle({ home, slug: "twice-row" });

    expect(second.status).toBe(1);
    expect(second.stderr).toContain("twice-row already carries `settlement: answered`");
    expect(second.stderr).toContain("not the run's `answered` event");
    expect(second.stderr).not.toContain("twice-row is already answered");
  });
});
