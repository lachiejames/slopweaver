"use client";

/*
 * The staleness marks a Queue panel carries for the reads its card is drawn from beside its own register — the held
 * drafts a thread's held reply is drawn from, and a finding act's by-branch pull-request lookup. Their own module because
 * `./QueuePanels.tsx` sits against the file-size cap.
 */

import type { ReactElement, ReactNode } from "react";

import type { ActPullState } from "../../lib/actPullVerb";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { ReadMark } from "../live/LiveMarks";
import type { HeldDraft } from "../live/readThread";
import type { LiveState } from "../live/useLive";
import { SlackThread } from "./SlackThread";
import { StaleMark } from "./StaleMark";

/**
 * A Slack thread drawn with its held reply, with the drafts register's mark over it: a held reply
 * drawn off a reading kept over a failed re-read says so, never reading as the register's current word.
 *
 * @returns the thread
 */
export function HeldDraftsThread({
  id,
  drafts,
}: {
  id: string;
  drafts: LiveState<readonly HeldDraft[]>;
}): ReactElement {
  let held: readonly HeldDraft[] | undefined;
  let mark: ReactNode = null;
  if (drafts.phase === "ready") {
    held = drafts.value;
    mark = <ReadMark state={drafts} subject="the held drafts, which carry any reply waiting on this thread" row />;
  }
  return (
    <>
      {mark}
      <SlackThread id={id} drafts={held} />
    </>
  );
}

/**
 * The marks a finding act's lookup puts on its card: a failed lookup is a staleness fact drawn in the card's place,
 * and an earlier answer kept over a failed re-read carries the same mark in the panel's head.
 *
 * @param lookup the by-branch lookup the card is drawn from
 * @returns the fact for the card's place, and the head's mark
 */
export function actLookupMarks({ lookup }: { lookup: ActPullState }): {
  readonly refusedMark: StalenessFact | undefined;
  readonly staleLookup: ReactNode;
} {
  if (lookup.phase === "not-measured") {
    return {
      refusedMark: { subject: `the pull request opened from branch ${lookup.branch}`, why: lookup.why },
      staleLookup: null,
    };
  }
  if (lookup.phase === "ready" && lookup.stale !== undefined) {
    return {
      refusedMark: undefined,
      staleLookup: (
        <StaleMark
          facts={[{ subject: `the pull request opened from branch ${lookup.branch}`, why: lookup.stale.why }]}
        />
      ),
    };
  }
  return { refusedMark: undefined, staleLookup: null };
}
