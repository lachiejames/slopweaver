"use client";

/**
 * What the orb draws, kept beside the call rather than inside it: the activity fold the session's events feed
 * (`site/lib/voiceActivity.ts`), and a clock that re-reads it with both meters twelve times a second while live.
 * The fold is pure; this hook is its one effectful shell — `performance.now()` and the two analysers.
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { QuietRollover } from "../../lib/callRollover";
import { pageRolloverHold, voiceMidAnswerAt } from "../../lib/callRolloverFloor";
import { ownerTalkingShown, wordsLatchOf } from "../../lib/ownerTalkingShown";
import {
  type ActivityInput,
  type ActivityRow,
  activityRows,
  foldActivity,
  NO_ACTIVITY,
  type NudgeOffer,
  nudgeOfferOf,
  resumeDecisionOf,
  type VoiceActivity,
  type VoiceLink,
  type VoiceStatus,
  voiceStatusOf,
} from "../../lib/voiceActivity";
import { progressingWork } from "../../lib/voiceActivityRows";
import { LEVEL_BARS, levelBars, overallLevel, SPEAKING_LEVEL, waveformLevel } from "../../lib/voiceMeter";
import { owedFromMs, PROMISE_MS, promiseDueOf } from "../../lib/voiceOwed";
import { ownerOpenAtOf } from "../../lib/voiceOwnerTurns";
import { codexTurnRunning } from "../../lib/voicePlanWork";
import { foldResumeTrace, NO_RESUME_TRACE, type ResumeTraceState } from "../../lib/voiceResumeTrace";
import { sameRows, sameStatus } from "../../lib/voiceSame";
import type { VoiceLevels } from "../../lib/voiceStage";
import { type Talking, talkingOf } from "../../lib/voiceTalking";
import { micAheadOfWords, ownerSounding } from "../../lib/voiceTurnTaking";
import type { HeldPosts } from "./useHeldPosts";
import { useLatest } from "./useLatest";

/** How often the meter and the status are re-read while a session is live. About twelve frames a second. */
const METER_EVERY_MS = 80;

/** Flat bars, for every moment there is no audio to measure. */
const FLAT: readonly number[] = Array.from({ length: LEVEL_BARS }, () => 0);

/** Both levels at rest, at module scope so every silent moment hands the stage the same object. */
const SILENT: VoiceLevels = { mic: 0, output: 0 };

/** One silent sample: both levels at rest and nobody talking. */
const SILENT_SAMPLE: VoiceSample = { ownerTalking: false, levels: SILENT, talking: undefined };

/**
 * One sample of both meters, as the orb and the cue gate read it: the owner's and the voice's levels apart, who is talking on
 * which signal, with the levels that signal read (`./voiceTalking.ts`), and whether the owner's typing dots show
 * (`ownerTalkingShown`).
 */
export interface VoiceSample {
  readonly ownerTalking: boolean;
  readonly levels: VoiceLevels;
  readonly talking: Talking | undefined;
}

/** Nothing in flight, at module scope so an idle console hands the panel one stable empty list. */
const NO_ROWS: readonly ActivityRow[] = [];

/** The status before any call, at module scope so the first render and every hang-up draw the same one. */
const OFF_STATUS: VoiceStatus = voiceStatusOf({
  activity: NO_ACTIVITY,
  link: "off",
  micLevel: 0,
  micRms: 0,
  muted: false,
  nowMs: 0,
  outputLevel: 0,
});

/** The bars an analyser reads right now, or flat when it is not there. */
function barsOf({
  meter,
  buffer,
}: {
  meter: AnalyserNode | undefined;
  buffer: Uint8Array<ArrayBuffer>;
}): readonly number[] {
  if (meter === undefined) {
    return FLAT;
  }
  meter.getByteFrequencyData(buffer);
  return levelBars({ bars: LEVEL_BARS, bins: buffer });
}

/** The RMS an analyser reads right now, or 0 when it is not there. */
function rmsOf({ meter, buffer }: { meter: AnalyserNode | undefined; buffer: Uint8Array<ArrayBuffer> }): number {
  if (meter === undefined) {
    return 0;
  }
  meter.getByteTimeDomainData(buffer);
  return waveformLevel({ samples: buffer });
}

/**
 * The orb's state for one provider.
 *
 * @param link where the connection is; the clock runs only while it is live
 * @param muted whether the owner's microphone is muted
 * @param micMeter the owner's microphone's analyser, set once the call has one
 * @param outMeter the voice's own analyser, set once its track arrives
 * @param posts the held plan call's posts the clock makes itself: `resumeQuiet` asks the voice to take its turn, at
 *   most once per silence of the owner's, the moment `resumeDueOf` says so, folding `resumed` itself before it posts, so a slow
 *   post is never sent twice and a silence with no held call to take it is never marked handled; `keepPromise` presses the nudge over a promise the voice never started, at most once per thing the owner
 *   said, the moment `promiseDueOf` says so, folding `promise-kept` first; `observeResumeGate` writes the gate that
 *   held a resume through a silence of the owner's, once per gate (`foldResumeTrace`)
 * @param rollover the page's held rollover: asked on every sample for the stage a held ask is in, and told what holds
 *   the floor at that stage (`pageRolloverHold`, `callRolloverFloor.ts`), so a rollover the server asked for goes ahead
 *   only on a floor the page itself saw free
 * @returns `act` to feed the fold, `reset` for a hang-up, `offer` for the nudge a press may send now, judged on the
 *   live fold rather than the last render, `workRunning` for whether a Codex turn still runs on that same live fold,
 *   `sounding` for whether the microphone carries the owner talking on it, `micAhead` for whether it was audible after the
 *   latest words it transcribed reached the page, and what to draw: the bars, the `sample` of
 *   both meters, the status and the rows in flight
 */
export function useVoiceActivity({
  link,
  rollover,
  micMeter,
  muted,
  outMeter,
  posts,
}: {
  link: VoiceLink;
  rollover: Pick<QuietRollover, "observed" | "stage">;
  micMeter: RefObject<AnalyserNode | undefined>;
  muted: boolean;
  outMeter: RefObject<AnalyserNode | undefined>;
  posts: RefObject<Pick<HeldPosts, "keepPromise" | "observeResumeGate" | "resumeQuiet">>;
}): {
  act: (options: { input: ActivityInput }) => void;
  bars: readonly number[];
  inFlight: readonly ActivityRow[];
  offer: () => NudgeOffer | undefined;
  reset: () => void;
  sounding: () => boolean;
  micAhead: () => boolean;
  sample: VoiceSample;
  status: VoiceStatus;
  workRunning: () => boolean;
} {
  const activity = useRef<VoiceActivity>(NO_ACTIVITY);
  const resumeTrace = useRef<ResumeTraceState>(NO_RESUME_TRACE);
  const [status, setStatus] = useState<VoiceStatus>(OFF_STATUS);
  const [rows, setRows] = useState<readonly ActivityRow[]>(NO_ROWS);
  const [bars, setBars] = useState<readonly number[]>(FLAT);
  const [sample, setSample] = useState<VoiceSample>(SILENT_SAMPLE);
  // The stretch of the owner's a word has landed in (`wordsLatchOf`), folded on every event and read, so their typing dots stay
  // down for it whatever later clears the marker that latched it.
  const wordsLatch = useRef<number | undefined>(undefined);

  const act = useCallback(({ input }: { input: ActivityInput }): void => {
    const nowMs = performance.now();
    activity.current = foldActivity({ activity: activity.current, input, nowMs });
    wordsLatch.current = wordsLatchOf({ activity: activity.current, latched: wordsLatch.current });
    // A word of the owner's folded between two clock reads ends their typing dots at once, never a read later: the history
    // re-renders on that word, and a held true would flash them under a turn it just settled.
    // Only ever cleared here; the clock alone shows them.
    if (!ownerTalkingShown({ nowMs, turn: activity.current.turn, wordsLatch: wordsLatch.current })) {
      setSample((held) => (held.ownerTalking ? { ...held, ownerTalking: false } : held));
    }
  }, []);
  const reset = useCallback((): void => {
    activity.current = NO_ACTIVITY;
    wordsLatch.current = undefined;
    resumeTrace.current = NO_RESUME_TRACE;
    setBars(FLAT);
    setSample(SILENT_SAMPLE);
  }, []);
  const offer = useCallback(
    (): NudgeOffer | undefined => nudgeOfferOf({ activity: activity.current, nowMs: performance.now() }),
    [],
  );
  // Read off the live fold, never the sampled rows: a completion folded between two samples ends the work at once.
  const workRunning = useCallback(
    (): boolean =>
      link === "live" &&
      codexTurnRunning({ rows: activityRows({ activity: activity.current, nowMs: performance.now() }) }),
    [link],
  );
  // Off the live fold too: the owner's stretch of sound, bridged across a breath, so a pause between words is not quiet. The link
  // is read when it RUNS, so a caller holding this from before the call went live still hears them.
  const linkNow = useLatest({ value: link });
  const sounding = useCallback(
    (): boolean =>
      linkNow.current === "live" && ownerSounding({ nowMs: performance.now(), turn: activity.current.turn }),
    [linkNow],
  );
  // Off the live fold as well: the owner's microphone audible after their latest words reached the page, which a relay
  // reads at hand-off so speech the transcript has not caught up with stamps it cut (`micAheadOfWords`). Unlike
  // `sounding`, no link guard: a relay can still land while the link heals, and a sample already recorded stays later
  // than the words whatever the link now reads, so a guard could only ever turn `cut` back into `whole`.
  const micAhead = useCallback(
    (): boolean =>
      micAheadOfWords({
        lastTranscribedMs: activity.current.lastTranscribedMs,
        ownerStretch: activity.current.turn.owner,
      }),
    [],
  );

  // Any change of link or mute drops the owner's typing dots from the stored sample in the same render, and only a read on the
  // meter clock below shows them again: an unmute or a reconnect cannot bring a held value back. Adjusted while rendering, never in an effect, so no frame paints the held value first.
  const dotsKey = `${link}|${String(muted)}`;
  const [dotsKeySeen, setDotsKeySeen] = useState(dotsKey);
  if (dotsKeySeen !== dotsKey) {
    setDotsKeySeen(dotsKey);
    setSample((held) => (held.ownerTalking ? { ...held, ownerTalking: false } : held));
  }

  // The meter and the status, re-read on a clock while live; derived from the link alone otherwise, below.
  useEffect(() => {
    if (link !== "live") {
      return undefined;
    }
    const buffer = new Uint8Array(32);
    // A time-domain read is one sample per FFT slot: 64, the meters' `fftSize` (`callAudio.ts`).
    const wave = new Uint8Array(64);
    const timer = window.setInterval(() => {
      const outBars = barsOf({ buffer, meter: outMeter.current });
      const micBars = barsOf({ buffer, meter: micMeter.current });
      // Each RMS is read beside its bars, before anything decides on them, so a trace never mixes two moments.
      const micRms = rmsOf({ buffer: wave, meter: micMeter.current });
      const outputRms = rmsOf({ buffer: wave, meter: outMeter.current });
      const outputLevel = overallLevel({ bars: outBars });
      const micLevel = overallLevel({ bars: micBars });
      setBars(outputLevel >= SPEAKING_LEVEL ? outBars : micBars);
      const nowMs = performance.now();
      // Both meters join the fold first, so the read below sees the voice stopping for the owner on the sample it did.
      activity.current = foldActivity({
        activity: activity.current,
        input: { kind: "sounded", micLevel, micRms, muted, outputLevel },
        nowMs,
      });
      // `resumeQuiet` folds `resumed` itself, synchronously, and only when a held call will take the post.
      // The owner's mute is a quiet microphone, whatever its meter reads of the room, and ends a filler they trailed off on.
      const decision = resumeDecisionOf({ activity: activity.current, micLevel, micRms, muted, nowMs });
      if (decision.kind === "due") {
        posts.current.resumeQuiet();
      }
      // A silence the resume stays held through says which gate held it, once per gate (`./voiceResumeTrace.ts`).
      const traced = foldResumeTrace({
        activity: activity.current,
        decision,
        micLevel,
        micRms,
        muted,
        nowMs,
        state: resumeTrace.current,
      });
      resumeTrace.current = traced.state;
      if (traced.observation !== undefined) {
        posts.current.observeResumeGate({ observation: traced.observation });
      }
      if (
        promiseDueOf({
          activity: activity.current,
          afterMs: PROMISE_MS,
          inFlight: activityRows({ activity: activity.current, nowMs }).length,
          micLevel,
          micRms,
          muted,
          nowMs,
        })
      ) {
        activity.current = foldActivity({ activity: activity.current, input: { kind: "promise-kept" }, nowMs });
        posts.current.keepPromise();
      }
      const next = voiceStatusOf({
        activity: activity.current,
        link,
        micLevel,
        micRms,
        muted,
        nowMs,
        outputLevel,
      });
      // Read off the same sample as the status, so the cue gate holds a badge on exactly what drew the phase.
      const signal = talkingOf({ activity: activity.current, micLevel, micRms, muted, nowMs, outputLevel });
      let talking: Talking | undefined;
      if (signal !== undefined) {
        talking = { micLevel, micRms, muted, outputLevel, outputRms, signal };
      }
      // Muted, the voice hears nothing, so the stage orb must not look as if it does, nor the owner's typing dots show.
      wordsLatch.current = wordsLatchOf({ activity: activity.current, latched: wordsLatch.current });
      const ownerTalking =
        !muted && ownerTalkingShown({ nowMs, turn: activity.current.turn, wordsLatch: wordsLatch.current });
      setSample({ ownerTalking, levels: { mic: muted ? 0 : micLevel, output: outputLevel }, talking });
      // The same status twelve times a second is one render, not twelve.
      setStatus((held) => (sameStatus({ a: held, b: next }) ? held : next));
      const inFlight = activityRows({ activity: activity.current, nowMs });
      setRows((held) => (sameRows({ a: held, b: inFlight }) ? held : inFlight));
      // Judged only while the server's ask is held, at the stage its call's remaining lifetime puts it in.
      const stage = rollover.stage({ nowMs });
      if (stage !== undefined) {
        const hold = pageRolloverHold({
          answerHandedAtMs: activity.current.plan.lastAnswerHandedMs,
          answerPendingMs: activity.current.plan.answerPendingMs,
          completedAtMs: activity.current.plan.lastCompletedMs,
          heardAtMs: activity.current.lastHeardMs,
          inFlight: inFlight.length,
          nowMs,
          nudgedAtMs: activity.current.nudgedAtMs,
          owedFromMs: owedFromMs({ activity: activity.current }),
          ownerAwaitingVoiceMs: activity.current.owner.awaiting?.sinceMs,
          ownerOpenAtMs: ownerOpenAtOf({ turns: activity.current.owner }),
          remainingMs: stage.remainingMs,
          resumedAtMs: activity.current.resumedAtMs,
          progressingInFlight: progressingWork({ activity: activity.current, nowMs }),
          turn: activity.current.turn,
          urgency: stage.urgency,
          voiceMidAnswerMs: voiceMidAnswerAt({
            answerOpen: activity.current.voiceAnswerOpen,
            lastSpokeMs: activity.current.lastSpokeMs,
          }),
        });
        rollover.observed({ hold, nowMs });
      }
    }, METER_EVERY_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [rollover, link, micMeter, muted, outMeter, posts]);

  const isLive = link === "live";
  // A mute clears the owner's typing dots the render it lands, never a sample later: the clock's next read is up to 80 ms off
  // and the track is already off.
  const shownSample = useMemo<VoiceSample>(() => {
    if (!isLive) {
      return SILENT_SAMPLE;
    }
    if (muted && sample.ownerTalking) {
      return { ...sample, ownerTalking: false };
    }
    return sample;
  }, [isLive, muted, sample]);
  const shownStatus = useMemo<VoiceStatus>(() => {
    if (isLive) {
      return status;
    }
    return voiceStatusOf({
      activity: NO_ACTIVITY,
      link,
      micLevel: 0,
      micRms: 0,
      muted: false,
      nowMs: 0,
      outputLevel: 0,
    });
  }, [isLive, link, status]);

  return {
    act,
    bars: isLive ? bars : FLAT,
    inFlight: isLive ? rows : NO_ROWS,
    micAhead,
    offer,
    reset,
    sounding,
    sample: shownSample,
    status: shownStatus,
    workRunning,
  };
}
