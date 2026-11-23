/**
 * A built console never swaps in over a live voice call on a clock — `scripts/docs-site.sh`'s call hold, run for
 * real through its `--hold-for-calls` seam.
 *
 * The incident: a refresh round built a new slot while the owner was on a live plan call, held the
 * restart behind the call's lease for its 30-minute cap, and then signalled the server anyway. The console
 * reported "the console server received SIGTERM" and the call was gone. The hold now ends only when the lease
 * does, and this drives the real bash, `jq` and wall clock to prove it: the call's lease is live until one fixed
 * instant twelve seconds out, and the hold must let go only at or after it. The test does nothing but wait while
 * the hold runs, so the moment the child exits is read without a gap a synchronous check could open. Any clock
 * that let go while the lease was live — the variable that used to set the cap is set to one second here — exits
 * before that instant.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = join(repoRoot, "scripts", "docs-site.sh");
const SHA = "ad0d98310c2e8a3f6b1d4e5f7a9c0b1d2e3f4a5b";
/** How long the call's lease stays live. Past the hold's ten-second poll, so a clock would have let go first. */
const LIVE_FOR_MS = 12_000;

let home: string | undefined;
let child: ChildProcess | undefined;

afterEach(() => {
  child?.kill();
  child = undefined;
  if (home !== undefined) {
    rmSync(home, { force: true, recursive: true });
    home = undefined;
  }
});

/**
 * The hold directory the script derives for this checkout: its run record's path, `.json` swapped for `.hold`.
 *
 * @returns `<cache>/docs-site/<checkout basename>-<first 8 of sha1(checkout path)>.hold`, the cache root being
 *   `<home>/cache`, which {@link envFor} names
 */
function holdDirOf({ home: at }: { home: string }): string {
  const tag = createHash("sha1").update(repoRoot).digest("hex").slice(0, 8);
  return join(at, "cache", "docs-site", `${basename(repoRoot)}-${tag}.hold`);
}

/** The script's environment: this test's own home, and a cache root inside it so the test removes both. */
function envFor({ home: at }: { home: string }): NodeJS.ProcessEnv {
  return { ...process.env, SLOPWEAVER_CACHE_HOME: join(at, "cache"), SLOPWEAVER_HOME: at };
}

/**
 * Wait a fixed time.
 *
 * @returns once `ms` milliseconds have passed
 */
async function delay({ ms }: { ms: number }): Promise<void> {
  await new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * Wait for a file to appear, up to five seconds.
 *
 * @returns the file's text, or throws when it never appeared
 */
async function waitForFile({ path }: { path: string }): Promise<string> {
  for (let tries = 0; tries < 50; tries += 1) {
    if (existsSync(path)) {
      return readFileSync(path, "utf8");
    }
    await delay({ ms: 100 });
  }
  throw new Error(`${path} never appeared`);
}

describe("docs-site.sh --hold-for-calls", () => {
  it("holds the swap for as long as the call's lease is live, and lets go only once it is not", async () => {
    home = mkdtempSync(join(tmpdir(), "slop-call-hold-"));
    const holdDir = holdDirOf({ home });
    mkdirSync(join(holdDir, "calls"), { recursive: true });
    const callId = randomUUID();
    const liveUntilMs = Date.now() + LIVE_FOR_MS;
    writeFileSync(join(holdDir, "calls", `${callId}.json`), JSON.stringify({ callId, untilMs: liveUntilMs }));

    let output = "";
    const running = spawn("bash", [SCRIPT, "--hold-for-calls", SHA], {
      cwd: repoRoot,
      env: { ...envFor({ home }), DOCS_SITE_CALL_HOLD_MAX_S: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = running;
    running.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    running.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exited = new Promise<{ code: number | null; atMs: number }>((done) => {
      running.on("close", (code) => {
        done({ atMs: Date.now(), code });
      });
    });

    const waiting = JSON.parse(await waitForFile({ path: join(holdDir, "waiting.json") })) as Record<string, unknown>;
    expect(Object.keys(waiting).toSorted()).toEqual(["pid", "sha", "sinceIso"]);
    expect(waiting["pid"]).toBe(running.pid);
    expect(waiting["sha"]).toBe(SHA);
    expect(String(waiting["sinceIso"])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const { code, atMs } = await exited;
    expect(code).toBe(0);
    expect(atMs).toBeGreaterThanOrEqual(liveUntilMs);
    expect(existsSync(join(holdDir, "waiting.json"))).toBe(false);
    expect(output).toContain("ad0d98310 is built; a voice call is live, so the swap waits for it\n");
    expect(output).toMatch(/the call ended after \d+s — swapping to ad0d98310\n/);
    expect(output).not.toContain("cap");
  }, 30_000);

  it("holds for a live lease still under the home's old directory while that stands beside the cache root", async () => {
    home = mkdtempSync(join(tmpdir(), "slop-call-hold-"));
    const holdDir = holdDirOf({ home });
    const legacyCalls = join(home, "docs-site", basename(holdDir), "calls");
    mkdirSync(legacyCalls, { recursive: true });
    mkdirSync(join(holdDir, "calls"), { recursive: true });
    const callId = randomUUID();
    const liveUntilMs = Date.now() + 3000;
    // The merge keeps the cache root's NEWER copy, which has lapsed, so the live lease stays at the old path.
    writeFileSync(join(legacyCalls, `${callId}.json`), JSON.stringify({ callId, untilMs: liveUntilMs }));
    const old = new Date("2026-01-01T00:00:00Z");
    utimesSync(join(legacyCalls, `${callId}.json`), old, old);
    writeFileSync(join(holdDir, "calls", `${callId}.json`), JSON.stringify({ callId, untilMs: 1 }));

    const running = spawn("bash", [SCRIPT, "--hold-for-calls", SHA], {
      cwd: repoRoot,
      env: envFor({ home }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = running;
    let output = "";
    running.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exited = await new Promise<{ code: number | null; atMs: number }>((done) => {
      running.on("close", (code) => {
        done({ atMs: Date.now(), code });
      });
    });
    expect(exited.code).toBe(0);
    expect(output).toContain("ad0d98310 is built; a voice call is live, so the swap waits for it\n");
    expect(exited.atMs).toBeGreaterThanOrEqual(liveUntilMs);
  }, 30_000);

  it("says nothing and holds nothing when no call is live", async () => {
    home = mkdtempSync(join(tmpdir(), "slop-call-hold-"));
    const running = spawn("bash", [SCRIPT, "--hold-for-calls", SHA], {
      cwd: repoRoot,
      env: envFor({ home }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = running;
    let output = "";
    running.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const code = await new Promise<number | null>((done) => {
      running.on("close", done);
    });
    expect(code).toBe(0);
    expect(output).toBe("");
    expect(existsSync(join(holdDirOf({ home }), "waiting.json"))).toBe(false);
  });
});
