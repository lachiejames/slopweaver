"use client";

/**
 * The console window's failure toasts: when the voice fails at something it tried for the owner, a toast says so at the top
 * middle of this window — never over other apps, never beside the orb. The call runs in the desktop app's voice
 * window; the shell forwards each failure here, to the tab the owner is looking at (`desktop/src/main.ts`). Which outcomes
 * are failures is `site/lib/voiceFailureToast.ts`; every one is its own toast, the same failure twice two toasts.
 *
 * Each toast is one line and its reason said plainly under it, the raw message folded (rule 7). A card that did not open adds "Open in new tab",
 * which opens that card as a new tab in the desktop app on the owner's click — never their browser — and
 * never by itself. It leaves by
 * itself after a few seconds unless the owner is over it, in it or has opened it, and a close button takes it now.
 */
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { voiceFailureNoticeWireOf } from "../../lib/desktopShell";
import {
  dismissToast,
  expireToasts,
  NO_TOASTS,
  nextExpiryMs,
  receiveNotice,
  shownToasts,
  type VoiceFailureToast,
  type VoiceFailureToastState,
} from "../../lib/voiceFailureToast";
import { desktopBridge } from "../voice/useDesktopShell";
import { useLatest } from "../voice/useLatest";
import { PlainWhy } from "./RawFold";

/**
 * The stack, fed by the shell's forwarded failures in the console window; nothing in a browser or the voice's window.
 *
 * @returns the toasts, or nothing while there are none
 */
export function VoiceFailureToasts(): ReactElement | null {
  const [state, setState] = useState<VoiceFailureToastState>(NO_TOASTS);
  const [held, setHeld] = useState<ReadonlySet<number>>(new Set());
  const heldNow = useLatest({ value: held });

  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge?.role !== "main" || bridge.onVoiceFailure === undefined) {
      return undefined;
    }
    return bridge.onVoiceFailure((value) => {
      const notice = voiceFailureNoticeWireOf({ value });
      if (notice !== undefined) {
        setState((now) => receiveNotice({ notice, nowMs: Date.now(), state: now }));
      }
    });
  }, []);

  // One timer, for the next toast due to leave; re-armed whenever the stack or what the owner holds changes.
  useEffect(() => {
    const due = nextExpiryMs({ held, state });
    if (due === undefined) {
      return undefined;
    }
    const timer = setTimeout(
      () => {
        setState((now) => expireToasts({ held: heldNow.current, nowMs: Date.now(), state: now }));
      },
      Math.max(0, due - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [held, heldNow, state]);

  // Stable, and a no-op when nothing moves, so a toast reporting its hold on every render settles.
  const hold = useCallback(({ id, on }: { id: number; on: boolean }): void => {
    setHeld((now) => {
      if (now.has(id) === on) {
        return now;
      }
      const next = new Set(now);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);
  const close = useCallback(
    ({ id }: { id: number }): void => {
      hold({ id, on: false });
      setState((now) => dismissToast({ id, nowMs: Date.now(), state: now }));
    },
    [hold],
  );

  const shown = shownToasts({ state });
  if (shown.length === 0) {
    return null;
  }
  // Read here, not in a server render: a toast exists only after the shell forwarded a failure in this window.
  const openInNewTab = desktopBridge()?.openQueueCardInNewTab;
  return (
    <div
      data-voice-failure-toasts=""
      className="pointer-events-none fixed inset-x-0 top-12 z-50 flex flex-col items-center gap-2 px-4"
    >
      {shown.map((toast) => (
        <FailureToast key={toast.id} toast={toast} hold={hold} close={close} openInNewTab={openInNewTab} />
      ))}
    </div>
  );
}

/** The shell's way to open a card as a new tab in this app; absent in a shell built before it. */
type OpenInNewTab = ((input: { readonly key: string }) => void) | undefined;

/**
 * One toast: the line, its reason behind a disclosure, "Open in new tab" for a card that did not open, and a close
 * button.
 *
 * @returns the toast
 */
function FailureToast({
  toast,
  hold,
  close,
  openInNewTab,
}: {
  toast: VoiceFailureToast;
  hold: (input: { id: number; on: boolean }) => void;
  close: (input: { id: number }) => void;
  openInNewTab: OpenInNewTab;
}): ReactElement {
  const { cardKey, id } = toast;
  const [open, setOpen] = useState(false);
  const [pointer, setPointer] = useState(false);
  const [focused, setFocused] = useState(false);
  const holding = [open, pointer, focused].includes(true);
  useEffect(() => {
    hold({ id, on: holding });
  }, [hold, holding, id]);
  // The reason's "Full message" fold is `PlainWhy`'s own `<details>`, and a `toggle` never bubbles, so it is heard in
  // the capture phase on the wrapper: an opened fold holds the toast, as the old "Details" disclosure did.
  const reason = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrapper = reason.current;
    if (wrapper === null) {
      return undefined;
    }
    const onToggle = (event: Event): void => {
      if (event.target instanceof HTMLDetailsElement) {
        setOpen(event.target.open);
      }
    };
    wrapper.addEventListener("toggle", onToggle, { capture: true });
    return () => {
      wrapper.removeEventListener("toggle", onToggle, { capture: true });
    };
  }, []);
  return (
    <div
      data-voice-failure-toast=""
      onMouseEnter={() => {
        setPointer(true);
      }}
      onMouseLeave={() => {
        setPointer(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      className="pointer-events-auto w-full max-w-[34rem] rounded-lg border border-danger/50 bg-popover px-3 py-2 text-[0.84rem] text-foreground shadow-lg"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="text-danger">
          ⚠
        </span>
        <p role="alert" className="m-0 flex-1 font-medium">
          {toast.summary}
        </p>
        {cardKey !== undefined && openInNewTab !== undefined ? (
          <button
            type="button"
            onClick={() => {
              openInNewTab({ key: cardKey });
            }}
            className="rounded border border-border px-2 text-[0.78rem] whitespace-nowrap hover:bg-muted"
          >
            Open in new tab
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss this failure"
          onClick={() => {
            close({ id });
          }}
          className="rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      {toast.detail === "" ? null : (
        <div ref={reason} className="mt-1 pl-6 text-[0.78rem] break-words text-muted-foreground">
          <PlainWhy why={toast.detail} />
        </div>
      )}
    </div>
  );
}
