/**
 * The bounded effects one `codex plugin-sync` run is built from: export HEAD as a whole tree, point the shared
 * marketplace source at it, run `codex plugin add` against ONE Codex home, and read where Codex says it
 * installed. `./sync.ts` orders them across every home; this module performs each once.
 *
 * Two windows, and only one of them is ours. The export is swapped in by rename, so the marketplace path only
 * ever names a complete tree. Codex's own copy into its cache is Codex's code and is NOT atomic: a Codex
 * session invoking `bin/slopweaver` during the add (about 6 s, measured on this tree) can miss a file. The
 * stable `local` cache key keeps that to seconds rather than deleting every running session's directory.
 *
 * `codex plugin add` writes into `$CODEX_HOME`, so the spawn sets it per home. Measured on codex-cli 0.165.0
 * with a throwaway `HOME` and `CODEX_HOME`: the add reported an `installedPath` under the named home and
 * wrote nothing under `$HOME/.codex`, and a `CODEX_HOME` with no directory was refused ("failed to resolve
 * CODEX_HOME") — so a missing home is a finding, never something this module creates.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { errorMessage } from "#lib/errorMessage.js";
import { writeJsonFile } from "#lib/jsonFile.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { git, STEP_TIMEOUT_MS } from "./checkout.js";
import { type CodexPluginSyncError, CodexPluginSyncErrors } from "./errors.js";
import { SOURCE_STAMP_RELATIVE } from "./plan.js";

/** What one `codex plugin add` spawn returned. */
export interface CodexAddRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run `codex plugin add <pluginId> --json` with `CODEX_HOME` set to one home. */
export type CodexAdd = (input: { readonly codexHome: string; readonly pluginId: string }) => CodexAddRun;

/**
 * Spawn the real `codex plugin add` into one home, narrowing what came back to the three fields the reading needs.
 *
 * @param codexHome the `$CODEX_HOME` the add installs into
 * @param pluginId `slopweaver@<marketplace>`
 * @returns the exit status and both streams, a spawn failure folded into them
 */
export function spawnCodexAdd({ codexHome, pluginId }: { codexHome: string; pluginId: string }): CodexAddRun {
  try {
    const stdout = execFileSync("codex", ["plugin", "add", pluginId, "--json"], {
      encoding: "utf8",
      env: { ...process.env, CODEX_HOME: codexHome },
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

/**
 * Export `head` into `exportDir` as a whole tree swapped in by directory rename, stamped with its commit.
 *
 * A directory swap, not a file write: `writeFileAtomic` cannot express one, and the tree is not fsynced. That
 * is deliberate — a crash in the seconds after the swap can leave a short file in a tree that is re-derived
 * from git on the next landing, while fsyncing some thousand files would add the cost to every landing.
 *
 * @param checkout the checkout whose commit is archived
 * @param exportRoot where the tarball is staged
 * @param head the commit to export
 * @param exportDir the tree the marketplace source points at
 * @returns nothing, or why the export could not be written
 */
export function exportHead({
  checkout,
  exportRoot,
  head,
  exportDir,
}: {
  checkout: string;
  exportRoot: string;
  head: string;
  exportDir: string;
}): Result<void, CodexPluginSyncError> {
  const nextTree = `${exportDir}.next-${String(process.pid)}`;
  const retired = `${exportDir}.old-${String(process.pid)}`;
  const tarball = join(exportRoot, `export-${String(process.pid)}.tar`);
  try {
    rmSync(nextTree, { force: true, recursive: true });
    mkdirSync(nextTree, { recursive: true });
    try {
      git({ args: ["archive", "--format=tar", "-o", tarball, head], cwd: checkout });
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
  } catch (error: unknown) {
    return err(CodexPluginSyncErrors.exportFailed({ detail: errorMessage({ error }) }));
  }
  return ok(undefined);
}

/**
 * Point the marketplace's source path at the export, replacing only a symlink, never a real tree.
 *
 * @param sourcePath where the marketplace entry says the plugin lives
 * @param exportDir the export to point it at
 * @returns nothing, or why the source could not be pointed
 */
export function pointSourceAt({
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

/**
 * Where `codex plugin add --json` says it installed the plugin.
 *
 * @param run what the add spawn returned
 * @returns the installed root, or why the add failed or named none
 */
export function installedPathOf({ run }: { run: CodexAddRun }): Result<string, CodexPluginSyncError> {
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
