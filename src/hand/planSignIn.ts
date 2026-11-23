/**
 * A sign-in into a Claude or Codex plan names the plan's EMAIL ADDRESS, never its alias alone.
 *
 * A plan number alone makes the owner guess which account it is, so a sign-in names the address. An alias is a store
 * directory's neutral label (`../plans/types.ts`); the address is what the owner signs in with. So a sign-in that names a registered plan carries that plan's cached email, and one that reads as a
 * Claude or Codex plan sign-in without naming any plan names one by its email.
 *
 * Pure: {@link planSignInGap} takes the text and the register's alias-to-email pairs. The one read is
 * {@link readPlanEmails}, at the edge.
 *
 * The residue, stated: an alias the register caches NO email for asks for nothing, since there is no address to
 * name; a plan sign-in that spells neither an alias nor `claude`/`codex` beside a plan or a login is not recognised;
 * and presence is the test — a text naming the right alias beside the wrong plan's address is not caught.
 */
import { type PlanRegisterPort, planRegisterPort } from "../plans/port.js";

import { isSignIn } from "./decision.js";

/** One registered plan as this rule reads it: its alias and the address its register row caches, if any. */
export interface PlanEmail {
  readonly alias: string;
  readonly email: string | undefined;
}

/** What a plan sign-in text is missing. */
export type PlanSignInGap =
  | { readonly kind: "alias-without-email"; readonly alias: string; readonly email: string }
  | { readonly kind: "plan-unnamed"; readonly emails: readonly string[] };

/** The spelled numbers an alias's last segment may carry, each with its digit. */
const NUMBER_WORDS: readonly (readonly [string, string])[] = [
  ["one", "1"],
  ["two", "2"],
  ["three", "3"],
  ["four", "4"],
  ["five", "5"],
  ["six", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["nine", "9"],
  ["ten", "10"],
];

/**
 * A Claude or Codex PLAN sign-in in words: the provider's own login command, or a sign-in verb whose OBJECT is a plan
 * — "sign in to the Claude plan", "log into one plan", "sign in all five plans". Only determiners may stand between
 * the verb and `plan`, so "sign in to Typeform — the Claude plan resync waits on it" is a sign-in, not a plan's.
 */
const PLAN_SIGN_IN =
  /\b(?:claude|codex)\s+\/?login\b|\b(?:sign|log)(?:ging|ing)?[-\s]?(?:in|on|into)\b(?:\s+(?:to|into|on))?(?:\s+(?:the|a|one|each|every|all|another|which|that|this|two|three|four|five))*(?:\s+(?:claude|codex))?(?:\s+max)?\s+plans?\b/i;

/**
 * Where one sentence ends: `.`, `;`, `!` or `?` before a space, or a line break. An address's own dots are followed
 * by a letter, so `gmail.com` never splits. An alias counts only inside a sentence that is itself a sign-in, so
 * "Sign in to Typeform; plan-three is at 86%" asks no plan sign-in while "Plan-three is signed out, so sign in again"
 * does.
 */
const SENTENCE_BREAK = /(?<=[.;!?])\s+|\n+/;

/**
 * The split form `isSignIn` does not read — "sign Codex plan codex-three back in", "log it back in" — with at most
 * four words between the verb and `back in`. Only `back in` closes it, so "log plan-three usage in the journal" is
 * not a sign-in.
 */
const SPLIT_SIGN_IN = /\b(?:sign|log)\s+(?:\S+\s+){1,4}?back\s+in\b/i;

/**
 * Escape one literal for a regular expression.
 *
 * @returns the text with every metacharacter escaped
 */
function escaped({ text }: { text: string }): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * The pattern that finds an alias the way the owner would say it: `plan-three`, `plan three`, `Plan 3`, `codex-3`.
 *
 * @returns a case-insensitive, word-bounded pattern
 */
function aliasPattern({ alias }: { alias: string }): RegExp {
  const segments = alias.split("-");
  const last = segments.at(-1)!;
  const number = NUMBER_WORDS.find(([word]) => word === last.toLowerCase());
  const head = segments.slice(0, -1).map((segment) => escaped({ text: segment }));
  const tail = number === undefined ? escaped({ text: last }) : `(?:${number[0]}|${number[1]})`;
  const body = [...head, tail].join(String.raw`[\s-]?`);
  return new RegExp(String.raw`(?<![\w@.-])${body}(?![\w@-])`, "i");
}

/**
 * What a text asking the owner to sign into a plan is missing — the named plan's email, or which plan it is at all.
 *
 * Every alias named in a sentence that is itself a sign-in (`./decision.ts`'s `isSignIn`, or the split "sign … back
 * in"), whose row caches an email, must have that email somewhere in the text; the first one missing is the gap. A
 * text naming no alias but reading as a Claude or Codex plan sign-in must carry at least one registered address.
 *
 * @param text the words the owner will read — a note's `what` and `where`, or a question's text
 * @param plans every registered plan's alias and cached address
 * @returns the gap, or `undefined` when the text names each plan by its address or asks no plan sign-in
 */
export function planSignInGap({
  text,
  plans,
}: {
  text: string;
  plans: readonly PlanEmail[];
}): PlanSignInGap | undefined {
  const lowered = text.toLowerCase();
  const carries = ({ email }: { email: string }): boolean => lowered.includes(email.toLowerCase());
  const signIns = text
    .split(SENTENCE_BREAK)
    .filter((sentence) => isSignIn({ what: sentence }) || SPLIT_SIGN_IN.test(sentence));
  const named = plans.filter((plan) => signIns.some((sentence) => aliasPattern({ alias: plan.alias }).test(sentence)));
  for (const plan of named) {
    if (plan.email !== undefined && !carries({ email: plan.email })) {
      return { alias: plan.alias, email: plan.email, kind: "alias-without-email" };
    }
  }
  if (named.length > 0 || !PLAN_SIGN_IN.test(text)) {
    return undefined;
  }
  const emails = plans.flatMap((plan) => (plan.email === undefined ? [] : [plan.email]));
  if (emails.length === 0 || emails.some((email) => carries({ email }))) {
    return undefined;
  }
  return { emails, kind: "plan-unnamed" };
}

/**
 * The sentence a refusal prints for a gap: what to add, in the words the owner reads.
 *
 * @returns one line naming the address to add, or the addresses to choose from
 */
export function planSignInGapLine({ gap }: { gap: PlanSignInGap }): string {
  if (gap.kind === "alias-without-email") {
    return (
      `asks the owner to sign into ${gap.alias} without its email address — add ${gap.email}. The owner signs in ` +
      "with the address, and a plan number alone makes them guess which account it is"
    );
  }
  return (
    "asks the owner to sign into a Claude or Codex plan without naming which one by its email address — add the " +
    `address of the plan the owner signs into (one of ${gap.emails.join(", ")}; \`slopweaver plans list\` pairs each with its alias)`
  );
}

/**
 * Every registered plan's alias and cached address, read from the plan register under `home`.
 *
 * An unreadable register answers an EMPTY list rather than a refusal, on purpose: this list only ever adds a demand
 * to a sign-in note, and a note that cannot post because the register is broken may be the very note that fixes it.
 *
 * @param home the Slopweaver home holding `plans.json`
 * @param port where the plan register is read; a store outage answers none, exactly as an unreadable register does
 * @returns each plan's alias and cached email, or none when the register will not read
 */
export async function readPlanEmailsOver({
  home,
  port,
}: {
  home: string;
  port: PlanRegisterPort;
}): Promise<readonly PlanEmail[]> {
  const register = await port.read({ home });
  if (register.isErr()) {
    return [];
  }
  return register.value.plans.map((plan) => ({ alias: plan.alias, email: plan.email }));
}

/**
 * {@link readPlanEmailsOver} against the production register store. It keeps the one-field signature because the
 * hand register's appends, the fleet-health monitor and the handover draft admission each call it as their edge read;
 * a test asks {@link readPlanEmailsOver} with a fixture port instead.
 *
 * @param home the Slopweaver home holding `plans.json`
 * @returns each plan's alias and cached email, or none when the register will not read
 */
export async function readPlanEmails({ home }: { home: string }): Promise<readonly PlanEmail[]> {
  return readPlanEmailsOver({ home, port: planRegisterPort() });
}
