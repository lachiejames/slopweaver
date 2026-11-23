/**
 * The POLL renderer — pure, deterministic, and full-chrome by design.
 *
 * ## Why the ballot stays above the fold
 *
 * A card carries an investigation: a readable lead above the fold and the working below it, which is what
 * progressive disclosure is for. A poll is the opposite shape — it is a *question and its options*, and every
 * part of it has to be readable before anyone can answer. A poll behind "Show more" is a poll nobody votes on.
 *
 * The canonical chrome consumes the first five wrapper blocks: author, divider, content, divider, Details.
 * The poll therefore combines its question and ballot into the ONE content block. The footer is the first
 * detail block and may collapse; the ballot never can, so a reader can always answer without expanding.
 *
 * ## Emoji are structural in `rich_text` and shortcodes in mrkdwn — this file is mrkdwn
 *
 * `section`/`context` blocks take **mrkdwn**, where `:one:` DOES expand and `*bold*` works. That is the exact
 * inverse of `rich_text` (which the card body uses), where a shortcode renders as literal text and emphasis has
 * to be a style flag. Getting the direction wrong shows raw `:one:` to every reader, so it is stated here.
 * Authored text IS escaped, for the same reason: mrkdwn parses it.
 */
import type { KnownBlock } from "@slack/types";
import type { PollArtifact, PollBallotEntry } from "./pollForm.js";
import { escapeMrkdwn, renderFullChromeWrapper } from "./render.js";
import type { SlackCardChrome, SlackPollPayload } from "./types.js";

/**
 * The surface a poll is posted to, which is what makes its footer true or false.
 *
 * Only two cases matter, because only two visibility facts exist: a 1:1 DM, where nobody else being asked can
 * see the answer, and anything shared (a channel, a private channel, a group DM), where everyone present can. A
 * group DM sits with the shared case deliberately — several people see each other's reactions there.
 */
export type PollSurface = "direct-message" | "shared-channel";

/**
 * The surface a channel id LOOKS like, for a `--dry-run` PREVIEW only.
 *
 * A dry run must stay usable with no token and no network — it is the step you take before you have decided to
 * send anything — but it also has to show the footer that will really ship, or the preview lies about the exact
 * thing this module exists to get right. So the preview derives the surface from the id (`D…` is a DM), and the
 * REAL send still asks Slack and refuses when the answer is unclear.
 *
 * Deliberately NOT used on the send path. The prefix is a good heuristic and a heuristic is not good enough to
 * make a promise on; it is good enough to draw a preview that says where it came from.
 *
 * @param channel the destination channel id
 * @returns the surface the id implies
 */
export function previewSurfaceFromChannelId({ channel }: { channel: string }): PollSurface {
  return channel.startsWith("D") ? "direct-message" : "shared-channel";
}

/** How to vote. Identical everywhere, because the mechanism does not change with the surface. */
const HOW_TO_VOTE = "Vote by tapping one of the number reactions already on this message.";

/**
 * What is true about who can see a vote — stated PER SURFACE, because the old single constant was false in a DM.
 *
 * The DM wording is the careful one, and it is deliberately not "your vote is private". In a 1:1 DM the reactions
 * ARE visible to whoever sent the poll — it is a two-person channel — so claiming anonymity would just replace
 * one false statement with another. What is actually true, and what a respondent cares about, is that no OTHER
 * respondent sees it: that is what makes a blind poll blind, and it is the reason to DM the same question to
 * people separately rather than post it once in a channel.
 *
 * Getting this wrong is not cosmetic. A footer claiming a vote is public makes people self-censor, so the data
 * quietly gets worse and nothing surfaces that it happened — the same silent-failure shape as reporting a stale
 * count as current.
 */
const VISIBILITY: Readonly<Record<PollSurface, string>> = {
  "direct-message":
    "Only you and whoever sent this can see your answer — nobody else being asked will see it. " +
    "You can pick more than one.",
  "shared-channel": "Everyone in this channel can see who voted, and you can pick more than one.",
};

/**
 * The footer for one surface: how to vote, then what is true about who sees it.
 *
 * Renderer-supplied, never an author field, so it cannot be forgotten or quietly made false — the same reason
 * the escape-hatch option is appended rather than requested.
 *
 * @param surface the surface the poll is being posted to
 * @returns the footer text for that surface
 */
export function pollFooterFor({ surface }: { surface: PollSurface }): string {
  return `${HOW_TO_VOTE} ${VISIBILITY[surface]}`;
}

/** One resolved ping token, exactly as mrkdwn wants it (`<!subteam^S…>`, `<!here>`, `<@U…>`). */
export type ResolvedPings = readonly string[];

/** The ballot as one mrkdwn block: a keycap shortcode and its label, one option per line. */
function ballotText({ ballot }: { ballot: readonly PollBallotEntry[] }): string {
  return ballot.map((entry) => `:${entry.emojiName}:  ${escapeMrkdwn({ text: entry.label })}`).join("\n");
}

/** The lead section: the pings (when any), then the bold question, then why it is being asked. */
function leadText({ artifact, pings }: { artifact: PollArtifact; pings: ResolvedPings }): string {
  const ask = `*${escapeMrkdwn({ text: artifact.question })}*\n${escapeMrkdwn({ text: artifact.why })}`;
  // Pings lead, because a notification whose reason the reader cannot immediately see is just noise. The tokens
  // are NOT escaped — they are markup we constructed, and escaping them would show `&lt;!subteam…&gt;` verbatim.
  return pings.length === 0 ? ask : `${pings.join(" ")}\n\n${ask}`;
}

/** The complete above-fold poll: lead, then ballot, in one block so the chrome cannot push options below it. */
function pollContentText({
  artifact,
  ballot,
  pings,
}: {
  artifact: PollArtifact;
  ballot: readonly PollBallotEntry[];
  pings: ResolvedPings;
}): string {
  return `${leadText({ artifact, pings })}\n\n${ballotText({ ballot })}`;
}

/**
 * Render a poll into the exact `chat.postMessage` arguments, minus the channel.
 *
 * @param artifact the validated poll
 * @param ballot the option→emoji pairing from `pollBallot`, so renderer and counter cannot disagree
 * @param pings the already-resolved mention tokens; resolving them is effectful and happens in the shell
 * @param chrome the configured full bot chrome
 * @param surface where it is being posted, which decides what the footer may truthfully claim
 * @param pollId the local record id, carried in metadata so a later delete can recognise this poll
 * @param metadataEventType the poll event type, distinct from the card's and the progress one's
 * @returns the full-chrome payload with the entire ballot above the fold
 */
export function renderPoll({
  artifact,
  ballot,
  pings,
  chrome,
  surface,
  pollId,
  metadataEventType,
}: {
  artifact: PollArtifact;
  ballot: readonly PollBallotEntry[];
  pings: ResolvedPings;
  chrome: SlackCardChrome;
  surface: PollSurface;
  pollId: string;
  metadataEventType: string;
}): SlackPollPayload {
  const content: KnownBlock = {
    text: { text: pollContentText({ artifact, ballot, pings }), type: "mrkdwn" },
    type: "section",
  };
  const footer: KnownBlock = {
    elements: [{ text: pollFooterFor({ surface }), type: "mrkdwn" }],
    type: "context",
  };
  return {
    attachments: [renderFullChromeWrapper({ chrome, content, details: [footer], fallback: artifact.question })],
    // Metadata is TOP-LEVEL, never inside the wrapper — nested there Slack silently ignores it, and the poll
    // would quietly stop being recognisable to `slack delete`.
    metadata: {
      event_payload: { pollId, renderer: "slack-poll-v1", schemaVersion: 1 },
      event_type: metadataEventType,
    },
    // Empty `text` alongside `attachments`, exactly as the card does: a non-empty one renders a DUPLICATE body
    // above the wrapper. The `fallback` on the wrapper is what a notification shows.
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}
