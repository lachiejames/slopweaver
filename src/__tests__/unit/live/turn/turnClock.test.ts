import { describe, expect, it } from "vitest";

import { quietClockText, turnClockText, withoutTurnClock } from "../../../../live/turn/turnClock.js";

describe("turnClockText", () => {
  it("names minutes", () => {
    expect(turnClockText({ elapsed: "23m" })).toBe("still working, 23m");
  });

  it("names hours and minutes", () => {
    expect(turnClockText({ elapsed: "1h 12m" })).toBe("still working, 1h 12m");
  });

  it("says under a minute rather than `just now`, which reads as finished", () => {
    expect(turnClockText({ elapsed: "just now" })).toBe("still working, under a minute");
  });
});

describe("withoutTurnClock", () => {
  it("reduces two readings minutes apart to one detail", () => {
    const early = withoutTurnClock({ detail: "now: still working, 5m · independent review, round 1 · open 2m" });
    const late = withoutTurnClock({ detail: "now: still working, 1h 7m · independent review, round 1 · open 2m" });
    expect(early).toBe("now: still working · independent review, round 1 · open 2m");
    expect(late).toBe(early);
  });

  it("finds the clock behind a warn prefix", () => {
    expect(withoutTurnClock({ detail: "warn raised — now: still working, under a minute" })).toBe(
      "warn raised — now: still working",
    );
  });

  it("leaves a detail with no clock byte-identical", () => {
    const detail = "now: still working — 0 tool calls so far";
    expect(withoutTurnClock({ detail })).toBe(detail);
  });
});

describe("quietClockText", () => {
  it("names the wait and the silence, never still working", () => {
    expect(quietClockText({ quiet: "31m", waited: "45m" })).toBe("asked 45m ago, nothing new for 31m");
  });

  it("says no activity is visible when the worker's log shows none", () => {
    expect(quietClockText({ quiet: undefined, waited: "45m" })).toBe("asked 45m ago, no activity visible");
  });

  it("strips to one form, so a quiet card reads unchanged tick to tick and changed from a working one", () => {
    const earlier = withoutTurnClock({ detail: "now: asked 45m ago, nothing new for 31m · Bash" });
    const later = withoutTurnClock({ detail: "now: asked 1h 2m ago, nothing new for 48m · Bash" });
    expect(earlier).toBe("now: asked, quiet · Bash");
    expect(later).toBe(earlier);
    expect(withoutTurnClock({ detail: "now: still working, 12m · Bash" })).toBe("now: still working · Bash");
  });
});
