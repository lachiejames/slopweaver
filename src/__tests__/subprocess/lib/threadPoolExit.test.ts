/**
 * The CLI process shell over a real thread pool and a real `process.exit`: a verb that leaves a request blocked in
 * libuv's pool still ends, naming the request, where a bare `process.exit` waits on it forever; and a verb whose
 * request merely takes a moment still exits with its own code.
 *
 * This cannot live on the unit lane: the hang is Node joining its pool inside `process.exit`, which no capturing seam
 * can stand in for. The blocked request is an `fs.readFile` of a FIFO nobody opens for writing — its `open` never
 * returns — the deterministic stand-in for the request `github merge --admin --dry-run` once left behind, whose
 * kind was never captured (`../../../lib/threadPoolExit.ts` § the CLOSED socket).
 *
 * The control case is the falsifier. It holds the same request and calls `process.exit` itself; it must outlive its
 * deadline. If a Node upgrade ever stops joining the pool at exit, the control goes red and says this mechanism is
 * no longer needed, rather than leaving a wait nobody can explain.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFile, rmSync, writeFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  productionThreadPoolExitSeams,
  THREAD_POOL_EXIT_WAIT_MS,
  threadPoolRequests,
} from "../../../lib/threadPoolExit.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAIN = join(repoRoot, "src", "cli", "main.ts");

/** The TypeScript loader, handed to `node` directly — `./stdoutDataChannel.test.ts` § TSX_LOADER. */
const TSX_LOADER = import.meta.resolve("tsx");

/** The exit code each emitter's verb answers — neither 0 nor the 1 a thrown verb exits with. */
const VERB_CODE = 7;

/**
 * A deadline rather than a request: a shell that hung would fail here instead of wedging the lane. Twice the real
 * pool wait, which the stuck case pays in full — the emitter keeps the shell's DEFAULT exit, so reverting that
 * default to a bare `process.exit` turns the stuck case red rather than leaving it green over an injected copy.
 */
const EMITTER_DEADLINE_MS = 2 * THREAD_POOL_EXIT_WAIT_MS;

/** How long the control is given to exit on its own. It never does; this is what the case pays to prove that. */
const CONTROL_DEADLINE_MS = 3_000;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory holding one FIFO nobody will ever write, inside this test FILE's own `TMPDIR` sandbox. */
function fixtureDir(): { dir: string; fifo: string } {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-pool-exit-"));
  fixtureDirs.push(dir);
  const fifo = join(dir, "never-written.fifo");
  // Node has no `mkfifo`.
  execFileSync("mkfifo", [fifo], { killSignal: "SIGKILL", timeout: EMITTER_DEADLINE_MS });
  return { dir, fifo };
}

/** Every emitter's environment, with `NODE_OPTIONS` removed — `./stdoutDataChannel.test.ts` § emitterEnv. */
function emitterEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  return env;
}

/**
 * An emitter that runs the real process shell over a verb which starts reading `target`, prints its last line and
 * answers {@link VERB_CODE} without waiting for the read. With `chain`, every read's callback starts the next one,
 * forever — the shape of a background directory walk, which never leaves the pool empty. Only the staleness guard
 * is injected, because a source run has no built tree to judge; the exit is the shell's own default.
 */
function shellEmitter({ chain = false, dir, target }: { chain?: boolean; dir: string; target: string }): string {
  // `.mts`: the temp dir has no `"type": "module"` package above it, and the top-level `await` needs ESM.
  const script = join(dir, "shell.mts");
  writeFileSync(
    script,
    [
      `import { readFile } from "node:fs";`,
      `import { runCliProcess } from ${JSON.stringify(MAIN)};`,
      `await runCliProcess({`,
      `  argv: ["node", "cli", "probe", "verb"],`,
      `  guard: () => Promise.resolve({ disposition: "run", lines: [] }),`,
      `  run: () => {`,
      chain
        ? `    const next = () => { readFile(${JSON.stringify(target)}, next); }; next();`
        : `    readFile(${JSON.stringify(target)}, () => {});`,
      `    process.stdout.write("would merge; dry-run wrote nothing.\\n");`,
      `    return Promise.resolve(${String(VERB_CODE)});`,
      `  },`,
      `});`,
    ].join("\n"),
  );
  return script;
}

describe("the CLI process shell's exit over a real thread pool", () => {
  it("ends a process whose verb left a request blocked in the pool, naming it and the verb's own code", () => {
    const { dir, fifo } = fixtureDir();
    const child = spawnSync(process.execPath, ["--import", TSX_LOADER, shellEmitter({ dir, target: fifo })], {
      env: emitterEnv(),
      killSignal: "SIGKILL",
      timeout: EMITTER_DEADLINE_MS,
    });

    expect(child.error).toBe(undefined);
    expect(child.signal).toBe("SIGKILL");
    expect(child.stdout.toString("utf8")).toBe("would merge; dry-run wrote nothing.\n");
    expect(child.stderr.toString("utf8")).toBe(
      `exit: libuv's thread pool still holds FSReqCallback x1 after ${String(THREAD_POOL_EXIT_WAIT_MS / 1_000)}s. ` +
        "Node joins that pool inside process.exit, so exiting would wait on it forever; ending this process with " +
        "SIGKILL instead. " +
        `The verb itself answered exit code ${String(VERB_CODE)}.\n`,
    );
  });

  it("exits with the verb's own code when its pending request is one that settles", () => {
    const { dir } = fixtureDir();
    const regular = join(dir, "regular.txt");
    writeFileSync(regular, "a regular file's read returns\n");
    const child = spawnSync(process.execPath, ["--import", TSX_LOADER, shellEmitter({ dir, target: regular })], {
      env: emitterEnv(),
      killSignal: "SIGKILL",
      timeout: EMITTER_DEADLINE_MS,
    });

    expect(child.error).toBe(undefined);
    expect(child.status).toBe(VERB_CODE);
    expect(child.stderr.toString("utf8")).toBe("");
  });

  it("exits promptly with the verb's own code under an endless chain of reads that each settle", () => {
    const { dir } = fixtureDir();
    const regular = join(dir, "regular.txt");
    writeFileSync(regular, "each read of a regular file returns\n");
    const child = spawnSync(
      process.execPath,
      ["--import", TSX_LOADER, shellEmitter({ chain: true, dir, target: regular })],
      { env: emitterEnv(), killSignal: "SIGKILL", timeout: THREAD_POOL_EXIT_WAIT_MS },
    );

    // A deadline of the pool wait itself: an exit that waited for an EMPTY pool would never get one here, and would
    // be SIGKILLed at that wait with a line on stderr — or by this deadline first.
    expect(child.error).toBe(undefined);
    expect(child.status).toBe(VERB_CODE);
    expect(child.stderr.toString("utf8")).toBe("");
  });

  it("control: a bare process.exit over the same blocked request does not end the process", () => {
    const { dir, fifo } = fixtureDir();
    const script = join(dir, "bare.mts");
    writeFileSync(
      script,
      [
        `import { readFile } from "node:fs";`,
        `readFile(${JSON.stringify(fifo)}, () => {});`,
        `setTimeout(() => {`,
        `  process.stdout.write("calling process.exit\\n");`,
        `  process.exit(${String(VERB_CODE)});`,
        `}, 100);`,
      ].join("\n"),
    );
    const child = spawnSync(process.execPath, ["--import", TSX_LOADER, script], {
      env: emitterEnv(),
      killSignal: "SIGKILL",
      timeout: CONTROL_DEADLINE_MS,
    });

    // The marker proves the script ran to the exit call, so the timeout is the exit's own and not a loader that
    // never got that far. Still alive at its deadline, so spawnSync killed it: `process.exit` never ended it.
    expect(child.stdout.toString("utf8")).toBe("calling process.exit\n");
    expect(String(child.error)).toContain("ETIMEDOUT");
    expect(child.signal).toBe("SIGKILL");
  });
}, 90_000);

/*
 * The one undocumented call the exit stands on, read in this process: it must see a real in-flight request by the
 * class names the exit filters on, and its absence must throw rather than read as an empty pool — an exit that
 * silently saw nothing would call `process.exit` over a blocked request and hang exactly as before.
 */
describe("the exit's view of Node's in-flight requests", () => {
  it("sees an in-flight callback read and promise read by Node's own class names", async () => {
    const callbackRead = new Promise<void>((settle) => {
      readFile(MAIN, () => {
        settle();
      });
    });
    const promiseRead = readFileAsync(MAIN);

    const names = threadPoolRequests({ requests: productionThreadPoolExitSeams().activeRequests() }).map(
      (request) => request.constructor.name,
    );
    await Promise.all([callbackRead, promiseRead]);

    expect(names).toEqual(expect.arrayContaining(["FSReqCallback", "FSReqPromise"]));
  });

  it("throws, naming the gap, on a Node without the accessor", () => {
    const accessor: unknown = Reflect.get(process, "_getActiveRequests");
    Reflect.deleteProperty(process, "_getActiveRequests");
    try {
      expect(() => productionThreadPoolExitSeams().activeRequests()).toThrow(
        "process._getActiveRequests is gone from this Node, so the CLI exit cannot see the pool",
      );
    } finally {
      Reflect.set(process, "_getActiveRequests", accessor);
    }
  });
});
