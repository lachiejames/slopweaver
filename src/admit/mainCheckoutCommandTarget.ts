/**
 * Resolve the working directory of each simple command in a Bash tool call before a main-checkout guard
 * decides whether that command targets the protected checkout. The hook payload's `cwd` is the session root,
 * not necessarily the directory an inline `cd` or `git -C` targets.
 *
 * This is deliberately a narrow static resolver, not a shell interpreter. It understands literal `cd`
 * segments and Git's literal `-C` global option; shell expansion, grouped commands, and separators inside
 * quoted strings remain ambiguous and fail open. The guards are workflow safety nets, not security boundaries.
 *
 * The segment-splitting and env-override recognition this module builds on now live in
 * {@link ./shellSegments.js}, shared with `rawTools.js`'s raw-bypass classifier. The env-override recognition
 * is re-exported here for its existing import sites; the segment splitter is imported from there directly.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";

import { usesShellExpansion } from "./argumentValue.js";
import { cdPathTarget, prefixCdPath, statementCdPath } from "./cdPath.js";
import { cdOperandIndex, cdWords, withPwd } from "./cdWords.js";
import { gitSubcommand, stripEnvPrefix, toolName } from "./commandTokens.js";
import { type ShellSeparator, shellSegments } from "./shellSegments.js";
import { distinct, firstOrElse, joinVisited, listEnd, mayNotMove, nextCdPaths } from "./shellStanding.js";

export { hasInlineEnvironmentOverride, hasSegmentInlineEnvironmentOverride } from "./shellSegments.js";

/** One command segment paired with the directory it will target, or `undefined` when static resolution failed. */
export interface MainCheckoutCommandTarget {
  readonly command: string;
  /** The directory the command acts in — a leading `git`'s own `-C` options applied. */
  readonly cwd: string | undefined;
  /**
   * The directory the SHELL stands in for this segment, before any `git -C` of its own: where a redirection opens its
   * file, and where a grammar that reads `-C` itself (a wrapped `git`) starts, so no `-C` is applied twice.
   */
  readonly shellCwd: string | undefined;
  /** This segment's position among ALL segments {@link shellSegments} splits `command` into (cd segments included), for {@link hasSegmentInlineEnvironmentOverride}. */
  readonly segmentIndex: number;
  /** Every directory the shell may have stood in before this segment, the session's own first. */
  readonly visited: readonly string[];
}

/** A segment's whitespace words, its leading `env`/assignment prefix still on. */
function whitespaceWords({ command }: { command: string }): readonly string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * The `CDPATH` one segment's `cd` searches — its own leading assignment first — and the one it leaves for the next.
 */
function segmentCdPath({ current, words }: { current: string; words: readonly string[] }): {
  here: string;
  after: string;
} {
  let after = current;
  const set = statementCdPath({ tokens: words });
  if (set !== undefined) {
    after = set;
  }
  const prefix = prefixCdPath({ tokens: words });
  if (prefix !== undefined) {
    return { after, here: prefix };
  }
  return { after, here: after };
}

/** A caller's own reading of a `cd` target that names a home (`~`, `$HOME`), or `undefined` when it cannot know it. */
export type CdTargetExpansion = (token: string) => string | undefined;

/**
 * Strip one simple matching quote pair; whitespace-containing shell words remain deliberately unresolved. A home
 * spelling goes to `expand` when the caller supplied one, and is unresolved otherwise.
 */
function literalPath({ token, expand }: { token: string | undefined; expand?: CdTargetExpansion }): string | undefined {
  if (token !== undefined && expand !== undefined && (token.startsWith("~") || usesShellExpansion({ text: token }))) {
    return expand(token);
  }
  if (token === undefined || token === "-" || token.startsWith("~") || usesShellExpansion({ text: token })) {
    return undefined;
  }
  const quoted = /^(?:'([^']*)'|"([^"]*)")$/.exec(token);
  // An unquoted word is already the literal path.
  if (quoted === null) return token;
  // One of the two alternatives matched, so exactly one of their groups took part.
  const [, single, double] = quoted;
  if (single !== undefined) return single;
  return double!;
}

/** Whether a path exists as a directory now, used only for `cd x; next` where failure would retain cwd. */
function isDirectory({ path }: { path: string }): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** How a word reads as a path, with the caller's home expansion when it gave one. */
function pathReader({ expand }: { expand: CdTargetExpansion | undefined }): (token: string) => string | undefined {
  if (expand === undefined) {
    return (token) => literalPath({ token });
  }
  return (token) => literalPath({ expand, token });
}

/** The directory one literal `cd` names, or `undefined` when it cannot be read statically. */
function cdLanding({
  cwd,
  cdPath,
  tokens,
  expand,
}: {
  cwd: string;
  cdPath: string;
  tokens: readonly string[];
  expand: CdTargetExpansion | undefined;
}): string | undefined {
  const offset = cdOperandIndex({ tokens });
  const read = pathReader({ expand });
  // A `cd` with no operand goes to `$HOME` (`cd && rm .slopweaver/talk/calls/x.jsonl`).
  const operand = tokens.length === offset ? "$HOME" : tokens[offset]!;
  const target = tokens.length <= offset + 1 ? read(withPwd({ cwd, token: operand })) : undefined;
  if (target === undefined) {
    return undefined;
  }
  return cdPathTarget({ cdPath, cwd, exists: (path) => isDirectory({ path }), read, target });
}

/** Resolve the cwd visible after one literal `cd`, respecting separators whose execution semantics are known. */
function cwdAfterCd({
  cwd,
  landing,
  separatorAfter,
}: {
  cwd: string;
  landing: string | undefined;
  separatorAfter: ShellSeparator | undefined;
}): string | undefined {
  if (landing === undefined) {
    return separatorAfter === "&&" ? undefined : cwd;
  }
  if (separatorAfter === "&&") return landing;
  if (separatorAfter === ";" || separatorAfter === "\n") return isDirectory({ path: landing }) ? landing : cwd;
  return cwd; // `cd x || next` runs next only when cd failed; a pipe changes cwd only in its subshell
}

/**
 * Resolve each Git `-C <dir>` in order — literal, `$PWD`, or a home the caller's expansion reads; relative later values
 * are relative to the earlier resolved value. An attached `-C<dir>` moves nothing: git refuses it as an unknown option
 * (`git -C/tmp status` exits 129 printing `unknown option: -C/tmp`).
 */
function gitTargetCwd({
  cwd,
  globals,
  expand,
}: {
  cwd: string;
  globals: readonly string[];
  expand: CdTargetExpansion | undefined;
}): string | undefined {
  const read = pathReader({ expand });
  let target = cwd;
  for (let index = 0; index < globals.length; index += 1) {
    if (globals[index] !== "-C") continue;
    const value = globals[index + 1];
    if (value === undefined) continue;
    const path = read(withPwd({ cwd: target, token: value }));
    if (path === undefined) return undefined;
    target = resolve(target, path);
    index += 1;
  }
  return target;
}

/** Resolve a non-`cd` segment's target cwd, applying Git's own `-C` semantics when present. */
function segmentTargetCwd({
  tokens,
  cwd,
  expand,
}: {
  tokens: readonly string[];
  cwd: string;
  expand: CdTargetExpansion | undefined;
}): string | undefined {
  const first = tokens[0];
  if (first === undefined || toolName({ first }) !== "git") return cwd;
  const { globals } = gitSubcommand({ tokens });
  return gitTargetCwd({ cwd, expand, globals });
}

/**
 * One `cd` segment: the cwd after it, and the segment itself as a target when it runs more than the `cd` — words past
 * its one operand are a command the `cd` does not run, as `cd calls & rm x` backgrounds the `cd` and runs the `rm`
 * where the shell already was. A `cd x || alt` also names `x` as where the shell stands once `alt` is done
 * whenever `x` exists, as `cd x || exit 1; rm y` removes `x/y`.
 */
function cdStep({
  cwd,
  cdPath,
  expand,
  segment,
  tokens,
}: {
  cwd: string | undefined;
  cdPath: string;
  expand: CdTargetExpansion | undefined;
  segment: { readonly command: string; readonly separatorAfter: ShellSeparator | undefined };
  tokens: readonly string[];
}): {
  cwd: string | undefined;
  orElse: string | undefined;
  targets: readonly { command: string; cwd: string | undefined; shellCwd: string | undefined }[];
} {
  const { operands, redirects } = cdWords({ tokens });
  const runsMore = redirects || operands.length > cdOperandIndex({ tokens: operands }) + 1;
  const targets = runsMore ? [{ command: segment.command, cwd, shellCwd: cwd }] : [];
  if (cwd === undefined) {
    return { cwd, orElse: undefined, targets };
  }
  const landing = cdLanding({ cdPath, cwd, expand, tokens: operands });
  const succeeds = segment.separatorAfter === "||" && landing !== undefined && isDirectory({ path: landing });
  return {
    cwd: cwdAfterCd({ cwd, landing, separatorAfter: segment.separatorAfter }),
    orElse: succeeds ? landing : undefined,
    targets,
  };
}

/** A non-`cd` segment as a target, judged from `cwd`; an empty segment is none. */
function commandTargets({
  cwd,
  expand,
  segment,
  segmentIndex,
  tokens,
}: {
  cwd: string | undefined;
  expand: CdTargetExpansion | undefined;
  segment: { readonly command: string };
  segmentIndex: number;
  tokens: readonly string[];
}): readonly Omit<MainCheckoutCommandTarget, "visited">[] {
  if (segment.command.trim().length === 0) {
    return [];
  }
  const target = cwd === undefined ? undefined : segmentTargetCwd({ cwd, expand, tokens });
  return [{ command: segment.command, cwd: target, segmentIndex, shellCwd: cwd }];
}

/**
 * Resolve each non-`cd` command segment to its actual literal target directory.
 *
 * @param command the raw Bash tool command
 * @param cwd the session-level cwd reported by the tool payload
 * @param expandCdTarget how a caller that knows the environment reads a `cd` into a home; without one it is unresolved
 * @param cdPath the `CDPATH` the command starts with, which a bare relative `cd` searches before its own directory
 * @returns command segments paired with the directory each acts in (`cwd`, a leading git's `-C` applied) and the one
 *   the shell stands in (`shellCwd`, before it); an ambiguous directory carries `undefined`
 */
export function resolveMainCheckoutCommandTargets({
  command,
  cwd,
  expandCdTarget,
  cdPath = "",
}: {
  command: string;
  cwd: string;
  expandCdTarget?: CdTargetExpansion;
  cdPath?: string | undefined;
}): readonly MainCheckoutCommandTarget[] {
  const targets: MainCheckoutCommandTarget[] = [];
  // Every directory the shell may stand in: a `cd` it may have skipped leaves more than one.
  let cwds: readonly (string | undefined)[] = [cwd];
  // Every `CDPATH` the shell may hold: an assignment it may have skipped leaves more than one.
  let cdPathsNow: readonly string[] = [cdPath];
  // Where the shell stands once the alternative after a `cd x || …` is done, when `x` exists.
  let orElse: readonly string[] = [];
  // Where it stands if a `cd` this and-or list may skip did not run, joined back in when the list ends.
  let skipped: readonly (string | undefined)[] = [];
  let before: ShellSeparator | undefined;
  // Every directory the shell may have stood in so far, one of which `OLDPWD` names (`rm ~-/x`).
  let visited: readonly string[] = [cwd];
  for (const [segmentIndex, segment] of shellSegments({ command }).entries()) {
    const words = whitespaceWords({ command: segment.command });
    const cdPaths = cdPathsNow.map((current) => segmentCdPath({ current, words }));
    cdPathsNow = nextCdPaths({ before, cdPaths, now: cdPathsNow, separatorAfter: segment.separatorAfter });
    const tokens = stripEnvPrefix({ tokens: words });
    const first = tokens[0];
    let found: readonly Omit<MainCheckoutCommandTarget, "visited">[];
    if (first !== undefined && toolName({ first }) === "cd") {
      if (mayNotMove({ before })) skipped = skipped.concat(cwds);
      const steps = cwds.flatMap((from) =>
        cdPaths.map(({ here }) => cdStep({ cdPath: here, cwd: from, expand: expandCdTarget, segment, tokens })),
      );
      found = steps.flatMap((step) => step.targets.map((target) => ({ ...target, segmentIndex })));
      cwds = distinct({ cwds: steps.map((step) => step.cwd) });
      orElse = firstOrElse({ orElse, steps });
    } else {
      found = cwds.flatMap((at) => commandTargets({ cwd: at, expand: expandCdTarget, segment, segmentIndex, tokens }));
    }
    for (const target of found) targets.push({ ...target, visited });
    visited = joinVisited({ dirs: [...cwds, ...orElse, ...skipped], visited });
    const ends = listEnd({ cwds, orElse, separator: segment.separatorAfter, skipped });
    ({ cwds, orElse, skipped } = ends);
    before = segment.separatorAfter;
  }
  return targets;
}
