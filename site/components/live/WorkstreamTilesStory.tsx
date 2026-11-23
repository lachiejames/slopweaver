/**
 * A workstream's dated story inside an open card: its entries, each source a citation, the feedback and the skeptic.
 */
import { type ReactElement } from "react";

import { type EntryView, type FeedbackView, type MilestoneGraphView, shortDate } from "../../lib/workstreamTiles";
import { CHIP } from "../console/controls";
import { SLIDE_EMPTY, SLIDE_SECTION } from "./SlideOver";
import { Cite } from "./WorkstreamTilesCite";

/** Entry → dot colour: one that finishes a milestone teal, the start red, pushback amber. */
function dotTone({ entry }: { entry: EntryView }): string {
  if (entry.done) {
    return "bg-primary";
  }
  if (entry.kind === "raised") {
    return "bg-danger";
  }
  if (entry.kind === "pushback") {
    return "bg-warning";
  }
  return "bg-muted-foreground";
}

/**
 * One dated dot, its source a citation.
 *
 * @returns the list item
 */
function TimelineDot({ entry, graph }: { entry: EntryView; graph: MilestoneGraphView }): ReactElement {
  const tagged = graph.milestones.find((one) => one.id === entry.milestoneId);
  return (
    <li className="relative pb-[0.55rem] pl-4 text-[0.88rem]">
      <span className={`absolute top-[0.45em] -left-[6px] size-[10px] rounded-full ${dotTone({ entry })}`} />
      <span className="inline-block min-w-[4.2rem] text-muted-foreground tabular-nums" title={entry.date}>
        {shortDate({ date: entry.date })}
      </span>
      {tagged === undefined ? null : (
        <span className={`${CHIP} mr-[0.4rem]`} data-milestone-tag={tagged.id}>
          {entry.done ? `${tagged.name} done` : tagged.name}
        </span>
      )}
      {entry.text}
      {entry.href === null ? null : (
        <>
          {" "}
          <Cite href={entry.href} />
        </>
      )}
    </li>
  );
}

/**
 * One feedback line: who, when, what, and — for a negative one — what changed because of it.
 *
 * @returns the paragraph
 */
function FeedbackLine({ line }: { line: FeedbackView }): ReactElement {
  const positive = line.sign === "positive";
  return (
    <p className="my-1 text-[0.86rem]">
      <span className={`font-bold ${positive ? "text-success" : "text-warning"}`}>{positive ? "+" : "−"}</span>{" "}
      {line.who}, {shortDate({ date: line.date })}: {line.text}
      {line.href === null ? null : (
        <>
          {" "}
          <Cite href={line.href} />
        </>
      )}
      {line.response === null ? null : (
        <>
          {" "}
          <b>What you did about it:</b> {line.response}
        </>
      )}
    </p>
  );
}

/** A graph with no milestones, for the entries of a kind that carries none: the store refuses a tag on one. */
export const NO_MILESTONES: MilestoneGraphView = { columns: 0, milestones: [] };

/**
 * The dated story, each source a citation, in story order; one with no entry says so rather than drawing an empty
 * list.
 *
 * @returns the section
 */
export function Timeline({
  entries,
  graph,
}: {
  entries: readonly EntryView[];
  graph: MilestoneGraphView;
}): ReactElement {
  return (
    <section className={SLIDE_SECTION}>
      <h4>Timeline</h4>
      {entries.length === 0 ? (
        <p className={SLIDE_EMPTY}>no dated entry recorded yet</p>
      ) : (
        <ol className="my-[0.4rem] list-none border-y-0 border-r-0 border-l-2 border-solid border-border p-0">
          {entries.map((entry) => (
            <TimelineDot key={entry.id} entry={entry} graph={graph} />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The dated story, the feedback and the skeptic.
 *
 * @returns the block
 */
export function Story({
  entries,
  feedback,
  skeptic,
  graph,
}: {
  entries: readonly EntryView[];
  feedback: readonly FeedbackView[];
  skeptic: string | null;
  graph: MilestoneGraphView;
}): ReactElement {
  return (
    <>
      <Timeline entries={entries} graph={graph} />
      {feedback.length === 0 ? null : (
        <section className={SLIDE_SECTION}>
          <h4>Feedback</h4>
          {feedback.map((line, index) => (
            <FeedbackLine key={`${line.date}-${String(index)}`} line={line} />
          ))}
        </section>
      )}
      {skeptic === null ? null : (
        <section className={SLIDE_SECTION}>
          <h4>The skeptic</h4>
          <p className="m-0 border-y-0 border-r-0 border-l-[3px] border-solid border-warning px-[0.6rem] py-[0.2rem] text-[0.86rem] text-warning">
            {skeptic}
          </p>
        </section>
      )}
    </>
  );
}
