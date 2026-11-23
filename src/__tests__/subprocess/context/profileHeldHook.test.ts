/**
 * The `profile-held` hold through the SHIPPED `scripts/pretooluse.sh`, on the two seams no unit test can see.
 *
 * 1. **The marker follows the printed refusal, not the in-memory one.** The dispatcher's
 *    sinks only collect, and a marker written before the entry's write would vouch for a refusal the harness never got
 *    whole — `process.stderr.write` on a pipe queues, and the entry exits. So a refusal far larger than a pipe's buffer
 *    is written to a reader that STOPS reading after the first chunk: while it is stopped the marker must not exist,
 *    and once it drains every byte has arrived and the marker does. A reader that has closed the pipe gets no marker.
 * 2. **One home for the launcher and the shim.** A home named only in `~/.config/slopweaver/env` — what the
 *    `bin/slopweaver` launcher reads — must be the home the shim's gate reads and writes too, or no reload could lift
 *    the hold.
 * 3. **A marker outlived by its context.** A compaction whose `SessionStart` hook never began leaves the old marker in
 *    place; the boundary in the transcript is what holds the next call.
 *
 * No database: `SLOPWEAVER_STORE_URL` names a closed port, and the cache is written bound to that URL, so the hold's
 * cache-only read answers as it does on a machine whose session-start load was killed.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PROFILE_HELD_HEADLINE } from "../../../admit/profileHeld.js";
import { storeFingerprint, writeContextCache } from "../../../context/cache.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { seedProfileDelivered } from "../../profileDeliveredFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SHIM = join(repoRoot, "scripts", "pretooluse.sh");
const HOOK_TIMEOUT_MS = 60_000;

/** A store URL nothing listens on, so only the cache can answer. */
const CLOSED_STORE_URL = "postgresql://postgres:x@127.0.0.1:1/postgres";

/** Lines in the oversized profile: 4,000 of ~100 bytes is ~400 KB, six times a 64 KB pipe buffer. */
const BIG_PROFILE_LINES = 4_000;

/** How long the reader stays stopped once the refusal has started arriving. */
const STALL_MS = 1_500;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after the test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Write the owner's cached profile into a home, bound to the closed store URL. */
function seedCache({ home, lines }: { home: string; lines: readonly string[] }): void {
  unwrap(
    writeContextCache({
      cache: {
        capturedAtIso: "2026-10-14T02:00:00.000Z",
        lines: [...lines],
        schemaVersion: 1,
        storeFingerprint: storeFingerprint({ url: CLOSED_STORE_URL }),
        voiceRegister: [],
      },
      path: stateHomePaths({ home }).profileContextJson,
    }),
  );
}

/** The marker file `profile-held` writes for a main-thread session. */
function markerOf({ home, sessionId }: { home: string; sessionId: string }): string {
  return join(home, "profile", "delivered", sessionId);
}

/** The environment every run gets: this tree's dispatcher (an empty plugin config), and the closed store. */
function baseEnv(): Record<string, string> {
  return {
    CLAUDE_CONFIG_DIR: tempDir({ prefix: "sw-held-config-" }),
    PATH: process.env["PATH"]!,
    SLOPWEAVER_STORE_URL: CLOSED_STORE_URL,
  };
}

/** A tool call the hold applies to and no other check refuses: an `Edit` of a scratch file. */
function editPayload({ sessionId }: { sessionId: string }): Record<string, unknown> {
  return {
    cwd: "/w",
    session_id: sessionId,
    tool_input: { file_path: "/tmp/sw-held-scratch.txt", new_string: "b", old_string: "a" },
    tool_name: "Edit",
  };
}

describe("profile-held through the shipped shim", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("writes the marker only once a refusal larger than the pipe has been read whole", async () => {
    const home = tempDir({ prefix: "sw-held-home-" });
    const last = "- the last line of the owner's profile, which must arrive";
    const lines = [
      "## About the owner",
      ...Array.from({ length: BIG_PROFILE_LINES }, (_, i) => `- fact ${String(i)} ${"x".repeat(90)}`),
      last,
    ];
    seedCache({ home, lines });
    const child = spawn(SHIM, {
      env: { ...baseEnv(), HOME: process.env["HOME"]!, SLOPWEAVER_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end(JSON.stringify(editPayload({ sessionId: "s-big" })));
    child.stdout.resume();
    const chunks: Buffer[] = [];
    const markerWhileStalled = await new Promise<boolean>((done) => {
      child.stderr.once("data", (first: Buffer) => {
        chunks.push(first);
        child.stderr.pause();
        setTimeout(() => {
          done(existsSync(markerOf({ home, sessionId: "s-big" })));
        }, STALL_MS);
      });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr.resume();
    const status = await new Promise<number | null>((done) => {
      child.on("close", (code) => {
        done(code);
      });
    });
    const stderr = Buffer.concat(chunks).toString("utf8");
    expect([markerWhileStalled, status]).toEqual([false, 2]);
    expect(stderr.startsWith(PROFILE_HELD_HEADLINE)).toBe(true);
    expect(stderr.trimEnd().endsWith(last)).toBe(true);
    expect(existsSync(markerOf({ home, sessionId: "s-big" }))).toBe(true);
  });

  it("writes no marker when the reader has closed the pipe before the refusal could be written", async () => {
    const home = tempDir({ prefix: "sw-held-home-" });
    seedCache({
      home,
      lines: [
        "## About the owner",
        ...Array.from({ length: BIG_PROFILE_LINES }, (_, i) => `- ${String(i)} ${"y".repeat(90)}`),
      ],
    });
    const child = spawn(SHIM, {
      env: { ...baseEnv(), HOME: process.env["HOME"]!, SLOPWEAVER_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.destroy();
    child.stdout.resume();
    child.stdin.end(JSON.stringify(editPayload({ sessionId: "s-closed" })));
    const status = await new Promise<number | null>((done) => {
      child.on("close", (code) => {
        done(code);
      });
    });
    expect([status, existsSync(markerOf({ home, sessionId: "s-closed" }))]).toEqual([2, false]);
  });

  it("reads and writes the home a config file names when the environment names none", () => {
    const configured = tempDir({ prefix: "sw-held-configured-" });
    const userHome = tempDir({ prefix: "sw-held-user-" });
    const xdg = tempDir({ prefix: "sw-held-xdg-" });
    mkdirSync(join(xdg, "slopweaver"));
    writeFileSync(join(xdg, "slopweaver", "env"), `SLOPWEAVER_HOME=${configured}\n`);
    seedCache({ home: configured, lines: ["## About the owner", "- a fact from the configured home"] });
    seedProfileDelivered({ home: configured, sessionId: "s-marked" });
    const env = { ...baseEnv(), HOME: userHome, XDG_CONFIG_HOME: xdg };
    const run = ({ sessionId }: { sessionId: string }) =>
      spawnSync(SHIM, {
        encoding: "utf8",
        env,
        input: JSON.stringify(editPayload({ sessionId })),
        timeout: HOOK_TIMEOUT_MS,
      });
    const marked = run({ sessionId: "s-marked" });
    const held = run({ sessionId: "s-new" });
    const retried = run({ sessionId: "s-new" });
    expect([marked.status, held.status, retried.status]).toEqual([0, 2, 0]);
    expect(held.stderr).toContain("- a fact from the configured home");
    expect([
      existsSync(markerOf({ home: configured, sessionId: "s-new" })),
      existsSync(join(userHome, ".slopweaver", "profile", "delivered", "s-new")),
    ]).toEqual([true, false]);
  });

  it("holds the first call after a compaction whose SessionStart never ran, though the old marker is still there", () => {
    const home = tempDir({ prefix: "sw-held-home-" });
    const transcript = join(tempDir({ prefix: "sw-held-transcript-" }), "session.jsonl");
    writeFileSync(transcript, `${JSON.stringify({ message: { content: "go", role: "user" }, type: "user" })}\n`);
    seedCache({ home, lines: ["## About the owner", "- the line that marks a redelivery"] });
    const env = { ...baseEnv(), HOME: process.env["HOME"]!, SLOPWEAVER_HOME: home };
    const run = () =>
      spawnSync(SHIM, {
        encoding: "utf8",
        env,
        input: JSON.stringify({ ...editPayload({ sessionId: "s-compact" }), transcript_path: transcript }),
        timeout: HOOK_TIMEOUT_MS,
      });
    const turn = `${JSON.stringify({ message: { content: [], role: "assistant" }, type: "assistant" })}\n`;
    const boundary = `${JSON.stringify({ content: "Conversation compacted", subtype: "compact_boundary", type: "system" })}\n`;
    const first = run();
    appendFileSync(transcript, turn);
    const working = run();
    // The compaction lands and nothing removes the marker: no SessionStart hook began.
    appendFileSync(transcript, boundary);
    const markerSurvived = existsSync(markerOf({ home, sessionId: "s-compact" }));
    const afterCompaction = run();
    const retried = run();
    expect([first.status, working.status, markerSurvived, afterCompaction.status, retried.status]).toEqual([
      2,
      0,
      true,
      2,
      0,
    ]);
    expect(afterCompaction.stderr.trimEnd().endsWith("- the line that marks a redelivery")).toBe(true);
  });
});
