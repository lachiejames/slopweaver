"use client";

import type { ReactElement } from "react";

import { publishedPageReference } from "../../lib/publishedPageVoice";
import { usePageReading, usePageTitle } from "./voiceContext";

/**
 * Names the page to the console voice. Rendered by `PageHead`, so every console page is named with no line
 * of its own, and `PageHead` itself stays a component the server can render. The viewer also passes the slug of a
 * published page it shows, so `read_page` reads that page's words rather than answering that it registers none
 * (`../../lib/publishedPageVoice.ts`).
 *
 * @param title the page's own title
 * @param publishedPageSlug the store page the viewer shows, absent on every other page
 * @returns nothing visible
 */
export function PageVoice({
  title,
  publishedPageSlug,
}: {
  title: string;
  publishedPageSlug?: string | undefined;
}): ReactElement | null {
  usePageTitle({ title });
  if (publishedPageSlug === undefined) {
    return null;
  }
  return <PublishedPageReading slug={publishedPageSlug} />;
}

/**
 * Registers a published page's reference as the page's reading — its own component, so the hook is never called
 * conditionally and a page with no slug registers no reading at all.
 *
 * @param slug the store page the viewer shows
 * @returns nothing visible
 */
function PublishedPageReading({ slug }: { slug: string }): null {
  usePageReading({ open: undefined, shows: publishedPageReference({ slug }) });
  return null;
}
