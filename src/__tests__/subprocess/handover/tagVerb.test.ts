/**
 * `handover tag` and `register --tag` against the SHIPPED binary: the writes, the refusals that leave nothing
 * behind, the printed recovery command in both worlds, and the board-wide lock serialising real processes.
 *
 * ## Why these cannot be unit cases
 *
 * `unit/handover/tagStore.test.ts` proves every judgement over a frozen snapshot. What only a process can show is
 * that a second process WAITS on the lock rather than judging the same snapshot, and that the event it then writes
 * carries an instant read after the wait. Each lock case holds the real lock from this process and releases it
 * while the child is waiting, so the order is forced rather than raced.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { tagRecoveryCommand } from "../../../cli/commands/handover/tagReceipt.js";
import { runStateOf } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { ROW_TAGS_LOCK_KEY } from "../../../handover/tagStore.js";
import { parseTagRequest } from "../../../handover/tagWrite.js";
import { unwrap } from "../../../lib/result.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** Each case spawns the CLI up to three times, and two of them wait on a held lock. */
const CLI_TIMEOUT_MS = 180_000;

/** Long enough that a child which did NOT wait would already have written. */
const HOLD_MS = 4000;

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home, optionally holding one live row. */
function stateHome({ row }: { row?: string } = {}): string {
  const home = mkdtempSync(join(tmpdir(), "sw-tag-e2e-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"), { recursive: true });
  mkdirSync(join(home, "runs"), { recursive: true });
  if (row !== undefined) {
    writeFileSync(
      join(home, "handovers", `${row}.md`),
      ["---", `slug: ${row}`, "kind: ask", "summary: a row", "status: ready", "---", "", "# a row", ""].join("\n"),
      "utf8",
    );
  }
  return home;
}

/** The environment every child runs in: this home and nothing of the operator's. */
function childEnv({ home }: { home: string }): NodeJS.ProcessEnv {
  return {
    ...accountSandboxChildEnv(),
    HOME: home,
    PATH: process.env["PATH"]!,
    SLOPWEAVER_HOME: home,
    TMPDIR: process.env["TMPDIR"]!,
  };
}

/** Run the shipped binary against one home, and report what it printed. */
async function cli({
  args,
  home,
}: {
  args: readonly string[];
  home: string;
}): Promise<{ status: number; stdout: string; stderr: string }> {
  const child = spawn(BIN, [...args, "--home", home], { cwd: home, env: childEnv({ home }) });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  // A null exit code means the child was SIGNALLED; report it as 1 rather than as a clean run.
  const status = await new Promise<number>((resolveExit) => {
    child.on("close", (code) => {
      if (code === null) {
        resolveExit(1);
        return;
      }
      resolveExit(code);
    });
  });
  return { status, stderr, stdout };
}

/** Resolve after `ms`, so a held lock is released while a child waits on it. */
async function pause({ ms }: { ms: number }): Promise<void> {
  await new Promise((resolveLater) => setTimeout(resolveLater, ms));
}

/** A dispatch row needs no ask shape, which keeps these registrations to the flags under test. */
const REGISTER = ["handover", "register", "--ask", "tag this row", "--dispatch", "--asked-iso", "2026-09-28T01:00:00Z"];

describe("register --tag", { timeout: CLI_TIMEOUT_MS }, () => {
  it("lands the row with its tags, recorded as registered with --tag", async () => {
    const home = stateHome();
    const registered = await cli({
      args: [
        ...REGISTER,
        "--slug",
        "new-row",
        "--tag",
        "platform=slack,workstream=hiring",
        "--new-value",
        "workstream=hiring",
      ],
      home,
    });
    expect(registered.status).toBe(0);
    expect(registered.stdout).toContain("handover tag: new-row tagged");
    expect(registered.stdout).toContain("  declared: platform=slack workstream=hiring");
    const events = unwrap(readRunJournal({ runsDir: join(home, "runs"), slug: "new-row" })).events;
    expect(events.map((event) => (event.kind === "tagged" ? event.why : event.kind))).toEqual([
      "registered with --tag",
    ]);
  });

  it("refuses an unacknowledged new workstream before the row exists, leaving neither doc nor journal", async () => {
    const home = stateHome();
    const refused = await cli({ args: [...REGISTER, "--slug", "typo-row", "--tag", "workstream=hirng"], home });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("workstream=hirng is new — no row on the board carries it");
    expect(existsSync(join(home, "handovers", "typo-row.md"))).toBe(false);
    expect(existsSync(join(home, "runs", "typo-row.jsonl"))).toBe(false);
  });

  it("refuses a slug that already has a journal, so a new row never inherits old history", async () => {
    const home = stateHome();
    writeFileSync(join(home, "runs", "old-row.jsonl"), "", "utf8");
    const refused = await cli({ args: [...REGISTER, "--slug", "old-row", "--tag", "impact=high"], home });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`${join(home, "runs", "old-row.jsonl")} already exists`);
    expect(existsSync(join(home, "handovers", "old-row.md"))).toBe(false);
  });

  it("refuses a slug that would build a path outside the board", async () => {
    const home = stateHome();
    const refused = await cli({ args: [...REGISTER, "--slug", "../escape"], home });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('"../escape" is not a usable slug');
    expect(existsSync(join(home, "escape.md"))).toBe(false);
  });
});

describe("handover tag", { timeout: CLI_TIMEOUT_MS }, () => {
  it("writes once, then answers unchanged and exits 0", async () => {
    const home = stateHome({ row: "a-row" });
    const args = ["handover", "tag", "a-row", "impact=high", "--why", "a test"];
    const first = await cli({ args, home });
    const second = await cli({ args, home });
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("handover tag: a-row tagged");
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("handover tag: a-row unchanged");
    expect(unwrap(readRunJournal({ runsDir: join(home, "runs"), slug: "a-row" })).events.length).toBe(1);
  });

  it("refuses an empty request before taking the lock", async () => {
    const home = stateHome({ row: "a-row" });
    const refused = await cli({ args: ["handover", "tag", "a-row", "--why", "nothing"], home });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("a tagged event must set or drop at least one tag");
  });

  it("prints a recovery command that is right whether or not the first attempt committed", async () => {
    const home = stateHome({ row: "a-row" });
    const request = unwrap(
      parseTagRequest({ assignments: ["workstream=payroll"], drops: undefined, newValues: "workstream=payroll" }),
    );
    const line = tagRecoveryCommand({ home, request, slug: "a-row", why: "it's a retry" });
    const run = (): ReturnType<typeof spawnSync> =>
      spawnSync("sh", ["-c", line.replace(/^slopweaver /u, `'${BIN}' `)], {
        encoding: "utf8",
        env: childEnv({ home }),
      });
    const uncommitted = run();
    const committed = run();
    expect(uncommitted.status).toBe(0);
    expect(uncommitted.stdout).toContain("handover tag: a-row tagged");
    expect(committed.status).toBe(0);
    expect(committed.stdout).toContain("handover tag: a-row unchanged");
    expect(committed.stdout).toContain("--new-value not needed, a row already carries: workstream=payroll");
  });

  it("waits on a held lock, and stamps its event with an instant read after the wait", async () => {
    const home = stateHome({ row: "a-row" });
    const runsDir = join(home, "runs");
    const held = unwrap(acquireOperationLock({ home, key: ROW_TAGS_LOCK_KEY, nowIso: new Date().toISOString() }));
    const waiting = cli({ args: ["handover", "tag", "a-row", "impact=high", "--why", "a test"], home });
    await pause({ ms: HOLD_MS });
    const whileHeld = existsSync(join(runsDir, "a-row.jsonl"));
    const startedIso = new Date().toISOString();
    unwrap(
      applyRowEvent({
        event: { atIso: startedIso, branch: "b", docHash: "h", kind: "started" },
        runsDir,
        slug: "a-row",
      }),
    );
    held.release();
    const tagged = await waiting;
    expect(whileHeld).toBe(false);
    expect(tagged.status).toBe(0);
    const events = unwrap(readRunJournal({ runsDir, slug: "a-row" })).events;
    expect(events.map((event) => event.kind)).toEqual(["started", "tagged"]);
    expect(events[1]!.atIso >= startedIso).toBe(true);
    const state = runStateOf({ events });
    expect(state.phase).toBe("open");
    expect(state.lastIso).toBe(events[1]!.atIso);
  });

  it("makes a registration wait on the same lock", async () => {
    const home = stateHome();
    const held = unwrap(acquireOperationLock({ home, key: ROW_TAGS_LOCK_KEY, nowIso: new Date().toISOString() }));
    const waiting = cli({ args: [...REGISTER, "--slug", "queued-row"], home });
    await pause({ ms: HOLD_MS });
    const whileHeld = existsSync(join(home, "handovers", "queued-row.md"));
    held.release();
    const registered = await waiting;
    expect(whileHeld).toBe(false);
    expect(registered.status).toBe(0);
    expect(existsSync(join(home, "handovers", "queued-row.md"))).toBe(true);
  });
});
