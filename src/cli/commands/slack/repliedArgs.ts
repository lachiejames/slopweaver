/**
 * What `slopweaver slack replied` accepts — its flag spec, the names the help-truth ratchet reads, and the pure
 * parser. The usage line is in `./repliedUsage.ts`, a leaf the manifest quotes without loading this.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "../talk/flagValues.js";

/** The flags `slack replied` accepts. */
const SLACK_REPLIED_FLAGS = { boolean: ["json"], string: ["url", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const SLACK_REPLIED_FLAG_NAMES: readonly string[] = flagNames({ spec: SLACK_REPLIED_FLAGS });

/** The longest link accepted, in characters: a Slack message link with its query is well under this. */
const MAX_URL_CHARS = 2000;

/** A parsed `slack replied` invocation. */
export interface SlackRepliedArgs {
  readonly url: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** Why a `slack replied` invocation was refused before anything was read. */
export type SlackRepliedArgsError =
  | { readonly code: "FLAGS_INVALID"; readonly message: string }
  | { readonly code: "URL_MISSING"; readonly message: string }
  | { readonly code: "URL_TOO_LONG"; readonly message: string };

/** The one place each refusal's words are written. */
export const SlackRepliedArgsErrors = {
  flagsInvalid: ({ problems }: { problems: readonly string[] }): SlackRepliedArgsError => ({
    code: "FLAGS_INVALID",
    message: problems.join("\n"),
  }),
  urlMissing: (): SlackRepliedArgsError => ({
    code: "URL_MISSING",
    message: "slack replied needs --url <slack-message-link>",
  }),
  urlTooLong: (): SlackRepliedArgsError => ({
    code: "URL_TOO_LONG",
    message: `--url is over ${String(MAX_URL_CHARS)} characters; pass one Slack message link`,
  }),
} as const;

/**
 * Parse a `slack replied` invocation. The link's own shape is judged by the Slack permalink parser when the verb
 * runs, so a malformed one is refused with that parser's reason rather than a second copy of its rules.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or why they were refused
 */
export function parseSlackRepliedArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<SlackRepliedArgs, SlackRepliedArgsError> {
  const parsed = parseFlags({ args: rest, spec: SLACK_REPLIED_FLAGS });
  if (parsed.isErr()) {
    return err(SlackRepliedArgsErrors.flagsInvalid({ problems: parsed.error }));
  }
  const { values } = parsed.value;
  const url = stringOf({ value: values["url"] });
  if (url === undefined) {
    return err(SlackRepliedArgsErrors.urlMissing());
  }
  if (url.length > MAX_URL_CHARS) {
    return err(SlackRepliedArgsErrors.urlTooLong());
  }
  return ok({ home: stringOf({ value: values["home"] }), json: values["json"] === true, url });
}
