"use client";

/**
 * The Alignment count, ONE hook behind the page's head and its sidebar badge, run ONCE for the whole console
 * (`./alignmentWaitingShared.tsx`), so the two cannot print different numbers or currency off different joins of the
 * same readings. Read it through `useSharedAlignmentWaiting`, never by calling this again.
 *
 * The count is the general-ruling questions the owner has not answered (`../../lib/sidebarCountsAlignment.ts`), so it
 * reads only what those questions are made from: the autonomy ledger, the draft register, the owner's feedback on drafts
 * and the owner's answers. Each channel is console-wide and shared with the Queue's (`../live/useLiveChannels.ts`), so
 * subscribing here costs no second fetch. The board, which places acts, is not read: no act is counted.
 */
import { useMemo } from "react";

import type { AlignmentRecovery } from "../../lib/alignmentAutoRefresh";
import type { CardFeedback } from "../../lib/alignmentRules";
import { QUEUE_REGISTER_POLLS } from "../../lib/queueRegisterPolls";
import { alignmentWaitingReadingOf } from "../../lib/sidebarCountsAlignment";
import type { SidebarReading } from "../../lib/sidebarCountsBasis";
import { type AlignmentAnswer, readAlignmentAnswers, readTriageFeedback } from "../live/readAlignment";
import { type AutonomyRow, readAutonomy } from "../live/readAutonomy";
import { type ParkedDraft, readParkedDrafts } from "../live/readSlackDrafts";
import { useLive } from "../live/useLive";
import { useAlignmentAutoRefresh } from "./useAlignmentAutoRefresh";

/**
 * How often an open page re-reads the owner's named feedback on drafts they sent back, so the Alignment count and its
 * "make it a general ruling?" candidates follow a card sent back a minute ago rather than the one the page opened on
 * (numbers that change between loads are live). One minute, the cadence the sidebar already
 * reads the owner's answers off the same relay ledger at; one read is startup-bound, MEASURED at 1.79s wall
 * (`/usr/bin/time -p slopweaver talk log --about-prefix post: --json`). Set here, the one hook the Alignment page and
 * its sidebar badge share, so both ride the same channel at the same cadence.
 */
const FEEDBACK_POLL_MS = 60_000;

/** The Alignment count, and what the console is doing about a failed read it is made from. */
export interface AlignmentWaiting {
  readonly waiting: SidebarReading;
  /** What the console is doing about a failed read the count is made from (`./useAlignmentAutoRefresh.ts`). */
  readonly recovery: AlignmentRecovery;
}

/**
 * Subscribe to the readings the Alignment count is made from, derive it, and run the one recovery runner over the
 * read-once ones.
 *
 * @returns the count and its recovery
 */
export function useAlignmentWaiting(): AlignmentWaiting {
  const acts = useLive<readonly AutonomyRow[]>({ read: readAutonomy, slug: "autonomy" });
  const posts = useLive<readonly ParkedDraft[]>({
    everyMs: QUEUE_REGISTER_POLLS["slack-drafts"],
    read: readParkedDrafts,
    slug: "slack-drafts",
  });
  const answers = useLive<readonly AlignmentAnswer[]>({ read: readAlignmentAnswers, slug: "alignment-answers" });
  const feedback = useLive<readonly CardFeedback[]>({
    everyMs: FEEDBACK_POLL_MS,
    read: readTriageFeedback,
    slug: "triage-feedback",
  });
  const waiting = useMemo(
    () => alignmentWaitingReadingOf({ acts, answers, feedback, posts }),
    [acts, answers, feedback, posts],
  );
  // The one runner reading a failed read-once reading again (`./useAlignmentAutoRefresh.ts`): run here, in the shell's
  // single instance of this hook, so the badge, the page head and Start here report one recovery.
  const recovery = useAlignmentAutoRefresh({
    sources: [
      { slug: "autonomy", state: acts },
      { slug: "alignment-answers", state: answers },
    ],
  });
  // One identity per reading: the shared source hands this up through an effect keyed on it, so a fresh object every
  // render would loop.
  return useMemo(() => ({ recovery, waiting }), [recovery, waiting]);
}
