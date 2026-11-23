/**
 * `slopweaver queue defer` and `queue deferred` — "Come back to it" on a Queue card, and the read the page orders by.
 *
 * - **`queue defer`** appends one press to `src/queueDefer/cardDeferralStore.ts`'s ledger: the card steps below
 *   every card they have not deferred, and `--restore` puts it back. No deadline and no reminder,
 *   and nothing about the card itself changes — it stays on their Queue, in its tier.
 * - **`queue deferred`** prints the cards standing deferred, oldest first, and every ledger line that would not
 *   read. The console reads its `--json` (`site/lib/cardDeferrals.ts`).
 */
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { deferrableCardKey, standingDeferrals } from "../../../queueDefer/cardDeferral.js";
import { CardDeferralErrors } from "../../../queueDefer/cardDeferralErrors.js";
import { appendCardDeferral, readCardDeferrals } from "../../../queueDefer/cardDeferralStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { QUEUE_DEFER_USAGE, QUEUE_DEFERRED_USAGE } from "./deferUsage.js";

/** Where this noun's own arguments start in `process.argv`: `[node, cli, queue, <verb>, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

const DEFER_FLAGS = {
  boolean: ["json", "restore"],
  string: ["by-session", "home", "id", "kind"],
} satisfies FlagSpec;

const DEFERRED_FLAGS = { boolean: ["json"], string: ["home"] } satisfies FlagSpec;

/** Who a press is recorded as when the caller names nobody: the operator at a terminal. */
const TERMINAL_SESSION = "terminal";

/** A parsed `queue defer`. */
interface DeferArgs {
  readonly kind: string;
  readonly id: string;
  readonly restore: boolean;
  readonly bySession: string;
  readonly json: boolean;
  readonly home: string;
}

/**
 * One string flag's value, or `undefined` when it was absent or bare.
 *
 * @param value the parsed flag
 * @returns the string, or `undefined`
 */
function stringFlag({ value }: { value: string | boolean | undefined }): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * The home a verb reads and writes: `--home` when given, else the configured one.
 *
 * @param flagged the `--home` value
 * @returns the home
 */
function homeOf({ flagged }: { flagged: string | undefined }): string {
  if (flagged === undefined) {
    return slopweaverHome();
  }
  return flagged;
}

/**
 * Parse a `queue defer` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseDeferArgs({ rest }: { rest: readonly string[] }): Result<DeferArgs> {
  const parsed = parseFlags({ args: rest, spec: DEFER_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const kind = stringFlag({ value: values["kind"] });
  const id = stringFlag({ value: values["id"] });
  const problems: string[] = [];
  if (kind === undefined) {
    problems.push("queue defer needs --kind <hand|ask|draft|post|review|import|pr>, the register the card comes from");
  }
  if (id === undefined) {
    problems.push("queue defer needs --id <id>, the card's id within that register");
  }
  if (kind === undefined || id === undefined) {
    return err(problems);
  }
  let bySession = TERMINAL_SESSION;
  const named = stringFlag({ value: values["by-session"] });
  if (named !== undefined) {
    bySession = named;
  }
  return ok({
    bySession,
    home: homeOf({ flagged: stringFlag({ value: values["home"] }) }),
    id,
    json: values["json"] === true,
    kind,
    restore: values["restore"] === true,
  });
}

/**
 * Parse a `queue deferred` invocation.
 *
 * @param rest the argv after the verb
 * @returns whether to print JSON and the home to read, or every usage problem found
 */
export function parseDeferredArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<{ readonly json: boolean; readonly home: string }> {
  const parsed = parseFlags({ args: rest, spec: DEFERRED_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  return ok({ home: homeOf({ flagged: stringFlag({ value: values["home"] }) }), json: values["json"] === true });
}

/**
 * Print a parse's usage problems and the usage line.
 *
 * @returns the usage exit code
 */
function refuseUsage({ problems, usage }: { problems: readonly string[]; usage: string }): number {
  problems.forEach((message) => {
    logger.error({ msg: message });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * Say a failure on stderr and — under `--json` — as the one stdout line.
 *
 * @returns the exit code
 */
function refuse({
  verb,
  code,
  message,
  json,
  exit,
}: {
  verb: string;
  code: string;
  message: string;
  json: boolean;
  exit: number;
}): number {
  logger.error({ msg: `queue ${verb}: ${message}` });
  if (json) {
    logger.out({ line: JSON.stringify({ code, ok: false, why: message }) });
  }
  return exit;
}

/**
 * Run `queue defer`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runQueueDefer(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: QUEUE_DEFER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDeferArgs({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ problems: parsed.error, usage: QUEUE_DEFER_USAGE });
  }
  const args = parsed.value;
  const cardKey = deferrableCardKey({ id: args.id, kind: args.kind });
  if (cardKey === undefined) {
    const error = CardDeferralErrors.notDeferrable({ id: args.id, kind: args.kind });
    return refuse({ code: error.code, exit: EXIT_USAGE, json: args.json, message: error.message, verb: "defer" });
  }
  const row = {
    action: args.restore ? ("restore" as const) : ("defer" as const),
    bySession: args.bySession,
    cardKey,
    pressedIso: new Date().toISOString(),
  };
  const appended = appendCardDeferral({ home: args.home, row });
  if (appended.isErr()) {
    const { code, message } = appended.error;
    return refuse({ code, exit: EXIT_ERROR, json: args.json, message, verb: "defer" });
  }
  if (args.json) {
    logger.out({ line: JSON.stringify({ ok: true, row }) });
    return EXIT_OK;
  }
  if (args.restore) {
    logger.out({ line: `queue defer: ${cardKey} is back in its place on their Queue` });
    return EXIT_OK;
  }
  logger.out({ line: `queue defer: ${cardKey} steps below every card they have not deferred — still on their Queue` });
  return EXIT_OK;
}

/**
 * Run `queue deferred`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runQueueDeferred(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: QUEUE_DEFERRED_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDeferredArgs({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ problems: parsed.error, usage: QUEUE_DEFERRED_USAGE });
  }
  const { json, home } = parsed.value;
  const read = readCardDeferrals({ home });
  if (read.isErr()) {
    const { code, message } = read.error;
    return refuse({ code, exit: EXIT_ERROR, json, message, verb: "deferred" });
  }
  const deferrals = standingDeferrals({ rows: read.value.rows });
  const { unreadable } = read.value;
  if (json) {
    logger.out({ line: JSON.stringify({ deferrals, observedAtIso: new Date().toISOString(), ok: true, unreadable }) });
    return EXIT_OK;
  }
  if (unreadable.length > 0) {
    logger.out({
      line: `  ${String(unreadable.length)} ledger line(s) did not read (${unreadable.join(", ")}) — ${read.value.path}`,
    });
  }
  if (deferrals.length === 0) {
    logger.out({ line: "queue deferred: no card on their Queue is deferred" });
    return EXIT_OK;
  }
  deferrals.forEach((deferral) => {
    logger.out({ line: `${deferral.deferredIso}  ${deferral.cardKey}` });
  });
  return EXIT_OK;
}

export const queueDeferCommand = defineCommand({ run: runQueueDefer });

export const queueDeferredCommand = defineCommand({ run: runQueueDeferred });
