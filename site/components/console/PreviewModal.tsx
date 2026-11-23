"use client";

/*
 * A picture or a briefing, shown the way Slack shows one: a modal over the page the reader is on, the page darkened behind it,
 * never a navigation away. The words, and which clicks open it, are `../../lib/previewModal.ts`'s.
 *
 * Portalled to the document body, because a Queue card's glass (`backdrop-filter`) is a containing block for a fixed
 * descendant and would otherwise clip the modal to the card, and drawn one layer above every other overlay (`z-[60]`),
 * since a citation's hover card sits at the dialog's own `z-50`. Escape, the scrim and the close control each close
 * it, and focus returns to the link that opened it — or, when a caller's links sit inside a hover card that closes as
 * the modal opens, to the element that caller names. The link is never a `Dialog.Trigger`: a modified click has to stay the link's own.
 */

import { ExternalLink, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type MouseEvent, type ReactElement, type ReactNode, type RefObject, useRef, useState } from "react";

import { opensInPlace, type Preview, pagePreviewOf } from "../../lib/previewModal";

/** The modal's header: what it shows, a new tab for it, and the close control. */
function PreviewHeader({ preview }: { preview: Preview }): ReactElement {
  return (
    <header className="flex items-center gap-3 border-x-0 border-t-0 border-b border-solid border-border px-4 py-2">
      <DialogPrimitive.Title className="m-0 min-w-0 flex-1 truncate text-[0.9rem] font-semibold">
        {preview.title}
      </DialogPrimitive.Title>
      <a
        className="inline-flex shrink-0 items-center gap-1.5 text-[0.78rem] text-muted-foreground no-underline hover:text-foreground"
        href={preview.src}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink aria-hidden="true" className="size-3" />
        Open in a new tab
      </a>
      <DialogPrimitive.Close
        aria-label="close the preview"
        className="inline-flex shrink-0 cursor-pointer items-center rounded-[6px] border border-solid border-border bg-muted p-1 text-foreground"
      >
        <XIcon aria-hidden="true" className="size-4" />
      </DialogPrimitive.Close>
    </header>
  );
}

/**
 * The modal itself, open while `preview` names something to show.
 *
 * @param preview the picture or page to show, or `undefined` while closed
 * @param onClose called when Escape, the scrim or the close control closes it
 * @param restoreFocus puts focus back where the reader was, in place of Radix's own return to a trigger it never had
 * @returns the modal
 */
export function PreviewModal({
  preview,
  onClose,
  restoreFocus,
}: {
  preview: Preview | undefined;
  onClose: () => void;
  restoreFocus: () => void;
}): ReactElement {
  let body: ReactElement | null = null;
  if (preview?.kind === "image") {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- served locally from the draft store; nothing to optimise */}
        <img
          alt={preview.title}
          className="block max-h-[calc(80vh-4rem)] max-w-full object-contain"
          src={preview.src}
        />
      </div>
    );
  } else if (preview?.kind === "page") {
    body = (
      <iframe
        className="min-h-0 w-full flex-1 border-0 bg-background"
        referrerPolicy="no-referrer"
        sandbox={preview.sandbox}
        src={preview.src}
        title={preview.title}
      />
    );
  }
  // A page fills 80% of the window; a picture sizes to itself within the same bound, never past it.
  const size =
    preview?.kind === "page" ? "h-[80vh] w-[80vw]" : "max-h-[80vh] w-fit max-w-[80vw] min-w-[min(24rem,80vw)]";
  return (
    <DialogPrimitive.Root
      open={preview !== undefined}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        {/* Over the desktop window's drag strips too: a click on the scrim closes, never drags the window. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/70 [-webkit-app-region:no-drag]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-preview={preview?.kind}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
          className={`fixed top-1/2 left-1/2 z-[60] flex ${size} -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-solid border-border bg-background text-foreground shadow-2xl outline-none [-webkit-app-region:no-drag]`}
        >
          {preview !== undefined && <PreviewHeader preview={preview} />}
          {body}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * One link that previews in place: the modal it opens, and the click handler a link takes to open it. A plain click
 * on a link with a preview opens the modal; any other click — modified, or on a link with none — is the link's own.
 *
 * Render the modal OUTSIDE anything that unmounts when it opens — a hover card's content — so closing that does not
 * take the modal with it.
 *
 * @param onOpen called as the modal opens, so a hover card the link sat in can close under it
 * @param returnFocus where focus goes on closing, in place of the opening link, for a caller whose links may not
 *   outlive the modal
 * @returns the modal to render once, and the handler to give each link
 */
export function usePreviewModal({
  onOpen,
  returnFocus,
}: {
  onOpen?: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
} = {}): {
  readonly modal: ReactElement;
  readonly clickFor: (link: { preview: Preview | undefined }) => (event: MouseEvent<HTMLAnchorElement>) => void;
} {
  const [shown, setShown] = useState<Preview>();
  const opener = useRef<HTMLElement | null>(null);
  const modal = (
    <PreviewModal
      onClose={() => {
        setShown(undefined);
      }}
      preview={shown}
      restoreFocus={() => {
        // A caller naming where focus returns wins outright: a link inside a closing hover card is still connected
        // while it animates out, and focusing it would lose focus to the body a moment later.
        if (returnFocus !== undefined) {
          returnFocus.current?.focus();
          return;
        }
        if (opener.current?.isConnected === true) {
          opener.current.focus();
        }
      }}
    />
  );
  const clickFor =
    ({ preview }: { preview: Preview | undefined }) =>
    (event: MouseEvent<HTMLAnchorElement>): void => {
      if (preview === undefined || event.defaultPrevented || !opensInPlace(event)) {
        return;
      }
      event.preventDefault();
      opener.current = event.currentTarget;
      onOpen?.();
      setShown(preview);
    };
  return { clickFor, modal };
}

/**
 * A link that opens in a new tab, unless it is a briefing the console serves, which a plain click previews in place.
 * For a caller with no hook of its own — a message line, drawn in a server component as readily as a client one.
 *
 * @param href the link's address, as the card draws it
 * @param title the words the modal's header reads as
 * @param tooltip the link's hover text
 * @returns the link, and its modal beside it
 */
export function PreviewLink({
  href,
  title,
  tooltip,
  className,
  children,
}: {
  href: string;
  title: string;
  tooltip: string;
  className: string;
  children: ReactNode;
}): ReactElement {
  const { clickFor, modal } = usePreviewModal();
  return (
    <>
      <a
        className={className}
        href={href}
        onClick={clickFor({ preview: pagePreviewOf({ href, title }) })}
        rel="noreferrer"
        target="_blank"
        title={tooltip}
      >
        {children}
      </a>
      {modal}
    </>
  );
}
