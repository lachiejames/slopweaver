import { describe, expect, it } from "vitest";

import { savedOutlived, savedReadingDraw } from "../../lib/savedReadingDraw";

describe("where a reading saved by an earlier console process is drawn", () => {
  it("fills a live channel still waiting on its first read", () => {
    expect(savedReadingDraw({ channel: { hasLast: false }, delivered: 0, pressed: 0, retained: false })).toBe(
      "channel",
    );
  });

  it("leaves a live channel that already holds a reading alone", () => {
    expect(savedReadingDraw({ channel: { hasLast: true }, delivered: 0, pressed: 0, retained: false })).toBe("drop");
  });

  it("is kept for the next mount when no channel is alive and nothing is retained", () => {
    expect(savedReadingDraw({ channel: undefined, delivered: 0, pressed: 0, retained: false })).toBe("retained");
  });

  it("never displaces a reading this page retained", () => {
    expect(savedReadingDraw({ channel: undefined, delivered: 0, pressed: 0, retained: true })).toBe("drop");
  });

  it("is dropped once this page delivered an answer for the key, even with the channel since torn down", () => {
    expect(savedReadingDraw({ channel: undefined, delivered: 1, pressed: 0, retained: false })).toBe("drop");
  });

  it("is dropped over an empty channel whose answer already landed and was cleared", () => {
    expect(savedReadingDraw({ channel: { hasLast: false }, delivered: 2, pressed: 0, retained: false })).toBe("drop");
  });

  it("is dropped for a key pressed on this page, so a reading from before the write never comes back", () => {
    expect(savedReadingDraw({ channel: { hasLast: false }, delivered: 0, pressed: 1, retained: false })).toBe("drop");
  });

  it("is dropped for a key pressed with no channel alive", () => {
    expect(savedReadingDraw({ channel: undefined, delivered: 0, pressed: 1, retained: false })).toBe("drop");
  });
});

describe("what a successful answer that just landed does to the key's saved reading", () => {
  const saved = { reading: "saved by the last process" };
  const failure = { reading: "a fetch that never reached its verb" };
  const NOTHING = {
    clearLiveAnswered: false,
    clearOnAnswered: false,
    forgetRetained: false,
    replaceLive: false,
    settled: false,
  };
  const SETTLED_ONLY = { ...NOTHING, settled: true };
  const holding = ({ last, answered }: { last: object | undefined; answered: object | undefined }) => ({
    answered,
    last,
  });

  it("forgets the saved reading a torn-down channel left in the retained register", () => {
    expect(
      savedOutlived({
        answered: true,
        onAnswered: undefined,
        otherLive: undefined,
        retained: holding({ answered: undefined, last: saved }),
        saved,
      }),
    ).toEqual({ ...SETTLED_ONLY, forgetRetained: true });
  });

  it("forgets a retained entry holding the saved reading under a later failure", () => {
    expect(
      savedOutlived({
        answered: true,
        onAnswered: undefined,
        otherLive: undefined,
        retained: holding({ answered: saved, last: failure }),
        saved,
      }),
    ).toEqual({ ...SETTLED_ONLY, forgetRetained: true });
  });

  it("replaces the saved reading a remount carried into a new live channel before the answer landed", () => {
    expect(
      savedOutlived({
        answered: true,
        onAnswered: undefined,
        otherLive: holding({ answered: undefined, last: saved }),
        retained: undefined,
        saved,
      }),
    ).toEqual({ ...SETTLED_ONLY, replaceLive: true });
  });

  it("replaces it in a live channel that drew it, and empties that channel's last answered slot first", () => {
    expect(
      savedOutlived({
        answered: true,
        onAnswered: undefined,
        otherLive: holding({ answered: saved, last: saved }),
        retained: undefined,
        saved,
      }),
    ).toEqual({ ...SETTLED_ONLY, clearLiveAnswered: true, replaceLive: true });
  });

  it("replaces it in a live channel whose own fetch failed over it, leaving it as the last answered reading", () => {
    expect(
      savedOutlived({
        answered: true,
        onAnswered: undefined,
        otherLive: holding({ answered: saved, last: failure }),
        retained: undefined,
        saved,
      }),
    ).toEqual({ ...SETTLED_ONLY, clearLiveAnswered: true, replaceLive: true });
  });

  it("empties the last answered slot of the channel the answer landed on when it is the saved reading", () => {
    expect(
      savedOutlived({ answered: true, onAnswered: saved, otherLive: undefined, retained: undefined, saved }),
    ).toEqual({ ...SETTLED_ONLY, clearOnAnswered: true });
  });

  it("leaves a reading this page kept, even one with the same contents, and still settles", () => {
    const kept = { reading: "saved by the last process" };
    expect(
      savedOutlived({
        answered: true,
        onAnswered: kept,
        otherLive: holding({ answered: kept, last: kept }),
        retained: holding({ answered: kept, last: kept }),
        saved,
      }),
    ).toEqual(SETTLED_ONLY);
  });

  it("keeps tracking the saved reading when nothing successful landed, so it is drawn stale beneath the failure", () => {
    expect(
      savedOutlived({
        answered: false,
        onAnswered: saved,
        otherLive: holding({ answered: saved, last: saved }),
        retained: holding({ answered: undefined, last: saved }),
        saved,
      }),
    ).toEqual(NOTHING);
  });

  it("has nothing to clear when no saved reading was admitted", () => {
    expect(
      savedOutlived({
        answered: true,
        onAnswered: saved,
        otherLive: holding({ answered: saved, last: saved }),
        retained: holding({ answered: saved, last: saved }),
        saved: undefined,
      }),
    ).toEqual(NOTHING);
  });
});
