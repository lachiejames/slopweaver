"use client";

import { type ReactElement, type RefObject, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { BUTTON } from "./controls";

/** Where one copy button is: waiting, just copied, or refused by the browser. */
export type CopyState = "idle" | "copied" | "refused";

/**
 * What the button says in each state. "copied ✓" is the receipt of a one-click copy, shown only once the clipboard write RESOLVED, never on the click alone.
 */
const COPY_LABEL: Readonly<Record<CopyState, string>> = {
  copied: "copied ✓",
  idle: "copy",
  refused: "selected: press ⌘C",
};

/** How long the receipt stays before the button reads `copy` again, so a second copy gets a second receipt. */
const RECEIPT_MS = 2000;

/**
 * One copy button's clipboard write and its receipt: "copied ✓" once the write resolves, and when the browser
 * refuses the clipboard the node's text selected instead, so ⌘C still takes it.
 *
 * @param write the clipboard write a press makes
 * @param node what is selected when the browser refuses it
 * @returns the button's state and what a press runs
 */
export function useCopyReceipt({ write, node }: { write: () => Promise<void>; node: RefObject<HTMLElement | null> }): {
  state: CopyState;
  copy: () => Promise<void>;
} {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const settle = ({ next }: { next: CopyState }): void => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState("idle");
    }, RECEIPT_MS);
  };
  const copy = async (): Promise<void> => {
    try {
      await write();
      settle({ next: "copied" });
    } catch {
      const shown = node.current;
      const selection = window.getSelection();
      if (shown !== null && selection !== null) {
        selection.selectAllChildren(shown);
      }
      settle({ next: "refused" });
    }
  };
  return { copy, state };
}

/** The button a copy wears, its word the receipt. */
function CopyButton({ state, copy }: { state: CopyState; copy: () => Promise<void> }): ReactElement {
  return (
    <button
      type="button"
      aria-live="polite"
      data-state={state}
      className={cn(BUTTON, "self-start px-[0.55rem] py-1 data-[state=copied]:text-(--c-primary)")}
      onClick={() => {
        void copy();
      }}
    >
      {COPY_LABEL[state]}
    </button>
  );
}

/**
 * The exact string the owner pastes, whole and wrapped, with a button that puts it on their clipboard and says so.
 *
 * Never truncated and never folded: a command cut short pastes as a different command. One block holds one
 * command — a step with two is a checklist, one block per line (`./HandChecklist.tsx`). When the browser refuses
 * the clipboard the text is selected instead, so ⌘C still takes it.
 *
 * @param text the literal, exactly as the register recorded it
 * @returns the block
 */
export function CopyBlock({ text }: { text: string }): ReactElement {
  const pre = useRef<HTMLPreElement>(null);
  const { copy, state } = useCopyReceipt({ node: pre, write: async () => navigator.clipboard.writeText(text) });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-[0.55rem]">
      <pre
        ref={pre}
        className="m-0 rounded-[8px] border border-solid sw-glass-control px-[0.7rem] py-[0.5rem] font-mono text-[0.78rem] leading-[1.5] break-all whitespace-pre-wrap select-all"
      >
        {text}
      </pre>
      <CopyButton copy={copy} state={state} />
    </div>
  );
}

/**
 * A formatted message beside a button that copies it formatted: HTML for a paste into Slack's composer and the plain
 * text for anything else, in one clipboard write. When the browser refuses that write the shown message is selected
 * instead, so ⌘C still takes it as drawn.
 *
 * @param plain what a plain-text paste gets: the message's mrkdwn
 * @param html what a rich paste gets, built as data and never drawn here
 * @param children the message as drawn
 * @returns the block
 */
export function RichCopyBlock({
  plain,
  html,
  children,
}: {
  plain: string;
  html: string;
  children: ReactElement;
}): ReactElement {
  const shown = useRef<HTMLDivElement>(null);
  const write = async (): Promise<void> => {
    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
  };
  const { copy, state } = useCopyReceipt({ node: shown, write });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-[0.55rem]">
      <div
        ref={shown}
        className="m-0 min-w-0 rounded-[8px] border border-solid sw-glass-control px-[0.7rem] py-[0.5rem] text-[0.8rem] leading-[1.5]"
      >
        {children}
      </div>
      <CopyButton copy={copy} state={state} />
    </div>
  );
}
