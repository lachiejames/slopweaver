/**
 * The plain-words line an act recorded BEFORE that field existed can honestly be given. Pure — two stored
 * fields in, one sentence or nothing out. No I/O, no clock, no per-kind phrasebook.
 *
 * ## Why a derivation is needed at all, and why it has to be this narrow
 *
 * Measured on a live register (`slopweaver autonomy list --json | jq -r '.action.kind' | wc -l`
 * and `| sort -u | wc -l`): **693 acts across 206 distinct kinds, 640 of them unsteered** — which is to say
 * 640 cards on the console's queue drawer, each of which showed the owner the fleet's own `why` as its opening
 * line. Hand-writing a line for 640 rows is not a thing a session does, so the backfill is mechanical or it
 * does not happen.
 *
 * The constraint that shapes everything below is `./adopt.ts`'s, which this transformation joins:
 * **adoption never manufactures what the record does not hold.** `recordingProvenanceWitness` refuses to infer that an
 * act succeeded, and this refuses to infer why one mattered. So a derived line states WHAT was done and TO
 * WHAT, both read off the row, and then says in its own words that it was written after the fact.
 *
 * ## What the record actually holds that the owner can read
 *
 * `kind` and `subject`, and both are already words wearing punctuation. `../autonomy/label.ts`'s
 * `autonomyKindLabel` opens a kind's separators out and refuses a lookup table, for the reason that applies
 * here twice over: with 206 kinds in the register a hand-written table of verb phrases is a generator of
 * confident lies about what the fleet did.
 *
 * The SUBJECT is the half worth stating, because it is where the content is. The kind the owner could not parse was
 * `open-internal-finding-pull-request`, and on those rows the subject is the board row's own slug — which is
 * an English sentence with hyphens in it. `eight-of-the-workos-atlas-s-fourteen-declared` opened out is
 * "eight of the workos atlas s fourteen declared": awkward, and the first thing on that card that told the owner
 * what it was about. That is the whole derivation.
 *
 * ## It refuses rather than guessing, and the refusal is the interesting case
 *
 * A derived line is held to the same criterion a session-authored one is (`./said.ts`) — the point of
 * opening a slug out is that the result is no longer a slug, so a line that still trips the check has not
 * been made readable and is not worth writing. A row that trips it keeps no `said` at all, and the console
 * says the absence out loud rather than showing a line nobody can use.
 *
 * ## One class the shared criterion cannot see, and why the sense for it lives HERE
 *
 * Measured, by running `autonomy adopt --apply` over a fixture and then a live register: the
 * transform LAUNDERED a turn reference past the shared check, thirteen times. `./said.ts`'s
 * `RULE_NUMBER_SENSE` looks for `NNN-N`, with a hyphen; `autonomyKindLabel` turns every hyphen into a space
 * before the check runs; so a slug such as `the-291-14-disaster-recovery-plan` became "the 291 14 disaster
 * recovery plan" and passed. The door refuses the very same words when a session types them.
 *
 * Checking the RAW subject instead is no fix — `RULE_NUMBER_SENSE`'s lookbehind is `(?<![\dA-Za-z-])`, and
 * in a slug that `291` is preceded by a hyphen, so the sense is blind at both ends of the transform. What is
 * needed is a sense for the SHAPE THE TRANSFORM CREATES, and that sense belongs in this file rather than in
 * `./said.ts`: here, two numbers separated by a space are known to have been a hyphenated pair a moment ago,
 * and nothing else could have put them there. In a line a session authored they are just numbers, and a
 * general sense refusing them would refuse the way the owner writes — which is the one thing `./said.ts`'s
 * measurement was taken to prevent.
 */
import { autonomyKindLabel, autonomySubjectLabel } from "./label.js";
import { pastTheFold, unparsableIn } from "./said.js";
import { classifyAutonomySubject } from "./subject.js";
import { AUTONOMY_SAID_MAX } from "./types.js";

/**
 * The sentence that keeps a derived line from reading as something a session said at the time.
 *
 * It is the honest half of the transformation, and it is why the whole thing is allowed: the row's own
 * plain-words field is empty, and a line appearing in it with no note of where it came from would be this
 * register asserting that a session wrote for the owner when none did.
 */
const DERIVED_PROVENANCE =
  "Written from the record afterwards — the session that did it left no line in plain words, and the fleet's own note is below.";

/**
 * A turn reference this file's own transform has laundered into two words — `291-8x` in a slug arriving as
 * `291 8x` in the sentence.
 *
 * Same shape as `./said.ts`'s `RULE_NUMBER_SENSE` second arm with a space where its hyphen is, and the same
 * lookarounds for the same reason: they keep a clock time, a version and a date out. See the file overview
 * for why the sense is here and not there.
 */
const LAUNDERED_TURN_REFERENCE = /(?<![\dA-Za-z-])\d{2,3} \d{1,2}[a-z]?(?![\dA-Za-z-])/u;

/**
 * The subject as words, or `undefined` when no reading of it is better than the raw value.
 *
 * Three arms because `./subject.ts` classifies three forms, and each needs a different sentence fragment
 * rather than a shared one: a pull request is a THING the owner owns and can open, a board row is a SENTENCE
 * somebody wrote, and a file is a PATH. A subject the classifier does not recognise at all answers
 * `undefined`, which drops the clause rather than pasting an unclassified string into a line addressed to
 * the owner.
 */
function subjectWords({ subject }: { subject: string }): string | undefined {
  const classified = classifyAutonomySubject({ subject });
  if (classified === undefined) {
    return undefined;
  }
  if (classified.kind === "url") {
    return autonomySubjectLabel({ subject });
  }
  if (classified.kind === "state") {
    return `the file ${classified.relativePath}`;
  }
  // The board arm goes through the same separators-to-spaces transform a kind does, because a board slug is
  // built the same way: the sentence somebody wrote, hyphenated. Same function, deliberately — a second
  // copy of one `replaceAll` is how two surfaces start disagreeing about what a row says.
  return autonomyKindLabel({ kind: classified.value });
}

/**
 * The plain-words line a stored act can honestly be given, or `undefined` when none can be.
 *
 * A caller gets one sentence naming the act and what it was on, then {@link DERIVED_PROVENANCE}. It answers
 * `undefined` rather than a weaker line when the subject does not classify, when the result would still
 * carry something `unparsableIn` refuses, or when it would run past the register's own bound — see this
 * file's overview on why refusing is the right end of that trade.
 *
 * @param kind the act's kind, as the register stored it
 * @param subject the act's subject, in any of the three stored forms
 * @returns the line, or `undefined` when the record holds nothing readable to build one from
 */
export function derivedSaid({ kind, subject }: { kind: string; subject: string }): string | undefined {
  const on = subjectWords({ subject });
  if (on === undefined) {
    return undefined;
  }
  const line = `${autonomyKindLabel({ kind })}, on ${on}. ${DERIVED_PROVENANCE}`;
  if (line.length > AUTONOMY_SAID_MAX) {
    return undefined;
  }
  if (unparsableIn({ said: line }) !== undefined) {
    return undefined;
  }
  if (LAUNDERED_TURN_REFERENCE.test(line)) {
    return undefined;
  }
  // The card draws only what fits above its fold and renders the remainder nowhere, so a derived line past
  // that budget would lose its LAST sentence — which is the provenance clause, the one thing keeping a
  // backfilled line from reading as words a session chose. `./said.ts`'s `pastTheFold` carries the measurement.
  if (pastTheFold({ said: line }) !== undefined) {
    return undefined;
  }
  return line;
}

/**
 * Whether a stored `said` is one this module wrote, rather than words a session chose.
 *
 * The distinction is what lets adoption CORRECT its own output — the thirteen laundered lines in the file
 * overview could not be repaired otherwise, because the ordinary rule is that a row already carrying a said
 * is left alone. It asks whether the line ends in {@link DERIVED_PROVENANCE}, which is the sentence this
 * module appends and a session writing in the owner's voice would never type.
 *
 * @param said the line as the register stored it
 * @returns whether adoption may rewrite or remove it
 */
export function isDerivedSaid({ said }: { said: string }): boolean {
  return said.endsWith(DERIVED_PROVENANCE);
}

/**
 * What adoption does to one row's `said`: nothing, write a derived line, or take back one it wrote before.
 *
 * `remove` exists because a derived line is adoption's OUTPUT, so a sharpened derivation has to be able to
 * retract one it can no longer stand behind. Leaving a stale one in place would make the field this whole
 * register exists to protect the one field a fix cannot reach.
 */
export type SaidPatch =
  { readonly kind: "leave" } | { readonly kind: "write"; readonly said: string } | { readonly kind: "remove" };

/**
 * What one stored row's `said` becomes when `./adopt.ts` passes over it.
 *
 * A row is left alone for four different facts rather than four guards on one. A row carrying a said A
 * SESSION WROTE is never touched — replacing a person's words is the history rewrite adoption refuses on
 * every other field. A STEER row has no act to describe. A row whose `kind` or `subject` is missing or not a
 * string is one validation is about to refuse anyway, so deriving from it would only change which error the
 * operator reads. And a row whose derivation comes back `undefined` with nothing stored is one this module
 * could not make readable.
 *
 * **A line adoption ITSELF wrote is the exception, and it is the whole reason this answers three ways rather
 * than two.** {@link isDerivedSaid} tells the two apart, so a derivation that has since been sharpened can
 * rewrite its own output — or, when it now refuses the row outright, take the line back rather than leave a
 * stale one standing. Measured: thirteen live rows held a turn reference the transform had
 * laundered past the shared check, and under the old two-answer shape not one of them was reachable, because
 * they already carried a said.
 *
 * The caller reads these off the PATCHED object rather than the source, so a `subject` a replacement just
 * repaired is the subject the line names. Deriving from the source would have put the unreadable original —
 * which is by definition the value that could not be read — into the one field written for the owner.
 *
 * @param kind the row's kind as stored, or whatever non-string stands there
 * @param subject the row's subject as stored
 * @param standing the `said` already on the row, absent when it has none
 * @param steered whether the row carries a `steeredIso`, which means there is no act here to describe
 * @returns leave it, write this line, or remove the one standing
 */
export function saidPatchFor({
  kind,
  subject,
  standing,
  steered,
}: {
  kind: unknown;
  subject: unknown;
  standing: unknown;
  steered: boolean;
}): SaidPatch {
  if (steered) {
    return { kind: "leave" };
  }
  const oursToChange = typeof standing === "string" && isDerivedSaid({ said: standing });
  if (standing !== undefined && !oursToChange) {
    return { kind: "leave" };
  }
  if (typeof kind !== "string" || typeof subject !== "string") {
    return { kind: "leave" };
  }
  const derived = derivedSaid({ kind, subject });
  if (derived === undefined && oursToChange) {
    return { kind: "remove" };
  }
  if (derived === undefined || derived === standing) {
    return { kind: "leave" };
  }
  return { kind: "write", said: derived };
}
