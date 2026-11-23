/**
 * What `slopweaver talk slack-after` accepts — its flag spec, the names the help-truth ratchet reads, and the pure
 * parser. The usage line is in `./knowUsage.ts`, a leaf the manifest quotes without loading this.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { SLACK_AFTER_MAX_BYTES } from "../../../talk/slackAfter.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk slack-after` accepts. */
const SLACK_AFTER_FLAGS = { boolean: ["json"], string: ["url", "max-bytes", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_SLACK_AFTER_FLAG_NAMES: readonly string[] = flagNames({ spec: SLACK_AFTER_FLAGS });

/** The longest link accepted, in characters: a Slack message link with its query is well under this. */
const MAX_URL_CHARS = 2000;

/** A parsed `talk slack-after` invocation. */
export interface SlackAfterArgs {
  readonly url: string;
  readonly maxBytes: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk slack-after` invocation. The link's own shape is judged by the Slack permalink parser when the
 * verb runs, so a malformed one is refused with that parser's reason rather than a second copy of its rules.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseSlackAfterArgs({ rest }: { rest: readonly string[] }): Result<SlackAfterArgs> {
  const parsed = parseFlags({ args: rest, spec: SLACK_AFTER_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const url = stringOf({ value: values["url"] });
  const problems: string[] = [];
  const maxBytes = numberOf({
    fallback: SLACK_AFTER_MAX_BYTES,
    name: "--max-bytes",
    problems,
    value: values["max-bytes"],
  });
  if (url === undefined) {
    problems.push("talk slack-after needs --url <slack-message-link>");
  } else if (url.length > MAX_URL_CHARS) {
    problems.push(`--url is over ${String(MAX_URL_CHARS)} characters; pass one Slack message link`);
  }
  if (url === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({ home: stringOf({ value: values["home"] }), json: values["json"] === true, maxBytes, url });
}
