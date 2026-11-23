/**
 * Where a `cd` into a home lands — `~`, `~/…`, `$HOME`, `${HOME}`, `$SLOPWEAVER_HOME`, `${SLOPWEAVER_HOME}`, a variable
 * optionally opening a double-quoted span — read from the environment the command runs in. The call-state tripwire
 * (`./callStateGuard.ts`) hands it to the shared cwd resolver so `cd ~/.slopweaver/talk/calls && rm x.jsonl` is judged
 * in the directory it really runs in; without it that relative `rm` had no directory and passed.
 */
import { homedir } from "node:os";

/** A leading `$HOME`/`$SLOPWEAVER_HOME`, braced or bare, and what follows it. */
const HOME_VARIABLE = /^\$(?:\{(HOME|SLOPWEAVER_HOME)\}|(HOME|SLOPWEAVER_HOME)(?![A-Za-z0-9_]))(.*)$/u;

/**
 * The user's home: `HOME` as the command's shell would expand it, else the account's own.
 *
 * @param env the environment the command runs in
 * @returns the absolute home directory
 */
export function userHome({ env }: { env: Readonly<Record<string, string | undefined>> }): string {
  const home = env["HOME"];
  if (home !== undefined) {
    return home;
  }
  return homedir();
}

/**
 * The variable a home pattern matched, from whichever of its first two groups — braced or bare — it filled.
 *
 * @param variable a match whose groups 1 and 2 are the braced and bare spellings, exactly one filled
 * @returns the variable's name
 */
export function matchedVariable({ variable }: { variable: RegExpExecArray }): string {
  const first = variable[1];
  if (first !== undefined) {
    return first;
  }
  return variable[2]!;
}

/**
 * The absolute directory a `cd` target naming a home reaches.
 *
 * @param token the `cd` operand as written, quotes included
 * @param env the environment `HOME` and `SLOPWEAVER_HOME` are read from
 * @returns the directory, or `undefined` when the target holds anything else this cannot know
 */
export function homeCdTarget({
  token,
  env,
}: {
  token: string;
  env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  const user = userHome({ env });
  // A tilde expands only unquoted.
  if (/^~(?:\/|$)/u.test(token)) {
    return `${user}${token.slice(1)}`;
  }
  // The variable may open a double-quoted span that closes anywhere after it (`"$SLOPWEAVER_HOME"/talk/calls`).
  const opened = token.startsWith('"');
  const variable = HOME_VARIABLE.exec(opened ? token.slice(1) : token);
  if (variable === null) {
    return undefined;
  }
  const value = matchedVariable({ variable }) === "HOME" ? user : env["SLOPWEAVER_HOME"];
  const rest = unquotedRest({ opened, rest: variable[3]! });
  if (value === undefined || value.trim() === "" || rest === undefined || !/^(?:\/|$)/u.test(rest)) {
    return undefined;
  }
  return `${value}${rest}`;
}

/**
 * What follows the variable once its double quotes are taken out, or `undefined` when they do not pair up or it holds
 * anything else the shell would rewrite (an expansion, a single quote, a backslash).
 */
function unquotedRest({ rest, opened }: { rest: string; opened: boolean }): string | undefined {
  const quotes = rest.split('"').length - 1 + (opened ? 1 : 0);
  if (quotes % 2 !== 0 || /[$`'\\]/u.test(rest)) {
    return undefined;
  }
  return rest.replaceAll('"', "");
}
