/**
 * The AS-ME renderer — pure, deterministic, and deliberately tiny.
 *
 * It is a separate renderer rather than the card renderer with its chrome switched off, and that is the
 * central design decision of PR5.1. A `renderUpdateCard({ wrapper: false, fold: false, authorRow: false })`
 * would still be a card-shaped thing with a human's avatar on it, and the failure mode being avoided is
 * exactly that: a reader seeing the owner's face above a robot-labelled card. So the human lane shares the
 * run vocabulary (`renderRun`) and NOTHING else — no wrapper, no banner, no author row, no `*Details*`
 * label, no fold, no metadata.
 *
 * Three things follow from the owner's measured answers and are load-bearing here:
 *
 *  1. **One message is ONE `rich_text` block, at TOP LEVEL with no wrapper.** The wrapper is what makes a
 *     Slack message fold — MEASURED, and the half of the fold matrix that survived the retraction
 *     of the block-count rule (`./preview.ts`). This lane has never folded a message, which is the evidence
 *     `./noFold.ts` builds the bot's own no-fold form on. So a
 *     one-block message in no wrapper cannot fold by construction, and the payload type (a one-element
 *     tuple, no `attachments` key) makes that a compile-time fact rather than a test. A drip message holds
 *     one section in that block; a one-card post holds one section per LINE, which changes neither the
 *     block count nor the fold.
 *  2. **No internal line breaks a structure did not put there.** For a drip the gap between MESSAGES is the
 *     spacing and the schema refuses a `\n` in a run, so nothing here has to strip one. A one-card post
 *     takes its breaks from `lines` and this renderer emits them as a BLANK line ({@link PARAGRAPH_BREAK});
 *     either way a `\n` never arrives smuggled inside a run. The bot card's other asymmetry — a single
 *     `\n` after a list — still has no analogue and is not ported.
 *  3. **No citations.** `DripInlineRun` excludes the chip, so the shared run renderer's citation branch is
 *     unreachable from here and is handed an empty list to prove it.
 *
 * Determinism matters for the same reason it does on the card: the per-message duplicate key is a hash of
 * the rendered payload, so a re-render of an unchanged message MUST be byte-identical or a resumed drip
 * would fail to recognise the line it already sent. Nothing here reads a clock, the filesystem or the
 * environment.
 */
import type { RichTextBlock, RichTextBlockElement, RichTextElement, RichTextSection } from "@slack/types";

import type { AsMeArtifact, CardLine, Citation, DripInlineRun, ListDepth, OneListArtifact } from "../artifact/types.js";
import { quoteMarkedLines } from "./blockquote.js";
import { escapeMrkdwn, type ResolvedMentions, renderRun } from "./render.js";
import type { SlackDripMessagePayload } from "./types.js";

/**
 * The empty citation list handed to the shared run renderer.
 *
 * Not an oversight and not a placeholder: `DripInlineRun` has no `citation` arm, so the branch that would
 * consume this is unreachable from the human lane. Citations are available only on bot-authored forms,
 * because a human does not footnote themselves.
 */
const NO_CITATIONS: readonly Citation[] = [];

/**
 * A human's links unfurl, because a human's links unfurl.
 *
 * The card suppresses unfurling (chrome that grew a preview card underneath it would look broken); the
 * as-me lane wants the opposite, since a suppressed unfurl is itself a tell that a message was not typed
 * by a person.
 */
const AS_ME_UNFURLS = true;

/**
 * The gap between two lines of a one-card post: a blank line, because a line of that form IS a paragraph.
 *
 * The owner's own typing, which this form exists to match, puts an empty line between
 * every paragraph and an `E.g.` on a line of its own. `../voice/paragraphSpacing.ts` is the gate that keeps
 * a send honest about it.
 */
const PARAGRAPH_BREAK = "\n\n";

/**
 * The gap between a one-list post's lead line and its list: a trailing `\n\n` on the section before it.
 *
 * The measured paragraph -> bullets rule from `./render.ts`'s own probe table (H3), not a second opinion
 * about it. It is appended INSIDE the lead section rather than sitting between two blocks, because Slack
 * strips whitespace at a boundary.
 */
const LIST_LEAD_GAP = "\n\n";

/**
 * The gap between a one-list post's list and the first line after it: a LEADING single `\n`.
 *
 * Single, not double, and that is measured rather than chosen — `./render.ts`'s probe table records
 * bullets -> paragraph as a leading single `\n` (I2 beat I1). Slack's list element already closes with
 * vertical space of its own, so a second newline reads as a blank line nobody typed.
 */
const AFTER_LIST_GAP = "\n";

/**
 * Slack's documented ceiling on a message's `text` field.
 *
 * It lives HERE and not beside the artifact schema because it is a Slack fact, and
 * `src/outbound/artifact/` may not know a platform exists — that boundary is what lets PR6/7/8 reuse the
 * schema instead of depending on Slack. The escape hatch is bounded by this and by nothing else.
 */
export const SLACK_MESSAGE_TEXT_MAX = 40_000;

/** One drip run as a `rich_text` element, through the renderer the card already uses. */
function renderDripRun({ run, mentions }: { run: DripInlineRun; mentions: ResolvedMentions }): RichTextElement {
  return renderRun({ citations: NO_CITATIONS, mentions, run });
}

/**
 * The NOTIFICATION fallback for one message: the same content as mrkdwn, for the push and the sidebar.
 *
 * It is emitted as real mrkdwn rather than as flattened prose because that is the string Slack shows in a
 * notification — a mention that reads `@person-key` on a phone and `@Their Name` in the channel is a
 * cosmetic bug that only ever shows up on someone else's device. Authored text IS escaped here (unlike in
 * `rich_text`, where escaping would emit visible backslashes) precisely because mrkdwn parses it.
 */
function fallbackRun({ run, mentions }: { run: DripInlineRun; mentions: ResolvedMentions }): string {
  switch (run.type) {
    case "text":
      return escapeMrkdwn({ text: run.text });
    case "link":
      return `<${run.url}|${escapeMrkdwn({ text: run.label })}>`;
    case "mention":
      // An unresolved key cannot reach here — the shell refuses the whole send before rendering — but the
      // fallback still degrades to the raw key rather than throwing, because a notification string is not
      // worth failing a send over. The `rich_text` renderer is where an unresolved mention is fatal.
      return mentionFallback({ mentions, person: run.person });
    case "group":
      return groupFallback({ handle: run.handle, mentions });
    case "broadcast":
      return `<!${run.range}>`;
  }
}

/** A resolved mention as `<@U…>`, or the key itself when the map somehow lacks it. */
function mentionFallback({ mentions, person }: { mentions: ResolvedMentions; person: string }): string {
  const slackId = mentions.people.get(person);
  return slackId === undefined ? person : `<@${slackId}>`;
}

/**
 * A resolved user group as `<!subteam^S…|@handle>`, or the handle itself when the map somehow lacks it.
 *
 * The `|@handle` fallback is deliberate and matches `../../cli/commands/slack/pollCore.ts`: it is what a
 * non-member and a notification preview render in place of the group's name.
 */
function groupFallback({ mentions, handle }: { mentions: ResolvedMentions; handle: string }): string {
  const groupId = mentions.groups.get(handle);
  return groupId === undefined ? `@${handle}` : `<!subteam^${groupId}|@${handle}>`;
}

function fallbackText({ runs, mentions }: { runs: readonly DripInlineRun[]; mentions: ResolvedMentions }): string {
  return runs.map((run) => fallbackRun({ mentions, run })).join("");
}

/** One drip message as its payload: exactly one block, exactly one section, no wrapper. */
function renderDripMessage({
  runs,
  mentions,
}: {
  runs: readonly DripInlineRun[];
  mentions: ResolvedMentions;
}): SlackDripMessagePayload {
  const block: RichTextBlock = {
    elements: [{ elements: runs.map((run) => renderDripRun({ mentions, run })), type: "rich_text_section" }],
    type: "rich_text",
  };
  return {
    blocks: [quoteMarkedLines({ block })],
    form: "rich",
    text: fallbackText({ mentions, runs }),
    unfurl_links: AS_ME_UNFURLS,
    unfurl_media: AS_ME_UNFURLS,
  };
}

/**
 * The one-card post as its payload: ONE message, one block, one section per line, a blank line between.
 *
 * The break between lines is an embedded text element on all but the last section — the same mechanism
 * `./render.ts`'s bulletless `list` uses, and it is reused rather than reinvented because that spacing was
 * measured against Slack rather than reasoned about. A `rich_text_list` wrapper would draw a glyph in front
 * of every line, which is a bulleted list, not a person's message.
 *
 * The break is `\n\n` rather than `\n`, which matches the owner's voice: a discussion
 * piece arriving as one dense block wants more vertical spacing. A one-card `line` IS a paragraph — the form has no other unit — so single-spacing
 * them was rendering three ideas as one wall. `cardVisibleMax` excludes line breaks, so nothing a caller
 * wrote gets closer to the cap for it, and `../voice/paragraphSpacing.ts` refuses the send if this ever
 * reverts. The header note above still holds for the DRIP: the gap between messages is its spacing.
 *
 * Still exactly ONE block, so the five-block fold cannot fire here any more than it can on a drip message.
 */
function renderOneCard({
  lines,
  mentions,
}: {
  lines: readonly CardLine[];
  mentions: ResolvedMentions;
}): SlackDripMessagePayload {
  const block: RichTextBlock = {
    elements: lines.map((line, position) => {
      const runs = line.runs.map((run) => renderDripRun({ mentions, run }));
      const last = position === lines.length - 1;
      return {
        elements: last ? runs : [...runs, { text: PARAGRAPH_BREAK, type: "text" as const }],
        type: "rich_text_section" as const,
      };
    }),
    type: "rich_text",
  };
  return {
    blocks: [quoteMarkedLines({ block })],
    form: "rich",
    // The notification fallback keeps the breaks: a card whose lines ran together in the push preview would
    // misrepresent on a phone exactly the shape this form exists to control. It is also the string the
    // paragraph-spacing gate reads, so it carries the SAME break the block does, never a narrower one.
    text: lines.map((line) => fallbackText({ mentions, runs: line.runs })).join(PARAGRAPH_BREAK),
    unfurl_links: AS_ME_UNFURLS,
    unfurl_media: AS_ME_UNFURLS,
  };
}

/** A dot point's glyph in the notification fallback, by depth: a sub-point indented under its headline. */
const FALLBACK_GLYPHS: Readonly<Record<ListDepth, string>> = { 0: "• ", 1: "    ◦ " };

/** One dot point's depth: what `depths` declares, or a headline when the list declares no depths at all. */
function depthAt({ artifact, index }: { artifact: OneListArtifact; index: number }): ListDepth {
  if (artifact.depths === undefined) {
    return 0;
  }
  return artifact.depths[index]!;
}

/**
 * The dot points as runs of consecutive same-depth points, in order: each run becomes one `rich_text_list`, which
 * is how Slack itself encodes a nested list — sibling lists inside one block, a sub-point run one `indent` in.
 */
function listRuns({ artifact }: { artifact: OneListArtifact }): readonly {
  readonly depth: ListDepth;
  readonly items: readonly (readonly DripInlineRun[])[];
}[] {
  const runs: { depth: ListDepth; items: (readonly DripInlineRun[])[] }[] = [];
  artifact.bullets.forEach((item, index) => {
    const depth = depthAt({ artifact, index });
    const open = runs.at(-1);
    if (open?.depth === depth) {
      open.items.push(item);
      return;
    }
    runs.push({ depth, items: [item] });
  });
  return runs;
}

/**
 * The one-list post as its payload: ONE message, ONE block — lead section, Slack's own bullet list, then
 * each trailing line as its own section.
 *
 * The list is a real `rich_text_list`, which is the whole difference from {@link renderOneCard}: Slack draws
 * the glyph and single-spaces the items, so ten of them read as a roster rather than as the ten-paragraph
 * wall a one-card of the same content would be. The same wrapper `../slack/render.ts`'s bulleted index uses,
 * and reused rather than reinvented for the same reason the one-card's break is: that render was measured
 * against Slack rather than reasoned about.
 *
 * The gaps around the list are the measured ones from `./render.ts`'s own table of them — a trailing `\n\n`
 * on the lead section before a list, and a LEADING single `\n` on the section after one. They are embedded
 * in the text elements rather than sitting at a block boundary, where Slack strips them.
 *
 * Still exactly ONE block, so the five-block fold cannot fire here any more than it can on a one-card post.
 */
function renderOneList({
  artifact,
  mentions,
}: {
  artifact: OneListArtifact;
  mentions: ResolvedMentions;
}): SlackDripMessagePayload {
  const lead: RichTextSection = {
    elements: [...artifact.lead.map((run) => renderDripRun({ mentions, run })), { text: LIST_LEAD_GAP, type: "text" }],
    type: "rich_text_section",
  };
  const lists = listRuns({ artifact }).map(({ depth, items }): RichTextBlockElement => ({
    elements: items.map((runs) => ({
      elements: runs.map((run) => renderDripRun({ mentions, run })),
      type: "rich_text_section" as const,
    })),
    // Slack's own nesting: a sub-point run is its own list one indent in, the shape its client sends.
    ...(depth === 0 ? {} : { indent: depth }),
    style: "bullet",
    type: "rich_text_list",
  }));
  const trailing: readonly RichTextSection[] = artifact.trailing.map((runs, position) => ({
    elements: [
      { text: position === 0 ? AFTER_LIST_GAP : PARAGRAPH_BREAK, type: "text" as const },
      ...runs.map((run) => renderDripRun({ mentions, run })),
    ],
    type: "rich_text_section" as const,
  }));
  return {
    blocks: [quoteMarkedLines({ block: { elements: [lead, ...lists, ...trailing], type: "rich_text" } })],
    form: "rich",
    // The notification fallback keeps the shape, exactly as the one-card's does, and for the same reason: it
    // is what a phone shows, and it is the string the paragraph-spacing gate reads. A dot point is spelled
    // with its own glyph here because the push preview has no list element to draw one with.
    text: [
      fallbackText({ mentions, runs: artifact.lead }),
      artifact.bullets
        .map((runs, index) => `${FALLBACK_GLYPHS[depthAt({ artifact, index })]}${fallbackText({ mentions, runs })}`)
        .join("\n"),
      ...artifact.trailing.map((runs) => fallbackText({ mentions, runs })),
    ].join(PARAGRAPH_BREAK),
    unfurl_links: AS_ME_UNFURLS,
    unfurl_media: AS_ME_UNFURLS,
  };
}

/**
 * Render an as-me artifact into the ORDERED list of messages to send.
 *
 * Total: every valid artifact yields a payload list, and the only throw is the shared renderer's refusal of
 * an unresolvable mention — which the caller has already made impossible by resolving every mentioned
 * person before it gets here.
 *
 * @param artifact the validated drip, one-card post, one-list roster, or plain-body escape hatch
 * @param mentions identity-map keys already resolved to Slack user ids
 * @returns the messages to send, in order; exactly one for a one-card post and for the escape hatch
 */
export function renderDrip({
  artifact,
  mentions,
}: {
  artifact: AsMeArtifact;
  mentions: ResolvedMentions;
}): readonly SlackDripMessagePayload[] {
  if (artifact.kind === "plain") {
    // The escape hatch: the owner's bytes, untouched. No escaping, no runs, no re-flow — `text` is what they typed.
    return [{ form: "plain", text: artifact.text, unfurl_links: AS_ME_UNFURLS, unfurl_media: AS_ME_UNFURLS }];
  }
  if (artifact.kind === "one-card") {
    return [renderOneCard({ lines: artifact.lines, mentions })];
  }
  if (artifact.kind === "one-list") {
    return [renderOneList({ artifact, mentions })];
  }
  return artifact.messages.map((message) => renderDripMessage({ mentions, runs: message.runs }));
}
