/**
 * The PURE core of `slopweaver datadog raw`: its flag parsing and what it prints. No fs, no clock, no network —
 * `rawRun.ts` does the request. Split from `core.ts` along the verb, since `raw` is the one Datadog verb that
 * prints a provider's text rather than a reading of it.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** A predicate, so positional per the rules. */
function isRawMethod(value: string): value is "GET" | "POST" {
  return value === "GET" || value === "POST";
}

/** The validated invocation for `datadog raw`. */
export interface DatadogRawOptions {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body: unknown;
  readonly json: boolean;
}

/**
 * Parse `datadog raw`'s flags.
 *
 * @param rest the argv tail
 * @returns the validated options, or every rejection
 */
export function parseDatadogRawOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<DatadogRawOptions, DatadogArgsError> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["method", "path", "body"] },
  });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];

  const path = values["path"];
  if (path === undefined || path.trim() === "") {
    errors.push("--path is required, e.g. --path /api/v1/logs-analytics/list?type=logs");
  }

  const rawMethod = flagValueOr({ fallback: "GET", name: "method", parsed: parsed.value }).toUpperCase();
  if (!isRawMethod(rawMethod)) {
    errors.push(`--method must be GET or POST, got '${rawMethod}'`);
  }

  let body: unknown;
  if (values["body"] !== undefined) {
    try {
      body = JSON.parse(values["body"]);
    } catch {
      errors.push("--body must be valid JSON");
    }
  }

  if (errors.length > 0) {
    return err(DatadogArgsErrors.optionsRefused({ reasons: errors }));
  }
  if (!isRawMethod(rawMethod) || path === undefined) {
    // Unreachable: the checks above already pushed an error and returned when either holds; --method is named first.
    const detail = isRawMethod(rawMethod) ? "--path was not provided" : "--method was not GET or POST";
    return err(DatadogArgsErrors.invariantBroken({ detail }));
  }
  return ok({
    method: rawMethod,
    path,
    body,
    json: flags.has("json"),
  });
}

/**
 * What `datadog raw` prints for an answer: Datadog's text, never parsed, because the verb names no endpoint it
 * could declare a boundary for. `--json` is one document carrying the text as a string under `bodyText`, so a
 * consumer decodes it itself (`jq -r '.bodyText' | jq …`); otherwise a header line, then the text as sent.
 *
 * @param bodyText the response text, exactly as Datadog sent it
 * @param json whether the caller asked for the one-document form
 * @returns the lines to print, in order
 */
export function datadogRawOutputLines({
  method,
  path,
  status,
  bodyText,
  json,
}: {
  method: "GET" | "POST";
  path: string;
  status: number;
  bodyText: string;
  json: boolean;
}): readonly string[] {
  if (json) {
    return [JSON.stringify({ bodyText, status }, null, 2)];
  }
  return [`datadog raw: ${method} ${path} → HTTP ${String(status)}`, bodyText];
}
