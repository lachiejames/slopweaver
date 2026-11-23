/**
 * The pipe-truncation defect and its fix, proved through real processes rather than described.
 *
 * `process.stdout.write` is ASYNCHRONOUS when stdout is a pipe: it hands the kernel what the pipe buffer
 * will take, keeps the rest in Node's own pending queue, and `process.exit` throws that queue away. The
 * bytes the kernel already accepted still arrive, so a reader gets a PREFIX. MEASURED — the
 * first real run of `atlas cloudflare read --kind access-application --json` cut off mid-string and `jq`
 * reported `Unfinished string at EOF`. A truncated document that still parses as far as it goes is the
 * worst failure available here, because a consumer reads it as a COMPLETE answer.
 *
 * This cannot live on the unit lane. The loss is a property of a real descriptor at process exit, so an
 * in-process test with a capturing sink sees every byte and stays green over the defect. Only a spawned
 * process whose stdout is a real pipe observes it.
 *
 * **Two things decide whether bytes are lost, and ASSUMING either is what made this test wrong.**
 *
 * The first is WHO READS. `StreamBase::DoTryWrite` loops `uv_try_write` until `EAGAIN` or the chunk is
 * gone, and a parent sitting in `execFileSync` drains the descriptor WHILE that loop runs, so a reader that
 * keeps up lets all 300,012 bytes land and leaves no loss to observe. MEASURED: a CI
 * run red with `expected 300012 to be less than 300012`, two other pull requests green on the
 * same fleet in the same minutes. A required lane whose verdict comes from runner contention teaches the
 * fleet to re-run CI instead of reading it, which is the opposite of what moving these lanes to CI bought.
 *
 * The second is HOW MUCH THE BUFFER HOLDS. The first version of this test pinned 65,536 surviving bytes —
 * one buffer, exactly what this developer machine keeps — and CI kept 146,176 instead, so a correct test
 * failed a correct fix. Dropping the number was right and not enough: a document SMALLER than the buffer
 * survives whole however carefully the reader is controlled, and a pipe is 16 pages, which is 65,536 bytes
 * on a 4 KiB-page kernel and 1,048,576 on a 64 KiB-page arm64 one — and two pages if the user is over
 * `pipe-user-pages-soft` at the moment it is created.
 *
 * So both are taken away from the runner. The loss case opens a FIFO, fills it from this process to learn
 * what THAT object holds, empties it again, and sizes the document past what it just measured; from the
 * moment the child is spawned the read end is not touched until the child has exited. Nothing can have made
 * room, and the document cannot fit, so the survivor is a strict, non-empty PREFIX — which is the sharper
 * claim anyway: a prefix is precisely why a consumer parses it and believes it. Capacity is measured on the
 * FIFO the child actually writes to, never a probe beside it, because the limit is applied per pipe at
 * creation and the machine's pipe usage moves underneath a separate measurement.
 *
 * MEASURED on both kernels this lane runs on, five consecutive laps each. Undrained FIFO:
 * capacity 65,536 and 65,536 of 300,012 bytes survived on Linux (node 24.21.0); capacity 8,192 and 8,192
 * survived on darwin; exit status 0 and the same number every lap. Drained channel, the harness this
 * replaces: 146,176 on Linux and 65,536 on darwin — one fixed number per machine HERE, while the red lap
 * above is a runner whose reader got further. The Linux half also settles the premise that could have made
 * this worse rather than better, because Node documents a piped stdout as synchronous on some platforms: on
 * the pinned runtime it is not, the write returns `EAGAIN`, and the child exits rather than blocking on a
 * reader that never comes. Re-measure with:
 *
 *   docker run --rm node:24 node -e '
 *   const{execFileSync,spawnSync}=require("node:child_process"),f=require("node:fs"),d=f.mkdtempSync("/tmp/p"),e=d+"/e.js";
 *   f.writeFileSync(e,"process.stdout.write(JSON.stringify({blob:String().padEnd(3e5,\"x\")})+String.fromCharCode(10));process.exit(0)");
 *   execFileSync("mkfifo",[d+"/f"]);const r=f.openSync(d+"/f",f.constants.O_RDONLY|f.constants.O_NONBLOCK),w=f.openSync(d+"/f","w");
 *   const c=spawnSync(process.execPath,[e],{stdio:["ignore",w,"inherit"],timeout:2e4});f.closeSync(w);
 *   let n=0,b=Buffer.alloc(1<<20),k;for(;;){k=f.readSync(r,b,0,b.length,null);if(!k)break;n+=k}
 *   console.log("unread fifo:",n,"exit",c.status,"| drained:",execFileSync(process.execPath,[e],{maxBuffer:1<<26}).length)'
 *
 * What this construction gives up, stated rather than discovered: `logger.out` CANNOT run against a reader
 * that never drains. `writeAllSync` retries `EAGAIN` forever by design — blocking visibly beats exiting 0
 * with a prefix — so a parent that never reads would hang it rather than fail it. Its case therefore keeps
 * a draining reader, and what it proves is bounded accordingly: every byte arrived in THAT run, and Node's
 * queue was empty at exit so nothing was discarded. It does NOT prove the write met back-pressure, and it
 * is no longer a place the first case witnesses — the two now run over two different kernel objects, a
 * FIFO and the `socketpair` `child_process` hands a `"pipe"` child on POSIX. Making the second case
 * deterministic too would need `FIONREAD`/`F_GETPIPE_SZ` to observe fullness without reading, which is
 * native, Linux-only machinery and far past what de-flaking one lane should drag in.
 */
import { execFileSync, type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LOGGER = join(repoRoot, "src", "lib", "logger.ts");

/**
 * The TypeScript loader, resolved from THIS module and handed to `node` directly.
 *
 * Only the `logger.out` case needs it, and that is load-bearing rather than tidy. A loader is not a library
 * a child links: `tsx` starts an esbuild SERVICE process, which outlives a `SIGKILL` aimed at its parent
 * and keeps the descriptors it inherited. The FIFO case therefore carries NO loader at all — its emitter is
 * plain ESM, so the deadline has exactly one process to kill and the drain that follows cannot meet a
 * writer this harness did not account for. It is resolved
 * here and handed to `node` rather than run as `node_modules/.bin/tsx`, which spawns a second Node process
 * of its own.
 *
 * The residue that remains, named rather than left for the next reader to rediscover: the drained case
 * still loads `tsx`, so a `SIGSTOP`-ed esbuild service can outlive the deadline holding the stderr it
 * inherited (reproduced on node 24.21.0 — `ETIMEDOUT` at 20,007ms, the service alive at
 * 22,500ms). It is not this file's to fix and not this file's to hide: `bin/slopweaver` runs the CLI under
 * `tsx`, so every one of this lane's spawning tests has the same descendant. Count them with
 * `grep -rln 'bin/slopweaver' src/__tests__/subprocess/ | wc -l`. What matters HERE is that no such process
 * can ever hold the FIFO under test — that one has no loader — so the drain below cannot be stalled by one.
 */
const TSX_LOADER = import.meta.resolve("tsx");

/** The size the original defect was found at, and the floor every document here keeps. */
const BASE_BLOB_BYTES = 300_000;

/** How far past a measured capacity a document is sized, so one buffer is provably not all of it. */
const CAPACITY_MARGIN_BYTES = 65_536;

/**
 * Hard deadline on every emitter, with `SIGKILL` so it is a deadline rather than a request.
 *
 * It exists to make ONE wrong premise loud instead of silent: if a runtime ever hands a verb a stdout that
 * blocks rather than returning `EAGAIN`, the first case's child waits on a reader this test has promised
 * never to be, and with no deadline it would sit there until the 20-minute job timeout.
 */
const EMITTER_DEADLINE_MS = 20_000;

/** One page, the unit both the capacity probe and the kernel's own sizing work in. */
const PROBE_CHUNK = Buffer.alloc(4096);

/**
 * Every emitter's environment, with `NODE_OPTIONS` removed.
 *
 * "This case runs under no loader" has to be a fact about the CHILD, not about the machine that happened to
 * run the suite. `NODE_OPTIONS` is inherited and may carry `--import`, which preloads code into an emitter
 * that spawns nothing — and a descendant that preload starts inherits the FIFO's write end, so it can hold
 * the drain open past a deadline aimed at one process. Reproduced at
 * `ETIMEDOUT` after 20,005ms with the descendant still alive. It is the same thesis as measuring the
 * capacity instead of assuming it: the environment does not get a vote on what this test decides.
 */
function emitterEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  return env;
}

/** What the emitter observed about its own stdout at the instant `process.exit` ran. */
const StdoutReport = z.object({
  queuedAtExit: z.number().int().nonnegative(),
  stdoutKind: z.enum(["fifo", "socket", "file", "other"]),
});
type StdoutReport = z.infer<typeof StdoutReport>;

/** One emitter's whole result: what it was asked to place, what arrived, and what it saw at exit. */
interface ChannelObservation {
  readonly survived: string;
  readonly wholeDocument: string;
  readonly report: StdoutReport;
}

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory for one emitter, inside this test FILE's own `TMPDIR` sandbox. */
function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-stdout-pipe-"));
  fixtureDirs.push(dir);
  return dir;
}

/** The exact bytes a channel is asked to place on stdout, newline included. */
function documentOf({ blobBytes }: { blobBytes: number }): string {
  return `${JSON.stringify({ blob: "x".repeat(blobBytes) })}\n`;
}

/**
 * Whether a thrown error is the kernel saying "not now" on a non-blocking descriptor.
 *
 * Every caller here treats it as a state, never as a failure to retry past.
 */
function isEagain({ error }: { error: unknown }): boolean {
  return error instanceof Error && "code" in error && error.code === "EAGAIN";
}

/**
 * Fill this FIFO from the parent until it refuses, then read it back empty, and return what it took.
 *
 * Measured on the descriptor the child will actually write to, not a probe beside it: a pipe's ring is
 * allocated when it is created and `pipe-user-pages-soft` is applied per pipe at that moment, so a second
 * FIFO opened a millisecond later can be sized differently by nothing this test did.
 * Both ends stay open throughout, so the read back stops at `EAGAIN` rather than EOF and the FIFO is
 * handed to the child exactly as empty as it was found.
 */
function measureCapacityAndEmpty({ readEnd, writeEnd }: { readEnd: number; writeEnd: number }): number {
  let accepted = 0;
  for (;;) {
    try {
      accepted += writeSync(writeEnd, PROBE_CHUNK);
    } catch (error: unknown) {
      if (!isEagain({ error })) {
        throw error;
      }
      break;
    }
  }
  const sink = Buffer.alloc(1 << 20);
  for (;;) {
    try {
      readSync(readEnd, sink, 0, sink.length, null);
    } catch (error: unknown) {
      if (!isEagain({ error })) {
        throw error;
      }
      return accepted;
    }
  }
}

/**
 * The source of one emitter: place the document on stdout with `place`, then record what the child itself
 * can see about its own stdout, then exit the way a verb does — with no event-loop turn in between, which
 * is the whole defect.
 *
 * The report goes to a FILE rather than to stderr because stderr is a pipe with exactly the hazard under
 * test, and a report lost to that hazard would read as a passing test.
 */
function emitterSource({
  blobBytes,
  place,
  reportPath,
}: {
  blobBytes: number;
  place: string;
  reportPath: string;
}): string {
  return [
    `import { fstatSync, writeFileSync } from "node:fs";`,
    `const document = JSON.stringify({ blob: "x".repeat(${String(blobBytes)}) });`,
    place,
    `const stat = fstatSync(1);`,
    `const kinds = [];`,
    `if (stat.isFIFO()) kinds.push("fifo");`,
    `if (stat.isSocket()) kinds.push("socket");`,
    `if (stat.isFile()) kinds.push("file");`,
    `if (kinds.length === 0) kinds.push("other");`,
    `writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({`,
    `  queuedAtExit: process.stdout.writableLength,`,
    `  stdoutKind: kinds[0],`,
    `}));`,
    `process.exit(0);`,
  ].join("\n");
}

/** Read back one emitter's report, refusing a shape it did not write. */
function reportAt({ path }: { path: string }): StdoutReport {
  return StdoutReport.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Everything left in a FIFO whose writers have all closed, read until EOF.
 *
 * `EAGAIN` propagates rather than being retried, and that is the load-bearing choice: an empty FIFO returns
 * EOF once the last writer is gone, so `EAGAIN` here can only mean a writer is still open — a leaked
 * descriptor, or a surviving grandchild. Retrying would hide that and spin a synchronous loop no test
 * timeout can interrupt.
 */
function drainToEof({ fd }: { fd: number }): string {
  const chunk = Buffer.alloc(1 << 20);
  let text = "";
  for (;;) {
    const read = readSync(fd, chunk, 0, chunk.length, null);
    if (read === 0) {
      return text;
    }
    text += chunk.subarray(0, read).toString("utf8");
  }
}

/** The emitter finished on its own terms, so everything it left behind is worth reading. */
function assertChildSucceeded({ child }: { child: SpawnSyncReturns<Buffer> }): void {
  expect(child.error).toBe(undefined);
  expect(child.signal).toBe(null);
  expect(child.status).toBe(0);
}

/**
 * Own the parent's write end for its whole life: measure this FIFO, size an emitter past what it holds, run
 * it, and release the descriptor.
 *
 * Releasing it here rather than at the caller is the point — while this process still holds a writer, an
 * emptied FIFO answers `EAGAIN` instead of EOF and the drain that follows would never return.
 */
function runEmitterIntoFifo({
  fifo,
  place,
  readEnd,
  reportPath,
  script,
}: {
  fifo: string;
  place: string;
  readEnd: number;
  reportPath: string;
  script: string;
}): { blobBytes: number; capacity: number; child: SpawnSyncReturns<Buffer> } {
  const writeEnd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
  try {
    const capacity = measureCapacityAndEmpty({ readEnd, writeEnd });
    const blobBytes = Math.max(BASE_BLOB_BYTES, capacity + CAPACITY_MARGIN_BYTES);
    writeFileSync(script, emitterSource({ blobBytes, place, reportPath }));
    return {
      blobBytes,
      capacity,
      // No loader argument: this emitter is plain ESM, so the deadline below has one process to kill and
      // nothing survives it holding a descriptor. See {@link TSX_LOADER}.
      child: spawnSync(process.execPath, [script], {
        env: emitterEnv(),
        killSignal: "SIGKILL",
        stdio: ["ignore", writeEnd, "inherit"],
        timeout: EMITTER_DEADLINE_MS,
      }),
    };
  } finally {
    closeSync(writeEnd);
  }
}

/**
 * Spawn one emitter with stdout on a channel this process drains as the child runs — the ordinary shape,
 * and the only one a writer that waits for its reader can be measured in at all.
 */
function throughADrainedChannel({ place }: { place: string }): ChannelObservation {
  const dir = fixtureDir();
  const script = join(dir, "emit.ts");
  const reportPath = join(dir, "report.json");
  writeFileSync(script, emitterSource({ blobBytes: BASE_BLOB_BYTES, place, reportPath }));
  const survived = execFileSync(process.execPath, ["--import", TSX_LOADER, script], {
    env: emitterEnv(),
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
    timeout: EMITTER_DEADLINE_MS,
  }).toString("utf8");
  return {
    report: reportAt({ path: reportPath }),
    survived,
    wholeDocument: documentOf({ blobBytes: BASE_BLOB_BYTES }),
  };
}

/**
 * Spawn one emitter with stdout on a FIFO that is measured, emptied, and then NEVER read until the child
 * has exited.
 *
 * That is the whole point: the document cannot fit and no reader can have made room, so the verdict belongs
 * to this test rather than to whatever else the runner is doing. The read end stays open for the child's
 * whole life — closing it early would `SIGPIPE` the emitter instead — and every descriptor is released in a
 * `finally` so a failed assertion cannot leak one into the next test.
 */
function throughAnUnreadPipe({ place }: { place: string }): ChannelObservation & { capacity: number } {
  const dir = fixtureDir();
  const fifo = join(dir, "stdout.fifo");
  // Node has no `mkfifo`, and a FIFO is the only pipe whose read end a parent can hold open without reading
  // it — a `child_process` `"pipe"` is drained by the runtime itself.
  execFileSync("mkfifo", [fifo], { killSignal: "SIGKILL", timeout: EMITTER_DEADLINE_MS });
  // `.mjs`, not `.ts`: this case runs under no loader, so the extension is what makes it ESM.
  const script = join(dir, "emit.mjs");
  const reportPath = join(dir, "report.json");
  // Non-blocking, so opening the read end returns before any writer exists; the write end then opens freely.
  const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const { blobBytes, capacity, child } = runEmitterIntoFifo({ fifo, place, readEnd, reportPath, script });
    assertChildSucceeded({ child });
    return {
      capacity,
      report: reportAt({ path: reportPath }),
      survived: drainToEof({ fd: readEnd }),
      wholeDocument: documentOf({ blobBytes }),
    };
  } finally {
    closeSync(readEnd);
  }
}

describe("a document larger than the pipe buffer", () => {
  it("is TRUNCATED to a strict prefix when a verb writes it with process.stdout.write", () => {
    const { capacity, survived, report, wholeDocument } = throughAnUnreadPipe({
      place: "process.stdout.write(`${document}\\n`);",
    });
    // The channel under test really was a pipe — a green run over a regular file would prove nothing.
    expect(report.stdoutKind).toBe("fifo");
    // The premise, asserted on THIS FIFO rather than assumed: a document it could hold whole would leave
    // nothing to lose no matter who was reading.
    expect(wholeDocument.length).toBeGreaterThan(capacity);
    // Exact, and portable: whatever the kernel kept is byte-for-byte the document's own opening run.
    expect(survived).toBe(wholeDocument.slice(0, survived.length));
    // …and it is a STRICT prefix, so bytes were genuinely lost rather than merely re-chunked. Nothing
    // drained this FIFO, so this is its measured buffer against a larger document, not a race.
    expect(survived.length).toBeLessThan(wholeDocument.length);
    // A prefix that OPENS as a document is the whole danger — it does not parse, `jq` says `Unfinished
    // string at EOF`, and a consumer that reads far enough to find its shape has already believed it. So
    // prove the survivor opens as one, and — since an empty read satisfies every assertion above — that
    // anything arrived at all. Overstating this as "a prefix that parses" would be wrong.
    expect(survived.startsWith('{"blob":"xxx')).toBe(true);
    // The loss named at its source: bytes were still in Node's pending queue when `process.exit` threw that
    // queue away. HOW MANY is Node's own accounting (300,012 on both kernels here — it counts the whole
    // chunk until the write callback fires), which is exactly the kind of number this test has been wrong
    // about before, so the claim is that there were some.
    expect(report.queuedAtExit).toBeGreaterThan(0);
  });

  it("arrives INTACT through logger.out, whose blocking loop places every byte", () => {
    const { survived, report, wholeDocument } = throughADrainedChannel({
      place: `import { logger } from ${JSON.stringify(LOGGER)};\n` + "logger.out({ line: document });",
    });
    // A `socketpair`, which is what `child_process` gives a `"pipe"` child on POSIX — not a FIFO, and not a
    // file. Naming it exactly is also what says the two cases run over two different kernel objects.
    expect(report.stdoutKind).toBe("socket");
    expect(survived).toBe(wholeDocument);
    // `logger.out` returns only once every byte has been handed to the descriptor, so `process.exit` finds
    // an empty queue and has nothing to discard — true whatever the reader did.
    expect(report.queuedAtExit).toBe(0);
  });
}, 30_000);
