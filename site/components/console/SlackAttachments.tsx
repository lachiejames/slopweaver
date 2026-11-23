"use client";

/*
 * What Slack draws UNDER a parked as-me message: its files as the pictures they are, and the previews Slack adds
 * under its links — laid out by the rules `../../lib/slackDraftLayout.ts` measured off Slack's own render.
 *
 * The owner reacts to everything the final message shows people, so the images and the citations are drawn on the
 * queue card's Slack draft. A picture is drawn from the bytes the draft stored (`/api/draft-media/<sha256>`, the
 * exact bytes the owner's approval binds), never a file icon with a byte size. A picture or video the browser
 * cannot draw is shown as the file card, marked, so a gap is never read as "nothing attached" and a broken element
 * is never drawn.
 *
 * A reader cannot react to a file whose text they cannot see. A text-like file (`../../lib/draftMediaText.ts`,
 * `filePreviewOf`) is shown as its card with its words under it, read from the same stored blob
 * (`/api/draft-media/<sha256>/text`), collapsed to its opening lines with the rest one click away. Any other file
 * keeps the card, with its type and size.
 *
 * An HTML attachment is opened in front of the reader, inside the app: its card carries an "Open in the viewer" chip
 * that frames the same stored bytes as a sandboxed page (`/api/draft-media/<sha256>/page`).
 *
 * The viewer and a picture's full size are a modal over the card, never a page of their
 * own (`./PreviewModal.tsx`, `../../lib/previewModal.ts`), so the Queue under them is never reloaded.
 */

import { type ReactElement, useState } from "react";

import { canonicalCitedAddress, citedRecordOf } from "../../lib/citedRecord";
import { filePreviewOf } from "../../lib/draftMediaText";
import type { Preview } from "../../lib/previewModal";
import { attachmentsHeader, drawnAs, type PredictedUnfurl } from "../../lib/slackDraftLayout";
import type { DraftMedia } from "../live/draftMedia";
import { CitedMark, useCited } from "./CitedDetail";
import { usePreviewModal } from "./PreviewModal";
import { ReadingIndicator } from "./ReadingIndicator";
import { FileCard, FRAME, TextFile } from "./SlackAttachmentFile";
import { StaleMark } from "./StaleMark";

/** One stored attachment's address on the console. */
function mediaSrc({ media }: { media: DraftMedia }): string {
  return `/api/draft-media/${media.sha256}`;
}

/**
 * One attached file, drawn the way Slack draws that kind: a picture, a video, or a file card.
 *
 * A picture or video is drawn by the browser, and the browser is the only judge of whether it can be: no byte check
 * at record time can prove a decoder takes a file (a header-only MP4, a BMP Jimp decodes and Chrome refuses). So a picture or video the browser refuses, or whose stored bytes do not load, is drawn
 * as the file card instead, marked as undrawn — never as a broken picture or a player that cannot play.
 *
 * @returns the file
 */
function File({ media, tile }: { media: DraftMedia; tile: boolean }): ReactElement {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { clickFor, modal } = usePreviewModal();
  const kind = drawnAs({ name: media.name });
  const preview = filePreviewOf({ name: media.name });
  if (kind === "file" && preview !== undefined) {
    return <TextFile expected={preview} media={media} />;
  }
  if (kind === "file" || failed) {
    return <FileCard media={media} undrawn={failed} />;
  }
  // A picture already drawn stays drawn: turning it into the file card then would take an open preview, and the link
  // focus returns to, off the page. A video never sets `loaded`, so every error of its still fails it.
  const onError = (): void => {
    if (!loaded) {
      setFailed(true);
    }
  };
  if (kind === "video") {
    return (
      <video
        className={`${FRAME} block max-h-[360px] max-w-full`}
        controls
        onError={onError}
        onLoadedMetadata={(event) => {
          // A video track the browser cannot decode is skipped rather than failed while an audio track survives,
          // so the element loads with no picture and fires no error — the r4 review's ProRes-with-AAC case.
          if (event.currentTarget.videoWidth === 0 || event.currentTarget.videoHeight === 0) {
            setFailed(true);
          }
        }}
        preload="metadata"
        src={mediaSrc({ media })}
      >
        <track kind="captions" />
      </video>
    );
  }
  const sizing = tile ? "aspect-[4/3] w-full object-cover" : "max-h-[360px] max-w-full object-contain";
  // A thumbnail opens its full-size bytes on click, as Slack's does — in a
  // modal over the card, never a page of its own (`../../lib/previewModal.ts`). Only once the
  // picture has loaded: one that then fails turns into the file card, which would take an open modal and the link
  // focus returns to with it, so a click before then keeps the link's own new tab.
  let fullSize: Preview | undefined;
  if (loaded) {
    fullSize = { kind: "image", src: mediaSrc({ media }), title: media.name };
  }
  return (
    <>
      <a
        className="block max-w-full cursor-zoom-in"
        href={mediaSrc({ media })}
        onClick={clickFor({ preview: fullSize })}
        rel="noreferrer"
        target="_blank"
        title={`open ${media.name} full size`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served locally from the draft store; nothing to optimise */}
        <img
          alt={media.name}
          className={`${FRAME} block ${sizing}`}
          onError={onError}
          onLoad={() => {
            setLoaded(true);
          }}
          // A picture the browser finished before React attached fires no load event to hear.
          ref={(img) => {
            if (img !== null && img.complete && img.naturalWidth > 0) {
              setLoaded(true);
            }
          }}
          src={mediaSrc({ media })}
          title={`${media.name} · sha256 ${media.sha256}`}
        />
      </a>
      {modal}
    </>
  );
}

/** Linear's mark, as its Slack app draws it beside a preview. */
function LinearMark(): ReactElement {
  return (
    <svg aria-hidden="true" className="size-9 shrink-0" viewBox="0 0 100 100">
      <circle cx="50" cy="50" fill="#fff" r="50" />
      <path
        d="M22 58 42 78M20 47l33 33M22 37l41 41M27 29l44 44M35 23l42 42M45 20l35 35M58 21l21 21"
        stroke="#16161a"
        strokeLinecap="round"
        strokeWidth="5.5"
      />
    </svg>
  );
}

/**
 * One Linear issue's preview, as Slack's Linear app draws it: the mark, the issue's title, and
 * `Issue JJJJ-1669 in Linear`. The title is read live through the hover card's own route, so it is the one Linear
 * will hand Slack; until it answers a spinner stands where the title goes, and if it cannot, the title slot is left
 * to the key line beneath and a staleness mark beside the preview says why. The mark sits outside the link, since a
 * button inside one is not reachable on its own.
 *
 * @returns the preview
 */
function LinearPreview({ unfurl }: { unfurl: Extract<PredictedUnfurl, { kind: "linear-issue" }> }): ReactElement {
  const record = citedRecordOf({ url: unfurl.url });
  const address = record === undefined ? unfurl.url : canonicalCitedAddress({ record });
  const cited = useCited({ address });
  let title: ReactElement | null = <ReadingIndicator label="Reading the issue's title from Linear" />;
  let mark: ReactElement | null = null;
  if (cited.phase === "ready") {
    title = <b className="truncate text-[0.95rem]">{cited.read.title}</b>;
    mark = <CitedMark state={cited} subject={`the title of ${unfurl.key}`} />;
  } else if (cited.phase === "not-measured") {
    title = null;
    mark = <StaleMark facts={[{ subject: `the title of ${unfurl.key}`, why: cited.why }]} />;
  }
  return (
    <div className="flex items-center gap-[0.35rem]">
      <a
        className={`${FRAME} flex w-[min(100%,330px)] items-center gap-3 px-3 py-2 text-foreground no-underline hover:bg-muted/40`}
        href={unfurl.url}
        rel="noreferrer"
        target="_blank"
      >
        <LinearMark />
        <span className="grid min-w-0">
          {title}
          <span className="truncate text-[0.82rem] text-muted-foreground">Issue {unfurl.key} in Linear</span>
        </span>
      </a>
      {mark}
    </div>
  );
}

/**
 * Everything Slack will draw under the message: the header line, the files, then the link previews.
 *
 * @param media the draft's attached files, in attach order
 * @param unfurls the previews Slack will add under its links — only the measured kinds
 * @returns the block, or nothing when the message carries neither
 */
export function SlackAttachments({
  media,
  unfurls,
}: {
  media: readonly DraftMedia[];
  unfurls: readonly Extract<PredictedUnfurl, { kind: "linear-issue" }>[];
}): ReactElement | null {
  const header = attachmentsHeader({ files: media.map((file) => file.name), unfurls: unfurls.length });
  if (media.length === 0 && unfurls.length === 0) {
    return null;
  }
  const tiled = media.length > 1;
  const columns = media.length === 2 ? "grid-cols-2" : "grid-cols-3";
  // A document's words need a reading width; a lone picture keeps the width it always had.
  const reads = media.some(
    (file) => drawnAs({ name: file.name }) === "file" && filePreviewOf({ name: file.name }) !== undefined,
  );
  const single = reads ? "grid max-w-[600px] justify-items-start" : "grid max-w-[480px] justify-items-start";
  return (
    <div className="mt-1 grid gap-2" aria-label="attached under the message">
      {header !== undefined && (
        <p className="m-0 flex items-center gap-2 text-[0.8rem] text-muted-foreground">
          <span>{header.text} ▾</span>
          {header.downloadAll && (
            <>
              <span aria-hidden="true">|</span>
              <span>Download all</span>
            </>
          )}
        </p>
      )}
      {media.length > 0 && (
        <div className={tiled ? `grid max-w-[640px] gap-2 ${columns}` : single}>
          {[...media.entries()].map(([at, file]) => (
            <File key={`${String(at)}-${file.sha256}`} media={file} tile={tiled} />
          ))}
        </div>
      )}
      {unfurls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unfurls.map((unfurl) => (
            <LinearPreview key={unfurl.url} unfurl={unfurl} />
          ))}
        </div>
      )}
    </div>
  );
}
