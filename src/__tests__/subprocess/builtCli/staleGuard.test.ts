/**
 * The staleness guard end to end, against a REAL emit of this repository and the artifact it produced.
 *
 * ## Why this is a subprocess test and not another unit case
 *
 * `unit/builtCli/guard.test.ts` proves `guardBuiltTree` judges a two-file checkout correctly. It cannot prove
 * that the SHIPPED built CLI reaches that judgement: the guard is called from `runCliProcess`, it locates
 * the manifest by arithmetic on `import.meta.url` in the EMITTED tree rather than the source one, and the
 * refusal has to happen before any verb dispatch. Every one of those three is where the wiring could be
 * absent while the judgement is perfect. So this emits the real thing and runs it.
 *
 * ## The falsifiable half
 *
 * Asserting that a fresh build answers proves nothing on its own — a guard that never ran would pass it. So
 * the same artifact is re-run with ONE stamp in its manifest changed, and what the guard does instead is asserted by
 * name: the one stderr line of a restart on the checkout's source, with stdout byte-identical to the fresh run's, and
 * the refusal for a verb that needs the built tree itself.
 * The manifest rather than the source is what moves, because mutating this checkout's own `src/` mid-test
 * would leave a different test's file wrong if this one threw before restoring it.
 *
 * ## Why the emit lands inside the checkout rather than in the temp sandbox
 *
 * The emitted tree is transpile-only, so its bare imports are resolved by node walking UP from the
 * importing file to a `node_modules`. Only the checkout has one, so a build under `TMPDIR` emits
 * thousands of files that cannot run — `dev build` now refuses that outright, and this test would be
 * asserting on the refusal rather than the guard. `/.cache/` is gitignored at the repo root, so the
 * emit leaves the working tree clean, and `afterAll` removes it.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WAITING_LINE } from "../../../builtCli/invocationGuard.js";
import { BUILT_ENTRYPOINT } from "../../../builtCli/layout.js";
import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";
import { JUDGEMENT_NOTE } from "../../../hatch/render.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

let outDir = "";

/** The throwaway state home every spawn writes into, so nothing reaches the operator's own. */
let home = "";

/**
 * Run the built entrypoint, returning what an operator would see.
 *
 * The state home is passed through the ENVIRONMENT rather than a flag, because `catalog` refuses
 * `--home` by design. It is passed at all because the CLI writes a stale-seat notice on its way past the
 * guard, and the ambient-home guard fails any test that lets one reach the operator's own home.
 */
function runBuilt({ env, words = ["catalog"] }: { env: Readonly<Record<string, string>>; words?: readonly string[] }): {
  status: number;
  stdout: string;
  stderr: string;
  text: string;
} {
  const run = spawnSync(process.execPath, [join(outDir, BUILT_ENTRYPOINT), ...words], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, SLOPWEAVER_HOME: home, ...env },
  });
  const streams = { stderr: run.stderr, stdout: run.stdout, text: `${run.stdout}${run.stderr}` };
  if (run.status === null) {
    return { status: -1, ...streams };
  }
  return { status: run.status, ...streams };
}

/** The size the emit recorded for one source file — what the staleness sentence quotes back. */
function recordedSize({ path }: { path: string }): number {
  const record = JSON.parse(pristineManifest) as { stamps: { path: string; size: number }[] };
  return record.stamps.find((stamp) => stamp.path === path)!.size;
}

/** The manifest as the emit wrote it, kept so each case can put it back. */
let pristineManifest = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "built-cli-home-"));
  const cache = join(repoRoot, ".cache");
  mkdirSync(cache, { recursive: true });
  outDir = mkdtempSync(join(cache, "built-cli-"));
  execFileSync(join(repoRoot, "bin/slopweaver"), ["dev", "build", "--out", outDir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  pristineManifest = readFileSync(join(outDir, BUILD_MANIFEST_FILE), "utf8");
}, 180_000);

afterAll(() => {
  rmSync(home, { force: true, recursive: true });
  rmSync(outDir, { force: true, recursive: true });
});

/** Rewrite the manifest so exactly one file's recorded size is wrong, as an edit to it would leave it. */
function stale({ path }: { path: string }): void {
  const manifest: unknown = JSON.parse(pristineManifest);
  const record = manifest as { stamps: { path: string; size: number }[] };
  const target = record.stamps.find((stamp) => stamp.path === path)!;
  target.size = target.size + 1;
  writeFileSync(join(outDir, BUILD_MANIFEST_FILE), JSON.stringify(record));
}

describe("the built CLI's staleness guard", () => {
  it("answers when the build matches the source it was emitted from", () => {
    writeFileSync(join(outDir, BUILD_MANIFEST_FILE), pristineManifest);

    const run = runBuilt({ env: {} });

    expect(run.status).toBe(0);
    expect(run.text).toContain("commands across");
  });

  it("restarts on the checkout's source once it no longer matches: one stderr line, stdout byte-identical", () => {
    writeFileSync(join(outDir, BUILD_MANIFEST_FILE), pristineManifest);
    const fresh = runBuilt({ env: {} });
    stale({ path: "src/cli/main.ts" });
    const size = recordedSize({ path: "src/cli/main.ts" });

    const run = runBuilt({ env: {} });

    expect(fresh.status).toBe(0);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("commands across");
    expect(run.stdout).toBe(fresh.stdout);
    expect(run.stdout).not.toContain("[stale-build]");
    // Everything the stale run printed on stderr beyond what the fresh run printed is the one fallback line, first.
    expect(run.stderr).toBe(
      `slopweaver: [stale-build] ${repoRoot}: the build is behind (src/cli/main.ts is ${String(size)} bytes, ${String(size + 1)} at build time); running this checkout's source; \`slopweaver dev build\` restores the fast path.\n${fresh.stderr}`,
    );
  });

  it("still REFUSES, exits 1 and names the file for a verb that needs the built tree itself", () => {
    stale({ path: "src/cli/main.ts" });
    const size = recordedSize({ path: "src/cli/main.ts" });

    const run = runBuilt({ env: {}, words: ["desktop", "e2e", "--help"] });

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr.split("\n")).toEqual([
      `slopweaver <any verb> blocked because the built CLI in this checkout no longer describes the source beside it, so a verdict it gives is about code nobody is editing (src/cli/main.ts is ${String(size)} bytes, ${String(size + 1)} at build time — rebuild with \`slopweaver dev build\`).`,
      "Legitimate exceptions may include reproducing a defect that only the older build shows, deliberately and knowing the source has moved; the source tree is mid-rebase and the built CLI is the only working copy of the verb being run.",
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_STALE_BUILD=1 slopweaver <any verb>.",
      JUDGEMENT_NOTE,
      "",
    ]);
  });

  // The incident: a pull left main's build stale, the console's organisation read refused, and every
  // console page drew "Organisation required". A console child now waits for the rebuild and restarts on it.
  it("waits as a console child, then answers from a restart once the rebuild lands", async () => {
    stale({ path: "src/cli/main.ts" });
    const child = spawn(process.execPath, [join(outDir, BUILT_ENTRYPOINT), "catalog"], {
      cwd: repoRoot,
      env: { ...process.env, SLOPWEAVER_CONSOLE_CHILD: "1", SLOPWEAVER_HOME: home },
    });
    let text = "";
    let rebuilt = false;
    // The rebuild finishing, as the post-merge hook's `dev build` writes its manifest LAST — landed the moment the
    // child says it is waiting, never on a timer. A fixed delay raced the child's own start-up: on a loaded machine
    // the child read the manifest AFTER the timer had already restored it, ran without waiting, and this failed.
    const onData = (chunk: string): void => {
      text += chunk;
      if (!rebuilt && text.includes(WAITING_LINE)) {
        rebuilt = true;
        writeFileSync(join(outDir, BUILD_MANIFEST_FILE), pristineManifest);
      }
    };
    child.stdout.setEncoding("utf8").on("data", onData);
    child.stderr.setEncoding("utf8").on("data", onData);
    const closed = new Promise<number | null>((resolveClose) => {
      child.on("close", (code) => {
        resolveClose(code);
      });
    });

    const code = await closed;

    expect(code).toBe(0);
    expect(text).toContain(WAITING_LINE);
    expect(text).toContain("[stale-build] a rebuild landed ");
    expect(text).toContain("restarting on the fresh build");
    expect(text).toContain("commands across");
  }, 60_000);

  it("runs under the hatch, and says which tree the answer came from", () => {
    stale({ path: "src/cli/main.ts" });

    const run = runBuilt({ env: { SLOPWEAVER_ALLOW_STALE_BUILD: "1" } });

    expect(run.status).toBe(0);
    expect(run.text).toContain("[stale-build] override in force");
    expect(run.text).toContain(`this answer comes from ${outDir}`);
    expect(run.text).toContain("commands across");
  });
});
