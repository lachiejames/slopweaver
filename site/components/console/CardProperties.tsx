"use client";

/*
 * An opened card's one properties section — status, priority, workstream, related, and who its message tags and who
 * is in its thread — as a label/value grid the way Linear's issue sidebar does. What each says is `../../lib/cardProperties.ts`; this only draws it. The two people lines
 * are the one place on a card an identity chip is drawn, one per name, stacked.
 */
import type { ReactElement, ReactNode } from "react";

import { inlinePersonName } from "../../lib/cardPeopleDisplay";
import type {
  CardWorkstream,
  PeopleProperty,
  CardProperties as Properties,
  RelatedItem,
} from "../../lib/cardPropertiesTypes";
import { CitationChip } from "./CitationChip";
import { PersonChip } from "./PersonChip";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";

/** One label/value line. */
function Line({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <>
      <dt className="text-[0.72rem] text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-[0.8rem] break-words">{children}</dd>
    </>
  );
}

/** A value the card does not carry, drawn as absent rather than left blank. */
function Absent({ text }: { text: string }): ReactElement {
  return <span className="text-muted-foreground italic">{text}</span>;
}

/** A small value chip. */
function Chip({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className="rounded-[5px] border border-border bg-muted px-[0.35rem] py-[0.02rem] text-[0.74rem]">
      {children}
    </span>
  );
}

/** A stacked list, one entry per line. */
const STACK = "m-0 grid list-none justify-items-start gap-[0.2rem] p-0";

/**
 * One related item: a pull request as the citation it is, a board row as its own words and nothing to click. The owner
 * ignores board citations on a card, and the card already carries the band and status the row would — so a card
 * names the row and never links the board.
 */
function Related({ item }: { item: RelatedItem }): ReactElement {
  if (item.kind === "pr") {
    return <CitationChip reference={{ kind: "address", url: item.href }}>{item.label}</CitationChip>;
  }
  if (item.kind === "blocked-by") {
    return <span>blocked by {item.label}</span>;
  }
  return (
    <span>
      {item.label} <span className="text-muted-foreground">· {item.status}</span>
    </span>
  );
}

/** One workstream as a citation: its name, its progress on hover, and its page on click. */
function Workstream({ stream }: { stream: CardWorkstream }): ReactElement {
  const reference = { kind: "address", url: stream.href } as const;
  if (stream.kind === "loading") {
    return <ReadingIndicator label={`Reading the workstream ${stream.id}`} />;
  }
  if (stream.kind === "failed") {
    return (
      <span className="inline-flex items-center gap-[0.3rem]">
        <CitationChip reference={reference} place={stream.id} detail={null}>
          {stream.id}
        </CitationChip>
        <StaleMark facts={[{ subject: "the workstreams register", why: stream.why }]} />
      </span>
    );
  }
  if (stream.kind === "read") {
    return (
      <CitationChip reference={reference} place={stream.name} detail={stream.progress}>
        {stream.name}
      </CitationChip>
    );
  }
  return (
    <CitationChip reference={reference} place={stream.id} detail={<Absent text={stream.why} />}>
      {stream.id}
    </CitationChip>
  );
}

/** One people property: a chip per person, stacked, an id nobody names as itself, or why nobody is listed yet. */
function People({ property }: { property: PeopleProperty }): ReactElement {
  if (property.kind === "loading") {
    return <ReadingIndicator label="Reading the people" />;
  }
  if (property.kind === "failed") {
    return <StaleMark facts={[{ subject: "the thread", why: property.why }]} />;
  }
  if (property.kind === "unread") {
    return <Absent text={`not recorded: ${property.why}`} />;
  }
  if (property.people.length === 0 && property.unresolved.length === 0) {
    return <Absent text="no one" />;
  }
  return (
    <ul className={STACK}>
      {property.people.map((person) => (
        <li key={person.id}>
          <PersonChip person={person} label={inlinePersonName({ fallback: person.id, person })} />
        </li>
      ))}
      {property.unresolved.map((id) => (
        <li key={id} title="the member roster does not hold this id">
          <Absent text={id} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The card's properties block.
 *
 * @param properties what the card carries, derived from its record, tags, board rows and people
 * @returns the block
 */
export function CardProperties({ properties }: { properties: Properties }): ReactElement {
  const { status, priority, workstreams, related, tagged, thread, board, caveats } = properties;
  return (
    <section data-card-properties="" className="mb-3">
      <dl className="m-0 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-[0.45rem]">
        <Line label="Status">
          <Chip>{status.value}</Chip>
        </Line>
        <Line label="Priority">
          <Chip>{priority.band}</Chip> <span className="text-[0.72rem] text-muted-foreground">{priority.why}</span>
        </Line>
        {workstreams.length > 0 && (
          <Line label="Workstream">
            <ul className={STACK}>
              {workstreams.map((stream) => (
                <li key={stream.id}>
                  <Workstream stream={stream} />
                </li>
              ))}
            </ul>
          </Line>
        )}
        {tagged !== undefined && (
          <Line label="Tags">
            <People property={tagged} />
          </Line>
        )}
        {thread !== undefined && (
          <Line label="In thread">
            <People property={thread} />
          </Line>
        )}
        {related.length > 0 && (
          <Line label="Related">
            <ul className={STACK}>
              {related.map((item) => (
                <li key={`${item.kind}:${item.kind === "pr" ? item.label : item.slug}`}>
                  <Related item={item} />
                </li>
              ))}
            </ul>
          </Line>
        )}
      </dl>
      {board !== undefined && (
        <div className="mt-2">
          {board.kind === "reading" ? (
            <ReadingIndicator label="Reading the board" />
          ) : (
            <StaleMark facts={[{ subject: "the board", why: board.why }]} />
          )}
        </div>
      )}
      {caveats.map((caveat) => (
        <p key={caveat} className="mt-2 mb-0 text-[0.72rem] text-muted-foreground">
          {caveat}
        </p>
      ))}
    </section>
  );
}
