"use client";

import type { ReactElement } from "react";

import { destinationWhere, draftMessages } from "../../lib/askAction";
import { citedSource, opensNowhere } from "../../lib/citationDisplay";
import { type FencedSegment, fencedLines, linkLabelPieces } from "../../lib/slackEmoji";
import { type MentionLabels, type MrkdwnSpan, readableSpan, segmentSpans } from "../../lib/slackMrkdwn";
import type { BoardRowActionRead, BoardRowDestination, BoardRowMention } from "../live/readAction";

import { CitationChip } from "./CitationChip";
import { EmojiPieces, EmojiText } from "./SlackEmoji";
import { StaleMark } from "./StaleMark";

/** The bordered card a preview sits in — Slack's or a mail's — saying by its own frame that nothing was sent. */
export const PREVIEW = "sw-glass-control grid gap-2 rounded-[10px] border border-border px-[0.7rem] py-[0.6rem]";

/** The small uppercase line naming what the preview shows. */
export const PREVIEW_HEAD = "m-0 text-[0.68rem] font-bold tracking-[0.06em] text-muted-foreground uppercase";

/** A mention, tinted the way Slack tints one. */
const MENTION = "sw-slack-chip rounded-[4px] px-[0.2rem]";

/**
 * The drafted message, drawn the way Slack draws one — the owner's avatar slot, their name, the body rendered.
 *
 * The owner reacts to a Slack-native view of what a message would look like posted into a channel or a thread,
 * shown in a slide-over, so the draft is drawn as a preview to react to.
 *
 * ## Three things this component will not do
 *
 * **It composes nothing.** Every string below is a field the verb recorded or a constant belonging to this
 * page — `AGENTS.md` rule 2. The body is rendered, never edited or completed.
 *
 * **It renders TEXT, never markup.** `../../lib/slackMrkdwn.ts` returns typed spans and each one becomes a
 * React element here, so a draft — which is prose about an incident and may contain anything — can never
 * reach the DOM as HTML.
 *
 * **It sends nothing.** A destination's command is rendered under the options on the card, copyable, run
 * by a session or by the owner. `../../lib/actVerbs.ts`'s header carries why a provider-reaching verb is not a
 * button until its own dry-run is in front of the owner.
 *
 * A malformed action is NAMED rather than drawn as an absent one: the verb refuses to record a draft that
 * breaks its own rules, so one arriving here broken is a defect between the journal and this page.
 */

/**
 * Who the preview says the message goes out as, in words — it must
 * be obvious at a glance whether a draft posts as the owner or as the bot. The action records `actor: "me"` for a
 * message under the owner's own identity; any other actor is named verbatim rather than guessed at, because this page
 * holds no register saying which identity another value means.
 *
 * @returns the sentence
 */
function senderOf({ actor }: { actor: string }): string {
  if (actor === "me") {
    return "Posts as you";
  }
  return `Posts as "${actor}"`;
}

/**
 * One rendered span of Slack mrkdwn — a draft's, or a stored thread message's (`./SlackThread.tsx`).
 *
 * @param span the token
 * @param inert draw a link as text naming its address on hover, never one a click follows — a preview of words
 *   nobody has checked yet, like the running list's
 * @param fenced the span sits inside a code fence spanning lines (`fencedLines`), so its words stay as written
 * @returns the element
 */
export function MrkdwnSpanView({
  span: wire,
  inert,
  fenced,
}: {
  span: MrkdwnSpan;
  inert?: boolean | undefined;
  fenced?: boolean;
}): ReactElement {
  // The tokenizer keeps Slack's wire escapes; this is the one place a span is drawn, so it is read here, once.
  const span = readableSpan({ span: wire });
  // A board row opens nowhere (`referenceHref`), so a board-row link in a draft draws inert.
  const boardRowHere = span.kind === "link" && opensNowhere({ reference: { kind: "address", url: span.href } });
  if (span.kind === "mention") {
    return (
      <span className={MENTION} title={span.userId}>
        {span.label}
      </span>
    );
  }
  if (span.kind === "channel") {
    return <span className={MENTION}>{span.label}</span>;
  }
  // A link's label draws its shortcodes as emoji too, as Slack draws `<https://…|ship :tada:>`; a bare address never.
  if (span.kind === "link" && boardRowHere) {
    // Its words only — a bare address reads as the row's slug — with no link, underline or hover naming the address.
    if (span.label === span.href) {
      return <span>{citedSource({ reference: { kind: "address", url: span.href } }).place}</span>;
    }
    return (
      <span className="wrap-anywhere">
        <EmojiPieces pieces={linkLabelPieces({ href: span.href, label: span.label })} />
      </span>
    );
  }
  if (span.kind === "link" && inert === true) {
    return (
      <span className="underline wrap-anywhere" title={span.href}>
        <EmojiPieces pieces={linkLabelPieces({ href: span.href, label: span.label })} />
      </span>
    );
  }
  if (span.kind === "link") {
    return (
      <a className="wrap-anywhere" href={span.href}>
        <EmojiPieces pieces={linkLabelPieces({ href: span.href, label: span.label })} />
      </a>
    );
  }
  if (span.kind === "code") {
    return (
      <code className="rounded-[3px] border border-solid px-[0.25rem] text-[0.88em] wrap-anywhere">{span.text}</code>
    );
  }
  // Text, bold and italic draw each standard shortcode as its emoji, as Slack does; code above keeps it as written, and
  // so does a stretch inside a fence spanning lines, which this per-line span never sees the fence of.
  const words = fenced === true ? span.text : <EmojiText text={span.text} />;
  if (span.kind === "bold") {
    return <b>{words}</b>;
  }
  if (span.kind === "italic") {
    return <i>{words}</i>;
  }
  return <>{words}</>;
}

/**
 * One line of Slack mrkdwn as its spans, each segment `fencedLines` cut it into read on its own: a fenced one's
 * words stay as written, and the words beside a fence on its opening or closing line still draw.
 *
 * @param segments the line's stretches, in order
 * @param labels how a mention inside it resolves to a name
 * @param inert draw each link inert, as {@link MrkdwnSpanView} does
 * @returns the line's spans
 */
export function MrkdwnSegments({
  segments,
  labels,
  inert,
}: {
  segments: readonly FencedSegment[];
  labels: MentionLabels;
  inert?: boolean;
}): ReactElement {
  return (
    <>
      {segments.map((segment, cut) =>
        segmentSpans({ labels, segment }).map((span, at) => (
          // eslint-disable-next-line react/no-array-index-key -- a span's position in its segment is its identity
          <MrkdwnSpanView fenced={segment.fenced} inert={inert} key={`${String(cut)}:${String(at)}`} span={span} />
        )),
      )}
    </>
  );
}

/**
 * The preview: the message as it would render, and the destinations it could go to.
 *
 * @param action the row's action, in whichever of its three states it arrived
 * @returns the preview, or the named absence
 */
export function SlackActionPreview({ action }: { action: BoardRowActionRead }): ReactElement | null {
  if (action.kind === "none" || action.kind === "mail") {
    // A mail is drawn by `./MailActionPreview.tsx`, never as a Slack message.
    return null;
  }
  if (action.kind === "invalid") {
    return (
      <StaleMark
        facts={[
          {
            subject: "the Slack draft this ask records",
            why: `${action.why} (a defect between handover offer and this page, not an ask without a draft)`,
          },
        ]}
        block
      />
    );
  }
  const labels = {
    labelFor: ({ userId }: { userId: string }) => labelIn({ mentions: action.action.mentions, userId }),
  };
  const messages = draftMessages({ action: action.action });
  return (
    <section className={`${PREVIEW} sw-slack`}>
      <h4 className={PREVIEW_HEAD}>{headOf({ count: messages.length })}</h4>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-[0.6rem]">
        <div
          className="size-8 rounded-[6px] bg-[color-mix(in_oklch,var(--c-primary)_30%,var(--c-panel))]"
          aria-hidden="true"
        />
        <div className="grid min-w-0 gap-[0.45rem]">
          <p className="m-0 flex items-baseline gap-[0.45rem] text-[0.85rem]">
            <b className="text-foreground">{senderOf({ actor: action.action.actor })}</b>
          </p>
          {messages.map((body, index) => (
            // eslint-disable-next-line react/no-array-index-key -- a draft's messages have no id; the order IS the identity
            <Message key={index} body={body} labels={labels} separate={index > 0} />
          ))}
        </div>
      </div>
      <ul className="m-0 grid list-none gap-1 border-t border-dashed border-border px-0 pt-[0.45rem] pb-0 text-[0.75rem] text-muted-foreground">
        {action.action.destinations.map((destination) => (
          <li key={destination.label}>
            <DestinationLabel destination={destination} />: {destinationWhere({ destination })}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The preview's heading — and for a draft sent in parts, how many, because a card that drew two messages under
 * a singular heading would read as one message with a gap in it, which is exactly what a draft must not send.
 *
 * @returns the heading text
 */
function headOf({ count }: { count: number }): string {
  if (count === 1) {
    return "The draft, as the room would see it";
  }
  return `The draft, as the room would see it: ${String(count)} messages, each sent on its own`;
}

/**
 * One drafted message, its lines rendered as Slack renders them. Every message after the first is ruled off
 * from the one before, so two messages never read as one with a blank line in it.
 *
 * @param body the message's own text
 * @param labels how a mention inside it resolves to a name
 * @param separate whether a message precedes it
 * @returns the rendered message
 */
function Message({ body, labels, separate }: { body: string; labels: MentionLabels; separate: boolean }): ReactElement {
  const rule = separate ? " border-t border-dashed border-border pt-[0.45rem]" : "";
  return (
    <div className={`min-w-0 text-[0.88rem] leading-[1.45]${rule}`}>
      {fencedLines({ text: body }).map(({ segments }, index) => (
        // eslint-disable-next-line react/no-array-index-key -- a draft's lines have no id; the index IS the line
        <p key={index} className="m-0 min-h-[1.2em] wrap-anywhere">
          <MrkdwnSegments labels={labels} segments={segments} />
        </p>
      ))}
    </div>
  );
}

/**
 * A destination's own name, and for a thread whose permalink was recorded, the link to that thread, so a reader can
 * tell which thread it is.
 *
 * @param destination the place the draft could go
 * @returns the name, linked when a permalink is on record
 */
function DestinationLabel({ destination }: { destination: BoardRowDestination }): ReactElement {
  // The journal is a hand-editable file and the wire checks only that a permalink is non-empty, so only an https
  // address becomes a link — the same scheme `../../lib/inlineCitations.ts` reads out of a card's own words.
  if (destination.kind === "thread" && destination.permalink?.startsWith("https://") === true) {
    return (
      <CitationChip reference={{ kind: "address", url: destination.permalink }} look="inline">
        {destination.label}
      </CitationChip>
    );
  }
  return <b>{destination.label}</b>;
}

/** The label the action recorded for one user id, or `undefined` when it named none. */
function labelIn({ mentions, userId }: { mentions: readonly BoardRowMention[]; userId: string }): string | undefined {
  return mentions.find((one) => one.userId === userId)?.label;
}
