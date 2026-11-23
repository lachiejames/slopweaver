import { describe, expect, it } from "vitest";

import {
  FRONT_APP_BAND_START,
  type FrontAppBandApp,
  type FrontAppBandState,
  parseMessengerOpen,
  reportedMessengerOpen,
  settledFrontAppBand,
} from "../../src/frontAppBand";

const slackRead = { app: "Slack", bundleId: "com.tinyspeck.slackmacgap", title: "general" };
const slack: FrontAppBandApp = { ...slackRead, kind: "app" };
const open: FrontAppBandState = { epoch: 1, lastExternal: undefined, open: true };

describe("reportedMessengerOpen", () => {
  it("starts a new epoch on opening", () => {
    expect(reportedMessengerOpen({ open: true, state: FRONT_APP_BAND_START })).toEqual(open);
  });

  it("changes nothing on a repeated report", () => {
    expect(reportedMessengerOpen({ open: true, state: open })).toBe(open);
  });

  it("forgets the application on closing", () => {
    expect(reportedMessengerOpen({ open: false, state: { ...open, lastExternal: slack } })).toEqual({
      epoch: 2,
      lastExternal: undefined,
      open: false,
    });
  });
});

describe("parseMessengerOpen", () => {
  it("reads exactly { open: boolean }", () => {
    expect(parseMessengerOpen({ value: { open: true } })).toBe(true);
    expect(parseMessengerOpen({ value: { open: false } })).toBe(false);
  });

  it.each([[undefined], [null], ["open"], [{}], [{ open: "yes" }], [{ extra: 1, open: true }]])(
    "refuses %j",
    (value) => {
      expect(parseMessengerOpen({ value })).toBeUndefined();
    },
  );
});

describe("settledFrontAppBand", () => {
  it("answers another application and keeps it", () => {
    expect(settledFrontAppBand({ front: "external", read: slackRead, startedEpoch: 1, state: open })).toEqual({
      reply: slack,
      state: { ...open, lastExternal: slack },
    });
  });

  it("answers the kept application as the one before the messenger while the messenger itself is in front", () => {
    const state = { ...open, lastExternal: slack };
    const voiceFront = { app: "Slopweaver", bundleId: "app.slopweaver", title: null };
    expect(settledFrontAppBand({ front: "voice", read: voiceFront, startedEpoch: 1, state })).toEqual({
      reply: { ...slackRead, kind: "behind" },
      state,
    });
  });

  it("answers the console while the messenger is in front and nothing is kept", () => {
    const voiceFront = { app: "Slopweaver", bundleId: "app.slopweaver", title: null };
    expect(settledFrontAppBand({ front: "voice", read: voiceFront, startedEpoch: 1, state: open }).reply).toEqual({
      kind: "console",
    });
  });

  it("answers the console over a kept application once the console window is in front", () => {
    const state = { ...open, lastExternal: slack };
    const consoleFront = { app: "Slopweaver", bundleId: "app.slopweaver", title: "Queue" };
    expect(settledFrontAppBand({ front: "console", read: consoleFront, startedEpoch: 1, state })).toEqual({
      reply: { kind: "console" },
      state: open,
    });
  });

  it("drops a read begun under an earlier opening, keeping nothing of it", () => {
    const reopened: FrontAppBandState = { epoch: 3, lastExternal: undefined, open: true };
    expect(settledFrontAppBand({ front: "external", read: slackRead, startedEpoch: 1, state: reopened })).toEqual({
      reply: { why: "the messenger closed while the front window was read" },
      state: reopened,
    });
  });

  it("passes on why the front window could not be read", () => {
    expect(
      settledFrontAppBand({ front: "external", read: { why: "the screen is locked" }, startedEpoch: 1, state: open }),
    ).toEqual({ reply: { why: "the screen is locked" }, state: open });
  });

  it("keeps nothing for a read while the messenger is closed", () => {
    const closed: FrontAppBandState = { epoch: 2, lastExternal: undefined, open: false };
    expect(settledFrontAppBand({ front: "external", read: slackRead, startedEpoch: 2, state: closed }).state).toBe(
      closed,
    );
  });
});
