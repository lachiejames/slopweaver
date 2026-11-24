"use client";

/**
 * The stage's conversation history: the right-hand column, the full height of the stage, every turn — one still being
 * said included, at the bottom, so it never lags what the owner is saying: a turn being said shows like a typing
 * indicator. A turn still being said is no bubble yet:
 * no fill, a lighter weight and a soft caret, and when it ends the same row takes its bubble where it stands. While the
 * owner is heard before any of their words are recognised, three pulsing dots stand where they will appear.
 *
 * Scrolling up holds the view, as in a chat web UI, with a small arrow button at the bottom that takes the reader down
 * to the live view. Once that arrow is pressed it is pinned for good: only a scroll up
 * that leaves the bottom lets go (`followsAfterScroll`), never the arrow's own smooth scroll or a turn growing below.
 * A held view is kept as the row the owner is reading (`site/lib/readingPlace.ts`), so the history drawn next — the
 * stage's after the corner's Messenger tray, or the tray's after the stage — opens where they were, the tray carrying
 * the place across.
 *
 * **The owner's finished turns fold; the voice's stay open**: the owner has no need to reread their own transcript,
 * while the voice's words are useful. A long turn of the owner's shows where it started and where it landed,
 * two lines of each with an ellipsis between (`foldOf`), and a click opens it whole or folds it back. A turn still being
 * said is never folded.
 *
 * **The voice's words are drawn formatted as they stream; the owner's stay as they wrote them.** The voice's typed
 * replies carry blank lines and one option per line, and a bubble that collapsed every newline would read them as one
 * wall of a paragraph. So a voice turn renders as light Markdown through the console's one renderer
 * (`MessageResponse`: no remote media, the measured code themes), paragraphs and lists drawn while it is still
 * arriving, and a single line break inside a paragraph is kept, so a reply written to the older plain-text prompt — one
 * `•` option per line — still reads one per line. The owner's words are never read as Markdown, only kept to their
 * own line breaks.
 *
 * Above the conversation going on now sits every earlier one, spoken or typed, read off the call files and nothing else
 * (the history ends on the last message sent either way, never on supervisor chatter), so a reopened console opens
 * where the two of them stopped. Each stretch after an hour's
 * quiet, or on a new day, opens under its date in words, never a timestamp, and a typed turn carries a small mark.
 * The thread is `site/lib/chatThread.ts`, its carry `site/lib/chatThreadCarried.ts`.
 *
 * **A tapped bubble says when it was said**: tapping a message expands it with extra details, a timestamp among them.
 * A click anywhere on a finished bubble but
 * its fold opens a small line under the words in the divider's own words (`saidAtLabel`), and a second click closes
 * it; hidden by default. A drag that selects words is reading, never a tap. Each bubble carries a disclosure button
 * laid over it that the pointer passes through, so Tab reaches the same toggle. The instant is when the turn began: an
 * earlier turn's `beganIso`, a live one's first showing on this page (`shownAt`), which is the `beganIso` it is carried
 * with, so a turn's time never moves as it leaves the live window. A turn still being said, or a `?said=` preview,
 * opens nothing.
 */
import { type ReactElement, useEffect, useMemo, useState } from "react";

import { CHAT_THREAD_SLUG, dayOf, type EarlierTurn, earlierRowsOf, saidAtLabel } from "../../lib/chatThread";
import { readerTimeZone } from "../../lib/dateTimeFormat";
import type { PlaceKeeper } from "../../lib/readingPlace";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { foldOf, type HeardSegment, speakingIndicatorShows } from "../../lib/voiceTranscript";
import { MessageResponse } from "../ai-elements/message";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { refreshLive } from "../live/useLive";
import { useStageHistoryScroll } from "./useStageHistoryScroll";

/**
 * Every row's frame: the owner's on the right, the voice's on the left. Its fill eases in, so a turn that ends settles
 * into its bubble where it stands rather than being replaced. A token with no break in it — a pasted link — wraps
 * anywhere rather than widening the bubble past the history, which scrolls up and down only.
 */
const TURN =
  "relative max-w-[85%] min-w-0 [overflow-wrap:anywhere] rounded-[12px] border border-solid px-[0.8rem] py-[0.5rem] text-[1.05rem] leading-[1.5] transition-[background-color,border-color] duration-300 data-[who=owner]:self-end motion-reduce:transition-none";

/** A folded turn of the owner's: the whole bubble is the control that opens it, in the bubble's own ink. */
const FOLD =
  "block cursor-pointer whitespace-pre-wrap border-0 bg-transparent p-0 text-left text-inherit focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";

/** The owner's words whole: exactly as written, their own line breaks kept. */
const OWNER_WORDS = "whitespace-pre-wrap";

/**
 * A voice turn's rendered reply, set for a bubble rather than a page: tight paragraph and list spacing, list markers
 * drawn (the reset removes them), a line break inside a paragraph kept, and links in the bubble's own ink, underlined,
 * so no colour is added that the contrast tests do not measure. Static, since `MessageResponse` re-renders only on its
 * words and whether they are still arriving.
 */
const REPLY =
  "[&_p]:my-[0.45rem] [&_p]:whitespace-pre-wrap [&_ul]:my-[0.45rem] [&_ul]:list-disc [&_ul]:pl-[1.2rem] [&_ol]:my-[0.45rem] [&_ol]:list-decimal [&_ol]:pl-[1.4rem] [&_li]:my-[0.15rem] [&_a]:text-inherit [&_a]:underline [&_strong]:font-semibold";

/** A finished turn: an opaque bubble, the owner's in the owner's colour. */
const BUBBLE = `${TURN} border-transparent bg-(--c-panel) data-[who=owner]:bg-[color-mix(in_oklch,var(--c-primary)_22%,var(--c-panel))]`;

/**
 * A turn still being said: no fill and a dashed edge, so it never reads as a sent bubble whose words keep changing,
 * and a lighter weight in the stage's own ink, never dimmed — faded text is text the contrast tests do not measure.
 */
const SAYING = `${TURN} border-dashed border-border bg-transparent font-light text-foreground`;

/** A soft pulsing dot, one of the three standing for the owner's words before they are recognised. */
const DOT = "size-[0.4rem] rounded-full bg-current animate-pulse motion-reduce:animate-none!";

/**
 * The word marking a turn the owner typed rather than spoke, in the turn's own ink: set small and in capitals so it
 * reads as a label, never in the muted colour, which falls under 4.5:1 on the owner's bubble in some palettes.
 */
const TYPED_LABEL = "mr-[0.4rem] text-[0.7rem] uppercase tracking-wide";

/**
 * The line a tapped bubble opens, saying when it was said: small, under the words, in the bubble's own ink, never the
 * muted colour, for the same 4.5:1 reason as the typed label.
 */
const SAID_AT = "mt-[0.2rem] block text-[0.7rem] leading-[1.4]";

/**
 * The disclosure button over a bubble: the pointer passes through it to the words, so they stay selectable and the
 * bubble's own click is the tap, while Tab lands on it and draws the bubble's outline.
 */
const SAID_AT_TOGGLE =
  "pointer-events-none absolute inset-0 rounded-[12px] border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** A date over the stretch below it, centred between the turns, as a messenger draws one. */
const DIVIDER = "max-w-full self-center pt-[0.4rem] text-center text-[0.75rem] text-muted-foreground";

/** No live turn's first showing: what a `?said=` preview passes, so its made-up turns open no time. */
export const NO_SHOWN_AT: ReadonlyMap<string, string> = new Map();

/** The back-to-live arrow, floating over the bottom of the history. */
const ARROW =
  "absolute bottom-3 left-1/2 grid size-9 -translate-x-1/2 cursor-pointer place-items-center rounded-full border border-solid border-border bg-card text-[1rem] shadow-[0_6px_16px_oklch(0_0_0/40%)] hover:bg-(--c-panel) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * The history column.
 *
 * @param history the turns of the conversation going on now, finished or not, oldest first
 * @param hearing whether the owner's voice is being heard right now
 * @param earlier every earlier conversation's turns, oldest first, drawn above
 * @param liveMedium whether the conversation going on now is spoken or typed
 * @param unread the calls the last read could not open, each with why, drawn as one staleness mark after the earlier
 *   turns
 * @param reading whether the thread's first read is still in flight with nothing held, drawn as a progress indicator
 *   when nothing else is
 * @param place where the owner was reading, kept by the widget across every history it draws: read when this one opens,
 *   and written as they scroll, `undefined` while they follow the newest turn
 * @param shownAt when the page first showed each live turn, by id, what a tapped live bubble says; empty for a
 *   preview, whose bubbles open nothing
 * @returns the column
 */
export function StageHistory({
  history,
  hearing,
  earlier,
  liveMedium,
  unread,
  reading,
  place,
  shownAt,
}: {
  history: readonly HeardSegment[];
  hearing: boolean;
  earlier: readonly EarlierTurn[];
  liveMedium: EarlierTurn["medium"];
  unread: readonly StalenessFact[] | undefined;
  reading: boolean;
  place: PlaceKeeper;
  shownAt: ReadonlyMap<string, string>;
}): ReactElement {
  // Empty on the server, which reads no thread, so the reader's own clock and zone never meet a server render. The
  // same instant and zone word a tapped bubble's line, which only a click in the browser opens.
  // The rows are worded once per change of history or of the owner's day, never per render: a call re-renders this on every
  // transcript delta, and wording 200 turns each time ran the voice's renderer out of memory (`dateTimeFormat.ts`).
  const nowIso = new Date().toISOString();
  const [timeZone] = useState(readerTimeZone);
  const today = dayOf({ atMs: Date.parse(nowIso), timeZone });
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `today` stands for `nowIso`: the words change only when the owner's day does
  const earlierRows = useMemo(() => earlierRowsOf({ nowIso, timeZone, turns: earlier }), [earlier, timeZone, today]);
  const speaking = speakingIndicatorShows({ hearing, segments: history });
  // Opening the history reads the thread again: a call held in another window, or a page mounted before the last
  // conversation, would otherwise open on the read this page took when it loaded.
  useEffect(() => {
    refreshLive({ slug: CHAT_THREAD_SLUG });
  }, []);
  // Every shown turn's words and state, not only the newest's: during barge-in the voice's earlier turn still grows
  // above the owner's, and a recognition rewrite can keep a turn's length. Forty turns at most, so the key stays small.
  // The earlier turns count too: they alone can turn "Nothing said yet" into the list.
  const pin = [
    ...earlier.map((turn) => turn.id),
    // The staleness mark is one row whatever it says, so only whether it is drawn moves the history.
    String(unread !== undefined),
    String(speaking),
    ...history.map((segment) => `${segment.id}:${String(segment.final)}:${segment.text}`),
  ].join("\n");
  const { backToLive, held, list, onScroll, opened, tapBubble, timed, toggle, toggleTime } = useStageHistoryScroll({
    pin,
    place,
  });
  const empty = history.length === 0 && earlierRows.length === 0 && unread === undefined && !speaking;
  // An empty history still being read is a progress indicator, never a sentence; only a read that came back empty
  // says nothing was said.
  let emptyShown = <p className="m-0 self-end text-center text-[0.85rem] text-muted-foreground">Nothing said yet.</p>;
  if (reading) {
    emptyShown = <ReadingIndicator label="reading what you and the voice said before" block className="self-end" />;
  }
  return (
    <section aria-label="the conversation" className="relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]">
      {empty ? (
        emptyShown
      ) : (
        <ol
          ref={list}
          data-stage-scroll="true"
          aria-label="what was said"
          className="m-0 flex min-h-0 list-none flex-col items-start gap-[0.5rem] [overflow-anchor:none] [&>li:first-child]:mt-auto overflow-y-auto p-0 pt-8 pr-1"
          onScroll={onScroll}
        >
          {earlierRows.map((row) => {
            if (row.kind === "divider") {
              return (
                <li key={row.key} data-row={`divider:${row.key}`} data-medium="divider" className={DIVIDER}>
                  {row.label}
                </li>
              );
            }
            // An earlier turn is settled, even one a dropped call cut off: it ends on an ellipsis, never the live caret.
            const { final, id, medium, text, who } = row.turn;
            return (
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the pointer's tap on the whole bubble, words still selectable; its keyboard twin is SaidAt's native button inside, so a key handler here would toggle twice
              <li
                key={id}
                data-row={`earlier:${id}`}
                data-who={who}
                data-medium={medium}
                data-final={final}
                className={BUBBLE}
                onClick={(event) => {
                  tapBubble({ event, id });
                }}
              >
                {medium === "typed" ? <span className={TYPED_LABEL}>typed</span> : null}
                <Said
                  id={id}
                  text={final ? text : `${text} …`}
                  who={who}
                  arriving={false}
                  folds={who === "owner"}
                  opened={opened}
                  onToggle={toggle}
                />
                <SaidAt id={id} label={row.saidAt} open={timed.has(id)} onToggle={toggleTime} />
              </li>
            );
          })}
          {unread === undefined ? null : (
            <li key="unread" data-row="unread" data-medium="divider" className={DIVIDER}>
              <StaleMark facts={unread} />
            </li>
          )}
          {history.map(({ final, id, text, who }) => {
            // Only a finished turn the page saw begin says when: one still being said is no message yet, and a
            // preview's turns were never shown live at all.
            const began = shownAt.get(id);
            let saidAt: ReactElement | null = null;
            if (final && began !== undefined) {
              saidAt = (
                <SaidAt
                  id={id}
                  label={saidAtLabel({ atIso: began, nowIso, timeZone })}
                  open={timed.has(id)}
                  onToggle={toggleTime}
                />
              );
            }
            return (
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- as the earlier bubble's: the pointer's tap, with SaidAt's native button as its keyboard twin
              <li
                key={id}
                data-row={`live:${id}`}
                data-who={who}
                data-medium={liveMedium}
                data-final={final}
                className={final ? BUBBLE : SAYING}
                onClick={(event) => {
                  if (saidAt !== null) {
                    tapBubble({ event, id });
                  }
                }}
              >
                {liveMedium === "typed" ? <span className={TYPED_LABEL}>typed</span> : null}
                <Said
                  id={id}
                  text={text}
                  who={who}
                  arriving={!final}
                  folds={final && who === "owner"}
                  opened={opened}
                  onToggle={toggle}
                />
                {final ? null : (
                  <span
                    aria-hidden="true"
                    className="ml-[0.15rem] inline-block h-[1em] w-[2px] animate-pulse bg-current align-[-0.15em] motion-reduce:animate-none!"
                  />
                )}
                {saidAt}
              </li>
            );
          })}
          {speaking ? (
            <li data-row="speaking" data-who="owner" data-medium="speaking" className={SAYING}>
              <span className="sr-only">you are speaking</span>
              <span aria-hidden="true" className="inline-flex h-[1.3em] items-center gap-[0.3rem]">
                <span className={DOT} />
                <span className={`${DOT} [animation-delay:200ms]`} />
                <span className={`${DOT} [animation-delay:400ms]`} />
              </span>
            </li>
          ) : null}
        </ol>
      )}
      {held ? (
        <button
          type="button"
          className={ARROW}
          aria-label="back to the live conversation"
          title="back to the live conversation"
          onClick={backToLive}
        >
          ↓
        </button>
      ) : null}
    </section>
  );
}

/**
 * A bubble's when-it-was-said: the line under its words while open, and the disclosure button laid over the bubble
 * that Tab reaches, Enter and Space press, and the pointer passes through to the bubble's own tap.
 */
function SaidAt({
  id,
  label,
  open,
  onToggle,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: (turn: { id: string; from: HTMLElement }) => void;
}): ReactElement {
  let name = "show when this was said";
  if (open) {
    name = "hide when this was said";
  }
  return (
    <>
      {open ? <span className={SAID_AT}>{label}</span> : null}
      <button
        type="button"
        className={SAID_AT_TOGGLE}
        aria-expanded={open}
        aria-label={name}
        onClick={(event) => {
          const turn = event.currentTarget.closest("li");
          if (turn !== null) {
            onToggle({ from: turn, id });
          }
        }}
      />
    </>
  );
}

/**
 * One turn's words. The voice's render as light Markdown, drawn as they arrive. The owner's are literal: whole, or — a
 * finished turn of theirs long enough to fold — its opening and its close, at most two lines each, with an ellipsis at
 * the gap; a click opens it whole and a second folds it back.
 */
function Said({
  id,
  text,
  who,
  arriving,
  folds,
  opened,
  onToggle,
}: {
  id: string;
  text: string;
  who: HeardSegment["who"];
  /** Whether the words are still arriving, so a half-written list or emphasis is drawn as it will end. */
  arriving: boolean;
  folds: boolean;
  opened: ReadonlySet<string>;
  onToggle: (turn: { id: string; from: HTMLElement }) => void;
}): ReactElement {
  if (who !== "owner") {
    return (
      <MessageResponse className={REPLY} isAnimating={arriving}>
        {text}
      </MessageResponse>
    );
  }
  const fold = foldOf({ text });
  if (!folds || fold.kind === "whole") {
    return <span className={OWNER_WORDS}>{text}</span>;
  }
  const open = opened.has(id);
  let shown = (
    <>
      <span className="line-clamp-2">{fold.head} …</span>
      <span className="flex max-h-[2lh] flex-col justify-end overflow-hidden">
        <span>… {fold.tail}</span>
      </span>
    </>
  );
  let title = "show all of what you said";
  if (open) {
    shown = <>{text}</>;
    title = "fold it back to where you started and where you landed";
  }
  return (
    <button
      type="button"
      className={FOLD}
      aria-expanded={open}
      title={title}
      onClick={(event) => {
        // The turn's whole bubble, not this button inset in its padding, is what is in or out of view.
        const turn = event.currentTarget.closest("li");
        if (turn !== null) {
          onToggle({ from: turn, id });
        }
      }}
    >
      {shown}
    </button>
  );
}
