"use client";

/**
 * The page's one front-window sampler, feeding the two notices the voice says off which window is in front: read it
 * every {@link FRONT_WINDOW_POLL_MS} through the desktop shell while a call is live or a plan is held, and post the
 * notice its pure watch owes, drift first and one per pass. The ISO watch's state is kept in this browser
 * (`../../lib/isoStrayStore.ts`), so a reload never resets its cadence.
 *
 * - **Drift** (`../../lib/driftWatch.ts`): once one off-plan window has held the front past the dwell, the call's
 *   `drift` route has the voice say one fixed line, because being notified that the work has drifted off plan is useful.
 * - **ISO** (`../../lib/isoStrayWatch.ts`): once a work-hours stretch off ISO has run past its dwell while an ISO card
 *   waits on the owner, the call's `iso-nudge` route has the voice name that card, once and then once more much later.
 *
 * Names only, never a frame, and a sample never leaves this page: what is posted is a plan's label and an
 * application's name, or one ISO card's key and subject. The call refuses while the owner or the voice holds the floor, so the
 * page posts again every few seconds while a line is still owed. A drift plan is kept for the provider's life, not one
 * call's, so a rollover onto a fresh plan call carries it on.
 */
import { type RefObject, useEffect, useMemo, useRef } from "react";

import { readerTimeZone } from "../../lib/dateTimeFormat";
import {
  DRIFT_RETRY_MS,
  type DriftWatchInput,
  type DriftWatchState,
  driftOwed,
  FRONT_WINDOW_POLL_MS,
  type FrontWindowActivity,
  foldDriftWatch,
  frontWindowActivityOf,
  IDLE_DRIFT_WATCH,
} from "../../lib/driftWatch";
import { isoQueueSnapshot } from "../../lib/isoQueueItems";
import { ISO_STRAY_STORAGE_KEY, isoStrayStateOf, isoStrayStateText } from "../../lib/isoStrayStore";
import {
  foldIsoStrayWatch,
  IDLE_ISO_STRAY_WATCH,
  ISO_STRAY_RETRY_MS,
  type IsoStrayInput,
  type IsoStrayState,
  isoNudgeOwed,
} from "../../lib/isoStrayWatch";
import { type ActionItemReadings, actionItemProjection } from "../../lib/talkActionItems";
import type { HeardSegment } from "../../lib/voiceTranscript";
import { useWorkspacePlacer } from "../console/organisationState";
import { type FocusSeams, newestFinalWordsOf } from "./focusRun";
import { driftPlanCall, isoNudgePlanCall, type PlanPost } from "./planCallClient";
import type { HeldPlanCall } from "./planWiringHeld";
import { useLatest } from "./useLatest";
import type { ToolLine } from "./voiceContext";

/** The wall clock, read only inside a timer or a tool call, never while rendering. */
const wallMs = (): number => Date.now();

/**
 * How long until the next pass after one notice's post, and whether the watch should count it told: taken, or a
 * failure other than a refused floor or a lost answer, since a failed write may still have been said.
 *
 * @param posted what the post came back with
 * @param retryMs how soon to post again while it is still owed
 * @returns the delay, and whether it counts as told
 */
function afterPost({ posted, retryMs }: { posted: PlanPost; retryMs: number }): {
  readonly delayMs: number;
  readonly told: boolean;
} {
  if (posted.kind === "taken") {
    return { delayMs: FRONT_WINDOW_POLL_MS, told: true };
  }
  if (posted.kind === "lost" || posted.status === 409) {
    return { delayMs: retryMs, told: false };
  }
  return { delayMs: FRONT_WINDOW_POLL_MS, told: true };
}

/**
 * The sampler, with the drift watch as `focus_set`, `focus_end` and `focus_quiet` reach it.
 *
 * @param planCall the plan call this page holds, which each notice is posted to
 * @param frontWindow the desktop shell's front-window read, `undefined` in a browser or under an older shell
 * @param heard the conversation as last rendered, which a plan is bound to the owner's newest words in
 * @param live the live call, `undefined` when none is up: the ISO watch samples only while one is
 * @param readings the Queue's readings as last rendered, which the ISO cards waiting on the owner are projected from
 * @param openKeyNow the card open in Slopweaver at the moment it is called
 * @param note writes a line in the call's log
 * @returns the drift seams, stable for the provider's life
 */
export function useFrontWindowNotices({
  planCall,
  frontWindow,
  heard,
  live,
  readings,
  openKeyNow,
  note,
}: {
  planCall: RefObject<HeldPlanCall | undefined>;
  frontWindow: (() => Promise<unknown>) | undefined;
  heard: RefObject<{ readonly segments: readonly HeardSegment[] }>;
  live: unknown;
  readings: ActionItemReadings;
  openKeyNow: () => string | undefined;
  note: (input: { line: ToolLine }) => void;
}): FocusSeams {
  const watch = useRef<DriftWatchState>(IDLE_DRIFT_WATCH);
  const iso = useRef<IsoStrayState>(IDLE_ISO_STRAY_WATCH);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // True while an ISO nudge's post is unanswered, so a pass never sends a second beside it.
  const isoPosting = useRef(false);
  // False once the provider unmounts, so a read already in flight never arms another past it.
  const mounted = useRef(true);
  const noteRef = useLatest({ value: note });
  const readFront = useLatest({ value: frontWindow });
  const callUp = useLatest({ value: live !== undefined });
  const readingsRef = useLatest({ value: readings });
  const placerRef = useLatest({ value: useWorkspacePlacer() });
  const openKeyRef = useLatest({ value: openKeyNow });
  // Set once storage has failed and the log says so, so a full quota is one line rather than one every poll.
  const storageNoted = useRef(false);
  /** Log, once per mount, that this browser would not keep the ISO watch, so a reload restarts its cadence. */
  const storageFailed = ({ cause }: { cause: unknown }): void => {
    if (storageNoted.current) {
      return;
    }
    storageNoted.current = true;
    const detail = `the ISO watch could not be kept in this browser, so a reload restarts its cadence: ${String(cause)}`;
    noteRef.current({ line: { detail, ms: undefined, name: "iso nudge", refused: true, usage: undefined } });
  };
  const storageFailedRef = useLatest({ value: storageFailed });
  useEffect(() => {
    mounted.current = true;
    // The cadence outlives a reload: an idle watch here would buy a fresh first nudge mid-stretch.
    try {
      const kept = isoStrayStateOf({ nowMs: wallMs(), text: window.localStorage.getItem(ISO_STRAY_STORAGE_KEY) });
      if (kept !== undefined) {
        iso.current = kept;
      }
    } catch (cause) {
      storageFailedRef.current({ cause });
    }
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [storageFailedRef]);
  const seams = useMemo(() => {
    const fold = ({ input }: { input: DriftWatchInput }): void => {
      watch.current = foldDriftWatch({ input, state: watch.current });
    };
    const foldIso = ({ input }: { input: IsoStrayInput }): void => {
      iso.current = foldIsoStrayWatch({ input, state: iso.current });
      // A write that throws (a full quota, storage turned off) costs only the carry-over, never the sampler.
      try {
        window.localStorage.setItem(ISO_STRAY_STORAGE_KEY, isoStrayStateText({ state: iso.current }));
      } catch (cause) {
        storageFailedRef.current({ cause });
      }
    };
    const line = ({ detail, name, refused }: { detail: string; name: string; refused: boolean }): void => {
      noteRef.current({ line: { detail, ms: undefined, name, refused, usage: undefined } });
    };
    const running = (): boolean =>
      mounted.current && readFront.current !== undefined && (watch.current.plan !== undefined || callUp.current);
    const arm = ({ ms }: { ms: number }): void => {
      clearTimeout(timer.current);
      timer.current = undefined;
      if (running()) {
        timer.current = setTimeout(() => void tick(), ms);
      }
    };
    /**
     * Fold one sample into both watches: the drift one only when `drift` says the read is one drift would have taken,
     * the ISO one always.
     */
    const sample = ({ activity, drift }: { activity: FrontWindowActivity | undefined; drift: boolean }): void => {
      const nowMs = wallMs();
      if (drift) {
        fold({ input: { activity, freshId: crypto.randomUUID(), kind: "sample", nowMs } });
      }
      const rows = actionItemProjection({
        nowIso: new Date(nowMs).toISOString(),
        placer: placerRef.current,
        readings: readingsRef.current,
      }).live;
      const queue = isoQueueSnapshot({ openKey: openKeyRef.current(), rows });
      const timeZone = readerTimeZone();
      const input = { activity, freshId: crypto.randomUUID(), kind: "sample", nowMs, queue, timeZone } as const;
      foldIso({ input });
    };
    /** Post the drift line if one is owed, answering the delay after it or `undefined` when none was. */
    const postDrift = async ({ held }: { held: HeldPlanCall }): Promise<number | undefined> => {
      const owed = driftOwed({ nowMs: wallMs(), state: watch.current });
      if (owed === undefined) {
        return undefined;
      }
      const posted = await driftPlanCall({ callId: held.callId, notice: owed });
      const after = afterPost({ posted, retryMs: DRIFT_RETRY_MS });
      if (after.told) {
        fold({ input: { kind: "told", noticeId: owed.noticeId, nowMs: wallMs() } });
      }
      if (posted.kind === "taken") {
        const detail = `drift: ${owed.app} for ${String(owed.minutes)} min, against "${owed.plan}"`;
        line({ detail, name: "drift watch", refused: false });
      } else if (after.told) {
        line({ detail: `the drift line was refused: ${posted.why}`, name: "drift watch", refused: true });
      }
      return after.delayMs;
    };
    /**
     * Post the ISO nudge if one is owed and none is in flight, beside the sampler rather than inside its pass. A refused
     * floor or a lost answer retries sooner only while no plan holds the timer; under a plan the next poll retries it.
     */
    const postIso = async ({ held }: { held: HeldPlanCall }): Promise<void> => {
      const owed = isoNudgeOwed({ state: iso.current });
      if (owed === undefined || isoPosting.current) {
        return;
      }
      isoPosting.current = true;
      const posted = await isoNudgePlanCall({ callId: held.callId, notice: owed }).finally(() => {
        isoPosting.current = false;
      });
      if (!mounted.current) {
        return;
      }
      const after = afterPost({ posted, retryMs: ISO_STRAY_RETRY_MS });
      // Only a poll already waiting is brought forward: one with a pass running would start a second pass beside it.
      if (!after.told && watch.current.plan === undefined && timer.current !== undefined) {
        arm({ ms: after.delayMs });
      }
      if (after.told) {
        foldIso({ input: { kind: "told", noticeId: owed.noticeId, nowMs: wallMs() } });
      }
      if (posted.kind === "taken") {
        const detail = `ISO nudge: "${owed.item.subject}" after ${String(owed.minutes)} min off ISO`;
        line({ detail, name: "iso nudge", refused: false });
      } else if (after.told) {
        line({ detail: `the ISO nudge was refused: ${posted.why}`, name: "iso nudge", refused: true });
      }
    };
    /**
     * One pass: sample the front window, then post the drift line if one is owed, else arm the next poll and send the
     * ISO nudge beside it. Drift's schedule is armed exactly where the old drift-only sampler armed it, so the ISO
     * watch sharing the timer never moves it.
     */
    const tick = async (): Promise<void> => {
      timer.current = undefined;
      const read = readFront.current;
      const held = planCall.current;
      if (!running() || read === undefined) {
        return;
      }
      if (held === undefined) {
        // No call up: nothing is read, and an unread stretch is never counted toward either notice.
        sample({ activity: undefined, drift: watch.current.plan !== undefined });
        arm({ ms: FRONT_WINDOW_POLL_MS });
        return;
      }
      // Drift folds only a read the old drift-only sampler would have started too, one begun while a plan was held: a
      // read the ISO watch began before `focus_set` stays out, so drift's first read is still a poll after it.
      const planAtRead = watch.current.plan;
      const activity = frontWindowActivityOf({ value: await read().catch(() => undefined) });
      if (!running()) {
        return;
      }
      sample({ activity, drift: planAtRead !== undefined && watch.current.plan !== undefined });
      const driftDelay = await postDrift({ held });
      if (!mounted.current) {
        return;
      }
      if (driftDelay !== undefined) {
        arm({ ms: driftDelay });
        return;
      }
      // The next poll is armed before the ISO post, never after it, so its latency never moves drift's schedule; and
      // a pass begun with no plan never replaces the poll a `focus_set` armed while it ran.
      if (planAtRead !== undefined || timer.current === undefined) {
        arm({ ms: FRONT_WINDOW_POLL_MS });
      }
      void postIso({ held });
    };
    const focus: FocusSeams = {
      apply: ({ input }) => {
        fold({ input });
        if (input.kind === "set") {
          arm({ ms: FRONT_WINDOW_POLL_MS });
        }
        if (input.kind === "end" && !running()) {
          clearTimeout(timer.current);
          timer.current = undefined;
        }
      },
      canWatch: () => readFront.current !== undefined,
      heard: () => newestFinalWordsOf({ segments: heard.current.segments }),
      nowMs: wallMs,
      read: () => watch.current,
    };
    return { arm, focus };
  }, [callUp, heard, noteRef, openKeyRef, placerRef, planCall, readFront, readingsRef, storageFailedRef]);
  const isLive = live !== undefined;
  useEffect(() => {
    // A call going live starts the sampler for the ISO watch; one ending stops it unless a plan still holds it.
    if (isLive && timer.current === undefined) {
      seams.arm({ ms: FRONT_WINDOW_POLL_MS });
    }
  }, [isLive, seams]);
  return seams.focus;
}
