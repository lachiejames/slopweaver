/**
 * How Slack lays out one as-me message under its text — the rules the queue card's draft follows, each one read
 * off Slack's own render rather than guessed.
 *
 * The draft the owner sees must look 100% like what Slack will draw, so the rules below were MEASURED by posting three
 * drafts to the owner's own self-DM through the as-me door and photographing Slack's render with `slopweaver
 * slack shot`:
 *
 * - ONE image and nothing else: a `F0C48KM8VAB.png ▾` caption line, then the image at its own aspect.
 * - THREE images: `3 attachments ▾ | Download all`, then one row of equal cropped tiles.
 * - ONE image and two Linear links: `3 attachments ▾` with no Download all — an unfurl counts as an attachment —
 *   then the image, then one compact card per issue: the Linear mark, the issue title, `Issue JJJJ-1669 in Linear`.
 * - A Datadog console link (on this install's site) draws nothing under the message.
 * - A section ending in `\n\n` draws Slack's short paragraph break, not a whole blank line.
 *
 * A host none of those measured is NOT drawn as an unfurl, and not silently either: {@link predictedUnfurls} names
 * it, so the card can say it cannot promise what Slack will add under that link.
 *
 * Imports only the pure emoji module. Pure: addresses and names in, a layout out.
 */

import { dateTimeFormatOf } from "./dateTimeFormat";
import { type EmojiPiece, emojiPieces, linkLabelPieces } from "./slackEmoji";

/** What Slack draws under one link, per the measured rules above. */
export type PredictedUnfurl =
  | { readonly kind: "linear-issue"; readonly url: string; readonly key: string }
  | { readonly kind: "unmeasured"; readonly url: string; readonly host: string };

/** A Linear issue address, and the key it names: `linear.app/<workspace>/issue/JJJJ-1683/<slug>`. */
const LINEAR_ISSUE = /^\/[^/]+\/issue\/([A-Z][A-Z0-9]*-\d+)(?:\/|$)/u;

/** The hosts measured to draw nothing under a link — Datadog's consoles sit behind a sign-in. */
const NO_UNFURL_HOST = /(?:^|\.)datadoghq\.(?:com|eu)$/u;

/**
 * What Slack will draw under each distinct link of a message, in the order the links first appear.
 *
 * @param urls every link address in the message, repeats included
 * @returns one entry per link that draws something or might, never one for a link measured to draw nothing
 */
export function predictedUnfurls({ urls }: { urls: readonly string[] }): readonly PredictedUnfurl[] {
  const out: PredictedUnfurl[] = [];
  for (const url of new Set(urls)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      continue;
    }
    if (NO_UNFURL_HOST.test(parsed.hostname)) {
      continue;
    }
    const issue = parsed.hostname === "linear.app" ? LINEAR_ISSUE.exec(parsed.pathname) : null;
    const key = issue?.at(1);
    if (key !== undefined) {
      out.push({ key, kind: "linear-issue", url });
      continue;
    }
    out.push({ host: parsed.hostname, kind: "unmeasured", url });
  }
  return out;
}

/** The line Slack draws above a message's attachments. */
export interface AttachmentsHeader {
  readonly text: string;
  /** Slack offers "Download all" only when there is more than one FILE to download. */
  readonly downloadAll: boolean;
}

/**
 * The line above a message's attachments: the file's own name when it is the only thing attached, else how many
 * attachments there are, unfurls counted in.
 *
 * @param files the attached files' names, in attach order
 * @param unfurls how many unfurls Slack will draw
 * @returns the line, or `undefined` when nothing is attached or the only attachment is an unfurl
 */
export function attachmentsHeader({
  files,
  unfurls,
}: {
  files: readonly string[];
  unfurls: number;
}): AttachmentsHeader | undefined {
  const total = files.length + unfurls;
  const only = files.at(0);
  if (total === 1 && only !== undefined) {
    return { downloadAll: false, text: only };
  }
  if (total <= 1) {
    return undefined;
  }
  return { downloadAll: files.length > 1, text: `${String(total)} attachments` };
}

/** How the card draws one attached file: as the picture, as a playing video, or as a file card. */
export type DrawnAs = "image" | "video" | "file";

/**
 * Extensions the card draws as a picture. `slack draft record` refuses a draft whose attachment's name and bytes
 * disagree with this and the route's signatures (`src/outbound/slack/draftFidelity.ts`), so a name here is bytes
 * the route serves.
 */
const IMAGE_NAME = /\.(?:png|jpe?g|gif|webp|bmp)$/iu;

/** Extensions admission carries as a moving picture. */
const VIDEO_NAME = /\.(?:mp4|mov|m4v)$/iu;

/**
 * How one attached file is drawn, by the name Slack shows — the same name Slack reads its file type from.
 *
 * @param name the attached file's name
 * @returns image, video, or file
 */
export function drawnAs({ name }: { name: string }): DrawnAs {
  if (IMAGE_NAME.test(name)) {
    return "image";
  }
  if (VIDEO_NAME.test(name)) {
    return "video";
  }
  return "file";
}

/**
 * One text run split at its paragraph breaks — the `\n\n` the sender embeds at the end of a section
 * (`src/outbound/slack/render.ts`, PARAGRAPH_GAP), which Slack draws as a short gap rather than a blank line.
 *
 * @param text the run's text
 * @returns the pieces between breaks, in order; one piece when the run carries none
 */
export function paragraphPieces({ text }: { text: string }): readonly string[] {
  return text.split(/\n\n/u);
}

/**
 * What one stretch of a draft's text draws as: its standard shortcodes as emoji, as Slack draws them, unless it is
 * code. Code is a run styled as inline code, or ANY run in a code block — a preformatted block or a mrkdwn fence, whose
 * runs carry no code style of their own because the frame is what makes them code. Slack leaves code as written.
 *
 * @param code the run's own inline-code style
 * @param frame the box the run's line sits in — `code` for a preformatted block or a fence
 * @returns the pieces to draw: the text whole when it is code, an empty list for empty text
 */
export function draftTextPieces({
  text,
  code,
  frame,
}: {
  text: string;
  code: boolean;
  frame: "quote" | "code" | undefined;
}): readonly EmojiPiece[] {
  if (!code && frame !== "code") {
    return emojiPieces({ text });
  }
  if (text.length === 0) {
    return [];
  }
  return [{ kind: "text", text }];
}

/**
 * What one link's label draws as: an authored label's standard shortcodes as emoji, as Slack draws them in a rich-text
 * link, while a bare address and any link inside a code block stay exactly as written.
 *
 * @param label the words the link shows — its address when the author wrote none
 * @param url the address the link opens
 * @param frame the box the link's line sits in — `code` for a preformatted block or a fence
 * @returns the pieces to draw, an empty list for an empty label
 */
export function draftLinkPieces({
  label,
  url,
  frame,
}: {
  label: string;
  url: string;
  frame: "quote" | "code" | undefined;
}): readonly EmojiPiece[] {
  if (frame === "code") {
    return draftTextPieces({ code: true, frame, text: label });
  }
  return linkLabelPieces({ href: url, label });
}

/**
 * The time beside a message's author, the way Slack writes it in an English client: `9:29 AM`.
 *
 * @param iso the instant
 * @param timeZone the reader's zone — the browser's own when the card draws it
 * @returns the clock time
 */
export function slackClock({ iso, timeZone }: { iso: string; timeZone: string }): string {
  return dateTimeFormatOf({ locale: "en-US", options: { hour: "numeric", minute: "2-digit", timeZone } }).format(
    new Date(iso),
  );
}
