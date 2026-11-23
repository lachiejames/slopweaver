"use client";

import { CircleCheck, X } from "lucide-react";
import { type ReactElement, useSyncExternalStore } from "react";

import {
  acceptsHidden,
  type HeldHidden,
  hiddenAcross,
  hiddenAfterPress,
  parseSettlingMessage,
  postedHidden,
  pressedKeys,
  SETTLING_CHANNEL,
  type SettlingMessage,
  settlingHeard,
} from "../../lib/settlingChannel";
import { refreshLive } from "../live/useLive";
import { Button } from "../ui/button";
import { IntegrationFailure } from "./ConnectIntegration";
import { type PressState, pressOnce } from "./press";
import { PlainWhy } from "./RawFold";

/*
 * Settling a row optimistically: the press that answers a row takes the row off every list the moment it is
 * pressed, and puts it back only if the verb did not say done.
 *
 * A done press that left the panel open over the verb's raw output while the register re-read, with the row
 * staying in the list until that read came back, would hold the success without anything about it reading as one;
 * so the card closes and the row leaves on success.
 *
 * The store is module-scoped, like `useLive`'s channels, so the Queue and the sidebar both hide the
 * same row at the same instant, and a panel can close while its press is still in flight.
 */

/** What the last settle was, and how it came out — the one line a page draws above its list. */
export interface Settled {
  readonly key: string;
  /** What was done, in the page's words: "Approved", "Denied", "Recorded your word". */
  readonly did: string;
  /** The row's own question, so the line names what it was done to. */
  readonly about: string;
  /** Exactly what the press recorded. */
  readonly words: string;
  readonly outcome: Exclude<PressState, { phase: "idle" }>;
}

interface SettleSnapshot {
  readonly hidden: readonly string[];
  /** The rows whose press has not answered yet: hidden, but the write may still be refused and put them back. */
  readonly sending: readonly string[];
  readonly last: Settled | undefined;
}

/** This document's own settles: the rows ITS presses hid. */
let current: SettleSnapshot = { hidden: [], last: undefined, sending: [] };
/** What every subscriber reads: this document's settles, with the rows every other document's presses hid. */
let shared: SettleSnapshot = current;
const listeners = new Set<() => void>();
const SERVER: SettleSnapshot = { hidden: [], last: undefined, sending: [] };

/** Each other document's highest-numbered hidden list, by its writer name (`../../lib/settlingChannel.ts`). */
const remote = new Map<string, HeldHidden>();

/** The number of this document's last posted list, raised on every post so a reader keeps only the newest. */
let seq = 0;

/**
 * This document's name on the settling channel.
 *
 * What the channel closes and what it does not, stated where it is decided: it relies on this name being unique per document, which a v4 UUID is unless page code replaces
 * `crypto.randomUUID` — two documents sharing one would drop each other's lists as their own. It reaches only
 * documents of ONE origin (BroadcastChannel is origin-scoped), so a console open at both localhost and 127.0.0.1
 * learns of the other's press on its next poll, as it does of a CLI session's write; and `seq` would stop rising
 * past 2^53 - 1 lists from one document. Closing any of them would need a server-held settled list every document
 * reads, which this console does not keep.
 */
const writer = crypto.randomUUID();

/** This document's end of the settling channel, opened on first use; none where the platform has no channel. */
let channel: BroadcastChannel | undefined;

/**
 * When this document opened the channel and posted its `ask`, on the monotonic clock so a wall-clock step cannot end
 * the handshake early; undefined until then, and where there is no channel.
 */
let openedAtMs: number | undefined;

/**
 * Rebuild what subscribers read and tell every one of them.
 */
function refreshShared(): void {
  shared = { ...current, hidden: hiddenAcross({ local: current.hidden, remote }) };
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Answer a late document's `ask`: this document's own list, then every list it holds for another writer, each under
 * that writer's name and number, so a list whose writer has since closed still reaches a document opened after it.
 *
 * @param opened the channel to answer on
 */
function answerAsk({ opened }: { opened: BroadcastChannel }): void {
  opened.postMessage({
    ...postedHidden({ hidden: current.hidden }),
    kind: "hidden",
    seq,
    writer,
  } satisfies SettlingMessage);
  for (const [held, list] of remote) {
    opened.postMessage({ ...list, kind: "hidden", writer: held } satisfies SettlingMessage);
  }
}

/**
 * This document's end of the settling channel, opened on first use: it keeps each other document's newest hidden
 * list, answers an `ask` with its own and every list it holds, and asks on opening, so a window opened after a press —
 * even one whose window has since closed — still learns of it. The
 * desktop voice overlay is a separate document from the console window, so without it a press in one never hid the
 * row in the other until the registers re-read.
 *
 * @returns the open channel, or undefined where there is none (a server render)
 */
function settlingChannel(): BroadcastChannel | undefined {
  if (channel !== undefined || typeof BroadcastChannel === "undefined") {
    return channel;
  }
  const opened = new BroadcastChannel(SETTLING_CHANNEL);
  opened.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = parseSettlingMessage({ data: event.data });
    if (message === undefined) {
      return;
    }
    if (message.kind === "ask") {
      answerAsk({ opened });
      return;
    }
    if (message.writer === writer || !acceptsHidden({ held: remote.get(message.writer)?.seq, seq: message.seq })) {
      return;
    }
    remote.set(message.writer, { complete: message.complete, keys: message.keys, seq: message.seq });
    refreshShared();
  });
  opened.postMessage({ kind: "ask" } satisfies SettlingMessage);
  openedAtMs = performance.now();
  channel = opened;
  return opened;
}

/**
 * Replace this document's snapshot, tell every other document its hidden rows, and tell every subscriber.
 *
 * @param next the new snapshot
 */
function publish({ next }: { next: SettleSnapshot }): void {
  current = next;
  seq += 1;
  settlingChannel()?.postMessage({
    ...postedHidden({ hidden: next.hidden }),
    kind: "hidden",
    seq,
    writer,
  } satisfies SettlingMessage);
  refreshShared();
}

/**
 * Join the settling channel now, so its handshake window starts at mount rather than at the first card check: the
 * voice overlay joins on mount, long before a call can ask it for a card, so a press the console window made before
 * the overlay opened is known by the time one does.
 */
export function joinSettlingChannel(): void {
  settlingChannel();
}

/**
 * Whether {@link hiddenNow} can be trusted to carry every other document's hidden rows: the answers to this
 * document's opening `ask` arrive as later tasks, so a check inside the handshake window must not read an act as
 * open, and answers as unread instead (`../../lib/settlingChannel.ts` `settlingHeard`) — and so
 * must one while another document's latest list was cut short.
 *
 * @returns whether the handshake window has passed with every list whole, or there is no channel to hear from
 */
export function settlingHeardNow(): boolean {
  settlingChannel();
  const partial = [...remote.values()].some((list) => !list.complete);
  return settlingHeard({ nowMs: performance.now(), openedAtMs, partial });
}

/**
 * The rows hidden by a settle in ANY document, read at this instant rather than at the last render: a check that
 * runs after an await reads this, so a press another window made while it waited is seen.
 *
 * @returns every hidden row
 */
export function hiddenNow(): readonly string[] {
  settlingChannel();
  return shared.hidden;
}

/**
 * Press one row's recording act, hiding the row until the verb answers — and for good if it answers done.
 *
 * A refused press puts the row back, since a refusal wrote nothing; an unknown one may have landed, so its row stays
 * hidden in every document until a fresh one reads the registers (`../../lib/settlingChannel.ts` `hiddenAfterPress`).
 *
 * @param key the row's `<kind>:<id>`, the key every list filters on
 * @param aliases the keys of the earlier acts folded under the row, which the same press settles
 *   (`../../lib/settlingChannel.ts` `pressedKeys`)
 * @param did what the line calls the act once it is done
 * @param about the row's question
 * @param words what the press records, printed on the line
 * @param slug the act row to press
 * @param slots the act's slot values
 * @param readsSlug the register to re-read afterwards
 * @param refresh whether to re-read it now — a caller pressing a batch re-reads once at the end instead
 * @returns what the press came to
 */
export async function settle({
  key,
  aliases,
  did,
  about,
  words,
  slug,
  slots,
  readsSlug,
  refresh = true,
}: {
  key: string;
  aliases: readonly string[] | undefined;
  did: string;
  about: string;
  words: string;
  slug: string;
  slots: Record<string, string>;
  readsSlug: string;
  refresh?: boolean;
}): Promise<Exclude<PressState, { phase: "idle" } | { phase: "sending" }>> {
  // The row's folded earlier acts leave with it, so a document still drawing one of them alone hides it too.
  const pressed = pressedKeys({ aliases, key });
  publish({
    next: {
      hidden: [...current.hidden, ...pressed],
      last: { about, did, key, outcome: { phase: "sending" }, words },
      sending: [...current.sending, key],
    },
  });
  const outcome = await pressOnce({ slots, slug });
  const hidden = hiddenAfterPress({ hidden: current.hidden, phase: outcome.phase, pressed });
  const sending = current.sending.filter((held) => held !== key);
  publish({ next: { hidden, last: { about, did, key, outcome, words }, sending } });
  if (refresh) {
    refreshLive({ slug: readsSlug });
  }
  return outcome;
}

/** Take the last settle's line down. The rows it hid stay hidden; only the line goes. */
export function dismissSettled(): void {
  publish({ next: { hidden: current.hidden, last: undefined, sending: current.sending } });
}

/**
 * The rows hidden by a settle, and the last settle's outcome.
 *
 * @returns the snapshot, shared by every subscriber
 */
export function useSettling(): SettleSnapshot {
  return useSyncExternalStore(
    (listener) => {
      settlingChannel();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => shared,
    () => SERVER,
  );
}

/**
 * The last settle's one line: what was done to which row, and — only when the reader opens it — what the verb wrote.
 *
 * @returns the line, or nothing when no settle has run or it was dismissed
 */
export function SettleLine(): ReactElement | null {
  const { last } = useSettling();
  if (last === undefined) {
    return null;
  }
  const { outcome } = last;
  let tone = "border-border bg-muted/40";
  let line: ReactElement;
  if (outcome.phase === "sending") {
    line = (
      <span>
        {last.did}… <span className="text-muted-foreground">{last.about}</span>
      </span>
    );
  } else if (outcome.phase === "done") {
    tone = "border-success/40 bg-success/10";
    line = (
      <span className="flex items-center gap-2">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        <span>
          <b>{last.did}</b>: recorded “{last.words}”. <span className="text-muted-foreground">{last.about}</span>
        </span>
      </span>
    );
  } else {
    tone = "border-warning/40 bg-warning/10";
    let reason = (
      <>
        <b>{outcome.phase === "refused" ? "Refused" : "Outcome unknown"}</b>: <PlainWhy why={outcome.why} />
      </>
    );
    // Only a certain refusal becomes the connect affordance; an unknown outcome keeps its words (`./press.tsx`).
    if (outcome.phase === "refused") {
      reason = <IntegrationFailure why={outcome.why} fallback={reason} />;
    }
    // A div, not a span: the reason's raw message folds under it in a block disclosure (`PlainWhy`).
    line = (
      <div>
        {reason}
        <br />
        {outcome.phase === "refused"
          ? "The row is back in the list."
          : "It may have been recorded, so the row stays out of the list until the console reloads."}{" "}
        <span className="text-muted-foreground">{last.about}</span>
      </div>
    );
  }
  return (
    <div className={`flex items-start gap-2 rounded-md border border-solid px-3 py-2 text-sm ${tone}`}>
      <div className="grid min-w-0 flex-1 gap-1">
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- `<output>` holds only phrasing content, so it cannot hold the reason's block fold */}
        <div role="status">{line}</div>
        {outcome.phase === "done" && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">what the verb wrote</summary>
            <pre className="m-0 mt-1 overflow-x-auto whitespace-pre-wrap">
              {outcome.out === "" ? "(nothing on stdout)" : outcome.out}
            </pre>
          </details>
        )}
      </div>
      {outcome.phase !== "sending" && (
        <Button type="button" size="icon-xs" variant="ghost" aria-label="dismiss" onClick={dismissSettled}>
          <X />
        </Button>
      )}
    </div>
  );
}
