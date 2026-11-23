/**
 * `runGateEntry` in a real process: a gate's `run` answers, every registered TypeScript closer runs AFTER it, and
 * the process exits with the code `run` chose — never a signal, never a code the close substituted. And when the
 * process ends some way the wrapper never returns from — a `process.exit` deep inside `run` or in an imported
 * module's top level, or an uncaught throw from a detached callback — the registry's exit-event backstop still
 * closes (`src/lib/tsLifecycle.ts`), ahead of a listener that throws and after a hand-emitted `exit` that ended
 * nothing.
 *
 * This cannot live on the unit lane: the wrapper ends in `process.exit`, and the property is that the close
 * happened in that same process before it ended. `../lib/drainStdio.test.ts` is the sibling this copies.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const GATE_ENTRY = join(repoRoot, "src", "devLint", "gateEntry.ts");
const TS_LIFECYCLE = join(repoRoot, "src", "lib", "tsLifecycle.ts");

/** The TypeScript loader, handed to `node` directly — `../lib/stdoutDataChannel.test.ts` § TSX_LOADER. */
const TSX_LOADER = import.meta.resolve("tsx");

/** A deadline rather than a request: an entry that never exits fails loudly instead of hanging the lane. */
const ENTRY_DEADLINE_MS = 20_000;

/** The code the child's gate answers — neither 0 nor the 1 a thrown error produces. */
const CHOSEN_EXIT = 23;

/** The code a `process.exit` inside `run` picks, distinct from {@link CHOSEN_EXIT}. */
const INNER_EXIT = 7;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Every child's environment, with `NODE_OPTIONS` removed — `../lib/stdoutDataChannel.test.ts` § emitterEnv. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  return env;
}

/**
 * Run one planted entry and answer the child and its event log's lines. The entry statically imports a module whose
 * top level is `importedBody`, then registers a closer and runs `runBody` as the body of `run`. Both bodies may call
 * `record(event)`, which appends to the log; the closer records `close`.
 */
function runEntry({ importedBody = "", runBody }: { importedBody?: string; runBody: string }): {
  child: SpawnSyncReturns<Buffer>;
  events: readonly string[];
} {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-gate-entry-"));
  fixtureDirs.push(dir);
  const log = join(dir, "events.txt");
  const recordLine = `const record = (event: string): void => { appendFileSync(${JSON.stringify(log)}, event + "\\n"); };`;
  // `.mts`: the temp dir has no `"type": "module"` package above it, and the top-level `await` needs ESM.
  const imported = join(dir, "probeRun.mts");
  const script = join(dir, "probe.entry.mts");
  writeFileSync(log, "");
  writeFileSync(
    imported,
    [
      `import { appendFileSync } from "node:fs";`,
      `import { registerTypeScriptCloser } from ${JSON.stringify(TS_LIFECYCLE)};`,
      recordLine,
      importedBody,
      `export const loaded = true;`,
    ].join("\n"),
  );
  writeFileSync(
    script,
    [
      `import { appendFileSync } from "node:fs";`,
      `import { runGateEntry } from ${JSON.stringify(GATE_ENTRY)};`,
      `import { registerTypeScriptCloser } from ${JSON.stringify(TS_LIFECYCLE)};`,
      `import { loaded } from ${JSON.stringify(imported)};`,
      recordLine,
      `registerTypeScriptCloser({ close: () => { record(loaded ? "close" : "unloaded"); } });`,
      `await runGateEntry({ run: () => { ${runBody} } });`,
    ].join("\n"),
  );
  const child = spawnSync(process.execPath, ["--import", TSX_LOADER, script], {
    env: childEnv(),
    killSignal: "SIGKILL",
    timeout: ENTRY_DEADLINE_MS,
  });
  const events = readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "");
  return { child, events };
}

describe("runGateEntry", () => {
  it("closes TypeScript after the gate runs, then exits with the gate's own code", () => {
    const { child, events } = runEntry({ runBody: `record("run"); return ${String(CHOSEN_EXIT)};` });

    expect(child.error).toBe(undefined);
    expect(child.signal).toBe(null);
    expect(child.status).toBe(CHOSEN_EXIT);
    expect(events).toEqual(["run", "close"]);
  });

  it("still closes when code inside run calls process.exit itself", () => {
    const { child, events } = runEntry({ runBody: `record("run"); process.exit(${String(INNER_EXIT)});` });

    expect(child.signal).toBe(null);
    expect(child.status).toBe(INNER_EXIT);
    expect(events).toEqual(["run", "close"]);
  });

  it("still closes when a detached callback throws while run never settles", () => {
    const { child, events } = runEntry({
      runBody: `record("run"); queueMicrotask(() => { throw new Error("boom"); }); return new Promise<number>(() => undefined);`,
    });

    expect(child.signal).toBe(null);
    expect(child.status).toBe(1);
    expect(child.stderr.toString()).toContain("boom");
    expect(events).toEqual(["run", "close"]);
  });

  it("closes before an earlier exit listener that throws can stop the rest", () => {
    const { child, events } = runEntry({
      importedBody: `process.once("exit", () => { throw new Error("listener broke"); });`,
      runBody: `record("run"); setImmediate(() => { process.exit(${String(INNER_EXIT)}); }); return new Promise<number>(() => undefined);`,
    });

    expect(child.signal).toBe(null);
    expect(events).toEqual(["run", "close"]);
  });

  it("still closes a client registered after an exit event that ended nothing", () => {
    const { child, events } = runEntry({
      runBody: `process.emit("exit", 0); registerTypeScriptCloser({ close: () => { record("late-close"); } }); record("run"); process.exit(${String(INNER_EXIT)});`,
    });

    expect(child.status).toBe(INNER_EXIT);
    expect(events).toEqual(["close", "run", "late-close"]);
  });

  it("still closes a client an imported module opened when that module ends the process as it loads", () => {
    const { child, events } = runEntry({
      importedBody: `registerTypeScriptCloser({ close: () => { record("import-close"); } }); record("import"); process.exit(${String(INNER_EXIT)});`,
      runBody: `record("run"); return 0;`,
    });

    expect(child.signal).toBe(null);
    expect(child.status).toBe(INNER_EXIT);
    expect(events).toEqual(["import", "import-close"]);
  });
}, 30_000);
