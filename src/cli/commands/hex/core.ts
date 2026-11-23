/**
 * The `hex` noun's pure half: usage strings, flag parsing and the exit-code contract every verb shares.
 *
 * Pure on purpose, exactly as `datadog/core.ts` is: the manifest imports the usage strings from here
 * without eagerly loading a client, and every rejection below is a unit test rather than a machine it
 * happened to run on.
 *
 * ## The exit-code contract, once, for all eight verbs
 *
 * | situation                                                  | code |
 * | ------------------------------------------------------------ | ---- |
 * | a bad flag — missing `--project`, a non-numeric `--limit`   | `2`  |
 * | no Hex API token in this install                            | `3`  |
 * | Hex refused, could not be reached, or answered unreadably   | `1`  |
 * | Hex answered                                                | `0`  |
 *
 * A 3 is deliberately not a 1: an install with no token has not failed to read Hex, it has never been
 * connected to it, and the refusal carries the mint line rather than a stack of retry advice.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { flagValue, parseFlagTail } from "../../optionParsers.js";

/** How many rows, projects or runs a verb returns when the caller names no bound. */
export const HEX_DEFAULT_LIMIT = 50;

/**
 * What each verb's `--help` advertises, declared ONE PLACE so the usage line and the parser cannot disagree.
 *
 * `unit/cli/helpTruth.test.ts` holds each list against BOTH: every flag here must appear in that verb's
 * usage string, and must be accepted by its parser given a valid value. Per verb rather than per parser
 * shape, because two verbs sharing `parseHexObjectOptions` still advertise different booleans — `hex
 * project --tables` and `hex cells --sql-only` — and a shared superset would advertise each to the other.
 *
 * @internal
 */
export const HEX_PROJECTS_FLAG_NAMES: readonly string[] = [
  "--query",
  "--owner",
  "--include-archived",
  "--limit",
  "--json",
];

/** The flags `hex connections` advertises. @internal */
export const HEX_CONNECTIONS_FLAG_NAMES: readonly string[] = ["--limit", "--json"];

/** The flags `hex project` advertises. @internal */
export const HEX_PROJECT_FLAG_NAMES: readonly string[] = ["--project", "--tables", "--json"];

/** The flags `hex cells` advertises. @internal */
export const HEX_CELLS_FLAG_NAMES: readonly string[] = ["--project", "--sql-only", "--limit", "--json"];

/** The flags `hex runs` advertises. @internal */
export const HEX_RUNS_FLAG_NAMES: readonly string[] = ["--project", "--limit", "--json"];

/** The flags `hex output` advertises. @internal */
export const HEX_OUTPUT_FLAG_NAMES: readonly string[] = [
  "--cell",
  "--limit",
  "--column",
  "--date-column",
  "--now",
  "--json",
];

/** The flags `hex raw` advertises. @internal */
export const HEX_RAW_FLAG_NAMES: readonly string[] = ["--path", "--json"];

/** The one flag `hex verify` advertises. @internal */
export const HEX_VERIFY_FLAG_NAMES: readonly string[] = ["--json"];

/** What `hex projects` asked for. */
export interface HexProjectsOptions {
  readonly words: readonly string[];
  readonly owner: string | null;
  readonly includeArchived: boolean;
  readonly limit: number;
  readonly json: boolean;
}

/** What a verb addressing one object asked for. */
export interface HexObjectOptions {
  readonly id: string;
  readonly limit: number;
  readonly json: boolean;
  /** `hex project --tables`; `hex cells --sql-only`. One boolean, named by the verb that reads it. */
  readonly extra: boolean;
}

/** What `hex output` asked for. */
export interface HexOutputOptions {
  readonly cellId: string;
  readonly limit: number;
  readonly columns: readonly string[];
  /** The column the Datadog-retention split is computed on, or `null` when the caller asked for none. */
  readonly dateColumn: string | null;
  /** The instant the split is judged against, so a replay is deterministic; `null` takes the wall clock. */
  readonly nowIso: string | null;
  readonly json: boolean;
}

/** What `hex raw` asked for. */
export interface HexRawOptions {
  readonly path: string;
  readonly json: boolean;
}

/**
 * Read a repeated flag out of the argv tail, which the single-value parser refuses unless it is declared
 * `repeatable` — and then keeps only its last value.
 *
 * The same shape `store detect` uses and for the same reason: `--column a --column b` is a list, and a
 * parser that kept only `b` would silently project one column.
 *
 * @param rest the verb's own argv tail
 * @param name the flag to collect, without dashes
 * @returns every value that flag was given, in order
 */
export function repeatedFlag({ rest, name }: { rest: readonly string[]; name: string }): readonly string[] {
  const values: string[] = [];
  rest.forEach((token, index) => {
    const next = rest[index + 1];
    if (token === `--${name}` && next !== undefined && !next.startsWith("--")) {
      values.push(next);
    }
  });
  return values;
}

/**
 * Parse a `--limit`, defaulting when absent and refusing anything that is not a whole number above zero.
 *
 * @param raw the flag's value, or `undefined` when unset
 * @param errors the accumulator a caller refuses on
 * @returns the limit
 */
function limitOf({ raw, errors }: { raw: string | undefined; errors: string[] }): number {
  if (raw === undefined) {
    return HEX_DEFAULT_LIMIT;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    errors.push(`--limit must be a whole number of at least 1, not "${raw}"`);
    return HEX_DEFAULT_LIMIT;
  }
  return limit;
}

/**
 * Parse `hex projects`.
 *
 * @param rest the verb's own argv tail
 * @returns the options, or every rejection
 */
export function parseHexProjectsOptions({ rest }: { rest: readonly string[] }): Result<HexProjectsOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json", "include-archived"], value: ["query", "owner", "limit"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const limit = limitOf({ errors, raw: values["limit"] });
  if (errors.length > 0) {
    return err(errors);
  }
  const query = values["query"];
  return ok({
    includeArchived: flags.has("include-archived"),
    json: flags.has("json"),
    limit,
    owner: flagValue({ name: "owner", parsed: parsed.value }),
    words: query === undefined ? [] : query.split(/\s+/).filter((word) => word.length > 0),
  });
}

/**
 * Parse a verb addressing one object by id.
 *
 * @param rest the verb's own argv tail
 * @param idFlag the flag naming the object — `project` or `cell`
 * @param extraFlag the verb's own boolean, when it has one
 * @param usageHint what the refusal tells a caller to pass
 * @returns the options, or every rejection
 */
export function parseHexObjectOptions({
  rest,
  idFlag,
  extraFlag,
  usageHint,
}: {
  rest: readonly string[];
  idFlag: string;
  extraFlag: string | null;
  usageHint: string;
}): Result<HexObjectOptions> {
  const booleans = extraFlag === null ? ["json"] : ["json", extraFlag];
  const parsed = parseFlagTail({ rest, spec: { boolean: booleans, value: [idFlag, "limit"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const id = values[idFlag];
  if (id === undefined || id.trim().length === 0) {
    errors.push(`--${idFlag} is required, e.g. ${usageHint}`);
  }
  const limit = limitOf({ errors, raw: values["limit"] });
  if (errors.length > 0) {
    return err(errors);
  }
  if (id === undefined) {
    return err([`unreachable: --${idFlag} was not provided`]);
  }
  return ok({
    extra: extraFlag !== null && flags.has(extraFlag),
    id: id.trim(),
    json: flags.has("json"),
    limit,
  });
}

/**
 * Parse `hex output`.
 *
 * @param rest the verb's own argv tail
 * @returns the options, or every rejection
 */
export function parseHexOutputOptions({ rest }: { rest: readonly string[] }): Result<HexOutputOptions> {
  const columns = repeatedFlag({ name: "column", rest });
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], repeatable: ["column"], value: ["cell", "limit", "column", "date-column", "now"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const cellId = values["cell"];
  if (cellId === undefined || cellId.trim().length === 0) {
    errors.push("--cell is required — take a cell id from `slopweaver hex cells --project <id> --sql-only`");
  }
  const limit = limitOf({ errors, raw: values["limit"] });
  const nowRaw = values["now"];
  if (nowRaw !== undefined && Number.isNaN(Date.parse(nowRaw))) {
    errors.push(`--now must be an ISO-8601 instant, not "${nowRaw}"`);
  }
  if (errors.length > 0) {
    return err(errors);
  }
  if (cellId === undefined) {
    return err(["unreachable: --cell was not provided"]);
  }
  return ok({
    cellId: cellId.trim(),
    columns,
    dateColumn: flagValue({ name: "date-column", parsed: parsed.value }),
    json: flags.has("json"),
    limit,
    nowIso: flagValue({ name: "now", parsed: parsed.value }),
  });
}

/**
 * Parse `hex verify`, which takes `--json` and nothing else.
 *
 * It has a parser at all so an unknown flag is REFUSED rather than ignored: a verb that silently accepts
 * `--jsonn` and prints prose is a verb whose help does not tell the truth.
 *
 * @param rest the verb's own argv tail
 * @returns whether `--json` was asked for, or every rejection
 */
export function parseHexVerifyOptions({ rest }: { rest: readonly string[] }): Result<{ json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: [] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ json: parsed.value.flags.has("json") });
}

/**
 * Parse `hex raw`.
 *
 * @param rest the verb's own argv tail
 * @returns the options, or every rejection
 */
export function parseHexRawOptions({ rest }: { rest: readonly string[] }): Result<HexRawOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["path"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const path = values["path"];
  if (path === undefined || path.trim().length === 0) {
    return err(["--path is required, e.g. --path /v1/users/me"]);
  }
  return ok({ json: flags.has("json"), path: path.trim() });
}

/**
 * What `hex raw` prints: Hex's body exactly as sent, never parsed — a read that declares no shape cannot be
 * a boundary, so it hands the text on and the reader decodes it. `--json` wraps it as `{ bodyText, status }`.
 *
 * @param path the path as requested, query string included
 * @param status the 2xx status Hex answered
 * @param bodyText the body, unchanged
 * @param json whether the caller asked for the wrapper document
 * @returns the lines, in print order
 */
export function hexRawOutputLines({
  path,
  status,
  bodyText,
  json,
}: {
  path: string;
  status: number;
  bodyText: string;
  json: boolean;
}): readonly string[] {
  if (json) {
    return [safeJsonStringify({ label: `hex raw ${path}`, space: 2, value: { bodyText, status } })];
  }
  return [`hex raw: GET ${path} → HTTP ${String(status)}`, bodyText];
}
