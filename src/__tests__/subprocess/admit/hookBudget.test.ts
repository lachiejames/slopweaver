/**
 * A wedged hook releases the tool call within OUR budget — proved on the shipped shims, against the exact
 * hang site that produced the finding.
 *
 * The wedge shape is reproduced rather than described: the payload is written to the hook's stdin and the
 * pipe is never closed, so the read can never finish. With the ten `PreToolUse` entries folded into
 * `scripts/pretooluse.sh`, that read is the SHIM's own `cat` rather than `src/lib/readStdin.ts` inside the
 * hook — which is why it is bounded there and why a bound on the dispatch alone would have missed it
 * entirely: at that moment there is no hook process for anything to kill.
 *
 * The witness is FALSIFIABLE in both directions on purpose: the elapsed time must be at least the budget
 * (so a shim that died instantly for some unrelated reason reddens) and under the ceiling (so a shim that
 * never released reddens), and the stderr line must name the budget it spent.
 *
 * The last case is the one the others cannot see. `tsx` boots a loader child that inherits the hook's
 * stdout, so the call is released only when the LAST holder of that pipe dies — and `wait` returns the
 * instant the DIRECT child dies. A grandchild that ignores `TERM` is therefore the falsifying input, and it
 * really did survive the first cut of `bounded-run.sh` (measured, which is why the case exists).
 *
 * The second describe block is the ENVELOPE — `scripts/hook.sh`, which every `hooks/hooks.json` command now
 * runs through. Its cases drive the two shapes `slopweaver perf` pass 230 found, on the shipped entry point
 * rather than on a restatement of it: a target with no bound of its own (the `SessionStart` class, which had
 * no shell in front of it at all) and a target that ignores `TERM` (the escalation, which is where the first
 * cut of the envelope died silently — bash 3.2 has no `$BASHPID`, so reading it under `set -u` aborted the
 * watchdog before it signalled anything, and the bound looked right in the diff and fired never).
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { seedProfileDelivered } from "../../profileDeliveredFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The budget the wedged runs are given, in seconds — short, because every one of them spends all of it. */
const BUDGET_SECONDS = 2;

/** The `session_id` every wedged payload carries, and the one a delivered profile's marker is seeded for. */
const WEDGED_SESSION = "budget-wiring-session";

/** The longest a release may take before this test calls it a wedge, in milliseconds. */
const RELEASE_CEILING_MS = 30_000;

/** Per-test budget: a wedged run spends its whole budget, plus a tsx boot under lane contention. */
const CASE_TIMEOUT_MS = 90_000;

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after the test that minted it. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-hook-budget-"));
  homes.push(dir);
  return dir;
}

/**
 * Run a shipped shim with its stdin held OPEN, so the payload can never be read to end-of-file.
 *
 * @param shim the script's name under `scripts/`
 * @param payload the tool call, written to stdin and then deliberately not followed by an end-of-file
 * @param home a Slopweaver home to run against, so a case can read back what the shim wrote; a fresh one with the owner's
 *   profile delivered to the payload's session when omitted
 * @returns the exit status, what the shim said on stderr, and how long the call was held
 */
async function runWedged({
  shim,
  payload,
  home: given,
}: {
  shim: string;
  payload: unknown;
  home?: string;
}): Promise<{ status: number | null; stderr: string; elapsedMs: number }> {
  let home = given;
  if (home === undefined) {
    home = tempDir();
    seedProfileDelivered({ home, sessionId: WEDGED_SESSION });
  }
  const startedMs = Date.now();
  const child = spawn(join(repoRoot, "scripts", shim), {
    // An empty config dir, so the shim runs THIS tree's guard rather than the installed plugin's.
    env: {
      ...accountSandboxChildEnv(),
      CLAUDE_CONFIG_DIR: tempDir(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
      SLOPWEAVER_HOOK_BUDGET_SECONDS: String(BUDGET_SECONDS),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.write(JSON.stringify(payload));
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const status = await new Promise<number | null>((settle) => {
    child.on("close", (code) => {
      settle(code);
    });
  });
  child.stdin.destroy();
  return { elapsedMs: Date.now() - startedMs, status, stderr };
}

/**
 * Drive `bounded-run.sh` over a hook that spawns a grandchild which IGNORES `TERM` and holds the hook's
 * stdout, which is the exact shape the tree kill exists for.
 *
 * @param budgetSeconds the bound the run is given
 * @returns the grandchild's pid, whether it was still alive once the shim returned, and how long that took
 */
async function runStubbornGrandchild({
  budgetSeconds,
}: {
  budgetSeconds: number;
}): Promise<{ grandchildPid: number; aliveAfter: boolean; elapsedMs: number }> {
  const dir = tempDir();
  const marker = join(dir, "grandchild.pid");
  const write = ({ name, body }: { name: string; body: string }): string => {
    const path = join(dir, name);
    writeFileSync(path, body, "utf8");
    chmodSync(path, 0o755);
    return path;
  };
  write({
    body: `#!/usr/bin/env bash\ntrap '' TERM\necho $$ > "${marker}"\nsleep 120\n`,
    name: "grandchild.sh",
  });
  const hook = write({ body: `#!/usr/bin/env bash\n"${join(dir, "grandchild.sh")}" &\nsleep 120\n`, name: "hook.sh" });
  const driver = write({
    body:
      `#!/usr/bin/env bash\nset -uo pipefail\n` +
      `source "${join(repoRoot, "hooks/lib/bounded-run.sh")}"\n` +
      `run_hook_bounded "$(hook_budget_seconds)" 0 stubborn-fixture "${hook}"\n`,
    name: "drive.sh",
  });

  const startedMs = Date.now();
  const child = spawn(driver, {
    env: {
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOOK_BUDGET_SECONDS: String(budgetSeconds),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  await once(child, "close");
  const elapsedMs = Date.now() - startedMs;
  const grandchildPid = Number(readFileSync(marker, "utf8").trim());
  let aliveAfter = true;
  try {
    process.kill(grandchildPid, 0);
  } catch {
    aliveAfter = false;
  }
  // Never leave one behind if the assertion is about to fail.
  try {
    process.kill(grandchildPid, "SIGKILL");
  } catch {
    // already gone, which is the passing case
  }
  return { aliveAfter, elapsedMs, grandchildPid };
}

/**
 * A TERM→KILL gap no load can cross, so a release that waited out the escalation is told apart from one
 * that did not by tens of seconds rather than by the one second a saturated lane's process boot and
 * teardown can spend on their own.
 */
const EARLY_RELEASE_ESCALATION_SECONDS = 30;

/**
 * Drive one of `bounded-run.sh`'s two bounds over a hook whose whole tree dies on its `TERM` — the common
 * shape, `bash` and `node` both — so the release is timed against the escalation it should no longer wait
 * out. The library assigns each escalation while it is sourced, so the driver reassigns it to
 * {@link EARLY_RELEASE_ESCALATION_SECONDS} AFTER the `source`, in the shell that then runs the shipped function.
 *
 * @param bound which shipped function runs the hook: the inner `run_hook_bounded` or the envelope's own
 * @param limitSeconds the budget the inner bound is given, or the timeout the envelope is declared
 * @returns the driver's exit status, what it said on stderr, and how long the call was held
 */
async function runObedientHook({
  bound,
  limitSeconds,
}: {
  bound: "bounded" | "enveloped";
  limitSeconds: number;
}): Promise<{ status: number | null; stderr: string; elapsedMs: number }> {
  const call = {
    bounded: { run: "run_hook_bounded", variable: "HOOK_BOUNDED_ESCALATION_SECONDS" },
    enveloped: { run: "run_hook_enveloped", variable: "HOOK_ENVELOPE_ESCALATION_SECONDS" },
  }[bound];
  const driver = join(tempDir(), "drive.sh");
  writeFileSync(
    driver,
    `#!/usr/bin/env bash\nset -uo pipefail\nsource "${join(repoRoot, "hooks/lib/bounded-run.sh")}"\n` +
      `${call.variable}=${String(EARLY_RELEASE_ESCALATION_SECONDS)}\n${call.run} ${String(limitSeconds)} 0 obedient-fixture sleep 120\n`,
    "utf8",
  );
  chmodSync(driver, 0o755);

  const startedMs = Date.now();
  const child = spawn(driver, {
    env: { HOME: process.env["HOME"]!, PATH: process.env["PATH"]! },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  await once(child, "close");
  return { elapsedMs: Date.now() - startedMs, status: child.exitCode, stderr };
}

describe("the budget the tool-call shims hold themselves to", { timeout: CASE_TIMEOUT_MS }, () => {
  it("fails CLOSED on a Bash call whose payload never closed, because no door gate decided it", async () => {
    // A spent budget is transient, so refusing costs one retry; releasing ran the call past the one-door,
    // poll and script gates in silence, which is what 101 calls did.
    const run = await runWedged({
      payload: { session_id: "budget-wiring-session", tool_input: { command: "echo hi" }, tool_name: "Bash" },
      shim: "pretooluse.sh",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(`pretooluse (payload read): killed after ${String(BUDGET_SECONDS)}s`);
    expect(run.stderr).toContain("no gate reached a verdict on this Bash call");
    expect(run.elapsedMs).toBeGreaterThanOrEqual(BUDGET_SECONDS * 1000);
    expect(run.elapsedMs).toBeLessThan(RELEASE_CEILING_MS);
  });

  it("fails CLOSED on an Edit call whose payload never closed, even from a session holding its marker", async () => {
    // The `profile-held` check this budget never reached covers Edit, and nothing cheap enough to run here can tell a
    // current delivery from one a compaction outdated: one retry, judged by a node gate.
    const run = await runWedged({
      payload: { session_id: WEDGED_SESSION, tool_input: { file_path: "/tmp/x" }, tool_name: "Edit" },
      shim: "pretooluse.sh",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(`pretooluse (payload read): killed after ${String(BUDGET_SECONDS)}s`);
    expect(run.stderr).toContain("no gate reached a verdict on this Edit call");
    expect(run.elapsedMs).toBeGreaterThanOrEqual(BUDGET_SECONDS * 1000);
    expect(run.elapsedMs).toBeLessThan(RELEASE_CEILING_MS);
  });

  // Every hold delivers: a load that spends every retry's budget would otherwise refuse a context lacking the owner's profile
  // forever without handing it over. The read was cut short but the bytes arrived whole.
  it("delivers the owner's profile with a spent budget's refusal to a context lacking it, and marks it", async () => {
    const home = tempDir();
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "context.txt"), "# Owner profile\n\nspent-budget fixture line\n");
    const run = await runWedged({
      home,
      payload: { session_id: WEDGED_SESSION, tool_input: { file_path: "/tmp/x" }, tool_name: "Edit" },
      shim: "pretooluse.sh",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("spent-budget fixture line");
    expect(readFileSync(join(home, "profile", "delivered", WEDGED_SESSION), "utf8")).toBe(
      "profile-delivered v1\n0\nsettled\n\n",
    );
  });

  // With no copy on disk the reload is the only way one gets written, so a hold that spends every budget must not hold
  // it too. Exact: the same reload with a command chained to it is refused like any other.
  it("lets exactly the by-hand reload through a spent budget with no copy on disk, and nothing chained to it", async () => {
    const home = tempDir();
    // The owner's profile was written here, so this is an installed home missing its copy, never a first boot — which on a
    // runner whose default homes are empty an unmarked temp home would read as.
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "owner-written"), "");
    const reload = await runWedged({
      home,
      payload: { session_id: WEDGED_SESSION, tool_input: { command: "slopweaver profile context" }, tool_name: "Bash" },
      shim: "pretooluse.sh",
    });
    const chained = await runWedged({
      home,
      payload: {
        session_id: WEDGED_SESSION,
        tool_input: { command: "slopweaver profile context; rm -rf /tmp/x" },
        tool_name: "Bash",
      },
      shim: "pretooluse.sh",
    });
    expect([reload.status, chained.status]).toEqual([0, 2]);
    expect(chained.stderr).toContain("no copy of it is on disk");
  });

  it("still fails CLOSED on a browser call, because a killed read keeps the bytes that arrived", async () => {
    // The whole `give_up_code` claim in one case: the read never reached end-of-file, so there is no verdict
    // — and `cat` had already copied enough of the payload for the shim to see it was a browser call.
    const run = await runWedged({
      payload: {
        session_id: "budget-wiring-session",
        tool_input: { tabId: 1 },
        tool_name: "mcp__claude-in-chrome__navigate_to",
      },
      shim: "pretooluse.sh",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("refusing the browser call rather than skipping the gate");
    expect(run.stderr).toContain(`stdin never closed inside the ${String(BUDGET_SECONDS)}s budget`);
    expect(run.elapsedMs).toBeGreaterThanOrEqual(BUDGET_SECONDS * 1000);
    expect(run.elapsedMs).toBeLessThan(RELEASE_CEILING_MS);
  });

  // The browser's refusal is a hold like any other, so it delivers too.
  it("delivers the owner's profile with a browser call's spent-budget refusal, and marks it", async () => {
    const home = tempDir();
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "context.txt"), "# Owner profile\n\nbrowser fixture line\n");
    const run = await runWedged({
      home,
      payload: {
        session_id: WEDGED_SESSION,
        tool_input: { tabId: 1 },
        tool_name: "mcp__claude-in-chrome__navigate_to",
      },
      shim: "pretooluse.sh",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("refusing the browser call rather than skipping the gate");
    expect(run.stderr).toContain("browser fixture line");
    expect(readFileSync(join(home, "profile", "delivered", WEDGED_SESSION), "utf8")).toBe(
      "profile-delivered v1\n0\nsettled\n\n",
    );
  });

  it("covers the ten compatibility shims too, because each one execs the dispatcher", async () => {
    const run = await runWedged({
      payload: { session_id: "budget-wiring-session", tool_input: { command: "echo hi" }, tool_name: "Bash" },
      shim: "pretooluse-poll-gate.sh",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(`pretooluse (payload read): killed after ${String(BUDGET_SECONDS)}s`);
    expect(run.elapsedMs).toBeGreaterThanOrEqual(BUDGET_SECONDS * 1000);
    expect(run.elapsedMs).toBeLessThan(RELEASE_CEILING_MS);
  });

  it("kills a grandchild that ignores TERM, because it is the one holding the hook's stdout", async () => {
    // Without the KILL escalation this pid is ALIVE: `wait` returns the instant the direct child dies, and
    // a watchdog torn down at that moment never reaches the descendant. Measured.
    const run = await runStubbornGrandchild({ budgetSeconds: BUDGET_SECONDS });
    expect(run.aliveAfter).toBe(false);
    expect(run.grandchildPid).toBeGreaterThan(0);
    // The budget, plus the escalation's own two seconds, and still far under `hooks.json`'s declared 20.
    expect(run.elapsedMs).toBeGreaterThanOrEqual((BUDGET_SECONDS + 2) * 1000);
    expect(run.elapsedMs).toBeLessThan(RELEASE_CEILING_MS);
  });

  // The other half of the case above: the escalation is for a pid that IGNORED its TERM, so a tree that died
  // on it is released inside the escalation rather than at its end (the ladder in
  // `hooks/lib/bounded-run.sh` has why). Together the two prove the early release is conditional.
  it("releases a hook whose tree dies on TERM without waiting out the escalation", async () => {
    const run = await runObedientHook({ bound: "bounded", limitSeconds: BUDGET_SECONDS });

    expect(run.status).toBe(0);
    expect(run.stderr).toBe(
      `obedient-fixture: killed after ${String(BUDGET_SECONDS)}s without a verdict, so the tool call is no longer held — this hook reached no decision\n`,
    );
    expect(run.elapsedMs).toBeGreaterThanOrEqual(BUDGET_SECONDS * 1000);
    expect(run.elapsedMs).toBeLessThan((BUDGET_SECONDS + EARLY_RELEASE_ESCALATION_SECONDS) * 1000);
  });
});

/** A declared timeout short enough to spend in a test, and long enough for the ladder to fit inside it. */
const ENVELOPE_DECLARED_SECONDS = 6;

/**
 * The second the envelope sends TERM: the declared timeout less its two-second runway and one-second
 * escalation, `hook_envelope_term_at` in `hooks/lib/bounded-run.sh`.
 */
const ENVELOPE_TERM_SECONDS = ENVELOPE_DECLARED_SECONDS - 3;

/** The second the envelope's KILL lands, for a pid that outlived its TERM. */
const ENVELOPE_KILL_SECONDS = ENVELOPE_TERM_SECONDS + 1;

/**
 * Run the shipped entry point over a target written for this case.
 *
 * @param body the target script's contents, written into a throwaway directory and made executable
 * @param declared the timeout passed to the entry point, exactly as a `hooks.json` entry passes its own
 * @param policy the `SLOPWEAVER_HOOK_GIVE_UP` value set in the entry point's environment, exactly as the
 *   door-gated `PreToolUse` row prefixes it; absent is the form every other entry (and every older seat) uses
 * @param target an existing path to run instead of the written target, for the missing-target case
 * @returns the exit status, what the entry point said on stderr, how long the call was held, and the pid
 *   the target recorded for its grandchild when it started one
 */
async function runEnveloped({
  body,
  declared = ENVELOPE_DECLARED_SECONDS,
  home,
  payload = "",
  policy,
  target: targetOverride,
}: {
  body: string;
  declared?: number;
  home?: string;
  payload?: string;
  policy?: string;
  target?: string;
}): Promise<{ status: number | null; stderr: string; elapsedMs: number; grandchildPid: number | undefined }> {
  const dir = tempDir();
  const marker = join(dir, "grandchild.pid");
  const write = ({ name, text }: { name: string; text: string }): string => {
    const path = join(dir, name);
    writeFileSync(path, text, "utf8");
    chmodSync(path, 0o755);
    return path;
  };
  write({
    name: "grandchild.sh",
    text: `#!/usr/bin/env bash\ntrap '' TERM\necho $$ > "${marker}"\nsleep 120\n`,
  });
  const written = write({ name: "target.sh", text: body.replaceAll("__DIR__", dir) });
  let target = written;
  if (targetOverride !== undefined) {
    target = targetOverride;
  }

  const policyEnv = policy === undefined ? {} : { SLOPWEAVER_HOOK_GIVE_UP: policy };
  const homeEnv = home === undefined ? {} : { SLOPWEAVER_HOME: home };
  const startedMs = Date.now();
  const child = spawn(join(repoRoot, "scripts", "hook.sh"), [String(declared), "envelope-fixture", target], {
    env: { HOME: process.env["HOME"]!, PATH: process.env["PATH"]!, ...policyEnv, ...homeEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  // A case the wrapper refuses before reading stdin (a misspelt policy) closes the pipe first, so the write can
  // meet EPIPE; that is the case passing, and only any other stdin error is a fault (CI run 39080546558).
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") {
      throw error;
    }
  });
  child.stdin.end(payload);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const status = await new Promise<number | null>((settle) => {
    child.on("close", (code) => {
      settle(code);
    });
  });
  const elapsedMs = Date.now() - startedMs;

  let grandchildPid: number | undefined;
  try {
    grandchildPid = Number(readFileSync(marker, "utf8").trim());
  } catch {
    // the case did not start one, which is the shape of the first test below
  }
  if (grandchildPid !== undefined) {
    try {
      process.kill(grandchildPid, "SIGKILL");
    } catch {
      // already gone, which is the passing case
    }
  }
  return { elapsedMs, grandchildPid, status, stderr };
}

describe("the envelope every registered hook runs through", { timeout: CASE_TIMEOUT_MS }, () => {
  it("releases a target that carries NO bound of its own, which is the SessionStart class", async () => {
    const run = await runEnveloped({ body: "#!/usr/bin/env bash\nsleep 120\n" });

    // TERM at declared - 3, so the line names that second and not the declared timeout.
    expect(run.stderr).toContain(`envelope-fixture: killed after ${String(ENVELOPE_TERM_SECONDS)}s`);
    expect(run.stderr).toContain(`hooks.json declares ${String(ENVELOPE_DECLARED_SECONDS)}s for this entry`);
    expect(run.status).toBe(0);
    expect(run.elapsedMs).toBeGreaterThanOrEqual(ENVELOPE_TERM_SECONDS * 1000);
    // Under the declared timeout is the whole property: past it the harness ends the call instead, and
    // writes a `hook_cancelled` record with no stderr — the silence this exists to end.
    expect(run.elapsedMs).toBeLessThan(ENVELOPE_DECLARED_SECONDS * 1000);
  });

  // The race the harness kept winning: the old watchdog slept the whole escalation second after a TERM that
  // had already ended every pid, so the release landed a second later than it had to and lost about three
  // calls in four to the harness (`hooks/lib/bounded-run.sh`'s ladder has the census). A target
  // that dies on its TERM is released before the KILL, never at it. The envelope runs directly with its
  // escalation widened, because against the shipped one second a loaded lane's boot and teardown alone, counted
  // from the spawn, crossed the KILL with no regression at all; the cases around this one still run `hook.sh`.
  it("releases the moment a target dies on its TERM, rather than waiting out the escalation", async () => {
    // The same TERM second as the shipped ladder: declared, less the runway and the widened escalation.
    const declared = ENVELOPE_TERM_SECONDS + EARLY_RELEASE_ESCALATION_SECONDS + 2;
    const run = await runObedientHook({ bound: "enveloped", limitSeconds: declared });

    expect(run.status).toBe(0);
    // Exact, so a bash "Terminated" report of the watchdog's own reaped timer reddens it: any hook stderr
    // reaches a seat as a hook-error banner.
    expect(run.stderr).toBe(
      `obedient-fixture: killed after ${String(ENVELOPE_TERM_SECONDS)}s without finishing, so the tool call is ` +
        `no longer held — this hook reached no decision, and hooks.json declares ${String(declared)}s for this entry\n`,
    );
    expect(run.elapsedMs).toBeGreaterThanOrEqual(ENVELOPE_TERM_SECONDS * 1000);
    expect(run.elapsedMs).toBeLessThan((ENVELOPE_TERM_SECONDS + EARLY_RELEASE_ESCALATION_SECONDS) * 1000);
  });

  it("escalates to KILL, so a descendant that ignores TERM stops holding the hook's stdout", async () => {
    const run = await runEnveloped({
      body: '#!/usr/bin/env bash\n"__DIR__/grandchild.sh" &\nsleep 120\n',
    });
    let aliveAfter = true;
    try {
      process.kill(run.grandchildPid!, 0);
    } catch {
      aliveAfter = false;
    }

    expect(run.grandchildPid!).toBeGreaterThan(0);
    expect(aliveAfter).toBe(false);
    expect(run.stderr).toContain("killed after");
    // A pid that ignored its TERM is what the KILL second is for, so this one release does wait for it.
    expect(run.elapsedMs).toBeGreaterThanOrEqual(ENVELOPE_KILL_SECONDS * 1000);
    expect(run.elapsedMs).toBeLessThan(ENVELOPE_DECLARED_SECONDS * 1000);
  });

  it("does not kill a target that finishes inside the ladder, and hands up its own status", async () => {
    const run = await runEnveloped({ body: "#!/usr/bin/env bash\necho ok\nexit 3\n" });

    expect(run.status).toBe(3);
    expect(run.stderr).not.toContain("killed after");
    expect(run.elapsedMs).toBeLessThan(ENVELOPE_TERM_SECONDS * 1000);
  });

  it("fails OPEN and says so when the target is not there, rather than letting a bare 127 reach the harness", async () => {
    const child = spawn(join(repoRoot, "scripts", "hook.sh"), ["10", "envelope-fixture", "/nope/not-a-hook"], {
      env: { HOME: process.env["HOME"]!, PATH: process.env["PATH"]! },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const status = await new Promise<number | null>((settle) => {
      child.on("close", (code) => {
        settle(code);
      });
    });

    expect(status).toBe(0);
    expect(stderr).toContain("has no executable at /nope/not-a-hook");
    expect(stderr).toContain("ran no check at all");
  });
});

describe("the envelope's ending, chosen by the registration", { timeout: CASE_TIMEOUT_MS }, () => {
  it("REFUSES a wedged call on the door-gated row, so a starved Bash call is not run past its gates", async () => {
    const run = await runEnveloped({ body: "#!/usr/bin/env bash\nsleep 120\n", policy: "2" });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain(`envelope-fixture: killed after ${String(ENVELOPE_TERM_SECONDS)}s`);
    expect(run.stderr).toContain("so the tool call is refused rather than run past its gates");
    expect(run.elapsedMs).toBeLessThan(ENVELOPE_DECLARED_SECONDS * 1000);
  });

  // A load deep enough to end every dispatcher would otherwise never hand a context its profile. The kill read no payload, so it delivers unmarked; a target's own refusal is not a kill and carries none.
  it("delivers the owner's profile with its own kill's refusal, and never with a target's own", async () => {
    const home = tempDir();
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "context.txt"), "# Owner profile\n\nenvelope fixture line\n");
    const killed = await runEnveloped({ body: "#!/usr/bin/env bash\nsleep 120\n", home, policy: "2" });
    const refusedByTarget = await runEnveloped({ body: "#!/usr/bin/env bash\nexit 2\n", home, policy: "2" });

    expect([killed.status, refusedByTarget.status]).toEqual([2, 2]);
    expect(killed.stderr).toContain("envelope fixture line");
    expect(killed.elapsedMs).toBeLessThan(ENVELOPE_DECLARED_SECONDS * 1000);
    expect(refusedByTarget.stderr).not.toContain("envelope fixture line");
    // It read no payload, so it names no session: no ledger row and no marker, and the monitor reads `not yet held`.
    expect(readdirSync(join(home, "profile"))).toEqual(["context.txt"]);
  });

  // A harness timeout RUNS the call, so a delivery after the kill must not outlive the declared timeout. A
  // 128 MiB copy once held the refusal 9.3s against a declared 6. Every fixture line is 100
  // bytes with its newline, so the 12288-byte cap fits exactly 122 of them.
  it("cuts a copy too large to deliver in time short at its byte cap, and still refuses inside the timeout", async () => {
    const home = tempDir();
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "context.txt"), `${"x".repeat(99)}\n`.repeat(100_000));
    const killed = await runEnveloped({ body: "#!/usr/bin/env bash\nsleep 120\n", home, policy: "2" });

    expect(killed.status).toBe(2);
    expect(killed.stderr.split("\n").filter((line) => line === "x".repeat(99)).length).toBe(122);
    expect(killed.stderr).toContain("# CUT SHORT — the rest did not fit before the declared timeout");
    expect(killed.elapsedMs).toBeLessThan(ENVELOPE_DECLARED_SECONDS * 1000);
  });

  // The READ is the bound, not only the write: a whole-line read swallowed a newline-free copy entire before any check
  // ran, 9.13s against a declared 6. So one 32 MiB line yields its first 12288 bytes, which a
  // whole-line read could never print at all.
  it("reads no more of a newline-free copy than its byte cap, and still refuses inside the timeout", async () => {
    const home = tempDir();
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "context.txt"), "x".repeat(32 * 1024 * 1024));
    const killed = await runEnveloped({ body: "#!/usr/bin/env bash\nsleep 120\n", home, policy: "2" });

    expect(killed.status).toBe(2);
    expect(killed.stderr.split("\n").filter((line) => line === "x".repeat(12_288)).length).toBe(1);
    expect(killed.stderr).toContain("# CUT SHORT — the rest did not fit before the declared timeout");
    expect(killed.elapsedMs).toBeLessThan(ENVELOPE_DECLARED_SECONDS * 1000);
  });

  it("still kills a descendant that ignores TERM before it refuses", async () => {
    const run = await runEnveloped({
      body: '#!/usr/bin/env bash\n"__DIR__/grandchild.sh" &\nsleep 120\n',
      policy: "2",
    });
    let aliveAfter = true;
    try {
      process.kill(run.grandchildPid!, 0);
    } catch {
      aliveAfter = false;
    }

    expect(run.grandchildPid!).toBeGreaterThan(0);
    expect(aliveAfter).toBe(false);
    expect(run.status).toBe(2);
    expect(run.elapsedMs).toBeLessThan(ENVELOPE_DECLARED_SECONDS * 1000);
  });

  it("hands up a finished target's own status on the door-gated row, never the give-up code", async () => {
    const run = await runEnveloped({ body: "#!/usr/bin/env bash\nexit 0\n", policy: "2" });

    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain("killed after");
  });

  it("releases on an explicit 0, a releasing row's spelling", async () => {
    const run = await runEnveloped({ body: "#!/usr/bin/env bash\nsleep 120\n", policy: "0" });

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("so the tool call is no longer held");
  });

  it("refuses to guess a misspelt policy, and releases without running the target", async () => {
    // The target exits 2, so a status of 0 is only possible if it never ran.
    const run = await runEnveloped({ body: "#!/usr/bin/env bash\nexit 2\n", policy: "closed" });

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("SLOPWEAVER_HOOK_GIVE_UP=closed is not a policy this entry point knows");
    expect(run.elapsedMs).toBeLessThan(ENVELOPE_TERM_SECONDS * 1000);
  });

  // The policy is the ROW's, so a target — and anything it spawns — never inherits it.
  it("unsets the policy before the target runs", async () => {
    const run = await runEnveloped({
      body: '#!/usr/bin/env bash\necho "seen=${SLOPWEAVER_HOOK_GIVE_UP-unset}" >&2\nexit 0\n',
      policy: "2",
    });

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("seen=unset");
  });

  // A missing target is PERSISTENT, the same split `pretooluse.sh`'s give_up_code makes: refusing it would block
  // every Bash call on the seat until a session that cannot run a command repaired the mirror — but only for a
  // context that holds the owner's profile, which the `profile-held` check the missing target never ran would have demanded.
  it("releases a missing target on a refusing row for a context holding its marker, and says no check ran", async () => {
    const home = tempDir();
    seedProfileDelivered({ home, sessionId: "s-envelope" });
    const run = await runEnveloped({
      body: "",
      home,
      payload: '{"session_id":"s-envelope","tool_name":"Edit"}',
      policy: "2",
      target: "/nope/not-a-hook",
    });

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("has no executable at /nope/not-a-hook — this hook ran no check at all");
    expect(run.stderr).not.toContain("holds no current delivery");
  });

  it("refuses a missing target on a refusing row for a context holding no marker", async () => {
    const home = tempDir();
    seedProfileDelivered({ home, sessionId: "s-other" });
    const run = await runEnveloped({
      body: "",
      home,
      payload: '{"session_id":"s-envelope","tool_name":"Edit"}',
      policy: "2",
      target: "/nope/not-a-hook",
    });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("this context holds no current delivery of the owner's profile, so the call is held");
    expect(run.stderr).toContain("no copy of it is on disk");
  });

  it("releases a missing target on a releasing row without reading the payload", async () => {
    const home = tempDir();
    const run = await runEnveloped({
      body: "",
      home,
      payload: '{"session_id":"s-envelope","tool_name":"Edit"}',
      policy: "0",
      target: "/nope/not-a-hook",
    });

    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain("holds no current delivery");
  });
});
