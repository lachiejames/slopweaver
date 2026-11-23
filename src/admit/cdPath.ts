/**
 * Bash's `CDPATH`, as far as a static resolver can follow it: which value a command sets, and which directory a `cd`
 * enters through it. Without this, `CDPATH="$SLOPWEAVER_HOME/talk" cd calls && rm live.jsonl` reads as a `cd` into
 * `./calls` while bash enters the live calls directory. Pure but for the one directory test it is handed.
 */
import { isAbsolute, resolve } from "node:path";

/** A leading shell assignment, `NAME=value`. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/**
 * The `CDPATH` one statement leaves set: a bare `CDPATH=v` assignment or an `export … CDPATH=v` sets `v`, an `unset
 * CDPATH` clears it (`""`), anything else leaves it alone (`undefined`).
 *
 * @param tokens the statement's whitespace words, assignments included
 * @returns the value it leaves, as written, `""` when it unsets it, or `undefined` when it does not touch it
 */
export function statementCdPath({ tokens }: { tokens: readonly string[] }): string | undefined {
  if (tokens[0] === "unset" && tokens.includes("CDPATH")) {
    return "";
  }
  const operands = tokens[0] === "export" ? tokens.slice(1) : tokens;
  if (tokens[0] !== "export" && !tokens.every((token) => ASSIGNMENT.test(token))) {
    return undefined;
  }
  return assignedValue({ tokens: operands });
}

/**
 * The `CDPATH` a command's own leading assignments give it — `CDPATH=v cd calls` — if they give one.
 *
 * @param tokens the command's whitespace words, its leading assignments first
 * @returns the value as written, or `undefined` when no leading assignment names `CDPATH`
 */
export function prefixCdPath({ tokens }: { tokens: readonly string[] }): string | undefined {
  const end = tokens.findIndex((token) => !ASSIGNMENT.test(token));
  return assignedValue({ tokens: end === -1 ? tokens : tokens.slice(0, end) });
}

/** The value of the last `CDPATH=` among some words, or `undefined` when none sets it. */
function assignedValue({ tokens }: { tokens: readonly string[] }): string | undefined {
  const last = tokens.findLast((token) => token.startsWith("CDPATH="));
  return last === undefined ? undefined : last.slice("CDPATH=".length);
}

/**
 * The directory a `cd` into `target` enters when `CDPATH` is `cdPath`: the first entry holding `target` as a
 * directory, an empty entry being the current one, else `target` under the current directory, as bash falls back. A
 * target that is absolute, or is or opens on a `.` or `..` component, never consults `CDPATH`.
 *
 * @param read how one entry, as written, reads as a path, or `undefined` when it cannot be known
 * @param exists whether a path is a directory now
 * @returns the directory entered, or `undefined` when an entry it would have to test cannot be read
 */
export function cdPathTarget({
  cwd,
  cdPath,
  target,
  read,
  exists,
}: {
  cwd: string;
  cdPath: string;
  target: string;
  read: (entry: string) => string | undefined;
  exists: (path: string) => boolean;
}): string | undefined {
  if (cdPath === "" || isAbsolute(target) || /^\.\.?(?:\/|$)/u.test(target)) {
    return resolve(cwd, target);
  }
  for (const entry of splitEntries({ cdPath })) {
    const base = entry === "" ? cwd : read(entry);
    if (base === undefined) {
      return undefined;
    }
    const candidate = resolve(cwd, base, target);
    if (exists(candidate)) {
      return candidate;
    }
  }
  return resolve(cwd, target);
}

/** `CDPATH`'s entries, split on each `:` outside a quote, one surrounding quote pair kept for the reader to strip. */
function splitEntries({ cdPath }: { cdPath: string }): readonly string[] {
  if (!/^(?:'[^']*'|"[^"]*")$/u.test(cdPath)) {
    return cdPath.split(":");
  }
  const quote = cdPath[0]!;
  return cdPath
    .slice(1, -1)
    .split(":")
    .map((entry) => `${quote}${entry}${quote}`);
}
