"use client";

/**
 * The orb's call card: the voice window's middle state, above the orb, bottom right. Two rows up top, each one fixed
 * height, then the conversation, then the box (every row a fixed height, so the owner reads two rows at the top, then the
 * transcript, then one row at the bottom):
 *
 * - **The header** (`CallCardHeader.tsx`): the voice's live state and what it is running, and every control — talk or
 *   hang up, the microphone and its chevron, the screen under a shell too old to look itself, the running list,
 *   session details, full screen during a call, and close.
 * - **The band** (`MessengerBand.tsx`): what the owner is looking at, and what the voice has actually read of it.
 * - **One slot**: the conversation (`Messenger.tsx`), or the tray open in its place — the running list, the newest ten
 *   things the owner, the voice and the fleet left each other (`RunningListTray.tsx`); session details, what the voice looked
 *   up and ran this call (`VoiceSession.tsx`); or the microphone and speaker (`AudioDeviceMenu.tsx`). One at most
 *   (there is only ever one tray open at once); a second press of a tray's button closes it.
 * - **The box to type in** (`MessengerComposer.tsx`), last, whatever the slot holds.
 *
 * The card keeps the size the owner left it at (`useMessengerSize.ts`: Small, Large, or dragged by an edge away from
 * the orb) and hangs off the orb: in the bottom right where the orb rests, or towards the middle
 * of the screen beside an orb the owner dragged elsewhere, kept to the room on that side so none of it is ever off
 * screen (`useMessengerPlace.ts`). The slot takes what the rows around it leave, so swapping a tray for the
 * conversation never moves an edge.
 *
 * Its root takes the desktop overlay's pointer as a whole, so a click on its padding never falls through to the app
 * beneath; the draft, the attachment and the reading place live in the widget, so a tray in the slot, or closing the
 * card, keeps a paste, a picked file and the owner's place.
 */
import type { Dispatch, ReactElement, SetStateAction } from "react";

import { type CallTray, cardHeightCss, cardWidthCss, trayWordOf } from "../../lib/callTrays";
import type { PendingMessengerAttachment } from "../../lib/messengerAttachment";
import type { MessengerResizeEdge, MessengerSize, MessengerSizePick } from "../../lib/messengerSize";
import type { PlaceKeeper } from "../../lib/readingPlace";
import type { VoiceStatus } from "../../lib/voiceActivity";
import { TooltipProvider } from "../ui/tooltip";
import { CallCardHeader } from "./CallCardHeader";
import { CallTrayBody } from "./CallTrayBody";
import { Messenger } from "./Messenger";
import { MessengerBand } from "./MessengerBand";
import { MessengerComposer } from "./MessengerComposer";
import { MessengerResizeHandles } from "./MessengerResize";
import { useFrontAppBand } from "./useFrontAppBand";
import { useMessengerSize } from "./useMessengerSize";
import type { VoiceState } from "./voiceContext";

/**
 * The card: beside the orb, at its size (`cardWidthCss`, `cardHeightCss`). A column of rows with the slot taking what is
 * left, every row kept to the card's width so a long title truncates rather than widening it; positioned, so the edges
 * it is resized by sit on it.
 */
const CARD =
  "relative flex flex-col overflow-hidden rounded-[16px] border border-solid sw-glass sw-glass-panel text-[0.8rem] shadow-[0_12px_32px_oklch(0_0_0/35%)]";

/** The slot the conversation or a tray fills: what the rows around it leave, each scrolling inside itself. */
const SLOT = "grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)]";

/**
 * A tray in the slot scrolls itself: on a short window the card's floor leaves the slot less height than the microphone
 * and speaker pickers need, and without this the speaker picker sits under the composer.
 */
const TRAY_SLOT = `${SLOT} overflow-y-auto overscroll-contain`;

/**
 * The call card.
 *
 * @param voice the console voice's state
 * @param status the state the orb shows, a preview's included
 * @param preview the address a `?said=` moment is read from (`messengerPreviewOf`), `undefined` with none
 * @param draft what the owner has typed and not sent, kept by the widget across a close
 * @param onDraft sets it, or updates it against its newest value once a send lands
 * @param attached the files waiting to go with the owner's next message, kept by the widget across a close
 * @param onAttached sets them, or updates them against their newest value once a keep or a send answers
 * @param place where the owner was reading in the conversation, kept by the widget across every view of it
 * @param openTray the tray open in the slot, `undefined` with none
 * @param onTray a press on one tray's button: the widget opens it, swaps it in, or closes it (`nextTray`)
 * @param onClose minimises the window to the orb, keeping the draft
 * @param onFullscreen opens the call on the stage
 * @param orbPlace the room beside an orb the owner dragged (`undefined` where it has always rested), the edges away
 *   from it, and the reset that puts it back
 * @returns the card
 */
export function CallCard({
  voice,
  status,
  preview,
  draft,
  onDraft,
  attached,
  onAttached,
  place,
  openTray,
  onTray,
  onClose,
  onFullscreen,
  orbPlace,
}: {
  voice: VoiceState;
  status: VoiceStatus;
  preview: string | undefined;
  draft: string;
  onDraft: Dispatch<SetStateAction<string>>;
  attached: readonly PendingMessengerAttachment[];
  onAttached: Dispatch<SetStateAction<readonly PendingMessengerAttachment[]>>;
  place: PlaceKeeper;
  openTray: CallTray | undefined;
  onTray: (pressed: CallTray) => void;
  onClose: () => void;
  onFullscreen: () => void;
  orbPlace: {
    readonly panelRoom: MessengerSize | undefined;
    readonly edges: readonly MessengerResizeEdge[];
    readonly reset: () => void;
  };
}): ReactElement {
  const { front, nowMs } = useFrontAppBand({ dropLook: voice.typed.dropLook });
  const { panelRoom, edges, reset } = orbPlace;
  const { begin, canDrag, choose, size } = useMessengerSize({ panelRoom });
  // Inline because it is computed from the size the owner left it at. Beside a dragged orb the size is already bounded
  // by the room on its side, and a cap read off a window cropped round the widget would shrink it for good.
  let sized = {
    height: cardHeightCss({ heightRem: size.heightRem }),
    width: cardWidthCss({ widthRem: size.widthRem }),
  };
  if (panelRoom !== undefined) {
    sized = { height: `${String(size.heightRem)}rem`, width: `${String(size.widthRem)}rem` };
  }
  const chooseSize = ({ pick }: { pick: MessengerSizePick }): void => {
    if (pick === "reset") {
      reset();
    }
    choose({ stored: pick === "large" ? "large" : "small" });
  };
  let slot = (
    <div className={SLOT} data-messenger="">
      <Messenger voice={voice} preview={preview} place={place} />
    </div>
  );
  if (openTray !== undefined) {
    slot = (
      <section aria-label={trayWordOf({ tray: openTray })} data-tray={openTray} className={TRAY_SLOT}>
        <CallTrayBody tray={openTray} voice={voice} onTray={onTray} />
      </section>
    );
  }
  return (
    <TooltipProvider>
      <section aria-label="the voice" data-overlay-interactive="" className={CARD} style={sized}>
        <MessengerResizeHandles canDrag={canDrag} edges={edges} begin={begin} />
        <CallCardHeader
          voice={voice}
          status={status}
          openTray={openTray}
          onTray={onTray}
          onClose={onClose}
          onFullscreen={onFullscreen}
          chooseSize={chooseSize}
        />
        <MessengerBand voice={voice} front={front} nowMs={nowMs} />
        {slot}
        <MessengerComposer voice={voice} draft={draft} onDraft={onDraft} attached={attached} onAttached={onAttached} />
      </section>
    </TooltipProvider>
  );
}
