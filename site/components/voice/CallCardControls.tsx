/**
 * The call card's controls: each as a button, what a press does, and the icon it wears. Split from `CallCard.tsx`
 * to keep it under the line cap.
 */
import {
  ChevronDown,
  Info,
  ListTodo,
  type LucideIcon,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
} from "lucide-react";
import type { ReactElement } from "react";

import type { CallTray } from "../../lib/callTrays";
import type { MessengerControl, MessengerControlId } from "../../lib/messengerMode";
import { UNREAD_DOT } from "./orbParts";
import { AUDIO_CHEVRON, ICON_CONTROL, JOINED_MIC, RailIcon, RailTip } from "./StageRailParts";
import type { VoiceState } from "./voiceContext";

/**
 * The card's controls as buttons. The microphone and speaker chevron and mute after it are drawn as one pill, Google
 * Meet's; before a call has its mute the chevron stands alone. The running list's button wears the unread dot while its
 * tray is closed and the voice or the fleet left something unseen.
 *
 * @param side where each tooltip hangs: below, since the card's top rows have the card under them to stay inside
 * @returns the controls as buttons
 */
export function drawControls({
  controls,
  act,
  listDot,
  side,
}: {
  controls: readonly MessengerControl[];
  act: (input: { id: MessengerControlId }) => () => void;
  listDot: boolean;
  side: "top" | "bottom";
}): ReactElement[] {
  const drawn: ReactElement[] = [];
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index];
    if (control.id !== "audio") {
      const dot = control.id === "list" && listDot;
      drawn.push(
        <ControlButton key={control.id} control={control} act={act} face={faceOf({ control })} dot={dot} side={side} />,
      );
      continue;
    }
    const next = controls.at(index + 1);
    const joined = next?.id === "mute";
    drawn.push(
      <span key="audio" className="flex">
        <ControlButton control={control} act={act} face={AUDIO_CHEVRON} dot={false} side={side} />
        {joined ? <ControlButton control={next} act={act} face={JOINED_MIC} dot={false} side={side} /> : null}
      </span>,
    );
    if (joined) {
      index += 1;
    }
  }
  return drawn;
}

/** The class a lone control wears: hang-up is red. */
function faceOf({ control }: { control: MessengerControl }): string {
  if (control.id === "end") {
    return `${ICON_CONTROL} border-transparent bg-[oklch(0.72_0.17_25)] text-[oklch(0.16_0.03_25)] hover:bg-[oklch(0.72_0.17_25)] hover:text-[oklch(0.16_0.03_25)]`;
  }
  return ICON_CONTROL;
}

/** One control: its icon, its word as tooltip and name, what a press does, and the unread dot when it wears one. */
function ControlButton({
  control,
  act,
  face,
  dot,
  side,
}: {
  control: MessengerControl;
  act: (input: { id: MessengerControlId }) => () => void;
  face: string;
  dot: boolean;
  side: "top" | "bottom";
}): ReactElement {
  let word = control.word;
  if (dot) {
    word = `${control.word}, something new`;
  }
  return (
    <RailTip word={word} side={side}>
      <button
        type="button"
        className={`${face} relative`}
        aria-pressed={control.pressed}
        aria-label={word}
        disabled={control.disabled}
        onClick={act({ id: control.id })}
      >
        <RailIcon icon={iconOf({ control })} />
        {dot ? <span aria-hidden="true" data-unread="" className={UNREAD_DOT} /> : null}
      </button>
    </RailTip>
  );
}

/**
 * What pressing a control does.
 *
 * @returns what a press of the control does
 */
export function actOf({
  id,
  voice,
  onTray,
}: {
  id: MessengerControlId;
  voice: VoiceState;
  onTray: (pressed: CallTray) => void;
}): () => void {
  if (id === "talk") {
    return voice.start;
  }
  if (id === "mute") {
    return voice.toggleMute;
  }
  if (id === "screen") {
    if (voice.sharing === undefined) {
      return voice.shareScreen;
    }
    return voice.stopShare;
  }
  if (id === "end") {
    return voice.stop;
  }
  return () => {
    onTray(id);
  };
}

/**
 * The icon a control wears. Talk is a phone and hang-up a struck phone, not the stage's cross, because close wears a
 * cross beside it. Mute and screen wear the stage's own glyphs, state in the glyph. The microphone and speaker tray is Meet's
 * chevron, pointing at the tray it opens below it; the running list a checklist; session details an info mark.
 */
function iconOf({ control }: { control: MessengerControl }): LucideIcon {
  if (control.id === "talk") {
    return Phone;
  }
  if (control.id === "list") {
    return ListTodo;
  }
  if (control.id === "audio") {
    return ChevronDown;
  }
  if (control.id === "mute") {
    if (control.pressed === true) {
      return MicOff;
    }
    return Mic;
  }
  if (control.id === "screen") {
    if (control.pressed === true) {
      return ScreenShareOff;
    }
    return ScreenShare;
  }
  if (control.id === "end") {
    return PhoneOff;
  }
  return Info;
}
