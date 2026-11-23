/**
 * The thumbnails of files waiting in Messenger are object URLs the page made, and each is let go once nothing shows
 * it: a removed file, a refused keep, a send that went (`MessengerComposer.tsx`), and whatever still waits when the
 * widget that owns the list goes. The composer itself unmounts on a minimise or a tray while the
 * files wait on, so the last of these belongs to the list's owner, `VoiceWidget.tsx`, never the composer.
 */
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import type { PendingMessengerAttachment } from "../../lib/messengerAttachment";

/**
 * Let thumbnails go. Revoking one twice is harmless, so a file removed while its keep was refused needs no
 * bookkeeping.
 *
 * @param urls the object URLs, `undefined` for a file with no thumbnail
 */
export function revokePreviews({ urls }: { urls: readonly (string | undefined)[] }): void {
  for (const url of urls) {
    if (url !== undefined) {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * The files waiting to go with the owner's next message, held by the widget so a minimise or a tray keeps them, with every
 * thumbnail still waiting let go when the widget unmounts, and never before.
 *
 * @returns the list and its setter, as `useState` gives them
 */
export function useWaitingAttachments(): [
  readonly PendingMessengerAttachment[],
  Dispatch<SetStateAction<readonly PendingMessengerAttachment[]>>,
] {
  const [attached, setAttached] = useState<readonly PendingMessengerAttachment[]>([]);
  const waiting = useRef(attached);
  useEffect(() => {
    waiting.current = attached;
  }, [attached]);
  useEffect(
    () => () => {
      revokePreviews({ urls: waiting.current.map((file) => file.previewUrl) });
    },
    [],
  );
  return [attached, setAttached];
}
