/**
 * `drainStdio` over real descriptors: what a process wrote with `process.stdout.write` and
 * `process.stderr.write` before it exits is all there on the other side, and a reader that has already gone
 * leaves the exit code the process chose.
 *
 * This cannot live on the unit lane — the loss is a property of a real pipe at `process.exit`, and a capturing
 * sink sees every byte whatever the code does. `./stdoutDataChannel.test.ts` is the sibling this copies, and
 * its header is why the first case keeps a DRAINING reader: an emitter that waits for its reader cannot run
 * against one that never reads, so the case proves every byte arrived in that run and Node's queue was empty
 * at exit, never that the write met back-pressure. The truncation itself is that file's first case.
 *
 * The second case is the one a first draft of the drain failed. Behind a closed reader the write fails with
 * `EPIPE` and the stream emits `error` on a later tick; a listener removed in the write's callback leaves it
 * unhandled, and the process died with exit 1 from a run that chose 0. MEASURED on node 24.21.0.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, constants, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DRAIN = join(repoRoot, "src", "lib", "drainStdio.ts");

/** The TypeScript loader, handed to `node` directly — `./stdoutDataChannel.test.ts` § TSX_LOADER. */
const TSX_LOADER = import.meta.resolve("tsx");

/** Past every pipe buffer measured on this lane's kernels (65,536 and 146,176). */
const BLOB_BYTES = 300_000;

/** A deadline rather than a request: a drain that waited on a reader this test never gives it fails loudly. */
const EMITTER_DEADLINE_MS = 20_000;

/** The exit code the emitter chooses — neither 0 nor the 1 an unhandled `error` event produces. */
const CHOSEN_EXIT = 7;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory for one emitter, inside this test FILE's own `TMPDIR` sandbox. */
function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-drain-stdio-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Every emitter's environment, with `NODE_OPTIONS` removed — `./stdoutDataChannel.test.ts` § emitterEnv. */
function emitterEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  return env;
}

/**
 * An emitter that writes a large document to each stream through the async stream API, then a verdict line
 * after the stdout one — the shape `dev gate` has — drains, records what stdout still had queued, and exits.
 */
function writeEmitter({ dir }: { dir: string }): { script: string; reportPath: string } {
  // `.mts`: the temp dir has no `"type": "module"` package above it, and the top-level `await` needs ESM.
  const script = join(dir, "emit.mts");
  const reportPath = join(dir, "queued.txt");
  writeFileSync(
    script,
    [
      `import { writeFileSync } from "node:fs";`,
      `import { drainStdio } from ${JSON.stringify(DRAIN)};`,
      `process.stdout.write("o".repeat(${String(BLOB_BYTES)}) + "\\n");`,
      `process.stderr.write("e".repeat(${String(BLOB_BYTES)}) + "\\n");`,
      `process.stdout.write("dev gate: FAIL\\n");`,
      `await drainStdio();`,
      `writeFileSync(${JSON.stringify(reportPath)}, String(process.stdout.writableLength));`,
      `process.exit(${String(CHOSEN_EXIT)});`,
    ].join("\n"),
  );
  return { reportPath, script };
}

describe("drainStdio", () => {
  it("lets every byte written through the stream API reach a piped reader before exit, verdict included", () => {
    const { reportPath, script } = writeEmitter({ dir: fixtureDir() });
    const child = spawnSync(process.execPath, ["--import", TSX_LOADER, script], {
      env: emitterEnv(),
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024 * 1024,
      timeout: EMITTER_DEADLINE_MS,
    });
    expect(child.error).toBe(undefined);
    expect(child.status).toBe(CHOSEN_EXIT);
    expect(child.stdout.toString("utf8")).toBe(`${"o".repeat(BLOB_BYTES)}\ndev gate: FAIL\n`);
    expect(child.stderr.toString("utf8")).toBe(`${"e".repeat(BLOB_BYTES)}\n`);
    // Node's own queue was empty when `process.exit` ran, so it had nothing to discard.
    expect(readFileSync(reportPath, "utf8")).toBe("0");
  });

  it("keeps the process's own exit code when the stdout reader has already gone", () => {
    const dir = fixtureDir();
    const { script } = writeEmitter({ dir });
    const fifo = join(dir, "stdout.fifo");
    // Node has no `mkfifo`. A FIFO is the one pipe whose reader this test can CLOSE before the child writes,
    // which is `| head -c 1` made deterministic: every write the child makes meets `EPIPE`.
    execFileSync("mkfifo", [fifo], { killSignal: "SIGKILL", timeout: EMITTER_DEADLINE_MS });
    const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const writeEnd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    closeSync(readEnd);
    try {
      const child = spawnSync(process.execPath, ["--import", TSX_LOADER, script], {
        env: emitterEnv(),
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", writeEnd, "pipe"],
        timeout: EMITTER_DEADLINE_MS,
      });
      expect(child.error).toBe(undefined);
      // An unhandled `EPIPE` would have exited 1 and printed its stack; neither happened.
      expect(child.stderr.toString("utf8")).not.toContain("EPIPE");
      expect(child.status).toBe(CHOSEN_EXIT);
    } finally {
      closeSync(writeEnd);
    }
  });
}, 30_000);
