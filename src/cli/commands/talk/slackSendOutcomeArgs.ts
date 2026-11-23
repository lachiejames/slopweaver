/**
 * What `slopweaver talk slack-send-outcome` accepts — its flag spec, the names the help-truth ratchet reads, and the
 * pure parser. The usage line is in `./knowUsage.ts`, a leaf the manifest quotes without loading this.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import { err, ok, type Result } from "../../../lib/result.js";
import { SlackSendOutcomeErrors } from "../../../talk/slackSendOutcome.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";

/** The flags `talk slack-send-outcome` accepts. */
const SLACK_SEND_OUTCOME_FLAGS = { boolean: ["json"], string: ["url", "since", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_SLACK_SEND_OUTCOME_FLAG_NAMES: readonly string[] = flagNames({ spec: SLACK_SEND_OUTCOME_FLAGS });

/** The longest link accepted, in characters: a Slack message link with its query is well under this. */
const MAX_URL_CHARS = 2000;

/** A parsed `talk slack-send-outcome` invocation. */
export interface SlackSendOutcomeArgs {
  readonly url: string;
  /** The moment they asked for the send, as an ISO instant. */
  readonly since: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk slack-send-outcome` invocation. The link is judged by the Slack permalink parser when the verb
 * reads; `--since` is judged here by the same strict parser and refusal the core uses, so it is refused before any
 * state is read.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseSlackSendOutcomeArgs({ rest }: { rest: readonly string[] }): Result<SlackSendOutcomeArgs> {
  const parsed = parseFlags({ args: rest, spec: SLACK_SEND_OUTCOME_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const url = stringOf({ value: values["url"] });
  const since = stringOf({ value: values["since"] });
  const problems: string[] = [];
  if (url === undefined) {
    problems.push("talk slack-send-outcome needs --url <slack-message-link>");
  } else if (url.length > MAX_URL_CHARS) {
    problems.push(`--url is over ${String(MAX_URL_CHARS)} characters; pass one Slack message link`);
  }
  if (since === undefined) {
    problems.push("talk slack-send-outcome needs --since <iso>: the moment they asked for the send");
  } else if (parseStrictIsoInstantMs({ text: since }) === undefined) {
    // Refused here, before any state is read, so a missing token never answers over a malformed instant.
    problems.push(SlackSendOutcomeErrors.sinceNotInstant({ since }).message);
  }
  if (url === undefined || since === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({ home: stringOf({ value: values["home"] }), json: values["json"] === true, since, url });
}
