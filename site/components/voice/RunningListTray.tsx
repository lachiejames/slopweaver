"use client";

/**
 * The running list's tray, above the corner's bar or in the stage's left half: the newest ten things the owner, the
 * voice and the fleet left for each other, each with a copy icon at its top right, and a box at the foot to add the
 * owner's own (`../../lib/runningList.ts`). It is an always-available running list, separate from the transcript,
 * that all three add to and the owner copies from in one click.
 *
 * It reads like Messenger: newest at the bottom. It opens at the foot and follows each new item in while the owner is
 * there; one arriving while they read older ones keeps them where they are and shows "New message below", which
 * takes them down.
 *
 * The voice's items are drawn the way Slack will show them and copy formatted (`../../lib/runningListCopy.ts`); the
 * owner's and the fleet's are plain text and copy as written. A long voice message folds where the voice folded it:
 * the head at once, the rest behind a closed,
 * native "Show more" disclosure, which the keyboard and a screen reader open with nothing added, a code fence read
 * across the fold. The copy is always the WHOLE message, open or not. A `<@U…>` is drawn as the person's name when the
 * console's people reading knows it, and the copy keeps the tag. The icon turns to a tick only once the clipboard
 * write resolved; a browser that refuses it gets the item's text selected instead, so ⌘C still takes it. The tray
 * works the same with a call up or none.
 */
import { Check, Copy, Plus } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ageOf } from "../../lib/ageOf";
import type { RunningListItem } from "../../lib/runningList";
import { copyHtmlOf, runningListItemLines } from "../../lib/runningListCopy";
import { runningListArrival, runningListItemsOldestFirst, runningListWho } from "../../lib/runningListDraw";
import type { FencedLine } from "../../lib/slackEmoji";
import type { MentionLabels } from "../../lib/slackMrkdwn";
import { followsAfterScroll, isAtBottom } from "../../lib/voiceTranscript";
import { useCopyReceipt } from "../console/CopyBlock";
import { PlainWhy } from "../console/RawFold";
import { MrkdwnSegments } from "../console/SlackActionPreview";
import { SpinnerBlock } from "../ui/spinner";
import type { RunningListState } from "./useRunningList";

/** A round icon control, the call card's own size, quieter. */
const ICON =
  "grid size-[1.6rem] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted-foreground hover:bg-(--c-panel) hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-40";

/** The "New message below" button, floating over the foot of the list as the conversation's arrow does. */
const NEW_BELOW =
  "absolute bottom-3 left-1/2 -translate-x-1/2 cursor-pointer rounded-full border border-solid border-border bg-card px-[0.8rem] py-[0.3rem] text-[0.75rem] text-foreground shadow-[0_6px_16px_oklch(0_0_0/40%)] hover:bg-(--c-panel) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * The tray.
 *
 * @param list the running list, its add included
 * @returns the tray's body
 */
export function RunningListTray({ list }: { list: RunningListState }): ReactElement {
  const items = list.snapshot === undefined ? [] : list.snapshot.items;
  const newest = items.at(0)?.seq;
  // The tray is drawn only while the owner can see it, so what it holds is seen: anything unread while it is open — on
  // opening, an item arriving, or a cursor brought down under it by a restarted list — is marked at once.
  const { markSeen, unread } = list;
  useEffect(() => {
    if (unread > 0) {
      markSeen();
    }
  }, [markSeen, unread]);
  let body: ReactElement;
  if (items.length > 0) {
    body = <ItemsOldestFirst items={items} newest={newest} labels={list.labels} />;
  } else if (list.snapshot === undefined && list.failure === undefined) {
    body = <SpinnerBlock label="reading the running list" className="self-center" />;
  } else {
    // A `div`, so the failure's raw message can fold under its plain line.
    let words: ReactElement = (
      <>Nothing on the list yet. Add something below, or ask the voice for a message to paste yourself.</>
    );
    if (list.failure !== undefined) {
      words = (
        <>
          The list could not be read: <PlainWhy why={list.failure} />
        </>
      );
    }
    body = (
      <div className="m-0 self-center px-[0.8rem] py-[1rem] text-center text-[0.75rem] text-muted-foreground">
        {words}
      </div>
    );
  }
  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      {body}
      <AddBox add={list.add} />
    </div>
  );
}

/**
 * The items, oldest at the top, opening at the foot and following each new one in while the owner is there.
 *
 * @param items the list, newest first, as the wire carries it
 * @param newest the newest item's number
 * @param labels the names a mention chip reads
 * @returns the scrolling list and, when one arrived while the owner reads older ones, "New message below"
 */
function ItemsOldestFirst({
  items,
  newest,
  labels,
}: {
  items: readonly RunningListItem[];
  newest: number | undefined;
  labels: MentionLabels;
}): ReactElement {
  const scroller = useRef<HTMLOListElement>(null);
  // Whether the list sits at its foot, newest in view: the ref for the scroll handler and effects, the state for render.
  const following = useRef(true);
  const lastTop = useRef(0);
  const [atFoot, setAtFoot] = useState(true);
  const [unseenBelow, setUnseenBelow] = useState(false);
  // During render, React's own pattern for state derived from a prop: an item arriving while the owner reads older ones
  // keeps them where they are and says a new one is below.
  const [drawn, setDrawn] = useState(newest);
  if (drawn !== newest) {
    setDrawn(newest);
    if (runningListArrival({ drawnSeq: drawn, following: atFoot, newestSeq: newest }) === "hold") {
      setUnseenBelow(true);
    }
  }
  // Opening on the newest, and following each one in while the owner is at the foot, before the frame draws.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null && following.current && newest !== undefined) {
      element.scrollTop = element.scrollHeight;
      lastTop.current = element.scrollTop;
    }
  }, [newest]);
  const onScroll = (): void => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    const atBottom = isAtBottom({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    });
    following.current = followsAfterScroll({
      atBottom,
      following: following.current,
      lastScrollTop: lastTop.current,
      scrollTop: element.scrollTop,
    });
    lastTop.current = element.scrollTop;
    // Only a change reaches React, never every frame of a smooth scroll.
    if (following.current !== atFoot) {
      setAtFoot(following.current);
    }
    if (atBottom && unseenBelow) {
      setUnseenBelow(false);
    }
  };
  const toNewest = (): void => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    following.current = true;
    lastTop.current = element.scrollTop;
    setAtFoot(true);
    setUnseenBelow(false);
    element.scrollTo({ behavior: "smooth", top: element.scrollHeight });
  };
  return (
    <div className="relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]">
      <ol
        ref={scroller}
        aria-label="the running list, newest last"
        className="m-0 grid min-h-0 list-none content-start gap-[0.7rem] overflow-y-auto px-[0.8rem] py-[0.7rem]"
        onScroll={onScroll}
      >
        {runningListItemsOldestFirst({ items }).map((item) => (
          <ListItem key={item.seq} item={item} labels={labels} />
        ))}
      </ol>
      {unseenBelow && !atFoot ? (
        <button type="button" className={NEW_BELOW} onClick={toNewest}>
          New message below ↓
        </button>
      ) : null}
    </div>
  );
}

/** One item: who and when above it, its label, its text in a box, and the copy icon at the box's top right. */
function ListItem({ item, labels }: { item: RunningListItem; labels: MentionLabels }): ReactElement {
  const shown = useRef<HTMLDivElement>(null);
  const formatted = item.origin === "voice";
  const write = async (): Promise<void> => {
    if (!formatted) {
      await navigator.clipboard.writeText(item.text);
      return;
    }
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([copyHtmlOf({ labels, text: item.text })], { type: "text/html" }),
        "text/plain": new Blob([item.text], { type: "text/plain" }),
      }),
    ]);
  };
  const { copy, state } = useCopyReceipt({ node: shown, write });
  let word = "copy";
  if (state === "copied") {
    word = "copied";
  } else if (state === "refused") {
    word = "selected, press ⌘C";
  }
  return (
    <li className="grid min-w-0 gap-[0.3rem]" data-origin={item.origin}>
      <span className="flex min-w-0 gap-[0.4rem] text-[0.72rem] text-muted-foreground">
        <span className="shrink-0">{runningListWho({ item })}</span>
        <span aria-hidden="true">·</span>
        <time className="shrink-0" dateTime={item.atIso} title={item.atIso}>
          {ageOf({ iso: item.atIso })}
        </time>
        {item.label === undefined ? null : (
          <>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate">{item.label}</span>
          </>
        )}
      </span>
      <div className="relative min-w-0 rounded-[8px] border border-solid sw-glass-control text-[0.8rem] leading-[1.5]">
        <div ref={shown} className="min-w-0 py-[0.5rem] pr-[2.2rem] pl-[0.7rem]">
          {formatted ? (
            <Formatted item={item} labels={labels} />
          ) : (
            <p className="m-0 wrap-anywhere whitespace-pre-wrap">{item.text}</p>
          )}
        </div>
        <button
          type="button"
          className={`${ICON} absolute top-[0.25rem] right-[0.25rem] data-[state=copied]:text-primary`}
          aria-label={word}
          title={word}
          aria-live="polite"
          data-state={state}
          onClick={() => {
            void copy();
          }}
        >
          {state === "copied" ? (
            <Check aria-hidden="true" className="size-[0.9rem]" />
          ) : (
            <Copy aria-hidden="true" className="size-[0.9rem]" />
          )}
        </button>
      </div>
    </li>
  );
}

/** One stretch of a message, a paragraph per line, its fences already read over the whole message. */
function MrkdwnLines({ lines, labels }: { lines: readonly FencedLine[]; labels: MentionLabels }): ReactElement {
  return (
    <>
      {lines.map(({ segments }, index) => (
        // eslint-disable-next-line react/no-array-index-key -- a message's lines have no id; the index IS the line
        <p key={index} className="m-0 min-h-[1.2em] wrap-anywhere">
          <MrkdwnSegments labels={labels} segments={segments} inert />
        </p>
      ))}
    </>
  );
}

/** The voice's message, drawn the way Slack will show it: its head, and its fold behind "Show more" when it has one. */
function Formatted({ item, labels }: { item: RunningListItem; labels: MentionLabels }): ReactElement {
  const { head, fold } = runningListItemLines({ item });
  if (fold === undefined) {
    return (
      <div>
        <MrkdwnLines lines={head} labels={labels} />
      </div>
    );
  }
  return (
    <div>
      <MrkdwnLines lines={head} labels={labels} />
      <details className="group/fold" data-fold="below">
        <summary className="w-fit cursor-pointer list-none text-[0.75rem] text-muted-foreground underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
          <span className="group-open/fold:hidden">Show more</span>
          <span className="hidden group-open/fold:inline">Show less</span>
        </summary>
        <MrkdwnLines lines={fold} labels={labels} />
      </details>
    </div>
  );
}

/**
 * The box the owner adds with: Enter adds, Shift+Enter is a new line, and nothing happens mid-composition. What was
 * typed stays until the list holds it, so a refusal never loses it.
 */
function AddBox({ add }: { add: RunningListState["add"] }): ReactElement {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const empty = draft.trim() === "";
  const submit = async (): Promise<void> => {
    if (empty || adding) {
      return;
    }
    setAdding(true);
    const why = await add({ text: draft });
    setAdding(false);
    setRefusal(why);
    if (why === undefined) {
      setDraft("");
    }
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void submit();
  };
  return (
    <div className="grid gap-[0.3rem] border-0 border-t border-solid border-border px-[0.8rem] py-[0.55rem]">
      {refusal === undefined ? null : (
        // A `div`, so the refusal's raw message folds under its plain line rather than leading.
        <div className="m-0 text-[0.72rem] text-danger" role="alert">
          Not added: <PlainWhy why={refusal} />
        </div>
      )}
      <div className="flex items-end gap-[0.4rem]">
        <textarea
          aria-label="add to the running list"
          className="max-h-[6rem] min-h-[1.9rem] min-w-0 flex-1 resize-none rounded-[8px] border border-solid border-border bg-transparent px-[0.6rem] py-[0.35rem] text-[0.8rem] leading-[1.4] text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          placeholder="Add to the list"
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={onKey}
        />
        <button
          type="button"
          className={ICON}
          aria-label="add to the running list"
          title="add to the running list"
          disabled={empty || adding}
          onClick={() => {
            void submit();
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
