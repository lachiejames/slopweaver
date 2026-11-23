/**
 * A Slack message's first block leads with the discussion, never a pull request — judged on the RENDERED payload,
 * so a bot card's `primaryLink` (drawn above its TL;DR) and an as-me message's opening line are read alike.
 *
 * A draft whose first block opened on `🔗 Fix branch` and whose TL;DR ended "need a reviewer for the fix" was meant
 * to be a plain heads-up: the errors noticed, an annotated Datadog screenshot and link, and no pull request at all.
 * The criterion is `../../briefing/pullRequestLead.ts`, shared with the hand headline and
 * the Queue ask.
 *
 * **What "first block" means.** The first `header`, `rich_text` or `section` block, in the attachment wrapper a card
 * sits in or the message's own `blocks`, skipping the `context` chrome (the bot's name line), dividers and images,
 * which carry no words; with no block at all,
 * the message's `text`. A link contributes its ADDRESS ahead of its label, because a label reads "Fix branch" while
 * the address is what says it is a pull request. Mentions the block opens on are skipped: they say who is pinged, not
 * what it is about. Everything after that block — the detail, the bullets, a line asking for a review further down —
 * is below the fold and is not read here, and of a multi-message send only the first message is judged.
 *
 * **Where it is asked.** At every verb that authors a message a teammate opens on — a draft record, a fresh send or
 * release, a poll, an edit — never at the transport. `./prLeadSeams.ts` classifies every Slack producer, with
 * why a bot answer, a Queue answer release and a turn card are not judged: a person's tag chose their subject.
 *
 * **The owner's own bot DM is exempt only once PROVEN theirs.** The
 * profile checks no more than that `slackBot.promptChannel` is non-empty, so a colleague's `D…` DM configured there was
 * exempt. The exemption is now a capability the caller mints (`../../cli/commands/slack/verifiedOwnDm.ts`): a
 * bot-token `conversations.info` read naming `slackBot.ownerUserId` as the DM's other member. An unreadable or
 * mismatched destination is judged. `ownerUserId` stays the authority for who "the owner" is, the stated residue.
 *
 * No hatch, said rather than left silent: leading with the evidence is always possible, so the reword is the fix.
 * Pure.
 */
import type { DoorGate } from "../../admit/types.js";
import { pullRequestLead, pullRequestLeadReason } from "../../briefing/pullRequestLead.js";
import { isRecord } from "../../lib/parsers.js";

/**
 * Block types that are chrome or structure, never the message's opening. A `header` is NOT one: it is the first
 * thing a reader sees, so a header naming a pull request leads with it.
 */
const CHROME_BLOCKS: ReadonlySet<string> = new Set(["context", "divider", "image"]);

/**
 * The mrkdwn mention tokens (`<@U…>`, `<!subteam^…>`, `<!here>`, `<#C…>`) a section may open on. They say who is
 * pinged, never what the message is about, so a poll's `<!subteam^S1> *Approve the fix PR?*` leads with its question.
 */
const LEADING_MENTIONS = /^(?:\s*<[@!#][^>]*>)+\s*/u;

/**
 * The visible text of one block element tree, a link's address ahead of its label.
 *
 * @param node any part of a block
 * @returns the text it draws, in order
 */
function textOf({ node }: { node: unknown }): string {
  if (Array.isArray(node)) {
    return node.map((child: unknown) => textOf({ node: child })).join("");
  }
  if (!isRecord(node)) {
    return "";
  }
  if (node["type"] === "link" && typeof node["url"] === "string") {
    const label = typeof node["text"] === "string" ? ` ${node["text"]}` : "";
    return `${node["url"]}${label}`;
  }
  if (typeof node["text"] === "string") {
    return node["text"];
  }
  if (isRecord(node["text"]) && typeof node["text"]["text"] === "string") {
    return node["text"]["text"];
  }
  return textOf({ node: node["elements"] });
}

/** The blocks a payload draws first — a card's attachment wrapper, else its own `blocks`. */
function blocksOf({ payload }: { payload: Record<string, unknown> }): readonly unknown[] {
  const attachments = payload["attachments"];
  if (Array.isArray(attachments) && isRecord(attachments[0]) && Array.isArray(attachments[0]["blocks"])) {
    return attachments[0]["blocks"];
  }
  const blocks = payload["blocks"];
  return Array.isArray(blocks) ? blocks : [];
}

/**
 * The text a reader meets first in a rendered Slack payload — see the module header for what counts.
 *
 * @param payload the exact bytes a release would post
 * @returns the first block's text, or the message's `text`, or empty when it carries neither
 */
export function draftOpening({ payload }: { payload: unknown }): string {
  if (!isRecord(payload)) {
    return "";
  }
  const first = blocksOf({ payload }).find(
    (block) => isRecord(block) && typeof block["type"] === "string" && !CHROME_BLOCKS.has(block["type"]),
  );
  if (first !== undefined) {
    return textOf({ node: first }).replace(LEADING_MENTIONS, "");
  }
  return typeof payload["text"] === "string" ? payload["text"].replace(LEADING_MENTIONS, "") : "";
}

/**
 * Why a recording may not park because its first block leads with a pull request, or nothing when it does not.
 *
 * Scoped to TEAM-FACING messages: the rule is for work a teammate sees, and how the fleet works on the owner's own
 * setup is unchanged. So a draft bound for the owner's own bot DM, proven theirs by {@link prLedRefusalsFor}'s caller, is never judged; every other conversation — a channel, a thread, a
 * colleague's DM — reaches a teammate.
 *
 * @param payload the rendered message a release would post
 * @param toOwnerDm whether the draft is bound for the owner's own bot DM
 * @returns the refusal lines, empty when the opening leads with the discussion or no teammate reads it
 */
export function prLedDraftRefusals({
  payload,
  toOwnerDm,
}: {
  payload: unknown;
  toOwnerDm: boolean;
}): readonly string[] {
  if (toOwnerDm) {
    return [];
  }
  const phrase = pullRequestLead({ text: draftOpening({ payload }) });
  if (phrase === undefined) {
    return [];
  }
  return [
    `the message's first block ${pullRequestLeadReason({ phrase })}.`,
    "There is no hatch: reword the opening to lead with the evidence, and the pull request can sit in the detail.",
  ];
}

/** A Slack direct-message conversation id: a channel, a group DM or a private channel never begins with `D`. */
const DIRECT_MESSAGE_ID = /^D[A-Z0-9]+$/u;

/**
 * {@link prLedDraftRefusals} for a message aimed at `channel`, the owner's own bot DM exempt only once VERIFIED.
 *
 * `verifiedOwnDm` is a capability, never configuration: `../../cli/commands/slack/verifiedOwnDm.ts` mints it only
 * when the destination is the configured `slackBot.promptChannel` and a bot-token `conversations.info` read names
 * `slackBot.ownerUserId` as the DM's other member. The profile checks no more than that `promptChannel` is non-empty,
 * so a colleague's `D…` DM configured there is judged like any teammate's. The
 * channel must also still be a direct-message id, so a verified value that is not one exempts nothing.
 *
 * @param channel where the message is aimed
 * @param payload the rendered message, `undefined` when there is none
 * @param verifiedOwnDm the owner's bot DM id when the read proved it theirs, undefined when unproven or unread
 * @returns the refusal lines, empty when the opening leads with the discussion or no teammate reads it
 */
export function prLedRefusalsFor({
  channel,
  payload,
  verifiedOwnDm,
}: {
  channel: string;
  payload: unknown;
  verifiedOwnDm: string | undefined;
}): readonly string[] {
  const toOwnerDm = channel === verifiedOwnDm && DIRECT_MESSAGE_ID.test(channel);
  return prLedDraftRefusals({ payload, toOwnerDm });
}

/**
 * The judgement as a door gate, for a send that routes through `throughDoor` (`slack poll`). A HOLD, because the rule
 * has no hatch and the door's own type makes every `warn` carry an override token.
 *
 * @param channel where the send is aimed
 * @param payload the message the send would post
 * @param verifiedOwnDm the owner's bot DM id when the read proved it theirs, undefined when unproven or unread
 * @returns the gate, holding when the opening leads with a pull request in front of a teammate
 */
export function prLedOpeningGate({
  channel,
  payload,
  verifiedOwnDm,
}: {
  channel: string;
  payload: unknown;
  verifiedOwnDm: string | undefined;
}): DoorGate {
  return () => {
    const [summary] = prLedRefusalsFor({ channel, payload, verifiedOwnDm });
    if (summary === undefined) {
      return [];
    }
    return [
      {
        code: "pr-led-opening",
        correction: "reword the opening to lead with the evidence, and put the pull request in the detail",
        severity: "hold",
        summary,
      },
    ];
  };
}

/**
 * The same judgement at a SEND, over the bytes that send would post: a fresh `slack post|reply`, a parked row's
 * release, a `--thanks-instead` release's replacement line and an edit alike, so a message that names no
 * parked row is held to the rule a recording is, and a release is judged on what actually leaves.
 *
 * @param channel where the send is aimed
 * @param payload the first message the send would post, `undefined` when it posts none
 * @param verifiedOwnDm the owner's bot DM id when the read proved it theirs, undefined when unproven or unread
 * @returns the refusal lines ending in "Nothing was sent.", empty when the send may go
 */
export function prLedSendRefusals({
  channel,
  payload,
  verifiedOwnDm,
}: {
  channel: string;
  payload: unknown;
  verifiedOwnDm: string | undefined;
}): readonly string[] {
  const lines = prLedRefusalsFor({ channel, payload, verifiedOwnDm });
  return lines.length === 0 ? [] : [...lines, "Nothing was sent."];
}
