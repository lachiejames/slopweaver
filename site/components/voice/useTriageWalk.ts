"use client";

/**
 * The page's triage pass (`../../lib/triageWalk.ts`) and its card clock (`../../lib/triageWalkClock.ts`), wired
 * to a real timer, the call's `triage-due` route and the desktop shell's countdown, held beside the `open_card` seams
 * it walks with (`./useOpenCardSeams.ts`).
 *
 * The clock is visible, a countdown while a triage is running: every
 * change to the pass or its clock goes to the shell as a {@link TriageClockReport}, which counts it down beside the
 * Slopweaver menu bar item and gives each floating note its pause and off buttons (`desktop/src/triageShell.ts`). At
 * zero a chime rings once for the card: the call's own attention herald before its time-up line while a voice call
 * is up, else the page's (`ding`), so a typed pass hears it too and a voice one never hears two. One clock runs at a
 * time: the next card replaces it, the owner's ruling spends it, and the end stops it. When it
 * runs out the page posts the visit's id, never while the owner's microphone sounds (`triageDueReady`); the call refuses
 * while the owner or the voice holds the floor, the owner's utterance open included, so the page posts
 * again every few seconds for as long as the line is still owed — the same card in front of the owner, unruled, the pass
 * not stopped, and, once it has been on the owner's screen at any point in its visit, still open (`triageClockOwedOnScreen`). A card
 * the owner closed or left for another spends the firing, and opening it again does not bring the line back.
 *
 * The pass is kept for the provider's life, not one call's, so a rollover onto a fresh plan call carries it on — and
 * `triage_end` only stops it, never drops it, so the owner's place survives an end. It is kept
 * in `localStorage` too (`../../lib/triageWalkKept.ts`), so a reload, which ends the call for good, does not end the
 * pass: read back on first use, it waits stopped for the next `triage_next`, which picks it up where it stopped.
 */
import { type RefObject, useEffect, useMemo, useRef } from "react";

import type { TriageClockReport } from "../../lib/triageBridge";
import { sameTriageClockReport, triageClockReportOf } from "../../lib/triageClockReport";
import { TriageClockRounds } from "../../lib/triageClockRounds";
import { TriageTurnFronts } from "../../lib/triageTurnFronts";
import { shownVisitAfter, triageClockOwedOnScreen, triageDueReady } from "../../lib/triageWalkClock";
import {
  keptTriageWalkChanged,
  keptTriageWalkOf,
  keptTriageWalkText,
  reloadedTriageWalk,
  TRIAGE_WALK_KEY,
} from "../../lib/triageWalkKept";
import type { TriageVisit, TriageWalk } from "../../lib/triageWalkTypes";
import type { TriageClockLink } from "./desktopVoiceSeam";
import { triageDuePlanCall } from "./planCallClient";
import type { HeldPlanCall } from "./planWiringHeld";
import type { TriageWalkSeams } from "./triageRun";
import { useLatest } from "./useLatest";
import type { ToolLine } from "./voiceContext";

/** How soon a refused or lost time-up line is posted again while it is still owed. */
const TRIAGE_DUE_RETRY_MS = 4_000;

/** The `triage-due` route's refusal of a typed conversation, which has no voice to say the line. */
const TYPED_CONVERSATION_STATUS = 422;

/**
 * The pass this browser kept, stopped: the call it ran in is over, so the next `triage_next` resumes it.
 *
 * @returns the kept pass, or `undefined` when none is kept, it does not read, or storage cannot be read
 */
function keptWalk(): TriageWalk | undefined {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(TRIAGE_WALK_KEY);
  } catch {
    return undefined;
  }
  const kept = keptTriageWalkOf({ raw });
  return kept === undefined ? undefined : reloadedTriageWalk({ walk: kept });
}

/**
 * Keep the pass in this browser, or forget it with `undefined`.
 *
 * @param walk the pass now
 */
function keepWalk({ walk }: { walk: TriageWalk | undefined }): void {
  try {
    if (walk === undefined) {
      window.localStorage.removeItem(TRIAGE_WALK_KEY);
    } else {
      window.localStorage.setItem(TRIAGE_WALK_KEY, keptTriageWalkText({ walk }));
    }
  } catch {
    // Storage that refuses a write leaves the pass in this page alone; a reload then starts a fresh one.
  }
}

/** Where the pass's clock is shown and heard beyond the call: the shell's countdown, and the page's own chime. */
export interface TriageClockOut {
  /** The shell's link, read at each change; `undefined` outside the desktop app's voice window. */
  readonly link: () => TriageClockLink | undefined;
  /** A card's clock ran out: ring the chime, unless a voice call is up to herald its own line. */
  readonly ding: () => void;
  /** Each change to the clock, for the voice's own buttons beside the orb. */
  readonly shown: (input: { readonly report: TriageClockReport }) => void;
}

/**
 * The pass and its clock, as `triage_next`, `triage_end`, `triage_clock`, a relay's ruling and the shell's presses
 * reach them.
 *
 * @param planCall the plan call this page holds, which the time-up line is posted to
 * @param openKeyNow reads the card open on the page right now, `undefined` when none is
 * @param note writes a line in the call's log
 * @param sounding reads whether the owner's microphone carries their voice right now, which holds the line a retry
 * @param clockOut where every change to the clock is reported, and the chime at zero
 * @returns the seams, stable for the provider's life
 */
export function useTriageWalk({
  planCall,
  openKeyNow,
  note,
  sounding,
  clockOut,
}: {
  planCall: RefObject<HeldPlanCall | undefined>;
  openKeyNow: () => string | undefined;
  note: (input: { line: ToolLine }) => void;
  sounding: () => boolean;
  clockOut: TriageClockOut;
}): TriageWalkSeams {
  const walk = useRef<TriageWalk | undefined>(undefined);
  // Storage is read on first use, never during render, so the server's render and the first client one agree.
  const hydrated = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A stop reaches a callback already posting the due line, not only the handle it cleared.
  const rounds = useRef(new TriageClockRounds());
  // The card in front of the owner as each answer began, which a ruling in it binds to.
  const fronts = useRef(new TriageTurnFronts());
  // False once the provider unmounts, so a clock already firing never arms another past it.
  const mounted = useRef(true);
  const noteRef = useLatest({ value: note });
  const openKeyRef = useLatest({ value: openKeyNow });
  const soundingRef = useLatest({ value: sounding });
  const clockOutRef = useLatest({ value: clockOut });
  // When the card's armed clock runs out, `undefined` while none is — set where it is armed and cleared where it stops,
  // never by a write — and the report the shell last had, so a change is sent once and an arm after a write is sent at all.
  const armedDeadline = useRef<number | undefined>(undefined);
  // Each visit's clock length, kept in the page alone: a reload stops the pass and its clock, and the next card gets
  // its own length, so no kept pass carries one.
  const lengths = useRef(new Map<string, number>());
  const reported = useRef<TriageClockReport | undefined>(undefined);
  // The visits whose chime has rung: once each, however often the line is posted again.
  const dinged = useRef(new Set<string>());
  const publish = useRef(({ report }: { report: TriageClockReport }): void => {
    if (sameTriageClockReport({ after: report, before: reported.current })) {
      return;
    }
    reported.current = report;
    clockOutRef.current.shown({ report });
    clockOutRef.current.link()?.report({ report });
  });
  // The visit last seen open on the page as a clock started: a `triage_clock` restart after the owner closed it is still a
  // card the owner was shown, never one read with nothing open.
  const shownVisit = useRef<string | undefined>(undefined);
  // The owner can open the current card while its clock runs, then leave it: that is a card shown too. A
  // card opening or closing re-renders the provider (its `openCard` state), so sampling after every render sees it.
  useEffect(() => {
    const visit = walk.current?.current;
    if (visit !== undefined) {
      shownVisit.current = shownVisitAfter({
        openKey: openKeyRef.current(),
        opened: false,
        shownVisit: shownVisit.current,
        visit,
      });
    }
  });
  useEffect(() => {
    mounted.current = true;
    const report = publish.current;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      timer.current = undefined;
      armedDeadline.current = undefined;
      // The pass stops with the page that ran it, so the shell's countdown does too.
      report({ report: { on: false } });
    };
  }, []);
  // Another tab kept the pass since: this page's copy is stale, so its clock stops and its next use reads the
  // browser's one pass again. The event never fires in the tab that wrote. What it does not reach is a due line already
  // posting: the server ends no voice call when another tab starts one (`../../lib/talkArbiter.ts` leaves that to each
  // page), and `triage-due` asks only whether this call's card is still the one held, so with a call live in each tab
  // that line can still be said once. Closing it needs the server to know which tab kept the pass (Codex fx-03).
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (!keptTriageWalkChanged({ key: event.key })) {
        return;
      }
      hydrated.current = false;
      rounds.current.stop();
      clearTimeout(timer.current);
      timer.current = undefined;
      armedDeadline.current = undefined;
      // Read back on its next use, the pass waits stopped, so nothing is counting down here.
      publish.current({ report: { on: false } });
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return useMemo((): TriageWalkSeams => {
    const current = (): TriageWalk | undefined => {
      if (!hydrated.current) {
        hydrated.current = true;
        walk.current = keptWalk();
      }
      return walk.current;
    };
    const report = (): void => {
      publish.current({ report: triageClockReportOf({ armedDeadlineMs: armedDeadline.current, walk: walk.current }) });
    };
    const stopClock = (): void => {
      rounds.current.stop();
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
      armedDeadline.current = undefined;
      report();
    };
    const line = ({ detail, refused }: { detail: string; refused: boolean }): void => {
      noteRef.current({ line: { detail, ms: undefined, name: "triage clock", refused, usage: undefined } });
    };
    const fire = async ({ visit, round }: { visit: TriageVisit; round: number }): Promise<void> => {
      timer.current = undefined;
      // Read at each firing, not when the clock started: a card the owner opened and left since was shown. What
      // this does not close: the page's view of the owner's card lags their move by the time it takes to reach the page — one
      // render here, one shell event more in the desktop voice window — and a line posted before the owner moved still lands.
      // Closing both needs the server to check the open card itself as it hands the line over.
      const owedNow = (): boolean =>
        mounted.current &&
        rounds.current.holds({ round }) &&
        triageClockOwedOnScreen({
          openKey: openKeyRef.current(),
          shown: shownVisit.current === visit.visitId,
          visitId: visit.visitId,
          walk: walk.current,
        });
      if (!owedNow()) {
        return;
      }
      if (!dinged.current.has(visit.visitId)) {
        dinged.current.add(visit.visitId);
        clockOutRef.current.ding();
      }
      const again = (): void => {
        timer.current = setTimeout(() => void fire({ round, visit }), TRIAGE_DUE_RETRY_MS);
      };
      const held = planCall.current;
      if (held === undefined || !triageDueReady({ microphoneSounding: soundingRef.current(), owed: true })) {
        again();
        return;
      }
      const posted = await triageDuePlanCall({ callId: held.callId, visitId: visit.visitId });
      if (posted.kind === "taken") {
        line({ detail: `time up on ${visit.key}`, refused: false });
        return;
      }
      const retry = posted.kind === "lost" || posted.status === 409;
      if (retry && owedNow() && timer.current === undefined) {
        again();
        return;
      }
      // A typed pass has no voice to say the line (the route's 422): the page's chime was its whole signal.
      const typedPass = posted.kind === "refused" && posted.status === TYPED_CONVERSATION_STATUS;
      if (!retry && !typedPass) {
        line({ detail: `the time-up line on ${visit.key} was refused: ${posted.why}`, refused: true });
      }
    };
    return {
      frontOf: ({ answerId }) => fronts.current.frontOf({ answerId }),
      keepLength: ({ visitId, lengthMs }) => {
        lengths.current.set(visitId, lengthMs);
      },
      lengthOf: ({ visitId }) => lengths.current.get(visitId),
      mintId: () => crypto.randomUUID(),
      nowMs: () => Date.now(),
      read: current,
      startClock: ({ visit, shown: opened, lengthMs }) => {
        stopClock();
        // A triage_next whose open resolved after the provider unmounted arms nothing its cleanup cannot clear.
        if (!mounted.current) {
          return;
        }
        const round = rounds.current.arm();
        // The open's own word first, the page's view second: a card the voice read with nothing open has no screen to
        // leave, so only the pass decides its line.
        shownVisit.current = shownVisitAfter({
          openKey: openKeyRef.current(),
          opened,
          shownVisit: shownVisit.current,
          visit,
        });
        lengths.current.set(visit.visitId, lengthMs);
        const deadlineMs = visit.presentedMs + lengthMs;
        timer.current = setTimeout(() => void fire({ round, visit }), Math.max(0, deadlineMs - Date.now()));
        armedDeadline.current = deadlineMs;
        report();
      },
      stopClock,
      turnStarted: ({ turnId }) => fronts.current.started({ turnId, walk: current() }),
      write: ({ walk: next }) => {
        hydrated.current = true;
        walk.current = next;
        keepWalk({ walk: next });
        report();
      },
    };
  }, [clockOutRef, noteRef, openKeyRef, planCall, soundingRef]);
}
