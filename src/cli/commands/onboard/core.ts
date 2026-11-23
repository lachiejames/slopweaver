/**
 * `slopweaver onboard`'s PURE half: its flag surface, its parse, the two questions it asks, and the decision
 * of whether each one gets asked at all.
 *
 * ## Two questions, and no more
 *
 * Every question is a cost, so the verb asks only for what it genuinely cannot derive: the TIER (a real
 * choice, and the whole point of the flow) and the APP NAME (which nothing on this machine knows, and which
 * a workspace already running an app called Slopweaver has to change). Everything else the manifest needs is
 * either fixed or derived — the bot's display name comes from the app name, and there is no request URL to
 * ask for because the speaking tiers use Socket Mode.
 *
 * `--identity` and `--mailbox-zone` do NOT make it three or four questions. They are flag-only on purpose:
 * the mailbox block they feed is complete without them (it teaches the shape and names the flags), so
 * asking would charge every onboarding a question for a step most of them will skip. They are also not
 * derivable — an email local part routinely fails `src/alias/address.ts`'s label rule, so a guess would
 * either refuse confusingly or mint an identity segment no later read can attribute.
 *
 * ## Asking is a decision, not a reflex
 *
 * {@link answerRoute} is the same shape as `secrets set`'s `secretSource`: a flag wins, otherwise a terminal
 * gets a question, otherwise the default is taken AND said out loud. That keeps the verb usable in a pipe or
 * a CI job — it never blocks on input that cannot arrive — and keeps the branching testable without a TTY.
 */

import type { Result } from "../../../lib/result.js";
import type { AnswerSource } from "../../../onboard/render.js";
import { DEFAULT_APP_NAME, DEFAULT_TIER } from "../../../onboard/tiers.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** The verb's flag spec. */
const SPEC: FlagSpec = { boolean: ["json"], string: ["tier", "app-name", "identity", "mailbox-zone"] };

/** `--`-prefixed flag names, for the help-truth ratchet. */
export const ONBOARD_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: SPEC }),
  ...booleanFlagsOf({ spec: SPEC }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * The question asked when the tier was not given as a flag. Exported so a test asserts the words.
 *
 * This is the point of choice, so the recommendation, the security label and the one cost that cannot be
 * reversed are all in it — a user who answers with a bare Enter has already read that the Agents panel is
 * permanent and that `standard` is the same bot without it.
 */
export const TIER_QUESTION =
  "Which tier?\n" +
  "  agent       RECOMMENDED, and the LEAST SECURE — everything the bot can do, plus Slack's Agents panel.\n" +
  "              Enabling the Agents panel CANNOT BE UNDONE, and workspace guests lose access to the app.\n" +
  "  standard    the same bot without the Agents panel — every part of it can be undone\n" +
  "  restricted  ingest only — no bot, no posting, no reacting\n" +
  `[${DEFAULT_TIER}] > `;

/** The question asked when the app name was not given as a flag. */
export const APP_NAME_QUESTION = `What should the Slack app be called? [${DEFAULT_APP_NAME}] > `;

/** What the verb was asked to do. */
export interface OnboardOptions {
  /** The `--tier` value, when one was given. */
  readonly tier: string | undefined;
  /** The `--app-name` value, when one was given. */
  readonly appName: string | undefined;
  /** Emit JSON instead of the human session (and ask nothing). */
  readonly json: boolean;
  /** The `--identity` value, when one was given. Flag-only: never asked, never guessed. */
  readonly identity: string | undefined;
  /** The `--mailbox-zone` value, when one was given. Flag-only, for the same reason. */
  readonly mailboxZone: string | undefined;
}

/**
 * Parse `onboard`'s flags.
 *
 * Exported so the help-truth ratchet pushes every advertised flag through the REAL parser rather than
 * comparing two declarations with each other.
 *
 * @param rest the argv after the noun (and after a literal `run`, which the shell strips)
 * @returns the parsed flags, or every rejection
 */
export function parseOnboardArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: SPEC });
}

/** Read one string flag, treating an absent or empty value as "not given". */
function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Fold parsed flags into the verb's options.
 *
 * @param parsed the parsed flags
 * @returns what the verb was asked to do
 */
export function onboardOptions({ parsed }: { parsed: ParsedFlags }): OnboardOptions {
  return {
    appName: stringFlag({ name: "app-name", parsed }),
    identity: stringFlag({ name: "identity", parsed }),
    json: parsed.values["json"] === true,
    mailboxZone: stringFlag({ name: "mailbox-zone", parsed }),
    tier: stringFlag({ name: "tier", parsed }),
  };
}

/**
 * Where one answer comes from: a flag wins; otherwise an interactive terminal gets the question; otherwise
 * the default is taken. Pure — the same decision shape `secrets set` makes about its capture source.
 *
 * @param canAsk whether a question can actually be answered (an interactive terminal, and not `--json`)
 * @returns which route this answer takes
 */
export function answerRoute({
  flagValue,
  canAsk,
}: {
  flagValue: string | undefined;
  canAsk: boolean;
}): "flag" | "ask" | "default" {
  if (flagValue !== undefined) {
    return "flag";
  }
  return canAsk ? "ask" : "default";
}

/**
 * What to CALL the source of an answer, once it is known what the user actually typed. A question answered
 * with a bare Enter took the default, and saying "you chose this" of it would be a small lie in a flow whose
 * whole job is to be honest about what was chosen.
 *
 * @param route where the answer came from
 * @param raw what was typed (empty when the user pressed Enter, or when no question was asked)
 * @returns the source to report
 */
export function finalSource({ route, raw }: { route: "flag" | "ask" | "default"; raw: string }): AnswerSource {
  if (route === "flag") {
    return "flag";
  }
  return route === "ask" && raw.trim().length > 0 ? "asked" : "default";
}
