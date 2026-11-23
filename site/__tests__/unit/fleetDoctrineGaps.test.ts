/**
 * A doctrine line that is not read: its sentence stays whole, and the panel gets the short lead with the console's own
 * reasons apart, so it can fold them rather than run the same reason inline on three lines.
 */
import { describe, expect, it } from "vitest";

import { unreadSentenceOf } from "../../lib/fleetDoctrineGaps";

const WATCH = "session watch reported 11 problems, so a seat it shows may have closed and one it does not may be open";

describe("unreadSentenceOf", () => {
  it("keeps the whole sentence and splits the lead from the console's own reasons", () => {
    expect(
      unreadSentenceOf({
        reasons: [WATCH, "the machine capacity reading is not yet current for this page"],
        subject: "Plan headroom unused",
      }),
    ).toStrictEqual({
      notRead: {
        lead: "Plan headroom unused: not read.",
        reasons: [WATCH, "the machine capacity reading is not yet current for this page"],
      },
      quoted: [],
      sentence: `Plan headroom unused: not read (${WATCH}; the machine capacity reading is not yet current for this page).`,
    });
  });

  it("quotes a read's reason apart and leaves the lead whole when the console named none of its own", () => {
    const read = { lead: "the board did not read", why: "ENOENT: board.json" };
    expect(unreadSentenceOf({ reasons: [read], subject: "Seats working" })).toStrictEqual({
      quoted: [read],
      sentence: "Seats working: not read.",
    });
  });

  it("folds only the console's own reasons when both kinds are named", () => {
    const read = { lead: "the board did not read", why: "ENOENT: board.json" };
    expect(unreadSentenceOf({ reasons: [read, WATCH], subject: "Seats working" })).toStrictEqual({
      notRead: { lead: "Seats working: not read.", reasons: [WATCH] },
      quoted: [read],
      sentence: `Seats working: not read (${WATCH}).`,
    });
  });
});
