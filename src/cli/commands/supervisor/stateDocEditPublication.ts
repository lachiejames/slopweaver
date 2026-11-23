/**
 * How `supervisor state-amend`, `state-fold` and `state-archive` publish an edit: the filesystem seams they
 * share and the protocol over them. The verbs themselves are `./stateDocEditRun.ts`.
 *
 * ## The publication protocol, and what an operator sees at each failure
 *
 * Every text is rendered and validated before anything is written, so a refusal leaves both files untouched.
 *
 * - **The archive is published no-clobber**: what is at the name is settled first, and a name that is not a
 *   regular file is refused without writing anything at all. A free name is then staged through
 *   `writeFileAtomic` and hard-linked onto its final name, which fails if that name was taken in between. A
 *   plain atomic write renames over an existing file, so the existence check alone would not stop two runs
 *   clobbering one archive — the link is what makes the publication exclusive.
 * - **An archive already there with the SAME bytes is reused**, which is the recovery path: a run that
 *   published the archive and then failed before replacing the doc is finished by re-running the identical
 *   command. An archive there with different bytes is refused.
 * - **The doc is re-read immediately before it is replaced**; if it changed since it was read, the edit is
 *   refused rather than overwriting the other writer's rows. Stated residue: the window between that re-read
 *   and the rename is not closed, because nothing locks this file.
 */
import { randomUUID } from "node:crypto";
import { linkSync, lstatSync, readFileSync, realpathSync, type Stats, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { fsyncDirectories, fsyncFile, writeFileAtomic } from "#lib/writeAtomic.js";

import { type SupervisorError, SupervisorErrors, supervisorErrorLines } from "./errors.js";

/** Everything the three verbs touch outside themselves, injected so a test can fail one step on purpose. */
export interface StateDocEditDeps {
  /** Reads one file, or throws. */
  readonly readFile: (args: { path: string }) => string;
  /** Replaces one file atomically, or throws. */
  readonly replaceFile: (args: { path: string; text: string }) => void;
  /** Publishes a NEW file; `exists` when the name is taken, throws on any other failure. */
  readonly publishNew: (args: { path: string; text: string }) => "published" | "exists";
  /** Flushes the directory a file `publishNew` just published sits in, or throws. */
  readonly flushPublished: (args: { path: string }) => void;
  /** What sits at a path WITHOUT following a link — how the reuse check tells a real archive from a pointer. */
  readonly pathKind: (args: { path: string }) => "regular" | "symlink" | "missing" | "other";
  /** A path with every link in it resolved, including the links in its parent directories. */
  readonly realPath: (args: { path: string }) => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** What one publication step answers: its value, or the typed refusal that stopped the edit. */
type Step<T> = Result<T, SupervisorError>;

/**
 * Expand a leading `~/` against the user's home directory.
 *
 * @param path the path as typed
 * @returns the expanded path
 */
export function expandHome({ path }: { path: string }): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/**
 * Show a path under the user's home directory as `~/…`, the way the doc's own notes name archives.
 *
 * @param path an absolute path
 * @returns the display form
 */
export function tildify({ path }: { path: string }): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * Run one fallible filesystem step, turning a throw into a refusal line.
 *
 * @param label what the step was, for the refusal
 * @returns the step's value, or the refusal
 */
export function attempt<T>({ label, step }: { label: string; step: () => T }): Step<T> {
  try {
    return ok(step());
  } catch (error: unknown) {
    return err(SupervisorErrors.stepFailed({ cause: error, label }));
  }
}

/**
 * Replace the doc only if it still holds exactly what the edit was rendered against.
 *
 * @param doc the doc path
 * @param expected the bytes the edit was rendered against
 * @param text the new doc text
 * @param deps the injected seams
 * @returns nothing on success, or the refusal
 */
export function replaceIfUnchanged({
  doc,
  expected,
  text,
  deps,
}: {
  doc: string;
  expected: string;
  text: string;
  deps: StateDocEditDeps;
}): Step<void> {
  const current = attempt({ label: `cannot re-read ${doc}`, step: () => deps.readFile({ path: doc }) });
  if (current.isErr()) {
    return err(current.error);
  }
  if (current.value !== expected) {
    return err(SupervisorErrors.docChanged({ path: doc }));
  }
  return attempt({
    label: `cannot write ${doc}`,
    step: () => {
      deps.replaceFile({ path: doc, text });
    },
  });
}

/**
 * Publish the archive at a name read as free a moment ago, then flush its directory.
 *
 * @param path the archive's final path
 * @param text the archive text
 * @param deps the injected seams
 * @returns `false` (nothing was reused), or the refusal
 */
function publishFreshArchive({
  path,
  text,
  deps,
}: {
  path: string;
  text: string;
  deps: StateDocEditDeps;
}): Step<boolean> {
  const published = attempt({ label: `cannot write ${path}`, step: () => deps.publishNew({ path, text }) });
  if (published.isErr()) {
    return err(published.error);
  }
  // `missing` was read a moment ago; a name taken since then is another writer's, and is not ours to reuse.
  if (published.value === "exists") {
    return err(SupervisorErrors.archiveTakenConcurrently({ path }));
  }
  // The archive is published from here on, so a failed flush is a failure AFTER publication and carries the
  // residue naming it: re-running the same command reuses it, and the reuse branch flushes it again. Folded
  // into `publishNew` it read as an archive never written. Found by an adversarial pass.
  const flushed = attempt({
    label: `cannot flush ${path}`,
    step: () => {
      deps.flushPublished({ path });
    },
  });
  if (flushed.isErr()) {
    return err(SupervisorErrors.docUnwrittenAfterPublish({ archivePath: path, inner: flushed.error }));
  }
  return ok(false);
}

/**
 * Publish the archive text no-clobber, reusing an archive already holding exactly these bytes.
 *
 * @param path the archive's final path
 * @param text the archive text
 * @param deps the injected seams
 * @returns whether an existing identical archive was reused, or the refusal
 */
function publishArchive({ path, text, deps }: { path: string; text: string; deps: StateDocEditDeps }): Step<boolean> {
  // What is at the name is settled FIRST, so a name that can never be an archive is refused without even a
  // staging file being written. Reuse is decided on the BYTES at that name, and a read follows a link — so a
  // symlink there would read as an identical archive, be "reused", and then be overwritten along with the
  // doc, losing the block this verb exists to preserve. Found by an adversarial pass.
  const kind = attempt({ label: `cannot inspect ${path}`, step: () => deps.pathKind({ path }) });
  if (kind.isErr()) {
    return err(kind.error);
  }
  if (kind.value !== "regular" && kind.value !== "missing") {
    return err(SupervisorErrors.archiveNotRegular({ kind: kind.value, path }));
  }
  if (kind.value === "missing") {
    return publishFreshArchive({ deps, path, text });
  }
  // Equal bytes are not durable bytes: the file may be an earlier run's or a hand copy never flushed, and the
  // doc is rewritten next, so a reused archive is flushed exactly as a new one is — and flushed BEFORE it is
  // compared, so the bytes accepted are bytes already flushed, never ones a writer swapped in between.
  const flushed = attempt({
    label: `cannot flush ${path}`,
    step: () => {
      fsyncFile({ path });
      fsyncDirectories({ paths: [path] });
    },
  });
  if (flushed.isErr()) {
    return err(flushed.error);
  }
  const existing = attempt({ label: `cannot read ${path}`, step: () => deps.readFile({ path }) });
  if (existing.isErr()) {
    return err(existing.error);
  }
  if (existing.value !== text) {
    return err(SupervisorErrors.archiveDiffers({ path }));
  }
  return ok(true);
}

/**
 * Refuse an archive path that is the state doc by another name, links in its parents resolved.
 *
 * @param archivePath where the archive would be written
 * @param doc the state doc
 * @param deps the injected seams
 * @returns nothing when they are different files, or the refusal
 */
function aliasesTheDoc({
  archivePath,
  doc,
  deps,
}: {
  archivePath: string;
  doc: string;
  deps: StateDocEditDeps;
}): Step<void> {
  const archiveReal = attempt({
    label: `cannot resolve ${archivePath}`,
    step: () => deps.realPath({ path: archivePath }),
  });
  if (archiveReal.isErr()) {
    return err(archiveReal.error);
  }
  const docReal = attempt({ label: `cannot resolve ${doc}`, step: () => deps.realPath({ path: doc }) });
  if (docReal.isErr()) {
    return err(docReal.error);
  }
  if (archiveReal.value === docReal.value) {
    return err(SupervisorErrors.archiveAliasesDoc({ path: archivePath, resolved: docReal.value }));
  }
  return ok(undefined);
}

/**
 * Resolve where an archive goes beside the doc, refuse a name aliasing the doc, and read the doc — the opening
 * every archiving edit shares.
 *
 * @param typedDoc the state doc's path before a leading `~/` is expanded
 * @param archive the `--archive` file name
 * @param deps the injected seams
 * @returns the doc path, its bytes and the archive path, or the refusal lines
 */
export function openDocAndArchive({
  typedDoc,
  archive,
  deps,
}: {
  typedDoc: string;
  archive: string;
  deps: StateDocEditDeps;
}): Result<{ readonly doc: string; readonly original: string; readonly archivePath: string }> {
  const doc = expandHome({ path: typedDoc });
  // The archive sits beside the doc the filesystem actually opens, so the directory comes off the RESOLVED
  // doc rather than off the typed path. `resolve()` would collapse `link/..` lexically and pick a different
  // `archive/` from the one the doc is really in — the kind of path a symlinked layout produces, and a
  // counterexample an adversarial pass reproduced.
  const docReal = attempt({ label: `cannot resolve ${doc}`, step: () => deps.realPath({ path: doc }) });
  if (docReal.isErr()) {
    return err(supervisorErrorLines({ error: docReal.error }));
  }
  const archivePath = join(dirname(docReal.value), "archive", archive);
  // Both paths with every link resolved, parents included: a symlinked `archive/` directory would otherwise
  // let the archive name alias the state doc, so replacing the doc would take the archived block with it.
  // A lstat of the archive's own leaf cannot see that — its parent is the link. Found by an adversarial pass.
  const aliased = aliasesTheDoc({ archivePath, doc, deps });
  if (aliased.isErr()) {
    return err(supervisorErrorLines({ error: aliased.error }));
  }
  const original = attempt({ label: `cannot read ${doc}`, step: () => deps.readFile({ path: doc }) });
  if (original.isErr()) {
    return err(supervisorErrorLines({ error: original.error }));
  }
  return ok({ archivePath, doc, original: original.value });
}

/**
 * Publish an archiving edit in its one safe order: the archive first, no-clobber, then the doc only if it is
 * still the bytes the edit was rendered against.
 *
 * @param archivePath where the archive goes
 * @param doc the state doc's path
 * @param original the doc bytes the edit was rendered against
 * @param edit the two rendered texts
 * @param deps the injected seams
 * @returns whether an identical archive already there was reused, or the refusal lines — naming the
 *   published archive when only the doc write failed, so the operator knows a re-run finishes it
 */
export function publishThenReplace({
  archivePath,
  doc,
  original,
  edit,
  deps,
}: {
  archivePath: string;
  doc: string;
  original: string;
  edit: { readonly archiveText: string; readonly docText: string };
  deps: StateDocEditDeps;
}): Result<boolean> {
  const reused = publishArchive({ deps, path: archivePath, text: edit.archiveText });
  if (reused.isErr()) {
    return err(supervisorErrorLines({ error: reused.error }));
  }
  const written = replaceIfUnchanged({ deps, doc, expected: original, text: edit.docText });
  if (written.isErr()) {
    const error = SupervisorErrors.docUnwrittenAfterPublish({ archivePath, inner: written.error });
    return err(supervisorErrorLines({ error }));
  }
  return ok(reused.value);
}

/**
 * Publish a new file without replacing an existing one: stage it durably, hard-link it onto the final name, and
 * drop the staging name. Flushing the final name's directory is the caller's next step (`flushPublished`), so a
 * failure there is reported as one after publication.
 *
 * @param path the final path
 * @param text the contents
 * @returns `exists` when the final name is already taken
 */
function publishNewFile({ path, text }: { path: string; text: string }): "published" | "exists" {
  const staging = `${path}.staging-${randomUUID()}`;
  writeFileAtomic({ contents: text, path: staging });
  try {
    linkSync(staging, path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return "exists";
    }
    throw error;
  } finally {
    dropStaging({ staging });
  }
  return "published";
}

/**
 * Remove the staging name. Its outcome never changes the publication's: once the link exists the archive is
 * published whether or not the second name could be dropped, so a failure here is reported and left behind
 * rather than reported as a failed publication that prints no residue.
 *
 * @param staging the temporary name beside the final one
 */
function dropStaging({ staging }: { staging: string }): void {
  try {
    unlinkSync(staging);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn({
      msg: `supervisor state edit: could not remove the staging file ${staging} (${reason}); delete it by hand`,
    });
  }
}

/**
 * What is at a path, without following a link.
 *
 * @param path the path to inspect
 * @returns what sits there
 */
function pathKindOf({ path }: { path: string }): "regular" | "symlink" | "missing" | "other" {
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch {
    return "missing";
  }
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  return stats.isFile() ? "regular" : "other";
}

/**
 * A path with its links resolved — including the case where the path itself does not exist yet, where only
 * its parents can be resolved.
 *
 * @param path the path to resolve
 * @returns the resolved path
 */
function realPathOf({ path }: { path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    // Not there yet, which is the normal case for an archive about to be published.
  }
  try {
    return join(realpathSync(dirname(path)), basename(path));
  } catch {
    return resolve(path);
  }
}

/**
 * The real seams: the filesystem and the logger.
 *
 * @returns the production dependencies for all three verbs
 */
export function productionStateDocEditDeps(): StateDocEditDeps {
  return {
    flushPublished: ({ path }) => {
      fsyncDirectories({ paths: [path] });
    },
    pathKind: pathKindOf,
    publishNew: publishNewFile,
    realPath: realPathOf,
    readFile: ({ path }) => readFileSync(path, "utf8"),
    replaceFile: ({ path, text }) => {
      writeFileAtomic({ contents: text, path });
    },
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}
