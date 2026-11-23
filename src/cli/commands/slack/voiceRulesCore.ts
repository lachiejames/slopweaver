/**
 * Pure argument handling for `slopweaver slack voice-rules`.
 *
 * The verb has one job: print the operator's CURRENT voice brief — their response SHAPE and their
 * `slackMe.voice.exact` bans — before a single word of an `--as me` draft is written. See
 * `../../../outbound/voice/composerBrief.ts` for why this exists and what the printed lines mean, and
 * `../../../outbound/voice/briefStore.ts` for why a configured-but-unreadable source fails rather than
 * printing a partial brief. `--check-stdin` is its second, machine-facing job: judge one message against those same
 * bans (`../../../outbound/voice/copyVerdict.ts`), which is how the talk console's running list asks. `--slack-draft`
 * narrows that check to a Slack message as them, which the earns-its-place shape and the tray's per-paragraph word cap
 * bind too, so it means nothing without
 * `--check-stdin` and is refused there rather than ignored.
 */
import { err, ok } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";

/** Every flag this verb accepts. Not exported — only {@link SLACK_VOICE_RULES_FLAG_NAMES} is needed outside. */
const SLACK_VOICE_RULES_FLAGS: FlagSpec = { boolean: ["check-stdin", "json", "slack-draft"], string: ["home"] };

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const SLACK_VOICE_RULES_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: SLACK_VOICE_RULES_FLAGS }),
  ...stringFlagsOf({ spec: SLACK_VOICE_RULES_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation. Not exported — every caller reads it through the `Result` `parseSlackVoiceRulesArgs` returns. */
interface SlackVoiceRulesOptions {
  /** Judge the message on stdin against the `me`-lane rules instead of printing the brief. */
  readonly checkStdin: boolean;
  /** With `checkStdin`: the message is a Slack draft as them, so the earns-its-place shape binds it too. */
  readonly slackDraft: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `slack voice-rules`
 * @returns the resolved options, or the typed refusal: the tokeniser's own problems, or `--slack-draft` alone
 */
export function parseSlackVoiceRulesArgs({ rest }: { rest: readonly string[] }): SlackParsed<SlackVoiceRulesOptions> {
  const parsed = parseFlags({ args: rest, spec: SLACK_VOICE_RULES_FLAGS });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const checkStdin = values["check-stdin"] === true;
  const slackDraft = values["slack-draft"] === true;
  if (slackDraft && !checkStdin) {
    return err(SlackArgumentErrors.slackDraftWithoutCheckStdin());
  }
  return ok({
    checkStdin,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    slackDraft,
  });
}
