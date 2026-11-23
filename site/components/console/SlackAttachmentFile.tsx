/** One attached file Slack shows no picture of: its card, or a text-like file's words read from the stored blob. */
import { type ReactElement, useEffect, useState } from "react";

import {
  collapsedLabel,
  type DraftMediaText,
  draftMediaTextOf,
  type FilePreview,
  fileSizeLabel,
  fileTypeLabel,
  pdfShortfallOf,
  textHead,
  type Unshown,
  unshownWordsOf,
} from "../../lib/draftMediaText";
import { attachmentPagePreview } from "../../lib/previewModal";
import { drawnAs } from "../../lib/slackDraftLayout";
import type { DraftMedia } from "../live/draftMedia";
import { usePreviewModal } from "./PreviewModal";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";

/** The rounded, hairline-bordered frame Slack draws round an inline picture or a preview. */
export const FRAME = "rounded-[8px] border border-border";

/**
 * The card Slack draws for a file it shows no preview of: the name, then its type and size.
 *
 * @returns the file card
 */
export function FileCard({ media, undrawn }: { media: DraftMedia; undrawn: boolean }): ReactElement {
  return (
    <p className={`${FRAME} m-0 grid w-[min(100%,310px)] px-3 py-2`} title={`sha256 ${media.sha256}`}>
      <b className="truncate text-[0.9rem]">{media.name}</b>
      <FileFacts media={media} />
      {undrawn && (
        <span className="text-[0.78rem] text-warning">
          this browser could not draw these bytes as a {drawnAs({ name: media.name })}
        </span>
      )}
    </p>
  );
}

/** A file's type and size, the line under its name on a file card. */
function FileFacts({ media }: { media: DraftMedia }): ReactElement {
  return (
    <span className="text-[0.78rem] text-muted-foreground">
      {fileTypeLabel({ name: media.name })} · {fileSizeLabel({ bytes: media.bytes })}
    </span>
  );
}

/** One blob's words, as the text route answers them — or why there are none to show. */
type TextRead =
  { readonly phase: "read"; readonly read: DraftMediaText } | { readonly phase: "unread"; readonly why: string };

/** One blob's words through `/api/draft-media/<sha256>/text`, settled either way — a thrown fetch is `unread`. */
const fetchText: (sha256: string) => Promise<TextRead> = async (sha256) => {
  try {
    const response = await fetch(`/api/draft-media/${sha256}/text`, { cache: "no-store" });
    if (!response.ok) {
      return { phase: "unread", why: "these bytes are not text this console can read" };
    }
    const read = draftMediaTextOf({ payload: await response.json() });
    if (read === undefined) {
      return { phase: "unread", why: "the console answered in a shape this card does not read" };
    }
    return { phase: "read", read };
  } catch (cause: unknown) {
    return { phase: "unread", why: cause instanceof Error ? cause.message : String(cause) };
  }
};

/**
 * One attached document's words, read once per blob.
 *
 * @returns the read, or `undefined` while it is in flight
 */
function useText({ sha256 }: { sha256: string }): TextRead | undefined {
  const [settled, setSettled] = useState<{ sha256: string; read: TextRead }>();
  useEffect(() => {
    let live = true;
    const settle = async (): Promise<void> => {
      const read = await fetchText(sha256);
      if (live) {
        setSettled({ read, sha256 });
      }
    };
    void settle();
    return () => {
      live = false;
    };
  }, [sha256]);
  if (settled?.sha256 === sha256) {
    return settled.read;
  }
  return undefined;
}

/**
 * The chip on an attached HTML document that opens it as the page it is, in the viewer — a modal over the card
 * (`../../lib/previewModal.ts`), so the Queue under it is never left. A modified click opens the page in a new tab.
 *
 * @returns the chip, or nothing for any other file
 */
function OpenInViewer({ media }: { media: DraftMedia }): ReactElement | null {
  const { clickFor, modal } = usePreviewModal();
  const preview = attachmentPagePreview({ name: media.name, sha256: media.sha256 });
  if (preview === undefined) {
    return null;
  }
  return (
    <>
      <a
        className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[0.78rem] text-foreground no-underline hover:bg-muted/40"
        href={preview.src}
        onClick={clickFor({ preview })}
        rel="noreferrer"
        target="_blank"
        title={`open ${media.name} as a page in the viewer`}
      >
        Open in the viewer
      </a>
      {modal}
    </>
  );
}

/**
 * A text-like attachment the way Slack shows an uploaded text file: the file card, then its opening lines as source,
 * then all of it one click away. Collapsed, it says how many lines it is NOT showing; a PDF the extractor stopped
 * short on says how many pages it read. Markdown is shown raw and HTML as source — a text node, never a page.
 *
 * @returns the attachment
 */
export function TextFile({ media, expected }: { media: DraftMedia; expected: FilePreview }): ReactElement {
  const read = useText({ sha256: media.sha256 });
  const [expanded, setExpanded] = useState(false);
  // A read still in flight is a spinner and one that failed a staleness mark; `unshown` is the sentence for a read
  // that answered but has no words to show — never a blank box, which would read as an empty file.
  let unshown: Unshown | undefined;
  if (read?.phase === "read") {
    unshown = unshownWordsOf({ expected, read: read.read });
  }
  let body: ReactElement;
  if (read === undefined) {
    body = <ReadingIndicator label="Reading the attached text" block />;
  } else if (read.phase === "unread") {
    body = <StaleMark facts={[{ subject: "this file's text", why: read.why }]} block />;
  } else if (unshown !== undefined) {
    body = (
      <p className={`m-0 px-3 py-2 text-[0.8rem] ${unshown.warn ? "text-warning" : "text-muted-foreground"}`}>
        {unshown.text}
      </p>
    );
  } else {
    const head = textHead({ text: read.read.text });
    const short = pdfShortfallOf({ read: read.read });
    body = (
      <>
        <pre className="m-0 max-w-full overflow-x-auto border-t border-border px-3 py-2 font-mono text-[0.78rem] leading-snug break-words whitespace-pre-wrap">
          {expanded ? head.body : head.head}
        </pre>
        {(!head.whole || short !== undefined) && (
          <p className="m-0 flex flex-wrap items-center gap-x-3 border-t border-border px-3 py-1.5 text-[0.78rem] text-muted-foreground">
            {!head.whole && (
              <>
                <span>{expanded ? `all ${String(head.totalLines)} lines` : collapsedLabel({ head })}</span>
                <button
                  className="cursor-pointer text-foreground underline underline-offset-2"
                  onClick={() => {
                    setExpanded(!expanded);
                  }}
                  type="button"
                >
                  {expanded ? "Collapse" : `Show all ${String(head.totalLines)} lines`}
                </button>
              </>
            )}
            {short !== undefined && <span className="text-warning">{short}</span>}
          </p>
        )}
      </>
    );
  }
  return (
    <div
      className={`${FRAME} col-span-full grid w-full max-w-[600px] overflow-hidden`}
      title={`sha256 ${media.sha256}`}
    >
      <p className="m-0 flex items-start justify-between gap-3 px-3 py-2">
        <span className="grid min-w-0">
          <b className="truncate text-[0.9rem]">{media.name}</b>
          <FileFacts media={media} />
        </span>
        <OpenInViewer media={media} />
      </p>
      {body}
    </div>
  );
}
