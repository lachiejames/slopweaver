"use client";

/**
 * What the voice reads of the Queue: the registers and overlays `action_items` and `open_card` project, and the counts
 * the app shows at the instant a tool or a sentence asks. Its own file so `VoiceProvider.tsx` stays under the line cap.
 *
 * The readings stay polled on the Queue's own cadences, call or no call, but the Queue's ROWS are projected only when a
 * count or a relay asks (`./voiceQueueProjection.ts`): the voice's window is always on screen, and an eager projection
 * there rebuilt every row on every register's poll (`../../lib/queueProjection.ts` carries the measurement).
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { CurrencyReading } from "../../lib/cardCurrency";
import { answeredHere } from "../../lib/liveState";
import type { HeldReading } from "../../lib/pageVoice";
import { FOCUS_POLL_MS } from "../../lib/queueFocus";
import { FAST_POLL_MS, QUEUE_REGISTER_POLLS } from "../../lib/queueRegisterPolls";
import { type QueueShownCounts, queueScopeAt } from "../../lib/queueShownCounts";
import { type RelayWorkspace, relayWorkspace } from "../../lib/relayWorkspace";
import { copyMentionLabels } from "../../lib/runningListCopy";
import type { MentionLabels } from "../../lib/slackMrkdwn";
import type { ActionItemReadings } from "../../lib/talkActionItems";
import { CONTEXT_STORAGE_KEY, contextAddressedBy, type WorkContext } from "../../lib/workContext";
import { shownInContext } from "../../lib/workspacePlacementContext";
import { readWorkstreamsReading, type WorkstreamsReading } from "../../lib/workstreamsReading";
import { useWorkspacePlacer } from "../console/organisationState";
import { readPreference } from "../console/preference";
import { useSettling } from "../console/settling";
import { useSteerOverlay } from "../console/steered";
import { queueShownOf } from "../console/useQueueRows";
import { queuePeople } from "../console/useQueueRowsReading";
import { useWorkContext } from "../console/workContextState";
import { type Board, type HandStep, readBoard, readHandSteps } from "../live/read";
import { type AutonomyRow, readAutonomy } from "../live/readAutonomy";
import { type CardDeferrals, readCardDeferrals } from "../live/readCardDeferrals";
import { type CardLandings, readCardLandings } from "../live/readCardLandings";
import { readCurrencyReading } from "../live/readCurrency";
import { type ImportQuestionReading, readImportQuestions } from "../live/readImportQuestions";
import type { Reading } from "../live/reading";
import { type LandingReading, readLandingReading } from "../live/readLanding";
import { type ParkedReview, readParkedReviews } from "../live/readReviewDrafts";
import { type Reviewers, readReviewers } from "../live/readReviewers";
import { type ParkedDraft, readParkedDrafts } from "../live/readSlackDrafts";
import { readStandingAsks, type StandingAskReading } from "../live/readStandingAsks";
import { type HeldDraft, readHeldDrafts } from "../live/readThread";
import { useLive } from "../live/useLive";
import type { DesktopVoiceSeam } from "./desktopVoiceSeam";
import type { VoiceContextNow } from "./useQueueRecord";
import { type VoiceQueueInputs, voiceQueueProjector, voiceQueueShownReading } from "./voiceQueueProjection";

/**
 * The voice's readings. The registers are module-scoped channels, so subscribing here costs nothing the sidebar badge
 * does not. The counts come from the Queue's own reading — kept registers, settling and withholding included — under
 * the scope of the page the owner is on: what `action_items` hands over and what a count the voice says is checked against
 * (`../../lib/talkCountGrounding.ts`). In the desktop shell's voice window the page is the console
 * window's, carried across with its context, and the settling overlay is this window's own.
 *
 * @param pathname the path this window is on
 * @param desktop the desktop shell's seam, whose carried page wins over this window's own path
 * @param drawn what the page body last registered, whose query is the scope the page drew
 * @returns the readings this render read, how the running list names a mention, and the work context, counts, a relay's
 *   workspace and the console the owner is on when called
 */
export function useVoiceReadings({
  desktop,
  drawn,
  pathname,
}: {
  desktop: DesktopVoiceSeam | undefined;
  drawn: { readonly current: HeldReading | undefined };
  pathname: string;
}): {
  contextNow: () => VoiceContextNow;
  /**
   * How the running list names a `<@U…>` mention: as the person the Queue's reading holds for that Slack member id,
   * else the id. This render's, so a list drawing a mention redraws when the roster arrives, which a ref read at call time
   * would not.
   */
  copyLabels: MentionLabels;
  readings: ActionItemReadings;
  relayWorkspaceNow: (input: { about: string; spokenIn: WorkContext | undefined }) => RelayWorkspace | undefined;
  shownNow: () => QueueShownCounts;
  workContextNow: () => WorkContext | undefined;
} {
  // The seven registers on the Queue's own intervals (`../../lib/queueRegisterPolls.ts`), the board's slow verb once a
  // minute, so none is read once and left to age in a window that stays open all day.
  const hands = useLive<readonly HandStep[]>({
    everyMs: QUEUE_REGISTER_POLLS.hands,
    read: readHandSteps,
    slug: "hands",
  });
  const board = useLive<Board>({ everyMs: QUEUE_REGISTER_POLLS.board, read: readBoard, slug: "board" });
  const drafts = useLive<readonly HeldDraft[]>({
    everyMs: QUEUE_REGISTER_POLLS.drafts,
    read: readHeldDrafts,
    slug: "drafts",
  });
  const landing = useLive<LandingReading>({
    everyMs: QUEUE_REGISTER_POLLS["landing-reading"],
    read: readLandingReading,
    slug: "landing-reading",
  });
  const posts = useLive<readonly ParkedDraft[]>({
    everyMs: QUEUE_REGISTER_POLLS["slack-drafts"],
    read: readParkedDrafts,
    slug: "slack-drafts",
  });
  const reviews = useLive<readonly ParkedReview[]>({
    everyMs: QUEUE_REGISTER_POLLS["review-drafts"],
    read: readParkedReviews,
    slug: "review-drafts",
  });
  const imports = useLive<ImportQuestionReading>({
    everyMs: QUEUE_REGISTER_POLLS["import-questions"],
    read: readImportQuestions,
    slug: "import-questions",
  });
  const reviewers = useLive<Reviewers>({ everyMs: FAST_POLL_MS, read: readReviewers, slug: "reviewers" });
  const acts = useLive<readonly AutonomyRow[]>({ read: readAutonomy, slug: "autonomy" });
  const standing = useLive<StandingAskReading>({
    everyMs: FAST_POLL_MS,
    read: readStandingAsks,
    slug: "standing-asks",
  });
  const spoken = useLive<CardLandings>({ everyMs: FAST_POLL_MS, read: readCardLandings, slug: "talk-cards" });
  // The same channel the Queue ranks by, so `action_items` names the card the page numbers 1.
  const currency = useLive<Reading<CurrencyReading>>({
    everyMs: FAST_POLL_MS,
    read: readCurrencyReading,
    slug: "currency-reading",
  });
  // The owner's deferrals and focus, read off the Queue's own channels, so the order the voice projects is the page's
  // (`../../lib/cardDeferrals.ts`, `../../lib/queueFocus.ts`).
  const deferrals = useLive<CardDeferrals>({ everyMs: FAST_POLL_MS, read: readCardDeferrals, slug: "queue-deferred" });
  const workstreams = useLive<WorkstreamsReading>({
    everyMs: FOCUS_POLL_MS,
    read: (payload) => readWorkstreamsReading({ payload }),
    slug: "workstreams",
  });
  // A card the owner just steered on is no item until its steer comes back, exactly as the Queue draws it (`../console/steered.tsx`).
  const steered = useSteerOverlay({ spoken });
  const steers = steered.overlay;
  // The other row decider beside workstreams: until it reads, the other context's figure is unread, as on the Queue.
  const steersRead = answeredHere({ state: steered.reading });
  const placer = useWorkspacePlacer();
  const { hidden } = useSettling();
  const own = useWorkContext().context;
  const readings: ActionItemReadings = {
    acts,
    board,
    currency,
    deferrals,
    drafts,
    hands,
    imports,
    landing,
    posts,
    reviewers,
    reviews,
    spoken,
    standing,
    steers,
    workstreams,
  };
  // What the projection is built from, held rather than projected: a poll only moves this ref, and the projector
  // builds the rows when a count or a relay asks, keeping them until an input changes.
  const queueInputs = useRef<VoiceQueueInputs>({ placer, readings, settled: hidden, steers });
  const projector = useMemo(() => voiceQueueProjector(), []);
  const ownNow = useRef(own);
  const steersReadNow = useRef(steersRead);
  const seam = useRef(desktop);
  const path = useRef(pathname);
  // At commit, not after paint, as `./useQueueRecord.ts` holds its readings: a tool call or a voice FINAL arriving
  // between the two would read the reading, or the carried page, before the one the page now draws (the provider's own
  // refs move after paint). Held in refs so both callbacks below stay one identity for the
  // call: the call's watcher keeps the `shownNow` it opened with, and a context captured in it would go stale when the
  // owner switches.
  useLayoutEffect(() => {
    queueInputs.current = { placer, readings, settled: hidden, steers };
    ownNow.current = own;
    steersReadNow.current = steersRead;
    seam.current = desktop;
    path.current = pathname;
  });
  // The desktop shell's voice window: a seam that carries the console's page rather than publishing its own.
  const voiceWindow = useCallback(
    (): boolean => seam.current !== undefined && seam.current.publishPage === undefined,
    [seam],
  );
  const contextNow = useCallback((): VoiceContextNow => {
    let context = ownNow.current;
    // In the voice window the console window decides, never this window's own address — before its page arrives
    // too, when only the choice both windows share is known.
    if (seam.current !== undefined && voiceWindow()) {
      let carriedPath = "";
      const carried = seam.current.pageIdentity;
      if (carried !== undefined) {
        carriedPath = carried.path;
      }
      // The shared preference, not raw storage: a choice storage refused is held on the channel this window joins.
      const stored = readPreference({ key: CONTEXT_STORAGE_KEY });
      context = contextAddressedBy({ path: carriedPath, stored });
    }
    return { context, shows: (row) => shownInContext({ context, placement: row.placement }) };
  }, [seam, voiceWindow]);
  // The query the page body registered in the commit that drew it, never the live address: between a selector's
  // `replaceState` and the render it causes, the address names a view the page has not drawn. This provider
  // does not re-render on a query change, so its own snapshot would lag; the page re-renders on it and registers anew.
  // A departing page clears its reading before the arriving one registers (`usePageReading`), so a reading held is
  // the page on screen; a page that registers none draws no scope from its query.
  const shownNow = useCallback((): QueueShownCounts => {
    const carried = seam.current?.pageIdentity;
    let search = window.location.search;
    const page = drawn.current;
    if (page !== undefined) {
      search = page.search;
    }
    let scope = queueScopeAt({ path: path.current, search });
    if (carried !== undefined) {
      scope = queueScopeAt({ path: carried.path, search: "" });
    }
    // The rows in the carried page's context, which on the desktop shell need not be this window's own.
    const { context, shows } = contextNow();
    // A voice window whose console page has not arrived has no page to count, so every figure is unread.
    const awaiting = voiceWindow() && carried === undefined;
    // Projected here, at the ask, never on a poll.
    const inputs = queueInputs.current;
    const reading = voiceQueueShownReading({
      context,
      projection: projector({ inputs }),
      readings: inputs.readings,
      shows,
      steersRead: steersReadNow.current,
    });
    if (awaiting) {
      // The badge reads registers, not `allDrawn`, so the board is read as still loading too.
      return queueShownOf({ reading: { ...reading, allDrawn: false, board: { phase: "loading" } }, scope });
    }
    return queueShownOf({ reading, scope });
  }, [contextNow, drawn, path, projector, seam, voiceWindow]);
  // Every row every register holds, in both contexts: a card the owner speaks over may sit in the other context, an act a
  // check-in names sits on Alignment, and a card the owner's earlier words landed on is off the Queue — each still placed
  // where it was. A row a gate withheld answers too, so one disagreeing with a drawn row under the same
  // key states nothing. So does an act a standing rule settled between the owner's check-in and the hand-off.
  const relayWorkspaceNow = useCallback(
    ({ about, spokenIn }: { about: string; spokenIn: WorkContext | undefined }): RelayWorkspace | undefined => {
      const { every, settledEvery, withheldEvery } = projector({ inputs: queueInputs.current });
      return relayWorkspace({ about, rows: [...every, ...withheldEvery, ...settledEvery], spokenIn });
    },
    [projector],
  );
  // The console the owner is on, as a stamp on their words (`../../lib/heardOver.ts`).
  const workContextNow = useCallback((): WorkContext | undefined => contextNow().context, [contextNow]);
  // The roster folded with the board's workstreams: a walk over the readings alone, never the rows.
  const copyLabels = useMemo(() => copyMentionLabels({ people: queuePeople({ board, posts }) }), [board, posts]);
  return {
    contextNow,
    copyLabels,
    readings,
    relayWorkspaceNow,
    shownNow,
    workContextNow,
  };
}
