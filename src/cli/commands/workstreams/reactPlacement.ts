/**
 * What `slopweaver workstreams react`'s flags carry beyond the word itself — the reason an abandoned or other word
 * gives, and the placing flags (`--same-as`, `--milestone-of`, `--outcome-of`, `--superseded-by`, `--owner`,
 * `--covered-by`, `--steer`) — each checked against the picks before anything is read under the lock.
 *
 * Parsing only. `./react.ts` runs the verb around it and records the result.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type Reaction, WORDS_WITH_A_REASON } from "../../../workstreams/candidates.js";
import type { Placement } from "../../../workstreams/placement.js";
import type { ReactionPick } from "../../../workstreams/reactionBatch.js";
import { EXIT_USAGE } from "../../exitCodes.js";

import { stringFlag } from "./core.js";

/** Why the verb stopped before recording anything: the exit code, and the line that says so. */
export interface Stop {
  readonly exit: number;
  readonly line: string;
}

/**
 * The reason an abandoned word needs, checked against the picks before anything is read under the lock: exactly one
 * abandoned candidate per call, with `--reason` and `--anchor`, and no `--reason` without one.
 *
 * @returns the reason to record (`null` when no pick is abandoned), or the usage refusal
 */
export function reasonFor({
  picks,
  reasonFlag,
  anchorFlag,
}: {
  picks: readonly ReactionPick[];
  reasonFlag: string | undefined;
  anchorFlag: string | undefined;
}): Result<string | null, Stop> {
  const abandoned = picks.filter((pick) => pick.reaction === "abandoned");
  if (abandoned.length === 0) {
    if (reasonFlag === undefined) {
      return ok(null);
    }
    const one = picks.length === 1 ? picks[0] : undefined;
    if (one === undefined || !WORDS_WITH_A_REASON.has(one.reaction)) {
      return err({
        exit: EXIT_USAGE,
        line: "--reason goes with one abandoned, done, milestone-of, outcome-of, superseded or no word, so the reason is its own",
      });
    }
    return ok(null);
  }
  if (abandoned.length > 1) {
    const which = abandoned.map((pick) => pick.candidate).join(", ");
    return err({ exit: EXIT_USAGE, line: `one abandoned candidate per call, so its reason is its own — got ${which}` });
  }
  if (reasonFlag === undefined || reasonFlag.trim().length === 0) {
    return err({ exit: EXIT_USAGE, line: "an abandoned word needs --reason: why it ended, in the owner's words" });
  }
  if (anchorFlag === undefined || anchorFlag.trim().length === 0) {
    return err({ exit: EXIT_USAGE, line: "an abandoned word needs --anchor: where the owner said it" });
  }
  return ok(reasonFlag);
}

/** Each placing flag, and the one word it goes with. */
const PLACING_FLAGS = [
  { flag: "same-as", word: "same-as" },
  { flag: "milestone-of", word: "milestone-of" },
  { flag: "outcome-of", word: "outcome-of" },
  { flag: "superseded-by", word: "superseded" },
  { flag: "owner", word: "no" },
  { flag: "covered-by", word: "no" },
  { flag: "steer", word: "yes" },
] as const satisfies readonly { flag: string; word: Reaction }[];

/** The words that cannot stand without naming something, and the flag that names it. */
const NAMING_WORDS = [
  { flag: "same-as", what: "<register id>: the workstream it names", word: "same-as" },
  { flag: "milestone-of", what: "<register id>: the workstream it names", word: "milestone-of" },
  { flag: "outcome-of", what: "<register id>: the workstream it names", word: "outcome-of" },
  { flag: "superseded-by", what: `"<the owner's words>": what replaced it`, word: "superseded" },
] as const satisfies readonly { flag: string; what: string; word: Reaction }[];

/**
 * What the call's word carries beyond itself, checked against the picks before anything is read under the lock: each
 * placing flag goes with exactly one pick of its own word, and a same-as, milestone-of, outcome-of or superseded word
 * names what it points at. The reason a word gives rides here too; an abandoned one's is its ending's.
 *
 * @param values the parsed flags
 * @returns the placement, or the usage refusal
 */
export function placementFor({
  picks,
  values,
}: {
  picks: readonly ReactionPick[];
  values: Readonly<Record<string, unknown>>;
}): Result<Placement, Stop> {
  const placing = placingFlags({ picks, values });
  if (placing.isErr()) {
    return err(placing.error);
  }
  const given = placing.value;
  for (const { flag, what, word } of NAMING_WORDS) {
    if (picks.some((pick) => pick.reaction === word) && !given.has(flag)) {
      return err({ exit: EXIT_USAGE, line: `a ${word} word needs --${flag} ${what}` });
    }
  }
  const one = picks.length === 1 ? picks[0] : undefined;
  const reason = stringFlag({ name: "reason", values });
  const ownReason = one !== undefined && one.reaction !== "abandoned" && reason !== undefined ? reason : null;
  return ok({
    coveredBy: givenOrNull({ flag: "covered-by", given }),
    milestoneOf: givenOrNull({ flag: "milestone-of", given }),
    outcomeOf: givenOrNull({ flag: "outcome-of", given }),
    owner: givenOrNull({ flag: "owner", given }),
    reason: ownReason,
    sameAs: givenOrNull({ flag: "same-as", given }),
    steer: givenOrNull({ flag: "steer", given }),
    supersededBy: givenOrNull({ flag: "superseded-by", given }),
  });
}

/**
 * The placing flags given, each checked to go with exactly one pick of its own word.
 *
 * @param values the parsed flags
 * @returns each given placing flag's value by flag, or the usage refusal
 */
function placingFlags({
  picks,
  values,
}: {
  picks: readonly ReactionPick[];
  values: Readonly<Record<string, unknown>>;
}): Result<ReadonlyMap<string, string>, Stop> {
  const given = new Map<string, string>();
  const only = picks.length === 1 ? picks[0] : undefined;
  for (const { flag, word } of PLACING_FLAGS) {
    const value = stringFlag({ name: flag, values });
    if (value === undefined) {
      continue;
    }
    if (only === undefined || only.reaction !== word) {
      return err({ exit: EXIT_USAGE, line: `--${flag} goes with one ${word} word, so what it names is its own` });
    }
    given.set(flag, value);
  }
  return ok(given);
}

/**
 * A placing flag's value, or `null` when it was not given — absent by design, since each goes with one word only.
 *
 * @returns the value, or `null`
 */
function givenOrNull({ flag, given }: { flag: string; given: ReadonlyMap<string, string> }): string | null {
  const value = given.get(flag);
  if (value === undefined) {
    return null;
  }
  return value;
}
