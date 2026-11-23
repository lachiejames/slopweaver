/**
 * Pure option parsing for `slopweaver session-start lock-in`. No I/O, no clock — everything here is decided
 * from argv alone, so a parse rejection costs nothing and can be tested without a home.
 *
 * The verb records ONE resolution. It is the walk's only write, and the walk itself happens in a visible
 * session: the conversation needs judgement, and the memo's own ruling is that judgement does not go in the
 * CLI. What the CLI owns is the vocabulary — a session cannot invent a sixth outcome, because this parser
 * refuses one by name.
 */

import type { Result } from "../../../lib/result.js";
import { err, ok } from "../../../lib/result.js";
import {
  LOCK_IN_OUTCOMES,
  LOCK_IN_REASONS,
  LOCK_IN_VERBS,
  type LockInOutcome,
  type LockInReason,
  type LockInRow,
  type LockInVerb,
} from "../../../sessionStart/lockIn.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { boolFlag, stringFlag } from "./core.js";
import {
  type SessionStartError,
  SessionStartErrors,
  type SessionStartFlagMissingError,
  type SessionStartFlagRefusal,
} from "./errors.js";

/**
 * The flags `session-start lock-in` accepts.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const LOCK_IN_FLAGS: FlagSpec = {
  boolean: ["json", "help"],
  string: ["item", "against", "proposed", "reply", "outcome", "reason", "note", "until", "home", "now"],
};

/** Every flag this verb accepts, so `--help`'s advertised usage is checked against the parser. */
export const LOCK_IN_FLAG_NAMES: readonly string[] = [
  "--item",
  "--against",
  "--proposed",
  "--reply",
  "--outcome",
  "--reason",
  "--note",
  "--until",
  "--json",
  "--now",
  "--home",
];

/** The verbs this handler answers to. */
export const LOCK_IN_VERB_NAMES: readonly string[] = ["lock-in"];

/**
 * What one `lock-in` invocation was asked to record.
 *
 * @internal the contract between this parser and the verb's own shell.
 */
export interface LockInOptions {
  readonly row: LockInRow;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Read one value that must be a member of a closed vocabulary.
 *
 * Refused by NAME rather than silently ignored, and the refusal lists the vocabulary, because the caller is
 * a session composing a reply it heard in conversation. A typo that fell through to a default would record
 * the wrong verdict about the owner's work.
 *
 * @param raw what was passed
 * @param flag the flag's name, for the message
 * @param allowed every value this flag accepts
 * @returns the value, or the reason it was refused
 */
function oneOf<T extends string>({
  raw,
  flag,
  allowed,
}: {
  raw: string | undefined;
  flag: string;
  allowed: readonly T[];
}): Result<T, SessionStartFlagRefusal> {
  if (raw === undefined) {
    return err(SessionStartErrors.vocabularyFlagMissing({ allowed, flag }));
  }
  const found = allowed.find((value) => value === raw);
  if (found === undefined) {
    return err(SessionStartErrors.notInVocabulary({ allowed, flag, got: raw }));
  }
  return ok(found);
}

/** One required free-text value. */
function required({
  raw,
  flag,
}: {
  raw: string | undefined;
  flag: string;
}): Result<string, SessionStartFlagMissingError> {
  if (raw === undefined || raw.trim().length === 0) {
    return err(SessionStartErrors.flagMissing({ flag }));
  }
  return ok(raw);
}

/**
 * Whether the outcome and its extras agree with each other.
 *
 * Three pairings the ledger's own reader depends on, checked here so a bad row is never written rather than
 * being tolerated on the way out. A `deferred` with no `--until` would hold the item off the list forever,
 * which is the one failure this design is built to avoid.
 *
 * @param outcome what the resolution amounted to
 * @param reason the one-tag reason, when given
 * @param until when a deferral lapses, when given
 * @returns every disagreement, empty when the row is coherent
 */
export function outcomeIssues({
  outcome,
  reason,
  until,
}: {
  outcome: LockInOutcome;
  reason: LockInReason | undefined;
  until: string | undefined;
}): readonly string[] {
  const issues: string[] = [];
  if (outcome === "deferred" && until === undefined) {
    issues.push("--until is required with --outcome deferred, or the item is held off the list forever");
  }
  if (outcome !== "deferred" && until !== undefined) {
    issues.push(`--until only applies to --outcome deferred, not ${outcome}`);
  }
  if ((outcome === "rejected" || outcome === "edited") && reason === undefined) {
    issues.push(`--reason is required with --outcome ${outcome} — it is what makes the correction countable`);
  }
  return issues;
}

/**
 * Turn parsed flags into the resolution one invocation records.
 *
 * @param parsed the flags, already split from argv
 * @param nowIso the instant to stamp the row with, supplied rather than read
 * @returns the options, or why they were refused — every refused flag at once, or every outcome disagreement
 */
export function lockInOptions({
  parsed,
  nowIso,
}: {
  parsed: ParsedFlags;
  nowIso: string;
}): Result<LockInOptions, SessionStartError> {
  const item = required({ flag: "--item", raw: stringFlag({ name: "item", parsed }) });
  const against = required({ flag: "--against", raw: stringFlag({ name: "against", parsed }) });
  const proposed = required({ flag: "--proposed", raw: stringFlag({ name: "proposed", parsed }) });
  const reply = oneOf<LockInVerb>({
    allowed: LOCK_IN_VERBS,
    flag: "--reply",
    raw: stringFlag({ name: "reply", parsed }),
  });
  const outcome = oneOf<LockInOutcome>({
    allowed: LOCK_IN_OUTCOMES,
    flag: "--outcome",
    raw: stringFlag({ name: "outcome", parsed }),
  });
  const rawReason = stringFlag({ name: "reason", parsed });
  const reason =
    rawReason === undefined
      ? ok(undefined)
      : oneOf<LockInReason>({ allowed: LOCK_IN_REASONS, flag: "--reason", raw: rawReason });

  const refusals = [item, against, proposed, reply, outcome, reason].flatMap((read) =>
    read.isErr() ? [read.error] : [],
  );
  if (item.isErr() || against.isErr() || proposed.isErr() || reply.isErr() || outcome.isErr() || reason.isErr()) {
    return err(SessionStartErrors.lockInRefused({ refusals }));
  }

  const until = stringFlag({ name: "until", parsed });
  const issues = outcomeIssues({ outcome: outcome.value, reason: reason.value, until });
  if (issues.length > 0) {
    return err(SessionStartErrors.outcomeIncoherent({ reasons: issues }));
  }

  const note = stringFlag({ name: "note", parsed });
  return ok({
    home: stringFlag({ name: "home", parsed }),
    json: boolFlag({ name: "json", parsed }),
    row: {
      againstWhenIso: against.value,
      identity: item.value,
      outcome: outcome.value,
      proposed: proposed.value,
      tsIso: nowIso,
      verb: reply.value,
      ...(until === undefined ? {} : { deferredUntilIso: until }),
      ...(note === undefined ? {} : { note }),
      ...(reason.value === undefined ? {} : { reason: reason.value }),
    },
  });
}

/**
 * Parse `session-start lock-in`'s own arguments.
 *
 * @param rest argv after the noun and verb
 * @returns the parsed flags, or the reasons they were refused
 */
export function parseLockInArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LOCK_IN_FLAGS });
}
