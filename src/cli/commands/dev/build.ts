/**
 * `slopweaver dev build` — emit the CLI to JavaScript, then prove the emitted entrypoint runs.
 *
 * Effectful shell only: the source walk, the esbuild spawn, the manifest write and the smoke run. The argv,
 * the manifest re-rooting and the verdict are pure and live in {@link ./buildCore}, which also carries the
 * measurement that moved this off `tsc`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseJsonObject } from "#lib/jsonParse.js";
import { type Logger, logger } from "#lib/logger.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { BUILT_ENTRYPOINT } from "../../../builtCli/layout.js";
import { scanSourceStamps, sourceFiles } from "../../../builtCli/sourceScan.js";
import { clearStamp, stampBuild } from "../../../builtCli/stamp.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  type BuildReport,
  buildIsFit,
  builtManifest,
  DEV_BUILD_USAGE,
  esbuildArgsFor,
  outsideRoot,
  parseDevBuildArgs,
  renderBuild,
  SMOKE_VERB,
} from "./buildCore.js";

/**
 * The one line that says what the smoke run did.
 *
 * A failing run prints nothing to stdout, so a stdout-first read of a FAILURE reports an empty string — the
 * one shape a report must never take, because it says a run failed and refuses to say how. Measured: an emit
 * outside the checkout died on `Cannot find package 'neverthrow'` and the verb printed
 * `smoke run of cli/index.js exited 1 — `.
 */
function firstLine({ stdout, stderr }: { stdout: string; stderr: string }): string {
  const out = stdout.trim().split("\n")[0];
  if (out !== undefined && out !== "") {
    return out;
  }
  const err = stderr.trim().split("\n")[0];
  if (err === undefined) {
    return "";
  }
  return err;
}

/**
 * A spawn's exit code, with the KILLED case named rather than defaulted.
 *
 * `spawnSync` reports `null` when a signal killed the child, which is a failure carrying no code of its
 * own, so it becomes this repository's own error code rather than being folded into a success.
 *
 * @param status what `spawnSync` reported
 * @returns the exit code to report
 */
function exitOf({ status }: { status: number | null }): number {
  if (status === null) {
    return EXIT_ERROR;
  }
  return status;
}

/** Run one build end to end, returning what it produced so the caller can judge it. */
function emit({ root, outDir }: { root: string; outDir: string }): BuildReport {
  // Scanned BEFORE esbuild reads a byte, and carried to `stampBuild` untouched. A file written during the
  // emit-and-smoke window would otherwise be recorded as built in while the emitted tree still held the
  // module from before it — measured, and the counterexample is in `stamp.ts`'s own header.
  const files = sourceFiles({ root });
  const stamps = scanSourceStamps({ root });
  clearStamp({ outDir });
  const startedAt = performance.now();
  const built = spawnSync(join(root, "node_modules/.bin/esbuild"), esbuildArgsFor({ files, outDir }), {
    cwd: root,
    encoding: "utf8",
  });
  const emitMs = Math.round(performance.now() - startedAt);
  const manifest = parseJsonObject({ text: readFileSync(join(root, "package.json"), "utf8") });
  if (manifest.isOk()) {
    writeFileSync(
      join(outDir, "package.json"),
      `${JSON.stringify(builtManifest({ manifest: manifest.value }), null, 2)}\n`,
    );
  }
  const entrypoint = join(outDir, BUILT_ENTRYPOINT);
  if (!existsSync(entrypoint)) {
    return {
      emitMs,
      emitted: 0,
      outDir,
      smokeExit: EXIT_ERROR,
      smokeLine: `no entrypoint at ${entrypoint} — esbuild exited ${String(built.status)}: ${firstLine({ stderr: built.stderr, stdout: "" })}`,
    };
  }
  // `catalog` rather than `--help`, on both halves of the contract: it exits 0 where a bare `--help` exits
  // EXIT_USAGE by design (so a smoke asserting 0 on it would be asserting a bug), and it folds every noun
  // manifest, which is what proves the emitted tree's module graph resolves rather than just its entrypoint.
  const smoke = spawnSync(process.execPath, [entrypoint, SMOKE_VERB], { cwd: root, encoding: "utf8" });
  const report = {
    emitMs,
    emitted: built.status === 0 ? files.length : 0,
    outDir,
    smokeExit: exitOf({ status: smoke.status }),
    smokeLine: firstLine({ stderr: smoke.stderr, stdout: smoke.stdout }),
  };
  // Stamped LAST, and only on a build that both emitted and ran. The smoke run above therefore happens
  // against an unstamped tree, which is the right order twice over: the guard inside it finds no manifest
  // and stands aside, so what the smoke proves is the module graph rather than the guard's own verdict.
  if (buildIsFit({ report })) {
    stampBuild({ outDir, root, stamps });
  }
  return report;
}

/**
 * Run the build verb over injected dependencies.
 *
 * @param argv the full process argv (the verb tail starts at index 4 — `dev build <tail>`)
 * @returns the process exit code
 */
export async function runDevBuildWithDeps({
  argv,
  log,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
}): Promise<number> {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: DEV_BUILD_USAGE });
    return EXIT_OK;
  }
  const args = parseDevBuildArgs({ rest });
  if (args.isErr()) {
    [...args.error, DEV_BUILD_USAGE].forEach((line) => {
      log.error({ msg: line });
    });
    return EXIT_USAGE;
  }
  // The tree THIS BUILD lives in, by manifest walk — never a git lookup anchored on the module. `dev
  // build` re-emits the checkout whose `bin/slopweaver` was invoked, which is what the hooks ask of it,
  // and the git-anchored family `running-checkout-root` bans would throw outright in an install with no
  // `.git` anywhere above the module.
  const root = installedTreeRoot({ importMetaUrl: import.meta.url });
  // `resolve`, never `join`: `join(root, "/tmp/x")` CONCATENATES, so an absolute --out landed at
  // `<repo>/tmp/x` — measured, it emitted a 4,166-file tree inside the checkout and reported the path it
  // had invented as though the caller had asked for it.
  const outDir = resolve(root, args.value.out);
  const outsideCheckout = outsideRoot({ outDir, root });
  if (outsideCheckout !== undefined) {
    log.error({ msg: outsideCheckout });
    return EXIT_USAGE;
  }
  const report = emit({ outDir, root });
  if (args.value.json) {
    log.out({ line: JSON.stringify(report) });
  } else {
    for (const line of renderBuild({ report })) {
      log.out({ line });
    }
  }
  return buildIsFit({ report }) ? EXIT_OK : EXIT_ERROR;
}

/**
 * Run the build verb.
 *
 * @returns the process exit code — see {@link runDevBuildWithDeps}
 */
export async function runDevBuild(argv: readonly string[]): Promise<number> {
  return runDevBuildWithDeps({ argv, log: logger });
}

export const devBuildCommand = defineCommand({ run: runDevBuild });
