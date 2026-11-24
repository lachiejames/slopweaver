/**
 * The prebuilt `PreToolUse` bundle generation, as Claude Code reaches it: the shipped shim, a plugin root that
 * carries the real launcher, builder and manifest modules, and a STUB gate that says which route ran it and
 * with which arguments. A pass is falsifiable because the two routes print different words: `bundled` only
 * when the stub's own URL sits under `.hook-build/`, `live` only under `tsx`.
 *
 * What this holds down is the incident's shape: every seat ran `tsx` over the live TypeScript on every Bash
 * call, because the shim built a bundle for a marketplace install only, and under a lap's load that boot alone
 * outlived the 15-second verdict budget (`src/admit/hookBundleBuild.ts` carries the measurements).
 */
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { FAILURE_MARKER, HOOK_BUILD_DIR } from "../../../admit/hookBundleBuild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHIM = join(repoRoot, "scripts", "pretooluse.sh");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CASE_TIMEOUT_MS = 90_000;
const GENERATION_WAIT_MS = 60_000;
const PAYLOAD = JSON.stringify({ session_id: "hook-bundle", tool_input: { command: "echo hi" }, tool_name: "Bash" });

/** Each way a generation's manifest is spoiled, as a label and a rewrite of its text. */
const MANIFEST_SPOILERS: readonly (readonly [string, (text: string) => string])[] = [
  ["is not JSON", () => "{"],
  ["is the v1 format", (text) => text.replace("slopweaver-pretooluse-bundle-v2", "slopweaver-pretooluse-bundle-v1")],
];

/** Every real file the bundle path needs in a root, copied so what runs is the shipped code. */
const SHIPPED = [
  "hooks/pretooluseLaunch.ts",
  "hooks/pretooluseBuild.ts",
  "src/admit/hookBundleBuild.ts",
  "src/admit/hookBundleErrors.ts",
  "src/admit/hookBundleManifest.ts",
  "src/lib/parsers.ts",
  "src/lib/result.ts",
  "src/lib/writeAtomic.ts",
  "package.json",
] as const;

/**
 * The stub gate: which route ran it, the arguments it got, and the gate's own refusing exit — that exit read
 * through a LAZY import of a module the launcher also imports, so the build has a shared chunk and the gate
 * loads it after it has started, as the real gate's dynamic imports do.
 */
const STUB_ENTRY = [
  `const { ok } = await import("../src/lib/result.js");`,
  `const route = import.meta.url.includes("/.hook-build/") ? "bundled" : "live";`,
  `process.stderr.write(route + " " + process.argv.slice(2).join(",") + "\\n");`,
  "process.exit(ok(2).value);",
  "",
].join("\n");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, by its physical path, removed after the test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

/**
 * A plugin root carrying the shipped bundle path and the stub gate, its deps linked from this checkout.
 *
 * @param entry the source written to `hooks/pretooluse.ts`
 * @returns the root's path
 */
function makeRoot({ entry = STUB_ENTRY }: { entry?: string } = {}): string {
  const root = tempDir({ prefix: "sw-hook-bundle-" });
  for (const file of SHIPPED) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(repoRoot, file), join(root, file));
  }
  writeFileSync(join(root, "hooks", "pretooluse.ts"), entry);
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"));
  return root;
}

/**
 * Run the shipped shim as Claude Code invokes it, against `root`, with no plugin install recorded.
 *
 * @param args forwarded to the shim, as a compatibility shim's `--only <id>` is
 * @param budgetSeconds the verdict budget, shortened for a case that drives it to the end
 * @returns the exit status and stderr
 */
function runShim({
  root,
  args = [],
  budgetSeconds = 15,
}: {
  root: string;
  args?: readonly string[];
  budgetSeconds?: number;
}): {
  status: number | null;
  stderr: string;
} {
  const run = spawnSync(SHIM, [...args], {
    encoding: "utf8",
    env: {
      CLAUDE_CONFIG_DIR: tempDir({ prefix: "sw-hook-bundle-config-" }),
      CLAUDE_PLUGIN_ROOT: root,
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: tempDir({ prefix: "sw-hook-bundle-home-" }),
      SLOPWEAVER_HOOK_BUDGET_SECONDS: String(budgetSeconds),
    },
    input: PAYLOAD,
    timeout: CASE_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr };
}

/**
 * Build a generation of `root` in the foreground, exactly as the shim's background launch does.
 *
 * @returns the builder's exit status and stderr
 */
function buildNow({ root }: { root: string }): { status: number | null; stderr: string } {
  const run = spawnSync(TSX, [join(root, "hooks", "pretooluseBuild.ts"), root], {
    cwd: root,
    encoding: "utf8",
    timeout: CASE_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr };
}

/** The generation `current` names, or the empty string when there is none. */
function currentGeneration({ root }: { root: string }): string {
  const current = join(root, HOOK_BUILD_DIR, "current");
  return existsSync(current) ? readFileSync(current, "utf8").trim() : "";
}

/**
 * Wait for `current` to name a generation other than `previous` — the shim's background builder publishing.
 *
 * @returns the new generation's name
 */
async function nextGeneration({ root, previous }: { root: string; previous: string }): Promise<string> {
  const deadline = Date.now() + GENERATION_WAIT_MS;
  while (Date.now() < deadline) {
    const now = currentGeneration({ root });
    if (now !== "" && now !== previous) {
      return now;
    }
    await new Promise((settle) => setTimeout(settle, 100));
  }
  throw new Error(`no generation replaced "${previous}" in ${String(GENERATION_WAIT_MS)}ms`);
}

/**
 * Rewrite a file to the same length, then put its mtime back: only the ctime says it changed.
 */
function sameSizeWrite({ path, text }: { path: string; text: string }): void {
  const before = statSync(path);
  expect(text.length).toBe(readFileSync(path, "utf8").length);
  writeFileSync(path, text);
  utimesSync(path, before.atime, before.mtime);
}

describe("the prebuilt PreToolUse generation", { timeout: CASE_TIMEOUT_MS }, () => {
  it("runs the live source on the first call and builds a generation beside it, which the next call runs", async () => {
    const root = makeRoot();
    expect(runShim({ root })).toEqual({ status: 2, stderr: "live \n" });
    await nextGeneration({ previous: "", root });
    expect(runShim({ root })).toEqual({ status: 2, stderr: "bundled \n" });
  });

  it("forwards `--only` to the generation's gate, as it does to tsx", () => {
    const root = makeRoot();
    expect(buildNow({ root }).status).toBe(0);
    expect(runShim({ args: ["--only", "raw-bash-gate"], root })).toEqual({
      status: 2,
      stderr: "bundled --only,raw-bash-gate\n",
    });
  });

  it("splits the build: the gate and its launcher are separate entries over a shared chunk directory", () => {
    const root = makeRoot();
    expect(buildNow({ root }).status).toBe(0);
    const generation = join(root, HOOK_BUILD_DIR, currentGeneration({ root }));
    expect(["entry.mjs", "launch.mjs", "manifest.json"].map((name) => existsSync(join(generation, name)))).toEqual([
      true,
      true,
      true,
    ]);
    expect(readdirSync(join(generation, "chunks")).length).toBeGreaterThan(0);
  });

  it("runs the live source, never the old build, after a same-size write that put the mtime back", async () => {
    const root = makeRoot();
    expect(buildNow({ root }).status).toBe(0);
    const built = currentGeneration({ root });
    // The edit flips the verdict from refuse to allow, one byte for one: both are codes the real gate exits.
    sameSizeWrite({ path: join(root, "hooks", "pretooluse.ts"), text: STUB_ENTRY.replace("ok(2)", "ok(0)") });
    expect(runShim({ root })).toEqual({ status: 0, stderr: "live \n" });
    // …and the miss rebuilt it, so the edit is what the bundled route now answers with.
    await nextGeneration({ previous: built, root });
    expect(runShim({ root })).toEqual({ status: 0, stderr: "bundled \n" });
  });

  it("treats a `current` that names no generation as a miss, never a path handed to node", async () => {
    const root = makeRoot();
    mkdirSync(join(root, HOOK_BUILD_DIR));
    writeFileSync(join(root, HOOK_BUILD_DIR, "current"), "../../hooks\n");
    expect(runShim({ root })).toEqual({ status: 2, stderr: "live \n" });
    // The miss's builder replaces the foreign line; waiting for it keeps it from outliving this case's root.
    await nextGeneration({ previous: "../../hooks", root });
  });

  it("publishes a whole generation when two builders race, one of them or both", async () => {
    const root = makeRoot();
    const race = await Promise.all(
      [0, 1].map(
        () =>
          new Promise<number | null>((settle) => {
            spawn(TSX, [join(root, "hooks", "pretooluseBuild.ts"), root], { cwd: root, stdio: "ignore" }).on(
              "exit",
              settle,
            );
          }),
      ),
    );
    expect(race).toEqual([0, 0]);
    expect(currentGeneration({ root })).toMatch(/^generation-[0-9]+-[0-9a-f]+$/);
    expect(runShim({ root })).toEqual({ status: 2, stderr: "bundled \n" });
  });

  it("runs the live source when the generation's gate cannot load, rather than exiting 1 with no block", async () => {
    const root = makeRoot();
    expect(buildNow({ root }).status).toBe(0);
    const broken = currentGeneration({ root });
    rmSync(join(root, HOOK_BUILD_DIR, broken, "entry.mjs"));
    expect(runShim({ root })).toEqual({ status: 2, stderr: "live \n" });
    // The miss launched a rebuild; waiting for it keeps it from outliving this case's root.
    await nextGeneration({ previous: broken, root });
  });

  it("runs the live source when the generation's entry was truncated, which would import cleanly and run no gate", async () => {
    const root = makeRoot();
    expect(buildNow({ root }).status).toBe(0);
    const truncated = currentGeneration({ root });
    writeFileSync(join(root, HOOK_BUILD_DIR, truncated, "entry.mjs"), "");
    expect(runShim({ root })).toEqual({ status: 2, stderr: "live \n" });
    // The miss launched a rebuild; waiting for it keeps it from outliving this case's root.
    await nextGeneration({ previous: truncated, root });
  });

  it("runs the live source when a chunk the launcher links is gone, rather than exiting 1 with no block", async () => {
    const root = makeRoot();
    expect(buildNow({ root }).status).toBe(0);
    const broken = currentGeneration({ root });
    const launcher = readFileSync(join(root, HOOK_BUILD_DIR, broken, "launch.mjs"), "utf8");
    const linked = /from "\.\/(chunks\/[^"]+\.mjs)"/.exec(launcher)![1]!;
    rmSync(join(root, HOOK_BUILD_DIR, broken, linked));
    const { status, stderr } = runShim({ root });
    expect(status).toBe(2);
    // node's own link error comes first, then the live gate's answer: the crash is shown, never taken as a verdict.
    expect(stderr).toContain(`Cannot find module '${join(root, HOOK_BUILD_DIR, broken, linked)}'`);
    expect(stderr.endsWith("\nlive \n")).toBe(true);
    // The miss launched a rebuild; waiting for it keeps it from outliving this case's root.
    await nextGeneration({ previous: broken, root });
  });

  it("runs the live source when the generation's process is killed by a signal that was not the budget's", async () => {
    // Dies by SIGKILL only on the generation route, so the live route's verdict is the falsifiable witness.
    const root = makeRoot({
      entry: STUB_ENTRY.replace(
        "process.stderr.write(",
        `if (route === "bundled") process.kill(process.pid, "SIGKILL");\nprocess.stderr.write(`,
      ),
    });
    expect(buildNow({ root }).status).toBe(0);
    const killed = currentGeneration({ root });
    expect(runShim({ root })).toEqual({ status: 2, stderr: "live \n" });
    // A fallen-through call launches a builder too; it publishes a generation identical in behaviour.
    await nextGeneration({ previous: killed, root });
  });

  it("refuses a call whose generation outlives the budget, and never re-runs it on tsx with nothing left", () => {
    // Hangs only on the generation route, so a `live` line would mean the timeout fell through.
    const root = makeRoot({
      entry: STUB_ENTRY.replace(
        "process.stderr.write(",
        `if (route === "bundled") await new Promise(() => setInterval(() => {}, 1000));\nprocess.stderr.write(`,
      ),
    });
    expect(buildNow({ root }).status).toBe(0);
    const { status, stderr } = runShim({ budgetSeconds: 2, root });
    expect(status).toBe(2);
    expect(stderr).toMatch(
      /^pretooluse: killed after [12]s without a verdict, so the tool call is refused rather than run past its gates — this hook reached no decision; run it again\n$/,
    );
  });

  it.each(MANIFEST_SPOILERS)("runs the live source when the generation's manifest %s", async (_label, rewrite) => {
    const root = makeRoot();
    expect(buildNow({ root }).status).toBe(0);
    const spoiled = currentGeneration({ root });
    const manifest = join(root, HOOK_BUILD_DIR, spoiled, "manifest.json");
    const rewritten = rewrite(readFileSync(manifest, "utf8"));
    expect(rewritten).not.toBe(readFileSync(manifest, "utf8"));
    writeFileSync(manifest, rewritten);
    expect(runShim({ root })).toEqual({ status: 2, stderr: "live \n" });
    // The miss launched a rebuild; waiting for it keeps it from outliving this case's root.
    await nextGeneration({ previous: spoiled, root });
  });

  it("keeps a generation it just replaced, however long ago that one was built, for a gate still reading it", () => {
    const root = makeRoot();
    expect(buildNow({ root }).status).toBe(0);
    const first = currentGeneration({ root });
    const anHourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(join(root, HOOK_BUILD_DIR, first), anHourAgo, anHourAgo);
    sameSizeWrite({ path: join(root, "hooks", "pretooluse.ts"), text: STUB_ENTRY.replace("ok(2)", "ok(4)") });
    expect(buildNow({ root }).status).toBe(0);
    expect(currentGeneration({ root })).not.toBe(first);
    expect(existsSync(join(root, HOOK_BUILD_DIR, first, "entry.mjs"))).toBe(true);
  });

  it("records a tree that cannot build, so the shim paces its rebuilds rather than launching one per call", () => {
    const root = makeRoot({ entry: `import { gone } from "../src/lib/gone.js";\nvoid gone;\n` });
    const { status, stderr } = buildNow({ root });
    expect(status).toBe(1);
    expect(stderr).toContain("esbuild could not build the hook bundle");
    expect(readFileSync(join(root, HOOK_BUILD_DIR, FAILURE_MARKER), "utf8")).toContain(
      "esbuild could not build the hook bundle",
    );
    expect(currentGeneration({ root })).toBe("");
  });
});
