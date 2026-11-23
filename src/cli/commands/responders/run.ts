/**
 * `slopweaver responders add|remove` — the one real, deliberate write path for `responders.json`, the SAME
 * list gating who may address the bot and who may receive a real reply. Local state only: never posts,
 * never touches the corpus, never runs a model. See `live/listen/whitelistWrite.ts`'s own header for why
 * `--reason` is required rather than optional.
 */
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { addResponder, removeResponder, type WhitelistEditResult } from "../../../live/listen/whitelistWrite.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";

/** Where a verb's own arguments start in `process.argv`: `[node, cli, responders, add|remove, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

const FLAG_SPEC = { boolean: [] as readonly string[], string: ["user", "reason", "home"] } as const;

export const RESPONDERS_ADD_USAGE =
  "usage: slopweaver responders add --user <id> --reason <text> [--home <dir>]\n" +
  "  Adds one Slack user id to responders.json — the SAME list gating who may address the bot and who\n" +
  "  may receive a real reply. Idempotent — adding an id already present is a no-op, reported as such.\n" +
  "  A running listener reads the list per tag, so the next tag is admitted with no restart.\n" +
  "  --user     the exact Slack user id to add.\n" +
  "  --reason   REQUIRED — why. Widening this list is deliberate, threat-modelled work, printed back\n" +
  "             rather than merely accepted.\n";

export const RESPONDERS_REMOVE_USAGE =
  "usage: slopweaver responders remove --user <id> --reason <text> [--home <dir>]\n" +
  "  Removes one Slack user id from responders.json. Idempotent — removing an id never present is a\n" +
  "  no-op, reported as such.\n" +
  "  --user     the exact Slack user id to remove.\n" +
  "  --reason   REQUIRED — why, printed back rather than merely accepted.\n";

/** Every flag `responders add`/`remove` accepts, as the `--`-prefixed tokens a caller types. Both share one spec. */
export const RESPONDERS_FLAG_NAMES: readonly string[] = FLAG_SPEC.string.map((name) => `--${name}`);

/** A string flag's value, or `undefined` when it was absent. */
function str({ values, key }: { values: Readonly<Record<string, string | boolean>>; key: string }): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse a verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 * `add` and `remove` share one flag spec (`--user`/`--reason`/`--home`), so one parser serves both.
 *
 * @param rest the argv tail after `responders add`/`responders remove`
 * @returns the parsed flags, or the rejections
 */
export function parseRespondersArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: [...FLAG_SPEC.boolean], string: [...FLAG_SPEC.string] } });
}

/** Print an edit's outcome, exactly as it happened. */
function reportEdit({ result, userId }: { result: WhitelistEditResult; userId: string }): number {
  if (result.kind === "refused") {
    logger.error({ msg: result.why });
    return EXIT_ERROR;
  }
  if (result.kind === "unchanged") {
    logger.out({ line: `${userId} — no change (${String(result.identities.length)} identities on the list)` });
    return EXIT_OK;
  }
  logger.out({
    line: `${userId} — before: [${result.before.join(", ")}]\n${userId} — after:  [${result.after.join(", ")}]`,
  });
  return EXIT_OK;
}

/** Shared `--user`/`--reason` parsing for both verbs. */
function runEdit({
  argv,
  edit,
  usage,
}: {
  argv: readonly string[];
  edit: (input: { home: string; userId: string }) => WhitelistEditResult;
  usage: string;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: usage });
    return EXIT_OK;
  }
  const parsed = parseRespondersArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: usage });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const userId = str({ key: "user", values });
  const reason = str({ key: "reason", values });
  const missing = [userId === undefined ? "--user" : undefined, reason === undefined ? "--reason" : undefined].filter(
    (flag): flag is string => flag !== undefined,
  );
  if (userId === undefined || reason === undefined || missing.length > 0) {
    for (const flag of missing) {
      logger.error({ msg: `${flag} is required` });
    }
    logger.error({ msg: usage });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: str({ key: "home", values }) });
  logger.out({ line: `reason: ${reason}` });
  return reportEdit({ result: edit({ home, userId }), userId });
}

/**
 * Run the `add` verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export function runRespondersAdd(argv: readonly string[]): number {
  return runEdit({ argv, edit: addResponder, usage: RESPONDERS_ADD_USAGE });
}

/**
 * Run the `remove` verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export function runRespondersRemove(argv: readonly string[]): number {
  return runEdit({ argv, edit: removeResponder, usage: RESPONDERS_REMOVE_USAGE });
}

export const respondersAddCommand = defineCommand({ run: runRespondersAdd });
export const respondersRemoveCommand = defineCommand({ run: runRespondersRemove });
