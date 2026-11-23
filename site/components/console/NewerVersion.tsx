"use client";

/**
 * The viewer bar's "Newer version" button: when the page open in this tab was republished after the tab loaded it,
 * a button appears beside "Reveal in Finder", and pressing it loads the newer version. It never reloads by itself —
 * the owner may be partway through reading, and a page swapped under them is worse than one a press away.
 *
 * The viewer learns the version it loaded on the server (`app/(console)/view/page.tsx`), then takes the version its
 * frame's document reports it was served at (`lib/pageVersionReport.ts`), and asks the page-version
 * route (`app/api/page-version/[slug]/route.ts`) on mount, every {@link CHECK_EVERY_MS} while the tab is visible, and
 * once the moment it is shown again. An answer that is not a version — the store stopped, the page gone, a failed
 * fetch — never offers one nobody published, and never takes back one already learned.
 *
 * **Quiet on a call, caught up at hang-up.** Each ask starts a CLI child, and the console's polls are held for a
 * call because they were measured slowing its screen relays (`lib/liveQuiet.ts`). So a page republished mid-call
 * draws its button when the call ends; a button already drawn stays.
 */
import { RefreshCw } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import {
  frameReportFrom,
  newerVersionWaiting,
  PAGE_VERSION_ASK,
  type PageVersionReply,
  pageVersionReplyOf,
  VIEWER_FRAME,
} from "../../lib/pageVersionReply";
import { Button } from "../ui/button";
import { useVoice } from "../voice/voiceContext";

/** How often a visible viewer asks whether its page was republished: one store read each time. */
export const CHECK_EVERY_MS = 30_000;

/**
 * Ask the route once.
 *
 * @param url the page's page-version route, built from its slug
 * @returns the store's current version, or none on any failure
 */
async function latestVersion({ url }: { url: string }): Promise<PageVersionReply> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { kind: "none" };
    }
    return pageVersionReplyOf({ value: await response.json() });
  } catch {
    return { kind: "none" };
  }
}

/**
 * The button, once a newer version of the page is waiting; nothing before.
 *
 * @param slug the page the viewer is showing (`lib/inAppView.ts` `viewedPageSlug`)
 * @param shown the version the viewer loaded, `undefined` when the store could not say at load
 * @returns the button, or nothing
 */
export function NewerVersion({ slug, shown }: { slug: string; shown: string | undefined }): ReactElement | null {
  const [latest, setLatest] = useState<PageVersionReply>({ kind: "none" });
  // The version on screen: the server's read until the frame's document reports the answer it was served from.
  const [framed, setFramed] = useState(shown);
  const onCall = useVoice()?.callActiveAnywhere === true;
  useEffect(() => {
    // The frame is drawn in the browser only, often after this effect runs (`ViewerFrame.tsx`), so it is found
    // when a report arrives rather than once here.
    const onMessage: (event: MessageEvent) => void = (event) => {
      const frame = document.querySelector<HTMLIFrameElement>(`iframe[${VIEWER_FRAME}]`);
      if (frame === null) {
        return;
      }
      const report = frameReportFrom({
        frameWindow: frame.contentWindow,
        slug,
        source: event.source,
        value: event.data,
      });
      if (report.kind === "version") {
        setFramed(report.version);
      }
    };
    window.addEventListener("message", onMessage);
    // A document that reported before this listener existed reports again; one still loading reports on its own.
    document
      .querySelector<HTMLIFrameElement>(`iframe[${VIEWER_FRAME}]`)
      ?.contentWindow?.postMessage({ kind: PAGE_VERSION_ASK }, "*");
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [slug]);
  useEffect(() => {
    // No baseline to compare, or a call up: no asks. Mounting again at hang-up IS the catch-up read.
    if (framed === undefined || onCall) {
      return undefined;
    }
    let live = true;
    let asking = false;
    // Built in the effect's own body, so both dependency rules read `slug` as what re-runs it.
    const url = `/api/page-version/${encodeURIComponent(slug)}`;
    const check = async (): Promise<void> => {
      if (asking || document.visibilityState !== "visible") {
        return;
      }
      asking = true;
      try {
        const answer = await latestVersion({ url });
        // A failed read keeps the last version learned: a newer one seen stays newer than what this tab loaded.
        if (live && answer.kind === "version") {
          setLatest(answer);
        }
      } finally {
        asking = false;
      }
    };
    const tick = (): void => {
      void check();
    };
    tick();
    const timer = setInterval(tick, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [framed, onCall, slug]);
  if (!newerVersionWaiting({ latest, shown: framed })) {
    return null;
  }
  const onClick = (): void => {
    window.location.reload();
  };
  return (
    <Button
      className="shrink-0"
      onClick={onClick}
      size="sm"
      title="This page was republished after you opened it. Press to load the newer version."
      type="button"
    >
      <RefreshCw aria-hidden="true" />
      Load newer version
    </Button>
  );
}
