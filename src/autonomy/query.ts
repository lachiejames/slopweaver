/**
 * Folding and filtering the autonomy ledger. Pure — records in, records out, no I/O and no clock.
 *
 * The one operation that matters is {@link foldAutonomy}: the file is a flat, time-ordered mix of acts and
 * the owner's steers on them, and every reader wants the same thing — each act, newest first, with the
 * owner's latest word on it attached. That fold is why the steer can be an appended row while a reader still sees
 * one word per act (`./types.ts`'s overview).
 *
 * ## Newest first is a property of the FOLD, not of the file
 *
 * The briefing section reads newest first. Doing it here rather than in the renderer means every reader of
 * this register agrees about the order — `slopweaver autonomy list` and the page the owner reads show the same
 * act at the top, so a row the owner is steering by position cannot be a different row in the two places.
 *
 * The sort is by `doneIso` descending, and a tie breaks on the id rather than on file order. A tie is real:
 * two acts recorded in the same second by one session sort identically by instant. The id is the only other
 * fact that is stable across two reads of the same file, so it is the one that keeps the order deterministic.
 *
 * ## One id is one occurrence, and a repeat is not a defect
 *
 * A session that crashes between acting and recording retries its append with the SAME id and the same
 * fields, so the register can legitimately hold two identical lines for one act. Those fold to one. Two rows
 * under one id that DISAGREE are a different thing entirely — one id naming two occurrences, which would
 * leave a steer against it unable to say which act it judges — and that is
 * {@link ../errors.js AutonomyErrors.actionIdConflict}, refused rather than silently resolved.
 */
import { err, ok, type Result } from "../lib/result.js";

import { classAdmits, classIdOf, governingClass, isClassSteerRecord } from "./classSteer.js";
import { type AutonomyError, AutonomyErrors } from "./errors.js";
import { isSteerRecord } from "./row.js";
import type {
  AutonomyAction,
  AutonomyActionRow,
  AutonomyClassSteerRow,
  AutonomyPatternSteer,
  AutonomyRecord,
  AutonomySteerRow,
} from "./types.js";

/**
 * Every field two rows under one id must agree about, in the order a conflict names them.
 *
 * `said` is one since it decides which PATTERN an act joins ({@link autonomyPatternKeys}): two lines under one
 * id disagreeing only in it would otherwise keep whichever came first, so reordering the ledger would regroup
 * acts and move the owner's word from one card to another. Measured on the live register when this landed, no id
 * carried two different saids, so no read was refused by it.
 */
const IDENTITY_FIELDS: readonly (keyof AutonomyActionRow)[] = [
  "kind",
  "subject",
  "doneIso",
  "bySession",
  "why",
  "said",
  "witness",
  "run",
  "steer",
];

/**
 * Whether two acts disagree about one identity field. `doneIso` is compared by the INSTANT it denotes.
 *
 * Every other field is a string a caller chose, so its spelling IS its value. An instant is not: the same
 * moment has many correct spellings, and a UTC instant and the same instant written with a `+10:00` offset are
 * the same one. Comparing their text would make an idempotent retry — the whole reason `./row.ts` lets a
 * session pick its own `actionId` and reuse it — read as a register lying about what happened, and take the
 * section off the owner's page.
 *
 * PRESENCE is compared before value, and under `exactOptionalPropertyTypes` that is the difference between
 * two real states rather than a nicety: `run` and `steer` are attached only when they carry something, so an
 * act with no steer and an act whose steer is `undefined` are different recordings. Reading values alone
 * also let an inherited property stand in for an absent one — the same hole the parser already closes on the
 * way in (`./row.ts`).
 */
function fieldsDisagree({
  field,
  first,
  second,
}: {
  field: keyof AutonomyActionRow;
  first: AutonomyActionRow;
  second: AutonomyActionRow;
}): boolean {
  if (Object.hasOwn(first, field) !== Object.hasOwn(second, field)) {
    return true;
  }
  if (field !== "doneIso") {
    return first[field] !== second[field];
  }
  const seconds = wholeSecondsOf({ iso: first.doneIso }) !== wholeSecondsOf({ iso: second.doneIso });
  return seconds || compareFractions({ first: first.doneIso, second: second.doneIso }) !== 0;
}

/**
 * The first field two acts under one id disagree about, or undefined when they are the same recording.
 *
 * @param first the act already in the register
 * @param second the act claiming the same id
 * @returns the disagreeing field's name, or undefined when every field matches
 */
export function conflictingField({
  first,
  second,
}: {
  first: AutonomyActionRow;
  second: AutonomyActionRow;
}): string | undefined {
  return IDENTITY_FIELDS.find((field) => fieldsDisagree({ field, first, second }));
}

/**
 * The fractional-second run of an instant — the digits after the dot that follows `HH:MM:SS`, and only
 * those. One unambiguous run of digits behind a fixed-width lookbehind, so the scan stays linear.
 *
 * What makes this scan TOTAL is `./row.ts`'s `ISO_INSTANT`, not the pattern here: `doneIso` is whatever the
 * acting session recorded, and while the register accepted any spelling `Date` parses, no scan could be made
 * total — a dotted date spelling had its first dot eaten by a looser pattern as a fraction, sorting September
 * after October, and a single-digit hour stopped the fraction matching at all. The shape is fixed at the door instead. The lookbehind
 * stays as the belt to that braces: it cannot match anything but a true fractional second.
 */
const SUB_SECOND_DIGITS = /(?<=\d{2}:\d{2}:\d{2})\.(\d+)/u;

/**
 * An instant's fractional-second digits — genuinely none when it names its second exactly.
 *
 * Written as a branch rather than a coalesce because "this instant carries no fraction" is a real answer
 * here and not a missing value standing in for one: an instant with no fraction is a perfectly good instant, and
 * it compares equal to the same second with `.000` and earlier than the same second with `.001`, which is what
 * padding gives it.
 */
function fractionOf({ iso }: { iso: string }): string {
  const matched = SUB_SECOND_DIGITS.exec(iso);
  if (matched === null) {
    return "";
  }
  return matched[1]!;
}

/**
 * An instant rounded DOWN to its whole second, in epoch milliseconds.
 *
 * The fraction is removed before parsing rather than after, so `Date`'s own millisecond behaviour never
 * enters the comparison at all: it neither truncates nor rounds a precision it cannot hold, because it is
 * never shown one. What remains — the date, the time to the second, and the zone — is exactly what `Date`
 * represents exactly, so two spellings of one instant in different zones still agree here.
 */
function wholeSecondsOf({ iso }: { iso: string }): number {
  return Date.parse(iso.replace(SUB_SECOND_DIGITS, ""));
}

/**
 * Which of two instants inside the SAME second is later, by their fractions alone. Negative when `first` is.
 *
 * This exists because the page's whole contract is newest-first and `Date` stops at the millisecond, so two
 * acts a few microseconds apart would collapse into one instant and fall through to the id tie-break —
 * which puts the OLDER act first whenever its id sorts earlier (fractions `.000001` and `.000999` of one
 * second). A writer supplying that precision is not hypothetical: `doneIso` is
 * whatever the acting session recorded, and the register accepts any instant a clock can parse (`./row.ts`).
 *
 * The digits are compared as TEXT rather than as a number, and that is the whole trick: no `Date` and no
 * integer holds arbitrary precision, so any fixed width — three digits, or nine — is just another place two
 * instants tie falsely, which the same review found again the moment one was picked. Zero-padding the
 * shorter run to the longer makes `.001` correctly later than `.0009999999`, and makes the comparison total
 * for any precision a writer ever supplies.
 */
function compareFractions({ first, second }: { first: string; second: string }): number {
  const left = fractionOf({ iso: first });
  const right = fractionOf({ iso: second });
  const width = Math.max(left.length, right.length);
  const padded = left.padEnd(width, "0");
  const against = right.padEnd(width, "0");
  if (padded === against) {
    return 0;
  }
  return padded > against ? 1 : -1;
}

/**
 * Every act the register holds, newest first, each carrying the owner's latest word on it.
 *
 * A steer naming an act the register does not carry is DROPPED rather than surfaced as a defect, and that is
 * deliberate: `slopweaver autonomy steer` already refuses an unknown id before appending, so an orphan here
 * means a hand-edited file, and taking the whole section off the owner's page over one line nobody can see would
 * cost more than it protects. The verb refuses; the reader survives. A CONFLICT is the opposite call — it
 * means the register is lying about what happened, so the read fails and says which id and which field.
 *
 * A CLASS steer is folded after the whole file is read, never as it is met: it is the owner's standing word, so it
 * settles an act recorded after it exactly as it settles one recorded before ({@link classCoverage}).
 *
 * @param records every record the register holds, in the order they were written
 * @returns one entry per act, newest first, with the owner's latest steer folded on — or the first conflict
 */
export function foldAutonomy({
  records,
}: {
  records: readonly AutonomyRecord[];
}): Result<readonly AutonomyAction[], AutonomyError> {
  const byId = new Map<string, AutonomyActionRow>();
  const steers = new Map<string, AutonomySteerRow>();
  const classes: AutonomyClassSteerRow[] = [];
  for (const record of records) {
    if (isClassSteerRecord(record)) {
      classes.push(record);
      continue;
    }
    if (isSteerRecord(record)) {
      // Last write wins, by APPEND ORDER rather than by the timestamp a writer supplied: the owner may read a row
      // twice and say something different the second time, and the second word governs. The earlier one
      // stays in the file, which is the point of appending rather than editing.
      steers.set(record.actionId, record);
      continue;
    }
    const existing = byId.get(record.actionId);
    if (existing === undefined) {
      byId.set(record.actionId, record);
      continue;
    }
    const field = conflictingField({ first: existing, second: record });
    if (field !== undefined) {
      return err(AutonomyErrors.actionIdConflict({ actionId: record.actionId, field }));
    }
  }
  const ordered = [...byId.values()].toSorted(
    (a, b) =>
      wholeSecondsOf({ iso: b.doneIso }) - wholeSecondsOf({ iso: a.doneIso }) ||
      compareFractions({ first: b.doneIso, second: a.doneIso }) ||
      a.actionId.localeCompare(b.actionId),
  );
  const coverage = classCoverage({ classes });
  const entries = ordered.map((action) => {
    const naming = coverage.get(action.kind);
    return {
      action,
      classSteer: naming === undefined ? undefined : governingClass({ action, classes: naming }),
      latestSteer: steers.get(action.actionId),
      patternSteer: undefined,
    };
  });
  const carried = patternWords({ entries });
  return ok(entries.map((entry) => ({ ...entry, patternSteer: carried.get(entry.action.actionId) })));
}

/**
 * The owner's word on each pattern's newest act, keyed by every EARLIER act of that pattern it settles — the projection
 * `foldAutonomy` lays on as `patternSteer`, computed here so no ledger row is ever written for it.
 *
 * @param entries every folded act, newest first, before any pattern word is laid on
 * @returns the word each earlier act of a worded pattern carries, by its action id
 */
function patternWords({ entries }: { entries: readonly AutonomyAction[] }): ReadonlyMap<string, AutonomyPatternSteer> {
  const carried = new Map<string, AutonomyPatternSteer>();
  for (const [governor, ...earlier] of groupPatterns({
    items: entries,
    keysOf: (entry) => autonomyPatternKeys({ action: entry.action, rule: ruleOf({ entry }) }),
  })) {
    const word = directSteerOf({ action: governor! });
    if (word === undefined) {
      continue;
    }
    for (const member of earlier) {
      carried.set(member.action.actionId, { actionId: governor!.action.actionId, steer: word });
    }
  }
  return carried;
}

/**
 * The keys that join one act to the others of its PATTERN: its kind on its subject, and — when it carries one —
 * its kind written up in its exact plain-words `said`. Two acts sharing either key are one pattern.
 *
 * Kind on subject is the fold the queue draws: two presses on one pull request are one question. Kind in one
 * `said` is the fold for repeated work: seven rebases of seven security bumps, each written up "I rebased your
 * security PR onto staging so the reviewer sees it green", are one thing done seven times
 * ({@link AutonomyPatternSteer}). The `said` is matched exactly, never trimmed or fuzzed: it is the sentence
 * the owner reads, so two acts whose sentences differ at all are two things the owner may judge differently,
 * and an act recorded before `said` existed joins only on its subject.
 *
 * A pattern never spans two standing rules. One sentence can be written up across places a scoped class tells
 * apart — a rule covering one repository and not another — and a pattern joining them would fold an act the rule
 * already settled under a card still asking about an act it does not cover, counted under no rule at all. So the `said` key carries the class governing the act, `null` when none does. The
 * subject key needs none: a class admits by kind and subject, so two acts sharing both share their class.
 *
 * @param action the act, as much of it as its pattern reads
 * @param rule the id of the class governing the act, `undefined` when none does ({@link ruleOf})
 * @returns one or two keys, distinct by construction
 */
export function autonomyPatternKeys({
  action,
  rule,
}: {
  action: Pick<AutonomyActionRow, "kind" | "said" | "subject">;
  rule: string | undefined;
}): readonly string[] {
  const keys = [JSON.stringify(["subject", action.kind, action.subject])];
  if (action.said !== undefined) {
    keys.push(JSON.stringify(["said", action.kind, rule, action.said]));
  }
  return keys;
}

/**
 * The class governing one act, by the id the owner recorded it under — whether or not a word on the act outranks it, so
 * an act keeps the pattern its rule puts it in when the owner grades it.
 *
 * @param entry the folded act, carrying the class that admits it
 * @returns the class's id, or `undefined` when no class admits the act
 */
export function ruleOf({ entry }: { entry: Pick<AutonomyAction, "classSteer"> }): string | undefined {
  if (entry.classSteer === undefined) {
    return undefined;
  }
  return classIdOf({ row: entry.classSteer });
}

/**
 * Partition items into the connected groups their keys join, each group in the items' own order and the groups
 * ordered by their first member.
 *
 * Connected, not pairwise: an act sharing a subject with one act and a `said` with another joins all three, so
 * membership never depends on which of them the ledger happens to list first. Only WHICH member leads a group
 * depends on order — the first, which for a newest-first list is its newest.
 *
 * @param items the things to group, in the order that picks each group's lead
 * @param keysOf the keys one item joins on
 * @returns every item exactly once, grouped
 */
export function groupPatterns<T>({
  items,
  keysOf,
}: {
  items: readonly T[];
  keysOf: (item: T) => readonly string[];
}): readonly (readonly T[])[] {
  const parent = items.map((_, index) => index);
  const rootOf = ({ index }: { index: number }): number => {
    let at = index;
    while (parent[at] !== at) {
      at = parent[at]!;
    }
    return at;
  };
  const firstWithKey = new Map<string, number>();
  items.forEach((item, index) => {
    for (const key of keysOf(item)) {
      const seen = firstWithKey.get(key);
      if (seen === undefined) {
        firstWithKey.set(key, index);
        continue;
      }
      const left = rootOf({ index: seen });
      const right = rootOf({ index });
      // The smaller index always becomes the root, so a group's root is its first member.
      parent[Math.max(left, right)] = Math.min(left, right);
    }
  });
  const groups = new Map<number, T[]>();
  items.forEach((item, index) => {
    const root = rootOf({ index });
    const group = groups.get(root);
    if (group === undefined) {
      groups.set(root, [item]);
      return;
    }
    group.push(item);
  });
  return [...groups.values()];
}

/**
 * Every class steer naming each kind, in GOVERNING order: the LATEST row per class is that class's whole current
 * list, and where two classes name one kind, the class whose latest row was appended later comes later and
 * governs every act both admit.
 *
 * A list rather than one row per kind because a class may be scoped to one place (`subjectPrefix`): a later
 * class scoped to the owner's DM must not hide an earlier unscoped one from an act posted somewhere else.
 *
 * Latest per class is what gives re-recording a class a coherent meaning — dropping a kind from the new row
 * takes that kind back out, rather than the old row still covering it. Append order, not `steeredIso`, for
 * {@link foldAutonomy}'s reason: a clock a writer supplies is a clock a writer can get wrong.
 *
 * @param classes every class steer in the register, in append order
 * @returns each named kind, mapped to the classes naming it, earliest-governing first
 */
export function classCoverage({
  classes,
}: {
  classes: readonly AutonomyClassSteerRow[];
}): ReadonlyMap<string, readonly AutonomyClassSteerRow[]> {
  const latest = new Map<string, AutonomyClassSteerRow>();
  for (const row of classes) {
    // Keyed by the class's NAME, not its wire id, so re-recording it with or without a scope replaces it.
    const classId = classIdOf({ row });
    // Delete first so a re-recorded class moves to the END of the insertion order — later append, later say.
    latest.delete(classId);
    latest.set(classId, row);
  }
  const byKind = new Map<string, AutonomyClassSteerRow[]>();
  for (const row of latest.values()) {
    for (const kind of row.kinds.split(",")) {
      const naming = byKind.get(kind);
      if (naming === undefined) {
        byKind.set(kind, [row]);
        continue;
      }
      naming.push(row);
    }
  }
  return byKind;
}

/**
 * Keep only the acts matching every facet supplied. An absent facet does not filter.
 *
 * @param actions the folded acts, already in the order the caller wants them
 * @param kind keep only acts of this kind
 * @param bySession keep only acts by sessions whose name contains this text
 * @param sinceIso keep only acts taken at or after this instant
 * @param unsteered keep only acts the owner has not given a word on yet
 * @returns the matching acts, in the order they arrived
 */
export function filterAutonomyActions({
  actions,
  kind,
  bySession,
  sinceIso,
  unsteered,
}: {
  actions: readonly AutonomyAction[];
  kind?: string | undefined;
  bySession?: string | undefined;
  sinceIso?: string | undefined;
  unsteered?: boolean | undefined;
}): readonly AutonomyAction[] {
  const since = sinceIso === undefined ? undefined : Date.parse(sinceIso);
  return actions.filter(
    (entry) =>
      (kind === undefined || entry.action.kind === kind) &&
      (bySession === undefined || entry.action.bySession.includes(bySession)) &&
      (since === undefined || Date.parse(entry.action.doneIso) >= since) &&
      (unsteered !== true || steerOf({ action: entry }) === undefined),
  );
}

/**
 * The owner's word on this one act — a later steer event, else the act's own inline steer — or undefined when
 * they have given none on it in particular.
 *
 * Both reads go through `Object.hasOwn` rather than plain property access, because this is what answers "has the
 * owner said anything about this act". A polluted `Object.prototype.steer` would otherwise fabricate a word for
 * every act ever recorded, and `filterAutonomyActions`'s `unsteered` would then report that nothing is waiting
 * on the owner.
 */
function directSteerOf({ action }: { action: Pick<AutonomyAction, "action" | "latestSteer"> }): string | undefined {
  const latest = action.latestSteer;
  if (latest !== undefined && Object.hasOwn(latest, "steer")) {
    return latest.steer;
  }
  if (Object.hasOwn(action.action, "steer")) {
    return action.action.steer;
  }
  return undefined;
}

/**
 * The word that governs one act: the owner's word on the act itself (a later steer event, else its inline
 * steer), their word on the newest act of its pattern next, and their standing word on the act's whole kind only
 * when none of those exists.
 *
 * The precedence is the whole reason each spelling exists. An act may be recorded carrying a word the owner had
 * already given; a steer event recorded afterwards is the owner having read the row and said something newer,
 * and newer wins. The owner's word on the pattern is a word on this act as one of a group they judged together,
 * so it outranks a word on every act of the kind. A class steer ranks LAST whatever its date, because a word on
 * this one act (a complaint about one press's broken link formatting) is more specific than a word on every
 * press.
 *
 * @param action one folded act
 * @returns the governing steer text, or undefined when the owner has said nothing about it
 */
export function steerOf({ action }: { action: AutonomyAction }): string | undefined {
  const direct = directSteerOf({ action });
  if (direct !== undefined) {
    return direct;
  }
  const pattern = settlingPattern({ action });
  if (pattern !== undefined) {
    return pattern.steer;
  }
  return settlingClass({ action })?.steer;
}

/**
 * The owner's word on this act's pattern when that is what governs it, or undefined when a word on the act
 * itself does or no pattern word exists.
 *
 * @param action one folded act
 * @returns the pattern word, naming the act the owner gave it on
 */
export function settlingPattern({ action }: { action: AutonomyAction }): AutonomyPatternSteer | undefined {
  if (directSteerOf({ action }) !== undefined) {
    return undefined;
  }
  const pattern = action.patternSteer;
  if (pattern === undefined || !Object.hasOwn(pattern, "steer")) {
    return undefined;
  }
  return pattern;
}

/**
 * The class steer that settles one act, or undefined when a word on the act itself or on its pattern governs,
 * or nothing does.
 *
 * What a reader asks to say WHERE the governing word came from — a class steer settles an act only when the
 * owner has said nothing about that act in particular (`steerOf`'s precedence).
 *
 * @param action one folded act
 * @returns the governing class steer, or undefined
 */
export function settlingClass({ action }: { action: AutonomyAction }): AutonomyClassSteerRow | undefined {
  if (directSteerOf({ action }) !== undefined || settlingPattern({ action }) !== undefined) {
    return undefined;
  }
  const standing = action.classSteer;
  if (standing === undefined || !Object.hasOwn(standing, "steer")) {
    return undefined;
  }
  // Membership AND scope are re-checked rather than trusted from the fold: an entry built anywhere but
  // `foldAutonomy` could carry a class that never named this kind, or one scoped to another place, and would
  // then settle an act the owner still has to judge.
  return classAdmits({ kind: action.action.kind, row: standing, subject: action.action.subject })
    ? standing
    : undefined;
}

/**
 * Find one act by its id.
 *
 * @param actions the folded acts
 * @param actionId the id to look for
 * @returns the act, or undefined when the register carries none under that id
 */
export function findAutonomyAction({
  actions,
  actionId,
}: {
  actions: readonly AutonomyAction[];
  actionId: string;
}): AutonomyAction | undefined {
  return actions.find((entry) => entry.action.actionId === actionId);
}
