/**
 * A hand step never carries a command the fleet can run — a POSTING rule, for `./step.ts`'s `linkAsLiteral` reason.
 *
 * The owner's only act on a sign-in is the sign-in itself, in a browser the fleet already opened. A note that hands
 * them `cd ~/dev/acme-admin && yarn nx run @acme/cloud-datadog:backtest-shot -- --login …` to paste into a terminal
 * makes them do the fleet's errand. That script opens a headed browser and waits for the window to close: a seat runs
 * it in the background, the window comes up on the owner's screen by itself, and the note says only where to sign in
 * (`opened` plus `where`). The `resync-signed-out` monitor follows the same shape — it opens the page itself rather
 * than handing over `$SLOPWEAVER_HOME/chrome-pin.sh <origin>` to paste (`../monitor/resyncSignedOut.ts`).
 *
 * **The criterion.** A `literal` is a shell command when, behind a `where` sending the owner to a terminal
 * ({@link whereKind}), it opens on a tool {@link COMMAND_HEADS} lists, a path or a program-shaped word — and anywhere,
 * the supervisor chat included, when it opens on a listed tool with a flag, path or URL straight after it, on a real
 * `slopweaver <noun> <verb>`, an environment assignment or a script's path ({@link isShellCommand}); comment lines and
 * a `$ ` prompt marker are dropped first. Such a literal posts only when EVERY
 * segment — split, unwrapped and descended exactly as the admit walks do (`../admit/segmentWalk.ts`) — runs a
 * command in {@link OWNER_HANDS_COMMANDS}, each row naming why the fleet cannot run it: the owner's secret or password,
 * their approval, a grant only their account holds, or a sign-in whose localhost listener must live in their own
 * terminal (`skills/hand/reference/waiting-on-a-sign-in.md`) — or runs nothing of its own
 * ({@link RUNS_NOTHING}: `cd`, `export`, the `pbpaste` feeding a `secrets set`).
 *
 * **A tell, not a fence.** A command on a page `where` with a head word this list does not know posts; a
 * register row is matched by its words, not by what the program will do, so `sudo` or `op run --` in front of an
 * errand of the fleet's posts as the owner's. The other way, a value is read by its shape: one opening on a listed tool with
 * a flag straight after it (`curl -k removed`, as a title) is refused, a multi-word value at a terminal's own prompt reads as
 * a command, and a `where` is read by its opening phrase, so one a reader could parse two ways may be read wrong — the refusal names the segment, so the seat sees which. No hatch: a command that
 * genuinely needs the owner's hands is a new register row, visible in the diff, never an override at the call site.
 *
 * MEASURED over the 42 distinct literals the hand register had carried: the two backtest-shot sign-ins,
 * the three `chrome-pin.sh` monitor cards, three `open …/index.html` pages, `slopweaver slack delete`, `slopweaver
 * handover resume` and `slopweaver write vanta upload-evidence` are refused; every `sudo`, `op`, `secrets set`,
 * `codex login`, `gcloud auth login`, `gh auth refresh`, `claude` sign-in, the `--approve` send, the IAM grant and
 * the plain-text values post. Reproduce by
 * replaying `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then
 * `fleetRunnableLiteral`.
 */
import { extractShellWord } from "../admit/argumentValue.js";
import { toolName } from "../admit/commandTokens.js";
import { walkSegments } from "../admit/segmentWalk.js";
import { verbsOfNoun } from "../cli/nounGroups.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/** Why a command is the owner's to run and never the fleet's. */
type OwnerHandsReason = "owner-secret" | "owner-approval" | "owner-privilege" | "listener-sign-in";

/** One command only the owner's hands can run,matched against a segment's bare words, its program first. */
export interface OwnerHandsCommand {
  readonly id: string;
  /** The program the command runs, which {@link matches} requires as `words[0]` — what {@link OWNER_PROGRAMS} lists. */
  readonly program: string;
  readonly reason: OwnerHandsReason;
  /** Whether a segment's words run this command — `words[0]` is the program, already reduced to its basename. */
  readonly matches: (options: { words: readonly string[] }) => boolean;
}

/**
 * Whether `wanted` appears among `words` in order, other words allowed between (`gcloud --project x auth login`).
 *
 * @param words the segment's words after the program
 * @param wanted the words that must appear, in order
 * @returns true when every wanted word appears in order
 */
function inOrder({ words, wanted }: { words: readonly string[]; wanted: readonly string[] }): boolean {
  return words.reduce((next, word) => (word === wanted[next] ? next + 1 : next), 0) === wanted.length;
}

/** Every command a hand step may carry as a literal, and why the fleet cannot run it for the owner. */
export const OWNER_HANDS_COMMANDS: readonly OwnerHandsCommand[] = [
  { id: "sudo", matches: ({ words }) => words[0] === "sudo", program: "sudo", reason: "owner-secret" },
  { id: "1password-cli", matches: ({ words }) => words[0] === "op", program: "op", reason: "owner-secret" },
  {
    id: "secrets-set",
    matches: ({ words }) => words[0] === "slopweaver" && words[1] === "secrets" && words[2] === "set",
    program: "slopweaver",
    reason: "owner-secret",
  },
  {
    id: "slack-send-approved",
    matches: ({ words }) =>
      words[0] === "slopweaver" &&
      words[1] === "slack" &&
      words.some((word) => word === "--approve" || word.startsWith("--approve=")),
    program: "slopweaver",
    reason: "owner-approval",
  },
  {
    id: "gcloud-sign-in",
    matches: ({ words }) => words[0] === "gcloud" && inOrder({ wanted: ["auth", "login"], words: words.slice(1) }),
    program: "gcloud",
    reason: "listener-sign-in",
  },
  {
    id: "gcloud-iam-grant",
    matches: ({ words }) => words[0] === "gcloud" && words.some((word) => word.endsWith("add-iam-policy-binding")),
    program: "gcloud",
    reason: "owner-privilege",
  },
  {
    id: "codex-sign-in",
    matches: ({ words }) => words[0] === "codex" && words[1] === "login",
    program: "codex",
    reason: "listener-sign-in",
  },
  {
    id: "github-cli-sign-in",
    matches: ({ words }) =>
      words[0] === "gh" && words[1] === "auth" && (words[2] === "login" || words[2] === "refresh"),
    program: "gh",
    reason: "listener-sign-in",
  },
  {
    id: "claude-sign-in",
    matches: ({ words }) =>
      words[0] === "claude" && (words[1] === "auth" || words[1] === "login" || words[1] === "/login"),
    program: "claude",
    reason: "listener-sign-in",
  },
  {
    id: "claude-plan-sign-in",
    matches: ({ words }) => words[0] === "slopweaver" && words[1] === "claude" && words[2] === "signin",
    program: "slopweaver",
    reason: "listener-sign-in",
  },
];

/** Every program one of the owner's commands runs, once each — what the console's ask card lifts a paragraph on. */
export const OWNER_PROGRAMS: readonly string[] = [...new Set(OWNER_HANDS_COMMANDS.map((command) => command.program))];

/**
 * Programs whose name says the literal is a command line — at any length behind a command-line `where`, and behind
 * any other one when the line has a shell's shape. A tell: a program missing here, behind a `where` that names no
 * command line, posts.
 */
const COMMAND_HEADS: ReadonlySet<string> = new Set([
  "bash",
  "brew",
  "cd",
  "claude",
  "codex",
  "curl",
  "docker",
  "gcloud",
  "gh",
  "git",
  "kubectl",
  "launchctl",
  "node",
  "npm",
  "npx",
  "op",
  "open",
  "pnpm",
  "sh",
  "slopweaver",
  "sudo",
  "terraform",
  "tsx",
  "yarn",
  "zsh",
]);

/**
 * A segment that only prepares the line for the command after it — moving into a directory, creating the one a
 * sign-in needs (`../plans/login.ts`: `codex login` refuses a `CODEX_HOME` that does not exist), setting a variable
 * — or only produces text a later segment reads (`pbpaste | slopweaver secrets set x`). Neither an errand of the
 * fleet's nor a step of the owner's.
 */
const RUNS_NOTHING: ReadonlySet<string> = new Set([
  ":",
  "cd",
  "echo",
  "export",
  "mkdir",
  "pbpaste",
  "printf",
  "set",
  "true",
  "unset",
]);

/** Package runners that only start the program named after them, so `npx slopweaver …` is `slopweaver …`. */
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(["npx", "pnpm", "yarn"]);

/** A terminal by any name, as a noun — `terminal-access` is a modifier. */
const TERMINAL_NOUN = String.raw`(?:terminal|shell|command line|cmux|iterm2?|ghostty|warp|zsh|bash)(?![-\w])`;

/** An opening phrase naming a terminal: "your own terminal — …", "another terminal", "the checkout's terminal". */
const NAMES_A_TERMINAL = new RegExp(String.raw`\b${TERMINAL_NOUN}`, "i");

/** A `where` sending the owner into a terminal anywhere in it: "the acme-admin checkout, in a terminal". */
const INTO_A_TERMINAL = new RegExp(String.raw`\b(?:in|into)\s+(?:[\w'-]+\s+){0,3}?${TERMINAL_NOUN}`, "i");

/**
 * An opening phrase naming a box the owner types a value into — a field, a title, a prompt a program put up — even inside a
 * terminal: "the commit message prompt in your terminal". A shell's own prompt is the terminal itself.
 */
const A_VALUE_BOX = /\b(?:field|form|thread|title|name|box|body|page|prompt|status|description)$/i;

/** A shell's own prompt, which takes commands. */
const A_SHELL_PROMPT = /\b(?:terminal|shell)\s+prompt$/i;

/** An instruction ahead of the place itself: "paste it in any terminal", "Run in a terminal". */
const LEADING_INSTRUCTION = /^\s*(?:(?:paste|run|type|enter)(?:\s+(?:it|this|that))?\s+)?(?:(?:in|into)\s+)?/i;

/**
 * Where a `where`'s opening phrase ends — the place the owner pastes, before what it is about: "the Linear issue title for
 * the cmux sidebar bug" opens on a Linear title.
 */
const OPENING_PHRASE_END = /[;,:]|\s[—–-]\s|\s(?:for|in|of|on|about|from|with|to)\s/i;

/** An argument only a command line carries straight after its program: a flag, a path or a URL. */
const COMMAND_ARGUMENT = /^(?:--?[A-Za-z]|[~.]?\/\S|[a-z][a-z0-9+.-]*:\/\/)/;

/** A shell prompt's marker pasted with the command, `$ ` or `% `, which hides nothing. */
const PROMPT_MARKER = /^(\s*)[$%]\s+/;

/** A first word that is an environment assignment ahead of a program. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A first word that is a path — absolute, home, relative or through a variable; `$155/month` is a price, not one. */
const PATH = /^(?:[/~.]|\$\{?[A-Za-z_])/;

/** A path a shell runs as a script wherever it is pasted, where `/Users/x/report final.pdf` is a file to pick. */
const SCRIPT_PATH = /\.(?:sh|bash|zsh|js|mjs|cjs|ts|py)$/;

/**
 * A first word shaped like a program's name, a version suffix allowed (`python3.11`), which only a `where` naming a
 * command line makes one; a host (`acme.1password.com`) is not.
 */
const PROGRAM_NAME = /^[a-z][a-z0-9_-]*(?:\.\d+)*$/;

/** How much of a refused segment the refusal quotes. */
const QUOTE_CAP = 100;

/**
 * Whether a literal is a command line rather than a value the owner pastes into a page or a prompt. The `where` decides
 * first ({@link whereKind}). In a terminal a known program is a command at any length, and so is a longer line
 * opening on a path or a program-shaped word. Anywhere else — a page, a field, the supervisor chat — a known program
 * is a command only with a flag, path or URL straight after it, or as a real `slopweaver <noun> <verb>`: so
 * `slopweaver gmail desktop` typed as an OAuth client's name, `git push --force is blocked` typed as a title and
 * `codex review it first, then land it` typed to the supervisor are the owner's words. Past that a single word is a value,
 * and a longer line is a command when it opens on an assignment or a script's path.
 *
 * @param literal the paste, comment lines already gone
 * @param where where the step says it goes
 * @returns true for a command line
 */
export function isShellCommand({ literal, where }: { literal: string; where: string | undefined }): boolean {
  const words = literal.trim().split(/\s+/);
  const first = words[0]!;
  const terminal = whereKind({ where }) === "terminal";
  if (COMMAND_HEADS.has(toolName({ first }))) {
    const argument = words[1];
    return terminal || (argument !== undefined && COMMAND_ARGUMENT.test(argument)) || namesASlopweaverVerb({ words });
  }
  if (words.length === 1) {
    return false;
  }
  if (ASSIGNMENT.test(first)) {
    return true;
  }
  if (PATH.test(first)) {
    return terminal || SCRIPT_PATH.test(first);
  }
  return where !== undefined && terminal && PROGRAM_NAME.test(first);
}

/**
 * Whether a line is `slopweaver <noun> <verb>` (a package runner in front allowed) naming a verb the CLI really has,
 * read from its own registry — `slopweaver handover resume x` is one, `slopweaver PRs can auto-merge` is words.
 *
 * @param words the line's words
 * @returns true for a real verb
 */
function namesASlopweaverVerb({ words }: { words: readonly string[] }): boolean {
  const named = PACKAGE_RUNNERS.has(words[0]!) ? words.slice(1) : words;
  const noun = named[1];
  const verb = named[2];
  if (named[0] !== "slopweaver" || noun === undefined || verb === undefined) {
    return false;
  }
  const verbs = verbsOfNoun({ noun });
  return verbs !== undefined && Object.hasOwn(verbs, verb);
}

/**
 * What a `where` sends the owner to. A box the owner types a value into is a `page` even inside a terminal; a terminal
 * named in the opening phrase, or as the place they go into, is a `terminal`; anything else — the supervisor chat
 * included, which reads what the owner types as their words — is a `page`. No `where` at all reads as a terminal.
 *
 * @param where where the step says it goes
 * @returns the kind of place
 */
export function whereKind({ where }: { where: string | undefined }): "terminal" | "page" {
  if (where === undefined) {
    return "terminal";
  }
  const opening = where.replace(LEADING_INSTRUCTION, "").split(OPENING_PHRASE_END)[0]!.trim();
  if (A_VALUE_BOX.test(opening) && !A_SHELL_PROMPT.test(opening)) {
    return "page";
  }
  return NAMES_A_TERMINAL.test(opening) || INTO_A_TERMINAL.test(where) ? "terminal" : "page";
}

/**
 * A literal with its comment lines gone and any shell prompt marker off its lines, so `# paste this` above a command
 * neither is a segment nor hides one, and `$ yarn …` is `yarn …`.
 *
 * @param literal the paste
 * @returns the lines a shell would run
 */
function withoutCommentLines({ literal }: { literal: string }): string {
  return literal
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.replace(PROMPT_MARKER, "$1"))
    .join("\n");
}

/**
 * A segment's words as the program that runs: grouping brackets off its edges, its program a basename, and a
 * package runner in front of `slopweaver` dropped.
 *
 * @param tokens the segment's words as the walk split them
 * @returns the bare words, program first
 */
function programWords({ tokens }: { tokens: readonly string[] }): readonly string[] {
  const words = tokens
    .map((token) =>
      bareWord({ token })
        .replace(/^[({]+/, "")
        .replace(/[)}]+$/, ""),
    )
    .filter((word) => word.length > 0);
  const program = words[0];
  if (program === undefined) {
    return [];
  }
  const named = [toolName({ first: program }), ...words.slice(1)];
  const next = named[1];
  if (PACKAGE_RUNNERS.has(named[0]!) && next !== undefined && toolName({ first: next }) === "slopweaver") {
    return ["slopweaver", ...named.slice(2)];
  }
  return named;
}

/**
 * One word as the shell reads it ({@link extractShellWord}), so `"slopweaver"`, `'login'` and a decoded
 * `$'\x67cloud'` match.
 *
 * @param token one whitespace-split word
 * @returns the bare word
 */
function bareWord({ token }: { token: string }): string {
  return extractShellWord({ text: token });
}

/**
 * The register row a segment's words run, or `undefined` when none does.
 *
 * @param words the segment's bare words, its program first and already a basename
 * @returns the row
 */
export function ownerHandsCommand({ words }: { words: readonly string[] }): OwnerHandsCommand | undefined {
  return OWNER_HANDS_COMMANDS.find((command) => command.matches({ words }));
}

/**
 * Every segment of a literal as the program words it runs — split, unwrapped and descended exactly as
 * {@link fleetRunnableSegment} reads it, comment lines and prompt markers gone — so a sibling rule reads a paste the
 * same way this one does.
 *
 * @param literal the paste
 * @returns each segment's bare words, program first; an empty segment is left out
 */
export function literalSegmentWords({ literal }: { literal: string }): readonly (readonly string[])[] {
  const segments: (readonly string[])[] = [];
  walkSegments({
    command: withoutCommentLines({ literal }),
    env: {},
    judge: ({ tokens }) => {
      const named = programWords({ tokens });
      if (named.length > 0) {
        segments.push(named);
      }
      return { blocked: false };
    },
    reading: "script",
  });
  return segments;
}

/**
 * The first segment of a command literal that runs something the fleet could run itself.
 *
 * @param literal the command line
 * @returns that segment's text, or `undefined` when every segment is the owner's or runs nothing
 */
export function fleetRunnableSegment({ literal }: { literal: string }): string | undefined {
  const verdict = walkSegments({
    command: literal,
    env: {},
    judge: ({ tokens }) => {
      const named = programWords({ tokens });
      const program = named[0];
      if (program === undefined || RUNS_NOTHING.has(program) || ownerHandsCommand({ words: named }) !== undefined) {
        return { blocked: false };
      }
      return { blocked: true, message: tokens.map((token) => bareWord({ token })).join(" ") };
    },
    reading: "script",
  });
  return verdict.blocked ? verdict.message : undefined;
}

/**
 * The refusal for a step whose literal is a command the fleet could run itself.
 *
 * @param step the step a caller is about to record
 * @returns the refusal naming the runnable segment, or `undefined` when the literal is no command or only the owner's
 */
export function fleetRunnableLiteral({ step }: { step: HandStep }): HandStepError | undefined {
  if (step.literal === undefined) {
    return undefined;
  }
  const literal = withoutCommentLines({ literal: step.literal });
  if (literal.trim().length === 0 || !isShellCommand({ literal, where: step.where })) {
    return undefined;
  }
  const segment = fleetRunnableSegment({ literal });
  if (segment === undefined) {
    return undefined;
  }
  const quoted = segment.length > QUOTE_CAP ? `${segment.slice(0, QUOTE_CAP - 1)}…` : segment;
  return HandStepErrors.invalidField({
    field: "literal",
    why:
      `is a command the fleet can run itself (\`${quoted}\`) — run it from the session, in the background when it ` +
      "waits on the owner (a browser it opens for a sign-in), then post only what is left for the owner's hands: " +
      "sign in in the window it opened, with --opened <the page> and --where naming that window. A literal command " +
      "carries only the owner's secret, password or approval, a grant only the owner's account holds, or a sign-in " +
      "listener that must live in the owner's own terminal (OWNER_HANDS_COMMANDS, src/hand/runnableLiteral.ts)",
  });
}
