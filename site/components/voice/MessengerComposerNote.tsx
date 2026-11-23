/**
 * The note under Messenger's composer box: the composer's own lead words, and a reason from the call, the attach route
 * or the typed turn said plainly after them. Split from `MessengerComposer.tsx` to keep it under the line cap.
 */
import type { ReactElement } from "react";

import { PlainWhy } from "../console/RawFold";

/** A note under the box: the composer's own lead words, and a reason from elsewhere said plainly after them. */
export interface ComposerNote {
  readonly lead: string | undefined;
  readonly why: string | undefined;
}

/**
 * One note under the box. A reason from the call, the attach route or the typed turn goes through `PlainWhy`, so a raw
 * message folds under its plain line; a `div` rather than `<output>`, which holds only phrasing content and so cannot
 * hold the fold.
 *
 * @param note the lead words and the reason to show, either of which may be absent
 * @returns the note line
 */
export function ComposerNoteLine({ note }: { note: ComposerNote }): ReactElement {
  let joiner = "";
  if (note.lead !== undefined && note.why !== undefined) {
    joiner = ": ";
  }
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- `<output>` holds only phrasing content, so it cannot hold the reason's block fold
    <div role="status" className="m-0 block text-[0.72rem] [overflow-wrap:anywhere] text-warning">
      {note.lead}
      {joiner}
      {note.why === undefined ? null : <PlainWhy why={note.why} />}
    </div>
  );
}
