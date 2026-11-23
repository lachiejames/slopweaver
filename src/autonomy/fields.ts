/**
 * The FIELD rules of the autonomy ledger: what one value has to look like, told apart from what a row has
 * to carry. `./row.ts` assembles rows, `./decode.ts` decodes them, and both ask every question here.
 *
 * Split out of `row.ts` because the two halves have different readerships as well as different subjects.
 * Four of these are exported as PREDICATES, and each is read by a module that never builds a row at all:
 * `../cli/commands/autonomy/adopt.ts` asks which value space an adoption's positional falls in,
 * `../outbound/briefing/autonomySchema.ts` refines a subject, and `../cli/commands/github/findingRulingGate.ts`
 * checks an id it mints. A caller wanting one rule should not have to load the whole parser to reach it.
 *
 * Pure, like `./row.ts`: no filesystem, no clock, no network. `isAutonomyInstant` constructs a `Date` to ask
 * whether a well-shaped string denotes a real moment, which reads the calendar and never the clock.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type AutonomyError, AutonomyErrors } from "./errors.js";
import { pastTheFold, unparsableIn } from "./said.js";
import { classifyAutonomySubject } from "./subject.js";
import {
  AUTONOMY_ACTION_ID_MAX,
  AUTONOMY_ACTION_ID_MIN,
  AUTONOMY_KIND_MAX,
  AUTONOMY_KIND_MIN,
  AUTONOMY_SAID_MAX,
  AUTONOMY_SLUG_PATTERN,
} from "./types.js";

/** The one instant spelling this register accepts. Every quantifier is bounded, so the match is linear. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,30})?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * A field whose value has to be text: trimmed, non-empty, and inside the bound its own field carries.
 *
 * @param field the field name a refusal names, so one message says which value was wrong
 * @param max the longest the trimmed value may be
 * @returns the trimmed value, or the rule that refused it
 */
export function requireText({
  field,
  value,
  max,
}: {
  field: string;
  value: string;
  max: number;
}): Result<string, AutonomyError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(AutonomyErrors.invalidField({ field, why: "is empty" }));
  }
  if (trimmed.length > max) {
    return err(
      AutonomyErrors.invalidField({
        field,
        why: `is ${String(trimmed.length)} characters, over the ${String(max)} allowed`,
      }),
    );
  }
  return ok(trimmed);
}

/**
 * An ISO-8601 instant, in the one spelling: a date, `T`, a time to the second, an optional fraction of any
 * length, and `Z` or a `±HH:MM` offset.
 *
 * The SHAPE is required rather than just "something `Date` parses", and that is a correctness requirement
 * rather than tidiness. `Date` also parses a dotted date such as `YYYY.MM.DD 00:00:00 GMT` and a single-digit hour such as `YYYY-MM-DD 2:06:09.000001 GMT`,
 * and `../autonomy/query.ts` has to order two acts inside one second by reading their fraction out of the
 * TEXT — because no `Date` holds a precision below the millisecond. A scan over an open set of spellings
 * cannot be made total: each pattern that covers one of them leaves another (a dotted date eaten as a fraction; a single-digit hour that stopped
 * the fraction matching at all). Fixing the shape at the door makes the scan total by construction.
 *
 * Measured before narrowing, so this refuses nothing the register already holds: every `doneIso` in the live
 * file is already this shape. Reproduce with
 * `grep -oE '"doneIso"[[:space:]]*:[[:space:]]*"[^"]*"' "$SLOPWEAVER_HOME/ledgers/autonomy.jsonl"`.
 *
 * @param field the field name a refusal names
 * @returns the trimmed instant, or the rule that refused it
 */
export function requireInstant({ field, value }: { field: string; value: string }): Result<string, AutonomyError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(AutonomyErrors.invalidField({ field, why: "is empty" }));
  }
  if (!isAutonomyInstant({ value: trimmed })) {
    return err(
      AutonomyErrors.invalidField({
        field,
        why: `is "${trimmed}", which is not an ISO-8601 instant a clock can parse, as in \`2026-09-12T02:06:09Z\``,
      }),
    );
  }
  return ok(trimmed);
}

/**
 * Whether a string is an instant in the one spelling this register accepts.
 *
 * The predicate half of {@link requireInstant}, exported for the same reason {@link isCheckableSubject} is:
 * `../cli/commands/autonomy/adopt.ts` decides which FIELD an adoption's `<actionId>=<value>` positional
 * names by asking which of the two value spaces its value falls in, and asking that question with a second
 * copy of this pattern is how the two would drift apart.
 *
 * It judges the value EXACTLY as given and never trims — {@link requireInstant} trims before asking, and
 * {@link isCheckableSubject} does not trim either, so the adopt classifier sees one rule rather than two.
 * Trimming here would have let an instant padded with spaces through the classifier and into the register's wire
 * line padded, while the record read back off it held the trimmed spelling: the file and the row a reader
 * gets from it would have disagreed about the act's own instant.
 *
 * @param value the candidate instant
 * @returns true when it matches the shape AND denotes a moment a clock can parse
 */
export function isAutonomyInstant({ value }: { value: string }): boolean {
  return ISO_INSTANT.test(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * Whether a kind is a slug this register will accept.
 *
 * @param kind the candidate slug
 * @returns true when it matches the shared pattern and the kind length bounds
 */
export function isAutonomyKind({ kind }: { kind: string }): boolean {
  return kind.length >= AUTONOMY_KIND_MIN && kind.length <= AUTONOMY_KIND_MAX && AUTONOMY_SLUG_PATTERN.test(kind);
}

/**
 * Whether an id is one this register will accept.
 *
 * The id is the ACTING SESSION's choice, not a digest this module mints, and that is the identity contract:
 * a session picks an id once for an occurrence and reuses it if it has to record the same act again, so a
 * retried append is idempotent rather than a second row. A content hash cannot do that job — two enqueues of
 * one pull request minutes apart are two occurrences a hash would separate only by their instants, while a
 * retry that reworded its own `why` would mint a fresh id for one act.
 *
 * Hand-written ids are the ordinary case rather than a concession: this register's first rows were appended
 * directly by a session acting before the verb existed, under ids like `16644-enqueue`, which read better to
 * a human than a digest does.
 *
 * @param actionId the candidate id
 * @returns true when it matches the shared pattern and the id length bounds
 */
export function isAutonomyActionId({ actionId }: { actionId: string }): boolean {
  return (
    actionId.length >= AUTONOMY_ACTION_ID_MIN &&
    actionId.length <= AUTONOMY_ACTION_ID_MAX &&
    AUTONOMY_SLUG_PATTERN.test(actionId)
  );
}

/**
 * Whether a subject is a checkable id a row may carry — one of the three forms `./subject.ts` classifies.
 *
 * The rule lives there rather than here because three readers need the same answer: this parser, the
 * briefing form's schema and the renderer that decides whether a subject becomes a link. This function is
 * the predicate half of it, kept because a schema refinement and a shape check both want a boolean.
 *
 * @param subject the candidate subject
 * @returns true when it is an absolute http(s) URL, a board row slug, or a `state:` reference
 */
export function isCheckableSubject({ subject }: { subject: string }): boolean {
  return classifyAutonomySubject({ subject }) !== undefined;
}

/**
 * The plain-words line, checked, or the reason it is not one.
 *
 * Two rules in the order a composer meets them: it has to be text inside the cap, and it has to be readable
 * by someone who has not read this repository. The second is `./said.ts`'s whole subject and is applied
 * HERE rather than at the verb, for `buildAutonomyAction`'s own reason — a caller that is not the CLI must
 * not be able to skip it. Presence is the verb's rule; this is validity, and it runs wherever a said appears.
 *
 * @returns the trimmed line, or the first of the two rules that refused it
 */
export function requireSaid({ said }: { said: string }): Result<string, AutonomyError> {
  const text = requireText({ field: "said", max: AUTONOMY_SAID_MAX, value: said });
  if (text.isErr()) {
    return err(text.error);
  }
  const found = unparsableIn({ said: text.value });
  if (found !== undefined) {
    return err(AutonomyErrors.unparsableSaid({ found }));
  }
  const over = pastTheFold({ said: text.value });
  if (over !== undefined) {
    return err(AutonomyErrors.saidPastTheFold(over));
  }
  return ok(text.value);
}
