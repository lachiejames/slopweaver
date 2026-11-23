"use client";

/*
 * The voice editing a parked draft live, drawn on the card the owner has open, and the versions it leaves. While it works the card shows a moving
 * border, the owner's words quoted, and the voice's reading of them as a checklist; then it reads as v2 with v1 kept,
 * and v1 comes back on the owner's word.
 *
 * The edit is the page's own, never the register's (`../voice/draftEditRun.ts`): nothing here is written anywhere,
 * and it is gone when the call is. The versions are the register's (`../live/readDraftVersions.ts`).
 */

import type { ReactElement, ReactNode } from "react";

import { type DraftVersionView, versionLine } from "../live/readDraftVersions";
import { type DraftEditing, useDraftEditing } from "../voice/draftEditRun";
import { PlainWhy } from "./RawFold";

/** What the card says of each phase. */
function phaseLine({ edit }: { edit: DraftEditing }): string {
  if (edit.phase === "editing") {
    return "Editing from what you said";
  }
  if (edit.phase === "writing") {
    return "Writing the new version";
  }
  if (edit.phase === "saved") {
    return "Saved as the next version · not sent";
  }
  if (edit.why === undefined) {
    return "Not changed: refused";
  }
  return "Not changed";
}

/**
 * Why the edit was refused, said plainly with the route's or the caught message folded under it, never lifted into the
 * phase line as itself; nothing while the edit was not refused or gave no reason.
 */
function RefusedWhy({ edit }: { edit: DraftEditing }): ReactElement | null {
  if (edit.phase !== "refused" || edit.why === undefined) {
    return null;
  }
  return (
    <div className="text-[0.78rem] text-muted-foreground">
      <PlainWhy why={edit.why} />
    </div>
  );
}

/**
 * The draft's message, framed while the voice edits it: the owner's words, its reading, and where it is.
 *
 * @param id the parked draft the card shows
 * @param children the message as Slack would draw it
 * @returns the framed message, or the message alone when the voice is not editing it
 */
export function DraftEditFrame({ id, children }: { id: string; children: ReactNode }): ReactElement {
  const edit = useDraftEditing({ id });
  if (edit === undefined) {
    return <>{children}</>;
  }
  const moving = edit.phase === "editing" || edit.phase === "writing";
  const done = edit.phase === "saved";
  return (
    <div
      aria-live="polite"
      className={`grid gap-[0.4rem] rounded-[10px] px-2 py-[0.4rem] ${moving ? "sw-draft-editing" : "border border-solid border-border"}`}
      data-phase={edit.phase}
    >
      <blockquote className="m-0 border-l-2 border-warning pl-2 text-[0.82rem] italic">“{edit.heard}”</blockquote>
      <ul aria-label="what the voice took from it" className="m-0 grid list-none gap-[0.15rem] p-0 text-[0.8rem]">
        {edit.reading.map((line, index) => (
          <li className="flex gap-[0.4rem]" key={`${String(index)}:${line}`}>
            <span aria-hidden="true">{done ? "✓" : "○"}</span>
            {line}
          </li>
        ))}
      </ul>
      <p className="m-0 text-[0.72rem] font-bold tracking-[0.04em] text-muted-foreground uppercase">
        {phaseLine({ edit })}
      </p>
      <RefusedWhy edit={edit} />
      {children}
    </div>
  );
}

/**
 * Which version the draft reads as, and every earlier one behind a disclosure, newest first.
 *
 * @param versions the row's history, oldest first
 * @returns the line and the disclosure
 */
export function DraftVersions({ versions }: { versions: readonly DraftVersionView[] }): ReactElement {
  const earlier = versions.slice(0, -1).toReversed();
  return (
    <details className="text-[0.78rem] text-muted-foreground">
      <summary className="cursor-pointer">{versionLine({ versions })}</summary>
      <ol className="m-0 mt-[0.3rem] grid list-none gap-[0.5rem] p-0">
        {earlier.map((version) => (
          <li className="grid gap-[0.15rem] border-l-2 border-border pl-2" key={version.number}>
            <b>
              v{version.number}
              {version.restoredFrom === undefined ? "" : ` (v${String(version.restoredFrom)} put back)`}
            </b>
            {version.heard !== undefined && <i>“{version.heard}”</i>}
            <span className="whitespace-pre-wrap text-foreground">{version.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
