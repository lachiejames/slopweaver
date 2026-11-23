import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { NewerVersion } from "../../../components/console/NewerVersion";
import { RevealInFinder } from "../../../components/console/RevealInFinder";
import { ViewerFrame } from "../../../components/console/ViewerFrame";
import { PageVoice } from "../../../components/voice/PageVoice";
import { frameSandbox, viewBack, viewedDocument, viewedPageSlug } from "../../../lib/inAppView";
import { storedPageBody, storedPagePresentation } from "../../../lib/pageStore";
import { pageVersionOf } from "../../../lib/pageVersion";
import { publishedPageTitle } from "../../../lib/publishedPageTitle";

export const metadata = { title: "Page" };

/**
 * One bare document — a local page, a file the console serves, a docs page — shown inside the console's own frame,
 * under a bar whose first control returns to the card the owner came from (`lib/inAppView.ts` carries the reason). The
 * desktop shell sends every such link here rather than loading the document in place of the page the owner was on.
 *
 * In the desktop app's window, which has no title strip, the bar's blank gaps move the window the way a title bar
 * would, as every console page's bar does (`.sw-window-drag`).
 *
 * @param searchParams `src`, the document; `back`, the page to return to
 * @returns the page
 */
export default async function ViewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<ReactElement> {
  const { src, back } = await searchParams;
  const shown = viewedDocument({ src: typeof src === "string" ? src : undefined });
  const way = viewBack({ back: typeof back === "string" ? back : undefined });
  const slug = viewedPageSlug({ shown });
  let title = "Page";
  let version: string | undefined;
  let frameSrc = shown;
  if (slug !== undefined) {
    // One fresh read names both the title and the version this tab shows, and the frame asks for that version by
    // name, so a republish landing before its request is offered by the Newer version button, never framed unseen.
    const read = await storedPagePresentation({ fresh: true, slug });
    const loaded = pageVersionOf({ read });
    if (loaded.kind === "version" && shown !== undefined) {
      version = loaded.version;
      frameSrc = `${shown}?${new URLSearchParams({ v: loaded.version }).toString()}`;
    }
    const published = await publishedPageTitle({ fetchBody: storedPageBody, read });
    if (published !== undefined) {
      title = published;
    }
  }
  return (
    <div className="flex h-screen flex-col">
      <header className="sw-window-drag flex items-center gap-x-[0.8rem] border-x-0 border-t-0 border-b border-solid border-border sw-glass-plane sw-glass-ground px-8 py-[0.9rem] max-[760px]:px-4">
        <PageVoice publishedPageSlug={slug} title={title} />
        <Link
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.9rem] font-[650] no-underline"
          href={way.href}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {way.words}
        </Link>
        <span className="min-w-0 flex-1 truncate text-[0.78rem] text-muted-foreground">{shown}</span>
        {slug === undefined ? null : <RevealInFinder slug={slug} />}
        {slug === undefined ? null : <NewerVersion shown={version} slug={slug} />}
      </header>
      {shown === undefined || frameSrc === undefined ? (
        <p className="m-0 px-8 py-4 text-[0.82rem] text-muted-foreground">
          This address names no page the console serves, so there is nothing to show here.
        </p>
      ) : (
        <ViewerFrame sandbox={frameSandbox({ shown })} src={frameSrc} title={shown} />
      )}
    </div>
  );
}
