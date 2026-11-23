/**
 * Pure option parsing for `slopweaver session-start`. No I/O, no clock — everything here is decided from
 * argv alone, so a parse rejection costs nothing and can be tested without a corpus.
 */

import type { Result } from "../../../lib/result.js";
import { err, ok } from "../../../lib/result.js";
import { deadlineMsOf } from "../../../sessionStart/deadline.js";
import { DEFAULT_TOP } from "../../../sessionStart/render.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { type SessionStartError, SessionStartErrors } from "./errors.js";

/**
 * The flags `session-start` accepts.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const SESSION_START_FLAGS: FlagSpec = {
  boolean: ["json", "probe", "no-verify", "no-record", "help"],
  string: ["home", "dir", "base", "now", "deadline", "top", "out"],
};

/**
 * Every flag this verb accepts, exported so `--help`'s advertised usage is checked against the parser
 * rather than against a hand-kept copy of it. `--help` is handled before parsing and is not advertised.
 */
export const SESSION_START_FLAG_NAMES: readonly string[] = [
  "--json",
  "--probe",
  "--no-verify",
  "--no-record",
  "--top",
  "--now",
  "--deadline",
  "--home",
  "--dir",
  "--base",
  "--out",
];

/** The verbs this noun registers, so a bare `slopweaver session-start --top 5` is not read as a verb. */
export const SESSION_START_VERBS: readonly string[] = ["run"];

export const SESSION_START_USAGE =
  "usage: slopweaver session-start [--json] [--probe] [--no-verify] [--no-record] [--top <n>] [--now <iso>] [--deadline <iso>] [--home <dir>] [--dir <dir>] [--base <ref>] [--out <path>]";

/**
 * What one `session-start` run was asked to do.
 *
 * @internal the contract between this parser and the verb's own shell.
 */
export interface SessionStartOptions {
  readonly json: boolean;
  /** Whether `command:` probes may run. Off by default: the cheap probes are what protect the LOOKS SHIPPED line. */
  readonly probe: boolean;
  /**
   * Whether every row is re-read live through the door before it is ranked.
   *
   * ON by default, and `--no-verify` is the opt-out. Opt-in, with a caveat printed on every run saying the
   * states were the corpus's own copy, MEASURED as shipping the owner a list of ten rows where three described work
   * that had already merged or closed. A default that is honest only when a flag is remembered is not a default,
   * and a caveat standing in for it is read past on every run.
   *
   * `--no-verify` survives for the fast local case: it leaves the machine, so a run over a home with no
   * credentials, or a quick check while working on the verb itself, should not have to wait on GitHub.
   */
  readonly verify: boolean;
  /**
   * Whether this run records its own snapshot for the next one to diff against.
   *
   * Recording is the default, because reconciliation is the point: a run the owner did not record is a morning the
   * next list cannot say anything about. `--no-record` exists for the diagnostic case — running the verb
   * five times while working on it would otherwise leave "what moved" meaning "what moved in ninety
   * seconds", which is worse than useless because it reads as authoritative.
   */
  readonly record: boolean;
  readonly top: number;
  /** The run's own instant. Supplied so a frozen fixture judges its own time rather than the wall clock. */
  readonly now: string | undefined;
  /**
   * The wall-clock instant past which the run's remaining live legs and its live re-read are skipped, each said
   * in `couldNotSee`, so a caller holding a hard budget gets a list cut short rather than none
   * (`../../../sessionStart/deadline.ts`). Undefined: the run reads everything, however long it takes.
   */
  readonly deadlineMs: number | undefined;
  readonly home: string | undefined;
  readonly dir: string | undefined;
  readonly base: string | undefined;
  /**
   * Where the `--json` document is written, atomically, instead of stdout. It implies `--json`. It exists so the
   * chair can build the owner's list with no budget under load and hand the file to `supervisor tick close --your-list`
   * without a shell redirect, which the raw-bash gate refuses, and so a reader never sees a half-written list.
   */
  readonly out: string | undefined;
}

/**
 * Read `--top`, which must be a positive whole number.
 *
 * Rejected rather than clamped. A caller who typed `--top 0` meant something, and silently showing ten
 * rows instead would be a list that disagrees with the command that produced it.
 *
 * @param raw the flag's text, or undefined when it was not passed
 * @returns the row count, or the reason it was refused
 */
export function parseTop({ raw }: { raw: string | undefined }): Result<number, SessionStartError> {
  if (raw === undefined) {
    return ok(DEFAULT_TOP);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return err(SessionStartErrors.topNotPositive({ got: raw }));
  }
  return ok(value);
}

/**
 * Read `--deadline`, which must be a UTC instant. Refused rather than ignored: a caller that passed one is
 * holding a hard budget, and a deadline silently dropped is a run that gets killed instead of cut short.
 *
 * @param raw the flag's text, or undefined when it was not passed
 * @returns the deadline in epoch milliseconds, undefined when none was passed, or why it was refused
 */
export function parseDeadline({ raw }: { raw: string | undefined }): Result<number | undefined, SessionStartError> {
  if (raw === undefined) {
    return ok(undefined);
  }
  const ms = deadlineMsOf({ raw });
  if (ms === undefined) {
    return err(SessionStartErrors.deadlineNotAnInstant({ got: raw }));
  }
  return ok(ms);
}

/**
 * One declared string flag, or `undefined`.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns the value, or `undefined` when the flag was not passed
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * One declared boolean flag. Absent reads as `false`, never as a reason to guess.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns whether the flag was passed
 */
export function boolFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): boolean {
  return parsed.values[name] === true;
}

/**
 * Turn parsed flags into the options one run reads.
 *
 * @param parsed the flags, already split from argv
 * @returns the options, or why they were refused
 */
export function sessionStartOptions({
  parsed,
}: {
  parsed: ParsedFlags;
}): Result<SessionStartOptions, SessionStartError> {
  const top = parseTop({ raw: stringFlag({ name: "top", parsed }) });
  if (top.isErr()) {
    return err(top.error);
  }
  const deadline = parseDeadline({ raw: stringFlag({ name: "deadline", parsed }) });
  if (deadline.isErr()) {
    return err(deadline.error);
  }
  const out = stringFlag({ name: "out", parsed });
  return ok({
    base: stringFlag({ name: "base", parsed }),
    deadlineMs: deadline.value,
    dir: stringFlag({ name: "dir", parsed }),
    home: stringFlag({ name: "home", parsed }),
    json: out !== undefined || boolFlag({ name: "json", parsed }),
    now: stringFlag({ name: "now", parsed }),
    out,
    probe: boolFlag({ name: "probe", parsed }),
    record: !boolFlag({ name: "no-record", parsed }),
    top: top.value,
    verify: !boolFlag({ name: "no-verify", parsed }),
  });
}

/**
 * Parse `session-start`'s own arguments.
 *
 * @param rest argv after the noun and verb
 * @returns the parsed flags, or the reasons they were refused
 */
export function parseSessionStartArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: SESSION_START_FLAGS });
}
