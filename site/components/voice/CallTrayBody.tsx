"use client";

/**
 * What one call tray holds, wherever it is drawn: above the bar in the corner's call card (`CallCard.tsx`) or in the
 * stage's left half (`VoiceStage.tsx`). One component, so a tray carried across from the corner to full screen is the
 * same tray, its box and its padding included (a tray carries across and keeps the place the owner was reading). Messenger is never a tray: it is the card's
 * resting content and the stage's box under its conversation (`site/lib/callTrays.ts`). The frame around it is the
 * caller's.
 */
import type { ReactElement } from "react";

import type { CallTray } from "../../lib/callTrays";
import { AudioDeviceMenu } from "./AudioDeviceMenu";
import { RunningListTray } from "./RunningListTray";
import { VoiceSession } from "./VoiceSession";
import type { VoiceState } from "./voiceContext";

/**
 * One tray's contents.
 *
 * @param tray which tray
 * @param voice the console voice's state
 * @param onTray a press on one tray's button, which the session details' devices link makes for the audio tray
 * @returns the tray's contents, filling the frame it is given
 */
export function CallTrayBody({
  tray,
  voice,
  onTray,
}: {
  tray: CallTray;
  voice: VoiceState;
  onTray: (pressed: CallTray) => void;
}): ReactElement {
  if (tray === "list") {
    return <RunningListTray list={voice.runningList} />;
  }
  if (tray === "details") {
    return (
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] px-[0.8rem]">
        <VoiceSession
          voice={voice}
          onDevices={() => {
            onTray("audio");
          }}
        />
      </div>
    );
  }
  return (
    <div className="min-w-0 self-start px-[0.8rem] py-[0.7rem]">
      <AudioDeviceMenu audio={voice.audio} />
    </div>
  );
}
