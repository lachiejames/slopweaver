/*
 * `turn watch`'s flags: the spec, the parse, and the two timing flags read into a cadence. Split from
 * `./watch.ts` because that file sits at its line ratchet, and because all of it is pure but the one refusal
 * line `watchCadence` prints.
 */
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { str } from "./core.js";
import { DEFAULT_WATCH_INTERVAL_SECONDS, DEFAULT_WATCH_MAX_SECONDS } from "./watchDefaults.js";

/** Every flag `turn watch` accepts. */
const TURN_WATCH_FLAG_SPEC = {
  boolean: ["once"] as readonly string[],
  string: ["brief", "home", "interval-seconds", "max-seconds"],
} as const;

/** Every flag `turn watch` accepts, as the `--`-prefixed tokens a caller types. */
export const TURN_WATCH_FLAG_NAMES: readonly string[] = [
  ...TURN_WATCH_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_WATCH_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn watch`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnWatchArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_WATCH_FLAG_SPEC.boolean], string: [...TURN_WATCH_FLAG_SPEC.string] },
  });
}

/**
 * A positive integer flag, or the reason it was refused. Pure.
 *
 * @param fallback what to use when the flag was not given
 * @param flag the flag's display name, for the refusal text
 * @param raw the flag's raw value
 * @returns the accepted number, or the exact refusal
 */
function positiveSeconds({
  fallback,
  flag,
  raw,
}: {
  fallback: number;
  flag: string;
  raw: string | undefined;
}): { readonly seconds: number } | { readonly error: string } {
  if (raw === undefined) {
    return { seconds: fallback };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return { error: `${flag} must be a positive whole number of seconds, but got \`${raw}\`` };
  }
  return { seconds: parsed };
}

/**
 * Both timing flags, or the code a refusal already reported.
 *
 * @param values the parsed flag values
 * @returns the accepted cadence, or the refusal's exit code
 */
export function watchCadence({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): { readonly intervalSeconds: number; readonly boundSeconds: number } | { readonly code: number } {
  const interval = positiveSeconds({
    fallback: DEFAULT_WATCH_INTERVAL_SECONDS,
    flag: "--interval-seconds",
    raw: str({ key: "interval-seconds", values }),
  });
  if ("error" in interval) {
    logger.error({ msg: interval.error });
    return { code: EXIT_USAGE };
  }
  const bound = positiveSeconds({
    fallback: DEFAULT_WATCH_MAX_SECONDS,
    flag: "--max-seconds",
    raw: str({ key: "max-seconds", values }),
  });
  if ("error" in bound) {
    logger.error({ msg: bound.error });
    return { code: EXIT_USAGE };
  }
  return { boundSeconds: bound.seconds, intervalSeconds: interval.seconds };
}
