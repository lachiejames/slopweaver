"use client";

/*
 * A pull request's derived statuses, drawn from one landing row: its state in words (`plainStateOf`,
 * `../../lib/prPlainState.ts`), its checks and its open review.
 *
 * One module because two surfaces draw them — the pull-requests page's row and slide-over, and a citation chip's
 * hover card (`../console/CitedPullDetail.tsx`). A citation card carries the same statuses the pull
 * request page does. So the card draws THESE components off the same row, never a second derivation of them.
 */

import type { ReactElement } from "react";

import { pullRequestActionTone, toneVariant } from "../../lib/consoleTone";
import { landingCiTone, landingCiWord } from "../../lib/landingCi";
import { plainStateOf } from "../../lib/prPlainState";
import type { DrawnWait } from "../../lib/reviewHook";
import { cn } from "../../lib/utils";
import { Avatar } from "../console/Avatar";
import { AvatarStack } from "../ui/avatar-stack";
import { Badge } from "../ui/badge";
import type { LandingRow } from "./readLanding";

/** The wait whose act is the channel's — `src/review/humanWait.ts`'s word for a share whose clock is green or yellow. */
const WAIT_ON_CHANNEL = "wait-on-channel";
const SYNC_SLACK = "sync-slack";

/**
 * The row's state in words (`plainStateOf`), coloured by its next act: a fixed width on the page, and the whole state
 * on its title when the width clips it. Never the all-caps machine word, which stays on the hover.
 *
 * @param title the hover text — the machine word, or that word with what it means
 * @param className replaces the page's fixed column width where the tag stands alone
 * @returns the tag
 */
export function ActionTag({
  row,
  wait,
  title,
  className = "max-w-[18rem]",
}: {
  row: LandingRow;
  wait: DrawnWait | undefined;
  title: string;
  className?: string;
}): ReactElement {
  // A wait on the channel, or a Slack sync, is coloured by that act, not by `blocked-on`: neither is the owner's move,
  // and whether anyone holds a synced row is exactly what its history is too stale to say.
  let action = row.action;
  if (wait?.next === WAIT_ON_CHANNEL || wait?.next === SYNC_SLACK) {
    action = wait.next;
  }
  return (
    <Badge
      variant={toneVariant({ tone: pullRequestActionTone({ action }) })}
      size="sm"
      className={cn("justify-center truncate border-0 px-2 leading-[1.5] font-normal", className)}
      title={title}
    >
      {plainStateOf({ row, wait })}
    </Badge>
  );
}

/**
 * The checks chip: the verb's own CI word, qualified on red as required, advisory or requirement unknown, and
 * how many checks are not green when some are not.
 *
 * @returns the chip
 */
export function ChecksChip({ row }: { row: LandingRow }): ReactElement {
  const word = landingCiWord({ row });
  let text = word;
  if (row.failingChecks.length > 0) {
    text = `${word} · ${String(row.failingChecks.length)} failing`;
  }
  return (
    <Badge
      variant={toneVariant({ tone: landingCiTone({ ci: row.ci, ciFailure: row.ciFailure }) })}
      size="sm"
      className="px-2 text-[0.74rem]"
      title={row.failingChecks.map((check) => check.name).join(", ")}
    >
      {text}
    </Badge>
  );
}

/**
 * The review chip: who is waiting on us — their pictures stacked, then each login with how many threads they
 * opened, humans and bots as the verb counted them. The logins stay in text: a face alone does not say who.
 *
 * @param avatarOf the picture the roster has for a GitHub login, when it has one
 * @returns the chip, or nothing when no thread is open
 */
export function ReviewChip({
  row,
  avatarOf,
}: {
  row: LandingRow;
  avatarOf: (login: string) => string | undefined;
}): ReactElement | null {
  if (row.waitingOn.length === 0) {
    return null;
  }
  const names = row.waitingOn.map((thread) => `${thread.login} (${String(thread.open)})`).join(", ");
  return (
    <Badge variant="warning" size="sm" className="px-2 text-[0.74rem]" title="open review threads, by who opened them">
      <AvatarStack size="sm">
        {row.waitingOn.map((thread) => (
          <Avatar key={thread.login} url={avatarOf(thread.login)} name={thread.login} size="sm" />
        ))}
      </AvatarStack>
      {names}
    </Badge>
  );
}
