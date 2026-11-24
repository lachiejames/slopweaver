/**
 * Build one immutable `PreToolUse` bundle generation under `<root>/.hook-build/`, and make it current.
 *
 * A generation is an esbuild CODE-SPLIT build of `hooks/pretooluse.ts` (`entry.mjs`) and its launcher
 * (`launch.mjs`), with `manifest.json` stamping every file the build read and every file it wrote. Split, because the gate's full
 * graph (dynamic imports included) is about 2,300 modules and an unsplit bundle inlines all of them: MEASURED
 * at a load of 6–9, node over the unsplit 9.2 MB bundle took 2,317 ms a call, `tsx hooks/pretooluse.ts`
 * 569–598 ms, and node over the split build 259 ms. Repro, median of seven, from a checkout's root:
 *
 *   echo '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"echo hi"}}' >/tmp/p.json
 *   node_modules/.bin/tsx hooks/pretooluseBuild.ts "$PWD"
 *   /usr/bin/time -p node .hook-build/"$(cat .hook-build/current)"/launch.mjs </tmp/p.json
 *
 * THE LAYOUT is what keeps a reader off two builds' chunks at once. A generation is written whole into a
 * `tmp-*` directory, renamed to `generation-<pid>-<nonce>`, its own files stamped there and its manifest
 * written, and only then named in `current` (each written through `writeFileAtomic`, fsynced and renamed). A launcher reads `current` once and loads only files under the directory it
 * names, so a later publish cannot reach a call already running. Nothing on the hot path deletes anything:
 * this builder sweeps a generation only once it has been RETIRED from `current` for longer than
 * {@link GENERATION_KEEP_MS}, far past any hook's 30-second ceiling, because a running gate imports chunks
 * lazily.
 *
 * THE LOCK (`build.lock/`, a `mkdir`) keeps a burst of misses from starting a burst of builds; it is an
 * economy, not the safety. Two builds that both get past it each publish a whole generation and the last
 * rename of `current` wins, which is still a whole one. A lock older than {@link LOCK_STALE_MS} is taken back
 * by rename, so a builder killed mid-build strands nothing for long.
 *
 * The shim never waits for this: a miss runs `tsx` exactly as before and launches this builder in the
 * background (`scripts/pretooluse.sh`), so no build ever spends a verdict's budget.
 */

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { build } from "esbuild";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type HookBundleError, HookBundleErrors } from "./hookBundleErrors.js";
import {
  firstInputChangedSince,
  type HookBundleInputStamp,
  hookBundleInputPaths,
  hookBundleInputStamp,
  hookBundleManifest,
} from "./hookBundleManifest.js";

/** Where every generation of a root lives, inside that root (gitignored). */
export const HOOK_BUILD_DIR = ".hook-build";

/** A build lock older than this was left by a builder that died, and is taken back. */
const LOCK_STALE_MS = 120_000;

/** A generation that is not current is kept this long after it was retired, for a gate still reading it. */
const GENERATION_KEEP_MS = 600_000;

/**
 * Written when a build of this tree FAILED, with the reason; the shim launches no builder while it is younger
 * than two minutes, so a tree that cannot build is retried at that pace rather than on every tool call.
 */
export const FAILURE_MARKER = "build.failed";

/** Files that steer resolution without being imported, stamped whenever the root carries them. */
const RESOLUTION_FILES = ["package.json", "yarn.lock", "tsconfig.json"] as const;

/** What one builder run did. */
type HookBundleBuildOutcome = { readonly kind: "published"; readonly generation: string } | { readonly kind: "busy" };

/**
 * Take the build lock, reclaiming one a dead builder left.
 *
 * @returns true when this process now holds it
 */
function takeLock({ lock, nowMs }: { lock: string; nowMs: number }): boolean {
  try {
    mkdirSync(lock);
    return true;
  } catch {
    // Held, or unwritable: only a held lock that is old enough is taken back.
  }
  let ageMs: number;
  try {
    ageMs = nowMs - statSync(lock).mtimeMs;
  } catch {
    return false;
  }
  if (ageMs < LOCK_STALE_MS) {
    return false;
  }
  const aside = `${lock}.stale-${String(process.pid)}`;
  try {
    renameSync(lock, aside);
    rmSync(aside, { force: true, recursive: true });
    mkdirSync(lock);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stamp every input, failing on the first that cannot be statted.
 *
 * @returns the stamps in path order, or the input that could not be read
 */
function stampInputs({
  root,
  paths,
}: {
  root: string;
  paths: readonly string[];
}): Result<readonly HookBundleInputStamp[], HookBundleError> {
  const stamps: HookBundleInputStamp[] = [];
  for (const path of paths) {
    try {
      stamps.push(hookBundleInputStamp({ path, stats: statSync(join(root, path), { bigint: true }) }));
    } catch (cause) {
      return err(HookBundleErrors.writeFailed({ cause, path }));
    }
  }
  return ok(stamps);
}

/**
 * Every file the build wrote into `generation`, root-relative and sorted — the launcher, the gate's entry and
 * every chunk — so a truncated or rewritten one is a miss rather than a gate that never ran.
 *
 * @returns the paths, or why the directory could not be listed
 */
function outputPaths({ root, generation }: { root: string; generation: string }): Result<string[], HookBundleError> {
  const dir = join(HOOK_BUILD_DIR, generation);
  try {
    return ok(
      readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)))
        .toSorted(),
    );
  } catch (cause) {
    return err(HookBundleErrors.writeFailed({ cause, path: dir }));
  }
}

/**
 * Stamp the generation about to stop being current with the present instant, so the sweep ages it from its
 * RETIREMENT rather than its creation. Without this a generation current for longer than
 * {@link GENERATION_KEEP_MS} would be swept the moment it was replaced, under a gate that started on it a second
 * earlier and still imports its chunks lazily — a crash there exits 1, which the harness reads as no block.
 * Stamped BEFORE `current` moves, so no reader can pick it up after its clock started. Best effort: nothing
 * current, or a name that is not a generation, has nothing to retire.
 */
function retireCurrent({ buildDir, current }: { buildDir: string; current: string }): void {
  let name: string;
  try {
    name = readFileSync(current, "utf8").trim();
  } catch {
    return;
  }
  if (!/^generation-[0-9]+-[0-9a-f]+$/.test(name)) {
    return;
  }
  const now = new Date();
  try {
    utimesSync(join(buildDir, name), now, now);
  } catch {
    // Already swept by another builder, which only does that once it has been retired long enough.
  }
}

/**
 * Remove generations and abandoned temp builds older than {@link GENERATION_KEEP_MS}, never the current one.
 * A generation's age is from its retirement ({@link retireCurrent}), never from its build.
 * Best effort: a sweep that fails leaves disk, never a wrong verdict.
 */
function sweepOldGenerations({ buildDir, keep, nowMs }: { buildDir: string; keep: string; nowMs: number }): void {
  let names: string[];
  try {
    names = readdirSync(buildDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === keep || !(name.startsWith("generation-") || name.startsWith("tmp-"))) {
      continue;
    }
    try {
      if (nowMs - statSync(join(buildDir, name)).mtimeMs > GENERATION_KEEP_MS) {
        rmSync(join(buildDir, name), { force: true, recursive: true });
      }
    } catch {
      // Already gone, or another builder's sweep took it.
    }
  }
}

/**
 * Compile the gate and its launcher, code-split, into `outdir`.
 *
 * @param outdir the not-yet-published directory esbuild writes into
 * @returns esbuild's metafile, of unknown shape until `hookBundleInputPaths` reads it, or why the build failed
 */
async function compileGeneration({
  root,
  outdir,
}: {
  root: string;
  outdir: string;
}): Promise<Result<unknown, HookBundleError>> {
  try {
    const result = await build({
      absWorkingDir: root,
      bundle: true,
      chunkNames: "chunks/[name]-[hash]",
      entryNames: "[name]",
      entryPoints: { entry: "hooks/pretooluse.ts", launch: "hooks/pretooluseLaunch.ts" },
      format: "esm",
      logLevel: "silent",
      metafile: true,
      outExtension: { ".js": ".mjs" },
      outdir,
      packages: "external",
      platform: "node",
      splitting: true,
      target: "node24",
    });
    return ok(result.metafile);
  } catch (cause) {
    return err(HookBundleErrors.buildFailed({ cause }));
  }
}

/**
 * Build, stamp and publish one generation while the lock is held.
 *
 * @param startedCtimeNs the build's start instant on the filesystem's clock
 * @returns the generation's directory name, or why it was not published
 */
async function publishGeneration({
  root,
  buildDir,
  startedCtimeNs,
}: {
  root: string;
  buildDir: string;
  startedCtimeNs: string;
}): Promise<Result<string, HookBundleError>> {
  const id = `${String(process.pid)}-${randomBytes(4).toString("hex")}`;
  const unpublishedDir = join(buildDir, `tmp-${id}`);
  const generation = `generation-${id}`;
  const generationDir = join(buildDir, generation);
  const extra = RESOLUTION_FILES.filter((file) => existsSync(join(root, file)));
  const published = (await compileGeneration({ outdir: unpublishedDir, root }))
    .andThen((metafile) => hookBundleInputPaths({ extra, metafile }))
    .andThen((paths) => stampInputs({ paths, root }))
    .andThen((inputs) => {
      const changed = firstInputChangedSince({ inputs, sinceCtimeNs: startedCtimeNs });
      return changed === undefined ? ok(inputs) : err(HookBundleErrors.inputsUnstable({ path: changed }));
    })
    .andThen((inputs) => {
      // A directory move, renamed BEFORE its own files are stamped, so each output is stamped at the path the
      // launcher stats; a generation is invisible until `current` names it, so it is never read in between.
      try {
        renameSync(unpublishedDir, generationDir);
      } catch (cause) {
        return err(HookBundleErrors.writeFailed({ cause, path: generationDir }));
      }
      return outputPaths({ generation, root })
        .andThen((paths) => stampInputs({ paths, root }))
        .andThen((outputs) => hookBundleManifest({ inputs, outputs }));
    })
    .andThen((manifest) => {
      const current = join(buildDir, "current");
      try {
        writeFileAtomic({ contents: `${JSON.stringify(manifest)}\n`, path: join(generationDir, "manifest.json") });
        retireCurrent({ buildDir, current });
        writeFileAtomic({ contents: `${generation}\n`, path: current });
      } catch (cause) {
        return err(HookBundleErrors.writeFailed({ cause, path: generationDir }));
      }
      return ok(generation);
    });
  if (published.isErr()) {
    rmSync(unpublishedDir, { force: true, recursive: true });
    rmSync(generationDir, { force: true, recursive: true });
  }
  return published;
}

/**
 * Build a fresh generation of `root`'s `PreToolUse` gate and make it current, unless another builder holds the
 * lock.
 *
 * @param root the plugin root whose `hooks/pretooluse.ts` is built
 * @param nowMs the wall clock, for the lock's and the sweep's ages
 * @returns the generation published, `busy` when another build is running, or why nothing was published
 */
export async function buildHookBundleGeneration({
  root,
  nowMs,
}: {
  root: string;
  nowMs: number;
}): Promise<Result<HookBundleBuildOutcome, HookBundleError>> {
  const buildDir = join(root, HOOK_BUILD_DIR);
  const lock = join(buildDir, "build.lock");
  try {
    mkdirSync(buildDir, { recursive: true });
  } catch (cause) {
    return err(HookBundleErrors.writeFailed({ cause, path: buildDir }));
  }
  if (!takeLock({ lock, nowMs })) {
    return ok({ kind: "busy" });
  }
  try {
    // The start instant on the FILESYSTEM's clock, the one every input's ctime is written in.
    const marker = join(lock, "started");
    let startedCtimeNs: string;
    try {
      writeFileSync(marker, `${String(process.pid)}\n`);
      startedCtimeNs = statSync(marker, { bigint: true }).ctimeNs.toString();
    } catch (cause) {
      return err(HookBundleErrors.writeFailed({ cause, path: marker }));
    }
    const generation = await publishGeneration({ buildDir, root, startedCtimeNs });
    const failed = join(buildDir, FAILURE_MARKER);
    if (generation.isErr()) {
      // An input saved mid-build is the tree moving, not the tree broken: the next miss simply tries again.
      if (generation.error.code !== "HOOK_BUNDLE_INPUTS_UNSTABLE") {
        try {
          writeFileSync(failed, `${generation.error.message}\n`);
        } catch {
          // A tree that cannot hold the marker could not hold the lock either; the shim's writability check paces it.
        }
      }
      return err(generation.error);
    }
    rmSync(failed, { force: true });
    sweepOldGenerations({ buildDir, keep: generation.value, nowMs });
    return ok({ generation: generation.value, kind: "published" });
  } finally {
    rmSync(lock, { force: true, recursive: true });
  }
}
