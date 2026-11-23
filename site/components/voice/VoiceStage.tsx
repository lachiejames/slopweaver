"use client";

/**
 * The voice's STAGE: the call fullscreen — the orb large on the left with what it is consulting under it
 * (`StageSide.tsx`), the conversation's history the full height of the right (`StageHistory.tsx`), what it is
 * doing and the way out along the top, and the call's controls along the bottom. Starting a voice conversation turns
 * the console into this fullscreen view with an expressive orb: a larger orb for a more one-on-one UX, that still
 * gets out of the way when the owner wants, and that must be easy. Narrow or portrait, the two columns stack; the bar
 * stays one row under both.
 *
 * **The call's controls are icons along a bottom bar** — the trays' buttons, the microphone and speaker chevron joined
 * to mute, the screen, then a big red hang-up set well apart — and the way out, the **corner**, stays alone top right
 * (four buttons crammed up in the top right were friction, with the bottom unused; `StageControls.tsx`,
 * `../../lib/stageRail.ts`). Each is named by its word on hover and to a screen
 * reader, and mute and the screen show their own state: icons read better than text here. The chevron is the
 * microphone and speaker tray's button, taking Meet's lead on which icon buttons to use and where to position them.
 * A `?stage=` preview draws a call's controls too, inert, so the bar can be photographed as a call shows it.
 *
 * **The corner's trays are the stage's**: the tray pops up on the larger chat too, and carries across keeping the
 * place the owner was reading. One tray state,
 * the widget's, so the tray open in the corner is open here and the reverse, at most one and none by default
 * (`callTrays.ts`). A tray takes the left half with the orb shrunk to a small indicator above it; Messenger, never a
 * tray, is always the box under the conversation on the right. The conversation opens where the owner was reading
 * (`readingPlace.ts`).
 *
 * **Getting out of the way is one gesture**, and none of them touches the call: Escape, a click on the orb, a turn of
 * the wheel or a swipe anywhere but the history, the **corner** button, or Alt+V — which also brings it back from
 * the corner (`VoiceWidget.tsx`). The page under it stays exactly where the owner left it, the Queue card they had
 * open included, so collapsing shows the card they were talking about. The stage is modal while it shows — Radix traps
 * focus and locks the page's scroll — because the console under it cannot be used until it is collapsed.
 *
 * **Every preference is chosen in Settings, and the stage only honours it**, with no settings of its own: a second
 * place for preferences clutters the call and may conflict with what is being said on
 * it (`lib/stageRail.ts`). The theme — the page's colour, the colours the orb is lit in and what the corner orb sits
 * on — the presence that fills the orb, the badge's sound and each stage behaviour are all picked in the console's
 * Settings modal (`components/voice/CallSettings.tsx`, `lib/themePresets.ts`, `lib/orbPresence.ts`), and a change
 * reaches the stage live, mid-call (`usePreference`). `?stage=<presence>` on the overlay's address draws it with no
 * call up, beside `?orb=<mood>`, so each presence can be photographed in each mood, and
 * `?said=speaking|mid-turn|settled|folded|linked` fills its history at that moment of the owner's turn (`saidPreviewOf`). A change of
 * state eases the orb's colour rather than jumping (`--v-ring` is a registered colour).
 *
 * **The voice looks at the owner's screen natively whenever they ask**, with no button, because macOS lets one app
 * share the screen at a time and the floating voice is the one the owner has open. Only under a desktop shell too old
 * to look itself is "look at my screen" a button, here and in the corner, opening Chromium's share picker; the
 * window's edge glows while it is shared
 * (`EdgeGlow.tsx`).
 */
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
  type TouchEvent,
  useRef,
  type WheelEvent,
} from "react";

import { type CallTray, trayWordOf } from "../../lib/callTrays";
import type { PendingMessengerAttachment } from "../../lib/messengerAttachment";
import type { OrbFace } from "../../lib/orbMood";
import type { PresenceId } from "../../lib/orbPresence";
import type { PlaceKeeper } from "../../lib/readingPlace";
import { stageControlsOf } from "../../lib/stageRail";
import type { VoiceStatus } from "../../lib/voiceActivity";
import {
  type OrbBacking,
  type OrbBackingOpacity,
  orbTuning,
  STAGE_SWIPE_PX,
  STAGE_WHEEL_DELTA,
  voiceSimOf,
} from "../../lib/voiceStage";
import { consultationShows } from "../../lib/voiceStageActivity";
import { SHOWN_SEGMENTS, shownConversationOf } from "../../lib/voiceTranscript";
import { TooltipProvider } from "../ui/tooltip";
import { CallTrayBody } from "./CallTrayBody";
import { MessengerComposer } from "./MessengerComposer";
import { StageControlBar } from "./StageControls";
import { NO_SHOWN_AT, StageHistory } from "./StageHistory";
import { StageSide } from "./StageSide";
import type { StageToggles } from "./useStageToggles";
import { StageHeader } from "./VoiceStageHeader";
import type { VoiceState } from "./voiceContext";

/**
 * The stage's own box: fullscreen, the header over two columns that stack when narrow or portrait, the bar under them. Its ground is a radial
 * gradient from a hint of the mood's colour at the orb, through the page's ground, to an edge pushed AWAY from the
 * ink — toward white in light, toward black in dark — so every ink reads at least as well at the edge as on the
 * ground. Darkened in light, the edge put muted text near 2.85:1; `contrastStage.test.ts` measures every ink on the path.
 * The ground runs over the menu bar and the Dock and the content is padded off both by the shell's inset
 * (`useOverlayExtent.ts`; unset, and so zero, under a shell that sends none).
 */
const STAGE =
  "group/stage fixed inset-0 z-60 grid grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden [--stage-edge:color-mix(in_oklch,var(--c-bg)_70%,white)] dark:[--stage-edge:color-mix(in_oklch,var(--c-bg)_70%,black)] bg-[radial-gradient(ellipse_at_28%_45%,color-mix(in_oklch,var(--c-bg)_86%,var(--v-ring))_0%,var(--c-bg)_55%,var(--stage-edge)_100%)] pt-[calc(clamp(0.9rem,2.5vh,1.8rem)_+_var(--sw-inset-top,0px))] pr-[calc(clamp(1rem,3vw,2.5rem)_+_var(--sw-inset-right,0px))] pb-[calc(clamp(0.9rem,2.5vh,1.8rem)_+_var(--sw-inset-bottom,0px))] pl-[calc(clamp(1rem,3vw,2.5rem)_+_var(--sw-inset-left,0px))] text-foreground outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none!";

/**
 * A tray in the stage's left half: the corner's glass panel, as tall as the column leaves it, scrolling inside itself.
 */
const TRAY =
  "grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[16px] border border-solid sw-glass sw-glass-panel text-[0.85rem]";

/**
 * The stage.
 *
 * @param voice the console voice's state — the same one the corner orb reads
 * @param face the mood and badge the orb wears, already resolved (a `?orb=` preview included)
 * @param level the level the orb swells by, 0 to 1 — the owner's voice while it listens, its own while it speaks
 * @param status the status the corner's pill shows, already resolved
 * @param presence what fills the orb
 * @param toggles the stage's switches, as Settings set them
 * @param preview the address that drew it with no call up, or `undefined` for a live call
 * @param draft what the owner has typed and not sent, kept by the widget across both views
 * @param onDraft sets it, or updates it against its newest value once a send lands
 * @param attached the files waiting to go with the owner's next message, kept by the widget across both views
 * @param onAttached sets them, or updates them against their newest value once a keep or a send answers
 * @param place where the owner was reading in the conversation, kept by the widget across both views
 * @param openTray the tray open, the corner's and the stage's alike, `undefined` with none
 * @param onTray a press on one tray's button: the widget opens it, swaps it in, or closes it (`nextTray`)
 * @param moodTheme the class that gives every mood its `--v-ring`, shared with the corner
 * @param backing what the corner orb sits on, seen here only as the orb flies
 * @param backingOpacity how strongly the owner has that backing drawn, a percentage
 * @param onCollapse moves to the corner — or, for a preview, closes it
 * @returns the stage, portalled over the console
 */
export function VoiceStage({
  voice,
  face,
  level,
  status,
  presence,
  toggles,
  preview,
  draft,
  onDraft,
  attached,
  onAttached,
  place,
  openTray,
  onTray,
  moodTheme,
  backing,
  backingOpacity,
  onCollapse,
}: {
  voice: VoiceState;
  face: OrbFace;
  level: number;
  status: VoiceStatus;
  presence: PresenceId;
  toggles: StageToggles;
  preview: string | undefined;
  draft: string;
  onDraft: Dispatch<SetStateAction<string>>;
  attached: readonly PendingMessengerAttachment[];
  onAttached: Dispatch<SetStateAction<readonly PendingMessengerAttachment[]>>;
  place: PlaceKeeper;
  openTray: CallTray | undefined;
  onTray: (pressed: CallTray) => void;
  moodTheme: string;
  backing: OrbBacking;
  backingOpacity: OrbBackingOpacity;
  onCollapse: () => void;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const gestures = useCollapseGestures({ onCollapse });
  const tuning: CSSProperties & ReturnType<typeof orbTuning> = {
    ...orbTuning({ calm: 1, level, mood: face.mood }),
    transition: "--v-ring 600ms ease",
  };
  // The owner's own sound, never the phase: the phase says "speaking" while they talk over the voice, and holds
  // "hearing" for a moment after their last transcribed fragment, which would bring the dots back under a turn just
  // settled. Words already arriving are their unfinished turn, which hides the dots anyway. False while muted, and
  // never the raw level, which a quiet room clears (`site/lib/ownerTalkingShown.ts`).
  const { history, hearing, previewed } = shownConversationOf({
    hearing: voice.ownerTalking,
    kept: SHOWN_SEGMENTS,
    preview,
    segments: voice.segments,
  });
  let consultation = voice.consultation;
  if (!toggles.activity.on || !consultationShows({ consultation, segments: voice.segments })) {
    consultation = undefined;
  }
  const controls = stageControlsOf({
    callActive: voice.callActive,
    hasLive: voice.live !== undefined,
    muted: voice.muted,
    preview: preview !== undefined,
    screenSight: voice.screenSight,
    sharing: voice.sharing,
  });
  // The tray in the left half, framed as the corner frames one; Messenger is always the box under the conversation.
  let leftTray: ReactElement | null = null;
  if (openTray !== undefined) {
    leftTray = (
      <section aria-label={trayWordOf({ tray: openTray })} data-tray={openTray} data-stage-scroll="" className={TRAY}>
        <TooltipProvider>
          <CallTrayBody tray={openTray} voice={voice} onTray={onTray} />
        </TooltipProvider>
      </section>
    );
  }
  const composer = (
    <div data-messenger="" className="rounded-[12px] border border-solid border-border bg-(--c-card)">
      <TooltipProvider>
        <MessengerComposer voice={voice} draft={draft} onDraft={onDraft} attached={attached} onAttached={onAttached} />
      </TooltipProvider>
    </div>
  );
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onCollapse();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={root}
          data-mood={face.mood}
          data-phase={status.phase}
          // A made-up voice's preview flourishes every time, so a recording can show the rare thing it does.
          data-sim={preview !== undefined && voiceSimOf({ search: preview }) ? "" : undefined}
          style={tuning}
          className={`${moodTheme} ${STAGE}`}
          onOpenAutoFocus={(event) => {
            // Focus the stage itself, never its first button: a Space meant for nothing must not mute the call.
            event.preventDefault();
            root.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (isTypingTarget({ event })) {
              event.preventDefault();
            }
          }}
          {...gestures}
        >
          <DialogPrimitive.Title className="sr-only">Voice</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            The call continues when you move this to the corner: press Escape, click the orb, or scroll.
          </DialogPrimitive.Description>
          <StageHeader
            voice={voice}
            status={status}
            preview={preview}
            corner={controls.corner}
            onCollapse={onCollapse}
          />
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-[clamp(1rem,3vw,2.5rem)] md:landscape:grid-cols-[minmax(18rem,0.9fr)_minmax(24rem,1.1fr)] md:landscape:grid-rows-1">
            <StageSide
              voice={voice}
              face={face}
              status={status}
              presence={presence}
              backing={backing}
              backingOpacity={backingOpacity}
              consultation={consultation}
              previews={toggles.previews.on}
              tray={leftTray}
              onCollapse={onCollapse}
            />
            <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-3">
              <StageHistory
                earlier={previewed ? [] : voice.earlier}
                hearing={hearing}
                history={history}
                liveMedium={voice.liveMedium}
                reading={!previewed && voice.earlierReading}
                unread={previewed ? undefined : voice.unread}
                place={place}
                shownAt={previewed ? NO_SHOWN_AT : voice.shownAt}
              />
              {composer}
            </div>
          </div>
          <TooltipProvider>
            <StageControlBar controls={controls.bar} voice={voice} openTray={openTray} onTray={onTray} />
          </TooltipProvider>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The wheel and swipe that collapse the stage, outside the history and the form controls that keep them. */
function useCollapseGestures({ onCollapse }: { onCollapse: () => void }): {
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
} {
  const swipeFrom = useRef<number | undefined>(undefined);
  return {
    onTouchMove: (event) => {
      if (event.touches.length !== 1) {
        swipeFrom.current = undefined;
        return;
      }
      const from = swipeFrom.current;
      if (from !== undefined && Math.abs(event.touches.item(0).clientY - from) >= STAGE_SWIPE_PX) {
        swipeFrom.current = undefined;
        onCollapse();
      }
    },
    // A swipe is one finger. A second touch cancels it rather than re-arming it, since the first finger may have
    // started on a field the gesture must leave alone.
    onTouchStart: (event) => {
      swipeFrom.current = undefined;
      if (event.touches.length === 1 && !keepsGesture({ event: event.nativeEvent })) {
        swipeFrom.current = event.touches.item(0).clientY;
      }
    },
    onWheel: (event) => {
      if (keepsGesture({ event: event.nativeEvent }) || Math.abs(event.deltaY) < STAGE_WHEEL_DELTA) {
        return;
      }
      onCollapse();
    },
  };
}

/**
 * Whether a wheel or swipe started somewhere that keeps it: the history, which scrolls itself, an open activity line,
 * or a form control, where a scroll or a slipping finger is never a request to leave the stage.
 */
function keepsGesture({ event }: { event: Event }): boolean {
  const target = originOf({ event });
  return (
    target instanceof Element &&
    target.closest("[data-stage-scroll], details[open], input, textarea, select, [contenteditable]") !== null
  );
}

/**
 * Where an event really began. `target` is retargeted to a shadow root's host as the event leaves it, so a field
 * inside one would read as its host; the composed path's first entry is the field itself.
 */
function originOf({ event }: { event: Event }): EventTarget | null {
  const first = event.composedPath().at(0);
  if (first === undefined) {
    return event.target;
  }
  return first;
}

/**
 * Whether a key press landed where the owner is typing — a text field, a select or editable content — so Escape there is
 * the field's, never the stage's.
 *
 * @returns true for a typing target
 */
export function isTypingTarget({ event }: { event: Event }): boolean {
  const target = originOf({ event });
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(target.type);
  }
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
