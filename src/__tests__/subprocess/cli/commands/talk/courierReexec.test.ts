/**
 * The courier's re-exec over a REAL `process.execve`: a Node process that runs `execCourier` becomes main's launcher in
 * place — the same pid, the same stdout pipe the chair's background task reads, started in main's directory with
 * `SLOPWEAVER_CLI_DIR` forced to main, the restart instant stamped and every other variable kept. That is the whole reason the chair never hears of a
 * restart, and only a real exec can show it: a fake seam records a call, never a pid.
 *
 * Success only. On Node 24 an exec that fails past the executable check aborts the process (`courierReexec.ts`'s
 * header carries the measurement), so the failed check is the unit lane's case, never one run here.
 *
 * The second half runs the REAL launcher over the real tsx: booted unmarked as the chair boots it, then re-exec'd
 * twice, the process table under the boot's pid must be one wrapper over one child. The unfixed shape after two
 * re-execs was four, a wrapper per re-exec (`courierReexec.ts` § The same tier).
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { launcherNodeEnv, writeLauncherManifest } from "../../../launcherNode.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const REEXEC = join(repoRoot, "src", "cli", "commands", "talk", "courierReexec.ts");

/** The TypeScript loader, handed to `node` directly — `../../../lib/stdoutDataChannel.test.ts` § TSX_LOADER. */
const TSX_LOADER = import.meta.resolve("tsx");

const DEADLINE_MS = 20_000;
const AT = "2026-10-31T06:30:00.000Z";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fake main checkout whose launcher reports what it was started as, plus the process that execs into it. */
function fixture(): { readonly main: string; readonly emitter: string } {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-courier-reexec-"));
  fixtureDirs.push(dir);
  const main = join(dir, "main");
  mkdirSync(join(main, "bin"), { recursive: true });
  const launcher = join(main, "bin", "slopweaver");
  writeFileSync(
    launcher,
    '#!/bin/sh\necho "after pid=$$ cwd=$(pwd -P) cli=$SLOPWEAVER_CLI_DIR at=$SLOPWEAVER_COURIER_REEXEC_AT stamped=$SLOPWEAVER_COURIER_REEXEC_PID kept=$KEPT argv=$*"\n',
  );
  chmodSync(launcher, 0o755);
  const emitter = join(dir, "emitter.ts");
  writeFileSync(
    emitter,
    [
      `import { courierExecRequest, execCourier } from ${JSON.stringify(REEXEC)};`,
      "process.stdout.write(`before pid=${String(process.pid)}\\n`);",
      `const tried = execCourier({ request: courierExecRequest({ env: process.env, mainRoot: ${JSON.stringify(main)}, pid: process.pid, reexecAtIso: ${JSON.stringify(AT)} }) });`,
      'process.stdout.write(`not replaced: ${tried.isErr() ? tried.error.message : "?"}\\n`);',
      "",
    ].join("\n"),
  );
  return { emitter, main };
}

describe("execCourier over a real exec", () => {
  it("becomes main's launcher in place: same pid as the one it stamped, same pipe, forced to main, everything else kept", () => {
    const { emitter, main } = fixture();
    const env: NodeJS.ProcessEnv = { ...process.env, KEPT: "cmux-ws-1", SLOPWEAVER_CLI_DIR: "/some/worktree" };
    delete env["NODE_OPTIONS"];
    const child = spawnSync(process.execPath, ["--import", TSX_LOADER, emitter], {
      cwd: repoRoot,
      env,
      killSignal: "SIGKILL",
      timeout: DEADLINE_MS,
    });
    expect(child.error).toBe(undefined);
    expect(child.status).toBe(0);
    const lines = child.stdout.toString("utf8").trimEnd().split("\n");
    expect(lines.length).toBe(2);
    const pid = /^before pid=(\d+)$/u.exec(lines[0]!)![1]!;
    expect(lines[1]).toBe(
      `after pid=${pid} cwd=${realpathSync(main)} cli=${main} at=${AT} stamped=${pid} kept=cmux-ws-1 argv=talk courier --follow`,
    );
  });
});

const LAUNCHER = join(repoRoot, "bin", "slopweaver");
const MARKER = "SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER";

/** What the last generation prints once, then holds: who it is, under whom, and whether the marker reached it. */
interface Ready {
  readonly generation: number;
  readonly pid: number;
  readonly ppid: number;
  readonly marker: string | null;
}

/**
 * A main checkout under a name a hand-built `file://` URL would break on, carrying the REAL launcher (a symlink, which
 * the launcher walks back to this repository's hooks) and this repository's own dependencies.
 *
 * @returns the tree's root
 */
function realLauncherMain(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-courier-tier-"));
  fixtureDirs.push(dir);
  const main = join(dir, "main 100% #1");
  mkdirSync(join(main, "bin"), { recursive: true });
  symlinkSync(LAUNCHER, join(main, "bin", "slopweaver"));
  symlinkSync(join(repoRoot, "node_modules"), join(main, "node_modules"));
  writeLauncherManifest({ dir: main });
  mkdirSync(join(main, "config"), { recursive: true });
  return main;
}

/** The environment the launcher boots under: this tree forced, no ambient heap or cmux options, quiet. */
function launchEnv({ main }: { main: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...launcherNodeEnv(),
    PLUGIN_DATA: join(main, "..", "plugin-data"),
    SLOPWEAVER_CLI_DIR: main,
    SLOPWEAVER_LAUNCHER_QUIET: "1",
    XDG_CONFIG_HOME: join(main, "config"),
  };
  delete env["NODE_OPTIONS"];
  delete env["CMUX_ORIGINAL_NODE_OPTIONS"];
  delete env["CMUX_ORIGINAL_NODE_OPTIONS_PRESENT"];
  delete env[MARKER];
  return env;
}

/** Resolve with the first stdout line parsed, or reject when the process ends or the deadline passes first. */
function firstLine({ child }: { child: ReturnType<typeof spawn> }): Promise<Ready> {
  return new Promise((resolveLine, reject) => {
    let buffered = "";
    let stderr = "";
    const timer = setTimeout(
      () => reject(new Error(`no ready line in ${String(DEADLINE_MS)}ms: ${stderr}`)),
      DEADLINE_MS,
    );
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout!.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const end = buffered.indexOf("\n");
      if (end !== -1) {
        clearTimeout(timer);
        resolveLine(JSON.parse(buffered.slice(0, end)) as Ready);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`exited ${String(code)} before a ready line: ${buffered}${stderr}`));
    });
  });
}

/**
 * The live children of `parent`, from one `ps` snapshot. Children, not descendants: the courier's own children (tsx's
 * esbuild service among them) are not the chain, and a leaked wrapper is always the boot wrapper's direct child.
 */
function childrenOf({ parent }: { parent: number }): readonly number[] {
  const table = spawnSync("ps", ["-ax", "-o", "pid=,ppid="], { encoding: "utf8" }).stdout;
  return table
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .filter(([, ppid]) => ppid === parent)
    .map(([pid]) => pid!);
}

describe("the courier re-exec through the real launcher and tsx", () => {
  it("keeps one wrapper over one child after two re-execs, and the launcher consumes its marker", async () => {
    const main = realLauncherMain();
    mkdirSync(join(main, "src", "cli"), { recursive: true });
    writeFileSync(
      join(main, "src", "cli", "index.ts"),
      [
        `import { courierExecRequest, execCourier } from ${JSON.stringify(REEXEC)};`,
        'const generation = Number(process.env["FIXTURE_GENERATION"]);',
        "if (generation < 2) {",
        '  process.env["FIXTURE_GENERATION"] = String(generation + 1);',
        `  const tried = execCourier({ request: courierExecRequest({ env: process.env, mainRoot: ${JSON.stringify(main)}, pid: process.pid, reexecAtIso: ${JSON.stringify(AT)} }) });`,
        '  process.stderr.write(`not replaced: ${tried.isErr() ? tried.error.message : "?"}\\n`);',
        "  process.exit(1);",
        "}",
        `const marker = process.env[${JSON.stringify(MARKER)}];`,
        "process.stdout.write(`${JSON.stringify({ generation, marker: marker === undefined ? null : marker, pid: process.pid, ppid: process.ppid })}\\n`);",
        "setInterval(() => undefined, 1000);",
        "",
      ].join("\n"),
    );
    const child = spawn(join(main, "bin", "slopweaver"), ["talk", "courier", "--follow"], {
      cwd: main,
      detached: true,
      env: { ...launchEnv({ main }), FIXTURE_GENERATION: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const wrapper = child.pid!;
    try {
      const ready = await firstLine({ child });
      expect(ready).toEqual({ generation: 2, marker: null, pid: ready.pid, ppid: wrapper });
      expect(childrenOf({ parent: wrapper })).toEqual([ready.pid]);
    } finally {
      process.kill(-wrapper, "SIGKILL");
    }
  });

  it("runs a built CLI as plain node with the marker already gone", () => {
    const main = realLauncherMain();
    mkdirSync(join(main, "dist-cli", "cli"), { recursive: true });
    writeFileSync(join(main, "dist-cli", ".slopweaver-build.json"), "{}\n");
    writeFileSync(
      join(main, "dist-cli", "cli", "index.js"),
      `process.stdout.write(\`built marker=\${String(process.env[${JSON.stringify(MARKER)}])} argv=\${process.argv.slice(2).join(" ")}\\n\`);\n`,
    );
    const ran = spawnSync(join(main, "bin", "slopweaver"), ["talk", "courier", "--follow"], {
      cwd: main,
      encoding: "utf8",
      env: { ...launchEnv({ main }), [MARKER]: "1" },
      killSignal: "SIGKILL",
      timeout: DEADLINE_MS,
    });
    expect(ran.stdout).toBe("built marker=undefined argv=talk courier --follow\n");
    expect(ran.status).toBe(0);
  });
});
