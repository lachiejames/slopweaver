/**
 * Pure argument handling and rendering for `slopweaver slack probe`.
 *
 * The rendering is deliberately a SHAPE report rather than a body dump. A probe answers "does this call
 * return what I think it returns", and that is a question about field names, counts and a couple of
 * scalars — not about what anybody said. Printing the body would make the verb a second, ungated read path
 * for message content, which `refresh` and `slack read-thread` already own properly.
 *
 * **`--expect` is why that constraint did not have to be relaxed.** The as-me lane could send a message and
 * then not check it: `chat.getPermalink` was put on the read-only allowlist SO THAT a built permalink could
 * be compared against Slack's own (see `../../../atlas/slackApi/probePolicy.ts`, which says exactly that),
 * and the comparison was impossible anyway because nothing here ever prints a value. Measured:
 * `slack probe --method auth.test` reports `url` and `user_id` as NAMES and neither value, which is the
 * whole verb in one line.
 *
 * The fix is not to start printing values. `--expect <path>=<value>` takes a value the caller ALREADY HOLDS
 * and reports whether the response agrees — `matches`, `differs`, `absent`, `not-scalar` — so the verb
 * verifies without ever disclosing. That keeps every property the paragraph above is protecting: the output
 * is safe to paste anywhere the shape report was, and it stays true of a field carrying message text, which
 * an allowlist of "safe" value paths could never have permitted.
 */
import { err, ok } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";

/** Every flag this verb accepts; the help-truth ratchet checks the names derived from it below. */
const SLACK_PROBE_FLAGS: FlagSpec = {
  boolean: ["json", "bot", "scopes"],
  string: ["method", "home", "count-field", "shape-at", "count-where", "sum-field", "exhaust", "expect"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const SLACK_PROBE_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: SLACK_PROBE_FLAGS }),
  ...stringFlagsOf({ spec: SLACK_PROBE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation. */
export interface SlackProbeOptions {
  readonly method: string;
  readonly params: readonly string[];
  readonly bot: boolean;
  readonly countField: string | undefined;
  /** A dotted path to report the field names at — for a shape the default one level down cannot reach. */
  readonly shapeAt: string | undefined;
  /** `<arrayPath>:<field>~<substring>` — how many elements carry that field containing that substring. */
  readonly countWhere: string | undefined;
  /** `<arrayPath>:<field>` — the sum of that numeric field across the array. */
  readonly sumField: string | undefined;
  /** How many pages to follow `next_cursor` for. `undefined` means one call and no paging. */
  readonly exhaust: number | undefined;
  /** The `<path>=<value>` equality to check, when one was asked for. */
  readonly expect: { readonly path: string; readonly value: string } | undefined;
  /** Whether to report the token's granted scopes alongside the shape. */
  readonly scopes: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `slack probe`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseSlackProbeArgs({ rest }: { rest: readonly string[] }): SlackParsed<SlackProbeOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SLACK_PROBE_FLAGS });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const method = values["method"];
  if (typeof method !== "string" || method === "") {
    return err(SlackArgumentErrors.probeMethodMissing());
  }
  const rawExhaust = values["exhaust"];
  const exhaustPages = typeof rawExhaust === "string" ? Number(rawExhaust) : undefined;
  if (exhaustPages !== undefined && (!Number.isInteger(exhaustPages) || exhaustPages < 1)) {
    return err(SlackArgumentErrors.probeExhaustInvalid({ got: String(rawExhaust) }));
  }
  const expectation = parseExpectation({ raw: values["expect"] });
  if (expectation.isErr()) {
    return err(expectation.error);
  }
  return ok({
    bot: values["bot"] === true,
    countField: typeof values["count-field"] === "string" ? values["count-field"] : undefined,
    shapeAt: typeof values["shape-at"] === "string" ? values["shape-at"] : undefined,
    countWhere: typeof values["count-where"] === "string" ? values["count-where"] : undefined,
    exhaust: exhaustPages,
    expect: expectation.value,
    sumField: typeof values["sum-field"] === "string" ? values["sum-field"] : undefined,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    method,
    // Positionals rather than a repeated `--param`: `parseFlags` collapses a repeated string flag to its
    // LAST value, so `--param channel=C1 --param limit=1` silently sent one argument and Slack answered
    // `invalid_arguments` — a usage error that reads like an API one.
    params: parsed.value.positionals,
    scopes: values["scopes"] === true,
  });
}

/**
 * Read `--expect <path>=<value>`, which is one path and one value split at the FIRST `=`.
 *
 * The first, not the last: a value may legitimately contain `=` (a permalink's query string does), while a
 * dotted path never may. That is the same rule `../../../atlas/slackApi/probePolicy.ts` applies to a `k=v`
 * call argument, and for the same reason.
 *
 * @param raw the flag's value as typed, or whatever `parseFlags` produced when it was not passed
 * @returns the parsed expectation, `undefined` when the flag was absent, or the usage problem
 */
function parseExpectation({
  raw,
}: {
  raw: unknown;
}): SlackParsed<{ readonly path: string; readonly value: string } | undefined> {
  if (typeof raw !== "string") {
    return ok(undefined);
  }
  const split = raw.indexOf("=");
  if (split <= 0) {
    return err(SlackArgumentErrors.probeExpectInvalid({ got: raw }));
  }
  return ok({ path: raw.slice(0, split), value: raw.slice(split + 1) });
}

/**
 * What `--expect` concluded. Four states, because collapsing any pair of them loses the reader's next move.
 *
 * - `matches` / `differs` — the path holds a scalar, and it does or does not equal what the caller holds.
 * - `absent` — the path leads nowhere. The caller is checking a field this response does not carry.
 * - `not-scalar` — the path holds an object or an array, so there is nothing to compare. That is a wrong
 *   PATH, not a wrong value, and reporting it as `differs` would send the reader to fix the value instead.
 */
export type ExpectVerdict = "matches" | "differs" | "absent" | "not-scalar";

/** What one probe call measured. Field names and counts; never a body. */
export interface ProbeReport {
  readonly method: string;
  readonly ok: boolean;
  /** Slack's own `error` string when `ok` is false — the reason, which is the point of running this. */
  readonly error: string | undefined;
  /** Top-level response field names, sorted. */
  readonly fields: readonly string[];
  /** One level down, for the fields whose value is an object or an array of objects. */
  readonly nested: Readonly<Record<string, readonly string[]>>;
  /** The count at the `--count-field` path — an array's length, or a scalar Slack computed. */
  readonly count: number | undefined;
  /**
   * The field names at the `--shape-at` path, when one was asked for. `[]` distinguishes "the path exists
   * and holds no object" from `undefined`, which is "nothing asked" — a distinction that matters when the
   * whole question is whether a field exists.
   */
  readonly shapeAtPath: readonly string[] | undefined;
  /** The `--count-where` fraction: how many elements matched, of how many were looked at. */
  readonly where: { readonly matched: number; readonly of: number } | undefined;
  /** The `--sum-field` total across the array. */
  readonly sum: number | undefined;
  /**
   * What `--expect` concluded, and the path it asked about — never the value, on either side. `undefined`
   * means nothing was asked, which is a different fact from every verdict there is.
   */
  readonly expectation: { readonly path: string; readonly verdict: ExpectVerdict } | undefined;
  /**
   * How the paging ended, when `--exhaust` was used. `pages` is how many calls were made and `bounded` is
   * true when the page cap stopped it — stated rather than implied, because a truncated crawl reported as
   * a total is the silent cap this repository refuses.
   */
  readonly paging: { readonly pages: number; readonly bounded: boolean } | undefined;
  /** Whether the response carried a non-empty `response_metadata.next_cursor`. */
  readonly hasNextCursor: boolean;
  /**
   * Slack's own `has_more`. Reported separately from the cursor because the two can DISAGREE, and a page
   * that is empty while claiming more is exactly the shape a crawler reads as "nothing new".
   */
  readonly hasMore: boolean;
  /**
   * The scopes Slack says the answering token holds, off `response_metadata.scopes`, when `--scopes` asked.
   *
   * `undefined` means NOT ESTABLISHED — the flag was not passed, or Slack sent no such field — and is a
   * different claim from `[]`, which would be a token holding nothing. That distinction is the whole reason
   * this is reported at all: a scope question answered from a committed manifest is answered from a file
   * that can be behind the live install, and this one is answered by Slack.
   */
  readonly grantedScopes: readonly string[] | undefined;
  /** The scopes Slack says this METHOD would accept, off `response_metadata.acceptedScopes`. */
  readonly acceptedScopes: readonly string[] | undefined;
  readonly elapsedMs: number;
}

/**
 * The two `--scopes` lines, or none when the flag was not passed and nothing was established.
 *
 * @param report what the call measured
 * @returns the scope lines to append
 */
function scopeLines({ report }: { report: ProbeReport }): readonly string[] {
  const granted =
    report.grantedScopes === undefined
      ? []
      : [`  granted  : ${String(report.grantedScopes.length)} scope(s) — ${report.grantedScopes.join(", ")}`];
  const accepts = report.acceptedScopes === undefined ? [] : [`  accepts  : ${report.acceptedScopes.join(", ")}`];
  return [...granted, ...accepts];
}

/**
 * One `--expect` verdict as a sentence, saying what to do rather than only what happened.
 *
 * @param verdict what the comparison concluded
 * @returns the phrase that follows the path in the report
 */
function expectVerdictLine({ verdict }: { verdict: ExpectVerdict }): string {
  switch (verdict) {
    case "matches":
      return "MATCHES the value given";
    case "differs":
      return "DIFFERS from the value given (the value itself is not printed — this verb reports shape)";
    case "absent":
      return "is ABSENT from the response — nothing to compare, so check the path";
    case "not-scalar":
      return "holds an object or an array, not a value — check the path";
  }
}

/**
 * The call's outcome as the report's first line names it. A failed call Slack gave no error string for still
 * says it failed, and says that nothing came back to explain it.
 *
 * @param report what the call measured
 * @returns `ok`, or `FAILED — ` and the reason
 */
function callOutcome({ report }: { report: ProbeReport }): string {
  if (report.ok) {
    return "ok";
  }
  const reason = report.error;
  if (reason === undefined) {
    return "FAILED — no error string";
  }
  return `FAILED — ${reason}`;
}

/**
 * Render one probe report.
 *
 * @param report what the call measured
 * @returns the text to print
 */
export function renderProbe({ report }: { report: ProbeReport }): string {
  return [
    `${report.method}: ${callOutcome({ report })}  (${String(report.elapsedMs)} ms)`,
    `  fields   : ${report.fields.join(", ")}`,
    ...Object.entries(report.nested)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([parent, names]) => `  ${parent}[] : ${names.join(", ")}`),
    ...measurementLines({ report }),
    ...scopeLines({ report }),
    `  cursor   : ${report.hasNextCursor ? "another page is waiting" : "none"} · has_more ${String(report.hasMore)}`,
  ].join("\n");
}

/**
 * The lines for the measurements a caller ASKED for — every one absent unless its flag was passed.
 *
 * Split out of {@link renderProbe} so that adding a measurement is one entry here rather than another
 * branch in a function the complexity gate already had at its limit.
 *
 * @param report what the call measured
 * @returns one line per measurement that was requested, in flag order
 */
function measurementLines({ report }: { report: ProbeReport }): readonly string[] {
  const { count, shapeAtPath, paging, sum, where, expectation } = report;
  return [
    ...(count === undefined ? [] : [`  count    : ${String(count)}`]),
    ...(shapeAtPath === undefined
      ? []
      : [`  shape-at : ${shapeAtPath.length === 0 ? "(no object at that path)" : shapeAtPath.join(", ")}`]),
    ...(paging === undefined ? [] : [`  pages    : ${String(paging.pages)}${pagingNote({ bounded: paging.bounded })}`]),
    ...(sum === undefined ? [] : [`  sum      : ${String(sum)}`]),
    ...(where === undefined ? [] : [`  where    : ${String(where.matched)} of ${String(where.of)}`]),
    ...(expectation === undefined
      ? []
      : [`  expect   : ${expectation.path} ${expectVerdictLine({ verdict: expectation.verdict })}`]),
  ];
}

/** Whether an `--exhaust` walk ran out of cursor or ran out of budget — a floor reported as a total is the lie. */
function pagingNote({ bounded }: { bounded: boolean }): string {
  return bounded ? "  STOPPED AT THE --exhaust BOUND — this total is a floor, not a total" : "  (cursor exhausted)";
}
