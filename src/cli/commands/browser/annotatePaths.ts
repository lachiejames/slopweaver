/**
 * Where `slopweaver browser annotate` reads and writes, and every check that keeps the write off the picture it draws
 * on. The verb in `./annotateRun.ts` calls these in order — resolve, bind, then compare inodes once the source is
 * read — and adds the one check left for the instant before the write; this module only reads the filesystem.
 */

import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import type { AnnotateForm } from "../../../visualEvidence/annotateForm.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";

/** The suffix the pre-filled image-record form takes beside the annotated picture. */
const ANNOTATE_RECORD_FORM_SUFFIX = ".image-record.json";

/** Where everything lives, resolved once. */
export interface AnnotatePaths {
  readonly source: string;
  readonly out: string;
  readonly recordForm: string;
}

/**
 * Resolve the three paths, refusing any two that are the same file — the source must never be overwritten.
 *
 * @param form the parsed form
 * @returns the paths, or the problem with them
 */
export function annotatePaths({ form }: { form: Pick<AnnotateForm, "source" | "out"> }): Result<AnnotatePaths> {
  const source = resolve(form.source);
  const out = resolve(form.out);
  const recordForm = `${out}${ANNOTATE_RECORD_FORM_SUFFIX}`;
  if (out === source) {
    return err([
      `out names the source ${source} — annotating writes a NEW picture and never touches the one it draws on`,
    ]);
  }
  if (recordForm === source) {
    return err([`the record form would land on the source ${source} — choose another out`]);
  }
  return ok({ out, recordForm, source });
}

/**
 * A path with every directory it passes through resolved to the real one, so a write aimed at it later lands where
 * it was checked. The deepest ancestor that already exists is resolved and the names below it are kept; the last name
 * is kept too, because the atomic rename replaces that directory entry rather than following it.
 *
 * @param path an absolute path
 * @returns the bound path
 */
function boundPath({ path }: { path: string }): string {
  let ancestor = dirname(path);
  const below: string[] = [basename(path)];
  while (lstatSync(ancestor, { throwIfNoEntry: false }) === undefined) {
    below.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return join(realpathSync(ancestor), ...below);
}

/**
 * Bind every path to the real directories it passes through, once, before anything is read or written. Checked
 * paths that a symlink further up can still retarget let the write land somewhere the checks never looked: an out of
 * `/link/source.png` with `/link` aimed elsewhere passes, then `/link` is aimed at the source's directory and the
 * rename replaces the source. Bound, the write goes to the directory that was checked.
 *
 * @param paths the paths {@link annotatePaths} resolved
 * @returns the bound paths, or the problem with them and the exit code it earns
 */
export function bindPaths({
  paths,
}: {
  paths: AnnotatePaths;
}): { readonly paths: AnnotatePaths } | { readonly problem: string; readonly code: number } {
  let source: string;
  let out: string;
  try {
    source = realpathSync(paths.source);
    out = boundPath({ path: paths.out });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: EXIT_ERROR, problem: `could not resolve where the source or out lives: ${message}` };
  }
  const recordForm = `${out}${ANNOTATE_RECORD_FORM_SUFFIX}`;
  if (out === source || recordForm === source) {
    return {
      code: EXIT_USAGE,
      problem: `out ${paths.out} reaches the source ${source} through a link — annotating never touches the picture it draws on`,
    };
  }
  return { paths: { out, recordForm, source } };
}

/**
 * Refuse an out or record-form path that is the source FILE under another name. {@link annotatePaths} compares
 * strings, and a symlink or hard link passes that while the atomic rename still replaces the source's bytes,
 * so this compares device and inode of whatever already exists.
 *
 * @param paths the resolved paths, the source already read
 * @returns the problem, or `null` when neither output is the source
 */
export function sameFileProblem({ paths }: { paths: AnnotatePaths }): string | null {
  const source = statSync(paths.source);
  for (const [which, path] of [
    ["out", paths.out],
    ["the record form", paths.recordForm],
  ] as const) {
    const existing = statSync(path, { throwIfNoEntry: false });
    if (existing !== undefined && existing.dev === source.dev && existing.ino === source.ino) {
      return `${which} ${path} is the source ${paths.source} under another name — annotating never touches the picture it draws on`;
    }
  }
  return null;
}
