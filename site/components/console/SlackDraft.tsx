/*
 * A parked draft — as the owner, or a finding shared as the bot under Slack's APP badge — drawn the way Slack draws a
 * message: a Slack platform native UI draft, seen in a slide over.
 *
 * It renders the RUNS the register recorded (`../live/readSlackDrafts.ts`), not a flattened string, because
 * bold, a link, a mention chip and a bullet are what make one look like Slack rather than like a paragraph.
 * Nothing here writes and nothing here sends: the footer of the panel around it carries the command that
 * would, for the owner to run or hand a session (rule 2, rule 3).
 *
 * The channel header and message row reuse the thread view's own shapes (`./SlackThread.tsx`), so a draft sits in the same
 * visual idiom as the real messages beside it rather than inventing a second Slack look.
 */

import type { ReactElement, ReactNode } from "react";
import { avatarHue, avatarInitials } from "../../lib/avatarLabel";
import { readerTimeZone } from "../../lib/dateTimeFormat";
import { channelNames } from "../../lib/slackChannelLabels";
import { type PredictedUnfurl, predictedUnfurls, slackClock } from "../../lib/slackDraftLayout";
import {
  avatarOf,
  directMessagePeer,
  draftDestination,
  draftParentInWords,
  draftPlacement,
  personLabel,
} from "../../lib/slackPeople";
import { pickOwed } from "../live/readDraftComparison";
import type { ParkedDraft } from "../live/readSlackDrafts";
import { AvatarFallback, AvatarImage, Avatar as AvatarRoot } from "../ui/avatar";
import { DraftEditFrame, DraftVersions } from "./DraftEditFrame";
import { keyed, Line, type RunLabels } from "./DraftLines";
import { PriorAskCard } from "./DraftPriorAsk";
import { draftAuthorName } from "./draftAuthor";
import { LeadingReceipt } from "./LeadingReceipt";
import { SlackAttachments } from "./SlackAttachments";
import { MSG, MSG_BODY, THREAD_HEAD } from "./SlackThread";

/**
 * The channels a draft's card can name: its own destination, as the recording read named it, and every channel its
 * words name in writing — its `fallback` (the payload's mrkdwn `text`, or a bot card's wrapper fallback) keeps the
 * `<#C…|name>` its drawn lines no longer carry. A channel neither names draws its id.
 *
 * @param draft the parked draft
 * @returns each channel's name, by id
 */
export function draftChannelNames({ draft }: { draft: ParkedDraft }): ReadonlyMap<string, string> {
  return channelNames({ known: [{ id: draft.channel, name: draft.channelName }], texts: [draft.fallback] });
}

/**
 * A face the way Slack draws one: a rounded SQUARE, never the console's circle, from the 72px picture member bronze
 * holds — initials only when it holds none or the picture will not load. The owner's own face beside their own message is
 * the point, because profile pictures make it easier to react to things.
 *
 * @param url the 72px picture, when member bronze holds one
 * @param size a message row's face, or the conversation header's smaller one
 * @returns the face
 */
export function Face({
  url,
  name,
  size,
}: {
  url: string | undefined;
  name: string;
  size: "message" | "header";
}): ReactElement {
  const edge = size === "message" ? "size-9 rounded-[8px] text-[0.8rem]" : "size-5 rounded-[5px] text-[0.55rem]";
  return (
    <AvatarRoot className={`bg-muted ${edge}`} title={name}>
      {url === undefined ? null : (
        <AvatarImage alt={name} className="rounded-[inherit] object-cover" referrerPolicy="no-referrer" src={url} />
      )}
      <AvatarFallback
        aria-label={name}
        className="rounded-[inherit] font-bold text-white"
        style={{ background: `oklch(0.5 0.13 ${String(avatarHue({ name }))})` }}
      >
        {avatarInitials({ name })}
      </AvatarFallback>
    </AvatarRoot>
  );
}

/**
 * The conversation header Slack draws above the message: the person's face and name for a direct message, `# name`
 * for a channel. A `D…` conversation names nobody, so it says only that it is a direct message.
 *
 * @returns the header's title
 */
function Conversation({ draft }: { draft: ParkedDraft }): ReactElement {
  const peer = directMessagePeer({ channel: draft.channel });
  if (peer !== undefined) {
    const label = personLabel({ id: peer, people: draft.people });
    return (
      <b className="flex items-center gap-2" title={peer}>
        <Face name={label.text} size="header" url={avatarOf({ id: peer, people: draft.people })} />
        {label.text}
      </b>
    );
  }
  // The header names the conversation alone, the way Slack's own does; a reply's thread is the `Parent` line below it.
  const { where } = draftDestination({
    channel: draft.channel,
    channelName: draft.channelName,
    mentions: draft.mentions,
    people: draft.people,
    threaded: false,
  });
  if (where.startsWith("#")) {
    return <b title={draft.channel}># {where.slice(1)}</b>;
  }
  return <b title={draft.channel}>{where}</b>;
}

/** Every link address the message carries, in reading order. */
function linkUrls({ draft }: { draft: ParkedDraft }): readonly string[] {
  return draft.lines.flatMap((line) => line.runs.flatMap((run) => (run.kind === "link" ? [run.url] : [])));
}

/**
 * The previews Slack may add that no measured rule predicts — named under the draft, outside the message, so the
 * card never draws a guess as if Slack had drawn it and never lets the absence read as a promise.
 *
 * @returns the note, or nothing when every link is measured
 */
function Unmeasured({ unfurls }: { unfurls: readonly PredictedUnfurl[] }): ReactElement | null {
  const hosts = [...new Set(unfurls.flatMap((unfurl) => (unfurl.kind === "unmeasured" ? [unfurl.host] : [])))];
  if (hosts.length === 0) {
    return null;
  }
  return (
    <p className="m-0 text-[0.78rem] text-muted-foreground">
      Slack may add a preview under the {hosts.join(", ")} link{hosts.length > 1 ? "s" : ""}; nothing measured says
      what, so the card draws none.
    </p>
  );
}

/**
 * The corner of the draft's header, where the owner reads first. A held draft's says where it lands — `in thread` or
 * `top level` — because that is the fact a reader misreads there, and "not sent" says nothing they do not know from
 * opening the card; the message's own dashed "draft · not sent" frame still says it is held.
 * A card can name a draft that has since gone out or been dropped, and it still draws the message (a card naming a
 * draft always shows it) — so for those the stamp says which.
 *
 * @returns the stamp
 */
function Stamp({ draft }: { draft: ParkedDraft }): ReactElement {
  if (draft.state === "held") {
    return (
      <span
        className="ml-auto rounded-full border border-warning px-2 text-[0.72rem] tracking-[0.02em] text-warning uppercase"
        data-placement={draft.thread === undefined ? "top-level" : "thread"}
      >
        {draftPlacement({ threaded: draft.thread !== undefined })}
      </span>
    );
  }
  let when = "";
  if (draft.resolvedIso !== undefined) {
    when = ` ${draft.resolvedIso.slice(0, 16).replace("T", " ")}Z`;
  }
  const word = draft.state === "released" ? "sent" : "dropped unsent";
  return (
    <span className="ml-auto rounded-full border border-border px-2 text-[0.72rem] tracking-[0.02em] text-muted-foreground uppercase">
      {word}
      {when}
    </span>
  );
}

/**
 * How the draft goes out, as the register decided it: the exact command, or — for a row parked top-level whose why
 * says thread reply — that neither verb will send it and it has to be re-recorded into its thread. Printing the
 * verb the register chose, never one this component picks, is what keeps a reply from being sent as a post.
 *
 * @param draft the parked draft
 * @returns the phrase, to sit inside a note
 */
export function DraftReleaseNote({ draft }: { draft: ParkedDraft }): ReactElement {
  const release = draft.release;
  if (release === undefined) {
    return <>Nothing is left to send: the register has it {draft.state}.</>;
  }
  if (release.kind === "re-record") {
    return (
      <>
        <b>Not sendable as parked</b>: {release.why}
      </>
    );
  }
  if (pickOwed({ comparison: draft.comparison })) {
    return (
      <>
        <b>Not sendable until you choose</b>: a Codex draft sits beside this one, and <code>{release.command}</code>{" "}
        refuses until one of the two is picked
      </>
    );
  }
  return (
    <>
      <code>{release.command}</code> {draft.thread === undefined ? "posts it" : "replies in the thread"} through the
      door, exactly as shown
    </>
  );
}

/**
 * The message a reply goes under, as the recording read it, drawn above the reply the way Slack's thread view opens
 * on its root. Absent for a top-level post. The live conversation replaces it once read (`./DraftConversation.tsx`);
 * until then, and when that read fails, this is what the card knows.
 *
 * @returns the parent line, or nothing
 */
export function Parent({ draft }: { draft: ParkedDraft }): ReactElement | null {
  if (draft.thread === undefined) {
    return null;
  }
  return (
    <p className="m-0 border-l-2 border-border pl-2 text-[0.8rem] text-muted-foreground" title={draft.thread.ts}>
      Replying {draftParentInWords({ people: draft.people, thread: draft.thread })}
    </p>
  );
}

/**
 * The draft as Slack would draw it: the conversation it is bound for, the message a reply goes under, then the
 * message under the owner's own face and name, then everything Slack draws under it — each rule measured off Slack's own
 * render (`../../lib/slackDraftLayout.ts`).
 *
 * The stamp is not decoration, and it is the one thing drawn OUTSIDE the message. Everything else on this component
 * is a faithful preview of a real message, which is exactly what makes a reader liable to believe it already went
 * out — and once the live conversation is drawn above it, a held draft sits among messages that DID go out. So a
 * held draft's message is framed apart from them: a dashed warning border, a tint, and its own "draft · not sent".
 *
 * A re-ask's "Asked before" box keeps time order: with a live conversation, our earlier message
 * belongs to it (`./DraftConversation.tsx`) and only the box's claim is drawn here, just above the draft.
 *
 * @param draft the parked draft, as the register recorded it
 * @param conversation what is drawn between the header and the message in place of the recorded parent line — the
 *   conversation the draft lands in, read live, or its loading and failure lines
 * @returns the message
 */
export function SlackDraft({ draft, conversation }: { draft: ParkedDraft; conversation?: ReactNode }): ReactElement {
  const authorName = draftAuthorName({ draft });
  const unfurls = predictedUnfurls({ urls: linkUrls({ draft }) });
  const linear = unfurls.filter(
    (unfurl): unfurl is Extract<PredictedUnfurl, { kind: "linear-issue" }> => unfurl.kind === "linear-issue",
  );
  const labels: RunLabels = { channels: draftChannelNames({ draft }), mentions: draft.mentions, people: draft.people };
  const held = draft.state === "held";
  return (
    <section
      className="grid gap-[0.6rem] rounded-[10px] border border-solid sw-slack px-[0.75rem] py-[0.7rem]"
      aria-label="the draft, as Slack would draw it"
    >
      <div className={`${THREAD_HEAD} items-center border-b border-border`}>
        <Conversation draft={draft} />
        <Stamp draft={draft} />
      </div>
      {/* The first message's receipt leads, above the conversation it lands in, so it is above the fold (21 Oct). */}
      {draft.leadingReceipt !== undefined && <LeadingReceipt receipt={draft.leadingReceipt} />}
      {conversation === undefined ? <Parent draft={draft} /> : conversation}
      <PriorAskCard
        part={conversation === undefined ? "whole" : "claim"}
        people={draft.people}
        prior={draft.priorAsk}
      />
      <DraftEditFrame id={draft.id}>
        <div
          className={
            held
              ? "grid gap-1 rounded-[8px] border border-dashed border-warning bg-warning/8 px-2 py-[0.35rem]"
              : "contents"
          }
          data-state={draft.state}
        >
          {held && (
            <span className="text-[0.68rem] font-bold tracking-[0.06em] text-warning uppercase">draft · not sent</span>
          )}
          <div className={MSG} data-kind="message">
            <Face name={authorName} size="message" url={avatarOf({ id: draft.authorId, people: draft.people })} />
            <div className={MSG_BODY}>
              <p className="mt-0 mb-[0.1rem] flex items-baseline gap-2 text-[15px] leading-[22px]">
                <b title={draft.authorId}>{authorName}</b>
                {draft.actor === "bot" && (
                  <span className="rounded-[3px] bg-muted px-[3px] text-[10px] font-bold text-muted-foreground">
                    APP
                  </span>
                )}
                <span className="text-[12px] text-muted-foreground" title={draft.tsIso}>
                  {slackClock({ iso: draft.tsIso, timeZone: readerTimeZone() })}
                </span>
              </p>
              {/*
               * No gap between lines, and newlines kept: Slack draws sibling sections with no space between them, and a
               * paragraph's break is the `\n\n` the sender embeds INSIDE the section before the next one
               * (`src/outbound/slack/render.ts`, PARAGRAPH_GAP), drawn as Slack's short break by `TextRun`.
               */}
              <div className="grid text-[15px] leading-[22px] wrap-anywhere whitespace-pre-wrap">
                {keyed({ items: draft.lines, kind: "line" }).map((entry) => (
                  <Line labels={labels} key={entry.key} line={entry.item} />
                ))}
              </div>
              <SlackAttachments media={draft.media} unfurls={linear} />
            </div>
          </div>
        </div>
      </DraftEditFrame>
      {draft.versions !== undefined && <DraftVersions versions={draft.versions} />}
      <Unmeasured unfurls={unfurls} />
      {draft.advisory.length > 0 && (
        <ul className="m-0 list-disc pl-[1.1rem] text-[0.78rem] text-muted-foreground">
          {draft.advisory.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
