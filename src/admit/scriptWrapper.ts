/**
 * The script half of the raw-bypass classifier: a repo-local script that shells `gh` internally is a GitHub
 * reach the token walk in `rawTools.ts` can never see, because the only token it is shown is the script's
 * own name.
 *
 * MEASURED in the private work repository's sessions. The owner believed every GitHub
 * interaction was forced through the door in every session, because the plugin loads everywhere. Yet those
 * sessions armed a checked-in `scripts/ship/watchPr.sh` watcher — a `while :` loop over `gh api graphql`,
 * the exact hand-rolled poll `gh pr checks --watch` is blocked for — and it ran, four times, until each
 * watcher died on an unchosen signal. Two things let it through, and this module closes the first:
 *
 * - `classifyRawCommand` resolved `scripts/ship/watchPr.sh --pr <n>` to the tool `watchPr.sh`, matched
 *   nothing, and allowed it. `nohup bash scripts/ship/watchPr.sh …` and `bash -c 'exec scripts/ship/…'`
 *   passed the same way. The `gh` was one level down, in a file the classifier had never been asked to open.
 * - The `Monitor` tool ran the same script with no `PreToolUse` hook matching it at all — `hooks/hooks.json`
 *   registered the admit hook under `Bash` alone. That half is closed in `hookPayload.ts` and the matcher.
 *
 * `docs/hooks/browser-memory-and-limits.md` said that the classifier "cannot follow … a script". That was true and it
 * was also the hole. So this reads the script — ONE level, through an injected reader that the pure walk
 * never performs itself — and judges its text with a rule stricter than the one applied to a direct command:
 * ANY `gh` invocation in a script is a reach, read or write. The ruling behind this was "the door must refuse
 * or redirect any GitHub reach, including a repo-local script that wraps gh", and a script is exactly the
 * place a one-shot read becomes a loop nobody reviewed.
 *
 * Bounded, and stated: only the first level is opened (a script calling a script is not followed), only a
 * token that looks like a script path is tried, and the reader decides what is readable (a binary, a
 * directory, an oversized file all read as nothing). A path the reader cannot resolve — typically a
 * relative path against a `cd` earlier in the same command — is classified as it always was: by name.
 */
import { shellSegments } from "./shellSegments.js";

/**
 * Reads a script's text for the classifier — the one effect the pure walk delegates. Already bound to the
 * tool call's own `cwd` by whoever constructs it (`hookPayload.ts`), so the walk resolves nothing itself.
 * Returns `undefined` for anything that is not a readable text file at that path.
 */
export type ScriptReader = (options: { readonly path: string }) => string | undefined;

/** Words that wrap a command without being it — `nohup bash x.sh`, `exec ./x.sh`, `time x.sh`. */
const COMMAND_WRAPPERS = new Set(["nohup", "exec", "time", "command", "setsid", "caffeinate"]);

/** Shells that run a script file given as their first non-flag argument. */
const SCRIPT_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** Tools the token walk already classifies by name — never opened as if they were scripts. */
const KNOWN_TOOLS = new Set(["gh", "git", "curl", "wget", "cmux"]);

/** The statement prefixes and loop keywords a script line can start with, re-listed here for the line walk. */
const LINE_PREFIXES = new Set(["do", "then", "else", "elif", "{", "!", "until", "while", "if"]);

/**
 * Strip leading `nohup`/`exec`/`time`-style wrapper words, so the thing being run is what gets judged.
 *
 * @param tokens the segment's tokens, env prefix and statement keywords already stripped
 * @returns the tokens with every leading wrapper word removed
 */
function stripCommandWrappers({ tokens }: { tokens: readonly string[] }): readonly string[] {
  let rest = tokens;
  while (rest.length > 0 && COMMAND_WRAPPERS.has(rest[0]!)) {
    rest = rest.slice(1);
  }
  return rest;
}

/** Whether a token names a file a shell would run as a script rather than a tool on `PATH`. */
function looksLikeScriptPath({ token }: { token: string }): boolean {
  return token.includes("/") || /\.(?:sh|bash|zsh|ksh)$/.test(token);
}

/**
 * The script a segment runs, if it runs one: a direct path token (`./x.sh`, `scripts/x.sh`, `/abs/x.sh`),
 * or a shell given a script file (`bash scripts/x.sh`), optionally behind `nohup`/`exec`/`time`. A shell
 * with `-c` is a wrapper around a command LINE, not a script, and is `classifyShellRunner`'s to open.
 *
 * @param tokens the segment's tokens, env prefix and statement keywords already stripped
 * @returns the script path token, or `undefined` when the segment does not run a script file
 */
export function scriptPathFromTokens({ tokens }: { tokens: readonly string[] }): string | undefined {
  const rest = stripCommandWrappers({ tokens });
  const first = rest[0];
  if (first === undefined) {
    return undefined;
  }
  const base = first.split("/").pop()!;
  if (SCRIPT_SHELLS.has(base)) {
    if (rest.includes("-c")) {
      return undefined;
    }
    const target = rest.slice(1).find((token) => !token.startsWith("-"));
    return target !== undefined && looksLikeScriptPath({ token: target }) ? target : undefined;
  }
  if (KNOWN_TOOLS.has(base)) {
    return undefined;
  }
  return looksLikeScriptPath({ token: first }) ? first : undefined;
}

/**
 * Cut one script line into the command positions a shell would run: the ordinary segment separators plus
 * command substitution (`$(`, backtick), subshells and brace groups, so `fetch() { gh api … }` and
 * `snap=$(gh api …)` each expose their `gh` as a first token.
 *
 * @param line one line of script text
 * @returns the command texts, each trimmed, empty ones dropped
 */
function commandPositions({ line }: { line: string }): readonly string[] {
  const withoutComment = line.replace(/(^|\s)#.*$/, "");
  const opened = withoutComment.replace(/\$\(|`|[(){}]/g, ";");
  return shellSegments({ command: opened })
    .map((segment) => segment.command.trim())
    .filter((command) => command.length > 0);
}

/**
 * The tool a command position invokes, after `VAR=…` assignments, statement keywords, loop keywords and
 * wrapper words — `undefined` when the position is an assignment alone or a bare keyword.
 *
 * @param command one command position's text
 * @returns the invoked tool's basename, and its tokens after it
 */
function invokedTool({
  command,
}: {
  command: string;
}): { readonly tool: string; readonly rest: readonly string[] } | undefined {
  let tokens = command.split(/\s+/).filter((token) => token.length > 0);
  // A script line can open with a function name (`fetch()`), an assignment (`snap=`), a keyword, or a wrapper.
  while (tokens.length > 0) {
    const head = tokens[0]!;
    const skip =
      LINE_PREFIXES.has(head) ||
      COMMAND_WRAPPERS.has(head) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(head) ||
      /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(head) ||
      head === "local" ||
      head === "export";
    if (!skip) {
      break;
    }
    tokens = tokens.slice(1);
  }
  const first = tokens[0];
  if (first === undefined) {
    return undefined;
  }
  return { rest: tokens.slice(1), tool: first.split("/").pop()! };
}

/** The reach one invoked tool represents, or `undefined` when that tool touches nothing outside the door. */
function reachOf({
  invoked,
}: {
  invoked: { readonly tool: string; readonly rest: readonly string[] };
}): { readonly tool: string; readonly reason: string } | undefined {
  if (invoked.tool === "gh") {
    return { reason: "the script shells `gh` internally, reaching GitHub outside the door", tool: "gh" };
  }
  if (invoked.tool === "curl" || invoked.tool === "wget") {
    return {
      reason: `the script shells \`${invoked.tool}\` internally, making an external request outside the door`,
      tool: invoked.tool,
    };
  }
  if (invoked.tool === "git" && invoked.rest.includes("push")) {
    return { reason: "the script pushes with `git` internally, reaching the remote outside the door", tool: "git" };
  }
  return undefined;
}

/**
 * Judge a script's text: does it reach GitHub, or the network, outside the door? A `gh` invocation ANYWHERE
 * is a reach (see the header for why a script gets the stricter rule), as is `curl`/`wget`, and a
 * `git push`. Everything else — `jq`, `sleep`, `git status` — is the script's own business.
 *
 * @param source the script's text
 * @returns the reaching tool and a reason naming it, or `undefined` when the script reaches nothing
 */
export function classifyScriptSource({
  source,
}: {
  source: string;
}): { readonly tool: string; readonly reason: string } | undefined {
  for (const line of source.split("\n")) {
    for (const command of commandPositions({ line })) {
      const invoked = invokedTool({ command });
      const reach = invoked === undefined ? undefined : reachOf({ invoked });
      if (reach !== undefined) {
        return reach;
      }
    }
  }
  return undefined;
}
