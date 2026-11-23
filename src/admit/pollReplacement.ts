/**
 * The ONE command a refused poll should have been — named in the poll gate's refusal, so the refusal points at
 * the replacement instead of at a shape.
 *
 * MEASURED over one week: the gate refused 540 re-reads
 * while naming only `Monitor`, a blocking `TaskOutput` and `github checks --wait`, and sessions then wrote 568
 * foreground loops — 507 of them around a slopweaver verb. A gate that refuses a shape without naming its
 * replacement is how those got written. The unit test ties every row's flag to that verb's REAL flag spec, so
 * a row cannot outlive the flag it names.
 *
 * ## The replacement is not always the verb the loop already runs
 *
 * RE-MEASURED over 185,333 Bash calls deduplicated by tool-use id (repro: extract every Bash
 * `tool_use` from `~/.claude/projects/**`, dedupe by `.id`, `grep -E '(while|for) .*sleep [0-9]'`):
 * the loop rate halved after the wait contract landed, 6.20 per 1,000 Bash calls to 3.02, and the largest
 * surviving class was a merge watch — `github read <pr-url>` or `github enqueue --dry-run` re-run until
 * `merged` came back true. `github checks --number <n> --until merge` already did exactly that, so the gap was
 * never capability: a row keyed on the verb the LOOP runs could only ever name a flag that verb owns. So a row
 * names its own verb, and matching is by the loop's whole text rather than by the polled verb's name.
 */

/** One verb whose hand-rolled loop has a one-call replacement. */
export interface WaitReplacement {
  /** The verb as the help-truth ratchet names it (`turn review`), which the test resolves to a flag spec. */
  readonly verb: string;
  /** EVERY pattern must match the refused command's text for this row to be the answer. */
  readonly patterns: readonly RegExp[];
  /** The flag that makes the verb wait. */
  readonly flag: string;
  /** The command to name. `<n>` is replaced by the pull-request number the loop's own text carries. */
  readonly command: string;
}

/**
 * Every verb that waits, most specific first — and ORDER IS LOAD-BEARING. A measured merge-watch loop names
 * `github read`, `github enqueue` and `github checks` in one command, and `pollReplacement` takes the first
 * match, so the two rows that recognise a whole WATCH have to sit above the rows that recognise one verb.
 */
export const WAIT_REPLACEMENTS: readonly WaitReplacement[] = [
  {
    command: "slopweaver github checks --number <n> --until merge",
    flag: "--until",
    patterns: [/\bgithub\s+(?:read|enqueue)\b/, /\bmerged\b/i],
    verb: "github checks",
  },
  {
    command: "slopweaver github checks --number <n> --until any",
    flag: "--until",
    patterns: [/\bgithub\s+read\b/, /\/pull\/\d+/],
    verb: "github checks",
  },
  {
    command: "slopweaver github checks --number <n> --wait (or --until review|any|merge)",
    flag: "--wait",
    patterns: [/\bgithub\s+checks\b/],
    verb: "github checks",
  },
  {
    command: "slopweaver github stack push --form <json> --wait",
    flag: "--wait",
    patterns: [/\bgithub\s+stack\s+push\b/],
    verb: "github stack push",
  },
  {
    command: "slopweaver turn review --dispatch <id> --poll --wait",
    flag: "--wait",
    patterns: [/\bturn\s+review\b/],
    verb: "turn review",
  },
  {
    command: "slopweaver machine capacity --wait",
    flag: "--wait",
    patterns: [/\bmachine\s+capacity\b/],
    verb: "machine capacity",
  },
  {
    command: "slopweaver cmux spawn <slug> --model <model> --wait",
    flag: "--wait",
    patterns: [/\bcmux\s+spawn\b/],
    verb: "cmux spawn",
  },
];

/** The three shapes a measured merge-watch loop carries its pull-request number in. */
const NUMBER_PATTERNS: readonly RegExp[] = [/\/pull\/(\d+)/, /--pr\s+(\d+)/, /--number\s+(\d+)/];

/**
 * The pull-request number a refused loop names, so the replacement can be run as printed.
 *
 * Deliberately conservative: with no match the caller keeps the `<n>` placeholder, because a refusal naming
 * `--number <n>` is still strictly better than one naming a file wait for a provider read.
 *
 * @param command the refused call's command text
 * @returns the first number found, or `undefined`
 */
export function pullRequestNumber({ command }: { command: string }): string | undefined {
  for (const pattern of NUMBER_PATTERNS) {
    const found = pattern.exec(command);
    if (found !== null) {
      return found[1];
    }
  }
  return undefined;
}

/**
 * The one-call replacement for a refused poll: the verb that waits on what this loop is watching,
 * `slopweaver wait --pid` for a pid probe, `slopweaver wait --file` for a file read, and nothing for a task —
 * a blocking `TaskOutput` with a timeout is already that recipe.
 *
 * @param command the refused call's command text, or `undefined` for a non-Bash tool
 * @param target the gate's key for what was polled (`pid:123`, a path, `task:…`, `loop:…`)
 * @returns the command to name, or `undefined` when there is no better one than the generic recipe
 */
export function pollReplacement({
  command,
  target,
}: {
  command: string | undefined;
  target: string;
}): string | undefined {
  if (command !== undefined) {
    const row = WAIT_REPLACEMENTS.find((candidate) => candidate.patterns.every((pattern) => pattern.test(command)));
    if (row !== undefined) {
      const number = pullRequestNumber({ command });
      if (number === undefined) {
        return row.command;
      }
      return row.command.replace("<n>", number);
    }
  }
  const first = target.split(" ")[0]!;
  if (first.startsWith("pid:")) {
    return `slopweaver wait --pid ${first.slice("pid:".length)}`;
  }
  if (first.startsWith("task:") || first.startsWith("loop:")) {
    return undefined;
  }
  return `slopweaver wait --file ${first} --contains <the line that means it finished>`;
}
