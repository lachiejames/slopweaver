"use client";

import { type ReactElement, type ReactNode, useEffect, useRef } from "react";

/**
 * One titled block of a panel's body, ruled off from the block above it; its `<h4>` is the small uppercase label.
 */
export const SLIDE_SECTION =
  "mt-[0.9rem] border-t border-t-border/60 pt-[0.6rem] [&_h4]:mt-0 [&_h4]:mb-[0.35rem] [&_h4]:text-[0.72rem] [&_h4]:font-bold [&_h4]:tracking-[0.04em] [&_h4]:text-muted-foreground [&_h4]:uppercase";

/** The line a section prints when it has nothing to list. */
export const SLIDE_EMPTY = "m-0 text-muted-foreground";

/**
 * A panel's scrolling body: the card, and the reasoning column beside it — stacked under it on a narrow window. An
 * item marked `col-span-full` continues full width beneath both, which is where anything of unbounded length goes: a
 * tall item in the 300px column leaves the body empty to its left once the card has scrolled past.
 * `sw-slide-body` (`../../app/console-tw.css`) is what keeps each column its own width whatever it holds: a long URL
 * in a card's quoted thread once ran the body under the facts column.
 */
export const SLIDE_BODY =
  "sw-slide-body grid flex-1 grid-cols-[minmax(0,1fr)_300px] gap-[1.3rem] overflow-y-auto px-[1.3rem] py-[1.2rem] max-[900px]:grid-cols-[minmax(0,1fr)]";

/** The same body with one column, for a panel whose card is folded and whose reasoning sits inside the fold. */
export const SLIDE_BODY_FOLDED =
  "sw-slide-body grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-[1.3rem] overflow-y-auto px-[1.3rem] py-[1.2rem]";

/**
 * The body a working session opens into: its transcript in four fifths, its properties in the last fifth (an 80/20 split) — stacked on a narrow window, like the Queue's.
 */
export const SLIDE_BODY_SESSION =
  "sw-slide-body grid flex-1 grid-cols-[minmax(0,4fr)_minmax(12rem,1fr)] items-start gap-[1.3rem] overflow-y-auto px-[1.3rem] py-[1.2rem] max-[900px]:grid-cols-[minmax(0,1fr)]";

/** The session body's property column: it stays in view while the transcript beside it scrolls, until it stacks. */
export const SLIDE_ASIDE_STICKY = "sticky top-0 self-start max-[900px]:static";

/** The small print that closes a panel's act bar, on a line of its own under the buttons. */
export const SLIDE_FOOT_NOTE = "m-0 basis-full text-[0.74rem] text-muted-foreground";

/**
 * A panel's act bar, pinned under the body.
 *
 * @param children the buttons, outcome line and small print
 * @returns the bar
 */
export function SlideFoot({ children }: { children: ReactNode }): ReactElement {
  return (
    <footer className="sw-glass-plane sw-glass-ground flex flex-wrap items-center gap-[0.6rem] border-t border-border px-[1.3rem] py-[0.9rem] shadow-none">
      {children}
    </footer>
  );
}

/**
 * The one panel shell every row on the site opens into.
 *
 * This is the archive's platform-native panel: right-anchored over the list, the list still there behind
 * it, three ways out — its one button, the backdrop, Escape. The shell owns the ways out and the focus
 * lifecycle, and nothing else: what goes inside is the row the list already holds, so a panel can never
 * show a different instant than the row beside it.
 *
 * What it may carry in its footer is the console's business, not the shell's: the
 * queue's panels approve. The shell gives the footer one guard: while `busy` is set — an act in flight —
 * none of the three ways out closes it, because a panel that vanishes mid-send leaves the reader unsure
 * whether anything happened.
 *
 * @param label what assistive technology calls the dialog
 * @param tag the short state word drawn before the title, when the panel is about a state rather than a card — a
 *   Queue card draws none, the question is its own heading
 * @param title the row's own heading
 * @param icon the platform tile drawn before the title, when the surface has one
 * @param meta the line under the title — subject, age, source
 * @param note a fold under that line, when the panel has one: a Queue card's laps (`../console/CardLaps.tsx`)
 * @param onClose what closing the panel does
 * @param busy holds the panel open while an act is in flight
 * @param footer the act bar, when the panel has one; absent on a read-only view
 * @param children the body, every line a field a verb printed
 * @returns the panel
 */
export function SlideOver({
  label,
  tag,
  title,
  icon,
  meta,
  note,
  onClose,
  busy = false,
  footer,
  children,
}: {
  label: string;
  tag?: ReactNode;
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  note?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    // The listener is written inline so its event type is the DOM's own contract rather than a restated one,
    // and an AbortController removes it, which is what the inline shape needs.
    const control = new AbortController();
    window.addEventListener(
      "keydown",
      (event) => {
        // An Escape something inside already handled — a menu closing — is not a request to close the panel.
        // This is the platform's dialog convention, not a Slopweaver hotkey: the console has none.
        if (event.key === "Escape" && !busy && !event.defaultPrevented) {
          onClose();
        }
      },
      { signal: control.signal },
    );
    return () => {
      control.abort();
    };
  }, [onClose, busy]);
  // Focus moves into the panel when it opens and back to whatever opened it when it closes, so a keyboard
  // reader lands on the panel rather than on the list behind it and is not stranded afterwards.
  useEffect(() => {
    const before = document.activeElement;
    panel.current?.focus();
    return () => {
      if (before instanceof HTMLElement) {
        before.focus();
      }
    };
  }, []);
  const close = (): void => {
    if (!busy) {
      onClose();
    }
  };
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 dark:bg-black/45" onClick={close} aria-hidden="true" />
      <aside
        className="fixed top-0 right-0 bottom-0 z-41 flex w-[min(85vw,1100px)] flex-col overflow-y-auto sw-glass border-y-0 border-r-0 border-l border-solid pb-24 text-[0.82rem] text-foreground outline-none max-[760px]:w-screen"
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        ref={panel}
      >
        {/* Top-aligned, not centred: the heading is the ASK, so it runs to two or three lines, and a centred tile
            and close button would drift down beside it. */}
        <header className="m-0 flex items-start gap-[0.8rem] border-b border-border px-[1.3rem] py-4">
          {icon}
          <div className="min-w-0 flex-1">
            <h3 className="m-0 flex flex-1 items-baseline gap-2 text-[1.02rem] leading-[1.5] font-bold">
              {tag} {title}
            </h3>
            {meta !== undefined && <p className="mt-[0.15rem] mb-0 text-[0.78rem] text-muted-foreground">{meta}</p>}
            {note}
          </div>
          <button
            type="button"
            className="flex-none cursor-pointer rounded-[6px] border border-border bg-muted px-2 py-[0.15rem]"
            onClick={close}
            aria-label="close"
            disabled={busy}
          >
            ×
          </button>
        </header>
        {children}
        {footer}
      </aside>
    </>
  );
}

/**
 * The `open` control a row carries. It prevents the default so a button inside a `<details>` summary opens
 * the panel and does not also unfold the row; in a table cell the prevention is harmless.
 *
 * @param row what the panel will show — handed back to `onOpen` untouched
 * @param onOpen what opening does, given the row
 * @returns the button
 */
export function OpenButton<T>({ row, onOpen }: { row: T; onOpen: (row: T) => void }): ReactElement {
  return (
    <button
      type="button"
      className="ml-auto flex-none cursor-pointer rounded-[6px] border border-border bg-muted px-[0.45rem] py-[0.05rem]"
      onClick={(event) => {
        event.preventDefault();
        onOpen(row);
      }}
    >
      open
    </button>
  );
}
