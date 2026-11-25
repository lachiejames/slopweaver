/**
 * The `cmux` noun's flag specs, usage strings and shared resolution.
 *
 * The specs are exported so the help-truth ratchet compares the manifest's literal usage lines against the
 * REAL parser, not against a copy of them — see `fleet/core.ts` for the sibling this mirrors.
 */
import type { CmuxDriver } from "../../../cmux/pickupCommand.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { nonNegativeIntegerFlag } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/**

 * Flags each verb accepts. `spawn` keeps `--dir` (where the board lives), `--driver`, `--model`, `--force`
 * (bypass the Codex quota fast-fail once) and `--require-current-base` (turn the base-freshness advisory into
 * a refusal); `--home` is the state home the session ledger is recorded against.
 *
 * `spawn --plan <alias>` names the ONE registered account the seat SPENDS instead of taking routing's first
 * choice, on either driver: a Codex destination through `cmux/seatRoute.ts`, a Claude plan through
 * `./claudePlanFlag.ts`, where it outranks the role's pin and is judged on its own live gauge. `reseat --plan`
 * is the same Claude half for one relaunched workspace — the chair included — and is refused beside `--all`.
 *
 * `spawn`'s `--build`, `--deps`, `--no-install` and `--dev-build`/`--no-dev-build` are pass-throughs to
 * `worktree/provision.ts`, which a spawn that creates its worktree now goes through — same options, same
 * defaults, one implementation. The dev-build pair carries BOTH halves here even though the emit is the
 * default, so the two provisioning front doors spell the option they gained together the same way; the older
 * singles beside it (`--build`, `--no-install`) predate that and are left as they are rather than widened by
 * a change that is not about them.
 *
 * `--workspace` is a `workspace:N` ref OR a UUID everywhere it appears, and every verb resolves it to the id
 * before addressing anything — see `cmux/client.ts`'s {@link ../../../cmux/client.CmuxTarget} for the measured
 * reason a ref is never passed through raw.
 */
const SPECS = {
  close: { boolean: ["via-card"], string: ["harness", "home", "workspace"] },
  dialog: { boolean: ["dismiss", "json"], string: ["home"] },
  events: {
    boolean: ["follow", "json"],
    repeatable: ["category", "name"],
    string: ["category", "home", "limit", "name", "since", "workspace"],
  },
  list: { boolean: ["full", "json"], string: ["harness"] },
  picture: { boolean: ["json"], string: ["harness"] },
  pin: { boolean: [], string: ["workspace"] },
  processes: { boolean: ["json"], string: ["workspace"] },
  "read-screen": { boolean: ["json"], string: ["scrollback", "surface", "workspace"] },
  reseat: { boolean: ["all", "dry-run", "force", "json"], string: ["home", "model", "plan", "timeout-seconds"] },
  revive: { boolean: ["dry-run", "json"], string: ["bound-seconds", "home"] },
  send: { boolean: ["interrupt"], string: ["delivery", "harness", "home", "surface", "workspace"] },
  spawn: {
    boolean: ["build", "dev-build", "force", "full", "no-dev-build", "no-install", "require-current-base", "wait"],
    string: ["deps", "dir", "driver", "effort", "harness", "home", "model", "plan", "template", "timeout-seconds"],
  },
  stop: { boolean: [], string: ["harness", "surface", "why", "workspace"] },
  strands: { boolean: ["json", "submit"], string: [] },
  submit: { boolean: ["force"], string: ["surface", "workspace"] },
  takeover: { boolean: ["dry-run"], string: ["home"] },
  templates: { boolean: ["json"], string: [] },
  title: { boolean: [], string: ["workspace"] },
  unpin: { boolean: [], string: ["workspace"] },
  usage: { boolean: ["json"], string: ["harness", "home"] },
} satisfies Readonly<Record<string, FlagSpec>>;

/** A `cmux` verb the noun declares a flag spec for — a closed set, so a spec or usage read for one always hits. */
export type CmuxVerb = keyof typeof SPECS;

/** One spec's `--`-prefixed flag names, sorted. */
function flagNamesOf({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const CMUX_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [verb, flagNamesOf({ spec })]),
);

/** The flags that take a value, so a usage line can render `[--x <value>]` for exactly those. */
const WITH_VALUE: ReadonlySet<string> = new Set([
  "--bound-seconds",
  "--category",
  "--delivery",
  "--deps",
  "--dir",
  "--driver",
  "--effort",
  "--harness",
  "--home",
  "--limit",
  "--model",
  "--name",
  "--plan",
  "--scrollback",
  "--since",
  "--surface",
  "--timeout-seconds",
  "--why",
  "--workspace",
]);

/**
 * The flags a verb REQUIRES, as `<verb> <flag>` pairs, rendered unbracketed. `spawn --model`: a
 * spawn with no pin inherited the saved default, which had silently become Fable for the whole fleet
 * (`cmux/modelPin.ts`).
 */
const REQUIRED: ReadonlySet<string> = new Set(["picture --harness", "spawn --model", "usage --harness"]);

/** What each verb's positional tail is called in its usage line. */
const POSITIONALS: Readonly<Record<string, string>> = {
  close: "<workspace>",
  picture: "<handle>",
  reseat: "<workspace>|--all",
  spawn: "<slug>",
  send: "<text>",
  stop: "<workspace>",
  title: "<text>",
};

/**
 * The usage line for one verb, built from its REAL flag spec.
 *
 * @param verb the verb name
 * @returns the usage line
 */
export function cmuxUsage({ verb }: { verb: CmuxVerb }): string {
  const rendered = flagNamesOf({ spec: SPECS[verb] })
    .map((flag) => {
      const shape = WITH_VALUE.has(flag) ? `${flag} <value>` : flag;
      return REQUIRED.has(`${verb} ${flag}`) ? shape : `[${shape}]`;
    })
    .join(" ");
  const tail = POSITIONALS[verb];
  const parts = ["usage: slopweaver cmux", verb, ...(tail === undefined ? [] : [tail]), rendered];
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

/**
 * Parse one cmux verb's flags.
 *
 * @param verb which verb's spec to use
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseCmuxArgs({
  verb,
  rest,
}: {
  verb: CmuxVerb;
  rest: readonly string[];
}): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SPECS[verb] });
}

/**
 * Parse one verb's flags, printing `--help` or a parse error as it goes — the one entry point every cmux
 * verb's `run*` function calls before touching anything else.
 *
 * @param verb which verb's spec and usage line to use
 * @param argv the full process argv
 * @returns the parsed flags, or the exit code to stop on
 */
export function parseCmuxVerb({ verb, argv }: { verb: CmuxVerb; argv: readonly string[] }): ParsedFlags | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: cmuxUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parseCmuxArgs({ rest, verb });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: cmuxUsage({ verb }) });
    return EXIT_USAGE;
  }
  return parsed.value;
}

/**
 * One declared string flag, or `undefined`.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns the value, or `undefined` when the flag was not passed
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The workspace a verb addresses, given as `--workspace` or as its first positional — two spellings of one
 * argument. Each verb keeps the precedence it has always had when a caller passes both.
 *
 * @param parsed the verb's parsed flags
 * @param precedence which spelling wins when both are given
 * @returns the workspace ref or id, or `undefined` when neither spelling was given, for the verb to refuse
 */
export function workspaceOperand({
  parsed,
  precedence,
}: {
  parsed: ParsedFlags;
  precedence: "flag" | "positional";
}): string | undefined {
  const flagged = stringFlag({ name: "workspace", parsed });
  const positional = parsed.positionals[0];
  const [first, second] = precedence === "flag" ? [flagged, positional] : [positional, flagged];
  if (first !== undefined) {
    return first;
  }
  return second;
}

/**
 * Who dispatched a spawn, as its run journal records it: a spawn run from outside any visible agent session
 * has no session id, and the journal says so rather than leaving the field blank.
 *
 * @param env the environment the session id is read from
 * @returns the dispatching session's id, or the words naming its absence
 */
export function spawnDispatcher({ env }: { env: NodeJS.ProcessEnv }): string {
  const sessionId = currentSessionId({ env });
  if (sessionId === undefined) {
    return "an unidentified session";
  }
  return sessionId;
}

/**
 * One declared string flag parsed as a non-negative integer, or `undefined` — the CLI's one
 * `nonNegativeIntegerFlag`, read off this verb's parsed flags.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns the parsed number, `undefined` when absent, or the error text when it is not a number
 */
export function numberFlag({
  parsed,
  name,
}: {
  parsed: ParsedFlags;
  name: string;
}): ReturnType<typeof nonNegativeIntegerFlag> {
  return nonNegativeIntegerFlag({ name, values: parsed.values });
}

/**
 * Every value of a flag that may be repeated (`--name a --name b`).
 *
 * `parseFlags` refuses a repeated string flag, which is right for `--home` and wrong for an event filter — so
 * the two filters that are genuinely lists are declared `repeatable` in `SPECS` and read off the raw tail here.
 *
 * @param rest the argv tail after the noun and verb
 * @param name the flag's name, without the leading `--`
 * @returns every value given, in order
 */
export function repeatedFlag({ rest, name }: { rest: readonly string[]; name: string }): readonly string[] {
  const values: string[] = [];
  for (const [index, token] of rest.entries()) {
    if (token === `--${name}`) {
      const next = rest[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.push(next);
      }
    } else if (token.startsWith(`--${name}=`)) {
      values.push(token.slice(`--${name}=`.length));
    }
  }
  return values;
}

/**
 * Where `spawn` looks for the doc it is spawning a session for.
 *
 * @param parsed the verb's parsed flags
 * @returns the handover directory to scan
 */
export function cmuxHandoverDir({ parsed }: { parsed: ParsedFlags }): string {
  return resolveHandoverDir({ dir: stringFlag({ name: "dir", parsed }), home: stringFlag({ name: "home", parsed }) });
}

/**
 * `spawn`'s `--driver` flag, the register's default when unset (`../../../cmux/driverDefault.ts`), or the exact
 * error to show when it names something else.
 *
 * @param parsed the verb's parsed flags
 * @param defaultDriver the host an omitted flag boots on — `codex` on a registered Codex-only install, else `claude`
 * @returns the resolved driver, or an error naming the bad value
 */
export function resolveCmuxDriver({
  defaultDriver,
  parsed,
}: {
  defaultDriver: CmuxDriver;
  parsed: ParsedFlags;
}): { driver: CmuxDriver } | { error: string } {
  const raw = stringFlag({ name: "driver", parsed });
  if (raw === undefined) {
    return { driver: defaultDriver };
  }
  if (raw === "claude" || raw === "codex") {
    return { driver: raw };
  }
  return { error: `--driver must be one of claude|codex, got ${JSON.stringify(raw)}` };
}

/**
 * The effort levels `claude` itself accepts, in the order its own help prints them.
 *
 * Read off the real CLI rather than remembered — reproduce with `claude --help | grep -A1
 * -- --effort`, which prints: `--effort <level>  Effort level for the current session (low, medium, high,
 * xhigh, max)`. One exported constant, so the validator and its test cannot drift into two lists.
 */
export const SPAWN_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * `spawn`'s `--effort` flag, absent when unset, or the exact error to show when it names a level `claude`
 * does not accept.
 *
 * Unlike `--model` this is OPTIONAL, and deliberately: an absent `--model` silently inherits the launching
 * user's saved default, which is the failure `cmux/modelPin.ts` measured, while an absent
 * `--effort` is DEFAULTED by `./spawnPins.ts` — `high` for an Opus spawn on the claude driver, because an
 * Opus 5.5 seat left to Claude Code's own default runs at `medium`; nothing for any other model.
 *
 * @param parsed the verb's parsed flags
 * @returns the resolved level, `undefined` for an unset flag, or an error naming the bad value
 */
export function resolveSpawnEffort({ parsed }: { parsed: ParsedFlags }): { effort?: string } | { error: string } {
  const raw = stringFlag({ name: "effort", parsed });
  if (raw === undefined) {
    return {};
  }
  if (SPAWN_EFFORT_LEVELS.some((level) => level === raw)) {
    return { effort: raw };
  }
  return { error: `--effort must be one of ${SPAWN_EFFORT_LEVELS.join("|")}, got ${JSON.stringify(raw)}` };
}
