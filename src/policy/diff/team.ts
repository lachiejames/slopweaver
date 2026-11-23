/**
 * What the team gets from a diff record: their page, and the post that points at it.
 *
 * Both come from the same record as the owner's page (`./render.ts`), so the two can never tell different stories:
 * the page shows each document as Vanta will hold it with every explained line's reason on hover, and the post is
 * the Slack mrkdwn the owner sends once the documents are uploaded.
 *
 * Pure.
 */
import { escapeText } from "../../outbound/briefing/escape.js";
import { MARKDOWN_LINK, postLinkText } from "./link.js";
import type { DocDiffModel, DocumentDiff } from "./model.js";
import { note, pageHead, plainUnit, postHtml, prose, slotLine, tabs } from "./pageParts.js";

/** One document as Vanta will hold it, each explained line carrying its reason on hover. */
function teamDocument({ diff, model }: { diff: DocumentDiff; model: DocDiffModel }): string {
  const images = model.images;
  const cells = diff.rows
    .filter((row) => row.after.length > 0)
    .map((row) => {
      const body = row.after.map((unit) => plainUnit({ images, unit })).join("");
      if (row.change === null) {
        return `<div class="cell">${body}</div>`;
      }
      const lines = [`<span class="k"><b>Why</b>${prose({ images, text: row.change.why })}</span>`];
      return `<div class="cell explained has-note" tabindex="0">${body}${note({ lines })}</div>`;
    })
    .join("\n");
  return [
    `<h2>${escapeText({ text: diff.document.name })}</h2>`,
    `<p class="meta">${slotLine({ diff })}. A shaded line says why on hover.</p>`,
    `<div class="doc">\n${cells}\n</div>`,
  ].join("\n");
}

/**
 * The team's page: the post, then each document as Vanta will hold it, with the reasoning on hover.
 *
 * @param model the built diff
 * @returns the fragment
 */
export function renderTeamPage({ model }: { model: DocDiffModel }): string {
  const group = "team-tab";
  const entries = model.documents.map((diff) => ({
    body: teamDocument({ diff, model }),
    count: "",
    label: diff.document.name,
  }));
  return [
    pageHead({ count: entries.length, group, title: model.record.team.title }),
    `<p class="eyebrow">For the team</p>`,
    `<h1>${escapeText({ text: model.record.team.title })}</h1>`,
    postHtml({ model }),
    tabs({ entries, group }),
  ].join("\n");
}

/**
 * Text as Slack reads it literally: its three control characters escaped, so the record cannot write a link, a
 * mention or a `<!channel>` of its own — only {@link mrkdwn}'s links, whose addresses the record's checks have read.
 */
function slackText({ text }: { text: string }): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Inline markdown as Slack mrkdwn: everything else escaped, links as `<url|text>` — read by the same pattern the
 * address checks read ({@link MARKDOWN_LINK}), so a link here is always one they read — an image as its caption, and
 * bold as single asterisks.
 */
function mrkdwn({ text }: { text: string }): string {
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const words = slackText({ text: match[2]! });
    const url = slackText({ text: match[3]! }).replace(/\|/g, "%7C");
    const printed = postLinkText({ image: match[1] === "!", words });
    let rendered = `<${url}|${words}>`;
    if (printed !== null) {
      rendered = printed;
    }
    out += `${slackText({ text: text.slice(cursor, match.index) })}${rendered}`;
    cursor = match.index + match[0].length;
  }
  return `${out}${slackText({ text: text.slice(cursor) })}`.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

/**
 * The team post, as the Slack mrkdwn it is sent in: the opener with each document linked, three key changes, the
 * ask — one paragraph each, a blank line between, which is the spacing an `--as me` send requires.
 *
 * @param model the built diff
 * @returns the post text
 */
export function renderTeamPost({ model }: { model: DocDiffModel }): string {
  const documents = model.documents
    .map((diff) => `<${diff.slotUrl}|${slackText({ text: diff.document.name })}>`)
    .join(" and ");
  const keys = model.record.keyChanges.map((key) => `• ${mrkdwn({ text: key })}`);
  return [
    `${mrkdwn({ text: model.record.team.opener })} ${documents}`,
    ["key changes:", ...keys].join("\n"),
    mrkdwn({ text: model.record.team.ask }),
  ].join("\n\n");
}
