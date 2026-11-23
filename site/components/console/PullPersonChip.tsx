"use client";

/*
 * A person on a pull request as an identity citation chip: their picture and name in GitHub's tint, and a hover
 * card saying who they are and where they stand on this pull request — author, requested, approved, asked for
 * changes, a code owner — before the reader follows them anywhere.
 *
 * The name and picture are the member roster's (`identity avatars --source github`), read once for the page by
 * `app/api/pull`. The roster's cross-source join — the same person's Slack and Linear handles — is NOT drawn:
 * `identity show <login>` resolves the whole corpus to answer it, MEASURED at 47.8s for one login
 * (`time slopweaver identity show octocat --json`), too slow for a hover. The chip draws what the
 * roster holds and says nothing it would have to guess.
 *
 * A queue card's people are `./PersonChip.tsx`, keyed by Slack id with the owner's workstreams; this one is keyed by GitHub
 * login with a standing on one pull request, so the two share a look and not a shape.
 */

import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";

import { citationKind } from "../../lib/citationKinds";
import { type PullStanding, standingLines } from "../../lib/pullView";
import { cn } from "../../lib/utils";
import { type Avatars, avatarKey } from "../live/readPeople";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { Avatar } from "./Avatar";
import { CitationMark } from "./CitationMark";

/** GitHub's own registry row, whose colour and mark the chip borrows — a login is a GitHub record. */
const GITHUB = citationKind({ id: "github" });

/**
 * One person, by GitHub login: their picture and roster name as a chip, their standing in the hover card.
 *
 * @param login the GitHub login, or `undefined` for a deleted account
 * @param avatars the member roster the page read, or `undefined` when it could not be read
 * @param standing where they stand on this pull request, when they are a reviewer or its author
 * @returns the chip
 */
export function PullPersonChip({
  login,
  avatars,
  standing,
  className,
}: {
  login: string | undefined;
  avatars: Avatars | undefined;
  standing?: PullStanding | undefined;
  className?: string;
}): ReactElement {
  if (login === undefined) {
    return <span className="text-muted-foreground italic">a deleted account</span>;
  }
  const person = avatars?.byId.get(avatarKey({ nativeId: login, source: "github" }));
  let name = login;
  if (person?.name !== undefined) {
    name = person.name;
  }
  const profile = `https://github.com/${login}`;
  const lines = standingLines({ standing });
  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <a
          href={profile}
          target="_blank"
          rel="noreferrer"
          data-citation="person"
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 align-middle text-xs font-medium no-underline hover:underline",
            className,
          )}
          style={{
            backgroundColor: `color-mix(in oklab, ${GITHUB.colour} 15%, transparent)`,
            borderColor: `color-mix(in oklab, ${GITHUB.colour} 38%, transparent)`,
            color: `color-mix(in oklab, ${GITHUB.colour} 25%, var(--foreground))`,
          }}
        >
          <Avatar url={person?.avatarUrl} name={name} size="sm" />
          <span className="truncate">{name}</span>
        </a>
      </HoverCardTrigger>
      <HoverCardContent side="top" collisionPadding={16} className="w-72 overflow-hidden p-0 text-xs">
        <p
          className="m-0 flex items-center gap-2 border-b px-3 py-2 font-medium text-foreground"
          style={{ backgroundColor: `color-mix(in oklab, ${GITHUB.colour} 14%, transparent)` }}
        >
          <CitationMark kind={GITHUB} size={14} />
          GitHub
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-2">
          <Avatar url={person?.avatarUrl} name={name} size="md" />
          <div className="min-w-0">
            <p className="m-0 truncate font-semibold text-foreground">{name}</p>
            <p className="m-0 truncate text-muted-foreground">
              @{login}
              {person?.bot === true && " · a bot"}
            </p>
          </div>
        </div>
        {lines.length > 0 && (
          <ul className="m-0 grid list-none gap-0.5 border-t px-3 py-2">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {person === undefined && (
          <p className="m-0 border-t px-3 py-2 text-[0.7rem] text-muted-foreground">
            not in the member roster, so the name is the login and there is no picture
          </p>
        )}
        <a
          href={profile}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 border-t bg-muted/30 px-3 py-2 text-muted-foreground no-underline hover:text-foreground"
        >
          <ExternalLink aria-hidden="true" className="size-3" />
          open their profile in GitHub
        </a>
      </HoverCardContent>
    </HoverCard>
  );
}
