/**
 * `github lap --number`'s batch spelling: one pull request, or an ordered comma-separated list landed in that
 * order, and the acknowledgements a landing's merges are handed. A leaf, so `./lapCore.ts`'s parser reads it
 * without a cycle.
 */

import { err, ok, type Result } from "../../../lib/result.js";

/**
 * The most pull requests one batch carries. A red lap of a batch lands none of it, so the bound keeps one red
 * member from holding back more than eleven others; the next invocation is a shorter ordered list.
 */
export const LAP_BATCH_MAX = 12;

/**
 * Parse `--number`'s value: one pull request, or an ordered comma-separated batch landed in that order.
 *
 * @param value the flag's text
 * @returns the numbers in order, or every problem with them
 */
export function parseLapNumbers({ value }: { value: string }): Result<readonly number[]> {
  const numbers = value.split(",").map((part) => (/^[0-9]+$/u.test(part.trim()) ? Number(part.trim()) : Number.NaN));
  const errors: string[] = [];
  if (numbers.some((number) => !Number.isSafeInteger(number) || number <= 0)) {
    errors.push("--number must be a positive whole number, or an ordered comma-separated list of them");
  }
  if (new Set(numbers).size !== numbers.length) {
    errors.push("--number names a pull request twice; a batch lands each member once");
  }
  if (numbers.length > LAP_BATCH_MAX) {
    errors.push(
      `--number names ${String(numbers.length)} pull requests; a batch carries at most ${String(LAP_BATCH_MAX)}`,
    );
  }
  return errors.length > 0 ? err(errors) : ok(numbers);
}

/**
 * The members `--number` names and every problem with them, `--land-only` included: it lands one pull request on
 * the lap that pull request already earned, and a batch's green was earned in combination.
 *
 * @param value the flag's parsed value, absent or a boolean when it was not given text
 * @param landOnly whether `--land-only` was passed
 * @returns the members in landing order (empty when they did not parse) and every problem
 */
export function lapMembersFrom({ value, landOnly }: { value: string | boolean | undefined; landOnly: boolean }): {
  readonly members: readonly number[];
  readonly errors: readonly string[];
} {
  if (typeof value !== "string") {
    return {
      errors: ["--number must be a positive whole number, or an ordered comma-separated list of them"],
      members: [],
    };
  }
  const parsed = parseLapNumbers({ value });
  if (parsed.isErr()) {
    return { errors: parsed.error, members: [] };
  }
  if (landOnly && parsed.value.length > 1) {
    return {
      errors: ["--land-only lands one pull request on the lap it already earned; a batch lands only on its own lap"],
      members: parsed.value,
    };
  }
  return { errors: [], members: parsed.value };
}

/**
 * `--acknowledge` and `--reason`, read together: `--land`'s one merge takes both or neither, and a batch takes
 * neither, because it would hand one pull request's finding to every member.
 *
 * @param subjects `--acknowledge`'s parsed value, a string only when it was given text
 * @param reason `--reason`'s parsed value, a string only when it was given text
 * @param land whether the lap lands, the only time a merge reads an acknowledgement
 * @param members the batch in landing order, one member for a single lap
 * @returns the acknowledgement `--land`'s merge is handed, absent when none was given, and every problem
 */
export function lapAcknowledgementFrom({
  subjects,
  reason,
  land,
  members,
}: {
  subjects: string | boolean | undefined;
  reason: string | boolean | undefined;
  land: boolean;
  members: readonly number[];
}): {
  readonly acknowledge: { readonly subjects: string; readonly reason: string } | undefined;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  const named = typeof subjects === "string" || typeof reason === "string";
  const acknowledge = typeof subjects === "string" && typeof reason === "string" ? { reason, subjects } : undefined;
  if (named && acknowledge === undefined) {
    errors.push("--acknowledge and --reason go together: `github merge` writes the reason to the door ledger");
  }
  if (acknowledge !== undefined && !land) {
    errors.push("--acknowledge is for --land's merge, and a lap without --land merges nothing");
  }
  if (named && members.length > 1) {
    errors.push(
      `--acknowledge accepts one pull request's finding, and a batch would hand it to every member: name a member's own codex-loop-incomplete with --${MEMBER_LOOP_FLAG} <n>=<reason>, or lap an acknowledged member alone`,
    );
  }
  return { acknowledge, errors };
}

/** The repeatable flag a batch member's capped Codex review is acknowledged by, without its `--`. */
export const MEMBER_LOOP_FLAG = "codex-loop-incomplete";

/** One member's own `codex-loop-incomplete` acknowledgement: which member, and the reason its merge records. */
export interface MemberLoopAcknowledgement {
  readonly number: number;
  readonly reason: string;
}

/**
 * Parse every `--codex-loop-incomplete <n>=<reason>`: a batch member whose Codex loop is incomplete, and why its
 * merge may land anyway. Each one covers ITS member only — the batch hands the subject to that member's merge and
 * no other — so it is a batch flag: a single lap names the same thing through `--acknowledge`. It acknowledges that
 * one subject and nothing else; a member owing any other acknowledgement still laps alone.
 *
 * @param values every value the flag was given, in argv order
 * @param members the batch, in landing order
 * @param land whether the lap lands, the only time a merge reads an acknowledgement
 * @returns each member's acknowledgement in the order given, and every problem with them
 */
export function memberLoopAcknowledgementsFrom({
  values,
  members,
  land,
}: {
  values: readonly string[];
  members: readonly number[];
  land: boolean;
}): { readonly acknowledgements: readonly MemberLoopAcknowledgement[]; readonly errors: readonly string[] } {
  if (values.length === 0) {
    return { acknowledgements: [], errors: [] };
  }
  const errors: string[] = [];
  if (members.length < 2) {
    errors.push(`--${MEMBER_LOOP_FLAG} is a batch member's; a single lap names it with --acknowledge and --reason`);
  }
  if (!land) {
    errors.push(`--${MEMBER_LOOP_FLAG} is for --land's merges, and a lap without --land merges nothing`);
  }
  const acknowledgements: MemberLoopAcknowledgement[] = [];
  for (const value of values) {
    const read = memberLoopAcknowledgementOf({ members, taken: acknowledgements, value });
    if (typeof read === "string") {
      errors.push(read);
    } else {
      acknowledgements.push(read);
    }
  }
  return { acknowledgements: errors.length > 0 ? [] : acknowledgements, errors };
}

/** One `<member>=<reason>` value read against the batch and the members already acknowledged, or its problem. */
function memberLoopAcknowledgementOf({
  value,
  members,
  taken,
}: {
  value: string;
  members: readonly number[];
  taken: readonly MemberLoopAcknowledgement[];
}): MemberLoopAcknowledgement | string {
  const match = /^([0-9]+)=(.*)$/su.exec(value);
  const reason = match === null ? "" : match[2]!.trim();
  if (match === null || reason === "") {
    return `--${MEMBER_LOOP_FLAG} ${value}: write it as <member>=<reason>, the reason not empty`;
  }
  const number = Number(match[1]);
  if (!members.includes(number)) {
    return `--${MEMBER_LOOP_FLAG} names #${String(number)}, which is not a member of this batch`;
  }
  if (taken.some((one) => one.number === number)) {
    return `--${MEMBER_LOOP_FLAG} names #${String(number)} twice; one member takes one reason`;
  }
  return { number, reason };
}
