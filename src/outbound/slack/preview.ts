/**
 * A READABLE rendering of the card that is about to be sent. Pure.
 *
 * `--dry-run` used to report block COUNTS and the API steps, and nothing else — on a PR whose entire
 * premise is a measured render. You could not proof-read the wording, see where the bold landed, check that
 * a paragraph gap came out as a gap, or see what sits above the fold, without posting it for real. So this
 * turns the RENDERED PAYLOAD (never the artifact) back into lines a human reads: what is previewed is
 * therefore exactly what will go on the wire, blocks, spacing and all.
 *
 * Deliberate choices:
 *
 * - **Emphasis is shown as `[b]…[/b]`, not `*…*`.** Markdown is INERT inside `rich_text`, so a literal
 *   asterisk in the prose is a real (and warned-about) mistake. Previewing bold AS asterisks would make the
 *   mistake and the fix look identical — the one confusion this PR must not introduce.
 * - **Newlines inside a run become real line breaks.** The measured spacing rules put the paragraph gap
 *   INSIDE a text run as an embedded `\n\n`; collapsing that would hide the exact thing worth checking.
 * - **The card's own CHROME BOUNDARY is drawn — not the fold.** Blocks 0-4 are the chrome and block 5
 *   onward is behind the `Details` label. This preview deliberately does NOT predict "Show more": the
 *   block-count rule it used to predict it from is refuted by a THREE-block attachment
 *   that folds. Every card preview now says so on its second line ({@link FOLD_UNKNOWN_NOTICE}) and names
 *   the only thing that can answer — a photograph of the rendered client, `slopweaver slack shot`.
 */
import type { KnownBlock, RichTextBlock, RichTextElement, RichTextSection } from "@slack/types";

import type { SlackCardPayload, SlackNoFoldPayload } from "./types.js";

/**
 * How many blocks of a CARD are drawn before the "Show more" marker is placed in this preview.
 *
 * **It is a LAYOUT landmark, not a prediction, and this comment is a retraction.** It used to be documented
 * as the fold rule itself — "more than five blocks folds", measured A3 vs A4 — and the preview printed
 * `this card WILL NOT FOLD` for any payload under it. That claim is REFUTED. The message that forced the
 * no-fold form is a THREE-block attachment (`context`, `divider`, `section`, no `Details` label) and it
 * renders "Show more" in the owner's client; length does not explain it either, with about 500 visible characters
 * folding and 480 not. Reproduce by reading the message back and counting its blocks:
 *
 * ```bash
 * slopweaver slack read-thread <the permalink of the folded policy DM>
 * ```
 *
 * What five still IS: where the card's own chrome ends and its `detail` begins, which is what a reader of
 * this preview wants marked. So the marker stays and the CLAIM is gone — see {@link previewLines}, which no
 * longer tells anyone a card will not fold, because nothing in this repository can tell them that. Only a
 * photograph of the rendered client can (`slopweaver slack shot`).
 */
export const FOLD_AFTER_BLOCKS = 5;

/**
 * The caveat printed on every CARD preview, directly under the legend.
 *
 * At the TOP rather than the bottom, because it governs how the whole preview should be read: a reader who
 * only reaches the last line has already formed a view about the shape. It exists because the line it
 * replaces actively misled — `!! N blocks — this card WILL NOT FOLD` was printed from the block-count rule
 * retracted, so a card that folded in the owner's client previewed as one that could not.
 */
export const FOLD_UNKNOWN_NOTICE =
  "!! a card sits in an attachment wrapper, and this preview CANNOT tell you whether Slack will draw " +
  '"Show more" on it — a THREE-block attachment has been measured folding. Photograph it: ' +
  "`slopweaver slack shot <permalink> --out <file.png>`. A message that must not fold at all is " +
  '`{"kind":"no-fold"}`, which carries no wrapper.';

/** The legend, printed once, so no marker in the preview has to be guessed at. */
export const PREVIEW_LEGEND =
  "preview (legend: [b]bold[/b] [i]italic[/i] [c]code[/c] · <@U…> mention · <!here> broadcast · [label](url) link)";

/** The horizontal rule a `divider` block draws. */
const DIVIDER_LINE = "────────────────────";

/** Wrap text in the style markers its `style` flags imply, innermost first. */
function styled({ text, style }: { text: string; style: RichTextElement["style"] }): string {
  let out = text;
  if (style?.code === true) {
    out = `[c]${out}[/c]`;
  }
  if (style?.italic === true) {
    out = `[i]${out}[/i]`;
  }
  if (style?.bold === true) {
    out = `[b]${out}[/b]`;
  }
  return out;
}

/**
 * A link element's label as Slack draws it. `text` is optional on the wire, and a link sent without one is
 * drawn as its URL, so the preview shows the URL there too.
 */
function linkLabel({ link }: { link: Extract<RichTextElement, { type: "link" }> }): string {
  const { text } = link;
  if (text === undefined) {
    return link.url;
  }
  return text;
}

/** One inline element as readable text. An element type the renderer never emits shows as `[type]`. */
function previewElement({ element }: { element: RichTextElement }): string {
  if (element.type === "text") {
    return styled({ style: element.style, text: element.text });
  }
  if (element.type === "link") {
    return styled({ style: element.style, text: `[${linkLabel({ link: element })}](${element.url})` });
  }
  if (element.type === "user") {
    return `<@${element.user_id}>`;
  }
  if (element.type === "usergroup") {
    // The subteam ID rather than a bare `[usergroup]`: a reviewer reading a dry run has to be able to tell
    // WHICH team a card is about to address, and the id is the only thing the rendered element carries.
    return `<!subteam^${element.usergroup_id}>`;
  }
  if (element.type === "broadcast") {
    return `<!${element.range}>`;
  }
  if (element.type === "emoji") {
    return `:${element.name}:`;
  }
  return `[${element.type}]`;
}

/** A section's elements concatenated, then split on the newlines the runs carry. */
function sectionLines({ section }: { section: RichTextSection }): readonly string[] {
  const lines = section.elements
    .map((element) => previewElement({ element }))
    .join("")
    .split("\n");
  // ONE trailing empty line is dropped, because a section that ends in `\n` is separating itself from the
  // NEXT section and this preview already puts those on separate lines. Keeping it drew a blank line Slack
  // never renders — measured on a one-card post, whose two lines previewed double-spaced while the payload
  // carried a single `\n` (`slopweaver slack post --as me --shape top-level --form - --dry-run`). The
  // asymmetry is deliberate: `\n\n` (the card's paragraph gap) still leaves one empty line behind, which is
  // the blank line Slack DOES render there. Only the boundary itself is absorbed, never a real gap.
  return lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
}

/** The glyph Slack draws for a bullet at each nesting depth, cycling past the third. */
const PREVIEW_GLYPHS = ["•", "◦", "▪"] as const;

/** A list's nesting depth: its `indent`, or the top level when it carries none. */
function listDepth({ list }: { list: Extract<RichTextBlock["elements"][number], { type: "rich_text_list" }> }): number {
  if (list.indent === undefined) {
    return 0;
  }
  return list.indent;
}

/** One `rich_text` block: sections as paragraphs, lists as `•` items, or `1.` items when the list is ordered. */
function richTextLines({ block }: { block: RichTextBlock }): readonly string[] {
  return block.elements.flatMap((element) => {
    if (element.type === "rich_text_section") {
      return sectionLines({ section: element });
    }
    if (element.type === "rich_text_quote") {
      // Drawn with Slack's own marker, so the preview shows the quote bar the reader will see.
      return sectionLines({ section: { elements: element.elements, type: "rich_text_section" } }).map(
        (line) => `> ${line}`,
      );
    }
    if (element.type === "rich_text_list") {
      // A nested list is a sibling list one `indent` in: drawn further in, with Slack's next glyph.
      const depth = listDepth({ list: element });
      const pad = "  ".repeat(depth);
      return element.elements.flatMap((item, position) => {
        const marker = element.style === "ordered" ? `${String(position + 1)}.` : PREVIEW_GLYPHS[depth % 3]!;
        return sectionLines({ section: item }).map((line, index) =>
          index === 0 ? `${pad}${marker} ${line}` : `${pad}  ${line}`,
        );
      });
    }
    return [`[${element.type}]`];
  });
}

/** A table's cells, header row first, as pipe-delimited rows — the shape a reader can scan. */
function tableLines({ block }: { block: Extract<KnownBlock, { type: "table" }> }): readonly string[] {
  return block.rows.map(
    (row) =>
      `| ${row
        // A cell is either a `rich_text` block or a `raw_text` element, whose `text` is required.
        .map((cell) => (cell.type === "rich_text" ? richTextLines({ block: cell }).join(" ") : cell.text))
        .join(" | ")} |`,
  );
}

/**
 * One block as readable lines.
 *
 * Exported for the AS-ME drip preview, which shows the same rendered blocks with none of the card's
 * furniture around them — no legend of card chrome, and above all NO FOLD MARKER, because a drip has no
 * wrapper and therefore nothing to fold. Drawing a fold line a human message will never have would be
 * previewing a lie.
 *
 * @param block the rendered block
 * @returns the block as readable lines
 */
export function previewBlockLines({ block }: { block: KnownBlock }): readonly string[] {
  if (block.type === "divider") {
    return [DIVIDER_LINE];
  }
  if (block.type === "context") {
    return block.elements.map((element) =>
      element.type === "mrkdwn" || element.type === "plain_text" ? element.text : `[${element.type}]`,
    );
  }
  if (block.type === "rich_text") {
    return richTextLines({ block });
  }
  if (block.type === "table") {
    return tableLines({ block });
  }
  return [`[${block.type} block]`];
}

/**
 * The card as a human reads it, with the chrome boundary drawn and the fold left honestly unanswered.
 *
 * @param payload the rendered card, exactly as it would be posted
 * @returns the preview lines: the legend, the fold-unknown notice, and the blocks with the detail marker
 */
export function previewLines({ payload }: { payload: SlackCardPayload }): readonly string[] {
  const blocks = payload.attachments[0].blocks;
  const lines: string[] = [PREVIEW_LEGEND, FOLD_UNKNOWN_NOTICE];
  blocks.forEach((block, index) => {
    if (index === FOLD_AFTER_BLOCKS) {
      lines.push(`──── detail ──── (blocks ${String(FOLD_AFTER_BLOCKS)}+ are behind the Details label)`);
    }
    lines.push(...previewBlockLines({ block }));
  });
  return lines;
}

/**
 * A NO-FOLD message as a human reads it — the same renderer, with no fold marker and no attachment.
 *
 * Deliberately a sibling of {@link previewLines} rather than a parameter on it. The card preview's whole
 * job is to say where the chrome ends and what a reader may not see; this form has neither, so drawing
 * either landmark here would be previewing something the payload does not have — the same reason the drip
 * preview has never drawn a fold line.
 *
 * @param payload the rendered no-fold message, exactly as it would be posted
 * @returns the preview lines, including the legend
 */
export function noFoldPreviewLines({ payload }: { payload: SlackNoFoldPayload }): readonly string[] {
  return [
    PREVIEW_LEGEND,
    ...payload.blocks.flatMap((block) => previewBlockLines({ block })),
    `(notification fallback: ${JSON.stringify(payload.text)})`,
  ];
}
