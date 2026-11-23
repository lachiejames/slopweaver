/**
 * `slopweaver codex burn` — how many sessions each Codex model buys per weekly and five-hour window, read off
 * every registered destination's own rollout logs.
 *
 * The owner's ask made concrete: the default model moved to `gpt-5.6-sol` because `gpt-6-astra`
 * spent a whole account in under a day, and the next pick is to be made on this number rather than a guess.
 * The arithmetic is `src/codex/modelBurn.ts`; the read is `src/codex/modelBurnScan.ts`.
 *
 * READ-ONLY. It spends no Codex turn, reaches no network and opens no `auth.json` — the rollout files Codex
 * already wrote are the whole input.
 */
import { buildModelBurnReport } from "../../../codex/modelBurn.js";
import { renderModelBurn } from "../../../codex/modelBurnRender.js";
import { scanModelBurn } from "../../../codex/modelBurnScan.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { positiveIntFlag } from "../../optionParsers.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

/** How many argv entries precede the verb's own flags (`node`, `slopweaver`, `codex`, `burn`). */
const VERB_ARG_OFFSET = 4;

/**
 * How many days behind each Codex home's newest rollout a file is read for when `--days` is not given.
 *
 * Three weeks, because on this machine that reaches back past when the pin moved
 * from `gpt-5.6-sol` to `gpt-6-astra` — so the default read holds both models. List what a home holds with
 * `ls ~/.codex/sessions/2026/09`.
 */
const DEFAULT_DAYS = 21;

/** The value-taking flags. */
const BURN_STRING_FLAGS: readonly string[] = ["days", "home"];

/** The boolean flags. */
const BURN_BOOLEAN_FLAGS: readonly string[] = ["json"];

/** The parser's spec, built from the two lists so neither can disagree with the usage string. */
const BURN_FLAGS: FlagSpec = { boolean: [...BURN_BOOLEAN_FLAGS], string: [...BURN_STRING_FLAGS] };

/** `codex burn`'s advertised flags, for the help-truth ratchet. Derived from the same two lists. */
export const CODEX_BURN_FLAG_NAMES: readonly string[] = [...BURN_BOOLEAN_FLAGS, ...BURN_STRING_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `codex burn`, kept beside the verb so `--help` and the parser share one string. */
export const BURN_USAGE =
  "usage: slopweaver codex burn [--days <n>] [--json] [--home <dir>]\n" +
  "\n" +
  "  Sessions per weekly and five-hour window on each Codex model, effort and plan type, measured from every\n" +
  "  registered destination's rollout logs. Spends nothing.\n" +
  "\n" +
  `  --days  read files modified within this many days of each home's newest rollout (default ${String(DEFAULT_DAYS)})\n` +
  "  --home  the state home holding the plan register. Defaults to this install's.";

/**
 * Parse `codex burn` flags. Exported so the help-truth ratchet can probe the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexBurnArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ allowPositionals: false, args: rest, spec: BURN_FLAGS });
}

/**
 * The `--days` bound, or the default when it was not given.
 *
 * @param values the parsed flag bag `--days` is read from
 * @returns the number of days, or why the value is refused
 */
export function burnDaysOf({ values }: { values: ParsedFlags["values"] }): Result<number> {
  const problems: string[] = [];
  const days = positiveIntFlag({ fallback: DEFAULT_DAYS, name: "days", problems, values });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(days);
}

/** The home the register is read from: `--home`, or this install's own — an `if`, not an operator. */
function resolvedHomeOf({ home }: { home: unknown }): string {
  if (typeof home !== "string") {
    return slopweaverHome();
  }
  return home;
}

/**
 * `codex burn` — sessions per window, per model.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCodexBurn(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: BURN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexBurnArgs({ rest }).andThen((flags) =>
    burnDaysOf({ values: flags.values }).map((days) => ({ days, flags })),
  );
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: BURN_USAGE });
    return EXIT_USAGE;
  }
  const { days, flags } = parsed.value;
  const scan = await scanModelBurn({
    days,
    home: resolvedHomeOf({ home: flags.values["home"] }),
    port: planRegisterPort(),
  });
  if (scan.isErr()) {
    logger.error({ msg: `codex burn: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const report = buildModelBurnReport({ sessions: scan.value.sessions });
  if (flags.values["json"] === true) {
    logger.out({ line: JSON.stringify({ days, destinations: scan.value.destinations, report }) });
    return EXIT_OK;
  }
  renderModelBurn({
    days,
    destinations: scan.value.destinations,
    filesRead: scan.value.filesRead,
    report,
  }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/** The `codex burn` verb. */
export const codexBurnCommand = defineCommand({ run: runCodexBurn });
