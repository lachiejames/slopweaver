"use client";

/**
 * The floating voice orb, over the owner's whole desktop in the desktop app's overlay (`DesktopVoiceOverlay.tsx`) and
 * nowhere else, in one of three states the owner picks and keeps (`site/lib/voiceWindow.ts`): the orb alone; the
 * middle, the call card over it — Messenger, the console's one place to type to the voice, with the running list, the
 * session details or the microphone and speaker opened over it (`CallCard.tsx`, `site/lib/callTrays.ts`); or full
 * screen, the stage.
 *
 * **One floating widget, the desktop app's.** Two floating widgets are not wanted, since there are never two calls at
 * the same time. So no console page mounts it, and a browser tab starts no call (`site/lib/voiceStart.ts`).
 *
 * The typed box the Talk page got was read-only during a call and hard to find, so the orb opens the archive's
 * intercom-style widget with a voice function instead: the orb the same size, the state and the page or card the
 * owner is on in the card's bar, the call's icon controls on it, and a call the owner is only watching shown in its
 * Messenger.
 *
 * The owner needs to tell whether the voice is doing something big and will respond, or is stuck, as the floating orb
 * of the ChatGPT mobile app shows, expanding on a click. So the orb answers that question:
 *
 * - **It is the stage's orb, calmer.** Collapsed, it is the same orb moving in similar ways with animations a little
 *   less pronounced, so the owner still feels the presence while looking at other things.
 *   So the corner draws the presence the stage wears (`StageOrb.tsx`) at {@link CORNER_CALM}: slower, moving
 *   less with the level, its glow while it speaks undimmed (`orbTuning`, `site/lib/voiceStage.ts`).
 * - **It sits on a soft disc** (small, the orb read as a squiggly line, so the backing is a soft background, not full
 *   opacity), half-strength card colour with a rim of the mood's, which flies with it and gathers in
 *   as it lands from the stage, so where the orb ends reads at a glance, mid-flight too (`OrbBackdrop`, `orbParts.tsx`).
 * - **Its colour is the state** (`site/lib/orbMood.ts`): the mood's hue — green while it speaks, violet while it
 *   reasons, amber when a turn has gone quiet, red on an error, slate and squashed out of shape while a dropped
 *   call reconnects. Nothing circles it while it works — a white line going round makes it feel more like
 *   a spinning wheel — so the work in flight is the badge on its shoulder — 👀, the Slack mark, 💭 —
 *   even while it talks over that work, and the card's bar in words. `?orb=<mood>` draws one face with no call up, so
 *   each can be tried and photographed.
 * - **It makes a sound for the badge**, audio feedback that says the same things without saying too much: a short,
 *   quiet earcon as the live orb starts looking, thinking,
 *   reading, relaying or stalls — once per badge, never over either voice, never for a preview
 *   (`site/lib/orbCue.ts`, `OrbCues.tsx`). "sounds" in the Settings modal picks one of a few, or off, live.
 * - **The card's bar says the state in words, with its age** — "reasoning · 18s", "checking" over
 *   "running action_items · 7s", "still waiting · 14s". A turn with no event of its own for 35 seconds says
 *   "no update"; a Codex turn compacting the thread's context, silent until it ends, says "compacting" and is given
 *   180 seconds (`COMPACTION_STALL_MS`); silence after the owner's last words with nothing from the voice says
 *   "still waiting".
 * - **A stall offers one press under it**, so a missing nudge button never hides a stall:
 *   "nudge it to answer" when the voice has gone quiet, and "stop Codex and ask it to answer" when the Codex
 *   turn it handed to has. Either has the voice answer the owner's last words; the second also stops that turn. Once per
 *   silence — it comes back only after the owner speaks again (`nudgeOfferOf`, `site/lib/voiceActivity.ts`). "Listening"
 *   carries the first too once the voice spoke last and asked the owner nothing: the next turn is its own (`voiceOwesTurn`).
 * - **A call never moves the window**: a call start never goes full screen, and the state is sticky
 *   across calls and restarts. The stage (`VoiceStage.tsx`) is the owner's to open: the card's **full screen** control,
 *   the tray menu, or Alt+V during a call; one gesture on it — Escape, a click on the big orb, a scroll — lands on the
 *   middle. The call never drops, because every state reads the same `useVoice()`.
 *
 * **The app opens in the middle** and keeps whatever state the owner leaves it in. A press on the orb
 * minimises the card or the stage to it, and from the orb alone brings back the middle; the card's close and Escape
 * minimise too, keeping what the owner typed and the tray they had open, so clicking the orb again brings back
 * whatever tray was there before. A click into another app folds it to the orb for now without
 * moving the owner's state (the shell's `fold`); a click into Slopweaver's own console window does nothing. Its mood
 * colour and badge still say what the voice is doing while it is minimised, and a dot on it says the voice or the
 * fleet put something on the running list the owner has not seen.
 *
 * **Hovering the orb reveals an X that takes the overlay off the owner's screen**, so the conversation keeps going
 * while the overlay is gone and the menu bar brings it back. The call runs on; the menu bar's Show voice brings it
 * back, and so does the next call (`desktop/src/shellState.ts`). Never on the stage, and never under a shell that
 * cannot hide its window.
 *
 * One note sits above it while a call is live: a navigation of this voice window's own page, held because reloading
 * the window that runs the call would end it (`site/lib/consoleHold.ts`). A console page's reload ends nothing.
 * A build held behind the call is the sidebar build chip's to name, never the voice's, so the voice UI carries no
 * note for it.
 */
import {
  type CSSProperties,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { type CallTray, nextTray } from "../../lib/callTrays";
import { heldNote } from "../../lib/consoleHold";
import { cutInSceneAt } from "../../lib/cutInScene";
import { overlayHideControlShown, overlayModeOf, overlayWantsWhole } from "../../lib/desktopShellOverlay";
import { edgeGlowOf, framePulseKey, framePulsesOn } from "../../lib/edgeGlow";
import { messengerOrbLabel } from "../../lib/messengerMode";
import { ORB_FLIGHT_MS } from "../../lib/orbFlight";
import { type OrbFace, orbFaceOf, orbPreviewOf, previewStatusOf } from "../../lib/orbMood";
import type { PresenceId } from "../../lib/orbPresence";
import type { PlaceKeeper, ReadingPlace } from "../../lib/readingPlace";
import {
  CORNER_CALM,
  DEFAULT_ORB_BACKING,
  DEFAULT_ORB_BACKING_OPACITY,
  isOrbBacking,
  isOrbBackingOpacity,
  ORB_BACKING_OPACITY_STORAGE_KEY,
  ORB_BACKING_STORAGE_KEY,
  type OrbBacking,
  type OrbBackingOpacity,
  orbTuning,
  simulatedVoiceLevel,
  stageKeyOf,
  stageOrbLevel,
  stagePreviewOf,
  voiceSimOf,
} from "../../lib/voiceStage";
import { messengerPreviewOf } from "../../lib/voiceTranscript";
import {
  DEFAULT_VOICE_WINDOW_STATE,
  isVoiceWindowState,
  VOICE_WINDOW_STORAGE_KEY,
  type VoiceWindowState,
  voiceViewOf,
  voiceWindowDrawing,
  voiceWindowOnOrb,
  voiceWindowShown,
} from "../../lib/voiceWindow";
import { usePreference } from "../console/preference";
import { usePresenceChoice } from "../console/presenceChoice";
import { useWaitingAttachments } from "./attachmentPreviews";
import { CallCard } from "./CallCard";
import { EdgeGlow } from "./EdgeGlow";
import { Badge, HideOverlay } from "./OrbControls";
import { useOrbCues } from "./OrbCues";
import { MeetingNote, TriageNote } from "./OrbNotes";
import { MOOD_RING, OrbBackdrop, UNREAD_DOT } from "./orbParts";
import { ScreenFocus } from "./ScreenFocus";
import { StageOrb } from "./StageOrb";
import { useMessengerPlace } from "./useMessengerPlace";
import { useCornerOrbFlight } from "./useOrbFlight";
import { useOverlayExtent } from "./useOverlayExtent";
import { useShellCommands } from "./useShellCommands";
import { useSimulatedVoice } from "./useSimulatedVoice";
import { useStageToggles } from "./useStageToggles";
import { isTypingTarget, VoiceStage } from "./VoiceStage";
import { useVoice } from "./voiceContext";
import type { VoiceShellControl } from "./voiceShellControl";

/**
 * The widget: fixed bottom right, resting on the desktop overlay's floor — level with a bottom Dock, else clear of an
 * app's own bottom bar (`useOverlayExtent.ts`). The shell restates this bottom margin and the orb's `size-14` as `ORB_CENTRE_LIFT`
 * (`desktop/src/overlayWindow.ts`), so change both together. Its ring colour is the mood's, set once here and read by the orb and the
 * call card; only its children take the pointer, so the space around them stays clickable. Closed, it is capped at
 * 24rem; open, the card sets its own width (`cardWidthCss`), which the page reports so the desktop corner is sized to
 * hold it (`useMessengerSize.ts`), and the overlay stays in its corner while it is open. An orb the owner dragged
 * elsewhere overrides the corner with an inline style at its place (`useMessengerPlace.ts`, `placedWidgetStyle`).
 * While the orb is being dragged, everything but the orb (`orb-handle`) is hidden and keeps its box, so the orb never
 * moves inside the widget and the card comes back as it was, on the side with room, once the drag lets go.
 */
const WIDGET = `group/voice pointer-events-none fixed right-[calc(1.25rem_+_var(--sw-inset-right,0px))] bottom-[calc(1.25rem_+_var(--sw-orb-floor,0px))] z-45 grid max-w-[min(24rem,calc(100vw_-_2.5rem_-_var(--sw-inset-left,0px)_-_var(--sw-inset-right,0px)))] data-messenger:max-w-[calc(100vw_-_2.5rem_-_var(--sw-inset-left,0px)_-_var(--sw-inset-right,0px))] justify-items-end gap-2 ${MOOD_RING} [&>*]:pointer-events-auto data-orb-dragging:[&>:not(.orb-handle)]:invisible`;

/**
 * The query string has no event of its own to subscribe to; the widget re-renders on every status tick and
 * navigation anyway, which is when a `?orb=` preview is read again.
 */
function subscribeToNothing(): () => void {
  return () => undefined;
}

/** The current query string, on the client. */
function searchNow(): string {
  return window.location.search;
}

/** No query string, while rendering on the server. */
function searchOnServer(): string {
  return "";
}

/** The one note beside the closed orb — a navigation held behind the call — on a frosted card. */
const NOTE =
  "m-0 max-w-[20rem] rounded-[12px] border border-solid sw-glass sw-glass-panel px-[0.8rem] py-[0.55rem] text-[0.82rem] leading-[1.45] text-foreground";

/** Marks a drawn piece of the widget as one the desktop overlay takes the pointer over (`desktop/src/preload.ts`). */
const OVERLAY_HIT = { "data-overlay-interactive": "" } as const;

/**
 * The floating orb.
 *
 * @param shell the desktop shell's control over the overlay that draws it (`DesktopVoiceOverlay.tsx`)
 * @returns the widget, or nothing outside the console
 */
export function VoiceWidget({ shell }: { shell?: VoiceShellControl } = {}): ReactElement | null {
  const voice = useVoice();
  // The state the owner left the window in, kept across calls and restarts; only the owner's own moves write it.
  const stored = usePreference({
    accept: isVoiceWindowState,
    fallback: DEFAULT_VOICE_WINDOW_STATE,
    key: VOICE_WINDOW_STORAGE_KEY,
  });
  // A click into another app, or the X on the orb, shows the orb alone until the owner's next move, without writing the state.
  const [folded, setFolded] = useState(false);
  // One tray at most, over Messenger in the card or the left half of the stage, none until the owner opens one
  // (`callTrays.ts`): hidden with the card and shown again when it comes back, never reset by a minimise.
  const [openTray, setOpenTray] = useState<CallTray | undefined>(undefined);
  // What the owner typed and has not sent outlives a minimise or a tray over Messenger, so neither loses a paste.
  const [draft, setDraft] = useState("");
  // And so do the files attached and not sent (`site/lib/messengerAttachment.ts`).
  const [attached, setAttached] = useWaitingAttachments();
  // Where the owner was reading, the same way: written by whichever history is drawn — the Messenger tray's, the stage's —
  // and read by the next to open, so going full screen or back keeps their place (`site/lib/readingPlace.ts`).
  const kept = useRef<ReadingPlace | undefined>(undefined);
  const place = useMemo(
    (): PlaceKeeper => ({
      keep: (next) => {
        kept.current = next;
      },
      read: () => kept.current,
    }),
    [],
  );
  const search = useSyncExternalStore(subscribeToNothing, searchNow, searchOnServer);
  const presence = usePresenceChoice();
  const backing = usePreference({ accept: isOrbBacking, fallback: DEFAULT_ORB_BACKING, key: ORB_BACKING_STORAGE_KEY });
  const backingOpacity = usePreference({
    accept: isOrbBackingOpacity,
    fallback: DEFAULT_ORB_BACKING_OPACITY,
    key: ORB_BACKING_OPACITY_STORAGE_KEY,
  });
  const toggles = useStageToggles();
  const [dismissedPreview, setDismissedPreview] = useState<string | undefined>(undefined);
  const callActive = voice?.callActive === true;
  // A region of the owner's screen lifted on their ask shows the orb alone while it is up, since the card or the stage
  // would cover it. Read straight off the voice rather than reported back by `ScreenFocus`, so the ask drops in the same
  // render the frame does.
  const focusLit = voice?.screenFocus.shown !== undefined;
  const shown = voiceWindowShown({ focusLit, folded, stored: stored.value });
  const cardOpen = shown === "middle";
  const view = voiceViewOf({ shown });
  // Every move of the owner's writes their state and lets a fold go. Held in a ref for the handlers subscribed once.
  const moveTo = useRef<(next: VoiceWindowState) => void>(() => undefined);
  const windowNow = useRef({ shown, stored: stored.value });
  useEffect(() => {
    moveTo.current = (next) => {
      setFolded(false);
      stored.set(next);
    };
    windowNow.current = { shown, stored: stored.value };
  });
  // Alt+V is the call's key alone: with no call up it is not listened for, so it leaves the settings panel and the
  // page exactly as they were. A layout effect, so the listener comes off in the same commit the call ends in, never a
  // frame later.
  useLayoutEffect(() => {
    if (!callActive) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      const key = stageKeyOf({
        altKey: event.altKey,
        code: event.code,
        modified: event.ctrlKey || event.metaKey || event.shiftKey,
        stageOpen: false,
        typing: isTypingTarget({ event }),
      });
      if (key !== "toggle") {
        return;
      }
      event.preventDefault();
      // Off the stage lands on the middle, as every move of the owner's off it does.
      let next: VoiceWindowState = "fullscreen";
      if (windowNow.current.shown === "fullscreen") {
        next = "middle";
      }
      moveTo.current(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [callActive]);
  useShellCommands({ callActive, fold: setFolded, moveTo, shell, start: voice?.start, stop: voice?.stop });
  // Escape minimises the card, from Messenger's box too — the one way out of the overlay's keyboard that never needs
  // the mouse — and keeps what the owner typed. Not mid-composition, where Escape is the input method's. The stage takes its
  // own Escape, to the middle.
  useEffect(() => {
    if (!cardOpen) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }
      moveTo.current("minimised");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [cardOpen]);
  // The stage shows for a live call the owner has not collapsed, or — with no call up — for a `?stage=` preview not
  // yet closed, so each presence can be photographed in each `?orb=` mood.
  let stagePreview: string | undefined;
  if (!callActive && stagePreviewOf({ search }) !== undefined && dismissedPreview !== search) {
    stagePreview = search;
  }
  // `?voice=sim` beside a preview plays a made-up voice into the orb's level, never into a live call's.
  const simulated = useSimulatedVoice({ on: !callActive && voiceSimOf({ search }) });
  const [edgeLit, setEdgeLit] = useState(false);
  const staged = view === "stage" || stagePreview !== undefined;
  // The corner's orb landing from the stage's box (`useOrbFlight.ts`) holds the overlay whole until it has, so the
  // desktop shell does not shrink the window under the flight.
  const [landing, setLanding] = useState(false);
  const { covers, measureWidget, reported, widget } = useOverlayExtent({
    link: shell?.extent,
    wholeArea: overlayWantsWhole({
      // Under a shell from before its edge strips the page draws the glow itself, over the whole display.
      edgeInOverlay: shell?.glow === undefined && [callActive, edgeLit].includes(true),
      focusShown: focusLit,
      landing,
      staged,
    }),
  });
  // Where the owner dragged the orb, under a shell that moves its window there (`useMessengerPlace.ts`).
  const {
    placed,
    dragging: orbDragging,
    edges,
    measureOrb,
    pressOrb: dragOrb,
    guardClick,
    reset: resetPlace,
  } = useMessengerPlace({
    enabled: !staged,
    link: shell?.place,
    widget,
  });
  // After the extent's effect, so the status that shows the window finds the shell already sized to the corner.
  useEffect(() => {
    if (reported) {
      shell?.onStatus({ callActive, mode: overlayModeOf({ view }) });
    }
  }, [shell, callActive, view, reported]);
  const { cardDrawn, stageDrawn, wholeReady } = voiceWindowDrawing({ covers, shown, staged });
  const [heldDrawn, setHeldDrawn] = useState(stageDrawn);
  if (heldDrawn !== stageDrawn) {
    setHeldDrawn(stageDrawn);
    setLanding(!stageDrawn);
  }
  useEffect(() => {
    if (!landing) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setLanding(false);
    }, ORB_FLIGHT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [landing]);
  // The LIVE face, before any preview replaces it: the cue hears only this one, so a `?orb=` preview is silent.
  let liveFace: OrbFace | undefined;
  if (voice !== undefined) {
    liveFace = orbFaceOf({
      busy: voice.inFlight.length > 0,
      focus: voice.inFlight.at(0)?.step,
      phase: voice.status.phase,
    });
  }
  useOrbCues({ badge: liveFace?.badge, voice });
  if (voice === undefined || liveFace === undefined) {
    return null;
  }
  // A preview draws only while no call is up, so a stray `?orb=` can never hide what a live call is doing.
  let preview: OrbFace | undefined;
  if (!voice.callActive) {
    preview = orbPreviewOf({ search });
  }
  let status = voice.status;
  let face = liveFace;
  if (preview !== undefined) {
    status = previewStatusOf({ face: preview });
    face = preview;
  }
  let level = stageOrbLevel({ levels: voice.levels, phase: status.phase });
  if (preview !== undefined && simulated !== undefined && preview.mood === "yielded") {
    // A cut-in, played through the real fold: the face and the words are what a call would show at each instant.
    const scene = cutInSceneAt({ timeS: simulated });
    status = scene.status;
    face = orbFaceOf({ busy: false, focus: undefined, phase: scene.status.phase });
    level = stageOrbLevel({
      levels: { mic: scene.levels.micLevel, output: scene.levels.outputLevel },
      phase: scene.status.phase,
    });
  } else if (preview !== undefined && simulated !== undefined) {
    level = simulatedVoiceLevel({ mood: face.mood, timeS: simulated });
  }
  // A press from the orb alone brings back the middle — or what a fold hid — with the tray last left open; from
  // the card or the stage it minimises. Opening takes the owner's keyboard, which the overlay's window does not hold while the
  // orb is alone, so Escape reaches it and Messenger's box can be typed in.
  const pressOrb = (): void => {
    const next = voiceWindowOnOrb({ shown, stored: stored.value });
    moveTo.current(next);
    if (next !== "minimised") {
      shell?.focus?.();
    }
  };
  const minimise = (): void => {
    moveTo.current("minimised");
  };
  const unread = voice.runningList.unread > 0 && !cardOpen;
  let orbLabel = messengerOrbLabel({
    callActive: voice.callActive,
    headline: status.headline,
    open: shown !== "minimised",
  });
  if (unread) {
    orbLabel = `${orbLabel}, something new on your running list`;
  }
  // The X on the orb takes the overlay off the owner's screen; the call runs on, and the menu bar's Show voice brings it back.
  const hide = shell?.hide;
  const hideShown = overlayHideControlShown({ canHide: hide !== undefined, staged });
  let stage: ReactElement | null = null;
  if (stageDrawn) {
    stage = (
      <VoiceStage
        voice={voice}
        face={face}
        level={level}
        status={status}
        presence={presence.value}
        toggles={toggles}
        preview={stagePreview}
        draft={draft}
        onDraft={setDraft}
        attached={attached}
        onAttached={setAttached}
        place={place}
        openTray={openTray}
        onTray={(pressed) => {
          setOpenTray((open) => nextTray({ open, pressed }));
        }}
        moodTheme={MOOD_RING}
        onCollapse={() => {
          if (stagePreview === undefined) {
            moveTo.current("middle");
          } else {
            setDismissedPreview(stagePreview);
          }
        }}
        backing={backing.value}
        backingOpacity={backingOpacity.value}
      />
    );
  }
  const sharing = voice.sharing !== undefined;
  const glow = edgeGlowOf({ callActive: voice.callActive, phase: status.phase, sharing });
  const edge = (
    <EdgeGlow
      state={glow}
      pulses={framePulsesOn({
        callActive: voice.callActive,
        sight: voice.screenSight,
        state: glow,
      })}
      pulse={framePulseKey({ frame: voice.frameTaken, segments: voice.segments })}
      level={stageOrbLevel({ levels: voice.levels, phase: "speaking" })}
      ready={wholeReady}
      onLit={setEdgeLit}
      link={shell?.glow}
    />
  );
  return (
    // `data-overlay-interactive` is what the desktop shell's overlay hit-tests, so it marks only what is DRAWN — the
    // stage, the call card as a whole (its padding included), the held note and the orb — never a layout box: the
    // rows below take the pointer (`[&>*]:pointer-events-auto`), and a gap between two of them is still their box. A `contents` wrapper draws no box of its own, so it marks a component without moving it in the grid.
    <aside
      ref={measureWidget}
      className={WIDGET}
      style={placed?.style}
      data-phase={status.phase}
      data-mood={face.mood}
      data-messenger={cardOpen ? "" : undefined}
      data-orb-dragging={orbDragging ? "" : undefined}
      aria-label="voice"
    >
      {stage === null ? null : (
        <div className="contents" {...OVERLAY_HIT}>
          {stage}
        </div>
      )}
      {edge}
      <ScreenFocus shown={voice.screenFocus.shown} ready={wholeReady} onDrop={voice.screenFocus.drop} />
      {/* The card keeps to the corner and never waits on the whole display (`voiceWindowDrawing`): the corner is
          measured off this `<aside>`, so the shell grows it to the card's height on the next report. */}
      {cardDrawn ? (
        <CallCard
          voice={voice}
          status={status}
          preview={messengerPreviewOf({ callActive, search })}
          draft={draft}
          onDraft={setDraft}
          attached={attached}
          onAttached={setAttached}
          place={place}
          openTray={openTray}
          onTray={(pressed) => {
            setOpenTray((open) => nextTray({ open, pressed }));
          }}
          onClose={minimise}
          onFullscreen={() => {
            moveTo.current("fullscreen");
          }}
          orbPlace={{ edges, panelRoom: placed?.panelRoom, reset: resetPlace }}
        />
      ) : null}
      {cardOpen || voice.held === undefined ? null : (
        <p className={NOTE} {...OVERLAY_HIT}>
          {heldNote({ href: voice.held, origin: window.location.origin })}{" "}
          <button type="button" className="cursor-pointer underline" onClick={voice.stop}>
            hang up and open it
          </button>
        </p>
      )}
      <MeetingNote meeting={voice.meeting} dismiss={voice.dismissMeeting} className={NOTE} />
      <TriageNote clock={voice.triageClock} press={voice.triagePress} className={NOTE} />
      {/* A real box, not `contents`, so the X can sit on the orb's shoulder and hovering either reveals it. A grid, so
          the orb stays a grid item exactly as before rather than an inline button on a line box, whose descent would
          lift it and widen the hit area. */}
      <div
        ref={measureOrb}
        className="orb-handle group/orb relative grid"
        // Beside an orb dragged into the screen's top half the card opens below it, so the orb comes first.
        style={placed?.side.vertical === "below" ? { order: -1 } : undefined}
        onClickCapture={guardClick}
        {...OVERLAY_HIT}
      >
        <Orb
          face={face}
          label={orbLabel}
          level={level}
          presence={presence.value}
          backing={backing.value}
          backingOpacity={backingOpacity.value}
          open={shown !== "minimised"}
          unread={unread}
          landing={landing}
          onPress={pressOrb}
          onPointerDown={dragOrb}
        />
        {!hideShown || hide === undefined ? null : (
          <HideOverlay
            onHide={() => {
              // A fold, never a move: the hidden overlay comes back on the orb, and the owner's state stays as they left it.
              setFolded(true);
              // What is drawn is said first, so main judges the hide on the corner it sees and never on a stage report
              // the status effect has not yet replaced; the one IPC pipe keeps the two in order.
              // That report is never stale: React runs a click on the props of the render on screen, and the render
              // that draws the stage removes this X in the same commit, before its effect reports the stage up.
              shell?.onStatus({ callActive, mode: overlayModeOf({ view }) });
              hide();
            }}
          />
        )}
      </div>
    </aside>
  );
}

/**
 * The orb: the presence the stage wears, at the corner's calm, in the mood's colour. The work in flight sits on it
 * as a badge; nothing circles it. Nothing is drawn over it either, with no call up: a microphone on a slate disc is
 * the old talk button, and over the owner's whole desktop the expected sight is the orb, not a floating microphone
 * button. The soft
 * disc under it carries no glyph and only half the card's colour, so it gives the orb an edge without becoming that
 * button again. Its accessible name says what a press does, and no tooltip hangs off it. As the stage closes it lands from the stage orb's place (`useOrbFlight.ts`),
 * its disc gathering in as it shrinks. The running list's dot sits at its top right while the card is not up.
 */
function Orb({
  face,
  label,
  level,
  presence,
  backing,
  backingOpacity,
  open,
  unread,
  landing,
  onPress,
  onPointerDown,
}: {
  face: OrbFace;
  label: string;
  level: number;
  presence: PresenceId;
  backing: OrbBacking;
  backingOpacity: OrbBackingOpacity;
  open: boolean;
  unread: boolean;
  landing: boolean;
  onPress: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}): ReactElement {
  const { mood, badge } = face;
  const tuning: CSSProperties & ReturnType<typeof orbTuning> = orbTuning({ calm: CORNER_CALM, level, mood });
  const box = useRef<HTMLButtonElement>(null);
  const moving = useRef<HTMLSpanElement>(null);
  useCornerOrbFlight({ box, landing, moving });
  return (
    <button
      ref={box}
      type="button"
      className="relative size-14 cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
      aria-label={label}
      aria-expanded={open}
      onClick={onPress}
      onPointerDown={onPointerDown}
    >
      <span
        ref={moving}
        aria-hidden="true"
        style={tuning}
        className="pointer-events-none absolute inset-0 group-data-[phase=off]/voice:opacity-80"
        // The corner sits on its dark disc, or over whatever app is under the overlay: the ground the themes were
        // picked on, whatever the page's own mode (`orbGroundOf`, `orbRamp.ts`).
        data-ground="dark"
      >
        <OrbBackdrop shown pressable={!landing} backing={backing} opacity={backingOpacity} />
        {/* At 56px the corner draws plain: no point grows to a disc, and each presence does about half its work. */}
        <StageOrb presence={presence} detail="plain" />
      </span>
      {badge === undefined ? null : <Badge key={badge} badge={badge} />}
      {unread ? <span aria-hidden="true" data-unread="" className={`${UNREAD_DOT} size-[0.8rem]`} /> : null}
    </button>
  );
}
