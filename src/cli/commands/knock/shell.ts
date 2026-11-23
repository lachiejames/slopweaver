/**
 * The six `knock` verbs' shared shell: help, refusal printing, the session open, the one place a typed
 * {@link KnockReadError} becomes an exit code, and the one way a list is printed.
 *
 * The mapping is the contract `core.ts`'s header states, and it lives here so no verb can grade a missing key as
 * a failed read. Every verb runs through a `*With` function taking the session opener and the sink as seams, so a
 * test drives the real verb over canned bodies with no key and no network.
 */
import { slopweaverHome } from "../../../homeDir.js";
import type { Logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { KnockReadError } from "../../../live/knock/errors.js";
import type { KnockList } from "../../../live/knock/paging.js";
import type { KnockSession } from "../../../live/knock/session.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

/** Where a verb writes: `out` for its answer, `error` for refusals. */
export type KnockSink = Pick<Logger, "error" | "out">;

/** How a verb gets its read seam — `openKnockSession` in production, a canned session in a test. */
export type KnockSessionOpener = (request: { home: string }) => Result<KnockSession, KnockReadError>;

/**
 * Whether the tail asks for help, printing the usage when it does.
 *
 * @param rest the verb's own argv tail
 * @param usage the verb's usage line
 * @param sink where the usage is written
 * @returns true when help was printed and the verb should exit 0
 */
export function askedForHelp({
  rest,
  usage,
  sink,
}: {
  rest: readonly string[];
  usage: string;
  sink: KnockSink;
}): boolean {
  if (rest.includes("--help") || rest.includes("-h")) {
    sink.out({ line: usage });
    return true;
  }
  return false;
}

/**
 * Print every rejection, then the usage.
 *
 * @param reasons every reason the invocation was refused
 * @param usage the verb's usage line
 * @param sink where the lines are written
 */
export function printRefusal({
  reasons,
  usage,
  sink,
}: {
  reasons: readonly string[];
  usage: string;
  sink: KnockSink;
}): void {
  reasons.forEach((msg) => {
    sink.error({ msg });
  });
  sink.error({ msg: usage });
}

/**
 * Print one typed read failure and give the exit code it earns.
 *
 * @param error the typed failure
 * @param sink where the failure's message is written
 * @returns `3` when this install holds no key, else `1`
 */
export function exitForKnockError({ error, sink }: { error: KnockReadError; sink: KnockSink }): number {
  sink.error({ msg: error.message });
  if (error.code === "TOKEN_MISSING") {
    return EXIT_EXPECTED_EMPTY;
  }
  return EXIT_ERROR;
}

/**
 * Open a session against `--home` (or this install's home), or print why there is none.
 *
 * @param home the parsed `--home`, `null` for this install's own state home
 * @param open the session opener seam
 * @param sink where a failure is written
 * @returns the session, or the exit code the verb should return
 */
export function sessionOrExit({
  home,
  open,
  sink,
}: {
  home: string | null;
  open: KnockSessionOpener;
  sink: KnockSink;
}): { session: KnockSession } | { exit: number } {
  const opened = open({ home: home === null ? slopweaverHome() : resolveHome({ named: home }) });
  if (opened.isErr()) {
    return { exit: exitForKnockError({ error: opened.error, sink }) };
  }
  return { session: opened.value };
}

/**
 * Print a list read's answer — JSON whole, or a count line, each item's lines, and a line when the limit cut it.
 *
 * @param list the read's answer, or its failure
 * @param json whether `--json` was passed
 * @param label what the JSON document is, and what the count line counts
 * @param limit the limit the read ran under, for the cut-short line
 * @param render one item's human lines
 * @param sink where the lines are written
 * @returns the exit code
 */
export function printKnockList<V>({
  list,
  json,
  label,
  limit,
  render,
  sink,
}: {
  list: Result<KnockList<V>, KnockReadError>;
  json: boolean;
  label: { document: string; noun: string };
  limit: number;
  render: (item: V) => readonly string[];
  sink: KnockSink;
}): number {
  if (list.isErr()) {
    return exitForKnockError({ error: list.error, sink });
  }
  if (json) {
    sink.out({ line: safeJsonStringify({ label: label.document, value: list.value }) });
    return EXIT_OK;
  }
  sink.out({ line: `${String(list.value.items.length)} ${label.noun}, in the order Knock answered` });
  list.value.items.forEach((item) => {
    render(item).forEach((line) => {
      sink.out({ line });
    });
  });
  if (list.value.moreRemain) {
    sink.out({ line: `more match than --limit ${String(limit)} — raise it or narrow the filters` });
  }
  return EXIT_OK;
}
