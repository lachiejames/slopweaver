/**
 * The effectful helpers shared by `slopweaver datadog metrics|probe`: parse the verb's own flags, resolve
 * the shared Datadog config (the environment, then the secrets store and `profile.json`) and resolve the shared window (reads the clock). Kept
 * separate from the PURE `./core.ts` — which explicitly carries no clock, env or network read — because both
 * of those reads are exactly what this file exists to do once instead of per verb.
 */
import { type DatadogConfig } from "../../../datadog/config.js";
import { type DatadogConfigError, datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { type AbsoluteWindow, resolveWindow } from "../../../datadog/window.js";
import type { Result } from "../../../lib/result.js";
import { err, ok } from "../../../lib/result.js";
import { EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { type DatadogArgsError, datadogArgsErrorLines } from "./errors.js";

/**
 * The pre-flight a Datadog verb's act phase needs before it can run: parsed flags, a validated config and a
 * resolved window. Neither exit code a failure here earns (`EXIT_USAGE` for a bad flag/window,
 * `EXIT_EXPECTED_EMPTY` for credentials that are unset or malformed) can be read off a single `Result`, so
 * this carries its own code — a real `Result` whose error arm bundles the exit code with the reasons,
 * since nothing outside the calling shell branches on it.
 */
export type DatadogPreflight<TFlags> = Result<
  { readonly flags: TFlags; readonly config: DatadogConfig; readonly window: AbsoluteWindow },
  { readonly code: number; readonly errors: readonly string[] }
>;

/**
 * Parse a Datadog verb's flags, resolve its Datadog config and resolve its window — every synchronous check
 * before the first network call.
 *
 * @param rest the argv tail (after `slopweaver datadog <verb>`)
 * @param usage the verb's own usage string, appended to any rejection
 * @param parseFlags the verb's own flag parser
 * @param clockMs reads the instant a relative window is resolved against, once flags parse; the wall clock by default
 * @param loadConfig resolves the Datadog credentials and site; the environment, secrets store and profile by default
 * @returns the resolved inputs, or the exit code and reasons to report
 */
export function resolveDatadogPreflight<TFlags extends { from: string; to: string }>({
  rest,
  usage,
  parseFlags,
  clockMs = () => Date.now(),
  loadConfig = loadDatadogConfig,
}: {
  rest: readonly string[];
  usage: string;
  parseFlags: (args: { rest: readonly string[] }) => Result<TFlags, DatadogArgsError>;
  clockMs?: () => number;
  loadConfig?: () => Result<DatadogConfig, DatadogConfigError>;
}): DatadogPreflight<TFlags> {
  const parsed = parseFlags({ rest });
  if (parsed.isErr()) {
    return err({ code: EXIT_USAGE, errors: [...datadogArgsErrorLines({ error: parsed.error }), usage] });
  }
  // Window validation is a caller-args check (EXIT_USAGE) and must run before credential resolution
  // (EXIT_EXPECTED_EMPTY) — otherwise a bad --from/--to is masked by absent credentials in any
  // environment (e.g. CI) that has neither set, and the wrong exit code ships.
  const window = resolveWindow({ from: parsed.value.from, nowMs: clockMs(), to: parsed.value.to });
  if (window.isErr()) {
    return err({ code: EXIT_USAGE, errors: [...datadogDomainErrorLines({ error: window.error }), usage] });
  }
  const config = loadConfig();
  if (config.isErr()) {
    return err({ code: EXIT_EXPECTED_EMPTY, errors: datadogConfigErrorLines({ error: config.error }) });
  }
  return ok({ config: config.value, flags: parsed.value, window: window.value });
}
