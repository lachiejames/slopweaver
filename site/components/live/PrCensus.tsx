import type { ReactElement } from "react";

import { consolePullHref } from "../../lib/pullAddress";
import { type CensusPicture, type NotPlacedPr, populationOf } from "../../lib/pullRequestCensus";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { About } from "../console/About";
import { useWorkspacePlacer } from "../console/organisationState";
import { StaleMark } from "../console/StaleMark";
import { FindingMark } from "../console/workContextState";
import { repoNameOf } from "./PrCard";
import { ROW_DETAIL } from "./Row";

/**
 * GitHub's own count, the witness to the badge's: how many of the owner's are open on GitHub in this context at this
 * reading (the landing's `--author`), how many the groups below place, how many they do not, and how many more
 * other authors have open, counted and never listed.
 *
 * Worded "at this reading" because it is a snapshot, not a live count: the tile's stamp ages it, and the shell
 * takes a fresh one when it is due against the landing cadence. A reading that cannot give GitHub's count draws a
 * staleness mark whose hover says why, in the count's own place, never a figure from a different population.
 *
 * @param ready the pull requests ready to press in this context, printed after GitHub's count and never in its place
 * @returns the line
 */
export function CensusHeadline({ picture, ready }: { picture: CensusPicture; ready: number }): ReactElement {
  if (picture.kind === "unavailable") {
    // One fact per repository whose open list did not read, its reason exactly as the read gave it (steer 7).
    const { why: reason } = picture;
    let facts: readonly StalenessFact[];
    if (typeof reason === "string") {
      facts = [{ subject: "GitHub's count", why: reason }];
    } else {
      facts = reason.map(({ subject, why }) => ({ subject, why }));
    }
    return (
      <p className="sw-tile-note">
        Open on GitHub: <StaleMark facts={facts} /> · {String(ready)} ready to press
      </p>
    );
  }
  const repos = picture.repos.map((slug) => repoNameOf({ slug })).join(" and ");
  let closed = "";
  if (picture.closedSince > 0) {
    closed = ` · ${String(picture.closedSince)} below closed since`;
  }
  let others = "";
  // Only a qualified reading has other authors outside it; an unqualified one counts every author in `open`.
  if (picture.otherAuthors > 0 && picture.authorFilter !== undefined) {
    others = ` · ${String(picture.otherAuthors)} more open by other authors, outside --author ${picture.authorFilter}`;
  }
  return (
    <p className="sw-tile-note [&_b]:font-semibold">
      <b>{String(picture.open)}</b> {populationOf({ authorFilter: picture.authorFilter })} on GitHub ({repos}) at this
      reading · {String(picture.placed)} placed below · {String(picture.notPlaced.length)} not placed{closed}
      {others} · {String(ready)} ready to press
    </p>
  );
}

/** One pull request the reading did not place, in the fold: where, which, whose, and whether it is a draft. */
function NotPlacedItem({ pr }: { pr: NotPlacedPr }): ReactElement {
  const placer = useWorkspacePlacer();
  let author = "a deleted account";
  if (pr.author !== undefined) {
    author = pr.author;
  }
  let draft = "";
  if (pr.isDraft) {
    draft = " · draft";
  }
  return (
    <li>
      <a href={consolePullHref({ url: pr.url })}>
        {repoNameOf({ slug: pr.repoSlug })}#{String(pr.number)}
      </a>{" "}
      {pr.title} · {author}
      {draft} <FindingMark placement={placer.repositoryPlacement({ repo: pr.repoSlug })} />
    </li>
  );
}

/** One unplaced pull request's number, linked, prefixed with its repository when the context holds two. */
function NumberLink({ pr, multiRepo }: { pr: NotPlacedPr; multiRepo: boolean }): ReactElement {
  const placer = useWorkspacePlacer();
  let prefix = "";
  if (multiRepo) {
    prefix = repoNameOf({ slug: pr.repoSlug });
  }
  // A repository no workspace owns makes the pull request a finding the default rule places, so it wears the mark.
  return (
    <span>
      <a href={consolePullHref({ url: pr.url })} title={pr.title}>
        {prefix}#{String(pr.number)}
      </a>
      <FindingMark placement={placer.repositoryPlacement({ repo: pr.repoSlug })} />
    </span>
  );
}

/**
 * Every one of the owner's pull requests GitHub lists open that no group below carries, NAMED rather than counted into a
 * zero; another author's is outside the count and only counted, on the headline.
 *
 * One visible line per reason — its count and its sentence — and under it EVERY number, linked, in a box of
 * bounded height that scrolls: the owner's word is that a visible line names any pull request the page cannot
 * place, and a reading without --include-drafts can leave dozens of the owner's drafts out, which unbounded would be the
 * wall of text rule 7 refuses. Titles and authors ride one fold beneath. Nothing is drawn when every one is placed.
 *
 * @returns the section, or nothing
 */
export function NotPlaced({ picture }: { picture: CensusPicture }): ReactElement | null {
  if (picture.kind !== "counted" || picture.notPlaced.length === 0) {
    return null;
  }
  const multiRepo = picture.repos.length > 1;
  return (
    <section className="mt-[0.6rem] text-[0.74rem]" aria-label="not placed">
      {picture.byReason.map((group) => (
        <div key={group.reason} className="mb-[0.4rem]">
          <p className="m-0 text-muted-foreground">
            <b className="text-foreground">{String(group.prs.length)} not placed</b>, {group.sentence}:
          </p>
          <p className="m-0 flex max-h-[4.2rem] flex-wrap gap-x-[0.5rem] overflow-y-auto">
            {group.prs.map((pr) => (
              <NumberLink key={`${pr.repoSlug}#${String(pr.number)}`} multiRepo={multiRepo} pr={pr} />
            ))}
          </p>
        </div>
      ))}
      <About label={`all ${String(picture.notPlaced.length)} not placed, with titles and authors`}>
        <ul className={ROW_DETAIL}>
          {picture.notPlaced.map((pr) => (
            <NotPlacedItem key={`${pr.repoSlug}#${String(pr.number)}`} pr={pr} />
          ))}
        </ul>
      </About>
    </section>
  );
}
