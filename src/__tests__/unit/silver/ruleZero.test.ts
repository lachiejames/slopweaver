import { describe, expect, it } from "vitest";
import { applyRuleZero, DEFAULT_THRESHOLD_HOURS, hoursBetween, isOnTheList } from "../../../silver/ruleZero.js";

const NOW = "2026-08-30T00:00:00.000Z";

/** An instant `hours` before {@link NOW}. */
const hoursAgo = ({ hours }: { hours: number }): string => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

describe("hoursBetween", () => {
  it("floors to whole hours", () => {
    expect(hoursBetween({ fromIso: "2026-08-29T22:30:00.000Z", toIso: NOW })).toBe(1);
  });

  it("returns zero for the same instant", () => {
    expect(hoursBetween({ fromIso: NOW, toIso: NOW })).toBe(0);
  });

  it("clamps a future last-movement to zero rather than reporting a negative age", () => {
    expect(hoursBetween({ fromIso: "2026-08-31T00:00:00.000Z", toIso: NOW })).toBe(0);
  });

  it("returns undefined for an unparseable from", () => {
    expect(hoursBetween({ fromIso: "not a date", toIso: NOW })).toBeUndefined();
  });

  it("returns undefined for an unparseable to", () => {
    expect(hoursBetween({ fromIso: NOW, toIso: "not a date" })).toBeUndefined();
  });
});

describe("applyRuleZero", () => {
  it("shows an item that is the owner's own move", () => {
    const decision = applyRuleZero({ lastMovedIso: hoursAgo({ hours: 5 }), move: { party: "owner" }, nowIso: NOW });
    expect(decision.verdict).toBe("show");
    expect(decision.reason).toBe("waiting on you");
    expect(decision.silentHours).toBe(5);
    expect(decision.chase).toBeUndefined();
  });

  it("suppresses an item sitting with somebody else inside the threshold", () => {
    const decision = applyRuleZero({
      lastMovedIso: hoursAgo({ hours: 12 }),
      move: { party: "other", who: "a-teammate" },
      nowIso: NOW,
    });
    expect(decision.verdict).toBe("suppress");
    expect(decision.reason).toBe("sitting with a-teammate for 12h");
    expect(decision.chase).toBeUndefined();
  });

  it("still suppresses one hour short of the threshold", () => {
    const decision = applyRuleZero({
      lastMovedIso: hoursAgo({ hours: DEFAULT_THRESHOLD_HOURS - 1 }),
      move: { party: "other", who: "a-teammate" },
      nowIso: NOW,
    });
    expect(decision.verdict).toBe("suppress");
    expect(decision.silentHours).toBe(47);
  });

  it("chases exactly at the threshold, naming the person", () => {
    const decision = applyRuleZero({
      lastMovedIso: hoursAgo({ hours: DEFAULT_THRESHOLD_HOURS }),
      move: { party: "other", who: "a-teammate" },
      nowIso: NOW,
    });
    expect(decision.verdict).toBe("chase");
    expect(decision.chase).toBe("a-teammate");
    expect(decision.reason).toBe("a-teammate has had this for 48h with no movement");
  });

  it("chases past the threshold", () => {
    const decision = applyRuleZero({
      lastMovedIso: hoursAgo({ hours: 120 }),
      move: { party: "other", who: "a-teammate" },
      nowIso: NOW,
    });
    expect(decision.verdict).toBe("chase");
    expect(decision.silentHours).toBe(120);
  });

  it("honours a caller-supplied threshold, so 24 is one edit rather than a redesign", () => {
    const decision = applyRuleZero({
      lastMovedIso: hoursAgo({ hours: 30 }),
      move: { party: "other", who: "a-teammate" },
      nowIso: NOW,
      thresholdHours: 24,
    });
    expect(decision.verdict).toBe("chase");
  });

  it("shows an item nobody has been asked about yet", () => {
    const decision = applyRuleZero({
      lastMovedIso: hoursAgo({ hours: 3 }),
      move: { ownerAlreadyActed: false, party: "nobody" },
      nowIso: NOW,
    });
    expect(decision.verdict).toBe("show");
    expect(decision.reason).toBe("nobody has been asked yet");
  });

  it("suppresses an item with no reviewer that the owner has already acted on — the re-queued PR", () => {
    const decision = applyRuleZero({
      lastMovedIso: hoursAgo({ hours: 3 }),
      move: { ownerAlreadyActed: true, party: "nobody" },
      nowIso: NOW,
    });
    expect(decision.verdict).toBe("suppress");
    expect(decision.reason).toBe("you have already acted; nobody else has been asked yet");
  });

  it("suppresses rather than chases when the last movement has no readable date", () => {
    const decision = applyRuleZero({
      lastMovedIso: "whenever",
      move: { party: "other", who: "a-teammate" },
      nowIso: NOW,
    });
    expect(decision.verdict).toBe("suppress");
    expect(decision.reason).toBe("sitting with a-teammate, and its last movement has no readable date");
    expect(decision.silentHours).toBe(0);
  });

  it("never chases on a future timestamp, which would otherwise floor to a huge age", () => {
    const decision = applyRuleZero({
      lastMovedIso: "2026-09-30T00:00:00.000Z",
      move: { party: "other", who: "a-teammate" },
      nowIso: NOW,
    });
    expect(decision.verdict).toBe("suppress");
    expect(decision.silentHours).toBe(0);
  });
});

describe("isOnTheList", () => {
  it("includes a show", () => {
    expect(isOnTheList({ decision: { reason: "waiting on you", silentHours: 1, verdict: "show" } })).toBe(true);
  });

  it("includes a chase, which is the one a caller re-deriving this would forget", () => {
    expect(isOnTheList({ decision: { chase: "x", reason: "r", silentHours: 60, verdict: "chase" } })).toBe(true);
  });

  it("excludes a suppress", () => {
    expect(isOnTheList({ decision: { reason: "r", silentHours: 2, verdict: "suppress" } })).toBe(false);
  });
});
