/**
 * Where a shell may stand as a command line's segments run: each is a set of directories, because a `cd` the shell
 * may skip, or one whose alternative may run instead, leaves more than one possible. Pure: the segment walk in
 * `./mainCheckoutCommandTarget.ts` carries these sets from one segment to the next.
 */
import type { ShellSeparator } from "./shellSegments.js";

/**
 * Whether a `cd` after this separator may leave the shell where it was: after `&&` or `||` it may be skipped, as
 * `false && cd /tmp; rm x` removes `x` where the shell stood, and after `|` it runs in a subshell.
 *
 * @param before the separator ending the segment before the `cd`
 * @returns `true` when the `cd` may not move the shell
 */
export function mayNotMove({ before }: { before: ShellSeparator | undefined }): boolean {
  return before === "&&" || before === "||" || before === "|";
}

/**
 * Each directory once, in order.
 *
 * @returns the directories with every repeat dropped, an unresolved one kept once
 */
export function distinct({ cwds }: { cwds: readonly (string | undefined)[] }): readonly (string | undefined)[] {
  return [...new Set(cwds)];
}

/**
 * Where a `cd x || …` chain stays: the first `cd` of it to succeed is the one the shell stays in.
 *
 * @param orElse where an earlier `cd` of the chain already leaves the shell, if one does
 * @param steps this `cd`'s readings, each naming where the shell stands once its alternative is done
 * @returns `orElse` when an earlier `cd` holds it, else every place this `cd` names
 */
export function firstOrElse({
  orElse,
  steps,
}: {
  orElse: readonly string[];
  steps: readonly { readonly orElse: string | undefined }[];
}): readonly string[] {
  if (orElse.length > 0) {
    return orElse;
  }
  return steps.flatMap((step) => (step.orElse === undefined ? [] : [step.orElse]));
}

/**
 * Every directory the shell has stood in, one of which `OLDPWD` names (`cd <calls> && cd /tmp && rm ~-/x`).
 *
 * @param visited the directories already stood in
 * @param dirs where the shell may stand now, an unresolved one dropped
 * @returns `visited` joined by every resolved directory in `dirs` it does not already hold, in the order first seen
 */
export function joinVisited({
  visited,
  dirs,
}: {
  visited: readonly string[];
  dirs: readonly (string | undefined)[];
}): readonly string[] {
  return [...new Set([...visited, ...dirs.filter((dir): dir is string => dir !== undefined)])];
}

/**
 * The `CDPATH`s the shell may hold after a segment: an assignment after `&&`, `||` or `|`, or before a `|`, may not
 * run or not outlive its subshell, so the ones before it stay possible (`true || CDPATH=<x>; cd calls`).
 *
 * @param now the `CDPATH`s the shell may hold before the segment
 * @param cdPaths the segment's reading from each of them, `after` the value once it has run
 * @param before the separator ending the segment before this one
 * @param separatorAfter the separator ending this segment
 * @returns each `CDPATH` the shell may hold once the segment is done, once
 */
export function nextCdPaths({
  now,
  cdPaths,
  before,
  separatorAfter,
}: {
  now: readonly string[];
  cdPaths: readonly { after: string }[];
  before: ShellSeparator | undefined;
  separatorAfter: ShellSeparator | undefined;
}): readonly string[] {
  const after = cdPaths.map((paths) => paths.after);
  const kept = mayNotMove({ before }) || separatorAfter === "|" ? now : [];
  return [...new Set([...after, ...kept])];
}

/** Whether a separator ends a `cd x || alt`'s alternative — anything but a pipe or a further `||` alternative. */
function endsAlternative({ separator }: { separator: ShellSeparator | undefined }): boolean {
  return separator !== "|" && separator !== "||";
}

/**
 * The directories the shell may stand in once a segment's separator is read, an alternative or a whole list done.
 *
 * @param cwds where the shell may stand after the segment
 * @param orElse where it stands once a pending `cd x || …` alternative is done
 * @param separator the separator ending the segment
 * @param skipped where it stands if a `cd` this and-or list may skip did not run
 * @returns the three sets carried into the next segment
 */
export function listEnd({
  cwds,
  orElse,
  separator,
  skipped,
}: {
  cwds: readonly (string | undefined)[];
  orElse: readonly string[];
  separator: ShellSeparator | undefined;
  skipped: readonly (string | undefined)[];
}): {
  cwds: readonly (string | undefined)[];
  orElse: readonly string[];
  skipped: readonly (string | undefined)[];
} {
  let now = cwds;
  let pending = orElse;
  if (pending.length > 0 && endsAlternative({ separator })) {
    now = pending;
    pending = [];
  }
  if (separator === "&&" || separator === "||" || separator === "|") {
    return { cwds: now, orElse: pending, skipped };
  }
  return { cwds: distinct({ cwds: [...now, ...skipped] }), orElse: pending, skipped: [] };
}
