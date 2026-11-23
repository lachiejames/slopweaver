/**
 * Mrkdwn text as lines and runs — fenced code kept literal — and a labelled address or a row of url buttons as links.
 */
import { type Bag, str, sub } from "../../lib/bag";
import { slackUnescaped } from "../../lib/slackEscapes";
import { mrkdwnSpans } from "../../lib/slackMrkdwn";
import { type DraftLine, type DraftRun, LINK_SCHEME } from "./readSlackDraftsRuns";

/** The `<!…>` broadcasts Slack draws as `@here`, `@channel` and `@everyone`. */
const BROADCASTS: ReadonlySet<string> = new Set(["here", "channel", "everyone"]);

/** One line of a message's mrkdwn `text` as runs: a mention, a channel, a link, code, bold and italic kept apart. */
function mrkdwnRuns({ text }: { text: string }): readonly DraftRun[] {
  const runs: DraftRun[] = [];
  for (const span of mrkdwnSpans({ labels: { labelFor: () => undefined }, text })) {
    if (span.kind === "mention" && span.userId.startsWith("subteam^")) {
      // The span reader folds `<!subteam^S…|@handle>` into a mention and keeps the handle, already unescaped, so the
      // chip can name the group as Slack does; the id is only ever its hover.
      runs.push({ groupId: span.userId.slice("subteam^".length), handle: span.handle, kind: "usergroup" });
    } else if (span.kind === "mention" && BROADCASTS.has(span.userId)) {
      runs.push({ kind: "broadcast", range: span.userId });
    } else if (span.kind === "mention") {
      runs.push({ kind: "user", userId: span.userId });
    } else if (span.kind === "channel") {
      runs.push({ channelId: span.channelId, kind: "channel" });
    } else if (span.kind === "link") {
      runs.push({
        kind: "link",
        label: slackUnescaped({ text: span.label }),
        url: slackUnescaped({ text: span.href }),
      });
    } else if ((span.kind === "bold" || span.kind === "italic") && span.text.includes("<")) {
      // An app's `*Excludes <url|8 staging commits>*` carries a link INSIDE the bold, which the span reader
      // leaves as text — read the inside again, and carry the emphasis onto each text run of it.
      for (const inner of mrkdwnRuns({ text: span.text })) {
        if (inner.kind === "text") {
          runs.push({
            ...inner,
            bold: inner.bold || span.kind === "bold",
            italic: inner.italic || span.kind === "italic",
          });
        } else {
          runs.push(inner);
        }
      }
    } else {
      runs.push({
        bold: span.kind === "bold",
        code: span.kind === "code",
        italic: span.kind === "italic",
        kind: "text",
        text: slackUnescaped({ text: span.text }),
      });
    }
  }
  return runs;
}

/** The fence Slack opens and closes a multi-line code block with. */
const FENCE = "```";

/**
 * Mrkdwn text as one line per line of it, none when it is blank. A ``` fenced block is code, drawn literally in
 * a code frame, never read as bold, italics or links — `SELECT *, count(*)` keeps its asterisks. A fence opens
 * and closes anywhere in a line, as Slack's does: `Query failed: ```SELECT …` is prose, then code.
 *
 * @returns the drawable lines, empty when the text is blank
 */
export function textLines({ text, frame }: { text: string; frame: DraftLine["frame"] }): readonly DraftLine[] {
  if (text.trim().length === 0) {
    return [];
  }
  const lines: DraftLine[] = [];
  const prose = ({ words }: { words: string }): void => {
    lines.push({ frame, marker: undefined, runs: mrkdwnRuns({ text: words }) });
  };
  const code = ({ words }: { words: string }): void => {
    lines.push({ frame: "code", marker: undefined, runs: plainText({ text: slackUnescaped({ text: words }) }) });
  };
  let fenced = false;
  for (const line of text.replace(/\n+$/, "").split("\n")) {
    const before = lines.length;
    let rest = line;
    for (;;) {
      const at = rest.indexOf(FENCE);
      const piece = at === -1 ? rest : rest.slice(0, at);
      if (fenced && piece.length > 0) {
        code({ words: piece });
      }
      if (!fenced && piece.trim().length > 0) {
        prose({ words: piece });
      }
      if (at === -1) {
        break;
      }
      fenced = !fenced;
      rest = rest.slice(at + FENCE.length);
    }
    if (!fenced && lines.length === before && !line.includes(FENCE)) {
      // A blank line between paragraphs is kept, as Slack keeps it.
      prose({ words: line });
    }
  }
  return lines;
}

/** Literal words as one plain run — code, where nothing inside is markup. */
function plainText({ text }: { text: string }): readonly DraftRun[] {
  return [{ bold: false, code: false, italic: false, kind: "text", text }];
}

/**
 * A labelled address as a link run when its scheme is one a card may link, else its label as words.
 *
 * @returns a live link for an allowed scheme, otherwise the label as words
 */
export function linkRun({ label, url, bold }: { label: string; url: string | undefined; bold: boolean }): DraftRun {
  if (url !== undefined && LINK_SCHEME.test(url)) {
    return { kind: "link", label: slackUnescaped({ text: label }), url };
  }
  return { bold, code: false, italic: false, kind: "text", text: slackUnescaped({ text: label }) };
}

/**
 * The buttons that carry an address, as one line of links: Slack draws a url button as something the owner can click
 * through, so it is a link here too. A button that only posts back to its app is chrome and draws nothing.
 *
 * @returns one line of URL buttons, or no lines when none are drawable
 */
export function buttonLine({
  buttons,
  frame,
}: {
  buttons: readonly Bag[];
  frame: DraftLine["frame"];
}): readonly DraftLine[] {
  const runs: DraftRun[] = [];
  for (const button of buttons) {
    const url = str({ bag: button, key: "url" });
    const face = sub({ bag: button, key: "text" });
    let label = str({ bag: button, key: "text" });
    if (face !== undefined) {
      label = str({ bag: face, key: "text" });
    }
    if (url !== undefined && label !== undefined && LINK_SCHEME.test(url)) {
      if (runs.length > 0) {
        runs.push(...plainText({ text: " · " }));
      }
      runs.push(linkRun({ bold: false, label, url }));
    }
  }
  if (runs.length === 0) {
    return [];
  }
  return [{ frame, marker: undefined, runs }];
}
