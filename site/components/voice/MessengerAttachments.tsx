/**
 * The files waiting to go with the owner's next message, above Messenger's box: one tile each, a picture's thumbnail or a text
 * file's icon, its name and size, a spinner while it is being kept, and an X that takes it off. Split from `MessengerComposer.tsx` to keep it under the line cap.
 */
import { FileText, LoaderCircle, X } from "lucide-react";
import type { ReactElement } from "react";

import { fileSizeLabel } from "../../lib/draftMediaText";
import type { PendingMessengerAttachment } from "../../lib/messengerAttachment";

/** A tile's square: the thumbnail, or the text file's icon on the panel colour. */
const THUMB = "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-(--c-panel)";

/**
 * Every file waiting to go with the owner's next message, as a wrapping row of tiles.
 *
 * @param attached the waiting files, in the owner's order
 * @param onRemove takes the file with this token off the owner's next message
 * @returns the row
 */
export function MessengerAttachments({
  attached,
  onRemove,
}: {
  attached: readonly PendingMessengerAttachment[];
  onRemove: (token: string) => void;
}): ReactElement {
  return (
    <ul aria-label="files to send" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {attached.map((file) => (
        <AttachmentTile
          key={file.token}
          file={file}
          onRemove={() => {
            onRemove(file.token);
          }}
        />
      ))}
    </ul>
  );
}

/**
 * One waiting file: its thumbnail, its name and size under it, and the X in its corner.
 *
 * @param file the waiting file
 * @param onRemove takes it off the owner's next message
 * @returns the tile
 */
function AttachmentTile({ file, onRemove }: { file: PendingMessengerAttachment; onRemove: () => void }): ReactElement {
  const keeping = file.kind === "keeping";
  const busy = keeping || file.kind === "sending";
  let status = fileSizeLabel({ bytes: file.bytes });
  if (keeping) {
    status = "attaching";
  } else if (file.kind === "sending") {
    status = "sending";
  }
  let thumb = <FileText size={20} aria-hidden="true" className="text-muted-foreground" />;
  if (file.previewUrl !== undefined) {
    thumb = <img src={file.previewUrl} alt="" className="size-full object-cover" />;
  }
  return (
    <li
      aria-busy={busy}
      className="relative flex w-40 min-w-0 items-center gap-2 rounded-lg border border-solid sw-glass-control p-1 pr-5 text-[0.75rem] text-foreground"
    >
      <span className={`${THUMB} relative`}>
        {thumb}
        {busy ? (
          // An opaque badge in the theme's own ink, never a scrim over the picture: nothing here is faded.
          <span className="absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-full bg-background text-foreground">
            <LoaderCircle size={12} aria-hidden="true" className="animate-spin" />
          </span>
        ) : null}
      </span>
      <span className="grid min-w-0">
        <span className="truncate" title={file.name}>
          {file.name}
        </span>
        <span className="text-muted-foreground">{status}</span>
      </span>
      <button
        type="button"
        className="absolute top-1 right-1 inline-flex cursor-pointer rounded-full border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
        aria-label={`remove ${file.name}`}
        onClick={onRemove}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}
