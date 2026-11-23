/**
 * The effectful half of `codex plugin-sync`: export the checkout's HEAD with `git archive`, point the personal
 * Codex marketplace's `slopweaver` source at the export, re-run `codex plugin add`, and read the commit back
 * out of the tree Codex installed. `./plan.ts` carries every decision and the measurements behind the route;
 * `./checkout.ts` which checkout may publish; `./syncLock.ts` the lock one run holds while it writes.
 *
 * Two windows, and only one of them is ours. The export is swapped in by rename, so the marketplace path only
 * ever names a complete tree. Codex's own copy into its cache is Codex's code and is NOT atomic: a Codex
 * session invoking `bin/slopweaver` during the add (about 6 s, measured on this tree) can miss a file. The
 * stable `local` cache key keeps that to seconds rather than deleting every running session's directory.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { errorMessage } from "#lib/errorMessage.js";
import { readJsonFile, writeJsonFile } from "#lib/jsonFile.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { git, isDeclaredMain, publishableHead, STEP_TIMEOUT_MS } from "./checkout.js";
import { type CodexPluginSyncError, CodexPluginSyncErrors } from "./errors.js";
import {
  CODEX_PLUGIN_NAME,
  CODEX_UNVERSIONED_CACHE_KEY,
  marketplaceEntryOf,
  PERSONAL_MARKETPLACE_RELATIVE,
  SOURCE_STAMP_RELATIVE,
  type SyncDecision,
  type SyncOutcome,
  stampCommitOf,
  syncDecision,
} from "./plan.js";
import { takeSyncLock } from "./syncLock.js";

/** Slopweaver's own Codex manifest, relative to a checkout — what marks a checkout as publishable. */
const CODEX_MANIFEST_RELATIVE = ".codex-plugin/plugin.json";

/** The directories this run reads and writes. */
export interface SyncPaths {
  /** The checkout whose HEAD is exported — the git toplevel the verb runs in. */
  readonly checkout: string;
  /**
   * `codex-plugin/` under the cache root (`src/cacheHome.ts`), holding the export, the lock and the background log.
   * A move of this root needs no migration: the next sync re-exports and `pointSourceAt` repoints the marketplace.
   */
  readonly exportRoot: string;
  /** The user's home, which Codex treats as the personal marketplace's root. */
  readonly userHome: string;
  /** `$CODEX_HOME`, under which Codex keeps its plugin cache. */
  readonly codexHome: string;
}

/** What one `codex plugin add` spawn returned. */
export interface CodexAddRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The seams a test replaces with plain fakes. */
export interface SyncDeps {
  /** Run `codex plugin add <pluginId> --json`. */
  readonly codexAdd: (args: { pluginId: string }) => CodexAddRun;
  /** The wall clock, for the lock's acquired instant and the age of an earlier build's lock. */
  readonly nowMs: () => number;
}

/**
 * The production seams: the real `codex plugin add`, bounded, and the wall clock.
 *
 * @returns the deps a real run uses
 */
export function productionSyncDeps(): SyncDeps {
  return { codexAdd: spawnCodexAdd, nowMs: () => Date.now() };
}

/** Spawn `codex plugin add`, narrowing what came back to the three fields the reading needs. */
function spawnCodexAdd({ pluginId }: { pluginId: string }): CodexAddRun {
  try {
    const stdout = execFileSync("codex", ["plugin", "add", pluginId, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: STEP_TIMEOUT_MS,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    if (!isRecord(error)) {
      return { status: null, stderr: errorMessage({ error }), stdout: "" };
    }
    const { status, stderr, stdout } = error;
    return {
      status: typeof status === "number" ? status : null,
      stderr: typeof stderr === "string" ? stderr : errorMessage({ error }),
      stdout: typeof stdout === "string" ? stdout : "",
    };
  }
}

/** Everything a refresh needs, resolved and decided, before anything is written. */
export interface SyncTarget {
  readonly head: string;
  readonly marketplace: string;
  readonly sourcePath: string;
  readonly exportDir: string;
  readonly decision: SyncDecision;
}

/** The commit a tree's source stamp names, or undefined when it has none. */
function stampedCommit({ root }: { root: string }): string | undefined {
  return stampCommitOf({ document: readJsonFile({ path: join(root, SOURCE_STAMP_RELATIVE) }) });
}

/**
 * Resolve what this checkout would publish and whether the Codex install is behind it — reads only.
 *
 * Only a DECLARED main checkout of Slopweaver itself publishes: a feature branch in a worktree must never
 * become the fleet's Codex install, and another declared main checkout (a different repository) carries no
 * Slopweaver manifest at all.
 *
 * @param paths the directories involved
 * @param mainCheckouts the profile's declared main checkout paths
 * @returns the target to refresh, a skip with its reason, or why it could not be resolved
 */
export function resolveSyncTarget({
  paths,
  mainCheckouts,
}: {
  paths: SyncPaths;
  mainCheckouts: readonly string[];
}): Result<SyncTarget | { readonly skip: string }, CodexPluginSyncError> {
  if (!isDeclaredMain({ checkout: paths.checkout, mainCheckouts })) {
    return ok({ skip: `${paths.checkout} is not a declared main checkout, and only one publishes the Codex install` });
  }
  const manifest = readJsonFile({ path: join(paths.checkout, CODEX_MANIFEST_RELATIVE) });
  if (!isRecord(manifest) || manifest["name"] !== CODEX_PLUGIN_NAME) {
    return ok({ skip: `${paths.checkout} carries no ${CODEX_PLUGIN_NAME} Codex manifest` });
  }
  const entry = personalMarketplaceEntry({ userHome: paths.userHome });
  if (entry.isErr()) {
    return err(entry.error);
  }
  if ("skip" in entry.value) {
    return ok({ skip: entry.value.skip });
  }
  const published = publishableHead({ checkout: paths.checkout });
  if (published.isErr()) {
    return err(published.error);
  }
  if ("skip" in published.value) {
    return ok({ skip: published.value.skip });
  }
  const { head } = published.value;
  const exportDir = join(paths.exportRoot, CODEX_PLUGIN_NAME);
  const cacheDir = join(
    paths.codexHome,
    "plugins",
    "cache",
    entry.value.marketplace,
    CODEX_PLUGIN_NAME,
    CODEX_UNVERSIONED_CACHE_KEY,
  );
  const decision = syncDecision({
    exported: stampedCommit({ root: exportDir }),
    head,
    installed: stampedCommit({ root: cacheDir }),
  });
  return ok({ decision, exportDir, head, marketplace: entry.value.marketplace, sourcePath: entry.value.sourcePath });
}

/**
 * Slopweaver's LOCAL entry in the personal Codex marketplace — the one `codex plugin-sync` points at the main
 * checkout's export — or why there is none.
 *
 * @param userHome the user's home, which Codex treats as the personal marketplace's root
 * @returns the marketplace name and source path, a skip with its reason, or why the document is unreadable
 */
export function personalMarketplaceEntry({
  userHome,
}: {
  userHome: string;
}): Result<
  { readonly marketplace: string; readonly sourcePath: string } | { readonly skip: string },
  CodexPluginSyncError
> {
  const marketplacePath = join(userHome, PERSONAL_MARKETPLACE_RELATIVE);
  if (!existsSync(marketplacePath)) {
    return ok({ skip: `no personal Codex marketplace at ${marketplacePath}` });
  }
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(marketplacePath, "utf8"));
  } catch (error: unknown) {
    return err(CodexPluginSyncErrors.marketplaceUnreadable({ detail: errorMessage({ error }), path: marketplacePath }));
  }
  const entry = marketplaceEntryOf({ document, home: userHome, path: marketplacePath });
  if (entry.isErr()) {
    return err(entry.error);
  }
  if (entry.value.kind === "absent") {
    return ok({ skip: entry.value.why });
  }
  return ok({ marketplace: entry.value.marketplace, sourcePath: entry.value.sourcePath });
}

/**
 * Export `head` into `exportDir` as a whole tree swapped in by directory rename, stamped with its commit.
 *
 * A directory swap, not a file write: `writeFileAtomic` cannot express one, and the tree is not fsynced. That
 * is deliberate — a crash in the seconds after the swap can leave a short file in a tree that is re-derived
 * from git on the next landing, while fsyncing some thousand files would add the cost to every landing.
 */
function exportHead({ paths, head, exportDir }: { paths: SyncPaths; head: string; exportDir: string }): void {
  const nextTree = `${exportDir}.next-${String(process.pid)}`;
  const retired = `${exportDir}.old-${String(process.pid)}`;
  const tarball = join(paths.exportRoot, `export-${String(process.pid)}.tar`);
  rmSync(nextTree, { force: true, recursive: true });
  mkdirSync(nextTree, { recursive: true });
  try {
    git({ args: ["archive", "--format=tar", "-o", tarball, head], cwd: paths.checkout });
    execFileSync("tar", ["-xf", tarball, "-C", nextTree], { timeout: STEP_TIMEOUT_MS });
  } finally {
    rmSync(tarball, { force: true });
  }
  writeJsonFile({ path: join(nextTree, SOURCE_STAMP_RELATIVE), value: { commit: head } });
  if (existsSync(exportDir)) {
    renameSync(exportDir, retired);
  }
  renameSync(nextTree, exportDir);
  rmSync(retired, { force: true, recursive: true });
}

/** Point the marketplace's source path at the export, replacing only a symlink, never a real tree. */
function pointSourceAt({
  sourcePath,
  exportDir,
}: {
  sourcePath: string;
  exportDir: string;
}): Result<void, CodexPluginSyncError> {
  const found = lstatSync(sourcePath, { throwIfNoEntry: false });
  if (found !== undefined && !found.isSymbolicLink()) {
    return err(CodexPluginSyncErrors.sourceNotSymlink({ path: sourcePath }));
  }
  if (found !== undefined && readlinkSync(sourcePath) === exportDir) {
    return ok(undefined);
  }
  try {
    mkdirSync(dirname(sourcePath), { recursive: true });
    // A symlink swapped over the old one by rename: no bytes of ours to fsync, so no atomic-write helper.
    const nextLink = `${sourcePath}.next-${String(process.pid)}`;
    rmSync(nextLink, { force: true });
    symlinkSync(exportDir, nextLink);
    renameSync(nextLink, sourcePath);
  } catch (error: unknown) {
    return err(CodexPluginSyncErrors.repointFailed({ detail: errorMessage({ error }), path: sourcePath }));
  }
  return ok(undefined);
}

const addOutputSchema = z.object({ installedPath: z.string().min(1) });

/** Where `codex plugin add --json` says it installed the plugin. */
function installedPathOf({ run }: { run: CodexAddRun }): Result<string, CodexPluginSyncError> {
  if (run.status !== 0) {
    const detail = run.stderr.trim().split("\n")[0];
    return err(
      CodexPluginSyncErrors.addFailed({
        detail: detail === undefined || detail === "" ? `exit ${String(run.status)}` : detail,
      }),
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(run.stdout);
  } catch (error: unknown) {
    return err(CodexPluginSyncErrors.addFailed({ detail: `unparseable --json output: ${errorMessage({ error })}` }));
  }
  const parsed = addOutputSchema.safeParse(document);
  if (!parsed.success) {
    return err(CodexPluginSyncErrors.addFailed({ detail: "the --json output names no installedPath" }));
  }
  return ok(parsed.data.installedPath);
}

/**
 * Export HEAD, re-add the plugin, and prove the installed tree carries HEAD — under a lock.
 *
 * @param paths the directories involved
 * @param target what {@link resolveSyncTarget} decided must be refreshed
 * @param deps the `codex` and clock seams
 * @returns the run's outcome; a failure is the `failed` arm, never a throw
 */
export function performSync({
  paths,
  target,
  deps,
}: {
  paths: SyncPaths;
  target: SyncTarget;
  deps: SyncDeps;
}): SyncOutcome {
  mkdirSync(paths.exportRoot, { recursive: true });
  const lock = takeSyncLock({ nowMs: deps.nowMs(), paths });
  if (lock.isErr()) {
    return lock.error;
  }
  try {
    try {
      exportHead({ exportDir: target.exportDir, head: target.head, paths });
    } catch (error: unknown) {
      return { did: "failed", error: CodexPluginSyncErrors.exportFailed({ detail: errorMessage({ error }) }) };
    }
    const pointed = pointSourceAt({ exportDir: target.exportDir, sourcePath: target.sourcePath });
    if (pointed.isErr()) {
      return { did: "failed", error: pointed.error };
    }
    const installed = installedPathOf({
      run: deps.codexAdd({ pluginId: `${CODEX_PLUGIN_NAME}@${target.marketplace}` }),
    });
    if (installed.isErr()) {
      return { did: "failed", error: installed.error };
    }
    const found = stampedCommit({ root: installed.value });
    if (found !== target.head) {
      return { did: "failed", error: CodexPluginSyncErrors.stampMismatch({ expected: target.head, found }) };
    }
    return { did: "refreshed", installedPath: installed.value, why: target.decision.why };
  } finally {
    lock.value.release();
  }
}
