"use client";

/**
 * The orb's sound, wired: the hook that hears the live badge and plays its cue, and the one "sounds" picker,
 * which only the Settings modal draws. There a pick is kept and reaches the call,
 * but its sample plays only where the call's own speaker is — in the desktop app that is the voice's window. What sounds, and when, is `site/lib/orbCue.ts`; how, `./orbCueSound.ts`.
 * The four heralds before a line the owner did not ask for are `site/lib/announceCue.ts`'s, played here through the same player.
 */
import { type ReactElement, type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import {
  ANNOUNCE_TONES,
  announceStaleReason,
  type HeardHerald,
  triageDingStaleReason,
  unheardHeralds,
} from "../../lib/announceCue";
import { type CueName, type CueSource, type CueTraceStale, cueTraceLine } from "../../lib/cueTrace";
import {
  CUE_SAMPLE,
  CUE_SOUND_INTENTS,
  CUE_SOUNDS,
  CUE_TONES,
  type CueNow,
  cueStaleReason,
  DEFAULT_ORB_CUE_SETTING,
  isOrbCueSetting,
  ORB_CUE_STORAGE_KEY,
  OrbCuer,
  type OrbCueSetting,
  PROGRESS_CUE,
  progressCueStaleReason,
  sampleStaleReason,
  type Tone,
} from "../../lib/orbCue";
import type { OrbBadge } from "../../lib/orbMood";
import type { Talking } from "../../lib/voiceTalking";
import { usePreference } from "../console/preference";
import { playOrbCue, recheckOrbCue } from "./orbCueSound";
import { useVoice, type VoiceState } from "./voiceContext";

/** No heralds, outside the voice provider: one constant, so the player's effect is not re-run every render. */
const NO_HERALDS: readonly HeardHerald[] = [];

/**
 * The owner's sounds pick, kept in this browser. Every reader shares one value (`usePreference`), so the Settings modal's
 * picker, the panel's and the hook playing them never disagree, and a pick takes effect on the call already running.
 *
 * @returns the pick and its setter
 */
function useOrbCueSetting(): { readonly value: OrbCueSetting; readonly set: (next: OrbCueSetting) => void } {
  return usePreference({ accept: isOrbCueSetting, fallback: DEFAULT_ORB_CUE_SETTING, key: ORB_CUE_STORAGE_KEY });
}

/**
 * What a waiting sound reads again before it plays: the moment as of the newest commit, the voice's speaker, and a
 * progress cue's two questions — how many progress events the call has had, and whether a Codex turn still runs.
 */
interface CueLive {
  readonly now: CueNow;
  /** Whether a call is up, talking or not: the one question a herald asks of the voice. */
  readonly callActive: boolean;
  /** Whether a call is up in this window or another: the one question the page's own triage chime asks. */
  readonly callUpAnywhere: boolean;
  readonly playingOn: () => string | undefined;
  readonly progress: number;
  /** Asked at the instant a cue plays, off the live activity fold, so a turn completed since the last sample counts. */
  readonly workRunning: () => boolean;
  /** Where a cue's fate is written: the call file's `cue` lines, a no-op outside the voice provider. */
  readonly trace: VoiceState["traceCue"];
  /** Who is talking as of the newest commit and on which signal, so a cue held or dropped for it names which. */
  readonly talking: Talking | undefined;
}

/**
 * Bind a cue's trace to the call running now, guarded at both ends: a trace is best effort, so neither binding it
 * nor making or writing its line can throw into the effect, handler or chain that told it.
 *
 * @param live the moment a cue reads, whose trace binds the call
 * @returns a writer, handed how to make the line, that never throws
 */
function boundTrace({ live }: { live: RefObject<CueLive> }): (make: () => ReturnType<typeof cueTraceLine>) => void {
  let write: ReturnType<VoiceState["traceCue"]> | undefined;
  try {
    write = live.current.trace();
  } catch {
    // Unbound: every line this cue tells is lost, and the cue is not.
  }
  return (make) => {
    try {
      write?.(make());
    } catch {
      // The line is lost; the cue is not.
    }
  };
}

/**
 * Play one cue and write what became of it to the call file: the still-due check it failed is caught as the player
 * asks it, so a cue dropped for somebody talking says so, and one dropped for a speaker change says that instead.
 *
 * @param cue the cue's name, as its trace line opens
 * @param tones its notes
 * @param source a badge, a progress event, a sample or an announce event
 * @param staleNow the cue's still-due question, naming the check it fails now, or `undefined` while it is due
 * @param live the moment a waiting sound reads again, for the speaker; its trace is taken now, so a cue settling
 *   after the owner hangs up still writes to the call it was decided on
 */
function playTraced({
  cue,
  tones,
  source,
  staleNow,
  live,
}: {
  cue: CueName;
  tones: readonly Tone[];
  source: CueSource;
  staleNow: () => CueTraceStale | undefined;
  live: RefObject<CueLive>;
}): void {
  let stale: CueTraceStale | undefined;
  let talking: Talking | undefined;
  const trace = boundTrace({ live });
  playOrbCue({
    due: () => {
      stale = staleNow();
      if (stale !== undefined) {
        talking = live.current.talking;
        return undefined;
      }
      return live.current.playingOn();
    },
    report: ({ outcome }) => {
      trace(() => cueTraceLine({ cue, outcome, source, stale, talking }));
    },
    tones,
  });
}

/**
 * The live moment for a sound waiting on routing to read again. Written in a layout effect, which runs in the same
 * task as the commit, so no routing step can resume between a render and the moment it describes; the speaker is a
 * function that reads the voice's element itself, so a switch not yet rendered is still seen. Each commit also asks
 * the cue already sounding whether it is still due, and fades it out if not.
 *
 * @param badge the live badge, `undefined` where the reader has none
 * @param voice the session, `undefined` outside the voice provider
 * @returns the pick, a way to change it, whether the call is up and quiet, and the ref a waiting sound reads
 */
function useCueLive({ badge, voice }: { badge: OrbBadge | undefined; voice: VoiceState | undefined }): {
  readonly setting: { readonly value: OrbCueSetting; readonly set: (next: OrbCueSetting) => void };
  readonly pick: (next: OrbCueSetting) => void;
  readonly quiet: boolean;
  readonly live: RefObject<CueLive>;
} {
  const setting = useOrbCueSetting();
  let quiet = false;
  let callActive = false;
  let callUpAnywhere = false;
  let playingOn = (): string | undefined => undefined;
  let progress = 0;
  let workRunning = (): boolean => false;
  let trace: VoiceState["traceCue"] = () => () => undefined;
  let talking: Talking | undefined;
  if (voice !== undefined) {
    // Stopped for the owner is the owner talking: no cue sounds over their words. The gate reads the phase it drew; `talking` names
    // its signal for the trace, and a rollover reset can clear that one sample before the phase catches up.
    const talkingPhase = voice.phase === "hearing" || voice.phase === "yielded" || voice.phase === "speaking";
    quiet = voice.callActive && !talkingPhase;
    talking = voice.talking;
    callActive = voice.callActive;
    callUpAnywhere = voice.callActiveAnywhere;
    playingOn = voice.audio.playingOn;
    progress = voice.progressCue;
    workRunning = voice.workRunning;
    // Off a call there is no call file to write to, and the last one is not this cue's.
    if (voice.callActive) {
      trace = voice.traceCue;
    }
  }
  const now = { badge, quiet, setting: setting.value };
  const live = useRef<CueLive>({ callActive, callUpAnywhere, now, playingOn, progress, talking, trace, workRunning });
  useLayoutEffect(() => {
    const at = { badge, quiet, setting: setting.value };
    live.current = { callActive, callUpAnywhere, now: at, playingOn, progress, talking, trace, workRunning };
    recheckOrbCue();
  });
  // A reader gone can no longer say what is due, so what it played is not: its ref stops being quiet, and up.
  useLayoutEffect(
    () => () => {
      live.current = {
        ...live.current,
        callActive: false,
        now: { ...live.current.now, quiet: false },
        talking: undefined,
      };
      recheckOrbCue();
    },
    [live],
  );
  // The pick is the owner's before React renders it, so a sample's first check, a microtask away, already sees it.
  const pick = (next: OrbCueSetting): void => {
    setting.set(next);
    live.current = { ...live.current, now: { ...live.current.now, setting: next } };
  };
  return { live, pick, quiet, setting };
}

/**
 * Play the live badge's cue as it changes. Fed the LIVE face's badge, never a `?orb=` preview's, so a preview is
 * silent; told every badge whether either of them is talking, so a badge that went by while the owner was talking is
 * announced afterwards only if the orb still wears it, while one worn with the owner's sounds off is passed silently; and asked again at the instant a cue is scheduled, so one that waited on
 * routing is dropped if the moment, the pick or the speaker moved on.
 *
 * @param badge the live badge
 * @param voice the session — its phase holds every cue while either of them talks, and its speaker is where one plays
 */
export function useOrbCues({ badge, voice }: { badge: OrbBadge | undefined; voice: VoiceState | undefined }): void {
  const { live, quiet, setting } = useCueLive({ badge, voice });
  const cuer = useRef<OrbCuer | undefined>(undefined);
  const sound = setting.value;
  useEffect(() => {
    if (cuer.current === undefined) {
      cuer.current = new OrbCuer({ clock: () => performance.now() });
    }
    // Held over speech, but never over "off": a badge worn while the owner's sounds are off, talking or not, is announced
    // silently here, so turning them on later never plays it.
    const decision = cuer.current.decide({ moment: { audible: quiet || sound === "off", badge } });
    if (decision === undefined || sound === "off") {
      return;
    }
    const { cue } = decision;
    if (decision.kind !== "play") {
      // This commit's layout effect already wrote the moment that held it, so the line names what decided it.
      const { talking } = live.current;
      boundTrace({ live })(() => cueTraceLine({ cue, outcome: decision, source: "badge", stale: undefined, talking }));
      return;
    }
    playTraced({
      cue,
      live,
      source: "badge",
      staleNow: () => cueStaleReason({ cue, now: live.current.now, sound }),
      tones: CUE_TONES[sound][cue],
    });
  }, [badge, live, quiet, sound]);
  useProgressCue({ live, progress: voice?.progressCue, sound });
  useAnnounceCue({ announce: voice === undefined ? NO_HERALDS : voice.announceCues, live });
  useTriageDing({ dings: voice === undefined ? 0 : voice.triageDings, live });
}

/**
 * Ring the attention chime once each time a triage card's clock runs out with no voice call up, a ding when the countdown reaches zero. On a call the server heralds the voice's own time-up line with
 * the same chime, so the page rings nothing then (`./useTriageCommands.ts`), nor once a call comes up while the chime
 * waits to play (`triageDingStaleReason`). Dropped otherwise only with the owner's sounds off; those
 * counted when the hook first renders are history, so a remount never rings them again.
 *
 * @param dings how many chimes are owed so far, counting up for good
 * @param live the moment a waiting sound reads again, the owner's pick included
 */
function useTriageDing({ dings, live }: { dings: number; live: RefObject<CueLive> }): void {
  const rung = useRef(dings);
  useEffect(() => {
    if (dings <= rung.current) {
      return;
    }
    rung.current = dings;
    playTraced({
      cue: "attention",
      live,
      source: "announce",
      staleNow: () =>
        triageDingStaleReason({ callUpAnywhere: live.current.callUpAnywhere, setting: live.current.now.setting }),
      tones: ANNOUNCE_TONES.attention,
    });
  }, [dings, live]);
}

/**
 * Play each herald the server sends just before a line the owner did not ask for (`site/lib/announceCue.ts`): the focus,
 * reminder, done or attention chime, whoever is talking — the line it heralds is about to be spoken, and a started
 * meeting cuts in over the owner on purpose — and dropped only off a call, with the owner's sounds off, or on a speaker change. Its
 * still-due question never reads the phase, so neither the check after routing nor the recheck on every commit fades
 * it as the voice starts. Every kept one past the last played goes, oldest first, so two set in one render are two
 * chimes. Those kept when the hook first renders are history, so a remount never replays them.
 *
 * @param announce the newest heralds the call sent, oldest first; empty before any or outside the voice provider
 * @param live the moment a waiting sound reads again, the owner's pick included: any sound but `off` plays the same four
 */
function useAnnounceCue({ announce, live }: { announce: VoiceState["announceCues"]; live: RefObject<CueLive> }): void {
  const heard = useRef(newestSeq({ kept: announce }));
  useEffect(() => {
    for (const { cue } of unheardHeralds({ heard: heard.current, kept: announce })) {
      // With the owner's sounds off it still goes to the player, whose first still-due question drops it before any audio, so
      // the call file says why no chime came.
      playTraced({
        cue,
        live,
        source: "announce",
        staleNow: () => announceStaleReason({ callActive: live.current.callActive, setting: live.current.now.setting }),
        tones: ANNOUNCE_TONES[cue],
      });
    }
    heard.current = newestSeq({ kept: announce });
  }, [announce, live]);
}

/**
 * The sequence number of the newest kept herald.
 *
 * @param kept the heralds kept, oldest first
 * @returns its number, 0 when none is kept
 */
function newestSeq({ kept }: { kept: VoiceState["announceCues"] }): number {
  const newest = kept.at(-1);
  if (newest === undefined) {
    return 0;
  }
  return newest.seq;
}

/**
 * Play the working cue once for each `progress` event the server sends while a delegated turn runs on with the voice
 * silent — the sound that stands in for a spoken "still on it". Never over speech, never
 * with the owner's sounds off, never once the work has ended, and never for an event a newer one has superseded: checked at
 * the event and again at the instant it is scheduled (`progressCueStillDue`). One heard when the hook first renders
 * is history, so a remount never replays it.
 *
 * @param live the moment a waiting sound reads again
 * @param progress how many progress events the call has had, `undefined` outside the voice provider
 * @param sound the owner's pick as it stands
 */
function useProgressCue({
  live,
  progress,
  sound,
}: {
  live: RefObject<CueLive>;
  progress: number | undefined;
  sound: OrbCueSetting;
}): void {
  const heard = useRef(progress);
  useEffect(() => {
    if (progress === undefined || progress === heard.current) {
      return;
    }
    heard.current = progress;
    if (sound === "off") {
      return;
    }
    playTraced({
      cue: PROGRESS_CUE,
      live,
      source: "progress",
      staleNow: () => {
        const { now, progress: generation, workRunning } = live.current;
        return progressCueStaleReason({ expected: progress, generation, now, sound, workRunning: workRunning() });
      },
      tones: CUE_TONES[sound][PROGRESS_CUE],
    });
  }, [live, progress, sound]);
}

/**
 * The "sounds" picker: off, or one of the sounds. On a call, in a quiet moment, a pick plays its sample through the
 * voice's speaker so the owner hears what they chose; it is held to every rule a cue is, so a pick changed back before it plays
 * drops it.
 *
 * @param className the surface's own label style
 * @returns the labelled picker
 */
export function CueSoundPick({ className }: { className: string }): ReactElement {
  const voice = useVoice();
  const { live, pick, setting } = useCueLive({ badge: undefined, voice });
  let title = "no sound for what the orb is doing";
  if (setting.value !== "off") {
    title = CUE_SOUND_INTENTS[setting.value];
  }
  return (
    <label className={className} title={title}>
      sounds
      <select
        value={setting.value}
        onChange={(event) => {
          const next = event.target.value;
          if (!isOrbCueSetting(next)) {
            return;
          }
          pick(next);
          // Decided at the click: a pick made off a call or over speech has no sample, now or once it is quiet.
          if (next === "off") {
            return;
          }
          const stale = sampleStaleReason({ now: live.current.now, sound: next });
          if (stale !== undefined) {
            const outcome = { at: "before-routing", kind: "stale" } as const;
            const { talking } = live.current;
            boundTrace({ live })(() => cueTraceLine({ cue: CUE_SAMPLE, outcome, source: "sample", stale, talking }));
            return;
          }
          playTraced({
            cue: CUE_SAMPLE,
            live,
            source: "sample",
            staleNow: () => sampleStaleReason({ now: live.current.now, sound: next }),
            tones: CUE_TONES[next][CUE_SAMPLE],
          });
        }}
      >
        <option value="off">off</option>
        {CUE_SOUNDS.map((sound) => (
          <option key={sound} value={sound}>
            {sound}
          </option>
        ))}
      </select>
    </label>
  );
}
