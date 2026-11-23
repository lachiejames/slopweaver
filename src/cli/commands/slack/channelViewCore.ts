/**
 * Pure argument handling for `slack channel-view`, split from the shell so the flag surface is unit-testable
 * without a token or a network, and so `helpTruth` can prove `--help` names exactly what the verb accepts — the
 * split `readFileCore.ts` uses.
 */

import { err, ok } from "../../../lib/result.js";
import { isWorkspaceHost } from "../../../live/slack/channelMedia.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type SlackRead, SlackReadErrors } from "./readErrors.js";

/** Every flag this verb accepts. *
 * @internal — the flag spec the help-truth ratchet compares against; not a public surface.
 */
export const SLACK_CHANNEL_VIEW_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["home", "workspace"],
};

/**
 * Every flag NAME, derived from the spec so the usage string and the parser cannot drift apart.
 *
 * @internal — derived from the spec for the help-truth ratchet alone.
 */
export const SLACK_CHANNEL_VIEW_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: SLACK_CHANNEL_VIEW_FLAGS }),
  ...stringFlagsOf({ spec: SLACK_CHANNEL_VIEW_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** A conversation id — a public or private channel, a group or a DM — the only shape that reaches Slack. */
const CONVERSATION_ID = /^[CDG][A-Z0-9]+$/u;

/** The resolved invocation. *
 * @internal — the parser's own return shape; the shell beside it is the only consumer.
 */
export interface SlackChannelViewOptions {
  readonly channel: string;
  readonly json: boolean;
  readonly home: string | undefined;
  /** The workspace host the cited link named; absent when the caller named none, and then nothing is compared. */
  readonly workspace: string | undefined;
}

/**
 * Parse the verb's arguments: exactly one conversation id, the workspace it was cited in, and the output flags.
 *
 * @param rest the argv tail after `slack channel-view`
 * @returns the resolved options, or the first usage problem found
 */
export function parseSlackChannelViewArgs({ rest }: { rest: readonly string[] }): SlackRead<SlackChannelViewOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SLACK_CHANNEL_VIEW_FLAGS });
  if (parsed.isErr()) {
    return err(SlackReadErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  if (positionals.length === 0) {
    return err(SlackReadErrors.channelMissing());
  }
  if (positionals.length > 1) {
    return err(SlackReadErrors.channelCount({ channels: positionals }));
  }
  const channel = positionals[0]!;
  if (!CONVERSATION_ID.test(channel)) {
    return err(SlackReadErrors.channelInvalid({ got: channel }));
  }
  const home = typeof values["home"] === "string" ? values["home"] : undefined;
  const workspace = typeof values["workspace"] === "string" ? values["workspace"] : undefined;
  if (workspace !== undefined && !isWorkspaceHost({ host: workspace })) {
    return err(SlackReadErrors.workspaceInvalid({ got: workspace }));
  }
  return ok({ channel, home, json: values["json"] === true, workspace });
}
