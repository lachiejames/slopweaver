"use client";

import { Bot, ChevronRight, Crown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  goalWords,
  livenessOf,
  type SessionLiveness,
  sessionPropertiesOf,
  type WorkingSessionCard,
  type WorkingSessionsView,
} from "../../lib/workingSessions";
import { PageEmpty } from "../console/PageEmpty";
import { QUEUE_META, QUEUE_ROW, QUEUE_ROW_EDGE, QUEUE_TEXT, QUEUE_TITLE, useNow } from "../console/QueueSections";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { Badge } from "../ui/badge";
import { SessionTurnView, type SessionTurnViewState } from "./SessionTurnView";
import { SLIDE_ASIDE_STICKY, SLIDE_BODY_SESSION, SLIDE_SECTION, SlideOver } from "./SlideOver";

/** How often the cards' liveness badges re-age against the wall clock: the page's ages trail by a minute at most. */
const LIVENESS_TICK_MS = 60_000;

/**
 * The stripe each card draws down its left edge, the Queue card's inset shadow: the supervisor in the primary hue, a
 * session that has moved recently in the success hue, one gone quiet in the warning hue.
 */
const STRIPE: Readonly<Record<"supervisor" | SessionLiveness["kind"], string>> = {
  active: "shadow-[inset_3px_0_0_var(--color-success)]",
  quiet: "shadow-[inset_3px_0_0_var(--color-warning)]",
  supervisor: "bg-primary/8 shadow-[inset_3px_0_0_var(--color-primary)]",
};

/** The Queue section heading's look, over the session list. */
const SECTION_HEAD = "m-0 px-[0.9rem] pt-[0.55rem] pb-[0.35rem] text-[0.74rem] font-medium text-muted-foreground";

/**
 * The glyph a card leads with, where a Queue card draws who raised it: a crown for the supervisor — the session that
 * seats every other one — and the agent mark for
 * the rest.
 *
 * @returns the glyph
 */
function SessionGlyph({ manager }: { manager: boolean }): ReactElement {
  if (manager) {
    return (
      <span
        className="mt-[0.1rem] grid size-[1.35rem] place-items-center rounded-full bg-primary/20 text-foreground"
        data-glyph="supervisor"
      >
        <Crown className="size-[0.8rem]" aria-label="the supervisor" />
      </span>
    );
  }
  return (
    <span
      className="mt-[0.1rem] grid size-[1.35rem] place-items-center rounded-full bg-muted text-muted-foreground"
      data-glyph="session"
    >
      <Bot className="size-[0.8rem]" aria-hidden="true" />
    </span>
  );
}

/**
 * One working session as a Queue card: the stripe, the glyph, its number and one short title, then the meta column's
 * chips — the host, the row's priority, and the badge saying whether it has moved recently — and the chevron. Its live
 * CPU and memory are the Machine tile's session table, read every two seconds. The supervisor's row is tinted and
 * badged apart from the others. No subtitle: the first prompt under a title was noise.
 *
 * @param number the card's place in the list, so the owner can say "open 3"
 * @param current whether this card's panel is the open one
 * @param nowMs the page's ticking clock, which ages the liveness badge
 * @returns the card
 */
function SessionCardButton({
  card,
  number,
  current,
  nowMs,
  onOpen,
}: {
  card: WorkingSessionCard;
  number: number;
  current: boolean;
  nowMs: number;
  onOpen: (card: WorkingSessionCard) => void;
}): ReactElement {
  const liveness = livenessOf({ nowMs, seat: card.seat });
  let stripe = STRIPE[liveness.kind];
  if (card.manager) {
    stripe = STRIPE.supervisor;
  }
  let lastActivity = "not read";
  if (card.seat.lastActivityAtIso !== undefined) {
    lastActivity = card.seat.lastActivityAtIso;
  }
  return (
    <button
      type="button"
      className={cn(QUEUE_ROW, QUEUE_ROW_EDGE, "bg-transparent", stripe)}
      data-session-card={card.key}
      data-manager={card.manager ? "true" : undefined}
      aria-current={current ? "true" : undefined}
      onClick={() => {
        onOpen(card);
      }}
    >
      <SessionGlyph manager={card.manager} />
      <span className={QUEUE_TEXT}>
        <span className={QUEUE_TITLE}>
          <span className="mr-[0.45rem] inline-grid h-[1.25rem] min-w-0 place-items-center rounded-[5px] bg-primary/22 px-[0.25rem] align-[0.08rem] text-[0.68rem] font-bold text-foreground">
            {String(number)}
          </span>
          {card.title}
        </span>
      </span>
      <span className={QUEUE_META}>
        {card.manager && (
          <Badge size="sm" className="border-solid bg-primary/15 text-foreground" data-meta="supervisor">
            runs the fleet
          </Badge>
        )}
        {card.seat.host !== undefined && <span data-meta="host">{card.seat.host}</span>}
        {card.row?.priority !== undefined && (
          <span data-meta="priority" className="font-semibold text-foreground">
            {card.row.priority}
          </span>
        )}
        <Badge
          size="sm"
          variant={liveness.kind === "active" ? "success" : "warning"}
          className="border-solid"
          data-liveness={liveness.kind}
          title={`last activity ${lastActivity}`}
        >
          {liveness.words}
        </Badge>
        <ChevronRight className="size-[0.95rem] flex-none text-muted-foreground" aria-hidden="true" />
      </span>
    </button>
  );
}

/**
 * The session's goal off its transcript read: the words once read, a spinner while the read is in flight, a staleness
 * mark when it failed or when a kept transcript is standing over a failed re-read.
 *
 * @param state the transcript read's state; `undefined` when the seat carried no session id, so there is no read
 * @returns the goal
 */
function Goal({ state }: { state: SessionTurnViewState | undefined }): ReactElement {
  if (state === undefined) {
    return <p className="m-0 text-[0.8rem] text-muted-foreground">no transcript to take it from</p>;
  }
  if (state.phase === "loading") {
    return <ReadingIndicator label="Reading the session's goal" />;
  }
  if (state.phase === "not-measured") {
    return <StaleMark facts={[{ subject: "the session's goal", why: state.why }]} />;
  }
  return (
    <p className="m-0 text-[0.8rem] wrap-anywhere whitespace-pre-wrap">
      {goalWords({ prompt: state.turn.prompt })}
      {state.stale !== undefined && (
        <>
          {" "}
          <StaleMark
            facts={[{ observedAtIso: state.observedAtIso, subject: "the session's goal", why: state.stale }]}
          />
        </>
      )}
    </p>
  );
}

/**
 * The column beside a session's transcript, the Queue card's label/value grid: the kept properties, then the goal off
 * the same transcript read.
 *
 * @param state the transcript read's state, which the goal is taken from; `undefined` when there is no read at all
 * @param nowMs the page's clock, which ages the activity properties
 * @returns the column's content
 */
function SessionProperties({
  card,
  state,
  nowMs,
}: {
  card: WorkingSessionCard;
  state: SessionTurnViewState | undefined;
  nowMs: number;
}): ReactElement {
  return (
    <>
      <section data-session-properties="">
        <dl className="m-0 grid grid-cols-[6.2rem_1fr] gap-x-2 gap-y-[0.45rem]">
          {sessionPropertiesOf({ card, nowMs }).map((property) => (
            <PropertyLine key={property.label} label={property.label}>
              {property.value}
            </PropertyLine>
          ))}
        </dl>
      </section>
      <section className={SLIDE_SECTION}>
        <h4>Goal</h4>
        <Goal state={state} />
      </section>
    </>
  );
}

/** One label/value line of the properties grid, the value a chip the way the Queue card's column draws one. */
function PropertyLine({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <>
      <dt className="text-[0.72rem] text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-[0.8rem] break-words">
        <span className="rounded-[5px] border border-border bg-muted px-[0.35rem] py-[0.02rem] text-[0.74rem]">
          {children}
        </span>
      </dd>
    </>
  );
}

/**
 * One working session opened: its transcript, read once, with its properties in a sticky column beside it. A seat
 * the reading carried no Claude Code session id for still opens, and says why there is no transcript — never a guess by
 * worktree.
 *
 * @param nowMs the page's clock, which ages the properties and the header's badge
 * @returns the panel
 */
function SessionPanel({
  card,
  nowMs,
  onClose,
}: {
  card: WorkingSessionCard;
  nowMs: number;
  onClose: () => void;
}): ReactElement {
  let body: ReactNode;
  if (card.transcriptId === undefined) {
    body = (
      <div className={SLIDE_BODY_SESSION}>
        <p className="sw-tile-note m-0">
          <strong>NOT MEASURED</strong>: this seat reading did not carry a Claude Code session id, so there is no
          transcript to open
        </p>
        <aside className={SLIDE_ASIDE_STICKY} aria-label="session properties">
          <SessionProperties card={card} nowMs={nowMs} state={undefined} />
        </aside>
      </div>
    );
  } else {
    body = (
      <SessionTurnView
        // keyed by session, so a workspace that moves to another session remounts rather than drawing the old one's
        key={card.transcriptId}
        id={card.transcriptId}
        renderSidebar={({ state }) => <SessionProperties card={card} nowMs={nowMs} state={state} />}
      />
    );
  }
  let icon: ReactElement | undefined;
  if (card.manager) {
    icon = <SessionGlyph manager />;
  }
  return (
    <SlideOver
      icon={icon}
      label={`Session: ${card.title}`}
      meta={livenessOf({ nowMs, seat: card.seat }).words}
      onClose={onClose}
      title={card.title}
    >
      {body}
    </SlideOver>
  );
}

/**
 * Every working session, one Queue card each under the Queue's own section heading, the supervisor pinned first; and
 * the open one's panel.
 *
 * @param openedKey the workspace id of the open card, when one is open
 * @param latestReadCurrent whether the seats' latest read answered, the only reading an empty state may stand on
 * @returns the list
 */
export function WorkingSessions({
  view,
  openedKey,
  latestReadCurrent,
  onOpen,
  onClose,
}: {
  view: WorkingSessionsView;
  latestReadCurrent: boolean;
  openedKey: string | undefined;
  onOpen: (card: WorkingSessionCard) => void;
  onClose: () => void;
}): ReactElement {
  const nowMs = useNow({ everyMs: LIVENESS_TICK_MS });
  const opened = view.cards.find((card) => card.key === openedKey);
  return (
    <>
      {view.cards.length === 0 && !latestReadCurrent && (
        <p className="sw-tile-note">no session was working as of the last reading that answered</p>
      )}
      {view.cards.length === 0 && latestReadCurrent && (
        <PageEmpty
          title="Working sessions will appear here."
          appearsWhen="A session appears while the supervisor or another visible agent is actively working."
          action={{ kind: "plans" }}
          surface="fleet"
        />
      )}
      {view.cards.length > 0 && (
        <div className="mt-[0.6rem] overflow-hidden rounded-xl border border-border" data-working-sessions="">
          <h3 className={SECTION_HEAD}>
            Working now · <b>{String(view.cards.length)}</b>
          </h3>
          {view.cards.map((card, index) => (
            <SessionCardButton
              card={card}
              current={card.key === openedKey}
              key={card.key}
              nowMs={nowMs}
              number={index + 1}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
      {opened !== undefined && <SessionPanel card={opened} nowMs={nowMs} onClose={onClose} />}
    </>
  );
}
