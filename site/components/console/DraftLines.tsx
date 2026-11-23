/*
 * The lines of a Slack message the way Slack draws them: styled text, a link, a mention chip, a bullet, a quote's bar
 * and a code block's box. Split out of `./SlackDraft.tsx` so the earlier-ask block (`./DraftPriorAsk.tsx`), which the
 * draft card draws above its message, can draw an earlier message's words the same way without the two files
 * importing each other.
 */

import type { ReactElement } from "react";
import { citedSource, opensNowhere } from "../../lib/citationDisplay";
import { type DraftRunLabels, draftGroupLabel, draftUserLabel } from "../../lib/draftWords";
import { consoleHref } from "../../lib/localPageHref";
import { channelChipLabel } from "../../lib/slackChannelLabels";
import { draftLinkPieces, draftTextPieces, paragraphPieces } from "../../lib/slackDraftLayout";
import type { PersonLabel } from "../../lib/slackPeople";
import type { DraftLine, DraftRun } from "../live/readSlackDraftsRuns";
import { PreviewLink } from "./PreviewModal";
import { EmojiPieces, SlackEmoji } from "./SlackEmoji";

/** A mention or broadcast, tinted the way Slack tints one. */
const CHIP = "sw-slack-chip rounded-[4px] px-1";

/** Slack's inline code: its own tinted, hairline-bordered chip, in the code colour `.sw-slack` sets. */
const CODE = "rounded-[3px] border border-solid px-[0.25rem] text-[0.88em]";

/** A link, in the console's measured link colour (`VERDICT_INKS.info`), which reads on every family's glass. */
export const LINK = "text-info no-underline hover:underline";

/**
 * Pair each item with the key React holds it by. A draft's runs and lines carry no identity of their own —
 * two "Everyone" bullets are genuinely the same string — so the key is the POSITION, minted here rather
 * than at the render, which is what keeps building the list and reading it one step apart.
 *
 * @param items what to key
 * @param kind the prefix that keeps one list's keys apart from another's
 * @returns each item beside its key
 */
export function keyed<T>({ items, kind }: { items: readonly T[]; kind: string }): readonly { key: string; item: T }[] {
  return [...items.entries()].map(([at, item]) => ({ item, key: `${kind}-${String(at)}` }));
}

/** A mention chip: what Slack draws for `<@U…>` and `<!subteam^S…|@handle>` — the name, and the id on hover. */
function Mention({ label }: { label: PersonLabel }): ReactElement {
  return (
    <span className={CHIP} title={label.title}>
      @{label.text}
    </span>
  );
}

/**
 * One styled stretch of text, between two paragraph breaks. Every flag the run carries is drawn, nested, because Slack
 * applies them together: a bold italic run is bold AND italic.
 */
function Styled({
  frame,
  run,
  text,
}: {
  frame: DraftLine["frame"];
  run: Extract<DraftRun, { kind: "text" }>;
  text: string;
}): ReactElement {
  // A standard shortcode reads as its emoji, as Slack draws it — except inside code, a span or a whole code block.
  const pieces = <EmojiPieces pieces={draftTextPieces({ code: run.code, frame, text })} />;
  const coded = run.code ? <code className={CODE}>{text}</code> : pieces;
  const italic = run.italic ? <i>{coded}</i> : coded;
  return run.bold ? <b>{italic}</b> : italic;
}

/**
 * A text run with each embedded `\n\n` drawn as Slack's short paragraph break — a small gap, measured on the
 * owner's self-DM render (`../../lib/slackDraftLayout.ts`), where a blank line would draw every paragraph
 * further apart than Slack does.
 */
function TextRun({
  frame,
  run,
}: {
  frame: DraftLine["frame"];
  run: Extract<DraftRun, { kind: "text" }>;
}): ReactElement {
  const pieces = keyed({ items: paragraphPieces({ text: run.text }), kind: "piece" });
  return (
    <>
      {pieces.map((entry, at) => (
        <span key={entry.key}>
          {at > 0 && <span aria-hidden="true" className="block h-2" />}
          <Styled frame={frame} run={run} text={entry.item} />
        </span>
      ))}
    </>
  );
}

/**
 * Who and where a message's chips name: the people and groups (`DraftRunLabels`, which the console voice reads the same
 * chips by), and the channels the surface knows a name for (`../../lib/slackChannelLabels.ts`'s `channelNames`).
 */
export type RunLabels = DraftRunLabels & {
  readonly channels: ReadonlyMap<string, string>;
};

/** One run. `text` carries its own styles, and its line's frame; every other kind is a chip or a link Slack draws specially. */
function Run({ frame, labels, run }: { frame: DraftLine["frame"]; labels: RunLabels; run: DraftRun }): ReactElement {
  const boardRowWords = run.kind === "link" && opensNowhere({ reference: { kind: "address", url: run.url } });
  if (run.kind === "text") {
    return <TextRun frame={frame} run={run} />;
  }
  if (run.kind === "link" && boardRowWords) {
    // A board row opens nowhere (`referenceHref`), so its link draws as its words only, with no link or hover naming
    // the address; a bare address reads as the row's slug.
    if (run.label === run.url) {
      return <span>{citedSource({ reference: { kind: "address", url: run.url } }).place}</span>;
    }
    return <EmojiPieces pieces={draftLinkPieces({ frame, label: run.label, url: run.url })} />;
  }
  if (run.kind === "link") {
    // A briefing the console serves previews over the card on a plain click; anything else, and
    // any modified click, opens a new tab.
    return (
      <PreviewLink
        className="no-underline hover:underline"
        href={consoleHref({ url: run.url })}
        title={run.label}
        tooltip={run.url}
      >
        <EmojiPieces pieces={draftLinkPieces({ frame, label: run.label, url: run.url })} />
      </PreviewLink>
    );
  }
  if (run.kind === "user") {
    return <Mention label={draftUserLabel({ labels, userId: run.userId })} />;
  }
  if (run.kind === "usergroup") {
    return <Mention label={draftGroupLabel({ groupId: run.groupId, handle: run.handle, labels })} />;
  }
  if (run.kind === "emoji") {
    return <SlackEmoji name={run.name} skinTone={run.skinTone} unicode={run.unicode} />;
  }
  if (run.kind === "broadcast") {
    return <span className={CHIP}>@{run.range}</span>;
  }
  if (run.kind === "channel") {
    // `#dev`, as Slack draws it — the id only when nothing names the channel, and always the hover.
    const label = channelChipLabel({ channelId: run.channelId, channels: labels.channels });
    return (
      <span className={CHIP} title={label.title}>
        #{label.text}
      </span>
    );
  }
  if (run.kind === "team") {
    return <span className={CHIP}>{run.teamId}</span>;
  }
  if (run.kind === "date") {
    return <span title={`epoch ${String(run.timestamp)}`}>{run.label}</span>;
  }
  return <code className={CODE}>{run.value}</code>;
}

/**
 * One paragraph, one item of a list, a quote or a code block. An empty one still takes a line's height: the
 * plain escape hatch splits on every newline, so a blank line between its paragraphs arrives as a line with no
 * runs. A quote is Slack's grey left bar; a code block its bordered monospace box.
 *
 * @param labels who the line's chips name
 * @returns the line
 */
export function Line({ labels, line }: { labels: RunLabels; line: DraftLine }): ReactElement {
  const runs = keyed({ items: line.runs, kind: "run" }).map((entry) => (
    <Run frame={line.frame} labels={labels} key={entry.key} run={entry.item} />
  ));
  if (line.frame === "quote") {
    return <blockquote className="m-0 border-l-4 border-muted-foreground/40 pl-3">{runs}</blockquote>;
  }
  if (line.frame === "code") {
    return (
      <pre className="m-0 rounded-[4px] border border-solid px-2 py-1 font-mono text-[0.82rem] whitespace-pre-wrap">
        {runs}
      </pre>
    );
  }
  if (line.marker === undefined) {
    return <p className="m-0 min-h-[1lh]">{runs}</p>;
  }
  // A sub-point sits one marker column further in per level, the way Slack draws a nested list.
  const nested = line.indent === undefined ? undefined : { paddingLeft: `${String(line.indent * 1.45)}rem` };
  return (
    <p className="m-0 grid grid-cols-[1.1rem_minmax(0,1fr)] gap-[0.35rem]" style={nested}>
      <span className="text-muted-foreground">{line.marker}</span>
      <span>{runs}</span>
    </p>
  );
}
