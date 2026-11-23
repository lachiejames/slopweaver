/**
 * A never-stale lock held by a zombie is taken over, proved with a real zombie rather than a modelled one.
 *
 * An exited process its parent has not reaped keeps its pid and its start stamp, and signal 0 still reaches it, so
 * the pid-plus-start liveness check alone read it as a live holder and refused every later writer of the hand-step
 * register for good. The one probe every holder check reads, `processStartOf`, says so itself. The unit lane cannot make one: the zombie is `sleep 0` backgrounded by
 * a shell that then `exec`s a longer `sleep`, which never waits for it.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { processStartOf } from "../../../talk/relayLease.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** A zombie's pid, and the parent that withholds `wait` from it until it is killed. */
async function zombie(): Promise<{ pid: number; parent: ChildProcess }> {
  const parent = spawn("sh", ["-c", "sleep 0 & echo $!; exec sleep 30"], { stdio: ["ignore", "pipe", "ignore"] });
  cleanups.push(() => parent.kill());
  const pid = await new Promise<number>((resolve) => {
    parent.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString("utf8").trim())));
  });
  // `sleep 0` exits at once; give it the moment it takes before it is read.
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { parent, pid };
}

describe("a never-stale lock whose holder is a zombie", () => {
  it("is taken over, though the pid still answers signal 0 and its start stamp still matches", async () => {
    const { pid } = await zombie();
    // The stamp `ps` still prints for it, read apart from the probe, so the record matches and only the state frees it.
    const stamp = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
    }).trim();
    expect([stamp.length > 0, processStartOf({ pid })]).toEqual([true, { running: false, start: undefined }]);
    const start = { start: stamp };
    const home = mkdtempSync(join(tmpdir(), "zombie-lock-"));
    cleanups.push(() => rmSync(home, { force: true, recursive: true }));
    const name = createHash("sha256").update("hand-step-register", "utf8").digest("hex").slice(0, 32);
    const lock = join(home, "ledgers", "operation-locks", `${name}.lock`);
    mkdirSync(lock, { recursive: true });
    writeFileSync(
      join(lock, `${String(pid)}-zombie`),
      JSON.stringify({ acquiredAtIso: "2026-09-27T00:00:00.000Z", pid, start: start.start }),
    );

    const taken = acquireOperationLock({
      home,
      key: "hand-step-register",
      nowIso: "2026-09-27T00:00:05.000Z",
      staleAfterMs: Number.POSITIVE_INFINITY,
    });

    expect(taken._unsafeUnwrap().stoleFromPid).toBe(pid);
  });
});
