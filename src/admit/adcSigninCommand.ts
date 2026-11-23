/**
 * The admit hook's walk for a session running `gcloud auth application-default login` itself.
 *
 * That command opens a browser tab AND a localhost redirect listener in the shell that ran it. A session's shell
 * does not wait for the owner: a review seat that ran it moved on, and when the owner signed in the redirect landed
 * on a broken page because nothing was listening. So the
 * command belongs in the OWNER's terminal, carried there by a floating note, and a session reads and waits with
 * `slopweaver google adc` instead (`../cli/commands/google/adc.ts`).
 *
 * A separate walk with its own hatch, beside the raw one in `./hookPayload.ts`, because the raw walk's
 * `SLOPWEAVER_ALLOW_RAW` is exactly what a seat reaches for after `gcloud` is refused — and the incident seat got
 * the command to run somehow. That break-glass never opens this refusal; only `SLOPWEAVER_ALLOW_ADC_SIGNIN` does.
 *
 * Only the LOGIN is caught — `auth application-default login`, and `auth login --update-adc`, which writes the same
 * file through the same listener. `print-access-token`, `auth list` and the rest stay the raw walk's `cloud-cli`
 * class, which the ambient break-glass does open.
 *
 * Two Claude fallback reviews (r1, r2) walked shell spellings past this; each is now a test case. What
 * it still cannot see, by construction: an alias, a function, `eval`, a command held in a variable, a script's own
 * text. It is a tripwire for the natural spellings a seat reaches for, not a shell interpreter.
 */
import { ADC_SIGNIN_COMMAND } from "../gcloud/adc.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { extractShellWord } from "./argumentValue.js";
import { toolName } from "./commandTokens.js";
import { type WalkVerdict, walkSegments } from "./segmentWalk.js";

/** The escape hatch this walk reads. Ambient: it refuses a local command before anything leaves the machine. */
const ADC_SIGNIN_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_ADC_SIGNIN";

/** The words, in order, that make a `gcloud` line the application-default sign-in. */
const LOGIN_WORDS: readonly string[] = ["auth", "application-default", "login"];

/**
 * Words that run the NEXT command rather than being it (`timeout 600`, `sudo -u x`, `script -q /dev/null`), plus the
 * shell keywords a group, a test or a loop body opens on. The r1 review ran `timeout 600 gcloud auth
 * application-default login` past every walk — `timeout` killing the listener is exactly the stranding this gate exists to prevent — and
 * r2 added `gtimeout`, the one macOS actually has, and `arch`/`stdbuf`/`unbuffer`/`builtin`.
 */
const RUNS_THE_NEXT_COMMAND: ReadonlySet<string> = new Set([
  "!",
  "arch",
  "builtin",
  "caffeinate",
  "command",
  "do",
  "elif",
  "else",
  "env",
  "exec",
  "gtimeout",
  "if",
  "nice",
  "nohup",
  "script",
  "stdbuf",
  "sudo",
  "then",
  "time",
  "timeout",
  "unbuffer",
  "until",
  "while",
]);

/**
 * One word as the shell would read it ({@link extractShellWord}: `"gcloud"`, `\gcloud`, `g''cloud` and a decoded
 * `$'\x67cloud'` are all `gcloud`), a group's opening bracket gone, and cut at a control or redirection character a
 * word can carry glued on (`login&`, `login>/dev/null`).
 *
 * @param token one whitespace-split word
 * @returns the bare word
 */
function bareWord({ token }: { token: string }): string {
  return extractShellWord({ text: token })
    .replace(/^[({]+/, "")
    .replace(/[&|;<>)].*$/, "");
}

/**
 * Whether a word between a wrapper and the command it runs is one of the WRAPPER's own arguments: a flag, the value
 * after a short flag (`-u me`, `-n 10`), a duration (`600`, `10s`), `/dev/null` (`script -q`), or another wrapper
 * (`builtin exec`). Anything else is a program, so the segment runs THAT — `time grep … gcloud auth
 * application-default login` is a grep, and r2 measured that shape (and a heredoc's `- a bullet` line) refused
 * before this test existed.
 *
 * @param word the bare word
 * @param previous the bare word before it
 * @returns true when the word is the wrapper's, not the wrapped command
 */
function isWrapperArgument({ word, previous }: { word: string; previous: string }): boolean {
  if (toolName({ first: word }) === "gcloud") {
    return false; // `caffeinate -i gcloud …`: never read as a short flag's value
  }
  return (
    word.startsWith("-") ||
    /^-[A-Za-z]$/.test(previous) ||
    /^\d+(?:\.\d+)?[smhd]?$/.test(word) ||
    word === "/dev/null" ||
    RUNS_THE_NEXT_COMMAND.has(toolName({ first: word }))
  );
}

/**
 * Where the command a segment actually runs starts: word 0, or — behind a wrapper or a leftover flag (`exec -a x`
 * once `exec` is stripped) — the first word that is not the wrapper's own argument.
 *
 * @param words the segment's bare words, none empty
 * @returns the index of the command word
 */
function commandIndex({ words }: { words: readonly string[] }): number {
  const first = words[0]!;
  if (!RUNS_THE_NEXT_COMMAND.has(toolName({ first })) && !first.startsWith("-")) {
    return 0;
  }
  const at = words.findIndex((word, index) => index > 0 && !isWrapperArgument({ previous: words[index - 1]!, word }));
  return at === -1 ? words.length : at;
}

/**
 * Whether a segment's words run the application-default sign-in: `gcloud`, then `auth`, `application-default` and
 * `login` in that order among its words — so `gcloud --project x auth application-default login
 * --no-launch-browser` is caught too, and so is one behind a wrapper ({@link RUNS_THE_NEXT_COMMAND}) — or `gcloud
 * auth login --update-adc`.
 *
 * A segment running any other command is not the sign-in even when it names one: the chair's own `hand post`
 * carries the command as its `--literal`, and must pass.
 *
 * @param tokens the segment's words, the command that runs first
 * @returns true for the sign-in
 */
export function isAdcSigninLogin({ tokens }: { tokens: readonly string[] }): boolean {
  const words = tokens.map((token) => bareWord({ token })).filter((word) => word.length > 0);
  if (words.length === 0) {
    return false;
  }
  const start = commandIndex({ words });
  const command = words[start];
  if (command === undefined || toolName({ first: command }) !== "gcloud") {
    return false;
  }
  const rest = words.slice(start + 1);
  const inOrder = ({ wanted }: { wanted: readonly string[] }): boolean =>
    rest.reduce((next, word) => (word === wanted[next] ? next + 1 : next), 0) === wanted.length;
  return inOrder({ wanted: LOGIN_WORDS }) || (inOrder({ wanted: ["auth", "login"] }) && rest.includes("--update-adc"));
}

/**
 * The line with every lone `&` — a background operator, which the segment splitter does not cut on — made a `;`, so
 * `true&gcloud auth application-default login` is two segments (r2). `&&`, `>&`, `&>` and `2>&1` are left alone.
 *
 * @param command the raw shell line
 * @returns the line with lone `&` as a separator
 */
function splitBackgrounded({ command }: { command: string }): string {
  return command.replace(/(?<![&>])&(?![&>])/g, " ; ");
}

/**
 * Refuse a shell line with a segment that runs the application-default sign-in, unless that segment or the
 * environment opens {@link ADC_SIGNIN_OVERRIDE_ENV}.
 *
 * @param command the raw shell line
 * @param env the hook's environment, carrying the ambient hatch
 * @returns the refusal naming `slopweaver google adc`, or allow
 */
export function classifyAdcSigninCommand({
  command,
  env,
}: {
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): WalkVerdict {
  return walkSegments({
    command: splitBackgrounded({ command }),
    env,
    judge: ({ tokens, env: segmentEnv }) => {
      if (!isAdcSigninLogin({ tokens }) || segmentEnv[ADC_SIGNIN_OVERRIDE_ENV] === "1") {
        return { blocked: false };
      }
      const detail =
        "instead run `slopweaver google adc --row <your row>`: it prints the ONE line to send the supervisor, whose " +
        "floating note carries this command to the owner's own terminal, and then run its `--wait` in the background";
      const hatch = { ...hatchFor({ id: "adc-signin" }), command: ADC_SIGNIN_COMMAND };
      return { blocked: true, message: hatchRefusal({ detail, hatch }) };
    },
    overrideEnv: ADC_SIGNIN_OVERRIDE_ENV,
  });
}
