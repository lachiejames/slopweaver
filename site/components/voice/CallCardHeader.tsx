"use client";

/**
 * The call card's header, its first row: the voice's live state in two lines (`CallCardStatus.tsx`), then every
 * control on one line — talk or hang up, the microphone and mute, the screen where the shell cannot look itself, the
 * running list, session details, the size menu (`MessengerResize.tsx`, full screen one of its rows), and close. One
 * fixed height whatever the state says, so
 * nothing under it moves, and it has enough room for all its controls. No avatar: the presence in the corner already
 * shows the voice's state, richer (there is only ever one presence), and the room it took is the status line's.
 */
import { X } from "lucide-react";
import type { ReactElement } from "react";

import type { CallTray } from "../../lib/callTrays";
import { type MessengerControlId, messengerHeaderControls } from "../../lib/messengerMode";
import type { MessengerSizePick } from "../../lib/messengerSize";
import type { VoiceStatus } from "../../lib/voiceActivity";
import { actOf, drawControls } from "./CallCardControls";
import { CallCardStatus } from "./CallCardStatus";
import { MessengerSizeMenu } from "./MessengerResize";
import type { VoiceState } from "./voiceContext";

/**
 * The header.
 *
 * @param voice the console voice's state
 * @param status the state the orb shows, a preview's included
 * @param openTray the tray open in the card, `undefined` with none
 * @param onTray a press on one tray's button
 * @param onClose minimises the window to the orb, keeping the draft
 * @param onFullscreen opens the call on the stage
 * @param chooseSize keeps a size from the size menu, or resets the size and the orb's place
 * @returns the header
 */
export function CallCardHeader({
  voice,
  status,
  openTray,
  onTray,
  onClose,
  onFullscreen,
  chooseSize,
}: {
  voice: VoiceState;
  status: VoiceStatus;
  openTray: CallTray | undefined;
  onTray: (pressed: CallTray) => void;
  onClose: () => void;
  onFullscreen: () => void;
  chooseSize: (input: { pick: MessengerSizePick }) => void;
}): ReactElement {
  const controls = messengerHeaderControls({
    callActive: voice.callActive,
    callActiveAnywhere: voice.callActiveAnywhere,
    hasLive: voice.live !== undefined,
    muted: voice.muted,
    openTray,
    screenSight: voice.screenSight,
    sharing: voice.sharing,
  });
  const act = ({ id }: { id: MessengerControlId }): (() => void) => actOf({ id, onTray, voice });
  const listDot = openTray !== "list" && voice.runningList.unread > 0;
  return (
    <div
      data-card-row="header"
      className="flex h-[3.4rem] shrink-0 items-center gap-[0.5rem] pr-[0.45rem] pl-[0.85rem]"
    >
      <CallCardStatus voice={voice} status={status} />
      <div className="flex shrink-0 items-center gap-[0.25rem]">
        {drawControls({ act, controls, listDot, side: "bottom" })}
        <MessengerSizeMenu choose={chooseSize} onFullscreen={onFullscreen} canFullscreen={voice.callActive} />
        <button
          type="button"
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted-foreground hover:bg-(--c-panel) hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="close the voice"
          title="close (Escape does too; what you typed stays)"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
