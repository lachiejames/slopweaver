/**
 * What `slopweaver talk slack-channel` accepts — its flag spec, the names the help-truth ratchet reads, and the pure
 * parser. The usage line is in `./knowUsage.ts`, a leaf the manifest quotes without loading this.
 */
import { err, ok, type Result } from "#lib/result.js";
import { SLACK_CHANNEL_MAX_BYTES } from "../../../talk/slackChannelAnswer.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk slack-channel` accepts. */
const SLACK_CHANNEL_FLAGS = { boolean: ["json"], string: ["channel", "max-bytes", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_SLACK_CHANNEL_FLAG_NAMES: readonly string[] = flagNames({ spec: SLACK_CHANNEL_FLAGS });

/** The longest `--channel` accepted, in characters: a Slack link with its query is well under this. */
const MAX_CHANNEL_CHARS = 2000;

/** A parsed `talk slack-channel` invocation. */
export interface SlackChannelArgs {
  readonly channel: string;
  readonly maxBytes: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk slack-channel` invocation. What `--channel` names is judged when the verb runs, by the one parser
 * the read itself uses (`talk/slackChannelAddress.ts`), so a bad one is refused with that parser's reason.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseSlackChannelArgs({ rest }: { rest: readonly string[] }): Result<SlackChannelArgs> {
  const parsed = parseFlags({ args: rest, spec: SLACK_CHANNEL_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const channel = stringOf({ value: values["channel"] });
  const problems: string[] = [];
  const maxBytes = numberOf({
    fallback: SLACK_CHANNEL_MAX_BYTES,
    name: "--max-bytes",
    problems,
    value: values["max-bytes"],
  });
  if (channel === undefined) {
    problems.push("talk slack-channel needs --channel <name, link or id>");
  } else if (channel.length > MAX_CHANNEL_CHARS) {
    problems.push(`--channel is over ${String(MAX_CHANNEL_CHARS)} characters; pass one channel's name or link`);
  }
  if (channel === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({ channel, home: stringOf({ value: values["home"] }), json: values["json"] === true, maxBytes });
}
