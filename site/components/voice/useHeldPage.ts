"use client";

/**
 * The page as the voice sees it, held by the provider (`./VoiceProvider.tsx`, split out to keep that file under the size
 * ratchet): what the page head and body registered for the path on screen, or in the desktop shell's voice window the
 * console window's page carried across — and, in the console window, every change handed to the shell for the voice's
 * window, its open card and its `read_page` reading with it where the shell carries them.
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { carriedPageView, openTitleForWire, pageReadingForShell } from "../../lib/desktopPageReading";
import {
  type HeldReading,
  heldPageView,
  heldReading,
  openKeyOf,
  PAGE_READ_MAX_BYTES,
  type PageView,
  publishedPath,
} from "../../lib/pageVoice";
import type { DesktopVoiceSeam } from "./desktopVoiceSeam";
import type { PageRegistration } from "./voiceContext";

/**
 * The provider's held page.
 *
 * @param pathname the router's path this render
 * @param desktop the provider's place in the desktop shell this render, held here before the page re-derives
 * @returns the page's title and open card for the provider's state, the body's held reading, the view, the open card
 *   read now, and the registration a page head and body register through
 */
export function useHeldPage({ pathname, desktop }: { pathname: string; desktop: DesktopVoiceSeam | undefined }): {
  readonly pageTitle: string;
  readonly openCard: string | undefined;
  readonly bandPlace: { readonly path: string; readonly openTitle: string | undefined };
  readonly reading: RefObject<HeldReading | undefined>;
  readonly view: () => PageView;
  readonly openKeyNow: () => string | undefined;
  readonly registration: PageRegistration;
} {
  const seam = useRef(desktop);
  const [pageTitle, setPageTitle] = useState("");
  const [openCard, setOpenCard] = useState<string | undefined>(undefined);
  const [bandPath, setBandPath] = useState(pathname);
  const [bandOpenTitle, setBandOpenTitle] = useState<string | undefined>(undefined);
  const head = useRef<{ path: string; title: string } | undefined>(undefined);
  const reading = useRef<HeldReading | undefined>(undefined);
  const path = useRef(pathname);

  /** The page as the voice sees it now, assembled from what the head and the body registered for THIS path. */
  const view = useCallback((): PageView => {
    // In the desktop shell's voice window the page and its open card are the console window's, carried across; its
    // body is not.
    const carried = seam.current?.pageIdentity;
    if (carried !== undefined) {
      return carriedPageView({ identity: carried });
    }
    return heldPageView({ head: head.current, here: path.current, reading: reading.current });
  }, []);
  /** The card the owner has open now, which a relay's line carries (docs/console/card-landing.md). */
  const openKeyNow = useCallback((): string | undefined => openKeyOf({ open: view().open }), [view]);

  /** Re-derive the page title the voice believes the owner is on. */
  const touch = useCallback((): void => {
    const now = view();
    setPageTitle(now.title);
    setOpenCard(openKeyOf({ open: now.open }));
    // The query rides along, so a card the voice opens keeps the context and tags the owner is looking at (`open_card`),
    // marked for the card the page holds (`publishedPath`).
    const published = publishedPath({ at: window.location, held: reading.current, here: now.path });
    // The card the owner has open goes too: the voice's window lands the owner's words on it (docs/console/card-landing.md). So does
    // what `read_page` answers here, where the shell carries it: the voice's window draws no page body of its own.
    const open = openKeyOf({ open: now.open });
    // A card's title belongs to that card, so one with no key to name it is not carried.
    const openTitle =
      open === undefined || now.openTitle === undefined ? undefined : openTitleForWire({ title: now.openTitle });
    setBandPath(now.path);
    setBandOpenTitle(openTitle);
    const card = { ...(open === undefined ? {} : { open }), ...(openTitle === undefined ? {} : { openTitle }) };
    const identity = { ...card, path: published, title: now.title };
    if (seam.current?.carriesPageReading !== true) {
      seam.current?.publishPage?.(identity);
      return;
    }
    seam.current.publishPage?.({
      ...identity,
      reading: pageReadingForShell({ maxBytes: PAGE_READ_MAX_BYTES, view: now }),
    });
  }, [view]);

  useEffect(() => {
    path.current = pathname;
    // oxlint-disable-next-line react/set-state-in-effect -- the router is the external system: a new path re-derives the page title
    touch();
  }, [pathname, touch]);

  useEffect(() => {
    seam.current = desktop;
    // oxlint-disable-next-line react/set-state-in-effect -- the shell is the external system: a page carried across re-derives the title
    touch();
  }, [desktop, touch]);

  const registration = useMemo<PageRegistration>(
    () => ({
      clear: (part) => {
        if (part === "title") {
          head.current = undefined;
        } else {
          reading.current = undefined;
        }
        touch();
      },
      register: (part) => {
        if ("title" in part) {
          head.current = { path: path.current, title: part.title };
        } else {
          reading.current = heldReading({ at: window.location, held: reading.current, part, path: path.current });
        }
        touch();
      },
    }),
    [touch],
  );
  const bandPlace = useMemo(() => ({ openTitle: bandOpenTitle, path: bandPath }), [bandOpenTitle, bandPath]);
  return { bandPlace, openCard, openKeyNow, pageTitle, reading, registration, view };
}
