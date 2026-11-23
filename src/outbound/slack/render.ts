/**
 * The Slack CARD renderer — pure, deterministic, and the only place the measured anatomy lives.
 *
 * The anatomy was transcribed from the raw JSON of confirmed messages and the fold MEASURED with a
 * twelve-variant matrix. Two results drive every decision here:
 *
 *  1. **The fold is a function of BLOCK COUNT ALONE: more than five blocks folds.** Content length is
 *     irrelevant — 2500 characters in three blocks does NOT fold, six trivial blocks DO. The wrapper
 *     is required (the same blocks at top level do not fold); the colour is not (it is identity, not
 *     mechanism). So the six-block shape is load-bearing, not decorative.
 *
 * **RETRACTED — point 1 above is FALSE as stated.** A THREE-block attachment folds: a real
 * policy DM carried `context`, `divider`, `section` with no `Details` label and rendered "Show more". Read
 * it back and count with `slopweaver slack read-thread <permalink>`. Length does not replace the rule
 * either: about 500 visible characters folded and 480 did not. What SURVIVES is the WRAPPER half — the
 * identical blocks posted at top level do not fold — and that is what `./noFold.ts` is built on. Five is
 * still where a card's chrome ends and its `detail` begins, which is all this file needs it for; it is not
 * a prediction about "Show more". Only a photograph of the rendered client is (`slopweaver slack shot`).
 *
 *  2. **Markdown is INERT inside `rich_text`.** `*x*` renders as literal asterisks. Emphasis exists
 *     only as `style: { bold, italic, code }` on a text element. There is nothing to escape here, and
 *     escaping would emit visible backslashes — so `escapeMrkdwn` must never be used on a rich_text
 *     run. It applies ONLY to the two mrkdwn `context` blocks.
 *
 * That second point is why mentions work. In mrkdwn you must escape authored text, and escaping
 * fights mentions because `<@U…>` is made of exactly the characters an escaper neutralises. Here a
 * mention is a structural element, so all seven mention x formatting probes passed. Do not "just use
 * mrkdwn for the simple case" — that reintroduces the entire bug class.
 *
 * Determinism matters beyond tidiness: PR5.2 edits a card by re-rendering the same artifact, so the
 * same input must produce byte-identical blocks. Nothing here reads a clock, the filesystem, or the
 * environment; mentions arrive already resolved.
 */
import type { KnownBlock, RichTextBlock, RichTextBlockElement, RichTextElement, RichTextSection } from "@slack/types";

import { type RawMarkupSpan, scanRawMarkup } from "../artifact/typedRuns.js";
import type {
  Citation,
  DetailBlock,
  IndexStyle,
  InlineRun,
  PrimaryLink,
  TextSpan,
  UpdateArtifact,
} from "../artifact/types.js";
import { quoteMarkedLines } from "./blockquote.js";
import { redactWrapper } from "./piiRedaction.js";
import { withSearchableFallback } from "./searchableFallback.js";
import type { SlackCardChrome, SlackCardMetadata, SlackCardPayload, SlackCardWrapper } from "./types.js";

/**
 * The literal unicode link character used in block 2. It is NOT a `:shortcode:` — `rich_text` does
 * not expand shortcodes, so a shortcode there would render as the literal text `:link:`. Block 0 is
 * mrkdwn and takes the opposite treatment. Getting either direction wrong shows raw text to a reader.
 */
export const PRIMARY_LINK_GLYPH = "🔗 ";

/**
 * The paragraph separator, and it is the ONLY thing that produces a blank line between paragraphs.
 *
 * Measured the hard way. Block structure does NOT create spacing: adjacent top-level `rich_text`
 * blocks and sibling sections inside one block render identically (probes P1/P2), and a newline left
 * TRAILING at a block boundary is stripped outright (probe G2 rendered exactly like the gapless G1).
 * A confirmed well-spaced reference message turned out to carry its whole detail as ONE text run
 * containing embedded `\n\n` — so the gap has to sit BETWEEN content, inside the section.
 *
 * Emitted as its own text element rather than appended to the preceding run: probe H2 proved the two
 * are equivalent, and a standalone element also works when a paragraph ends in a mention, link or
 * citation chip rather than text.
 */
const PARAGRAPH_GAP = "\n\n";

/**
 * The separator for a paragraph that FOLLOWS a bullet list. A list already ends with its own break,
 * so a full {@link PARAGRAPH_GAP} on top of it renders too large (probe H3) and none renders too
 * tight (probe I1). One newline was the version that looked right (probe I2).
 */
const AFTER_LIST_GAP = "\n";

/**
 * Everyone one send may address, already resolved: people by identity-map key, user GROUPS by the handle
 * their run names. Resolution happens BEFORE rendering, against two different indexes with two different
 * refusals — see `../../silver/mentionResolver.ts` and `../../silver/groupResolver.ts`.
 *
 * ONE value carrying both maps rather than two parameters threaded side by side, for the reason
 * `./mentionIndex.ts`'s `MentionResolution` already states about ids and origins: two things kept in
 * lockstep by convention desync, and here the symptom would be a card that renders a person where a team
 * was meant. Every intermediate signature says `mentions: ResolvedMentions` and none of them had to change
 * when groups arrived; only the places that BUILD one and the two that READ one did, which is exactly the
 * set the compiler should be pointing at.
 */
export interface ResolvedMentions {
  /** Identity-map key to Slack user id. */
  readonly people: ReadonlyMap<string, string>;
  /** User-group handle (as the run wrote it) to Slack subteam id. */
  readonly groups: ReadonlyMap<string, string>;
}

/** Nothing resolved — for a composer with no runs that address anybody. */
export const NO_MENTIONS: ResolvedMentions = { groups: new Map(), people: new Map() };

/** Raised when a mention cannot be resolved. Exact match only — never a guess at who was meant. */
export class UnresolvedMentionError extends Error {
  constructor({ person }: { person: string }) {
    super(`cannot resolve a mention for "${person}": no exact match in the identity map`);
    this.name = "UnresolvedMentionError";
  }
}

/** Raised when a user-group mention cannot be resolved. Same rule as a person: exact match, never a guess. */
export class UnresolvedGroupError extends Error {
  constructor({ handle }: { handle: string }) {
    super(`cannot resolve the user group "${handle}": no exact match in the structure index`);
    this.name = "UnresolvedGroupError";
  }
}

/**
 * Escape the mrkdwn control characters. ONLY valid for the two `context` blocks.
 *
 * @param text the raw text
 * @returns the escaped text. Do NOT use this on `rich_text` content, where markup is inert and escaping
 *   would show the escapes to the reader
 */
export function escapeMrkdwn({ text }: { text: string }): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * A text run's `style` object, or nothing at all.
 *
 * Emitted conditionally rather than as `style: {}` because the reference cards omit the key entirely
 * on unstyled runs, and an exact-value test compares the whole element.
 */
function styleFor({ run }: { run: TextSpan }): { style: { bold?: true; italic?: true; code?: true } } | object {
  const style = {
    ...(run.bold === true ? { bold: true as const } : {}),
    ...(run.italic === true ? { italic: true as const } : {}),
    ...(run.code === true ? { code: true as const } : {}),
  };
  return Object.keys(style).length === 0 ? {} : { style };
}

/** Resolve a person to a Slack user id, or refuse. Exact match only — never a nearest guess. */
function resolveMention({ mentions, person }: { mentions: ResolvedMentions; person: string }): string {
  const userId = mentions.people.get(person);
  if (userId === undefined) {
    throw new UnresolvedMentionError({ person });
  }
  return userId;
}

/** Resolve a user group to a Slack subteam id, or refuse. Same discipline as {@link resolveMention}. */
function resolveGroup({ mentions, handle }: { mentions: ResolvedMentions; handle: string }): string {
  const groupId = mentions.groups.get(handle);
  if (groupId === undefined) {
    throw new UnresolvedGroupError({ handle });
  }
  return groupId;
}

/** A `[n]` chip as a labelled link. A chip pointing at nothing is a defect, not a silent omission. */
function citationLink({
  citationId,
  citations,
}: {
  citationId: string;
  citations: readonly Citation[];
}): RichTextElement {
  const citation = citations.find((entry) => entry.id === citationId);
  if (citation === undefined) {
    throw new Error(`citation chip references unknown citation "${citationId}"`);
  }
  return { text: citation.label, type: "link", url: citation.url };
}

/**
 * One inline run as a `rich_text` element. Pure; throws on an unresolvable mention ({@link
 * UnresolvedMentionError}, from {@link resolveMention}) or an unknown citation id (from {@link
 * citationLink}, reached through the `citation` case below) — both are caller bugs, not user input: a
 * form's citation runs and mention runs are meant to be validated against its own `citations` array and the
 * roster before this ever renders, the same way `resolveArtifactMentions` in the update-card lifecycle does
 * for mentions today.
 *
 * Exported for the AS-ME drip renderer (`./dripRender.ts`), which is the SECOND renderer over the same run
 * vocabulary — the architecture note's condition for extracting a shared helper is "from two working
 * implementations, never in advance from zero", and this is that second one. Everything above it (the
 * chrome, the wrapper, the fold, the paragraph gaps) stays card-only.
 *
 * @param run the inline run to render
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param citations the artifact's citations, for a `[n]` chip
 * @returns the `rich_text` element
 */
export function renderRun({
  run,
  mentions,
  citations,
}: {
  run: InlineRun;
  mentions: ResolvedMentions;
  citations: readonly Citation[];
}): RichTextElement {
  switch (run.type) {
    case "text":
      return { text: run.text, type: "text", ...styleFor({ run }) };
    case "link":
      return { text: run.label, type: "link", url: run.url, ...(run.bold === true ? { style: { bold: true } } : {}) };
    case "mention":
      return { type: "user", user_id: resolveMention({ mentions, person: run.person }) };
    case "group":
      return { type: "usergroup", usergroup_id: resolveGroup({ handle: run.handle, mentions }) };
    case "broadcast":
      return { range: run.range, type: "broadcast" };
    case "citation":
      return citationLink({ citationId: run.citationId, citations });
  }
}

/**
 * A literal string as the `rich_text` elements it deserves — bare URLs, `<@U…>`, `<#C…>`, `<!subteam^S…>`
 * and `<!here>`/`<!channel>` promoted to the elements Slack actually renders, everything else left alone.
 *
 * For the two Slack composers that build a `rich_text` section from a joined STRING rather than from an
 * artifact form — the progress frame's body and the turn checklist's body, both of which deliberately join
 * their lines into one element because block structure creates no spacing. Neither fills a form, so neither
 * gets `../artifact/typedRuns.ts`'s conversion, and without this the send door would refuse them with no
 * way to comply.
 *
 * It converts a CHANNEL and a USER GROUP too, which the artifact vocabulary cannot express: at this layer
 * there is no roster to consult and no key to resolve, so `<#C…>` is simply the element `{ type: "channel",
 * channel_id }`. Nothing is lost by typing it here and a reader stops seeing an id.
 *
 * Byte-identical to a single `{ text, type: "text" }` element when the string carries no markup at all,
 * which is what keeps every existing frame's bytes — and therefore its edit-vs-repost detection — unmoved.
 *
 * @param text the literal string a reader would otherwise see
 * @returns the elements to put in a `rich_text_section`, in order; never empty for a non-empty string
 */
export function typedTextElements({ text }: { text: string }): readonly RichTextElement[] {
  const spans = scanRawMarkup({ text });
  if (spans.length === 0) {
    return [{ text, type: "text" }];
  }
  const elements: RichTextElement[] = [];
  let cursor = 0;
  const keep = ({ end }: { end: number }): void => {
    const slice = text.slice(cursor, end);
    if (slice.length > 0) {
      elements.push({ text: slice, type: "text" });
    }
  };
  for (const span of spans) {
    keep({ end: span.start });
    elements.push(slackElementFor({ span }));
    cursor = span.start + span.raw.length;
  }
  keep({ end: text.length });
  return elements;
}

/** One raw-markup span as its Slack element. Total over the span union — a new kind fails to compile. */
function slackElementFor({ span }: { span: RawMarkupSpan }): RichTextElement {
  switch (span.kind) {
    case "url":
      return { text: span.label, type: "link", url: span.url };
    case "user":
      return { type: "user", user_id: span.slackId };
    case "broadcast":
      return { range: span.range, type: "broadcast" };
    case "channel":
      return { channel_id: span.raw.slice(2, -1).split("|")[0]!, type: "channel" };
    case "usergroup":
      return { type: "usergroup", usergroup_id: span.raw.slice("<!subteam^".length, -1).split("|")[0]! };
  }
}

/** A run sequence as one `rich_text_section`. */
function renderSection({
  runs,
  mentions,
  citations,
}: {
  runs: readonly InlineRun[];
  mentions: ResolvedMentions;
  citations: readonly Citation[];
}): RichTextSection {
  return { elements: runs.map((run) => renderRun({ citations, mentions, run })), type: "rich_text_section" };
}

/**
 * A list of items with NO Slack-drawn bullet — each its own `rich_text_section`, joined by a single embedded
 * newline rather than a `rich_text_list` wrapper. Every sibling `rich_text_section` inside one block needs an
 * embedded character to get visual separation at all; nothing here is automatic, which is the same fact
 * `paragraphGaps` already trades on for `\n`/`\n\n` between other block kinds. ONE newline (not two) is the
 * tighter, list-like spacing — the same visual weight a bulleted list already has, minus the bullet.
 *
 * Returned as an array of sections rather than one element, so a caller can splice them into a growing
 * `rich_text` block's `elements` alongside other content at no extra block cost — the whole reason a card
 * with its own lead glyph (a citation chip, a severity dot) does not also want Slack's bullet competing with it.
 *
 * @param items the run sequences, one per line
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param citations the artifact's citations, for a `[n]` chip
 * @returns the items, each as its own section, with newline separators embedded rather than a list wrapper
 */
function renderPlainList({
  items,
  mentions,
  citations,
}: {
  items: readonly (readonly InlineRun[])[];
  mentions: ResolvedMentions;
  citations: readonly Citation[];
}): readonly RichTextSection[] {
  return items.map((item, position) =>
    renderSection({
      citations,
      mentions,
      runs: position === items.length - 1 ? item : [...item, { text: "\n", type: "text" }],
    }),
  );
}

/** A cell is a whole `RichTextBlock`, which is what the table block's row type requires. */
function renderCell({
  runs,
  mentions,
  citations,
}: {
  runs: readonly InlineRun[];
  mentions: ResolvedMentions;
  citations: readonly Citation[];
}): RichTextBlock {
  return { elements: [renderSection({ citations, mentions, runs })], type: "rich_text" };
}

/**
 * A BLANK column header, as the one thing Slack will accept in a header cell that shows nothing.
 *
 * A `rich_text` text element requires a non-empty `text` — the schema permits `columns: ["", …]` (a severity
 * column has nothing useful to call itself) but `{ text: "", type: "text" }` is not a legal element to send.
 * So a blank header renders as a single space: the narrowest thing that is both valid and invisible. Emitting
 * an empty `elements: []` section instead would be the tidier encoding and is deliberately NOT used — it is
 * untested against the real API, and this renderer's whole premise is that its anatomy is measured.
 */
const BLANK_HEADER = " ";

/** A table as its own top-level block, with the column headers as the first row. */
function renderTable({
  block,
  mentions,
  citations,
}: {
  block: Extract<DetailBlock, { type: "table" }>;
  mentions: ResolvedMentions;
  citations: readonly Citation[];
}): KnownBlock {
  return {
    ...(block.columnSettings !== undefined
      ? {
          column_settings: block.columnSettings.map((setting) => ({
            ...(setting.align !== undefined ? { align: setting.align } : {}),
            ...(setting.wrap !== undefined ? { is_wrapped: setting.wrap } : {}),
          })),
        }
      : {}),
    rows: [
      block.columns.map((column) =>
        renderCell({ citations, mentions, runs: [{ text: column === "" ? BLANK_HEADER : column, type: "text" }] }),
      ),
      ...block.rows.map((row) => row.map((cell) => renderCell({ citations, mentions, runs: cell }))),
    ],
    type: "table",
  };
}

/**
 * The paragraph spacing rules, all four measured by eye in the bot DM. They are ASYMMETRIC, which is
 * the whole reason they are stated here rather than inferred at the call site:
 *
 * | boundary | separator | probe |
 * |---|---|---|
 * | paragraph -> paragraph | trailing `\n\n` | H1 / H2 |
 * | paragraph -> bullets   | trailing `\n\n` | H3 |
 * | bullets -> paragraph   | LEADING `\n` (single) | I2 beat I1 |
 * | anything -> table      | none — the block closes and a trailing newline would be stripped | T1 / G2 |
 *
 * A list already supplies its own break, so a full `\n\n` after one renders visibly too large (H3),
 * and none at all renders too tight (I1). One newline is the middle that looked right.
 */
function paragraphGaps({ previous, next }: { previous: DetailBlock | undefined; next: DetailBlock | undefined }): {
  readonly lead: string | undefined;
  readonly trail: string | undefined;
} {
  return {
    lead: previous?.type === "bullets" || previous?.type === "list" ? AFTER_LIST_GAP : undefined,
    trail: next !== undefined && next.type !== "table" ? PARAGRAPH_GAP : undefined,
  };
}

/**
 * The detail sequence as top-level blocks.
 *
 * Paragraphs and bullet lists GROUP into one `rich_text` block, because that is where an embedded
 * `\n\n` actually produces a paragraph gap. A table cannot nest inside `rich_text` (probe T1
 * rendered as eight blocks: rich_text, table, rich_text), so a table closes the current block, emits
 * itself, and opens a new one. Everything from index 5 onward sits below the fold regardless of how
 * many blocks this produces.
 *
 * Exported for `../assistant/answerMessage.ts`, the SECOND caller of this exact sequence — the bot's own
 * top-level answer message, which carries the same detail content as the card with the wrapper chrome
 * stripped. A re-export is the whole point: reimplementing the grouping/table-split/paragraph-gap logic a
 * second time is exactly the measured behaviour this module's header says must not be re-derived.
 *
 * @param detail the artifact's detail sequence, in order
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param citations the artifact's citations, for a `[n]` chip
 * @returns the detail rendered as top-level blocks
 */
export function renderDetail({
  detail,
  mentions,
  citations,
}: {
  detail: readonly DetailBlock[];
  mentions: ResolvedMentions;
  citations: readonly Citation[];
}): readonly KnownBlock[] {
  const blocks: KnownBlock[] = [];
  let group: RichTextBlock["elements"] = [];
  const flush = (): void => {
    if (group.length > 0) {
      blocks.push(quoteMarkedLines({ block: { elements: group, type: "rich_text" } }));
      group = [];
    }
  };
  detail.forEach((block, index) => {
    if (block.type === "table") {
      flush();
      blocks.push(renderTable({ block, citations, mentions }));
      return;
    }
    if (block.type === "bullets") {
      group.push({
        elements: block.items.map((item) => renderSection({ citations, mentions, runs: item })),
        style: "bullet",
        type: "rich_text_list",
      });
      return;
    }
    if (block.type === "list") {
      group.push(...renderPlainList({ citations, items: block.items, mentions }));
      return;
    }
    const { lead, trail } = paragraphGaps({ next: detail[index + 1], previous: detail[index - 1] });
    const runs: InlineRun[] = [
      ...(lead === undefined ? [] : [{ text: lead, type: "text" as const }]),
      ...block.runs,
      ...(trail === undefined ? [] : [{ text: trail, type: "text" as const }]),
    ];
    group.push(renderSection({ citations, mentions, runs }));
  });
  flush();
  return blocks;
}

/**
 * Block 2 — the ONLY content block above the fold, and therefore where anything a reader must see
 * without expanding has to live.
 *
 * It carries the TL;DR, the optional primary link as the HEAD of that same section (glyph, labelled link,
 * newline, prose), and the optional INDEX as a bullet list.
 *
 * The index is a sibling element of the TL;DR's section inside ONE block, not a block of its own, and that is
 * the entire mechanism: the fold is a function of block count alone, so a second block here would push the
 * detail label to index 5 and fold it, while the list-inside-a-block costs nothing. Grouping a list with a
 * section in one `rich_text` block is the same thing `renderDetail` already does, so it is not a new claim
 * about Slack — only a new place to apply it.
 *
 * The gap between the prose and the list uses the measured paragraph -> bullets rule (trailing `\n\n`, probe
 * H3), appended to whichever text element ends the section so it sits INSIDE the content rather than trailing
 * at a boundary where it would be stripped.
 *
 * Exported for `../assistant/answerMessage.ts`, which reuses this SAME block — via {@link renderChromeBlocks}
 * — as the bot's own answer message's lead content: the TL;DR/primary-link/index anatomy is measured
 * content, not card chrome, so it renders identically whether the caller is the operator card or the bot's
 * own answer.
 *
 * @param intro a scheduled post's day-one opening lines, drawn above everything else; empty on every other post
 * @param tldr the headline prose
 * @param primaryLink the one canonical link the message is about, or undefined
 * @param index the above-the-fold bullet index, one item per independently-clickable line
 * @param indexStyle `bullet` (default) for Slack's own bullet, `plain` for no added glyph — a card whose own
 *   lead run already leads every line — or `ordered` for Slack's own numbered list
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param citations the artifact's citations, for a `[n]` chip
 * @returns the lead content as one `rich_text` block
 */
export function renderLeadBlock({
  intro = [],
  tldr,
  primaryLink,
  index,
  indexStyle,
  mentions,
  citations,
}: {
  intro?: readonly string[] | undefined;
  tldr: string;
  primaryLink: PrimaryLink | undefined;
  index: readonly (readonly InlineRun[])[];
  indexStyle: IndexStyle;
  mentions: ResolvedMentions;
  citations: readonly Citation[];
}): RichTextBlock {
  const trail = index.length === 0 ? "" : PARAGRAPH_GAP;
  const lead: RichTextElement[] =
    primaryLink === undefined
      ? [{ text: `${tldr}${trail}`, type: "text" }]
      : [
          { text: PRIMARY_LINK_GLYPH, type: "text" },
          { text: primaryLink.label, type: "link", url: primaryLink.url },
          { text: `${PARAGRAPH_GAP}${tldr}${trail}`, type: "text" },
        ];
  const opening: RichTextElement[] =
    intro.length === 0 ? [] : [{ text: `${intro.join("\n")}${PARAGRAPH_GAP}`, type: "text" }];
  const section: RichTextSection = { elements: [...opening, ...lead], type: "rich_text_section" };
  // An empty index renders as no elements at all, which the plain form already produces.
  const plainIndex = index.length === 0 || indexStyle === "plain";
  const indexElements: readonly RichTextBlockElement[] = plainIndex
    ? renderPlainList({ citations, items: index, mentions })
    : [
        {
          elements: index.map((item) => renderSection({ citations, mentions, runs: item })),
          style: indexStyle === "ordered" ? "ordered" : "bullet",
          type: "rich_text_list",
        },
      ];
  return quoteMarkedLines({ block: { elements: [section, ...indexElements], type: "rich_text" } });
}

/** The fixed chrome around one caller-owned above-fold content block. */
function renderChromeFrameBlocks({
  chrome,
  content,
}: {
  chrome: SlackCardChrome;
  content: KnownBlock;
}): readonly KnownBlock[] {
  return [
    {
      elements: [
        {
          text: `${chrome.authorEmoji}  *${escapeMrkdwn({ text: chrome.authorLabel })}*`,
          type: "mrkdwn",
        },
      ],
      type: "context",
    },
    { type: "divider" },
    content,
    { type: "divider" },
    { elements: [{ text: chrome.detailLabel, type: "mrkdwn" }], type: "context" },
  ];
}

/**
 * Wrap one bot-authored message in the canonical full chrome.
 *
 * @param chrome the configured bot identity, banner and details label
 * @param content the one content block that must remain above the fold
 * @param details the blocks that belong below the Details label
 * @param fallback the notification, sidebar-preview and screen-reader text
 * @returns one legacy wrapper carrying the complete configured chrome
 */
export function renderFullChromeWrapper({
  chrome,
  content,
  details,
  fallback,
}: {
  chrome: SlackCardChrome;
  content: KnownBlock;
  details: readonly KnownBlock[];
  fallback: string;
}): SlackCardWrapper {
  const blocks = [...renderChromeFrameBlocks({ chrome, content }), ...details];
  return redactWrapper({
    wrapper: withSearchableFallback({ wrapper: { blocks, color: chrome.bannerColor, fallback } }),
  });
}

/**
 * Blocks 0-4: the fixed chrome — author row, divider, lead, divider, detail label. Identical on every
 * card, with only the lead content varying.
 *
 * Exported for `../assistant/answerMessage.ts`, which reuses this exact function to give the bot's own
 * answer messages the same full chrome the operator card carries, now that the owner wants both surfaces
 * reading identically. This function has no effect beyond returning blocks — no state mutation, no Slack
 * call — so reusing it (rather than routing the answer path through {@link renderUpdateCard} itself) is
 * what lets the answer path pick up the chrome without inheriting anything else `renderUpdateCard` does.
 *
 * @param chrome the operator's card chrome, from `profile.json`
 * @param intro a scheduled post's day-one opening lines, or none
 * @param tldr the headline prose
 * @param primaryLink the one canonical link the message is about, or undefined
 * @param index the above-the-fold bullet index, one item per independently-clickable line
 * @param indexStyle `bullet` (default) for Slack's own bullet, `plain` for no added glyph, `ordered` for numbers
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param citations the artifact's citations, for a `[n]` chip
 * @returns the five fixed blocks: author row, divider, lead, divider, detail label
 */
export function renderChromeBlocks({
  chrome,
  intro = [],
  tldr,
  primaryLink,
  index,
  indexStyle,
  mentions,
  citations,
}: {
  chrome: SlackCardChrome;
  intro?: readonly string[] | undefined;
  tldr: string;
  primaryLink: PrimaryLink | undefined;
  index: readonly (readonly InlineRun[])[];
  indexStyle: IndexStyle;
  mentions: ResolvedMentions;
  citations: readonly Citation[];
}): readonly KnownBlock[] {
  return renderChromeFrameBlocks({
    chrome,
    content: renderLeadBlock({ citations, index, indexStyle, intro, mentions, primaryLink, tldr }),
  });
}

/**
 * Render an `update` artifact into the measured Slack card.
 *
 * @param artifact the validated artifact
 * @param chrome the operator's card chrome, from profile.json
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param artifactFingerprint the stable content hash recorded in metadata for PR5.2
 * @returns the exact `chat.postMessage` arguments, minus the channel
 */
export function renderUpdateCard({
  artifact,
  chrome,
  mentions,
  artifactFingerprint,
}: {
  artifact: UpdateArtifact;
  chrome: SlackCardChrome;
  mentions: ResolvedMentions;
  artifactFingerprint: string;
}): SlackCardPayload {
  const blocks: KnownBlock[] = [
    ...renderChromeBlocks({
      chrome,
      citations: artifact.citations,
      index: artifact.index,
      indexStyle: artifact.indexStyle ?? "bullet",
      intro: artifact.intro,
      mentions,
      primaryLink: artifact.primaryLink,
      tldr: artifact.tldr,
    }),
    ...renderDetail({ citations: artifact.citations, detail: artifact.detail, mentions }),
  ];
  const wrapper = withSearchableFallback({
    wrapper: { blocks, color: chrome.bannerColor, fallback: artifact.tldr },
  });
  const metadata: SlackCardMetadata = {
    event_payload: {
      artifactFingerprint,
      artifactKind: "update",
      renderer: "slack-card-v1",
      schemaVersion: 1,
    },
    event_type: chrome.metadataEventType,
  };
  return redactCardPii({
    payload: { attachments: [wrapper], metadata, text: "", unfurl_links: false, unfurl_media: false },
  });
}

/**
 * Run the outbound PII pass over a rendered card.
 *
 * Here rather than at each send path, because this is the one function every card crosses — the same reason
 * the walk in {@link ./piiRedaction.redactPayload} is over the rendered payload rather than over the typed
 * form. The rule is that the read path is deliberately unmasked so an investigation is not
 * hindered, and the redaction lands at the post, which is where an audience appears.
 *
 * The cast back to {@link SlackCardPayload} is the one place a structural walk meets a literal type: the
 * walk preserves every key and every non-string value, so the `text: ""` literal and the one-element
 * `attachments` tuple survive it unchanged — but `unknown` in cannot prove that to the compiler, and a
 * redactor generic enough to preserve the type would be a type-level rewrite of a twelve-line walk.
 *
 * @param payload the rendered card
 * @returns the same card with its strings redacted
 */
function redactCardPii({ payload }: { payload: SlackCardPayload }): SlackCardPayload {
  return redactWrapper({ wrapper: payload });
}
