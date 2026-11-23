"use client";

/*
 * A pull request as GitHub draws one — its header, the conversation and the files it changes — read live from
 * GitHub the moment the page opens, so the owner never steps out to github.com for confidence. It is realtime data on a platform-native view, so
 * the reader sees what they would see on that platform, with PRs, their diffs and reviews drawn with citation chips
 * and hover cards.
 *
 * The read is `github read <pr> --limit 100 --files --json` through `app/api/pull` (`./usePull.ts`), and the pure
 * halves are `../../lib/pullView.ts` (the document), `../../lib/unifiedDiff.ts` (the patch) and
 * `../../lib/pullAddress.ts` (the address). A stale diff is worse than a link, so the page never polls: it says
 * when it read GitHub, re-reads on a press, and names everything the read did not cover. Nothing here writes.
 */

import { type ReactElement, useState } from "react";

import { type PullTab, pullAddressOf } from "../../lib/pullAddress";
import { type PullView as PullViewData, pullReviewers, pullTimeline } from "../../lib/pullView";
import { cn } from "../../lib/utils";
import type { Avatars } from "../live/readPeople";
import { CHIP } from "./controls";
import { Files } from "./PullViewFiles";
import { Header } from "./PullViewHeader";
import { Markdown } from "./PullViewMarkdown";
import { Box, Churn, type People, Person, When } from "./PullViewParts";
import { Checks, Labels, Mergeability, Reviewers } from "./PullViewSidebar";
import { Timeline } from "./PullViewThreads";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";
import { usePull } from "./usePull";

/** The conversation tab: the description, the timeline, and the sidebar. */
function Conversation({ view, people }: { view: PullViewData; people: People }): ReactElement {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_16rem] gap-6 max-[900px]:grid-cols-1">
      <div className="grid content-start gap-3">
        <Box
          head={
            <>
              <Person login={view.author} people={people} />
              <span className="text-muted-foreground">
                opened this <When iso={view.createdAt} href={view.url} />
              </span>
            </>
          }
        >
          <Markdown text={view.body} url={view.url} />
        </Box>
        <Timeline view={view} people={people} />
      </div>
      <aside className="grid content-start gap-3">
        <Reviewers view={view} people={people} />
        <Checks view={view} />
        <Labels view={view} />
        <Mergeability view={view} />
      </aside>
    </div>
  );
}

/** The two tabs, GitHub's own, each with its count. */
function Tabs({
  tab,
  setTab,
  view,
}: {
  tab: PullTab;
  setTab: (tab: PullTab) => void;
  view: PullViewData;
}): ReactElement {
  // The count is what the tab draws, so a bare inline-batch review envelope is not counted twice.
  const conversation = pullTimeline({ view }).length;
  const entries: readonly { id: PullTab; label: string; count: number }[] = [
    { count: conversation, id: "conversation", label: "Conversation" },
    { count: view.changedFiles, id: "files", label: "Files changed" },
  ];
  return (
    <div className="flex gap-1 border-b" role="tablist">
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          className={cn(
            "-mb-px cursor-pointer border-x-0 border-t-0 border-b-2 border-solid border-transparent bg-transparent px-3 py-2 text-[0.85rem]",
            tab === entry.id && "border-primary font-semibold",
          )}
          onClick={() => {
            setTab(entry.id);
          }}
        >
          {entry.label} <span className={CHIP}>{String(entry.count)}</span>
        </button>
      ))}
      {/* The size sits at the tab row's right end, where GitHub puts it. */}
      <span className="ml-auto self-center" title="against the branch's merge base, as GitHub draws it">
        <Churn additions={view.additions} deletions={view.deletions} />
      </span>
    </div>
  );
}

/** What the read did not cover, in the wrapper's own words — never silently dropped. */
function Residue({ residue }: { residue: readonly string[] }): ReactElement | null {
  const cut = residue.filter((line) => line.includes("another provider page"));
  if (cut.length === 0) {
    return null;
  }
  return (
    <details className="text-[0.74rem] text-muted-foreground">
      <summary className="cursor-pointer">
        {String(cut.length)} list{cut.length === 1 ? "" : "s"} longer than this read carries
      </summary>
      <ul className="m-0 pl-4">
        {cut.map((line) => (
          <li key={line}>
            <code>{line}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * One pull request, read live from GitHub, drawn as GitHub draws it.
 *
 * @param url the pull request's canonical GitHub address
 * @param initialTab the tab the page was opened on
 * @returns the view
 */
export function PullView({ url, initialTab }: { url: string; initialTab: PullTab }): ReactElement {
  const { state, rereading, reread } = usePull({ url });
  const [tab, setTabState] = useState<PullTab>(initialTab);
  const setTab = (next: PullTab): void => {
    setTabState(next);
    const query = new URLSearchParams(window.location.search);
    if (next === "conversation") {
      query.delete("tab");
    } else {
      query.set("tab", next);
    }
    const search = query.toString();
    window.history.replaceState(null, "", search === "" ? window.location.pathname : `?${search}`);
  };
  if (state.phase === "loading") {
    return <ReadingIndicator label={`Reading ${pullAddressOf({ url })?.repoSlug} from GitHub`} block />;
  }
  if (state.phase === "not-measured") {
    return (
      <div className="grid justify-items-center gap-1">
        <StaleMark facts={[{ subject: "The pull request", why: state.why }]} block />
        <a className="sw-tile-note" href={url} target="_blank" rel="noreferrer">
          open it in GitHub
        </a>
      </div>
    );
  }
  const { view } = state;
  let avatars: Avatars | undefined;
  let peopleWhy: string | undefined;
  if (state.people.ok) {
    avatars = state.people.avatars;
  } else {
    peopleWhy = state.people.why;
  }
  const people: People = { avatars, reviewers: pullReviewers({ view }), view };
  return (
    <section className="grid gap-4 pt-3">
      <Header
        view={view}
        people={people}
        observedAtIso={state.observedAtIso}
        rereading={rereading}
        reread={reread}
        peopleWhy={peopleWhy}
        staleWhy={state.stale?.why}
      />
      <Tabs tab={tab} setTab={setTab} view={view} />
      {tab === "conversation" ? <Conversation view={view} people={people} /> : <Files view={view} people={people} />}
      <Residue residue={view.residue} />
    </section>
  );
}
