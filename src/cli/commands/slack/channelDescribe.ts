/**
 * What `slack channel create` says about the channel once it is real: the created line, and the purpose and
 * topic as Slack actually stored them. Split out of `./channelRun.ts`, whose door ordering is the part that
 * stays there; everything here runs after the create and reports rather than decides.
 *
 * A purpose or topic is reported as Slack's answer says it was stored, and as what was sent when that answer
 * carries nothing back.
 */
import type { OpenedConversation } from "../../../corpus/slack/writeApiConversations.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import type { ChannelCreatePlan } from "./channelCore.js";

/** The seams describing a channel touches: the two description endpoints and the report line sink. */
export interface ChannelDescribeDeps {
  readonly setPurpose: (args: {
    home: string;
    token: string;
    channel: string;
    purpose: string;
  }) => Promise<string | undefined>;
  readonly setTopic: (args: {
    home: string;
    token: string;
    channel: string;
    topic: string;
  }) => Promise<string | undefined>;
  readonly emit: (line: string) => void;
}

/**
 * The line naming the channel a create just minted: the name Slack gave it, or the planned one when Slack's
 * answer carried no name.
 *
 * @param created the channel Slack just minted
 * @param plan the fully-decided create
 * @returns the line to print
 */
export function createdChannelLine({
  created,
  plan,
}: {
  created: OpenedConversation;
  plan: ChannelCreatePlan;
}): string {
  const kind = plan.isPrivate ? "private channel" : "channel";
  if (created.name === undefined) {
    return `created ${kind} #${plan.name} (${created.id})`;
  }
  return `created ${kind} #${created.name} (${created.id})`;
}

/**
 * One description field as the report prints it: what Slack stored, or what was sent when Slack echoed
 * nothing back.
 *
 * @param field which description this is
 * @param stored what Slack's answer said it stored, `undefined` when it echoed nothing
 * @param sent what the create sent
 * @returns the line to print
 */
function describedLine({
  field,
  stored,
  sent,
}: {
  field: "purpose" | "topic";
  stored: string | undefined;
  sent: string;
}): string {
  if (stored === undefined) {
    return `${field}: ${JSON.stringify(sent)}`;
  }
  return `${field}: ${JSON.stringify(stored)}`;
}

/**
 * Set the purpose and the topic, reporting what Slack actually stored.
 *
 * Each is attempted independently and neither aborts the other: they are separate endpoints behind
 * separate scopes, so a token holding one and not the other must still get the half it can do.
 *
 * @param created the channel Slack just minted
 * @param deps the injected seams
 * @param home the state home whose private-terms policy judges the purpose and topic before they are sent
 * @param plan the fully-decided create
 * @param token the token the create ran on
 * @returns whether either step failed, so the caller can report a partial success
 */
export async function describeChannel({
  created,
  deps,
  home,
  plan,
  token,
}: {
  created: OpenedConversation;
  deps: ChannelDescribeDeps;
  home: string;
  plan: ChannelCreatePlan;
  token: string;
}): Promise<boolean> {
  let failed = false;
  if (plan.purpose !== undefined) {
    try {
      const stored = await deps.setPurpose({ channel: created.id, home, purpose: plan.purpose, token });
      deps.emit(describedLine({ field: "purpose", sent: plan.purpose, stored }));
    } catch (error) {
      logger.error({ msg: `could not set the purpose: ${errorMessage({ error })}` });
      failed = true;
    }
  }
  if (plan.topic !== undefined) {
    try {
      const stored = await deps.setTopic({ channel: created.id, home, token, topic: plan.topic });
      deps.emit(describedLine({ field: "topic", sent: plan.topic, stored }));
    } catch (error) {
      logger.error({ msg: `could not set the topic: ${errorMessage({ error })}` });
      failed = true;
    }
  }
  return failed;
}
