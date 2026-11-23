"use client";

/**
 * The viewer bar's "Reveal in Finder" on a local page: Finder opens with the page's file selected, ready to drag into
 * Slack. A path alone is not enough to attach a briefing the owner has open; a one-press open-in-Finder button is.
 *
 * Only the desktop app's console window draws it, and only under a shell that carries the reveal: a browser cannot
 * reach Finder, and the page sends its slug alone, which the shell turns into the file (`desktop/src/pageReveal.ts`).
 * A refusal is said beside the button rather than swallowed.
 */
import { FolderOpen } from "lucide-react";
import { type ReactElement, useState } from "react";

import { revealReplyOf } from "../../lib/revealReply";
import { desktopBridge, useDesktopRole } from "../voice/useDesktopShell";

/** What the line beside the button says when the shell's answer is not one it could read. */
const UNREADABLE = "The desktop app gave an answer this page cannot read, so Finder may not have opened.";

/** What it says when the ask never reached an answer at all. */
const UNREACHED = "The desktop app did not answer, so Finder did not open.";

/**
 * The button, in the desktop app's console window; nothing anywhere else.
 *
 * @param slug the page the viewer is showing (`lib/inAppView.ts` `viewedPageSlug`)
 * @returns the button and its status line, or nothing
 */
export function RevealInFinder({ slug }: { slug: string }): ReactElement | null {
  const role = useDesktopRole();
  const [pending, setPending] = useState(false);
  const [why, setWhy] = useState<string | undefined>(undefined);
  const reveal = role === "main" ? desktopBridge()?.revealPageInFinder : undefined;
  if (reveal === undefined) {
    return null;
  }
  const run = async (): Promise<void> => {
    setPending(true);
    setWhy(undefined);
    try {
      const reply = revealReplyOf({ value: await reveal({ slug }) });
      if (reply.kind === "refused") {
        setWhy(reply.why);
      } else if (reply.kind === "unreadable") {
        setWhy(UNREADABLE);
      }
    } catch {
      setWhy(UNREACHED);
    } finally {
      setPending(false);
    }
  };
  const onClick = (): void => {
    void run();
  };
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <span aria-live="polite" className="max-w-[24rem] truncate text-[0.78rem] text-muted-foreground" title={why}>
        {why}
      </span>
      <button
        className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-solid border-border bg-transparent px-2.5 py-1 text-[0.82rem] font-[600] text-foreground disabled:cursor-default disabled:opacity-60"
        disabled={pending}
        onClick={onClick}
        type="button"
      >
        <FolderOpen aria-hidden="true" className="size-4" />
        Reveal in Finder
      </button>
    </span>
  );
}
