/** The conversation's entries — comments, reviews and inline review threads — and the diff rows a thread quotes. */
import { type ReactElement, type ReactNode } from "react";

import {
  type PullComment,
  type PullReview,
  type PullThread,
  type PullView as PullViewData,
  pullTimeline,
} from "../../lib/pullView";
import { type DiffLine, hunkTail } from "../../lib/unifiedDiff";
import { CHIP } from "./controls";
import { Markdown } from "./PullViewMarkdown";
import { Box, type People, Person, When } from "./PullViewParts";

/** A comment on the conversation. */
function CommentBox({ comment, people }: { comment: PullComment; people: People }): ReactElement {
  return (
    <Box
      head={
        <>
          <Person login={comment.author} people={people} />
          <span className="text-muted-foreground">
            commented <When iso={comment.createdAt} href={comment.url} />
          </span>
        </>
      }
    >
      <Markdown text={comment.body} url={comment.url} />
    </Box>
  );
}

/** What a review's state says in the conversation. */
const REVIEW_SAYS: Readonly<Partial<Record<string, { words: string; tone: string }>>> = {
  APPROVED: { tone: "text-gh-success", words: "approved these changes" },
  CHANGES_REQUESTED: { tone: "text-gh-danger", words: "requested changes" },
  COMMENTED: { tone: "text-muted-foreground", words: "reviewed" },
  DISMISSED: { tone: "text-muted-foreground", words: "left a review that was dismissed" },
};

/** A submitted review. */
function ReviewBox({ review, people }: { review: PullReview; people: People }): ReactElement {
  let says = { tone: "text-muted-foreground", words: review.state.toLowerCase() };
  const known = REVIEW_SAYS[review.state];
  if (known !== undefined) {
    says = known;
  }
  const head = (
    <>
      <Person login={review.author} people={people} />
      <span className={says.tone}>{says.words}</span>
      {review.submittedAt !== undefined && <When iso={review.submittedAt} href={review.url} />}
      {review.onBehalfOf.length > 0 && (
        <span className="text-muted-foreground">for {review.onBehalfOf.join(", ")}</span>
      )}
    </>
  );
  if (review.body.trim() === "") {
    return <Box head={head} />;
  }
  return (
    <Box head={head}>
      <Markdown text={review.body} url={review.url} />
    </Box>
  );
}

/** Diff rows as GitHub's split-number unified view: old number, new number, the line, and what hangs under it. */
export function DiffRows({
  rows,
  hung,
}: {
  rows: readonly DiffLine[];
  hung?: ReadonlyMap<number, ReactNode>;
}): ReactElement {
  return (
    <table className="w-full border-collapse font-mono text-[0.76rem] leading-[1.45]">
      <tbody>
        {rows.map((row, index) => (
          // A patch's rows have no identity but their place in it, and the list never reorders.
          // oxlint-disable-next-line react/no-array-index-key
          <DiffRow key={index} row={row} hung={hung?.get(index)} />
        ))}
      </tbody>
    </table>
  );
}

/** The ground and gutter tone of each kind of diff row. */
const ROW_TONE: Record<DiffLine["kind"], string> = {
  add: "bg-gh-success/15",
  context: "",
  del: "bg-gh-danger/15",
  hunk: "bg-primary/10 text-muted-foreground",
  note: "text-muted-foreground italic",
};

/** The sign GitHub draws in front of each kind of line. */
const ROW_SIGN: Record<DiffLine["kind"], string> = { add: "+", context: " ", del: "-", hunk: "", note: "" };

/** One diff row, and whatever the file hangs under it — the review thread on that line. */
function DiffRow({ row, hung }: { row: DiffLine; hung: ReactNode | undefined }): ReactElement {
  let oldNo = "";
  let newNo = "";
  if (row.kind === "del" || row.kind === "context") {
    oldNo = String(row.oldNo);
  }
  if (row.kind === "add" || row.kind === "context") {
    newNo = String(row.newNo);
  }
  const gutter = "w-[1%] px-2 text-right align-top whitespace-nowrap text-muted-foreground select-none";
  return (
    <>
      <tr className={ROW_TONE[row.kind]}>
        <td className={gutter}>{oldNo}</td>
        <td className={gutter}>{newNo}</td>
        <td className="px-2 break-all whitespace-pre-wrap">
          <span className="text-muted-foreground select-none">{ROW_SIGN[row.kind]}</span>
          {row.text}
        </td>
      </tr>
      {hung !== undefined && hung !== null && (
        <tr>
          <td colSpan={3} className="bg-background px-3 py-2 font-sans">
            {hung}
          </td>
        </tr>
      )}
    </>
  );
}

/** The comments of one review thread, oldest first. */
function ThreadComments({ thread, people }: { thread: PullThread; people: People }): ReactElement {
  return (
    <ol className="m-0 grid list-none gap-3 p-0">
      {thread.comments.map((comment) => (
        <li key={comment.id} className="grid gap-1">
          <p className="m-0 flex flex-wrap items-center gap-2 text-[0.8rem]">
            <Person login={comment.author} people={people} />
            <When iso={comment.createdAt} href={comment.url} />
          </p>
          <Markdown text={comment.body} url={comment.url} />
        </li>
      ))}
    </ol>
  );
}

/** The labels GitHub puts on a thread's head. */
function ThreadLabels({ thread }: { thread: PullThread }): ReactElement {
  return (
    <>
      {thread.resolved && (
        <span className={CHIP} data-tone="hot">
          resolved
        </span>
      )}
      {thread.outdated && (
        <span className={CHIP} data-tone="warn">
          outdated
        </span>
      )}
    </>
  );
}

/** An inline review thread in the conversation: the file and line, the code above it, and its comments. */
export function ThreadBox({ thread, people }: { thread: PullThread; people: People }): ReactElement {
  let where = thread.path;
  if (thread.line !== undefined && thread.side === "LEFT") {
    // A comment on a removed line counts its line in the OLD file; the bare `path:line` would name the new one.
    where = `${thread.path}, old line ${String(thread.line)}`;
  } else if (thread.line !== undefined) {
    where = `${thread.path}:${String(thread.line)}`;
  }
  let code: readonly DiffLine[] = [];
  if (thread.diffHunk !== undefined) {
    code = hunkTail({ hunk: thread.diffHunk, rows: 6 });
  }
  return (
    <details open={!thread.resolved} className="overflow-hidden rounded-lg border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 bg-muted/30 px-3 py-2 text-[0.8rem]">
        <code className="text-[0.78rem]">{where}</code>
        <ThreadLabels thread={thread} />
        <span className="text-muted-foreground">
          {String(thread.comments.length)} comment{thread.comments.length === 1 ? "" : "s"}
        </span>
      </summary>
      {code.length > 0 && (
        <div className="overflow-x-auto border-y">
          <DiffRows rows={code} />
        </div>
      )}
      <div className="px-3 py-2.5">
        <ThreadComments thread={thread} people={people} />
      </div>
    </details>
  );
}

/** The conversation's entries, oldest first. */
export function Timeline({ view, people }: { view: PullViewData; people: People }): ReactElement {
  const items = pullTimeline({ view });
  return (
    <ol className="m-0 grid list-none gap-3 p-0">
      {items.map((item) => {
        if (item.kind === "comment") {
          return (
            <li key={item.comment.id}>
              <CommentBox comment={item.comment} people={people} />
            </li>
          );
        }
        if (item.kind === "review") {
          return (
            <li key={item.review.id}>
              <ReviewBox review={item.review} people={people} />
            </li>
          );
        }
        return (
          <li key={item.thread.id}>
            <ThreadBox thread={item.thread} people={people} />
          </li>
        );
      })}
    </ol>
  );
}
