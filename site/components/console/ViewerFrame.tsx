"use client";

/**
 * The viewer's frame (`app/(console)/view/page.tsx`), drawn in the browser only, never in the server's HTML.
 *
 * Every console route streams behind `app/(console)/loading.tsx`, so the server sends the viewer page in a hidden
 * segment that React's reveal moves into place up to 300ms after it arrives. A frame in that segment loads its
 * document there and loads it again when moved. And when anything above the page updates before the reveal, React
 * draws the page afresh while the segment still holds its own frame, so two identical frames stand at once until the
 * segment is removed. Drawn in the browser only, the segment carries a placeholder, and one frame loads its document
 * once.
 */
import { type ReactElement, useSyncExternalStore } from "react";

import { VIEWER_FRAME } from "../../lib/pageVersionReply";

/** The frame fills the page below the bar; its placeholder holds the same room. */
const FRAME_CLASS = "min-h-0 w-full flex-1 border-0 bg-background";

/** Whether this is the browser never changes once known, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

/** In the browser. */
function inBrowser(): boolean {
  return true;
}

/** On the server, and while the server's HTML hydrates. */
function onServer(): boolean {
  return false;
}

/**
 * The frame, once the page runs in the browser; until then an empty block of the same size.
 *
 * @param src the document's address, carrying the version the viewer read
 * @param sandbox the frame's sandbox tokens (`lib/inAppView.ts` `frameSandbox`)
 * @param title the frame's accessible name, the document's address
 * @returns the frame, or its placeholder
 */
export function ViewerFrame({ src, sandbox, title }: { src: string; sandbox: string; title: string }): ReactElement {
  const drawn = useSyncExternalStore(subscribeToNothing, inBrowser, onServer);
  if (!drawn) {
    return <div aria-hidden="true" className={FRAME_CLASS} />;
  }
  return (
    <iframe
      {...{ [VIEWER_FRAME]: "" }}
      className={FRAME_CLASS}
      referrerPolicy="no-referrer"
      sandbox={sandbox}
      src={src}
      title={title}
    />
  );
}
