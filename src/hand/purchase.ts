/**
 * The posting rule that refuses a step asking the owner to spend money on capacity: buy, raise or top up a plan, a
 * subscription, usage or credits.
 *
 * ## Why this exists
 *
 * The owner's ruling is that capacity is not bought: enough plans are owned, a capped account waits for its reset,
 * and the work moves to the other model meanwhile. A seat that posts "Buy or raise a Codex plan" or "Buy one more
 * Codex plan" asks for money the owner has already declined to spend. A memory held the ruling; the verb did not.
 * The pinned chair posts money notes too, so this is a CONTENT rule for every writer, in
 * `./posting.ts`, not one more half of the seat refusal (`./seatPost.ts`).
 *
 * ## The criterion
 *
 * A verb that only means spending — buy, purchase, top up, pay for, base or -ing form — followed within six words of
 * one clause by plan, subscription, usage or credit; `raise`, `renew`, `upgrade` or `subscribe to` followed by plan or
 * subscription with only a determiner or product name between ("raise a PR for the plan" is not one), or taking
 * anything `to` a paid tier (Max, Pro, Plus, Team); and `add` only with credit, because "add the team 1Password
 * account" is a sign-in.
 * Read over `what`, `literal`, `where` and every checklist line — the ask the owner acts on.
 *
 * - **A negated purchase is refused too.** A cap note carries only the capped accounts and when each resets, so "the
 *   owner is not buying another plan" is surplus on the note however it is phrased. Three Claude fallback reviews
 *   each broke a negation window in BOTH directions — "Codex can't review so buy another plan" hid an ask,
 *   "nobody asks the owner to buy another plan" refused a statement — and no window survives both.
 * - **Not `unblocks`**: the monitor lane writes a paused plan's free-text reason there (`../monitor/evaluate.ts`),
 *   often the owner's own words ("not buying another plan"), and no writer can reword it, so reading it would refuse the
 *   sign-in card it rides on (r1). `what` and `where` are the monitor's fixed strings plus a subject id.
 * - **A plan's own name is not the noun**: `plan-two`, `plan two` and "the plan's sign-in" name a plan, so the noun
 *   may not run into a hyphen, an apostrophe or a number (r2), nor into a sign-in word or a program — "renew the Max
 *   plan login" and "upgrade the Claude Max plan app" are not purchases (r3).
 * - **Verb before noun only**: "what each plan buys" is this repository's idiom for a budget, not a purchase.
 * - **No past tense**: "you bought plan five; sign it in" reports a purchase and asks the owner for a sign-in.
 * - **No `seat`**: here a seat is a session, and "raise a seat for the resync" spawns one.
 *
 * A POSTING rule with no hatch, like every rule beside it: a ruling on money is the owner's,
 * and only the owner's word changes the list.
 *
 * MEASURED over the 148 steps posted at the time: 8 are refused, every one a genuine purchase ask —
 * `codex-all-accounts-capped-25-sep`, `codex-cap-28-sep`, `codex-cap-all-five-28-sep`,
 * `codex-all-five-capped-28-sep`, `codex-5-card-limit-28-sep`, `codex-capped-28-sep`,
 * `codex-buy-a-sixth-plan-28-sep` and `talk-openai-credits` — and none of the rest. Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then `purchaseAsk`.
 *
 * The residue, stated: "get a Codex plan" (the verb is `get`, which is also how a sign-in reads); "ask Seth or Theo why
 * the card declines" and "raise card 4243's limit", money asks that name no plan; and any paraphrase ("another
 * subscription would help").
 */
import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/** The verbs that only ever mean spending: buy, purchase, top up, pay for — base and -ing forms. */
const SPEND_VERB = "(?:buy(?:ing)?|purchas(?:e|ing)|top(?:ping)?[\\s-]up|pay(?:ing)?\\s+for)";

/** The verbs that mean spending only with a plan or subscription as their object: raise, renew, upgrade, subscribe to. */
const OBJECT_VERB = "(?:rais(?:e|ing)|renew(?:ing)?|upgrad(?:e|ing)|subscrib(?:e|ing)\\s+to)";

/**
 * Up to six words between a spend verb and its noun, none ending a clause: a word carrying `.`, `:`, `,`, `;`, `!`,
 * `?` or a dash of its own stops the gap, so "Top-up went through: sign the plan in" is two clauses. Six, because
 * "Buy a sixth ChatGPT Pro Codex plan" puts five words between. A comma or
 * point between digits is a number, not a clause end: "Buy 1,000 Codex credits".
 */
const WIDE_GAP = "(?:\\s+(?![-\\u2013\\u2014]+\\s)(?:[^\\s,;:!?.\\u2013\\u2014]|(?<=\\d)[,.](?=\\d))+){0,6}?\\s+";

/**
 * Between an object verb and its noun only a determiner, a product name or a plan's own name, possessive included,
 * so "raise a PR for the plan" and "renew the Claude sign-in" are not purchases and "renew plan-two's subscription"
 * is.
 */
const NARROW_GAP =
  "(?:\\s+(?:a|an|the|another|one|more|new|extra|our|your|my|their|this|that|codex|chatgpt|claude|openai|max|pro|plus|team|business|[a-z]+-(?:\\d+|one|two|three|four|five|six)(?:['\\u2019]s)?))*\\s+";

/**
 * A product's paid tier named alone, the plan it buys: "Buy ChatGPT Pro on codex-6", "Buy another Claude Max".
 */
const PRODUCT_TIER = "(?:chatgpt|claude|codex|openai)\\s+(?:pro|plus|max|team|business|enterprise)\\b";

/** A word after a plan or tier that makes it a sign-in or a program rather than a purchase. */
const SIGN_IN_OR_PROGRAM =
  "(?:log-?ins?|sign-?ins?|sign\\s+in|o?auth|tokens?|sessions?|credentials?|apps?|cli|binary)\\b";

/** A setting a tier word also names: `--effort max`, "the Pro model", "the Claude Max cap alert". */
const SETTING =
  "(?:effort|threshold|limits?|caps?|priority|level|timeout|retries|verbosity|alerts?|models?|context|window)\\b";

/** Not followed — possessive and `plan` allowed between — by a sign-in, a program or a setting. */
const NOT_A_THING_OF_IT = `(?!(?:['\\u2019]s)?(?:\\s+plans?)?\\s+(?:${SIGN_IN_OR_PROGRAM}|${SETTING}))`;

/**
 * A paid tier: raising or upgrading anything TO one buys it, whatever names the plan — "Upgrade codex-5 to Pro",
 * "Upgrade plan-two to Max or wait for the reset", "Upgrade to a Pro plan". `team` counts only before plan or tier, or bare at a clause end, because "raise this to team leads"
 * and "raise it to the team" are not purchases; a setting after the tier is never one.
 */
const TIER = `(?:a|an|the|chatgpt|claude|codex|openai)?\\s*(?:pro|plus|max|(?:team|business|enterprise)(?=\\s+(?:plans?|tiers?|subscriptions?)\\b)|(?<!the\\s)(?:team|business|enterprise)(?=\\s*(?:[.,;:!?(\\u2013\\u2014]|$))|higher\\s+tier)\\b${NOT_A_THING_OF_IT}`;

/**
 * Up to three words of one clause between a tier verb and its `to`, none of them a setting: `--effort max` and
 * "raise the threshold to max" are not purchases.
 */
const TIER_GAP = `(?:\\s+(?!${SETTING})[^\\s,;:!?.\\u2013\\u2014]+){0,3}?`;

/**
 * A noun that is not itself a plan's NAME, a sign-in or a program: not `plan-two`, `plan two`, "the plan's sign-in",
 * "the subscription login" or "the Max plan app".
 */
const NOT_A_NAME = `\\b(?![-'\\u2019])(?!\\s+(?:one|two|three|four|five|six|\\d+)\\b)(?!\\s+${SIGN_IN_OR_PROGRAM})`;

/** The phrases that ask for a purchase, most specific first. */
const PURCHASE_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${SPEND_VERB}${WIDE_GAP}(?:plans?|subscriptions?|usage|credits?)${NOT_A_NAME}`, "iu"),
  new RegExp(`\\b${OBJECT_VERB}${NARROW_GAP}(?:plans?|subscriptions?)${NOT_A_NAME}`, "iu"),
  new RegExp(`\\b(?:upgrad|rais)(?:e|ing)${TIER_GAP}\\s+to\\s+${TIER}`, "iu"),
  new RegExp(`\\b${SPEND_VERB}${WIDE_GAP}${PRODUCT_TIER}${NOT_A_THING_OF_IT}`, "iu"),
  // An object verb takes a product tier only as its direct object: "renew the sign-in on the ChatGPT Pro account" is
  // a sign-in.
  new RegExp(`\\b${OBJECT_VERB}${NARROW_GAP}${PRODUCT_TIER}${NOT_A_THING_OF_IT}`, "iu"),
  // `add` names a purchase only with credit: "add the team account" is a sign-in.
  new RegExp(`\\badd(?:ing)?${WIDE_GAP}credits?${NOT_A_NAME}`, "iu"),
];

/**
 * The first phrase in the texts that asks for a purchase, as the text spells it, or `undefined` when none does.
 *
 * @param texts the step's fields to read; an absent one is skipped
 * @returns the phrase, so a refusal can quote it
 */
export function purchasePhrase({ texts }: { texts: readonly (string | undefined)[] }): string | undefined {
  for (const text of texts) {
    if (text === undefined) {
      continue;
    }
    for (const pattern of PURCHASE_PATTERNS) {
      const found = pattern.exec(text);
      if (found !== null) {
        return found[0];
      }
    }
  }
  return undefined;
}

/**
 * The refusal for a step asking the owner to buy capacity — a POSTING rule, first in `./posting.ts`'s order so a
 * purchase ask is told the real reason before any fixable one.
 *
 * @param step the step a writer is about to record
 * @returns the refusal, or `undefined` when no field asks for a purchase
 */
export function purchaseAsk({ step }: { step: HandStep }): HandStepError | undefined {
  // A checklist's lines are the same ask spelt out a line at a time, so each sentence and command is read too.
  const lines = step.checklist === undefined ? [] : step.checklist.flatMap((item) => [item.action, item.command]);
  const phrase = purchasePhrase({ texts: [step.what, step.literal, step.where, ...lines] });
  if (phrase === undefined) {
    return undefined;
  }
  return HandStepErrors.purchaseAsk({ phrase });
}
