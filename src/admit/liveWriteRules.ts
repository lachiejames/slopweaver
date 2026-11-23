/**
 * The small grammar both bot-turn live-write tables (`./liveWriteMigrations.ts`, `./liveWriteInfra.ts`) are
 * written in: a rule reads one program's argument words and names the operation that makes it a write, or
 * nothing.
 *
 * Every rule matches ANYWHERE in the positional words rather than at a fixed index, and that is deliberate:
 * a filter that cannot know each tool's option grammar sees a flag's value as positional, so `alembic -c
 * alembic.ini upgrade head` and `kubectl -n prod delete pod api` put the verb behind one. The price is a
 * resource NAMED like a verb (`kubectl get pod delete`), which reads as a write and names its own hatch — the
 * direction worth paying for.
 *
 * Pure: words in, an operation or nothing out.
 */

/** What a rule reads: the program's words after its name, and the subset that does not start with `-`. */
export interface RuleInput {
  readonly args: readonly string[];
  readonly positional: readonly string[];
}

/** One rule: the operation that makes this invocation a write, or `undefined` when it is not one. */
export type WriteRule = (input: RuleInput) => string | undefined;

/**
 * The input a rule reads, built from a program's argument words.
 *
 * @param args the words after the program, redirections removed
 * @returns the words and their positional subset
 */
export function ruleInput({ args }: { args: readonly string[] }): RuleInput {
  return { args, positional: args.filter((word) => !word.startsWith("-")) };
}

/**
 * Any positional word that is one of `verbs`.
 *
 * @param verbs the words that each make the invocation a write
 * @returns the rule
 */
export function anyOf({ verbs }: { verbs: readonly string[] }): WriteRule {
  return ({ positional }) => positional.find((word) => verbs.includes(word));
}

/**
 * Two adjacent positional words — a `<group> <verb>` pair such as `migrate deploy` or `secrets set` — anywhere.
 *
 * @param group the words that may open the pair
 * @param verbs the words that, following one of them, make it a write
 * @returns the rule, naming the pair as its operation
 */
export function pairOf({ group, verbs }: { group: readonly string[]; verbs: readonly string[] }): WriteRule {
  return ({ positional }) => {
    const at = positional.findIndex(
      (word, index) => index + 1 < positional.length && group.includes(word) && verbs.includes(positional[index + 1]!),
    );
    return at === -1 ? undefined : `${positional[at]!} ${positional[at + 1]!}`;
  };
}

/**
 * Any positional word matching `pattern` — the `task:name` CLIs (`knex migrate:latest`, `heroku config:set`).
 *
 * @param pattern what a write's word looks like
 * @returns the rule
 */
export function anyMatching({ pattern }: { pattern: RegExp }): WriteRule {
  return ({ positional }) => positional.find((word) => pattern.test(word));
}

/**
 * A program's command words: every dashless word that is not the value of a preceding `valueFlags` option.
 *
 * @param args the words after the program
 * @param valueFlags the options whose NEXT word is their value (`-n prod`), never a command word
 * @returns the command words, in order
 */
export function commandWords({
  args,
  valueFlags,
}: {
  args: readonly string[];
  valueFlags: readonly string[];
}): readonly string[] {
  return args.filter((word, index) => !word.startsWith("-") && !(index > 0 && valueFlags.includes(args[index - 1]!)));
}

/**
 * An ALLOWLIST rule: the invocation is a write unless its first command word is a known read — or a group
 * whose second word is one (`state list`). Inverted on purpose for the tools whose write verbs keep growing:
 * a verb this table has never heard of reads as a write and refuses, never as a read that slips through. A
 * flag value the list does not know shifts the words and refuses too, the same safe direction.
 *
 * @param reads each read subcommand, `true` when the whole subcommand reads, or the second words that do
 * @param valueFlags the options whose next word is their value
 * @returns the rule, naming the first two command words as the operation
 */
export function readsOnly({
  reads,
  valueFlags,
}: {
  reads: Readonly<Record<string, true | readonly string[]>>;
  valueFlags: readonly string[];
}): WriteRule {
  return ({ args }) => {
    const [first, second] = commandWords({ args, valueFlags });
    if (first === undefined || args.includes("--help")) return undefined;
    const read = Object.hasOwn(reads, first) ? reads[first] : undefined;
    if (read === true || (read !== undefined && second !== undefined && read.includes(second))) return undefined;
    return second === undefined ? first : `${first} ${second}`;
  };
}

/**
 * The first of several rules that names an operation.
 *
 * @param rules the rules, in the order they are asked
 * @returns the combined rule
 */
export function either(...rules: readonly WriteRule[]): WriteRule {
  return (input) => rules.map((rule) => rule(input)).find((operation) => operation !== undefined);
}

/**
 * A rule that stands down whenever any argument starts with one of `prefixes` — a `--dry-run`, a `--local`.
 *
 * @param prefixes the argument spellings that make the invocation persist nothing
 * @param rule the rule that applies otherwise
 * @returns the guarded rule
 */
export function unless({ prefixes, rule }: { prefixes: readonly string[]; rule: WriteRule }): WriteRule {
  return (input) =>
    input.args.some((word) => prefixes.some((prefix) => word.startsWith(prefix))) ? undefined : rule(input);
}
