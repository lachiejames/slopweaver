/**
 * The real `hooks/profile-context.sh`, end to end: a compaction's `SessionStart` (the event Claude Code re-runs with
 * `source: "compact"`, and the only one whose output reaches the session after a compaction) puts the owner's profile into
 * the hook's `additionalContext` and marks the session delivered; a run the `scripts/hook.sh` envelope kills before
 * node prints leaves the session UNmarked, so the PreToolUse `profile-held` check holds it and reloads.
 *
 * The hook delivers the profile on compaction and under load, and a session
 * whose hook delivered nothing must not carry on. MEASURED: seven sessions' profile hook "killed after
 * 7s" while node booted under load.
 *
 * The delivering run has no database: `SLOPWEAVER_STORE_URL` names a closed port, so the live read fails at once and
 * the hook serves the last-known-good cache bound to that URL — the same path a loaded machine's 2s-bounded read takes.
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { storeFingerprint, writeContextCache } from "../../../context/cache.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { seedProfileDelivered } from "../../profileDeliveredFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** A store URL nothing listens on, so the live read refuses at once and the cache answers. */
const CLOSED_STORE_URL = "postgresql://postgres:x@127.0.0.1:1/postgres";

/** The `scripts/hook.sh` declared timeout for the killed run: short enough to spend, long enough for its ladder. */
const KILL_DECLARED_SECONDS = 6;

let home = "";
let userHome = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pch-home-"));
  userHome = mkdtempSync(join(tmpdir(), "pch-user-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  rmSync(userHome, { force: true, recursive: true });
});

/**
 * Run a command with a hook payload on stdin, the environment pinned to the temp homes.
 *
 * @returns the exit status and stdout
 */
async function run({
  argv,
  payload,
  pluginRoot,
}: {
  argv: readonly string[];
  payload: unknown;
  pluginRoot: string;
}): Promise<{ status: number | null; stdout: string }> {
  const [command, ...args] = argv;
  const child = spawn(command!, args, {
    env: {
      ...accountSandboxChildEnv(),
      HOME: userHome,
      PATH: process.env["PATH"]!,
      PLUGIN_ROOT: pluginRoot,
      SLOPWEAVER_HOME: home,
      SLOPWEAVER_STORE_URL: CLOSED_STORE_URL,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(payload));
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.resume();
  const status = await new Promise<number | null>((done) => {
    child.on("close", (code) => {
      done(code);
    });
  });
  return { status, stdout };
}

/** The marker file `hooks/lib/profile-delivered.sh` and `src/context/profileDelivery.ts` both name. */
function markerOf({ sessionId }: { sessionId: string }): string {
  return join(home, "profile", "delivered", sessionId);
}

describe("hooks/profile-context.sh", () => {
  it("delivers the owner's profile into a compaction's SessionStart and marks the session, replacing the stale marker", async () => {
    unwrap(
      writeContextCache({
        cache: {
          capturedAtIso: "2026-10-14T02:00:00.000Z",
          lines: ["## About the owner (revision 2)", "- never make the owner do arithmetic"],
          schemaVersion: 1,
          storeFingerprint: storeFingerprint({ url: CLOSED_STORE_URL }),
          voiceRegister: [],
        },
        path: stateHomePaths({ home }).profileContextJson,
      }),
    );
    seedProfileDelivered({ home, sessionId: "s-compact" });
    // A marker from BEFORE the compaction, dated so a rewrite is visible: the hook must clear it and write a new one.
    const before = readFileSync(markerOf({ sessionId: "s-compact" }), "utf8");
    writeFileSync(markerOf({ sessionId: "s-compact" }), "stale");
    const { status, stdout } = await run({
      argv: [join(repoRoot, "hooks", "profile-context.sh")],
      payload: { cwd: "/w", hook_event_name: "SessionStart", session_id: "s-compact", source: "compact" },
      pluginRoot: repoRoot,
    });
    const output = JSON.parse(stdout.trim()) as {
      hookSpecificOutput: { additionalContext: string; hookEventName: string };
    };
    expect(status).toBe(0);
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const lines = output.hookSpecificOutput.additionalContext.split("\n");
    expect([lines[0], lines.slice(2)]).toEqual([
      "[slopweaver] always-loaded context — read at 2026-10-14T02:00:00.000Z",
      ["## About the owner (revision 2)", "- never make the owner do arithmetic"],
    ]);
    // The cache's age reads the real clock, so only its count varies.
    expect(lines[1]).toMatch(
      /^SOURCE IS A CACHE: captured \d+ minute\(s\) ago, because the live read failed: owner profile read failed: connect ECONNREFUSED 127\.0\.0\.1:1$/u,
    );
    // The new marker expects its own compaction's boundary, which lands after this hook (`profileDelivery.ts`).
    expect([before, readFileSync(markerOf({ sessionId: "s-compact" }), "utf8")]).toEqual([
      "profile-delivered v1\n0\nsettled\n\n",
      "profile-delivered v1\n0\nawaits-boundary\n\n",
    ]);
    const row = JSON.parse(readFileSync(stateHomePaths({ home }).profileLoadsJsonl, "utf8").trim()) as Record<
      string,
      string
    >;
    expect([row["event"], row["origin"], row["sessionId"]]).toEqual(["SessionStart:compact", "cache", "s-compact"]);
  }, 60_000);

  // Codex's own SessionStart hook prints the owner's profile too, so it marks the thread it printed into: without the mark,
  // the thread's first guarded call is held for a profile it already holds.
  it("marks the thread `codex rules-context` delivered the owner's profile into", async () => {
    unwrap(
      writeContextCache({
        cache: {
          capturedAtIso: "2026-10-14T02:00:00.000Z",
          lines: ["## About the owner (revision 2)"],
          schemaVersion: 1,
          storeFingerprint: storeFingerprint({ url: CLOSED_STORE_URL }),
          voiceRegister: [],
        },
        path: stateHomePaths({ home }).profileContextJson,
      }),
    );
    const { status, stdout } = await run({
      argv: [join(repoRoot, "bin", "slopweaver"), "codex", "rules-context"],
      payload: { cwd: "/w", hook_event_name: "SessionStart", session_id: "s-codex", source: "startup" },
      pluginRoot: repoRoot,
    });
    expect([status, stdout.includes("## About the owner (revision 2)")]).toEqual([0, true]);
    expect(readFileSync(markerOf({ sessionId: "s-codex" }), "utf8")).toBe("profile-delivered v1\n0\nsettled\n\n");
  }, 60_000);

  it("leaves NO marker when the envelope kills the load before it prints — the session is held, not trusted", async () => {
    const slowRoot = mkdtempSync(join(tmpdir(), "pch-slow-"));
    mkdirSync(join(slowRoot, "bin"));
    // A launcher that boots as slowly as node did under load: it never prints before the kill.
    writeFileSync(join(slowRoot, "bin", "slopweaver"), "#!/usr/bin/env bash\nsleep 60\n");
    chmodSync(join(slowRoot, "bin", "slopweaver"), 0o755);
    seedProfileDelivered({ home, sessionId: "s-killed" });
    try {
      const { status, stdout } = await run({
        argv: [
          join(repoRoot, "scripts", "hook.sh"),
          String(KILL_DECLARED_SECONDS),
          "profile-context",
          join(repoRoot, "hooks", "profile-context.sh"),
        ],
        payload: { hook_event_name: "SessionStart", session_id: "s-killed", source: "compact" },
        pluginRoot: slowRoot,
      });
      expect([status, stdout.includes("additionalContext")]).toEqual([0, false]);
      expect(existsSync(markerOf({ sessionId: "s-killed" }))).toBe(false);
    } finally {
      rmSync(slowRoot, { force: true, recursive: true });
    }
  }, 60_000);
});
