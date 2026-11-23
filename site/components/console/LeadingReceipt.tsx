/*
 * The receipt a first message in a channel leads with, drawn BESIDE the draft and above its words — never only as an
 * attachment at the foot (the Queue card is the Slack draft with the annotated
 * screenshot beside it as the first message's receipt). The picture is the stored bytes the draft will post
 * (`/api/draft-media/<sha256>`), and each note is the one the recorder wrote on a box drawn into it
 * (`src/visualEvidence/`, read by `slack draft list` as `leadingReceipt`).
 */

import type { ReactElement } from "react";

import type { LeadingReceipt as Receipt } from "../live/draftProofMissing";

/**
 * The annotated screenshot and its notes.
 *
 * @param receipt the digest of the picture and the note on each of its boxes
 * @returns the receipt
 */
export function LeadingReceipt({ receipt }: { receipt: Receipt }): ReactElement {
  return (
    <figure
      className="m-0 grid gap-1 rounded-[8px] border border-solid border-border px-2 py-[0.4rem]"
      aria-label="the first message's receipt"
    >
      <figcaption className="text-[0.68rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">
        first message · its receipt
      </figcaption>
      <img
        alt={receipt.notes.join("; ")}
        className="max-h-[320px] w-auto max-w-full rounded-[6px] object-contain"
        src={`/api/draft-media/${receipt.sha256}`}
      />
      <ol className="m-0 pl-[1.1rem] text-[0.8rem]">
        {receipt.notes.map((note, index) => (
          <li key={`${String(index)}:${note}`}>{note}</li>
        ))}
      </ol>
    </figure>
  );
}
