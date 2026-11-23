import { describe, expect, it } from "vitest";

import { censusAge } from "../../../../datadog/detective/censusAge.js";

const HOUR = 60 * 60 * 1000;

const manifest = {
  builtAtIso: "2026-09-16T00:19:11.000Z",
  retentionDays: 15,
  window: { fromIso: "2026-09-08T23:19:16.000Z", toIso: "2026-09-15T23:19:16.000Z" },
};
const built = Date.parse(manifest.builtAtIso);

describe("censusAge", () => {
  it("calls a census inside its rebuild window fresh and still states its age and window", () => {
    const age = censusAge({ manifest, nowMs: built + 16 * HOUR, staleAfterMs: 24 * HOUR });
    expect(age.state).toBe("fresh");
    expect(age.line).toBe(
      "Datadog census built 16.0h ago (measured 2026-09-08T23:19:16.000Z .. 2026-09-15T23:19:16.000Z)",
    );
  });

  it("calls a census past its rebuild window stale and says a miss proves nothing", () => {
    const age = censusAge({ manifest, nowMs: built + 30 * HOUR, staleAfterMs: 24 * HOUR });
    expect(age.state).toBe("stale");
    expect(age.line).toContain("past its 1d rebuild window");
    expect(age.line).toContain("a miss proves nothing");
  });

  it("calls a census expired once its window's start leaves the log retention", () => {
    const nowMs = Date.parse(manifest.window.fromIso) + 15 * 24 * HOUR + 1;
    const age = censusAge({ manifest, nowMs, staleAfterMs: 24 * HOUR });
    expect(age.state).toBe("expired");
    expect(age.line).toContain("left the 15-day log retention");
  });

  it("never expires a census whose indexes reported no retention, judging it on age alone", () => {
    const nowMs = built + 60 * 24 * HOUR;
    const age = censusAge({ manifest: { ...manifest, retentionDays: null }, nowMs, staleAfterMs: 24 * HOUR });
    expect(age.state).toBe("stale");
  });

  it("reads a zero age rather than a negative one when the clock is behind the build", () => {
    const age = censusAge({ manifest, nowMs: built - HOUR, staleAfterMs: 24 * HOUR });
    expect(age.ageMs).toBe(0);
    expect(age.state).toBe("fresh");
  });
});
