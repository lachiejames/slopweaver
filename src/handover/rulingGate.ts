/**
 * The rule that the owner's rulings gate the verbs they rule on, rather than the chair's memory doing it: a ruling
 * recorded on the board is read by the verb it rules on at run time and refuses, never relying on the chair
 * remembering it across a compaction. `./rulingGateTypes.ts` carries the why and the measurement; this module is
 * the logic, and it is pure — journals in, standing gates out; gates plus one invocation in, a verdict and its
 * refusal lines out. No filesystem, no clock.
 *
 * ## Two halves, and neither is redundant
 *
 * The same split the DM-only ruling's gate uses; the two complement each other rather than duplicate:
 *
 * - **The blunt half**, at the CLI dispatch boundary. It knows `<noun> <verb>` and the raw argv and nothing
 *   else, so it matches a gate's subject as a WHOLE argv token — never a substring, never a prefix, the
 *   no-resemblance rule `./findingGate.ts` already applies to a branch.
 * - **The precise half**, {@link rulingGateVerdict}, asked by a verb that resolves its own subject.
 *   `automation run-due` is the worked case and its caller (`../cli/commands/automation/runDueRulingGate.ts`):
 *   the automation id is nowhere in its argv, so only the verb itself can say whether a gate on
 *   `iso-policy-acceptance-daily` applies to the row it is about to run.
 *
 * ## What is deliberately NOT here
 *
 * **No wildcard.** `slack *` reads as narrow and is not — it would catch `slack read-thread`, `slack when`
 * and `slack voice-rules`, none of which reaches anybody. A gate over a whole noun lists its verbs.
 *
 * **No escape hatch.** This is the HOLD arm of a policy refusal (`.claude/rules/error-handling.md` § "A
 * `hold` has no hatch, and says so"), and {@link rulingGateRefusalLines} says so out loud
 * because silence about a hatch reads as a forgotten one. An ambient variable that made the owner's own words go
 * away would be the chair's memory problem back with extra steps.
 *
 * **Silence is not a release.** A later ruling on the same row carrying no gate does NOT clear an earlier
 * gate: the common case is the owner saying something else about the same row, and reading that as a withdrawal is
 * the most dangerous inference available here. Only an explicit, anchored release lifts one — mirroring
 * `../live/automation/definition.ts`'s `RecipeHold.clearedBy`, and unlike `./ruling.ts`'s latest-decision
 * supersession, because a ruling DISPLAYS the owner's current position while a gate is a standing refusal.
 */

import { err, ok, type Result } from "#lib/result.js";

import { canonicalNoun } from "../cli/nounAliases.js";
import type { RunEvent } from "./ledger.js";
import { isCanonicalInstant } from "./ruling.js";
import { type RulingGateError, RulingGateErrors } from "./rulingGateErrors.js";
import type { GatedVerb, RulingGate, RulingGateId } from "./rulingGateTypes.js";

/**
 * The `<noun> <verb>` pairs no gate may ever name.
 *
 * A gate on `handover rule` would make the register unfixable; one on the release path would make the gate
 * unliftable. So the writer REFUSES a gate naming any of these rather than recording one that will be
 * ignored — a gate silently not firing is the exact failure this whole module exists to close.
 *
 * `handover list` is here because a board nobody can read is a board nobody can correct.
 */
export const UNGATEABLE: readonly GatedVerb[] = [
  { noun: "handover", verb: "rule" },
  { noun: "handover", verb: "gate" },
  { noun: "handover", verb: "list" },
] as const;

/**
 * Whether a gate names this verb. A gate recorded under a noun's earlier name binds the noun it now means
 * (`../cli/nounAliases.ts`), so renaming a noun never quietly releases a ruling on it.
 */
function gatesVerb({ gate, noun, verb }: { gate: StandingGate; noun: string; verb: string }): boolean {
  const current = canonicalNoun({ noun });
  return gate.verbs.some((pair) => canonicalNoun({ noun: pair.noun }) === current && pair.verb === verb);
}

/**
 * Whether a verb may never be gated.
 *
 * @param noun the CLI noun
 * @param verb the CLI verb under it
 * @returns true when the pair is in {@link UNGATEABLE}
 */
export function isUngateable({ noun, verb }: { noun: string; verb: string }): boolean {
  return UNGATEABLE.some((pair) => pair.noun === noun && pair.verb === verb);
}

/**
 * One gate's id — the row's slug, a `#`, and the placing ruling's own `atIso`.
 *
 * @param slug the row whose journal holds the ruling
 * @param atIso when the ruling was written, in canonical spelling
 * @returns an id that resolves to exactly one journal line
 */
export function rulingGateId({ slug, atIso }: { slug: string; atIso: string }): RulingGateId {
  return `${slug}#${atIso}`;
}

/** A gate as a reader sees it: what it refuses, plus the words and the anchor that placed it. */
export interface StandingGate {
  readonly id: RulingGateId;
  /** The row whose journal holds the placing ruling. */
  readonly slug: string;
  readonly verbs: readonly GatedVerb[];
  readonly subjects: readonly string[];
  /** When it lapses on its own; absent means it stands until released. */
  readonly untilIso?: string;
  /** What the owner said, as the session that heard it recorded it. Attributable, never authenticated. */
  readonly words: string;
  /** Where the owner said it, so the reader's next act is to go and check rather than to believe. */
  readonly anchor: string;
  /** When the placing ruling was written. */
  readonly placedIso: string;
}

/**
 * Every gate one row's journal places and has not lifted.
 *
 * Only a LIVE ruling may place one: an event carrying `backfilledFrom` is skipped whatever it holds, which
 * is the mirror of `./ruling.ts`'s `latestFindingRuling`. The two point opposite ways and both matter — for
 * a permission the safe failure is to withhold it, for a refusal the safe failure is not to invent one — so
 * the answer is that a reconstruction does NEITHER rather than that refusals are always safe.
 *
 * A gate whose id is not in canonical `toISOString()` spelling is skipped: its id could never be named by a
 * release, so honouring it would place a refusal nothing can lift.
 *
 * **{@link UNGATEABLE} is enforced HERE, not only on the write.** `parseGateSelectors` refusing the flag is
 * the loud, early half and it is not the invariant: `$SLOPWEAVER_HOME` is a shared directory of
 * hand-editable JSONL that every checkout on this machine writes, and `./rowEventSchema.ts` validates a
 * gated pair's SHAPE rather than its membership, so any other caller of `./rowEvent.ts`'s `applyRowEvent`
 * reaches the journal without passing the flag parser at all. A line naming `handover gate` that got in by
 * either route would refuse the only verb that could lift it. Found by the r1 review of this change, with
 * the counterexample: append such a line by hand, run `handover gate rebuild`, and `handover gate release`
 * is refused by the gate it exists to lift. Filtering at the PROJECTION covers every reader at once, which
 * is why it is not done in each verdict function. The WHOLE gate is dropped rather than the offending pair,
 * because that is exactly what the writer does — `parseGateSelectors` refuses the entire `--gates` value on
 * the first ungateable entry and records nothing — and a reader that kept the remainder would honour a gate
 * no writer here would ever have produced.
 *
 * @param slug the row these events belong to
 * @param events its journal, decoded and in order
 * @returns the gates still standing on this row, oldest first
 */
export function standingGatesOf({
  slug,
  events,
}: {
  slug: string;
  events: readonly RunEvent[];
}): readonly StandingGate[] {
  const released = releasedGateIds({ events });
  const standing: StandingGate[] = [];
  for (const event of events) {
    if (!placesGate(event)) {
      continue;
    }
    const id = rulingGateId({ atIso: event.atIso, slug });
    if (released.has(id)) {
      continue;
    }
    standing.push(
      gateOf({ anchor: event.anchor, gate: event.gate, id, placedIso: event.atIso, slug, words: event.ruling }),
    );
  }
  return standing;
}

/** A `ruling` event that carries a gate — what {@link placesGate} narrows an event to. */
type GatePlacingRuling = Extract<RunEvent, { kind: "ruling" }> & { readonly gate: RulingGate };

/** Every gate id this journal's rulings lift, in one pass, so the placing pass can ask a set. */
function releasedGateIds({ events }: { events: readonly RunEvent[] }): ReadonlySet<RulingGateId> {
  const released = new Set<RulingGateId>();
  for (const event of events) {
    if (event.kind !== "ruling" || event.gateReleases === undefined) {
      continue;
    }
    for (const id of event.gateReleases) {
      released.add(id);
    }
  }
  return released;
}

/**
 * Whether one event places a gate. It does not when it is not a ruling, carries no gate, is a
 * reconstruction, has an instant no release could ever name, or names a verb {@link UNGATEABLE} freezes —
 * {@link standingGatesOf}'s header is why each of those is a silent skip rather than a refusal.
 *
 * A type predicate rather than a function returning the gate, so the caller keeps the narrowing and reads
 * `event.anchor` and `event.ruling` off the same event without a second check.
 */
function placesGate(event: RunEvent): event is GatePlacingRuling {
  if (event.kind !== "ruling" || event.gate === undefined || event.backfilledFrom !== undefined) {
    return false;
  }
  if (!isCanonicalInstant({ iso: event.atIso })) {
    return false;
  }
  return !event.gate.verbs.some((pair) => isUngateable(pair));
}

/** One journal event's gate, flattened into what a reader needs without the event around it. */
function gateOf({
  anchor,
  gate,
  id,
  placedIso,
  slug,
  words,
}: {
  anchor: string;
  gate: RulingGate;
  id: RulingGateId;
  placedIso: string;
  slug: string;
  words: string;
}): StandingGate {
  return {
    anchor,
    id,
    placedIso,
    slug,
    subjects: gate.subjects,
    ...(gate.untilIso === undefined ? {} : { untilIso: gate.untilIso }),
    verbs: gate.verbs,
    words,
  };
}

/**
 * The gates that have not lapsed at an instant.
 *
 * Expiry is applied at READ time rather than when the index is built, so a gate that lapses at midnight
 * stops firing without anything having to run at midnight. An expired gate is SPENT, not released, and
 * `handover gate list` still shows it — "the owner ruled this and it lapsed" and "nobody ever ruled" are different
 * facts, the same distinction `./findingGate.ts` draws between `declined` and `unruled`.
 *
 * @param gates every gate the register holds
 * @param nowIso the instant to judge them at
 * @returns the gates still in force
 */
export function unexpiredGates({
  gates,
  nowIso,
}: {
  gates: readonly StandingGate[];
  nowIso: string;
}): readonly StandingGate[] {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    // An instant nothing can order cannot expire anything, and dropping every gate on an unreadable clock
    // would make a bad `--now` the way to switch the owner's rulings off.
    return gates;
  }
  return gates.filter((gate) => gate.untilIso === undefined || Date.parse(gate.untilIso) > now);
}

/**
 * The gates that refuse one invocation the verb itself describes.
 *
 * The PRECISE half. A gate with no subjects covers the whole verb; one with subjects matches only when the
 * caller names a subject the gate names, exactly.
 *
 * @param gates the gates in force
 * @param noun the CLI noun about to run
 * @param verb the CLI verb about to run
 * @param subject what this invocation is about — a recipe id, a channel — or `undefined` when it has none
 * @returns the gates that refuse it, oldest first
 */
export function rulingGateVerdict({
  gates,
  noun,
  verb,
  subject,
}: {
  gates: readonly StandingGate[];
  noun: string;
  verb: string;
  subject?: string | undefined;
}): readonly StandingGate[] {
  return gates.filter((gate) => {
    if (!gatesVerb({ gate, noun, verb })) {
      return false;
    }
    if (gate.subjects.length === 0) {
      return true;
    }
    return subject !== undefined && gate.subjects.includes(subject);
  });
}

/**
 * The gates that refuse one invocation seen only as argv.
 *
 * The BLUNT half, for the dispatch boundary, which knows the noun, the verb and the raw tail and nothing
 * else. A gate's subject matches a WHOLE argv token and nothing looser: a substring or prefix match is the
 * fuzzy matching this repository forbids, and here it would refuse `--channel C0SYN000001` because a gate named
 * `C0SYN0`.
 *
 * **A `--flag=value` token is split first, and its value half counts as a whole token.** Both spellings
 * reach every verb — `../cli/parseFlags.ts` runs `node:util`'s `parseArgs`, which accepts them equally — so
 * matching raw tokens alone made one character switch the owner's ruling off. MEASURED on a throwaway home: a gate on `handover check` scoped to `/tmp/secret-doc.md` refused `--doc /tmp/secret-doc.md`
 * and let `--doc=/tmp/secret-doc.md` straight through to the verb. Repro:
 * `handover rule <row> --gates "handover check" --gate-subject <path>`, then run both spellings. Splitting
 * at the FIRST `=` only, and comparing the halves whole, keeps the no-substring rule intact.
 *
 * A subject-scoped gate whose subject appears nowhere in argv does NOT refuse here. That is the honest
 * failure direction, and it is why the precise half above exists rather than being a convenience.
 *
 * @param gates the gates in force
 * @param noun the CLI noun about to run
 * @param verb the CLI verb about to run
 * @param argv the whole process argv, as the CLI received it
 * @returns the gates that refuse it, oldest first
 */
export function dispatchGateVerdict({
  gates,
  noun,
  verb,
  argv,
}: {
  gates: readonly StandingGate[];
  noun: string;
  verb: string;
  argv: readonly string[];
}): readonly StandingGate[] {
  const tokens = subjectTokens({ argv });
  return gates.filter((gate) => {
    if (!gatesVerb({ gate, noun, verb })) {
      return false;
    }
    if (gate.subjects.length === 0) {
      return true;
    }
    return gate.subjects.some((subject) => tokens.has(subject));
  });
}

/**
 * Every argv token a subject may match: each raw token, plus the two halves of a `--flag=value` one.
 *
 * The flag half is kept as well as the value half so a gate may name a FLAG — `--force`, say — whichever
 * spelling the caller used. {@link dispatchGateVerdict}'s header carries the measurement that made this
 * necessary; the split is on the first `=` only, so `--doc=a=b` yields `a=b` and not `a`.
 */
function subjectTokens({ argv }: { argv: readonly string[] }): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const token of argv.slice(2)) {
    tokens.add(token);
    if (!token.startsWith("--")) {
      continue;
    }
    const split = token.indexOf("=");
    if (split === -1) {
      continue;
    }
    tokens.add(token.slice(0, split));
    tokens.add(token.slice(split + 1));
  }
  return tokens;
}

/**
 * What this whole mechanism IS, in one sentence, printed above every refusal it makes.
 *
 * The lesson `./findingGate.ts`'s `WHAT_THE_FINDING_GATE_IS` records: a refusal naming a
 * mechanism nobody has defined is a refusal the reader cannot act on.
 *
 * @internal — this module's own refusal text.
 */
export const WHAT_A_RULING_GATE_IS =
  "a ruling gate is the owner's own recorded word on the board refusing the verb it rules on, so a ruling keeps " +
  "biting after the session that heard it is gone";

/**
 * The lines a refused invocation prints.
 *
 * Every gate is named with **the owner's words and the anchor**, never a paraphrase and never only an id: the
 * reader's next act is to go and read what the owner actually said, which is the one thing a bespoke mechanism like
 * `../live/automation/postTarget.ts` cannot hand them.
 *
 * @param gates the gates that refused, from {@link rulingGateVerdict} or {@link dispatchGateVerdict}
 * @param action what was about to happen, in the caller's own words (`slopweaver slack post`)
 * @returns the lines to print; empty when nothing refused
 */
export function rulingGateRefusalLines({
  gates,
  action,
}: {
  gates: readonly StandingGate[];
  action: string;
}): readonly string[] {
  if (gates.length === 0) {
    return [];
  }
  const lines = [
    `refused: ruling-gate: cannot ${action} — ${String(gates.length)} standing ruling(s) gate it`,
    `  ${WHAT_A_RULING_GATE_IS}`,
  ];
  for (const gate of gates) {
    lines.push(`  ${gate.id}`);
    lines.push(`    the owner said: ${gate.words}`);
    lines.push(`    where: ${gate.anchor}`);
    if (gate.subjects.length > 0) {
      lines.push(`    scoped to: ${gate.subjects.join(", ")}`);
    }
    if (gate.untilIso !== undefined) {
      lines.push(`    lapses at: ${gate.untilIso}`);
    }
  }
  lines.push(
    "  A ruling gate has no escape hatch and no environment override — it is lifted only by recording the owner's",
    "  own word that the constraint is over, which a reader can go and check:",
    `  slopweaver handover gate release <gate-id> --anchor <where the owner said it> --words "<the owner's words>"`,
    "  Satisfying the ruling instead is the usual answer; the gate names what the owner asked for.",
  );
  return lines;
}

/**
 * The `<noun> <verb>` pairs one `--gates` value names.
 *
 * Comma-separated entries, each a noun and a verb separated by whitespace: `--gates "slack post, recipe
 * run-due"`. Every pair is checked against the registry the caller passes, so a gate can never name a verb
 * this build does not have and quietly never fire — and against {@link UNGATEABLE}, so it can never wedge
 * the register. Both are REFUSALS rather than skips, because a gate that silently covers nothing is the
 * failure this whole module exists to close.
 *
 * @param value the raw flag value
 * @param known every `"<noun> <verb>"` this build registers
 * @returns the pairs in order, or the first reason the value is not a gate selector
 */
export function parseGateSelectors({
  value,
  known,
}: {
  value: string;
  known: ReadonlySet<string>;
}): Result<readonly GatedVerb[], RulingGateError> {
  const pairs: GatedVerb[] = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const parts = trimmed.split(/\s+/u);
    const noun = parts[0];
    const verb = parts[1];
    if (parts.length !== 2 || noun === undefined || verb === undefined) {
      return err(RulingGateErrors.selectorMalformed({ entry: trimmed }));
    }
    if (isUngateable({ noun, verb })) {
      return err(RulingGateErrors.verbUngateable({ noun, verb }));
    }
    if (!known.has(`${noun} ${verb}`)) {
      return err(RulingGateErrors.verbUnknown({ noun, verb }));
    }
    pairs.push({ noun, verb });
  }
  if (pairs.length === 0) {
    return err(RulingGateErrors.selectorMalformed({ entry: value }));
  }
  return ok(pairs);
}

/**
 * The subjects one `--gate-subject` value names — comma-separated, blanks dropped.
 *
 * A blank subject is dropped rather than refused because it can only ever come from a trailing comma, and it
 * would match no argv token: dropping it changes nothing about what the gate covers.
 *
 * @param value the raw flag value, or `undefined` when the flag was not passed
 * @returns the subjects in order; empty means the gate covers the whole verb
 */
export function parseGateSubjects({ value }: { value: string | undefined }): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(",")
    .map((subject) => subject.trim())
    .filter((subject) => subject.length > 0);
}
