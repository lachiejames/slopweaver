/** The pull request page's right-hand column, as GitHub draws it: reviewers, checks, labels and the merge state. */
import {
  Check,
  CircleCheck,
  CircleSlash,
  CircleX,
  Dot,
  FileDiff,
  type LucideIcon,
  MessageSquare,
  Shield,
  Users,
} from "lucide-react";
import { type ReactElement, type ReactNode } from "react";

import {
  type CheckKind,
  checkKind,
  checkSummary,
  type PullCheck,
  type PullStanding,
  type PullView as PullViewData,
  reviewsCut,
} from "../../lib/pullView";
import { cn } from "../../lib/utils";
import { type People, Person } from "./PullViewParts";

/** A sidebar section — GitHub's right-hand column. */
function Side({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="grid gap-1.5 border-b pb-3 text-[0.8rem]">
      <h3 className="m-0 text-[0.76rem] font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Where a reviewer stands, as the glyph GitHub draws at the right of their row. */
type ReviewerMark = "approved" | "changes" | "awaiting" | "dismissed" | "commented";

/** Where one reviewer's row stands. */
function reviewerMark({ row }: { row: PullStanding }): ReviewerMark {
  if (row.review === "APPROVED") {
    return "approved";
  }
  if (row.review === "CHANGES_REQUESTED") {
    return "changes";
  }
  if (row.requested) {
    return "awaiting";
  }
  if (row.review === "DISMISSED") {
    return "dismissed";
  }
  return "commented";
}

/** Each standing's words, said on hover and to a screen reader. */
const MARK_WORDS: Record<ReviewerMark, string> = {
  approved: "approved",
  awaiting: "awaiting review",
  changes: "changes requested",
  commented: "commented",
  dismissed: "review dismissed",
};

/**
 * The right-hand end of a reviewer row as GitHub draws it: a shield when GitHub asked them as a code owner, then their
 * standing — an amber dot awaiting, a green check approved, a red diff for changes requested, a grey bubble otherwise.
 */
function ReviewerMarks({ mark, codeOwner }: { mark: ReviewerMark; codeOwner: boolean }): ReactElement {
  let glyph: ReactElement;
  if (mark === "awaiting") {
    glyph = <span className="mx-1 inline-block size-2 rounded-full bg-gh-attention" />;
  } else if (mark === "approved") {
    glyph = <Check className="size-4 text-gh-success" aria-hidden="true" />;
  } else if (mark === "changes") {
    glyph = <FileDiff className="size-4 text-gh-danger" aria-hidden="true" />;
  } else {
    glyph = <MessageSquare className="size-4 text-gh-muted" aria-hidden="true" />;
  }
  let said = MARK_WORDS[mark];
  if (codeOwner) {
    said = `${said} · code owner`;
  }
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5" title={said}>
      {codeOwner && <Shield className="size-3.5 text-gh-muted" aria-hidden="true" />}
      {glyph}
      <span className="sr-only">{said}</span>
    </span>
  );
}

/** A team GitHub is waiting on, named as its slug without the organisation, beside a team glyph. */
function TeamName({ name }: { name: string }): ReactElement {
  let short = name;
  const slash = name.indexOf("/");
  if (slash !== -1) {
    short = name.slice(slash + 1);
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={name}>
      <Users className="size-4 shrink-0 text-gh-muted" aria-hidden="true" />
      <span className="truncate font-semibold">{short}</span>
    </span>
  );
}

/** The reviewers: every person with a standing, then each team GitHub is still waiting on. */
export function Reviewers({ view, people }: { view: PullViewData; people: People }): ReactElement {
  const teams = view.requested.filter((request) => request.kind === "team");
  // Checked before the empty case too: a cut list with nobody left in it is where "No reviews" would be a guess.
  const cut = reviewsCut({ view }) && (
    <p className="m-0 text-[0.72rem] text-warning">
      from the newest reviews only, so an earlier review may be missing:{" "}
      <a href={view.url} target="_blank" rel="noreferrer">
        see them all in GitHub
      </a>
    </p>
  );
  if (people.reviewers.length === 0 && teams.length === 0) {
    return (
      <Side title="Reviewers">
        <p className="m-0 text-muted-foreground">No reviews</p>
        {cut}
      </Side>
    );
  }
  return (
    <Side title="Reviewers">
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {/* One line a reviewer, as on GitHub: who on the left, truncating; the shield and the standing on the right. */}
        {people.reviewers.map((row) => (
          <li key={row.login} className="flex min-w-0 items-center gap-2">
            <span className="flex min-w-0">
              <Person login={row.login} people={people} />
            </span>
            <ReviewerMarks mark={reviewerMark({ row })} codeOwner={row.asCodeOwner} />
          </li>
        ))}
        {teams.map((team) => (
          <li key={team.name} className="flex min-w-0 items-center gap-2">
            <TeamName name={team.name} />
            <ReviewerMarks mark="awaiting" codeOwner={team.asCodeOwner} />
          </li>
        ))}
      </ul>
      {cut}
    </Side>
  );
}

/** The glyph GitHub draws beside a check, by the group its result falls in. */
const CHECK_GLYPH: Record<CheckKind, { icon: LucideIcon; tone: string }> = {
  failing: { icon: CircleX, tone: "text-gh-danger" },
  pending: { icon: Dot, tone: "text-gh-attention" },
  skipped: { icon: CircleSlash, tone: "text-gh-muted" },
  successful: { icon: CircleCheck, tone: "text-gh-success" },
};

/** The failing checks first, then the rest, in GitHub's order within each. */
function checkOrder({ items }: { items: readonly PullCheck[] }): readonly PullCheck[] {
  const failing = items.filter((check) => checkKind({ result: check.result }) === "failing");
  const other = items.filter((check) => checkKind({ result: check.result }) !== "failing");
  return [...failing, ...other];
}

/** One check's row: its glyph, then its name, which truncates rather than pushing anything off the row. */
function CheckRow({ check }: { check: PullCheck }): ReactElement {
  const glyph = CHECK_GLYPH[checkKind({ result: check.result })];
  const Icon = glyph.icon;
  const said = check.result.toLowerCase().replaceAll("_", " ");
  let name: ReactElement = <span className="min-w-0 truncate">{check.name}</span>;
  if (check.url !== undefined) {
    name = (
      <a href={check.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-foreground hover:underline">
        {check.name}
      </a>
    );
  }
  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a lucide <svg>, not HTML: role="img" with a label is how a drawing announces itself */}
      <Icon className={cn("size-4 shrink-0", glyph.tone)} role="img" aria-label={said}>
        <title>{said}</title>
      </Icon>
      {name}
    </>
  );
}

/** The head commit's checks. */
export function Checks({ view }: { view: PullViewData }): ReactElement {
  if (view.checks === undefined) {
    return (
      <Side title="Checks">
        <p className="m-0 text-muted-foreground">No checks on the head commit</p>
      </Side>
    );
  }
  const { checks } = view;
  let head = "the head commit";
  if (view.headOid !== undefined) {
    head = view.headOid.slice(0, 7);
  }
  const summary = checkSummary({ items: checks.items });
  return (
    <Side title="Checks">
      <p className="m-0 font-semibold">{summary.headline}</p>
      <p className="m-0 text-[0.76rem] text-gh-muted">
        {summary.counts.join(", ")} checks on {head}
      </p>
      <ul className="m-0 grid max-h-64 list-none gap-1 overflow-y-auto p-0">
        {checkOrder({ items: checks.items }).map((check, index) => (
          // One workflow's check runs share a name — `dev-gate` three times on one head — so place is the identity.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={`${String(index)}:${check.name}`} className="flex min-w-0 items-center gap-1.5 text-[0.76rem]">
            <CheckRow check={check} />
          </li>
        ))}
      </ul>
      {checks.items.length < checks.total && (
        <p className="m-0 text-[0.72rem] text-muted-foreground">
          {String(checks.items.length)} of {String(checks.total)} read
        </p>
      )}
    </Side>
  );
}

/** The labels, each in GitHub's own colour. */
export function Labels({ view }: { view: PullViewData }): ReactElement {
  if (view.labels.length === 0) {
    return (
      <Side title="Labels">
        <p className="m-0 text-muted-foreground">None yet</p>
      </Side>
    );
  }
  return (
    <Side title="Labels">
      <p className="m-0 flex flex-wrap gap-1">
        {view.labels.map((label) => (
          <span
            key={label.name}
            className="rounded-full border px-2 py-0.5 text-[0.72rem] font-medium"
            style={{ backgroundColor: `#${label.color}33`, borderColor: `#${label.color}88` }}
          >
            {label.name}
          </span>
        ))}
      </p>
    </Side>
  );
}

/** The merge state and review decision GitHub computed, in its own words. */
export function Mergeability({ view }: { view: PullViewData }): ReactElement | null {
  if (view.lifecycle === "merged" || view.lifecycle === "closed") {
    return null;
  }
  return (
    <Side title="Merge">
      <p className="m-0">
        state <b>{view.mergeStateStatus.toLowerCase()}</b>
      </p>
      {view.reviewDecision !== undefined && (
        <p className="m-0">
          review decision <b>{view.reviewDecision.toLowerCase().replaceAll("_", " ")}</b>
        </p>
      )}
    </Side>
  );
}
