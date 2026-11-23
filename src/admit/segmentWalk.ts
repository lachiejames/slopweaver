/**
 * The walk a separate admit policy runs over one shell line: every segment, with env assignments and
 * `nohup`/`command`/`exec` stripped off the front, descending into an `sh -c '…'` payload, and with each
 * segment's own inline hatch applied to the environment that segment is judged under.
 *
 * Shared by the walks that sit beside the raw one in `./hookPayload.ts` with a hatch of their own — the
 * wrong-Datadog-site walk and the ADC sign-in walk — so a wrapper one of them learns to look through, the other
 * looks through too. A review pass found `bash -c 'open https://app.datadoghq.com/logs'` walking straight past
 * the first version of the site walk. It does NOT see an alias, a function, a command in a variable, or a
 * script's own text.
 */
import { extractShellWord } from "./argumentValue.js";
import { stripEnvPrefix, toolName } from "./commandTokens.js";
import { ansiCQuoted } from "./heredocDelimiter.js";
import { hasSegmentInlineEnvironmentOverride, shellSegments } from "./shellSegments.js";

/** Prefix commands that run the next word as the command. */
const PREFIX_COMMANDS: ReadonlySet<string> = new Set(["command", "exec", "nohup"]);

/** Shells whose `-c` payload is itself a command line. */
const SHELL_RUNNERS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** The `$` of a `$'…'` (ANSI-C) or `$"…"` (locale) quote, which a shell reads as the quoted text itself. */
const LOCALE_OR_ANSI_C = /^\$(?=["'])/;

/** How many `sh -c` wrappers deep the walk looks before it stops. */
const MAX_DEPTH = 3;

/** A refusal, or allow. */
export type WalkVerdict = { readonly blocked: true; readonly message: string } | { readonly blocked: false };

/** Judges one segment's words — the command that actually runs first — under that segment's environment. */
export type SegmentJudge = (args: {
  tokens: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
}) => WalkVerdict;

/**
 * Judge every segment of one shell line, descending into shell wrappers.
 *
 * @param command the raw shell line
 * @param env the hook's environment
 * @param overrideEnv the hatch variable an inline `NAME=1` prefix sets for its own segment only; absent for a walk
 *   with no hatch at all (`../hand/runnableLiteral.ts`), which a placeholder name would only disguise as one
 * @param judge the policy, asked of each segment that is not a shell wrapper
 * @param reading which payloads of a `-c` wrapper are judged: `every` (the default, for a policy that refuses) walks
 *   both the script word the shell runs and the whole rest of the line, and blocks when either does; `script` walks
 *   only the script word, for a policy whose block must not fire on an over-read (`../hand/runnableLiteral.ts`)
 * @returns the first refusal, or allow
 */
export function walkSegments({
  command,
  env,
  overrideEnv,
  judge,
  reading,
}: {
  command: string;
  env: Readonly<Record<string, string | undefined>>;
  overrideEnv?: string | undefined;
  judge: SegmentJudge;
  reading?: "every" | "script";
}): WalkVerdict {
  return walk({ command, depth: 0, env, every: reading !== "script", judge, overrideEnv });
}

/**
 * The recursive half of {@link walkSegments}.
 *
 * @param depth how many `sh -c` wrappers were opened on the way here
 * @returns the first refusal, or allow
 */
function walk({
  command,
  depth,
  env,
  every,
  overrideEnv,
  judge,
}: {
  command: string;
  depth: number;
  env: Readonly<Record<string, string | undefined>>;
  every: boolean;
  overrideEnv: string | undefined;
  judge: SegmentJudge;
}): WalkVerdict {
  for (const [segmentIndex, segment] of shellSegments({ command }).entries()) {
    const segmentEnv =
      overrideEnv !== undefined && hasSegmentInlineEnvironmentOverride({ command, name: overrideEnv, segmentIndex })
        ? { ...env, [overrideEnv]: "1" }
        : env;
    const tokens = commandTokens({ text: segment.command });
    const payloads = shellPayloads({ depth, every, tokens });
    const verdict =
      payloads === undefined
        ? judge({ env: segmentEnv, tokens })
        : firstBlocked({
            verdicts: payloads.map((payload) =>
              walk({ command: payload, depth: depth + 1, env: segmentEnv, every, judge, overrideEnv }),
            ),
          });
    if (verdict.blocked) {
      return verdict;
    }
  }
  return { blocked: false };
}

/**
 * The first refusal among several readings of one wrapper, or allow.
 *
 * @param verdicts each reading's verdict
 * @returns the first that blocks, or allow
 */
function firstBlocked({ verdicts }: { verdicts: readonly WalkVerdict[] }): WalkVerdict {
  const blocked = verdicts.find((verdict) => verdict.blocked);
  if (blocked === undefined) {
    return { blocked: false };
  }
  return blocked;
}

/**
 * One segment's words, with env assignments and `nohup`/`command`/`exec` stripped off the front.
 *
 * @param text the segment's own command text
 * @returns the words, starting at the command that actually runs
 */
function commandTokens({ text }: { text: string }): readonly string[] {
  let tokens = stripEnvPrefix({ tokens: shellWords({ text }) });
  while (tokens[0] !== undefined && PREFIX_COMMANDS.has(toolName({ first: tokens[0] }))) {
    tokens = stripEnvPrefix({ tokens: tokens.slice(1) });
  }
  return tokens;
}

/**
 * Split on whitespace OUTSIDE quotes, keeping the quote characters, so `NAME='/a/My Config' gcloud …` is one
 * assignment and then `gcloud` — a raw whitespace split read `Config'` as the program. A backslash escapes the
 * next character outside single quotes, as the shell reads it.
 *
 * @param text one segment's command text
 * @returns its words, quotes still on them
 */
export function shellWords({ text }: { text: string }): readonly string[] {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote === undefined && /\s/.test(char)) {
      words.push(word);
      word = "";
      continue;
    }
    // A `$'…'` run is kept whole, to its UNESCAPED close: its `\'` does not end it, so `x=$'\'' gcloud …` is an
    // assignment and then `gcloud`, never one word swallowing the command.
    if (quote === undefined && char === "$" && text[index + 1] === "'") {
      const end = ansiCQuoted({ at: index + 2, command: text }).end;
      word += text.slice(index, end);
      index = end - 1;
      continue;
    }
    const escapes = char === "\\" && quote !== "'" && index + 1 < text.length;
    if (escapes) {
      word += char + text[index + 1]!;
      index += 1;
      continue;
    }
    quote = quoteAfter({ char, quote });
    word += char;
  }
  return [...words, word].filter((each) => each.length > 0);
}

/**
 * The quote a word is inside after one more character: its own quote closes it, an opening quote opens one.
 *
 * @param char the character just read
 * @param quote the quote open before it
 * @returns the quote open after it
 */
function quoteAfter({ char, quote }: { char: string; quote: "'" | '"' | undefined }): "'" | '"' | undefined {
  if (char === quote) {
    return undefined;
  }
  if (quote === undefined && (char === "'" || char === '"')) {
    return char;
  }
  return quote;
}

/**
 * Whether a word is a short-flag cluster carrying `c` — `-c`, and `-lc`/`-ec` too, the r2 review's
 * counterexample. Two cheap checks rather than one backtracking pattern.
 *
 * @param token one word
 * @returns true when a shell would read its next words as a command line
 */
function isCommandFlag({ token }: { token: string }): boolean {
  return token.startsWith("-") && !token.startsWith("--") && token.includes("c") && /^[A-Za-z]+$/.test(token.slice(1));
}

/**
 * The command lines a shell wrapper runs, when this segment is one and the walk may still descend.
 *
 * The SCRIPT is the first word after the `-c` flag that is not itself an option (`--`, `-x`, `+e`), every quote
 * resolved and a `$'…'` run DECODED (`$'\x67cloud …'` is `gcloud …`) — and the words after it are `$0`, `$1`…, so `sh -c 'gcloud auth
 * application-default login' sh` runs `gcloud …`. Under `every` the whole rest of the line, one outer quote pair off,
 * is a second reading: a refusing policy then blocks when either does, so a spelling the script reading
 * mis-resolves is still caught by the reading the walk always had.
 *
 * @param tokens the segment's words
 * @param depth how many wrappers were opened on the way here
 * @param every whether the whole-line reading is walked beside the script
 * @returns the payloads to walk, or undefined when the segment is not a wrapper
 */
function shellPayloads({
  tokens,
  depth,
  every,
}: {
  tokens: readonly string[];
  depth: number;
  every: boolean;
}): readonly string[] | undefined {
  const first = tokens[0];
  if (first === undefined || !SHELL_RUNNERS.has(toolName({ first })) || depth >= MAX_DEPTH) {
    return undefined;
  }
  const flag = tokens.findIndex((token) => isCommandFlag({ token }));
  const rest = flag === -1 ? [] : tokens.slice(flag + 1);
  if (rest.length === 0) {
    return undefined;
  }
  const line = rest
    .join(" ")
    .replace(LOCALE_OR_ANSI_C, "")
    .replace(/^(["'])([\s\S]*)\1$/, "$2");
  const script = rest.find((token) => !/^[-+]/.test(token));
  const resolved = script === undefined ? undefined : extractShellWord({ text: script });
  const readings = [resolved, every ? line : undefined].filter((each): each is string => each !== undefined);
  return [...new Set(readings)];
}
