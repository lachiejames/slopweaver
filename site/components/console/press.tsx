"use client";

/**
 * The press seam: the one way a console panel takes an act, and the line that reports what the press came to.
 *
 * It sits beside `Queue.tsx` rather than inside it because the three are one idea — a POST to the act
 * route, the four outcomes that answer, and the re-read of the register the act wrote to — and because
 * `Queue.tsx` is the page, not the mechanism. Every panel on that page reaches an act through
 * {@link usePress} and nothing else; no component assembles an argv or a URL of its own.
 */
import { createContext, type ReactElement, useCallback, useContext, useState, useSyncExternalStore } from "react";

import { isSettling, type Settling } from "../../lib/settling";
import { cn } from "../../lib/utils";
import { livePressOrderOf, refreshLive } from "../live/useLive";
import { IntegrationFailure } from "./ConnectIntegration";
import { PlainWhy } from "./RawFold";

/** What one press came to, as the footer shows it. */
export type PressState =
  | { readonly phase: "idle" }
  | { readonly phase: "sending" }
  | { readonly phase: "done"; readonly out: string }
  | {
      readonly phase: "refused";
      readonly why: string;
      /** Set when the page itself refused under a {@link PressHold}: its own sentence, said as written. */
      readonly held?: "kept" | "gone";
    }
  | { readonly phase: "unknown"; readonly why: string };

/**
 * One POST to the act route, read into the four-outcome answer. It never throws: a failed fetch is an
 * `unknown`, because the act may have landed. It does not re-read any register — the caller does, once.
 *
 * @param slug the act row to press
 * @param slots the row's slot values, as the route validates them
 * @returns what the press came to
 */
export async function pressOnce({
  slug,
  slots,
}: {
  slug: string;
  slots: Record<string, string>;
}): Promise<Exclude<PressState, { phase: "idle" } | { phase: "sending" }>> {
  try {
    const response = await fetch(`/api/act/${slug}`, {
      body: JSON.stringify(slots),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json();
    const held = (typeof body === "object" && body !== null ? body : {}) as Partial<{
      outcome: string;
      out: string;
      why: string;
      error: string;
    }>;
    if (held.outcome === "done") {
      return { out: typeof held.out === "string" ? held.out.trim() : "", phase: "done" };
    }
    if (held.outcome === "refused") {
      return { phase: "refused", why: typeof held.why === "string" ? held.why : "refused without a reason" };
    }
    if (held.outcome === "unknown") {
      return { phase: "unknown", why: typeof held.why === "string" ? held.why : "no answer" };
    }
    return {
      phase: "refused",
      why: typeof held.error === "string" ? held.error : `/api/act/${slug} answered something that is not an ActResult`,
    };
  } catch (cause) {
    return { phase: "unknown", why: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Every Queue row a press on this page is settling, by row key (`../../lib/settling.ts`). */
const settlingRows = new Map<string, Settling>();

/** Every row drawn from {@link settlingRows}, told when a mark moves. */
const settlingListeners = new Set<() => void>();

/**
 * Mark a row settling, move its mark, or clear it, and tell every row drawn from the marks.
 *
 * @param key the row's key
 * @param held the row's mark, or `undefined` to clear it
 */
function markSettling({ key, held }: { key: string; held: Settling | undefined }): void {
  if (held === undefined) {
    settlingRows.delete(key);
  } else {
    settlingRows.set(key, held);
  }
  for (const listener of settlingListeners) {
    listener();
  }
}

/** Subscribe one drawn row to the marks; module-level so a render never re-subscribes. */
const subscribeSettling: Parameters<typeof useSyncExternalStore>[0] = (changed) => {
  settlingListeners.add(changed);
  return () => {
    settlingListeners.delete(changed);
  };
};

/**
 * Whether a Queue row is drawn settling: pressed, and the list not yet re-read since. Re-judged whenever the row
 * draws, which the re-read landing makes it do.
 *
 * @param rowKey the row's key, as a press named it in `settles`
 * @returns whether to draw it settling
 */
export function useSettling({ rowKey }: { rowKey: string }): boolean {
  const held = useSyncExternalStore(
    subscribeSettling,
    () => settlingRows.get(rowKey),
    () => undefined,
  );
  let answered = 0;
  if (held !== undefined) {
    answered = livePressOrderOf({ slug: held.readsSlug }).answered;
  }
  return isSettling({ answered, held });
}

/**
 * Why every press under the open card holds, when one does: `kept`, the card is built from an earlier reading a
 * register's latest poll could not confirm (`QueueReading.kept`); `gone`, it is a snapshot of a card that left the list.
 * Its panel is handed `gone` so its own buttons disable, the "Read from" column says why, and {@link usePress}
 * refuses under it whatever button asked — a child that never learned of `gone` included.
 */
export const PressHold = createContext<"kept" | "gone" | undefined>(undefined);

/** What a press under each hold answers instead of acting. */
const HOLD_REFUSAL = {
  gone: "this card has left the list, so nothing on it acts; reopen it from the Queue if it comes back",
  kept: "this card is drawn from an earlier reading its register's latest poll could not confirm; nothing acts until it reads again",
} as const;

/**
 * The one way a panel takes an act: {@link pressOnce}, then a re-read of the register the act wrote to so
 * the list and the panel move together. Under a {@link PressHold} it refuses without posting.
 *
 * A panel that names the Queue row it acts on (`settles`) draws that row settling from the press until the re-read
 * lands — the list answers the press at once rather than after two child processes — and clears the mark the moment
 * the act is refused or its outcome is unknown, so the row never claims what the panel's outcome line does not.
 *
 * @param settles the key of the Queue row this panel's presses act on, drawn settling while one is under way
 * @returns the press state and the press
 */
export function usePress({ settles }: { settles?: string } = {}): {
  readonly state: PressState;
  readonly press: (args: { slug: string; slots: Record<string, string>; readsSlug: string }) => Promise<void>;
} {
  const [state, setState] = useState<PressState>({ phase: "idle" });
  const hold = useContext(PressHold);
  const press = useCallback(
    async ({
      slug,
      slots,
      readsSlug,
    }: {
      slug: string;
      slots: Record<string, string>;
      readsSlug: string;
    }): Promise<void> => {
      if (hold !== undefined) {
        setState({ held: hold, phase: "refused", why: HOLD_REFUSAL[hold] });
        refreshLive({ slug: readsSlug });
        return;
      }
      setState({ phase: "sending" });
      if (settles !== undefined) {
        markSettling({ held: { pressedAs: undefined, readsSlug }, key: settles });
      }
      const outcome = await pressOnce({ slots, slug });
      setState(outcome);
      // Either way the register is re-read: a done act moved it, and an unknown one may have.
      refreshLive({ slug: readsSlug });
      if (settles !== undefined) {
        let held: Settling | undefined;
        if (outcome.phase === "done") {
          // Read after `refreshLive`, which numbered this press: only an answer from a read that left at or after it
          // lets the row go.
          held = { pressedAs: livePressOrderOf({ slug: readsSlug }).pressed, readsSlug };
        }
        markSettling({ held, key: settles });
      }
    },
    [hold, settles],
  );
  return { press, state };
}

/**
 * The outcome line under the footer's controls, once there is one.
 *
 * @param state the press's state
 * @param outputOpen draw the verb's output unfolded — for a press whose output IS the thing to read, a dry run
 *   reporting what would be written, rather than a receipt
 * @returns the line, or nothing before the first press
 */
export function Outcome({
  state,
  outputOpen = false,
}: {
  state: PressState;
  outputOpen?: boolean;
}): ReactElement | null {
  if (state.phase === "idle") {
    return null;
  }
  if (state.phase === "sending") {
    return (
      <p className={OUTCOME_OPEN} data-outcome="sending">
        running the verb…
      </p>
    );
  }
  if (state.phase === "done") {
    // One clear line, and the verb's own output only for the reader who opens it: shown inline, the success state
    // read as raw JSON.
    return (
      <div className={cn(OUTCOME, "bg-success/14 text-success")} data-outcome="done">
        <output>
          <b>Done.</b>
        </output>{" "}
        <details className="inline" open={outputOpen}>
          <summary className="inline cursor-pointer text-muted-foreground">what the verb wrote</summary>
          <pre className="mt-[0.4rem] mb-0 whitespace-pre-wrap text-foreground">
            {state.out === "" ? "(nothing on stdout)" : state.out}
          </pre>
        </details>
      </div>
    );
  }
  if (state.phase === "refused" && state.held !== undefined) {
    // The page's own safety refusal is already the owner's words and nothing failed, so it is said as written — never through
    // `PlainWhy`, which would call an unrecognised sentence a technical error.
    return (
      <div className={cn(OUTCOME, "bg-danger/14 text-danger")} data-outcome="refused">
        Refused: {HOLD_REFUSAL[state.held]}
      </div>
    );
  }
  if (state.phase === "refused") {
    // A refusal is certain — the verb said no before it acted — so one refused for want of an integration draws the
    // connect affordance. An unknown outcome below never does: the act may have happened. Either reason is said
    // plainly with the raw message folded under it (`PlainWhy`): a caught parse error is not words.
    return (
      <IntegrationFailure
        why={state.why}
        fallback={
          <div className={cn(OUTCOME, "bg-danger/14 text-danger")} data-outcome="refused">
            Refused: <PlainWhy why={state.why} />
          </div>
        }
      />
    );
  }
  return (
    <div className={OUTCOME_OPEN} data-outcome="unknown">
      Outcome unknown: <PlainWhy why={state.why} />
      <br />
      The register is being re-read; if the row leaves, the verb wrote before it was cut off.
    </div>
  );
}

/** The outcome line's frame; each state adds its own tone. It spans the whole row of a panel's act bar. */
const OUTCOME = "m-0 basis-full rounded-lg px-[0.7rem] py-2 text-[0.8rem] whitespace-pre-wrap [word-break:break-word]";

/** A press still running, or one whose result the page could not read: the warning tone. */
const OUTCOME_OPEN = cn(OUTCOME, "bg-warning/14 text-warning");
