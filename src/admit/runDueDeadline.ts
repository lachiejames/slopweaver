/**
 * The seat end of a caller-imposed deadline on `slopweaver automation run-due`: a session never runs a firing under
 * `timeout`/`gtimeout`, never in a FOREGROUND `Bash` call, whose own harness deadline is the same kill, and never
 * in a BACKGROUND one below the tool's maximum `timeout` — a background call is killed at its own `timeout` too.
 *
 * ## Why a gate
 *
 * `automation run-due` performs a `verb-run` row's effect itself, in a verb child it awaits, and a `verb-run` destination takes no
 * idempotency key, so a run killed before it settles is dead-lettered `OUTCOME_UNKNOWN` — nobody can say whether
 * its effect landed (`skills/automation/reference/exactly-once.md` § The one honest concession). MEASURED
 * twice in two days on `store-backup-daily`, which takes about 45 minutes: one firing killed under a caller's
 * `timeout 1700`, another under the supervisor chair's own tick,
 * `for r in …; do timeout 900 $B recipe run-due --recipe $r …; done`, killed mid-upload. Reproduce the second
 * from the chair's own session transcript with `grep -o 'timeout 900 \$B recipe run-due[^"]*' <transcript>`.
 * No code path wraps run-due; sessions type it.
 *
 * MEASURED again in the shape this gate used to ALLOW: seated `resync-corpus-slack`,
 * `resync-atlas-datadog` and `resync-atlas-vanta` run-dues submitted in the background with no `timeout` were
 * killed at the tool's 30-minute default, one of them after printing `succeeded`, each leaving its token
 * refused as "already started … has not settled". The knowledge register carries the evidence:
 * `slopweaver knowledge recall "run-due background timeout"`.
 *
 * ## The criterion
 *
 * **A non-dry `automation run-due` at a command position that is lexically beneath `timeout`/`gtimeout`, or that
 * any `Bash` call submits without `run_in_background: true`, or with it but a `timeout` below
 * {@link BASH_BACKGROUND_MAX_TIMEOUT_MS}.** A run that outlasts even that maximum still dies; its firing is
 * then judged `HOLDER_GONE` by the next take, and no gate can close that residue. The program is `slopweaver`
 * by any path, a `node`/`tsx` running one, or a bare variable (`$B`, `${B}`) followed by the literal
 * `automation run-due` — the incident's own spelling, whose value no lexer can prove. `--dry-run` never takes a
 * firing, so it is out.
 *
 * ## How far it reads, and what it cannot
 *
 * Every segment and `&`-list, every command substitution and every `bash -c`-style payload, up to
 * {@link MAX_DEPTH} levels, a deadline carried into what the wrapped shell runs. It is a TRIPWIRE, not a fence
 * (AGENTS.md rule 3): a script file, an alias or function, a heredoc fed to a shell, a runner (`yarn`, `npx`)
 * in front of the binary, and a deadline imposed by a parent process are all unread. The in-verb signal trap
 * (`cli/commands/automation/runDueSignal.ts`) is the other half — it names a SIGTERM in the dead-letter row
 * whoever sent it.
 */
import { canonicalNoun } from "../cli/nounAliases.js";
import { commandStarts } from "./commandPositions.js";
import { shellInput } from "./pythonInvocation.js";
import { type ShellWord, shellWords } from "./shellLexing.js";
import { commandSegments } from "./shellSegments.js";
import { backgroundLists } from "./shellWalk.js";

/** The ambient hatch this gate is opened with — declared as `run-due-deadline` in `../hatch/registry.ts`. */
export const RUN_DUE_DEADLINE_HATCH = "SLOPWEAVER_ALLOW_RUN_DUE_DEADLINE";

/** The Bash tool's maximum `timeout` for a background call, in milliseconds — the one a run-due must carry. */
export const BASH_BACKGROUND_MAX_TIMEOUT_MS = 7_200_000;

/** The Bash tool's `timeout` for a background call that names none, in milliseconds: its documented default. */
const BASH_BACKGROUND_DEFAULT_TIMEOUT_MS = 1_800_000;

/** How many nested command sources (substitutions, shell payloads) one call is followed through. */
const MAX_DEPTH = 4;

/** The exec wrappers that KILL what they run when their duration elapses. */
type DeadlineWrapper = "timeout" | "gtimeout";

/** Shells whose `-c` payload is a command line of its own. */
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** Script hosts that run the `slopweaver` binary named as their first operand. */
const SCRIPT_HOSTS: ReadonlySet<string> = new Set(["node", "tsx"]);

/** A word that is one bare variable and nothing else: `$B`, `${B}`. */
const BARE_VARIABLE = /^\$(?:[A-Za-z_]\w*|\{[A-Za-z_]\w*\})$/u;

/** What the gate found in one `Bash` call. */
export type RunDueDeadlineFinding =
  | { readonly kind: "deadline-wrapper"; readonly invocation: string; readonly wrapper: DeadlineWrapper }
  | { readonly kind: "foreground"; readonly invocation: string }
  | { readonly kind: "background-cap"; readonly invocation: string; readonly limitMs: number }
  | { readonly kind: "allowed" };

/** One non-dry run-due the walk found, and the deadline it runs beneath, if any. */
interface Invocation {
  readonly text: string;
  readonly wrapper: DeadlineWrapper | undefined;
}

/**
 * Classify one `Bash` call: does it run a firing of `automation run-due` that a deadline can kill?
 *
 * @param command the raw `Bash` command
 * @param runInBackground whether the call carried `run_in_background: true`, which escapes the foreground deadline
 * @param timeoutMs the call's own `timeout`, absent when the caller named none and the tool default applies
 * @returns a wrapped run first, then a foreground one, then a background one below the maximum, else `allowed`
 */
export function classifyRunDueDeadline({
  command,
  runInBackground,
  timeoutMs,
}: {
  command: string;
  runInBackground: boolean;
  timeoutMs: number | undefined;
}): RunDueDeadlineFinding {
  const found = walkLine({ depth: 0, line: command, wrapper: undefined });
  const wrapped = found.find((invocation) => invocation.wrapper !== undefined);
  if (wrapped?.wrapper !== undefined) {
    return { invocation: wrapped.text, kind: "deadline-wrapper", wrapper: wrapped.wrapper };
  }
  const first = found[0];
  if (first === undefined) {
    return { kind: "allowed" };
  }
  if (!runInBackground) {
    return { invocation: first.text, kind: "foreground" };
  }
  let limitMs = BASH_BACKGROUND_DEFAULT_TIMEOUT_MS;
  if (timeoutMs !== undefined) {
    limitMs = timeoutMs;
  }
  if (limitMs < BASH_BACKGROUND_MAX_TIMEOUT_MS) {
    return { invocation: first.text, kind: "background-cap", limitMs };
  }
  return { kind: "allowed" };
}

/**
 * Every non-dry run-due in one command line, each segment and `&`-list walked on its own.
 *
 * @param line the command line
 * @param wrapper the deadline an enclosing wrapped shell already runs this line beneath
 * @param depth how many nested sources deep this line is
 * @returns the invocations, in source order
 */
function walkLine({
  depth,
  line,
  wrapper,
}: {
  depth: number;
  line: string;
  wrapper: DeadlineWrapper | undefined;
}): readonly Invocation[] {
  if (depth > MAX_DEPTH) {
    return [];
  }
  return commandSegments({ command: line.replaceAll("\\\n", "") }).flatMap((segment) => {
    // A substitution runs before the wrapper on its own line does, so it inherits only the ENCLOSING deadline.
    const substituted = shellWords({ text: segment.command }).substitutions.flatMap((inner) =>
      walkLine({ depth: depth + 1, line: inner, wrapper }),
    );
    const listed = backgroundLists({ text: segment.command }).flatMap((words) =>
      walkList({ depth, inherited: wrapper, words }),
    );
    return [...substituted, ...listed];
  });
}

/**
 * Every non-dry run-due in one command list, a deadline wrapper at an earlier command start covering every
 * start after it — in one list with no separator, a later start is only ever reached through that wrapper.
 *
 * @param words the list's words, redirections removed
 * @param inherited the deadline an enclosing wrapped shell runs this list beneath
 * @param depth how many nested sources deep the list is
 * @returns the invocations, in source order
 */
function walkList({
  depth,
  inherited,
  words,
}: {
  depth: number;
  inherited: DeadlineWrapper | undefined;
  words: readonly ShellWord[];
}): readonly Invocation[] {
  const found: Invocation[] = [];
  let wrapper = inherited;
  for (const start of commandStarts({ words })) {
    const name = programName({ word: words[start]! });
    const tail = runDueTail({ start, words });
    if (tail !== undefined && !tail.some((word) => word.text === "--dry-run")) {
      found.push({
        text: words
          .slice(start)
          .map((word) => word.text)
          .join(" "),
        wrapper,
      });
    }
    if (SHELLS.has(name)) {
      const input = shellInput({ args: words.slice(start + 1) });
      if (input.kind === "payload") {
        found.push(...walkLine({ depth: depth + 1, line: input.line, wrapper }));
      }
    }
    if (name === "timeout" || name === "gtimeout") {
      wrapper = name;
    }
  }
  return found;
}

/**
 * The words after `automation run-due` when a command starting at `start` is one, else `undefined`.
 *
 * @param words the list's words
 * @param start the command start to read from
 * @returns run-due's own arguments, or `undefined` when this start runs something else
 */
function runDueTail({
  start,
  words,
}: {
  start: number;
  words: readonly ShellWord[];
}): readonly ShellWord[] | undefined {
  const head = words[start]!;
  const name = programName({ word: head });
  let verbAt: number | undefined;
  if (name === "slopweaver" || (head.dynamic && BARE_VARIABLE.test(head.text.replace(/^\(+/u, "")))) {
    verbAt = start + 1;
  }
  const script = words[start + 1];
  if (SCRIPT_HOSTS.has(name) && script !== undefined && programName({ word: script }) === "slopweaver") {
    verbAt = start + 2;
  }
  if (verbAt === undefined) {
    return undefined;
  }
  const noun = words[verbAt]?.text;
  // `recipe` is the noun's earlier name and still runs the same verb (`cli/nounAliases.ts`).
  if (noun === undefined || canonicalNoun({ noun }) !== "automation") {
    return undefined;
  }
  if (words[verbAt + 1]?.text !== "run-due") {
    return undefined;
  }
  return words.slice(verbAt + 2);
}

/**
 * A command word's program basename, a subshell's leading `(` dropped: `(/x/bin/slopweaver` reads `slopweaver`.
 *
 * @param word the word at a command start
 * @returns the basename
 */
function programName({ word }: { word: ShellWord }): string {
  const bare = word.text.replace(/^\(+/u, "");
  return bare.slice(bare.lastIndexOf("/") + 1);
}
