"use client";

/**
 * What `open_card` reaches from the provider (`./openCardRun.ts`): the Queue's rows, the owner's `openCards` switch, and the
 * one move that puts a card's panel on the owner's screen — this window in a browser, the console window in the desktop
 * shell, where the call runs in the voice's own window over the desktop and the pages are in the other.
 *
 * The cards are the record's, read fresh at the tool (`./useQueueRecord.ts`), never the
 * page's held copy; the settle overlay below is laid over them when a call asks. In the browser the Queue's own `history.replaceState` moves a panel already on `/queue`
 * without a fetch (`../console/useQueueRowsOpen.ts` says why); from any other page the router takes the owner there, and the
 * provider, mounted in the root shell, keeps the call across it.
 *
 * The verb seam is here too, because opening a card's thread is the opening it guards: one seam for the provider's
 * life puts a Slack thread in front of the owner once per call, for `open_card` and every other tool alike
 * (`./slackScreenVerb.ts`), and `startFreshCall` starts its record when the owner starts a call, and stops any triage pass an
 * earlier call left running.
 */
import { usePathname, useRouter } from "next/navigation";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { servedThisCall } from "../../lib/alsoAnsweredCards";
import { type CardWalk, type CardWalkMoveFields, FRESH_WALK } from "../../lib/cardWalk";
import { pathLandings } from "../../lib/pathLandings";
import { actsOnceHeard } from "../../lib/settlingChannel";
import type { UnreadSource } from "../../lib/talkActionItems";
import { CONTEXT_STORAGE_KEY, pathWithContextShown } from "../../lib/workContext";
import type { WorkspacePlacer } from "../../lib/workspacePlacement";
import { useWorkspacePlacer } from "../console/organisationState";
import { hiddenNow, joinSettlingChannel, settlingHeardNow } from "../console/settling";
import { readActPull } from "../console/useActPull";
import { fetchBriefing } from "./cardBriefingRead";
import type { ConsolePresentation, OpenCardSeams } from "./openCardRun";
import type { HeldPlanCall } from "./planWiringHeld";
import { slackScreenForCall } from "./slackScreenVerb";
import { runVerbTool } from "./talkToolCalls";
import type { CardWalkSeam, ServedCardsSeam } from "./talkToolRunTypes";
import { stopTriageForFreshCall } from "./triageClockRun";
import type { TriageSeams } from "./triageRun";
import type { QueueRecord } from "./useQueueRecord";
import { useStageToggles } from "./useStageToggles";
import { type TriageClockOut, useTriageWalk } from "./useTriageWalk";
import type { ToolLine } from "./voiceContext";

/** The desktop shell's half of a card move, when the call runs in the voice's window (`DesktopVoiceOverlay.tsx`). */
export interface DesktopCardMove {
  /** The console page the owner is on, path and query, as the console window last published it. */
  readonly fromPath: string | undefined;
  readonly present: (input: { readonly path: string }) => Promise<ConsolePresentation>;
}

/**
 * The provider's `open_card` seams, and the triage pass `triage_next` walks the same cards with (`./useTriageWalk.ts`).
 *
 * @param items reads what `action_items` reports now, whose unread sources keep a missing key from being said not to
 *   exist
 * @param desktop the shell's card move, in the voice's window; `undefined` in a browser
 * @param planCall the plan call this page holds, which a triage card's time-up line is posted to
 * @param openKeyNow reads the card open on the page right now, which a triage card's time-up line is owed only while
 *   it still names
 * @param note writes a line in the call's log
 * @param sounding reads whether the owner's microphone carries their voice right now, which holds a triage card's time-up
 *   line
 * @param clockOut where the triage clock goes out to the menu bar, and the chime it rings at zero off a call
 * @param recordMove writes one Queue-walk move onto the call now running (`./useCallTranscript.ts` `cardMove`)
 * @returns the rows, the switch, the move, the triage pass, the guarded verb seam and its fresh-call reset, the
 *   organisation's placer those rows were placed by, which `relay_steer`'s team-fix check reads too, the keys the
 *   latest `action_items` answer served the owner this call, which its `also_answers` is held to, and the call's Queue walk
 */
export function useOpenCardSeams({
  items,
  desktop,
  planCall,
  openKeyNow,
  note,
  sounding,
  clockOut,
  callNow,
  recordMove,
  queue,
}: {
  /** The Queue's record (`./useQueueRecord.ts`), whose cards these are. */
  queue: Pick<QueueRecord, "cards" | "cardsUnread">;
  /** The call the page is on now (`./useCallTranscript.ts` `current`), which the served snapshot is bound to. */
  callNow: () => string | undefined;
  items: () => { readonly unread: readonly UnreadSource[] };
  desktop: RefObject<DesktopCardMove | undefined>;
  planCall: RefObject<HeldPlanCall | undefined>;
  openKeyNow: () => string | undefined;
  note: (input: { line: ToolLine }) => void;
  sounding: () => boolean;
  clockOut: TriageClockOut;
  recordMove: (input: { move: CardWalkMoveFields }) => void;
}): Pick<TriageSeams, "actLookup" | "cards" | "openCardsOn" | "presentConsole" | "readBriefing" | "triage" | "verb"> & {
  readonly cardWalk: CardWalkSeam;
  readonly startFreshCall: () => void;
  readonly placer: WorkspacePlacer;
  readonly servedCards: ServedCardsSeam;
} {
  const router = useRouter();
  const pathname = usePathname();
  const [landings] = useState(pathLandings);
  // After commit, so a wait settles only once the page drawn is the card's own.
  useEffect(() => {
    landings.landed({ pathname });
  }, [landings, pathname]);
  const [screen] = useState(() => slackScreenForCall({ nowIso: () => new Date().toISOString(), verb: runVerbTool }));
  const triage = useTriageWalk({ clockOut, note, openKeyNow, planCall, sounding });
  const { openCards } = useStageToggles();
  const placer = useWorkspacePlacer();
  const on = useRef(openCards.on);
  const itemsNow = useRef(items);
  const queueAt = useRef(queue);
  // At commit, not after paint: a tool call between the two would project the render before.
  useLayoutEffect(() => {
    // Joined on mount, not at the first card check, so the console window's answer is in before one.
    joinSettlingChannel();
    on.current = openCards.on;
    itemsNow.current = items;
    queueAt.current = queue;
  });
  const cards = useCallback((): ReturnType<OpenCardSeams["cards"]> => {
    let fromPath = `${window.location.pathname}${window.location.search}`;
    const carried = desktop.current?.fromPath;
    if (carried !== undefined) {
      fromPath = carried;
    }
    // The view the page draws, named in the path even before the page's own effect writes it in.
    fromPath = pathWithContextShown({ path: fromPath, stored: window.localStorage.getItem(CONTEXT_STORAGE_KEY) });
    const held = queueAt.current.cards();
    const { acts, focuses, recentlyLeft, rows: live } = held;
    // The acts a press in ANY window hid, read now rather than at the last render: the console window's presses
    // reach this one over the settling channel, and a check after an await must see one made while it waited
    // (`../console/settling.tsx` `hiddenNow`) — and none until the other windows have answered this
    // one's opening ask, so an act settled there is answered as unread here, never opened again.
    const heard = actsOnceHeard({ acts, heard: settlingHeardNow() });
    const alignment = { acts: heard.acts, settled: hiddenNow() };
    return {
      alignment,
      focuses,
      fromPath,
      recentlyLeft,
      rows: live,
      // The acts are no action item, so their reading's absence is named here and never in action_items.
      unread: [...itemsNow.current().unread, ...queueAt.current.cardsUnread(), ...heard.unread],
    };
  }, [desktop]);
  const openCardsOn = useCallback((): boolean => on.current, []);
  const presentConsole = useCallback(
    async ({ path }: { readonly path: string }): Promise<ConsolePresentation> => {
      const shell = desktop.current;
      if (shell !== undefined) {
        return shell.present({ path });
      }
      // Already on the page that draws the card — the Queue, or Alignment for an act — the address
      // moves in place; from any other page the router takes the owner there.
      const target = new URL(path, window.location.origin).pathname;
      if (window.location.pathname === target) {
        // `null` state, not the entry's own, for the reason `../console/useQueueRowsOpen.ts` `replacePanel` gives.
        window.history.replaceState(null, "", path);
        return { kind: "opened" };
      }
      // The router returns before its navigation commits, so the move is opened only once the page reports the card's
      // path; one still pending at the call's deadline answers as possibly still landing (`./boundedCardSeams.ts`).
      // The wait is registered before the move, so a commit at once is never missed.
      const reached = landings.waitFor({ pathname: target });
      router.replace(path);
      await reached;
      return { kind: "opened" };
    },
    [desktop, landings, router],
  );
  const { freshSlackScreen, verb } = screen;
  // The keys the latest `action_items` answer listed, held with the call that served them: a card the owner was served on
  // an earlier call is not one this call read them, and a reconnect or rollover mints a new
  // call without pressing fresh, so the call id is the bound, not the press.
  const served = useRef<{ readonly call: string | undefined; readonly keys: ReadonlySet<string> }>({
    call: undefined,
    keys: new Set(),
  });
  const servedCards = useMemo(
    (): ServedCardsSeam => ({
      read: () => servedThisCall({ held: served.current, now: callNow() }),
      write: ({ keys }) => {
        served.current = { call: callNow(), keys: new Set(keys) };
      },
    }),
    [callNow],
  );
  // The Queue walk (`../../lib/cardWalk.ts`): the owner's press of a fresh call starts with none, while a reconnect or rollover
  // CARRIES it, as it carries the open card — the rule is about the walk the owner is on, and a drop they never see must not
  // make a card they already moved past stick. The served snapshot above is the opposite on purpose: it stands for
  // what the voice's context holds, and a successor call's context may not hold that listing.
  const walked = useRef<CardWalk>(FRESH_WALK);
  const walkEpoch = useRef(0);
  const recordNow = useRef(recordMove);
  useLayoutEffect(() => {
    recordNow.current = recordMove;
  });
  const cardWalk = useMemo(
    (): CardWalkSeam => ({
      openKeyNow,
      read: () => walked.current,
      record: ({ move }) => {
        recordNow.current({ move });
      },
      stamp: () => `${walkEpoch.current}:${String(callNow())}`,
      write: ({ walk }) => {
        walked.current = walk;
      },
    }),
    [callNow, openKeyNow],
  );
  // The owner's press of a fresh call: a new Slack-screen record, no pass an earlier call left running (`./triageClockRun.ts`),
  // no card an earlier call served them, and no walk an earlier call made.
  const startFreshCall = useCallback((): void => {
    freshSlackScreen();
    stopTriageForFreshCall({ seams: { triage } });
    served.current = { call: undefined, keys: new Set() };
    walked.current = FRESH_WALK;
    walkEpoch.current += 1;
  }, [freshSlackScreen, triage]);
  // Unbounded here: each Queue tool call bounds these by its own deadline (`./boundedCardSeams.ts`, `./talkToolRun.ts`).
  return useMemo(
    () => ({
      actLookup: readActPull,
      cardWalk,
      cards,
      openCardsOn,
      placer,
      presentConsole,
      readBriefing: fetchBriefing,
      servedCards,
      startFreshCall,
      triage,
      verb,
    }),
    [cardWalk, cards, openCardsOn, placer, presentConsole, servedCards, startFreshCall, triage, verb],
  );
}
