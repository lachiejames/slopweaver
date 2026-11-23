/**
 * The PURE core of `slopweaver transcripts` — the flag specs, every parser, and the time window they
 * resolve to.
 *
 * Kept whole and separate from {@link ./run} because the interesting properties of this noun are all
 * checkable without touching a transcript: that a window older than what is on disk is REFUSED as outside
 * retention rather than answered with an empty list; that `--session` is required where it is required; and
 * that the retention sentence is emitted on every path rather than only the interesting ones.
 */

import { yyyyMmDdTodayPlus } from "../../../lib/date.js";
import type { Result } from "../../../lib/result.js";
import { err, ok } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** The verb tokens this noun answers to — what a tail has to start after. */
const VERB_TOKENS: ReadonlySet<string> = new Set([
  "sessions",
  "turns",
  "summary",
  "errors",
  "latency",
  "boot-hooks",
  "draw",
]);

/** `transcripts draw` flags. */
const DRAW_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["projects", "session", "since", "until", "project", "limit", "from-tick", "to-tick", "verb"],
};

/** `transcripts sessions` flags. */
const SESSIONS_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["projects", "since", "until", "project", "limit"],
};

/** `transcripts turns` flags. */
const TURNS_FLAGS: FlagSpec = {
  boolean: ["json", "full"],
  string: ["projects", "session", "since", "until", "project", "limit"],
};

/** `transcripts summary` flags. */
const SUMMARY_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["projects", "session", "since", "until", "project"],
};

/** `transcripts errors` flags. */
const ERRORS_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["projects", "session", "since", "until", "project", "limit"],
};

/** `transcripts latency` flags. */
const LATENCY_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["projects", "session", "since", "until", "project", "limit", "tool", "command-prefix", "split", "bucket"],
};

/** `transcripts boot-hooks` flags. */
const BOOT_HOOKS_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["projects", "session", "since", "until", "project", "limit"],
};

/** `--`-prefixed flag names, for the help-truth ratchet. */
function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed, for the help-truth ratchet. */
export const TRANSCRIPTS_SESSIONS_FLAG_NAMES: readonly string[] = flagNames({ spec: SESSIONS_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TRANSCRIPTS_TURNS_FLAG_NAMES: readonly string[] = flagNames({ spec: TURNS_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TRANSCRIPTS_SUMMARY_FLAG_NAMES: readonly string[] = flagNames({ spec: SUMMARY_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TRANSCRIPTS_ERRORS_FLAG_NAMES: readonly string[] = flagNames({ spec: ERRORS_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TRANSCRIPTS_LATENCY_FLAG_NAMES: readonly string[] = flagNames({ spec: LATENCY_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TRANSCRIPTS_BOOT_HOOKS_FLAG_NAMES: readonly string[] = flagNames({ spec: BOOT_HOOKS_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TRANSCRIPTS_DRAW_FLAG_NAMES: readonly string[] = flagNames({ spec: DRAW_FLAGS });

/**
 * Parse `transcripts draw` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the accumulated rejections
 */
export function parseTranscriptsDrawArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: DRAW_FLAGS });
}

/**
 * The flag tail of an invocation, whether the verb was spoken or defaulted.
 *
 * `slopweaver transcripts --json` and `slopweaver transcripts sessions --json` must reach the same parser
 * with the same tail, and a fixed `argv.slice(3)` hands `sessions` to the parser as a stray positional.
 *
 * @param argv the full process argv (`[node, cli, transcripts, …]`)
 * @returns the tail after the noun and, when it was spoken, the verb
 */
export function transcriptsTail({ argv }: { argv: readonly string[] }): readonly string[] {
  const spoken = argv[3];
  return argv.slice(spoken !== undefined && VERB_TOKENS.has(spoken) ? 4 : 3);
}

/**
 * Parse `transcripts sessions` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the accumulated rejections
 */
export function parseTranscriptsSessionsArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: SESSIONS_FLAGS });
}

/**
 * Parse `transcripts turns` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the accumulated rejections
 */
export function parseTranscriptsTurnsArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: TURNS_FLAGS });
}

/**
 * Parse `transcripts summary` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the accumulated rejections
 */
export function parseTranscriptsSummaryArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: SUMMARY_FLAGS });
}

/**
 * Parse `transcripts errors` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the accumulated rejections
 */
export function parseTranscriptsErrorsArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: ERRORS_FLAGS });
}

/**
 * Parse `transcripts latency` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the accumulated rejections
 */
export function parseTranscriptsLatencyArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: LATENCY_FLAGS });
}

/**
 * Parse `transcripts boot-hooks` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the accumulated rejections
 */
export function parseTranscriptsBootHooksArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: BOOT_HOOKS_FLAGS });
}

/**
 * Resolve `--tool` — a comma-separated list, because the flag parser holds one value per name.
 *
 * @param raw the raw flag value
 * @returns the named tools, empty when the flag was absent
 */
export function resolveToolFilter({ raw }: { raw: string | boolean | undefined }): readonly string[] {
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/**
 * Resolve `--bucket`, a whole number of minutes.
 *
 * @param raw the raw flag value
 * @param fallbackMinutes the width used when the flag was not given
 * @returns the bucket width in milliseconds, or the rejection
 */
export function resolveBucketMs({
  raw,
  fallbackMinutes,
}: {
  raw: string | boolean | undefined;
  fallbackMinutes: number;
}): Result<number> {
  if (typeof raw !== "string") {
    return ok(fallbackMinutes * 60_000);
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0
    ? ok(parsed * 60_000)
    : err([`--bucket must be a positive whole number of minutes — got: ${raw}`]);
}

/**
 * Resolve `--split`, the instant a before/after comparison meets at.
 *
 * @param raw the raw flag value
 * @returns the epoch milliseconds, `undefined` when the flag was absent, or the rejection
 */
export function resolveSplitMs({ raw }: { raw: string | boolean | undefined }): Result<number | undefined> {
  if (typeof raw !== "string") {
    return ok(undefined);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed)
    ? err([`--split must be an ISO date/timestamp (e.g. 2026-09-15T03:28:54Z) — got: ${raw}`])
    : ok(parsed);
}

/** A resolved `--since`/`--until` pair, in epoch milliseconds. Either half may be absent. */
export interface TimeWindow {
  readonly sinceMs: number | undefined;
  readonly untilMs: number | undefined;
}

/**
 * Resolve `--since`/`--until` against an injected clock.
 *
 * Both accept an ISO date or timestamp, and `--since` also accepts `<N>d` for N days back — the shape the
 * rest of this CLI already uses, resolved by the same function rather than by a second copy of the grammar.
 *
 * @param sinceFlag the raw `--since`, or `undefined`
 * @param untilFlag the raw `--until`, or `undefined`
 * @param nowIso the reference instant a relative `--since` counts back from
 * @returns the resolved window, or the accumulated rejections
 */
export function resolveTimeWindow({
  sinceFlag,
  untilFlag,
  nowIso,
}: {
  sinceFlag: string | boolean | undefined;
  untilFlag: string | boolean | undefined;
  nowIso: string;
}): Result<TimeWindow> {
  const errors: string[] = [];
  let sinceMs: number | undefined;
  let untilMs: number | undefined;
  if (typeof sinceFlag === "string") {
    const resolved = resolveSinceIso({ nowIso, since: sinceFlag });
    if (resolved === undefined) {
      errors.push(`--since must be an ISO date/timestamp or "<N>d" (e.g. 2026-08-01 or 7d) — got: ${sinceFlag}`);
    } else {
      sinceMs = Date.parse(resolved);
    }
  }
  if (typeof untilFlag === "string") {
    const parsed = Date.parse(untilFlag);
    if (Number.isNaN(parsed)) {
      errors.push(`--until must be an ISO date/timestamp (e.g. 2026-08-20) — got: ${untilFlag}`);
    } else {
      untilMs = parsed;
    }
  }
  if (sinceMs !== undefined && untilMs !== undefined && untilMs < sinceMs) {
    errors.push("--until is before --since, so the window is empty — swap them");
  }
  return errors.length > 0 ? err(errors) : ok({ sinceMs, untilMs });
}

/**
 * Resolve a `--limit`.
 *
 * @param raw the raw flag value
 * @param fallback how many rows to show when the flag was not given
 * @returns the limit, or the rejection
 */
export function resolveLimit({
  raw,
  fallback,
}: {
  raw: string | boolean | undefined;
  fallback: number;
}): Result<number> {
  if (typeof raw !== "string") {
    return ok(fallback);
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0
    ? ok(parsed)
    : err([`--limit must be a positive whole number — got: ${raw}`]);
}

/**
 * Resolve a `--since` value to an ISO instant: `<n>d` counts back from `nowIso`, anything else must already
 * parse as a date. Pure.
 *
 * It lived in `cli/commands/vectors/core.ts` until that verb retired with the
 * rest of the embedding lane. `transcripts` was its other caller, so it moved here rather than being copied.
 *
 * @param since the raw flag value — `7d`, or any string `Date.parse` accepts
 * @param nowIso the instant a relative value counts back from, injected so this stays pure
 * @returns the resolved ISO instant, or `undefined` when the value parses as neither
 */
function resolveSinceIso({ since, nowIso }: { since: string; nowIso: string }): string | undefined {
  const relative = /^(\d+)d$/.exec(since);
  if (relative !== null) {
    return yyyyMmDdTodayPlus({ days: -Number(relative[1]), now: new Date(nowIso) });
  }
  return Number.isNaN(Date.parse(since)) ? undefined : since;
}
