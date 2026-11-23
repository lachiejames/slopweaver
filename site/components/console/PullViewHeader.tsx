/** The pull request's header: its title, GitHub's state pill, author, branches, and when GitHub was read. */
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from "lucide-react";
import { type ReactElement } from "react";

import { clauseAfter } from "../../lib/clauseJoin";
import { type PullView as PullViewData } from "../../lib/pullView";
import { cn } from "../../lib/utils";
import { BUTTON } from "./controls";
import { PullOnBase } from "./PullOnBase";
import { type People, Person, When } from "./PullViewParts";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";

/** The header lifecycle, drawn as GitHub draws it: its glyph, its word, and its solid ground. */
const LIFECYCLE: Record<PullViewData["lifecycle"], { icon: LucideIcon; word: string; ground: string }> = {
  closed: { ground: "bg-gh-danger-emphasis", icon: GitPullRequestClosed, word: "Closed" },
  draft: { ground: "bg-gh-neutral-emphasis", icon: GitPullRequestDraft, word: "Draft" },
  merged: { ground: "bg-gh-done-emphasis", icon: GitMerge, word: "Merged" },
  open: { ground: "bg-gh-success-emphasis", icon: GitPullRequest, word: "Open" },
};

/** GitHub's state pill: white on the state's own solid colour. */
function Lifecycle({ lifecycle }: { lifecycle: PullViewData["lifecycle"] }): ReactElement {
  const look = LIFECYCLE[lifecycle];
  const Icon = look.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.85rem] leading-5 font-medium text-white",
        look.ground,
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {look.word}
    </span>
  );
}

/** A branch name, as GitHub's blue monospace pill. */
function Ref({ name }: { name: string }): ReactElement {
  return <code className="rounded-md bg-gh-accent/15 px-1.5 py-0.5 text-[0.76rem] text-gh-accent">{name}</code>;
}

/** The pull request's title, state, author, branches and size, and when GitHub was read. */
export function Header({
  view,
  people,
  observedAtIso,
  rereading,
  reread,
  peopleWhy,
  staleWhy,
}: {
  view: PullViewData;
  people: People;
  observedAtIso: string;
  rereading: boolean;
  reread: () => void;
  peopleWhy: string | undefined;
  staleWhy: string | undefined;
}): ReactElement {
  // GitHub's own words: a closed pull request still "wants to merge".
  let verb = "wants to merge";
  if (view.lifecycle === "merged") {
    verb = "merged";
  }
  return (
    <header className="grid gap-2 border-b pb-3">
      <h2 className="m-0 text-[1.5rem] leading-[1.25] font-normal">
        {view.title} <span className="text-muted-foreground">#{String(view.number)}</span>
      </h2>
      <p className="m-0 flex flex-wrap items-center gap-2 text-[0.85rem] text-muted-foreground">
        <Lifecycle lifecycle={view.lifecycle} />
        <Person login={view.author} people={people} />
        <span>
          {verb} into <Ref name={view.baseRef} /> from <Ref name={view.headRef} />
        </span>
      </p>
      <PullOnBase view={view} />
      <p className="m-0 flex flex-wrap items-center gap-2 text-[0.76rem] text-muted-foreground">
        <span>
          read from GitHub <When iso={observedAtIso} />
        </span>
        {staleWhy !== undefined && (
          <StaleMark facts={[{ observedAtIso, subject: "the pull request", why: staleWhy }]} />
        )}
        <button
          type="button"
          className={cn(BUTTON, "px-2 py-0.5 text-[0.74rem]")}
          disabled={rereading}
          onClick={reread}
        >
          read it again
        </button>
        {rereading && <ReadingIndicator label="Re-reading the pull request" />}
        {peopleWhy !== undefined && (
          <StaleMark
            facts={[
              {
                subject: "the people's names and pictures",
                why: clauseAfter({ clause: "so logins show instead", joint: ",", reason: peopleWhy }),
              },
            ]}
          />
        )}
        <a className="ml-auto" href={view.url} target="_blank" rel="noreferrer">
          open it in GitHub →
        </a>
      </p>
    </header>
  );
}
