/*
 * The look receipts `browser open` and `browser read` print: every line in order, with the viewport line present
 * when the look took a picture and absent when it did not.
 */
import { describe, expect, it } from "vitest";

import type { InteractionSession, PageObservation } from "../../../../../browser/interactionSession.js";
import { renderObservation, renderOpened } from "../../../../../cli/commands/browser/lookReceipt.js";

const SESSION: InteractionSession = {
  clientSession: "client-1",
  id: "s-1",
  openedAtIso: "2026-09-16T00:00:00.000Z",
  origins: ["https://app.acme.example"],
  owner: null,
  ownerSessionId: "agent-1",
  placement: "background",
  touchedAtIso: "2026-09-16T00:00:00.000Z",
  workspace: "/w/s-1",
};

const OBSERVATION: PageObservation = {
  id: "obs-1",
  observedAtIso: "2026-09-16T00:00:00.000Z",
  screenshotPath: "/w/s-1/look.png",
  snapshotPath: "/w/s-1/snapshot.yml",
  title: "Settings",
  url: "https://app.acme.example/settings",
};

describe("renderOpened", () => {
  it("names the session, the page, the picture and the observation, then how to end the session", () => {
    expect(renderOpened({ observation: OBSERVATION, session: SESSION })).toEqual([
      "browser open: session s-1 on https://app.acme.example/settings",
      "  title: Settings",
      "  on screen: /w/s-1/look.png — the viewport, as you would see it",
      "  observation: obs-1",
      "  every later command names --session s-1; `browser close --session s-1` ends it",
    ]);
  });
});

describe("renderObservation", () => {
  it("prints no viewport line for a look that carried no picture", () => {
    expect(renderObservation({ observation: { ...OBSERVATION, screenshotPath: null } })).toEqual([
      "browser read: https://app.acme.example/settings",
      "  title: Settings",
      "  observation: obs-1",
      "  aim an action with --target <ref> --observation obs-1",
    ]);
  });
});
