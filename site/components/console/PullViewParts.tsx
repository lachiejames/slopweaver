/**
 * The pieces every part of the pull request view draws: who the people are, a person's chip, an instant, GitHub's
 * comment frame, and a size in added and removed lines.
 */
import { type ReactElement, type ReactNode } from "react";

import { ageOf } from "../../lib/ageOf";
import { type Login, type PullStanding, type PullView as PullViewData, standingOf } from "../../lib/pullView";
import { cn } from "../../lib/utils";
import type { Avatars } from "../live/readPeople";
import { PullPersonChip } from "./PullPersonChip";

/** Everything a chip anywhere on the page needs to say who a person is and where they stand. */
export interface People {
  readonly avatars: Avatars | undefined;
  readonly view: PullViewData;
  readonly reviewers: readonly PullStanding[];
}

/** A person on this pull request as their chip. */
export function Person({ login, people }: { login: Login; people: People }): ReactElement {
  return (
    <PullPersonChip
      login={login}
      avatars={people.avatars}
      standing={standingOf({ login, reviewers: people.reviewers, view: people.view })}
    />
  );
}

/** An instant as the page states it: its age, the exact instant on hover. */
export function When({ iso, href }: { iso: string; href?: string }): ReactElement {
  const words = ageOf({ iso });
  if (href === undefined) {
    return <time title={iso}>{words}</time>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" title={`${iso}: open in GitHub`} className="text-muted-foreground">
      {words}
    </a>
  );
}

/** A bordered box with a head line — GitHub's comment frame. */
export function Box({
  head,
  children,
  className,
}: {
  head: ReactNode;
  children?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("overflow-hidden rounded-lg border", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-[0.8rem]">{head}</div>
      {children !== undefined && <div className="px-3 py-2.5">{children}</div>}
    </div>
  );
}

/** Added and removed line counts, in GitHub's green and red. */
export function Churn({ additions, deletions }: { additions: number; deletions: number }): ReactElement {
  return (
    <span className="font-mono text-[0.78rem] tabular-nums">
      <span className="text-gh-success">+{additions.toLocaleString()}</span>{" "}
      <span className="text-gh-danger">−{deletions.toLocaleString()}</span>
    </span>
  );
}
