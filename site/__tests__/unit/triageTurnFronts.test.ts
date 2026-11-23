/*
 * The card in front of the owner as each of the model's answers began, which a triage ruling in that answer binds to
 * (two answers running side by side cannot be ordered by their ids).
 */
import { describe, expect, it } from "vitest";

import { TriageTurnFronts } from "../../lib/triageTurnFronts";
import { markTriageOpened, nextTriageCard, startTriageWalk } from "../../lib/triageWalk";
import type { TriageWalk, TriageWalkRow } from "../../lib/triageWalkTypes";

const WALK = "5d2e8a41-7c3b-4f60-9e1d-2a7b8c9d0e1f";

const ROWS: readonly TriageWalkRow[] = [1, 2].map((n) => ({
  fingerprint: `fp-${String(n)}`,
  key: `act:ev-${String(n)}`,
  kind: "act",
  section: "fleet-blocked",
  tier: "fleet-blocked",
}));

/**
 * A pass with one card put up, `${WALK}-1`.
 *
 * @param opened whether its open has finished
 * @returns the pass
 */
function oneCard({ opened }: { opened: boolean }): TriageWalk {
  const walk = nextTriageCard({
    focus: [],
    nowMs: 0,
    rows: ROWS,
    walk: startTriageWalk({ focus: [], nowMs: 0, rows: ROWS, walkId: WALK }),
  }).walk;
  if (!opened) {
    return walk;
  }
  return markTriageOpened({ visitId: walk.current!.visitId, walk });
}

describe("TriageTurnFronts", () => {
  it("answers the opened card in front of the owner as each answer began, and none for one on no card or no pass", () => {
    const fronts = new TriageTurnFronts();
    const started = startTriageWalk({ focus: [], nowMs: 0, rows: ROWS, walkId: WALK });
    fronts.started({ turnId: "t-1", walk: oneCard({ opened: true }) });
    fronts.started({ turnId: "t-2", walk: started });
    fronts.started({ turnId: "t-3", walk: undefined });
    expect([
      fronts.frontOf({ answerId: "t-1" }),
      fronts.frontOf({ answerId: "t-2" }),
      fronts.frontOf({ answerId: "t-3" }),
    ]).toEqual([
      { seen: true, visitId: `${WALK}-1` },
      { seen: true, visitId: undefined },
      { seen: true, visitId: undefined },
    ]);
  });

  it("notes no card for an answer that began while the card was still opening, though the open finishes after", () => {
    const fronts = new TriageTurnFronts();
    fronts.started({ turnId: "t-1", walk: oneCard({ opened: false }) });
    fronts.started({ turnId: "t-2", walk: oneCard({ opened: true }) });
    expect([fronts.frontOf({ answerId: "t-1" }), fronts.frontOf({ answerId: "t-2" })]).toEqual([
      { seen: true, visitId: undefined },
      { seen: true, visitId: `${WALK}-1` },
    ]);
  });

  it("says unseen for an answer it never heard begin, and for a call naming no answer", () => {
    const fronts = new TriageTurnFronts();
    fronts.started({ turnId: "t-1", walk: oneCard({ opened: true }) });
    expect([fronts.frontOf({ answerId: "t-9" }), fronts.frontOf({ answerId: undefined })]).toEqual([
      { seen: false },
      { seen: false },
    ]);
  });

  it("keeps what the first start saw when the same answer's start is heard again", () => {
    const fronts = new TriageTurnFronts();
    fronts.started({ turnId: "t-1", walk: oneCard({ opened: true }) });
    fronts.started({ turnId: "t-1", walk: undefined });
    expect(fronts.frontOf({ answerId: "t-1" })).toEqual({ seen: true, visitId: `${WALK}-1` });
  });

  // A forgotten answer once read as unheard, and its replayed start noted the card up by then.
  it("never forgets an answer, so a replayed start after many later ones keeps the no-card it first saw", () => {
    const fronts = new TriageTurnFronts();
    fronts.started({ turnId: "t-0", walk: oneCard({ opened: false }) });
    const walk = oneCard({ opened: true });
    for (let at = 1; at <= 200; at += 1) {
      fronts.started({ turnId: `t-${String(at)}`, walk });
    }
    fronts.started({ turnId: "t-0", walk });
    expect([
      fronts.frontOf({ answerId: "t-0" }),
      fronts.frontOf({ answerId: "t-1" }),
      fronts.frontOf({ answerId: "t-never" }),
    ]).toEqual([{ seen: true, visitId: undefined }, { seen: true, visitId: `${WALK}-1` }, { seen: false }]);
  });
});
