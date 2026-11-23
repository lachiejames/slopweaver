"use client";

/**
 * The release notes, read in a modal: what one press of Update would bring, each change a sentence in full, the
 * changes the owner asked for first, and the rest behind one fold. Opened from the sidebar's build fold, which only
 * says how many there are.
 *
 * A fold has too little room to show a change (twenty characters, eight of them a commit hash and five a pull
 * request number), and a commit hash or a pull request number there tells the reader nothing without following a
 * link to an external site. So the notes are a modal large enough to read, showing what
 * changes if the owner updates right now and nothing older. No commit hash appears here and nothing links out: a
 * change's pull request number is plain text behind its own details, beside the owner's words when they asked for it.
 *
 * Ten commits behind matter only if they touch the desktop, the UI or a bug fix. So the notes are grouped — the owner's
 * asks, in the app, couldn't tell, behind the scenes — the count says how many are in the app, and each card says
 * whether it is a fix or something new.
 */
import { type ReactElement, type ReactNode, useEffect, useRef } from "react";

import type { ConsoleCommit } from "../../lib/buildStandingReport";
import { changeSentence } from "../../lib/changeSentence";
import { clauseAfter } from "../../lib/clauseJoin";
import {
  quotedWords,
  type ReleaseNote,
  releaseChangeSummary,
  releaseNotes,
  releaseNotesUnchecked,
} from "../../lib/releaseNotes";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { cn } from "../../lib/utils";
import { ReadMark } from "../live/LiveMarks";
import { type LandedReportView, readLanded } from "../live/readLanded";
import { refreshLive, useLive } from "../live/useLive";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { ReadingIndicator } from "./ReadingIndicator";
import { FoldedEntries } from "./SidebarFold";
import { StaleMark } from "./StaleMark";
import { SIDEBAR_BUTTON_WRAP, UpdateButton, type UpdateControl } from "./UpdateButton";

/**
 * The trigger in the build fold and the modal it opens.
 *
 * @param changes what an update would bring (`experienceChanges`), newest first
 * @param update the sidebar's one update controller, so the footer's button is the same press as the sidebar's
 * @param upstreamSha origin/main's tip as the build reading last saw it, which re-reads the landings when it moves
 * @returns the trigger, whose modal mounts only while open
 */
export function ReleaseNotesModal({
  changes,
  update,
  upstreamSha,
}: {
  changes: readonly ConsoleCommit[];
  update: UpdateControl;
  upstreamSha: string | undefined;
}): ReactElement {
  const count = releaseChangeSummary({ changing: changes });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="xs" variant="outline" className={cn("mt-[0.4rem]", SIDEBAR_BUTTON_WRAP)}>
          What&apos;s changed: {count}
        </Button>
      </DialogTrigger>
      <DialogContent
        data-release-notes=""
        className="max-h-[80vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>What&apos;s changed</DialogTitle>
          <DialogDescription>
            What updating now brings: {count}. The ones you asked for come first, then the ones in the app, then any
            whose place could not be read, then the ones behind the scenes; each newest first.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain pr-[0.25rem]">
          <ReleaseNotes changes={changes} upstreamSha={upstreamSha} />
        </div>
        <DialogFooter className="sm:justify-end">
          <UpdateButton control={update} surface="modal" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The notes themselves, ranked by the owner's asks once `fleet landed` answers. Mounted only while the modal is open, so that
 * slow-lane verb is asked for only then — on opening, and again when origin/main moves. The channel is shared, so
 * another tile reading it (Fleet's landed history) reads it on its own mount and this one draws that answer too.
 *
 * Progressive disclosure, never a fifty-item list: the top two the owner probably cares about come first, picked from
 * what they said earlier. A plain-English rundown of them all would need a model, and this page
 * runs none (rule 2) — the console voice is the place to ask for one.
 *
 * @returns the notes, with a line when the ranking is not whole
 */
function ReleaseNotes({
  changes,
  upstreamSha,
}: {
  changes: readonly ConsoleCommit[];
  upstreamSha: string | undefined;
}): ReactElement {
  const landed = useLive<LandedReportView>({ read: readLanded, slug: "landed" });
  // The last tip read against; a first mount reads anyway, so only a later move re-reads.
  const seen = useRef(upstreamSha);
  useEffect(() => {
    if (upstreamSha === undefined || upstreamSha === seen.current) {
      return;
    }
    if (seen.current !== undefined) {
      refreshLive({ slug: "landed" });
    }
    seen.current = upstreamSha;
  }, [upstreamSha]);
  // A ranking still being read is an indicator and one that could not be read a staleness mark, never a line of text.
  let note: ReactNode = <ReadingIndicator label="Ranking these changes by your asks" />;
  let sections = releaseNotes({ changing: changes, landings: [] });
  if (landed.phase === "not-measured") {
    note = <StaleMark facts={[{ subject: "The ranking of these changes by your asks", why: landed.why }]} />;
  }
  if (landed.phase === "ready") {
    const landings = landed.value.landings;
    sections = releaseNotes({ changing: changes, landings });
    const unread: StalenessFact[] = landed.value.ledgerUnread.map(({ file, why }) => ({
      subject: `your record ${file}`,
      why: clauseAfter({ clause: "these changes are ranked by the asks that could be read", joint: ";", reason: why }),
    }));
    const unchecked = releaseNotesUnchecked({ changing: changes, landings });
    if (unread.length === 0 && unchecked !== undefined) {
      unread.push({ subject: "your asks behind some of these changes", why: unchecked });
    }
    // The mark draws nothing over a current reading, so a line holding only it would be an empty gap.
    const current = landed.stale === undefined && landed.refreshing !== true;
    note = undefined;
    if (unread.length > 0 || !current) {
      note = (
        <>
          {unread.length > 0 && <StaleMark facts={unread} />}{" "}
          <ReadMark state={landed} subject="the ranking of these changes by your asks" />
        </>
      );
    }
  }
  return (
    <>
      {note === undefined ? null : <p className="m-0 mb-[0.6rem] text-sm text-muted-foreground">{note}</p>}
      {sections.map((section) => (
        <section key={section.group} data-release-group={section.group} className="mb-[0.6rem]">
          <h3 className="m-0 mb-[0.35rem] text-[0.78rem] font-medium text-muted-foreground">{section.heading}</h3>
          <FoldedEntries folded={section.notes} render={(entries) => <NoteList notes={entries} />} />
        </section>
      ))}
    </>
  );
}

/**
 * A stretch of notes, one readable sentence each.
 *
 * @returns the list
 */
function NoteList({ notes }: { notes: readonly ReleaseNote[] }): ReactElement {
  return (
    <ol className="m-0 mb-[0.4rem] grid list-none gap-[0.75rem] p-0">
      {notes.map((note) => (
        <Note key={note.commit.sha} note={note} />
      ))}
    </ol>
  );
}

/**
 * One change: whether it is a fix or something new and the area it touched, the sentence whole, and its details
 * folded beneath — the owner's words, the pull request's number and the day it landed, none of it a link. Whether the
 * owner asked for it is its group's heading, never repeated on the card.
 *
 * @returns the entry
 */
function Note({ note }: { note: ReleaseNote }): ReactElement {
  const { area, kind, sentence } = changeSentence({ title: note.commit.title });
  return (
    <li className="rounded-lg border border-solid border-border px-[0.8rem] py-[0.6rem]" data-release-note="">
      {area === undefined && kind === undefined ? null : (
        <p className="m-0 mb-[0.25rem] flex gap-[0.4rem] text-[0.72rem] text-muted-foreground">
          {kind === undefined ? null : <span className="font-medium text-primary">{kind}</span>}
          {area === undefined ? null : <span className="rounded-sm bg-muted px-[0.35rem]">{area}</span>}
        </p>
      )}
      <p className="m-0 text-[0.92rem] leading-[1.5] text-foreground">{sentence}</p>
      <details className="group/note mt-[0.3rem] text-[0.78rem] text-muted-foreground">
        <summary className="cursor-pointer list-none underline decoration-dotted underline-offset-2">
          <span className="group-open/note:hidden">Details</span>
          <span className="hidden group-open/note:inline">Hide details</span>
        </summary>
        {note.quote === undefined ? null : (
          // The owner's words keep their own spacing and line breaks: a paragraph would collapse them.
          <p className="m-0 mt-[0.3rem] whitespace-pre-wrap">
            You said: &ldquo;{quotedWords({ quote: note.quote })}&rdquo;
          </p>
        )}
        <p className="m-0 mt-[0.3rem]">{landedLine({ commit: note.commit })}</p>
      </details>
    </li>
  );
}

/**
 * When a change landed and the pull request it came in, in words.
 *
 * @returns the line
 */
function landedLine({ commit }: { commit: ConsoleCommit }): string {
  const day = new Date(Date.parse(commit.committedIso)).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  if (commit.pullRequest === undefined) {
    return `Landed ${day}, straight to main.`;
  }
  return `Landed ${day} in pull request ${String(commit.pullRequest.number)}.`;
}
