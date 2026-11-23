/**
 * A swapped-out console server is ENDED, not only unbound — `scripts/docs-site.sh`'s `end_tree`, run for real
 * through its `--end-tree` seam.
 *
 * The incident: `next start` closes its listener on SIGTERM and goes on answering the keep-alive
 * sockets a browser already holds. The server swapped out kept answering Chrome's pooled requests, so
 * a live call's every tool claim reached a server whose memory never held the call and was refused "no plan call
 * is live", while the voice sat silent. The stop used to wait only for the port to free; it now freezes the old
 * tree with SIGSTOP, SIGKILLs it where it stands, and waits for every process of it to EXIT. Each case here
 * spawns a real two-process tree — a bash and the `sleep` it forked — so the walk over descendants is exercised,
 * not only the root.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = join(repoRoot, "scripts", "docs-site.sh");

let target: ChildProcess | undefined;

afterEach(() => {
  target?.kill("SIGKILL");
  target = undefined;
});

/**
 * Spawn a bash that forks a `sleep` and blocks, printing the sleep's pid once it exists.
 *
 * @param ignoreTerm whether the tree ignores SIGTERM, the way a server still holding sockets outlives one
 * @returns the bash child, the forked sleep's pid, and a promise of the bash's exit signal
 */
async function spawnTree({
  ignoreTerm,
}: {
  ignoreTerm: boolean;
}): Promise<{ root: ChildProcess; leafPid: number; exited: Promise<NodeJS.Signals | null> }> {
  const trap = ignoreTerm ? 'trap "" TERM; ' : "";
  // The root blocks on a stdin pipe nothing writes, not on `wait`, so the leaf dying first never ends the root
  // between the two signals and changes how many took one.
  const root = spawn("bash", ["-c", `${trap}sleep 60 & echo "$!"; read -r _; true`], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  target = root;
  const exited = new Promise<NodeJS.Signals | null>((done) => {
    root.on("exit", (_code, signal) => {
      done(signal);
    });
  });
  const leafPid = await new Promise<number>((done) => {
    root.stdout.once("data", (chunk: Buffer) => {
      done(Number(chunk.toString().trim()));
    });
  });
  return { exited, leafPid, root };
}

/**
 * Run the script's `--end-tree` seam against one pid.
 *
 * @returns everything the seam printed, its exit code, and how long it took
 */
async function endTree({ pid }: { pid: number }): Promise<{ output: string; code: number | null; tookMs: number }> {
  const startedMs = Date.now();
  const running = spawn("bash", [SCRIPT, "--end-tree", String(pid)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  running.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  running.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const code = await new Promise<number | null>((done) => {
    running.on("close", done);
  });
  return { code, output, tookMs: Date.now() - startedMs };
}

/**
 * Whether a pid still names a process.
 *
 * @returns false once the kernel no longer knows the pid
 */
function alive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("docs-site.sh --end-tree", () => {
  // A tree that ignores SIGTERM is the one the old stop could never end; this one is gone at once, waiting out no grace.
  it("freezes and SIGKILLs a whole tree that ignores SIGTERM, root and forked child both, without a grace", async () => {
    const { root, leafPid, exited } = await spawnTree({ ignoreTerm: true });
    const rootPid = root.pid!;

    const { output, code, tookMs } = await endTree({ pid: rootPid });

    expect(code).toBe(0);
    expect(output).toBe(`docs-site: pid ${rootPid}'s tree, 2 process(es), frozen and SIGKILLed\n`);
    expect(tookMs).toBeLessThan(5000);
    expect(await exited).toBe("SIGKILL");
    expect(alive({ pid: leafPid })).toBe(false);
  }, 30_000);

  // `kill -STOP -1` stops every process this user may signal.
  it("refuses a pid that is not positive, signalling nothing", async () => {
    const { output, code } = await endTree({ pid: -1 });

    expect(code).toBe(2);
    expect(output).toBe("docs-site: end_tree takes one positive pid, not '-1'\n");
  });

  // Resumed under SIGTERM, a handler could fork a child no walk saw. Killed while stopped, nothing runs.
  it("never resumes a tree that would exit on SIGTERM: it is SIGKILLed while frozen too", async () => {
    const { root, leafPid, exited } = await spawnTree({ ignoreTerm: false });
    const rootPid = root.pid!;

    const { output, code } = await endTree({ pid: rootPid });

    expect(code).toBe(0);
    expect(output).toBe(`docs-site: pid ${rootPid}'s tree, 2 process(es), frozen and SIGKILLed\n`);
    expect(await exited).toBe("SIGKILL");
    expect(alive({ pid: leafPid })).toBe(false);
  }, 30_000);
});
