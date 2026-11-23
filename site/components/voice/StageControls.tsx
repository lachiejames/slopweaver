"use client";

/**
 * The stage's controls as drawn: the call's trays and controls along a bar at the bottom and the way out alone in the
 * top right corner. Which show, their words and where each sits is `../../lib/stageRail.ts`; the trays are
 * `../../lib/callTrays.ts`.
 *
 * **The bar leads with the trays' buttons, in the corner card's order** — the running list, session details,
 * then Meet's chevron joined to mute, which is the microphone and speaker tray's button — so a tray's button sits in
 * the same order in both views (the trays carry onto
 * the full-screen view). Each opens its tray, swaps another out, or closes its own (`nextTray`), and works in a
 * preview too, since a tray only changes what is drawn.
 *
 * **Mute and hang-up are told apart by colour, glyph and distance.** A big red end call button sits on the bottom with
 * mute to the left of it, the two in different colours so they are very distinct and with some distance between them,
 * because people confuse them; the icons are Meet's, which are very recognizable — the phone
 * put down for hang-up, not an X. So hang-up is a wide red pill wearing `PhoneOff`; mute is a neutral round
 * button whose muted state fills with the page's own ink and wears the struck-through microphone, so a muted button
 * never looks the same as an unmuted one; and a wide gap that grows with the window sits between them. The bar never
 * wraps, so hang-up can never land beside another control on a narrow window.
 *
 * Every bottom control is larger than the corner card's, and its tooltip opens upward. The bar is not a gesture dead
 * zone: a wheel or swipe over it still moves the stage to the corner, as anywhere outside the history.
 */
import {
  ChevronUp,
  Info,
  ListTodo,
  type LucideIcon,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
} from "lucide-react";
import type { ReactElement } from "react";

import { type CallTray, type CallTrayButton, trayButtonsOf } from "../../lib/callTrays";
import { HANG_UP_FILL, type StageControl, type StageRailControl } from "../../lib/stageRail";
import { ICON_CONTROL, RailIcon, RailTip } from "./StageRailParts";
import type { VoiceState } from "./voiceContext";

/** A bottom control's face, without its shape: the card's border and fill, a panel fill on hover unless pressed. */
const BAR_FACE =
  "inline-flex h-11 shrink-0 cursor-pointer items-center justify-center border border-solid border-border bg-card p-0 text-foreground transition-[background-color,border-color,color] duration-160 not-aria-pressed:hover:bg-(--c-panel) focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary";

/** The microphone and speaker chevron as the narrow left half of mute's pill, Meet's; alone, a round control. */
const BAR_CHEVRON = `${BAR_FACE} w-7 rounded-l-[999px] border-r-0 [&:last-child]:w-11 [&:last-child]:rounded-r-[999px] [&:last-child]:border-r aria-pressed:border-(--v-ring) aria-pressed:bg-[color-mix(in_oklch,var(--v-ring)_16%,var(--c-card))]`;

/** Mute as the right half of the chevron's pill; muted, it fills with the page's ink so it reads at a glance. */
const BAR_MIC = `${BAR_FACE} w-11 rounded-r-[999px] aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background`;

/** The screen control and a tray's button: round, ringed in the mood's colour while on. */
const BAR_SCREEN = `${BAR_FACE} w-11 rounded-[999px] aria-pressed:border-(--v-ring) aria-pressed:bg-[color-mix(in_oklch,var(--v-ring)_16%,var(--c-card))]`;

/**
 * Hang-up: a wide red pill, taller than the rest, its red `HANG_UP_FILL` set on the element. Hover rings it rather
 * than brightening it, since a colour filter would move the measured red.
 */
const BAR_END =
  "inline-flex h-12 w-18 shrink-0 cursor-pointer items-center justify-center rounded-[999px] border-0 p-0 text-white transition-shadow duration-160 hover:ring-4 hover:ring-[color-mix(in_oklch,currentColor_28%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary";

/**
 * The top right corner's one control: the way out, which moves the call to the corner or closes a preview.
 *
 * @param control the corner's control, from `stageControlsOf`
 * @param onCollapse moves to the corner — or, for a preview, closes it
 * @returns the control with its tooltip
 */
export function StageCornerControl({
  control,
  onCollapse,
}: {
  control: StageRailControl;
  onCollapse: () => void;
}): ReactElement {
  return (
    <RailTip word={control.word}>
      <button type="button" className={ICON_CONTROL} aria-label={control.word} onClick={onCollapse}>
        <RailIcon icon={Minimize2} />
      </button>
    </RailTip>
  );
}

/**
 * The bar along the bottom of the stage: the trays' buttons, the chevron joined to mute and the screen on the left, a
 * wide gap, then hang-up.
 *
 * @param controls the bar's call controls, from `stageControlsOf`
 * @param voice the console voice's state, which each control acts on
 * @param openTray the tray open, `undefined` with none
 * @param onTray a press on one tray's button
 * @returns the bar
 */
export function StageControlBar({
  controls,
  voice,
  openTray,
  onTray,
}: {
  controls: readonly StageControl[];
  voice: VoiceState;
  openTray: CallTray | undefined;
  onTray: (pressed: CallTray) => void;
}): ReactElement {
  const trays = trayButtonsOf({ open: openTray });
  const press =
    ({ tray }: { tray: CallTray }): (() => void) =>
    () => {
      onTray(tray);
    };
  const audioTray = trays.find((button) => button.tray === "audio")!;
  const audio = controls.find((control) => control.id === "audio");
  const mute = controls.find((control) => control.id === "mute");
  const screen = controls.find((control) => control.id === "screen");
  const end = controls.find((control) => control.id === "end");
  return (
    <div
      role="toolbar"
      aria-label="call controls"
      className="flex items-center justify-center gap-[clamp(1.5rem,8vw,6rem)]"
    >
      <div className="flex items-center gap-3">
        {trays
          .filter((button) => button.tray !== "audio")
          .map((button) => (
            <TrayButton key={button.tray} button={button} face={BAR_SCREEN} onPress={press({ tray: button.tray })} />
          ))}
        <span className="flex">
          {audio === undefined ? null : (
            <TrayButton button={audioTray} face={BAR_CHEVRON} onPress={press({ tray: "audio" })} />
          )}
          {mute === undefined ? null : (
            <BarButton
              control={mute}
              face={BAR_MIC}
              icon={mute.pressed === true ? MicOff : Mic}
              onPress={voice.toggleMute}
            />
          )}
        </span>
        {screen === undefined ? null : (
          <BarButton
            control={screen}
            face={BAR_SCREEN}
            icon={screen.pressed === true ? ScreenShareOff : ScreenShare}
            onPress={voice.sharing === undefined ? voice.shareScreen : voice.stopShare}
          />
        )}
      </div>
      {end === undefined ? null : (
        <BarButton control={end} face={BAR_END} icon={PhoneOff} onPress={voice.stop} fill={HANG_UP_FILL} />
      )}
    </div>
  );
}

/** One bottom control: its face, its glyph, its word on hover and to a screen reader, and no action while inert. */
function BarButton({
  control,
  face,
  icon: Icon,
  onPress,
  fill,
}: {
  control: StageControl;
  face: string;
  icon: LucideIcon;
  onPress: () => void;
  fill?: string;
}): ReactElement {
  return (
    <RailTip word={control.word} side="top">
      <button
        type="button"
        className={face}
        style={fill === undefined ? undefined : { backgroundColor: fill }}
        aria-pressed={control.pressed}
        aria-label={control.word}
        onClick={control.inert ? undefined : onPress}
      >
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </button>
    </RailTip>
  );
}

/**
 * One tray's button: its icon, pressed while its tray is open, its word as tooltip and name. The microphone and
 * speaker tray's is Meet's chevron; it is device choice, never a settings cog.
 */
function TrayButton({
  button,
  face,
  onPress,
}: {
  button: CallTrayButton;
  face: string;
  onPress: () => void;
}): ReactElement {
  const Icon = TRAY_ICONS[button.tray];
  return (
    <RailTip word={button.word} side="top">
      <button type="button" className={face} aria-pressed={button.pressed} aria-label={button.word} onClick={onPress}>
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </button>
    </RailTip>
  );
}

/** Each tray's icon: the corner card's, and Meet's chevron, pointing up at the bar, for the microphone and speaker. */
const TRAY_ICONS: Readonly<Record<CallTray, LucideIcon>> = {
  audio: ChevronUp,
  details: Info,
  list: ListTodo,
};
