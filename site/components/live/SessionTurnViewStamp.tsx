/**
 * The two lines above a fleet session's conversation: the stamp saying which session and when it was read, and the
 * control that reads further back.
 */
import { type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { ageOf } from "@/lib/ageOf";
import { type SessionTurn } from "@/lib/sessionTurn";
import { MAX_SESSION_TURNS } from "@/lib/sessionTurnVerb";

import { StaleMark } from "../console/StaleMark";

/**
 * How many turns the next "show earlier" press asks for: ten more, never past what the tail holds or the
 * verb's cap.
 *
 * @returns the count, the latest turn included
 */
function nextTurns({ turn, turns }: { turn: SessionTurn; turns: number }): number {
  return Math.min(MAX_SESSION_TURNS, turn.earlierTurnsInTail + 1, turns + 10);
}

/**
 * The control above the conversation that reads further back, or the line saying why it cannot.
 *
 * @returns the control, or `null` when the tail holds no turn before the latest
 */
export function EarlierTurns({
  turn,
  turns,
  onMore,
}: {
  turn: SessionTurn;
  turns: number;
  onMore: (next: number) => void;
}): ReactElement | null {
  if (turn.earlierTurnsInTail === 0) {
    return null;
  }
  const next = nextTurns({ turn, turns });
  const shown = turn.earlier.length;
  if (next <= turns) {
    return (
      <p className="sw-tile-note">
        showing {String(shown)} earlier turn(s):{" "}
        {turns >= MAX_SESSION_TURNS ? "the most one read carries" : "every one the transcript's tail holds"}
      </p>
    );
  }
  const more = next - 1 - shown;
  return (
    <p className="sw-tile-note">
      <Button
        className="h-auto p-0"
        onClick={() => {
          onMore(next);
        }}
        size="sm"
        type="button"
        variant="link"
      >
        show {String(more)} earlier turn(s)
      </Button>{" "}
      · {String(turn.earlierTurnsInTail)} in the transcript&apos;s tail
    </p>
  );
}

/**
 * The line above the conversation: which session, which model, when it last wrote, and what was left out.
 *
 * @returns the line
 */
export function TurnStamp({
  turn,
  observedAtIso,
  stale,
}: {
  turn: SessionTurn;
  observedAtIso: string;
  stale: string | undefined;
}): ReactElement {
  const wrote = turn.lastTimestamp === "" ? "" : `last wrote ${ageOf({ iso: turn.lastTimestamp })}`;
  const facts = [`session ${turn.sessionId}`, turn.model, wrote];
  return (
    <p className="sw-tile-note">
      {facts.filter((fact) => fact !== "").join(" · ")} · read {ageOf({ iso: observedAtIso })}
      {stale !== undefined && (
        <>
          {" "}
          <StaleMark facts={[{ observedAtIso, subject: "The session's transcript", why: stale }]} />
        </>
      )}{" "}
      · read-only, nothing here sends
      {turn.partsDropped > 0 && ` · ${String(turn.partsDropped)} earlier part(s) not shown`}
      {!turn.turnStartSeen && " · the turn began before the part of the transcript read, so it opens mid-turn"}
    </p>
  );
}
