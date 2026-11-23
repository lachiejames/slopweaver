import type { ReactElement } from "react";

import { Queue } from "../../../components/console/Queue";

export const metadata = { title: "Queue" };

/**
 * The queue: everything waiting on the owner's word, from four registers, each row opening a platform-native panel. Every open
 * draws it — no first open is sent anywhere else, so nobody is forced through a sequence to reach the right place —
 * and an empty Queue with no plan connected offers Settings → Models (`QueueEmpty.tsx`).
 *
 * It opens on its cards, never a header, so its one heading is for a screen reader and for the two walks that
 * read "drawn" as a heading on screen (`src/consoleProfile/plan.ts`'s `PAGE_LANDED`, and `desktop e2e`). A Queue card
 * never cites a board row, whatever wrote the address onto it: every chip draws a board row as
 * its words (`referenceHref`, `site/lib/citationDisplay.ts`).
 *
 * @returns the page
 */
export default function QueuePage(): ReactElement {
  return (
    <>
      <h1 className="sr-only">Queue</h1>
      <Queue />
    </>
  );
}
