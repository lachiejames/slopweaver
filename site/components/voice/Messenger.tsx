"use client";

/**
 * The call card's Messenger: the console's one place to type to the voice, and the call's own conversation when the owner
 * would rather watch than go full screen. It is an intercom widget with voice function in the bottom right, as findable
 * as ChatGPT's input: you can type into it, you can switch to voice mode.
 * It is the card's resting content in the bottom right (`CallCard.tsx`), with no button of its own; a tray opened from
 * the bar sits over it. On the full-screen stage the history is already its conversation, so only
 * its composer is drawn, under it (`VoiceStage.tsx`). The policy is `site/lib/messengerMode.ts`.
 *
 * - **The conversation**: the stage's own history (`StageHistory.tsx`) — every earlier call and typed conversation
 *   the owner had with the voice, then the one going on now — pinned to the newest turn. Nothing sits over it.
 * - **The composer**: `MessengerComposer.tsx`, drawn by the card under this and under any tray in its place, so a tray
 *   never takes the box away. Never read-only, one line tall at rest, level with its icon button, growing as the owner types, the
 *   send icon greyed while there is nothing to send. With a call up its button, and Enter, send into that call
 *   (`typedInClient.ts`): the voice takes it as the owner's turn, a pasted Slack thread link read through `slack_open`. Enter sends, Shift+Enter is a new line, and neither ever ends a call.
 * - **An attachment**: the paperclip picks one picture or text file, kept under the owner's home the moment they pick it
 *   (`attachClient.ts`, `slopweaver talk attach`), and their next message names it in one line the thinking model reads it
 *   by with `file_read` (`site/lib/messengerAttachment.ts`), so files can be uploaded to the voice. A file
 *   too large, or not one the voice reads, is refused with the reason, never cut down. A picture pasted into the box,
 *   or a file dropped on it, goes the same way, so a screenshot can be pasted into the voice; a
 *   paste that carries text stays text.
 *
 * The draft, the attachment and the reading place live in the widget, so a tray opened over it or a closed card keeps
 * a paste and a picked file, and the conversation reopens — here or on the stage — where the owner was reading
 * (`site/lib/readingPlace.ts`).
 */
import type { ReactElement } from "react";

import type { PlaceKeeper } from "../../lib/readingPlace";
import { SHOWN_SEGMENTS, shownConversationOf } from "../../lib/voiceTranscript";
import { NO_SHOWN_AT, StageHistory } from "./StageHistory";
import type { VoiceState } from "./voiceContext";

/**
 * Messenger's conversation.
 *
 * @param voice the console voice's state
 * @param preview the address a `?said=` moment is read from (`messengerPreviewOf`), `undefined` with none
 * @param place where the owner was reading in the conversation, kept by the widget across every view of it
 * @returns the conversation
 */
export function Messenger({
  voice,
  preview,
  place,
}: {
  voice: VoiceState;
  preview: string | undefined;
  place: PlaceKeeper;
}): ReactElement {
  // The stage's own derivation, so the history here is the stage's turn for turn, a `?said=` preview included.
  const shown = shownConversationOf({
    hearing: voice.ownerTalking,
    kept: SHOWN_SEGMENTS,
    preview,
    segments: voice.segments,
  });
  return (
    <section
      aria-label="conversation with the voice"
      className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] px-[0.8rem]"
    >
      {/* The stage's own transcript with the stage's own inputs, so the two are one conversation shown twice (one transcript, two
          places, nothing truncated). */}
      <StageHistory
        earlier={shown.previewed ? [] : voice.earlier}
        hearing={shown.hearing}
        history={shown.history}
        liveMedium={voice.liveMedium}
        reading={!shown.previewed && voice.earlierReading}
        unread={shown.previewed ? undefined : voice.unread}
        place={place}
        shownAt={shown.previewed ? NO_SHOWN_AT : voice.shownAt}
      />
    </section>
  );
}
