/*
 * The now page's join: every seat in exactly one of three bands off a same-tick, observed reconcile reading —
 * no seat is ever "asked you", whatever its signal or its row's standing — and the signal-only view, naming
 * why, whenever the join cannot be trusted.
 */
import { describe, expect, it } from "vitest";

import type { Reading } from "../../components/live/reading";
import type { Seat, Seats } from "../../components/live/readNow";
import type { Placed, RankedRow } from "../../components/live/readWorkstreams";
import { boardGapLine, joinGapWords, nowSeatsOf, type ReconcilePlacements } from "../../lib/nowSeats";

/** A seat as `session watch` prints one, mapped to `workspace:<n>`. */
const seat = ({ ref, signal }: { ref: string | undefined; signal: string }): Seat => ({
  attentionKind: undefined,
  cwd: `/w/${String(ref)}`,
  host: "claude",
  lastActivityAtIso: undefined,
  lastEventName: "agent.hook.Stop",
  manager: undefined,
  mapped: ref !== undefined,
  openedAtIso: undefined,
  quietMinutes: 3,
  sessionId: undefined,
  sessionTitle: undefined,
  signal,
  title: `title ${String(ref)}`,
  toolCalls: 7,
  workspaceId: `id-${String(ref)}`,
  workspaceRef: ref,
});

/** A board row standing where the test says. */
const row = ({ id, standing }: { id: string; standing: string | undefined }): RankedRow => ({
  groomed: true,
  id,
  kind: "doc",
  label: `doing ${id}`,
  openedIso: undefined,
  priority: "p1",
  ready: false,
  standing,
  waitingHours: 0,
});

/** One placement of a session on a row. */
const placed = ({ session, id, standing }: { session: string; id: string; standing: string | undefined }): Placed => ({
  rank: 1,
  row: row({ id, standing }),
  session,
});

/** A reading envelope as `reading last` prints it. */
const reading = <T>({
  by,
  value,
  observedAtIso = "2026-09-24T11:46:29.195Z",
}: {
  by: string;
  value: T;
  observedAtIso?: string;
}): Reading<T> => ({
  by,
  observedAtIso,
  readingId: `r-${by}`,
  recordedAtIso: "2026-09-24T11:46:29.195Z",
  value,
});

/** A seats reading holding these rows. */
const seats = ({ rows, by = "tick-1" }: { rows: readonly Seat[]; by?: string }): Reading<Seats> =>
  reading({
    by,
    value: {
      diagnostics: [],
      observedAtIso: "2026-09-24T11:46:29.195Z",
      rows,
      suppressed: 0,
      suppressedOldestQuietMinutes: undefined,
    },
  });

/** A reconcile reading placing these sessions, observed 55s after the seats by default — a real tick's gap. */
const reconcile = ({
  aligned = [],
  misaligned = [],
  unprioritised = [],
  fleet = "observed",
  by = "tick-1",
  observedAtIso = "2026-09-24T11:47:24.195Z",
}: {
  aligned?: readonly Placed[];
  misaligned?: readonly Placed[];
  unprioritised?: readonly Placed[];
  fleet?: string | undefined;
  by?: string;
  observedAtIso?: string;
}): Reading<ReconcilePlacements> =>
  reading({ by, observedAtIso, value: { aligned, fleet, misaligned, unprioritised } });

const WORKING = seat({ ref: "workspace:1", signal: "working" });
const ASKED = seat({ ref: "workspace:2", signal: "needs-input" });
const BETWEEN = seat({ ref: "workspace:3", signal: "needs-input" });
const LOOSE = seat({ ref: "workspace:4", signal: "idle" });

const P_WORKING = placed({ id: "row-working", session: "workspace:1", standing: "in-flight" });
const P_ASKED = placed({ id: "row-asked", session: "workspace:2", standing: "waiting-on-owner" });
const P_BETWEEN = placed({ id: "row-between", session: "workspace:3", standing: "in-flight" });

describe("nowSeatsOf", () => {
  it("puts each seat in exactly one band, in the seats reading's own order", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ aligned: [P_WORKING], misaligned: [P_ASKED, P_BETWEEN] }),
      seatReading: seats({ rows: [WORKING, ASKED, BETWEEN, LOOSE] }),
    });
    expect(view).toEqual({
      betweenTurns: [
        { placement: P_ASKED, seat: ASKED },
        { placement: P_BETWEEN, seat: BETWEEN },
      ],
      kind: "joined",
      notOnBoard: [{ placement: undefined, seat: LOOSE }],
      working: [{ placement: P_WORKING, seat: WORKING }],
    });
  });

  it("files a stopped seat on a row waiting on the owner between turns — close-done's to park, never a band", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ misaligned: [P_ASKED] }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view).toEqual({
      betweenTurns: [{ placement: P_ASKED, seat: ASKED }],
      kind: "joined",
      notOnBoard: [],
      working: [],
    });
  });

  it("files a working seat whose row waits on the owner under working", () => {
    const busy = seat({ ref: "workspace:2", signal: "working" });
    const view = nowSeatsOf({
      reconcileReading: reconcile({ misaligned: [P_ASKED] }),
      seatReading: seats({ rows: [busy] }),
    });
    expect(view).toEqual({
      betweenTurns: [],
      kind: "joined",
      notOnBoard: [],
      working: [{ placement: P_ASKED, seat: busy }],
    });
  });

  it("files an unmapped seat and an unplaced ref under not on the board, inventing no placement", () => {
    const unmapped = seat({ ref: undefined, signal: "needs-input" });
    const view = nowSeatsOf({
      reconcileReading: reconcile({ aligned: [P_WORKING] }),
      seatReading: seats({ rows: [unmapped, LOOSE] }),
    });
    expect(view).toEqual({
      betweenTurns: [],
      kind: "joined",
      notOnBoard: [
        { placement: undefined, seat: unmapped },
        { placement: undefined, seat: LOOSE },
      ],
      working: [],
    });
  });

  it("falls back to working and stopped when no reconcile reading is in", () => {
    const view = nowSeatsOf({ reconcileReading: undefined, seatReading: seats({ rows: [WORKING, ASKED, LOOSE] }) });
    expect(view).toEqual({ kind: "signal-only", reason: "no-reconcile", stopped: [ASKED, LOOSE], working: [WORKING] });
  });

  it("refuses to join readings from two different ticks", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ by: "tick-1", misaligned: [P_ASKED] }),
      seatReading: seats({ by: "tick-2", rows: [ASKED] }),
    });
    expect(view).toEqual({ kind: "signal-only", reason: "different-tick", stopped: [ASKED], working: [] });
  });

  it("refuses a reused tick label whose reconcile was observed a day before the seats", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ misaligned: [P_ASKED], observedAtIso: "2026-09-23T11:47:24.195Z" }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view).toEqual({ kind: "signal-only", reason: "different-tick", stopped: [ASKED], working: [] });
  });

  it("names an unreadable instant rather than calling it another tick", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ misaligned: [P_ASKED], observedAtIso: "not-an-iso-date" }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view).toEqual({ kind: "signal-only", reason: "unreadable-instant", stopped: [ASKED], working: [] });
  });

  it("refuses a same-label reconcile observed more than ten minutes after the seats", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ misaligned: [P_ASKED], observedAtIso: "2026-09-24T11:56:29.196Z" }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view).toEqual({ kind: "signal-only", reason: "different-tick", stopped: [ASKED], working: [] });
  });

  it("joins a reconcile observed exactly ten minutes after the seats", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ misaligned: [P_ASKED], observedAtIso: "2026-09-24T11:56:29.195Z" }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view.kind).toBe("joined");
  });

  it("refuses a reconcile reading that did not observe the fleet", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ fleet: "unavailable", misaligned: [P_ASKED] }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view).toEqual({ kind: "signal-only", reason: "fleet-not-observed", stopped: [ASKED], working: [] });
  });

  it("refuses a reconcile reading too old to carry a row's standing", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ misaligned: [placed({ id: "old", session: "workspace:2", standing: undefined })] }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view).toEqual({ kind: "signal-only", reason: "standing-missing", stopped: [ASKED], working: [] });
  });

  it("refuses a standing word the board does not compose", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({ misaligned: [placed({ id: "odd", session: "workspace:2", standing: "parked" })] }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view).toEqual({ kind: "signal-only", reason: "standing-unknown", stopped: [ASKED], working: [] });
  });

  it("refuses a reading that places one seat on two rows", () => {
    const view = nowSeatsOf({
      reconcileReading: reconcile({
        aligned: [P_ASKED],
        misaligned: [placed({ id: "again", session: "workspace:2", standing: "in-flight" })],
      }),
      seatReading: seats({ rows: [ASKED] }),
    });
    expect(view).toEqual({ kind: "signal-only", reason: "duplicate-placement", stopped: [ASKED], working: [] });
  });

  it("joins an empty fleet into three empty bands", () => {
    const view = nowSeatsOf({ reconcileReading: reconcile({}), seatReading: seats({ rows: [] }) });
    expect(view).toEqual({ betweenTurns: [], kind: "joined", notOnBoard: [], working: [] });
  });
});

describe("joinGapWords", () => {
  it("names an unknown standing as unknown, never as an old reading", () => {
    expect(joinGapWords({ reason: "standing-unknown" })).toBe(
      "the board reading names a row standing this page does not know",
    );
  });

  it("names a different tick in a reader's words", () => {
    expect(joinGapWords({ reason: "different-tick" })).toBe(
      "the board reading is from a different tick than the seats",
    );
  });
});

describe("boardGapLine", () => {
  it("words a held reading's own reason for refusing the join", () => {
    expect(boardGapLine({ reason: "different-tick" })).toBe(
      "Not joined to the board: the board reading is from a different tick than the seats. Seats read working or stopped only.",
    );
  });
});
