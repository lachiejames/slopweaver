/**
 * Which files outside `desktop/` the desktop build reaches, read off the committed `desktop/package.json`. The app is
 * built from a `git archive` export of one commit (`exportCommit`), never the checkout, so a script naming
 * `../scripts/tsc-owner.sh` finds nothing unless the export carries that file too. MEASURED: an Update now press failed
 * `exit 127: bash: ../scripts/tsc-owner.sh: No such file or directory` once the desktop `build` script pointed at the
 * root's compiler owner while the export held `desktop/` alone.
 *
 * Residue, by construction: this reads what the scripts' TEXT names. A program a script runs that itself opens a
 * file outside `desktop/` is invisible to it, as to any reading of the manifest.
 */
import { posix } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { type DesktopScriptArchiveError, DesktopScriptArchiveErrors } from "./errors.js";

/**
 * A word the shell passes through unchanged: no quote, escape, expansion, glob, brace, tilde or redirect. Chasing
 * each shell syntax that can spell `..` without writing it lost twice in review (an escaped `.\./`, then a brace
 * `{.,}{.,}/`), so a word is either plainly literal or refused.
 */
const LITERAL_WORD = /^[\w.\-/=:@,+%]+$/u;

/** The control operators a script's words may be joined by. */
const OPERATORS: ReadonlySet<string> = new Set(["&&", "||", "|", ";", "&"]);

/**
 * The readings of a word that could be a path through `..`: the word itself, or the value after any `=` — a flag's
 * (`--out=../x`) or an assignment's (`ROOT=../scripts`), which reaches that path as surely, so it is carried rather than
 * refused. Never split on any other character, since a filename may carry it (`build,desktop.sh`).
 */
function parentPathReadings({ word }: { word: string }): readonly string[] {
  const readings = [word];
  for (let at = word.indexOf("="); at !== -1; at = word.indexOf("=", at + 1)) {
    readings.push(word.slice(at + 1));
  }
  return readings.filter((reading) => reading.split("/").includes(".."));
}

/** The one repository path outside `desktop/` a script word names, or why it cannot be named exactly. */
function wordRepoPath({
  name,
  word,
}: {
  name: string;
  word: string;
}): Result<string | undefined, DesktopScriptArchiveError> {
  if (word === "" || OPERATORS.has(word)) {
    return ok(undefined);
  }
  if (!LITERAL_WORD.test(word)) {
    return err(DesktopScriptArchiveErrors.shellSyntax({ script: name, word }));
  }
  if (!word.includes("..")) {
    return ok(undefined);
  }
  // A `..` that is not exactly one path (`a:../x`, `../a=../b`) refuses rather than guessing which part is the path.
  const readings = parentPathReadings({ word });
  if (readings.length !== 1) {
    return err(DesktopScriptArchiveErrors.notOnePath({ script: name, word }));
  }
  const reading = readings[0]!;
  if (posix.isAbsolute(reading)) {
    return err(DesktopScriptArchiveErrors.outsideRepo({ script: name, word }));
  }
  // Only a LEADING run of `..`: a later one (`../tools/../x`) needs `tools/` to exist on the way, which a normalised
  // path would leave out of the export.
  if (
    reading
      .replace(/^(?:\.\.\/)+/u, "")
      .split("/")
      .includes("..")
  ) {
    return err(DesktopScriptArchiveErrors.climbsBack({ script: name, word }));
  }
  const path = posix.normalize(posix.join("desktop", reading)).replace(/\/$/u, "");
  if (path === "." || path === ".." || path.startsWith("../")) {
    return err(DesktopScriptArchiveErrors.outsideRepo({ script: name, word }));
  }
  // A path that comes back into `desktop/` is already exported.
  if (path === "desktop" || path.startsWith("desktop/")) {
    return ok(undefined);
  }
  return ok(path);
}

/** The manifest's `scripts` object, or why the text carries none. */
function manifestScripts({ text }: { text: string }): Result<Record<string, unknown>, DesktopScriptArchiveError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err(DesktopScriptArchiveErrors.manifestNotJson());
  }
  if (!isRecord(parsed) || !isRecord(parsed["scripts"])) {
    return err(DesktopScriptArchiveErrors.noScripts());
  }
  return ok(parsed["scripts"]);
}

/** The repository paths one script's words name outside `desktop/`, in word order, or the first word refused. */
function scriptRepoPaths({
  name,
  script,
}: {
  name: string;
  script: string;
}): Result<readonly string[], DesktopScriptArchiveError> {
  const paths: string[] = [];
  for (const word of script.trim().split(/\s+/u)) {
    const found = wordRepoPath({ name, word });
    if (found.isErr()) {
      return err(found.error);
    }
    if (found.value !== undefined) {
      paths.push(found.value);
    }
  }
  return ok(paths);
}

/**
 * Every repository path the desktop manifest's scripts name through `..`, so the export can carry each one beside
 * `desktop/`. Every script is read, not only the ones `yarn app` reaches, and every word must be plainly literal: one
 * carrying any shell syntax refuses rather than being skipped, since leaving a path out is the failure this exists to
 * stop.
 *
 * @param text the `desktop/package.json` text as committed at the commit being exported
 * @returns each repository-relative path once, in manifest order — empty when no script leaves `desktop/` — or why
 * the manifest could not be read
 */
export function desktopScriptArchivePaths({
  text,
}: {
  text: string;
}): Result<readonly string[], DesktopScriptArchiveError> {
  return manifestScripts({ text }).andThen((scripts): Result<readonly string[], DesktopScriptArchiveError> => {
    let paths: readonly string[] = [];
    for (const [name, script] of Object.entries(scripts)) {
      if (typeof script !== "string") {
        return err(DesktopScriptArchiveErrors.scriptNotString({ script: name }));
      }
      const found = scriptRepoPaths({ name, script });
      if (found.isErr()) {
        return err(found.error);
      }
      paths = paths.concat(found.value);
    }
    return ok(Array.from(new Set(paths)));
  });
}
