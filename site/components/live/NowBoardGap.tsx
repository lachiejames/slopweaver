/**
 * The line saying why the agents tile's seats were not joined to the board.
 */
import { type ReactElement } from "react";

import { boardGapLine, type NowJoinGap } from "../../lib/nowSeats";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import type { Reading } from "./reading";
import { type Reconcile } from "./readWorkstreams";
import { type LiveState } from "./useLive";

/**
 * Why the seats were not joined to the board: a spinner while the board reading has not arrived, a staleness mark
 * whose hover carries the route's own sentence when it could not be read, and the refusal's reason in words only
 * when a reading is held and still refused the join.
 *
 * @param board the reconcile reading's channel, as it stands
 * @param reason the join's own refusal
 * @returns the line
 */
export function BoardGap({
  board,
  reason,
}: {
  board: LiveState<Reading<Reconcile>>;
  reason: NowJoinGap;
}): ReactElement {
  if (board.phase === "loading") {
    return <ReadingIndicator label="Reading the board to join the seats to" block />;
  }
  if (board.phase === "not-measured") {
    return (
      <StaleMark
        facts={[
          {
            subject: "the board reading, which places each seat on a row",
            why: `${board.why}, so seats read working or stopped only`,
          },
        ]}
        block
      />
    );
  }
  return <p className="text-[0.8rem] text-muted-foreground">{boardGapLine({ reason })}</p>;
}
