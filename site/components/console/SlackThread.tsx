"use client";

/*
 * A Slack thread as Slack draws one, with the reply the register holds for it underneath — the archived console's
 * `SlackThreadView`, ported to this repo's idiom. The messages are the corpus's own
 * (`store around --mode thread`), the pictures the member roster's, and the draft the held-draft register's
 * (`queue list`): nothing here writes, and nothing here launches a model (rule 2) — a held reply ends in the
 * exact verb line that would send it, for the owner to run or to hand a session.
 */

import { type ComponentProps, type ReactElement, useState } from "react";

import { MessageResponse } from "@/components/ai-elements/message";

import { heldDraftMarkdown } from "../../lib/citationDisplay";
import { clauseAfter } from "../../lib/clauseJoin";
import { integrationOf } from "../../lib/integrations";
import { fencedLines } from "../../lib/slackEmoji";
import { threadKeyOf } from "../../lib/slackLink";
import type { MentionLabels } from "../../lib/slackMrkdwn";
import { cn } from "../../lib/utils";
import { type Avatars, avatarKey } from "../live/readPeople";
import { type HeldDraft, isHeld, type ThreadRecord } from "../live/readThread";
import { Avatar } from "./Avatar";
import { CitationChip } from "./CitationChip";
import { ConnectIntegration } from "./ConnectIntegration";
import { BUTTON_PRIMARY } from "./controls";
import { ReadingIndicator } from "./ReadingIndicator";
import { MrkdwnSegments } from "./SlackActionPreview";
import { SourceFreshnessLine } from "./SourceFreshness";
import { StaleMark } from "./StaleMark";
import { type SlackConnectionState, useSlackConnection } from "./useSlackConnection";
import { type ThreadState, useThread } from "./useThread";

/** Where a thread is: the channel's name, what the read covered, and the link out to Slack, on one wrapping line. */
export const THREAD_HEAD = "m-0 flex flex-wrap items-baseline gap-[0.45rem] pb-2";

/** One message: the author's picture in a gutter, the message beside it. */
export const MSG = "group/msg grid grid-cols-[auto_minmax(0,1fr)] items-start gap-[0.6rem]";

/** A message's name line, text and cut note; a real message (not a file or a join) keeps a little room under it. */
export const MSG_BODY = "min-w-0 group-data-[kind=message]/msg:pb-2";

/** The author's name and the minute it was sent, the minute a quiet link to the message in Slack. */
export const MSG_HEAD =
  "mt-0 mb-[0.15rem] flex items-baseline gap-2 text-[0.85rem] [&_a]:text-[0.74rem] [&_a]:text-muted-foreground [&_a]:no-underline [&_a:hover]:underline";

/** The integration every thread here is read through. */
const SLACK = integrationOf({ id: "slack" });

/** The marker that opens a quoted line: `>` as the wire escapes it, or bare, then its space. */
const QUOTE_MARK = /^(?:&gt;|>) ?/;

/** An ISO instant as the thread prints it — the date and the minute, in UTC, the way the corpus stamps it. */
function whenOf({ iso }: { iso: string }): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/**
 * Where a thread is, off the read: the root message's own title names the channel; else the container's
 * id, which a direct message (a Slack `D…` id) shows without the hash a channel name takes.
 */
function placeOf({ records, container }: { records: readonly ThreadRecord[]; container: string | undefined }): {
  readonly name: string;
  readonly hash: boolean;
} {
  const root = records.find((record) => record.kind === "message");
  let name: string | undefined;
  if (root?.title !== undefined && root.title.endsWith(" message")) {
    name = root.title.slice(0, -" message".length);
  } else if (container !== undefined) {
    name = container.replace("slack/", "");
  }
  if (name === undefined) {
    return { hash: false, name: "a channel the read did not name" };
  }
  if (/^D[A-Z0-9]+$/.test(name)) {
    return { hash: false, name: `direct message ${name}` };
  }
  if (name.startsWith("#")) {
    return { hash: true, name: name.slice(1) };
  }
  return { hash: true, name };
}

/**
 * How a `<@U…>` mention in a stored message reads: the roster's name for that member, else the raw id
 * (`mrkdwnSpans`' own fallback), never a guess.
 */
function labelFor({ avatars }: { avatars: Avatars | undefined }): MentionLabels["labelFor"] {
  return ({ userId }) => avatars?.byId.get(avatarKey({ nativeId: userId, source: "slack" }))?.name;
}

/**
 * One message. The name is the roster's when it has one — the store writes a bot's bare id as its author,
 * measured on the bot's own replies — else the store's, else a stated absence.
 */
function Message({ record, avatars }: { record: ThreadRecord; avatars: Avatars | undefined }): ReactElement {
  let name = "an author the store did not resolve";
  if (record.author !== undefined) {
    name = record.author;
  }
  let url: string | undefined;
  if (avatars !== undefined && record.authorNativeId !== undefined) {
    const person = avatars.byId.get(avatarKey({ nativeId: record.authorNativeId, source: "slack" }));
    url = person?.avatarUrl;
    if (person?.name !== undefined) {
      name = person.name;
    }
  }
  const cut = record.bodyChars > record.excerpt.length;
  return (
    <li className={MSG} data-kind={record.kind}>
      <Avatar url={url} name={name} size="md" />
      <div className={MSG_BODY}>
        <p className={MSG_HEAD}>
          <b>{name}</b>
          <a href={record.url} target="_blank" rel="noreferrer" title="open in Slack">
            {whenOf({ iso: record.occurredAt })}
          </a>
        </p>
        {/* As Slack draws it — bold, links and mentions — rather than the stored mrkdwn's asterisks (5 Oct 2026). */}
        <div className="text-[0.88rem] leading-[1.45]">
          {fencedLines({ text: record.excerpt }).map(({ line, segments }, index) => (
            <p
              // eslint-disable-next-line react/no-array-index-key -- a message's lines have no id; the index IS the line
              key={index}
              className={cn(
                "m-0 min-h-[1.2em] wrap-anywhere whitespace-pre-wrap",
                // Slack draws a line opening `>` as a quote: a grey bar down its left edge, the marker itself unseen.
                QUOTE_MARK.test(line) && "border-l-4 border-solid border-l-[color:var(--slack-border)] pl-3",
              )}
            >
              <MrkdwnSegments
                labels={{ labelFor: labelFor({ avatars }) }}
                segments={segments.map((segment, at) =>
                  at === 0 ? { ...segment, text: segment.text.replace(QUOTE_MARK, "") } : segment,
                )}
              />
            </p>
          ))}
        </div>
        {cut && (
          <p className="mt-[0.2rem] mb-0 text-[0.74rem] text-muted-foreground">
            {String(record.bodyChars)} characters in all: the read carries the first {String(record.excerpt.length)};{" "}
            <a href={record.url} target="_blank" rel="noreferrer">
              the rest is in Slack
            </a>
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * A link in a rendered draft. A footnote's own anchors (`#user-content-fn-1` and its back-reference) stay plain
 * anchors, so they still jump within the page; every other address is a cited record, drawn as its chip.
 */
function DraftLink({ href, children, node: _node, ...rest }: ComponentProps<"a"> & { node?: unknown }): ReactElement {
  if (href === undefined || href.startsWith("#")) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return <CitationChip reference={{ kind: "address", url: href }}>{children}</CitationChip>;
}

/** Streamdown's overrides for a draft — one object for the module, because `MessageResponse` memoises on its text. */
const DRAFT_COMPONENTS = { a: DraftLink };

/** The quiet line over the held draft saying why it is held. */
const HELD_NOTE = "m-0 text-[0.78rem] text-muted-foreground";

/**
 * The reply the register holds for this thread, read as it will land, its citations as footnotes, and the verb that
 * releases it. No box: the console's one text input is the call's chat, since the app has no
 * other text input, so a change to the words is said there, with this
 * card open.
 */
function HeldReply({ draft }: { draft: HeldDraft }): ReactElement {
  const [copied, setCopied] = useState(false);
  const command = `slopweaver queue release ${draft.id}`;
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
  };
  return (
    <div className="sw-glass-control grid gap-2 rounded-[10px] px-[0.7rem] py-[0.6rem]">
      <p className={HELD_NOTE}>
        <span className="inline-block rounded-full bg-[oklch(0.5_0.15_290)] px-[0.45rem] text-[0.7rem] font-bold tracking-[0.03em] text-[oklch(0.99_0_0)] uppercase">
          Slopweaver draft
        </span>{" "}
        <code>{draft.id}</code>: held because {draft.reason}
      </p>
      <div className="sw-slack rounded-md border border-solid px-3 py-2 text-sm">
        <MessageResponse components={DRAFT_COMPONENTS}>
          {heldDraftMarkdown({ citations: draft.citations, text: draft.text })}
        </MessageResponse>
      </div>
      <div className="grid gap-[0.45rem]">
        <pre className="m-0 max-h-48 overflow-auto rounded-[10px] border border-solid border-border bg-[oklch(0.13_0.008_250)] px-[1.1rem] py-[0.9rem] font-mono text-[0.78rem] leading-[1.55] wrap-anywhere whitespace-pre-wrap text-[oklch(0.9_0.005_250)] [word-break:break-word]">
          {/* The terminal stays dark in every theme, so its prompt takes a fixed colour rather than the accent. */}
          <span className="text-[oklch(0.7_0.005_250)]">$ </span>
          {command}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            className={BUTTON_PRIMARY}
            onClick={() => {
              void copy();
            }}
          >
            {copied ? "copied" : "copy the verb"}
          </button>
        </div>
        <p className={HELD_NOTE}>
          Nothing here sends; the line above is exactly what would. To change the words, say so in the call&apos;s chat
          with this card open.
        </p>
      </div>
    </div>
  );
}

/** The thread read into messages, with the reply the register holds for it under them. */
function Messages({
  state,
  drafts,
  id,
  slack,
}: {
  state: ThreadState;
  drafts: readonly HeldDraft[] | undefined;
  id: string;
  /** Whether a Slack token is present, read only once the thread read has failed. */
  slack: SlackConnectionState;
}): ReactElement {
  const key = threadKeyOf({ link: id });
  let channel = "";
  let threadTs = "";
  if (key !== undefined) {
    channel = key.channel;
    threadTs = key.threadTs;
  } else {
    const [c, ts] = id.split(":");
    channel = c!;
    threadTs = ts!;
  }
  let draft: HeldDraft | undefined;
  if (drafts !== undefined) {
    draft = drafts.find((row) => isHeld({ draft: row }) && row.channel === channel && row.threadTs === threadTs);
  }
  // The held reply is drawn whatever the thread read says: a thread the corpus cannot give back is no reason to
  // hide the reply the owner is being asked to send (a card naming a draft always shows it). Keyed on
  // the draft, so a different draft arriving on the poll starts from "copy the verb" again.
  const held = draft === undefined ? null : <HeldReply key={draft.id} draft={draft} />;
  if (state.phase === "loading") {
    return (
      <>
        <ReadingIndicator label="Reading the thread from the corpus" block />
        {held}
      </>
    );
  }
  if (state.phase === "not-measured") {
    // The corpus answers "no such message" whether or not Slack is connected, so Slack's own preflight decides
    // (`../../lib/slackConnection.ts`): no token present, and the thread is unread because Slack is not connected — the
    // connect affordance, not a triangle (`../../lib/integrations.ts`). A token present, or the
    // preflight unreadable, and the read's own reason stands: disconnection was not proved.
    let failed = <StaleMark facts={[{ subject: "The thread", why: state.why }]} block />;
    if (slack.phase === "loading" || slack.phase === "idle") {
      failed = <ReadingIndicator label="Checking whether Slack is connected" block />;
    } else if (slack.phase === "ready" && !slack.tokenPresent) {
      failed = <ConnectIntegration integration={SLACK} subjects={["the thread"]} block />;
    }
    return (
      <>
        {failed}
        {held}
      </>
    );
  }
  const { thread, people } = state;
  let avatars: Avatars | undefined;
  if (people.ok) {
    avatars = people.avatars;
  }
  const place = placeOf({ container: thread.container, records: thread.records });
  return (
    <>
      <p className={THREAD_HEAD}>
        {place.hash && <span className="font-semibold text-muted-foreground">#</span>}
        <b>{place.name}</b>
        <span className="sw-tile-note">
          thread · {String(thread.records.length)} message{thread.records.length === 1 ? "" : "s"} · read{" "}
          {whenOf({ iso: state.observedAtIso })}
        </span>
        {state.stale !== undefined && (
          <StaleMark facts={[{ observedAtIso: state.observedAtIso, subject: "the thread", why: state.stale.why }]} />
        )}
        <a href={thread.anchorUrl} target="_blank" rel="noreferrer" className="ml-auto text-[0.8rem]">
          open in Slack →
        </a>
      </p>
      {/* The thread is read from the stored corpus, so "read" above is when the page fetched it, not how current
          that copy is — this line is the latter, so a thread missing a reply the owner can see in Slack says why. */}
      {/* A block, since a failed sync's reason folds its raw message in a `<details>` no `<p>` may hold. */}
      <div className="sw-tile-note">
        <SourceFreshnessLine source="slack" />
      </div>
      {!people.ok && (
        <StaleMark
          facts={[
            {
              subject: "the authors' pictures",
              why: clauseAfter({ clause: "so initials show instead", joint: ",", reason: people.why }),
            },
          ]}
          className="self-start"
        />
      )}
      <ol className="sw-slack m-0 grid list-none gap-3 rounded-[10px] border border-solid px-[0.75rem] py-[0.7rem]">
        {thread.records.map((record) => (
          <Message key={record.id} record={record} avatars={avatars} />
        ))}
      </ol>
      {thread.limitations.map((line) => (
        <p key={line} className="sw-tile-note italic">
          {line}
        </p>
      ))}
      {held}
    </>
  );
}

/**
 * A Slack thread, read by permalink or `<channel>:<ts>` id, with the reply the register holds for it under it.
 *
 * @param id what the row carried
 * @param drafts the held-draft register's reading, or `undefined` when it is not readable
 * @returns the panel body
 */
export function SlackThread({ id, drafts }: { id: string; drafts: readonly HeldDraft[] | undefined }): ReactElement {
  const state = useThread({ id });
  const slack = useSlackConnection({ key: id, wanted: state.phase === "not-measured" });
  return (
    <section className="grid gap-[0.6rem] pt-[0.2rem] pb-[0.6rem]">
      <Messages state={state} drafts={drafts} id={id} slack={slack} />
    </section>
  );
}
