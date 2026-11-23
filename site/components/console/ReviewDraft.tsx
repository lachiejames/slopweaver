/*
 * A parked review of somebody else's pull request, drawn the way GitHub draws a pending review — the sibling of
 * `./SlackDraft.tsx` for GitHub. Findings surface in a queue card where the owner can approve the draft pull-request
 * comments on the relevant lines, as with Slack drafts.
 *
 * Each comment sits under the hunk it was recorded on (`../live/readReviewDrafts.ts`), so the owner reads the line it
 * is about without opening the pull request. Nothing here writes and nothing here posts: the post command is printed
 * for the owner to run or hand a session, and the deeper-review offer is labelled as never posted.
 */

import type { ReactElement } from "react";
import { commentLocation, reviewHeading } from "../../lib/reviewDraftCard";
import { cn } from "../../lib/utils";
import type { ParkedReview, ReviewComment, ReviewHunkLine } from "../live/readReviewDrafts";
import { CopyBlock } from "./CopyBlock";

/** Each hunk line's tint and the sign GitHub prints in its gutter. */
const HUNK_LOOK: Record<ReviewHunkLine["kind"], { readonly tint: string; readonly sign: string }> = {
  add: { sign: "+", tint: "bg-success/15 text-success" },
  context: { sign: " ", tint: "text-foreground" },
  del: { sign: "-", tint: "bg-danger/10 text-danger" },
  header: { sign: "", tint: "bg-muted/60 text-muted-foreground" },
};

/** A line number in a gutter, blank where that side has none. */
function Gutter({ at }: { at: number | undefined }): ReactElement {
  return (
    <span className="px-[0.4rem] text-right text-muted-foreground select-none">
      {at === undefined ? "" : String(at)}
    </span>
  );
}

/**
 * One comment's hunk as a unified diff: both sides' numbers, the sign, the text. Keyed by position — two blank
 * context lines are genuinely the same string.
 *
 * @returns the diff
 */
function Hunk({ hunk }: { hunk: readonly ReviewHunkLine[] }): ReactElement {
  return (
    <pre className="m-0 overflow-x-auto rounded-[6px] border border-border font-mono text-[0.76rem] leading-[1.45]">
      {[...hunk.entries()].map(([at, line]) => (
        <span
          key={`hunk-${String(at)}`}
          className={cn("grid grid-cols-[2.8rem_2.8rem_1rem_minmax(0,1fr)]", HUNK_LOOK[line.kind].tint)}
          data-kind={line.kind}
        >
          <Gutter at={line.oldLine} />
          <Gutter at={line.newLine} />
          <span className="select-none">{HUNK_LOOK[line.kind].sign}</span>
          <span className="whitespace-pre">{line.text}</span>
        </span>
      ))}
    </pre>
  );
}

/** One line comment: where it sits, the lines it sits on, and what it says. */
function Comment({ comment }: { comment: ReviewComment }): ReactElement {
  return (
    <li className="grid gap-[0.35rem]">
      <code className="text-[0.78rem] font-bold">{commentLocation({ comment })}</code>
      {comment.hunk.length > 0 && <Hunk hunk={comment.hunk} />}
      <p className="m-0 rounded-[6px] border-l-4 border-primary/50 bg-card px-[0.6rem] py-[0.4rem] text-[0.86rem] whitespace-pre-wrap">
        {comment.body}
      </p>
    </li>
  );
}

/**
 * What became of the review, in the corner of its header — the one thing drawn outside the review itself, since a
 * faithful preview is exactly what makes a reader liable to believe it already went out.
 *
 * @returns the stamp
 */
function Stamp({ review }: { review: ParkedReview }): ReactElement {
  if (review.state === "held") {
    return (
      <span className="ml-auto rounded-full border border-warning px-2 text-[0.72rem] tracking-[0.02em] text-warning uppercase">
        not posted: waiting on your word
      </span>
    );
  }
  const word = review.state === "posted" ? "posted" : "dropped unposted";
  return (
    <span className="ml-auto rounded-full border border-border px-2 text-[0.72rem] tracking-[0.02em] text-muted-foreground uppercase">
      {word}
    </span>
  );
}

/**
 * The review as GitHub would carry it: the heading, who wrote the pull request and why it was reviewed, the offer
 * of a deeper review (never posted), the body, every comment on its hunk, and the one command that would post it.
 *
 * @param review the parked review, as the register recorded it
 * @returns the review
 */
export function ReviewDraft({ review }: { review: ParkedReview }): ReactElement {
  return (
    <section
      className="grid gap-[0.7rem] rounded-[10px] border border-solid sw-glass-control px-[0.75rem] py-[0.7rem]"
      aria-label="the review, as it would post"
    >
      <div className="flex items-start gap-2 border-b border-border pb-[0.4rem]">
        <b className="text-[0.92rem]">{reviewHeading({ review })}</b>
        <Stamp review={review} />
      </div>
      <p className="m-0 text-[0.8rem] text-muted-foreground">
        {review.author === undefined ? "Author not recorded" : `by @${review.author}`} · reviewed because {review.why}
      </p>
      {review.deeperReview !== undefined && (
        <div className="rounded-[6px] border border-dashed border-warning px-[0.6rem] py-[0.4rem] text-[0.82rem]">
          <b className="text-warning">Deeper review offered, NOT posted:</b> {review.deeperReview}
        </div>
      )}
      {review.body.trim() === "" ? (
        <p className="m-0 text-[0.8rem] text-muted-foreground">The review has no body.</p>
      ) : (
        <p className="m-0 text-[0.9rem] whitespace-pre-wrap">{review.body}</p>
      )}
      {review.comments.length > 0 && (
        <ol className="m-0 grid list-none gap-[0.8rem] p-0">
          {/* Keyed by position too: two comments on one line are two comments, and share a location. */}
          {[...review.comments.entries()].map(([at, comment]) => (
            <Comment key={`${commentLocation({ comment })}#${String(at)}`} comment={comment} />
          ))}
        </ol>
      )}
      {review.postCommand === undefined ? (
        <p className="m-0 text-[0.8rem] text-muted-foreground">
          Nothing is left to post: the register has it {review.state}.
        </p>
      ) : (
        <div className="grid gap-[0.3rem]">
          <p className="m-0 text-[0.78rem] text-muted-foreground">
            The one command that posts it, exactly as shown (run it, or hand it to a session):
          </p>
          <CopyBlock text={review.postCommand} />
        </div>
      )}
      <p className="m-0 text-[0.72rem] text-muted-foreground">
        row <code>review:{review.id}</code>
      </p>
    </section>
  );
}
