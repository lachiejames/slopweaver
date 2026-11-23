import { describe, expect, it } from "vitest";

import type { InteractionSession, PageObservation } from "../../../../../browser/interactionSession.js";
import type { BrowserActOptions } from "../../../../../cli/commands/browser/actionCore.js";
import { actionRequest, actLedgerArtifact } from "../../../../../cli/commands/browser/actionRequest.js";

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
  screenshotPath: null,
  snapshotPath: "/w/s-1/snapshot.yml",
  title: "Settings",
  url: "https://app.acme.example/settings",
};

const NOW = "2026-09-16T00:05:00.000Z";

function options({
  kind = "click",
  out = undefined,
}: {
  kind?: BrowserActOptions["kind"];
  out?: string | undefined;
} = {}): BrowserActOptions {
  return {
    downloadDir: "/d",
    expectFocus: undefined,
    expectName: undefined,
    focus: false,
    fullPage: false,
    json: false,
    kind,
    observationId: "obs-1",
    out,
    sessionId: "s-1",
    target: "e7",
    value: undefined,
  };
}

describe("actionRequest", () => {
  it("puts the after-picture and the aim shot in the session's own directory, named for the instant", () => {
    const request = actionRequest({
      aimMark: "highlight",
      nowIso: NOW,
      observation: OBSERVATION,
      options: options(),
      session: SESSION,
    });
    expect(request.screenshotPath).toBe("/w/s-1/act-2026-09-16T00-05-00.000Z.png");
    expect(request.aimShotStem).toBe("/w/s-1/aim-2026-09-16T00-05-00.000Z");
    expect(request.observation).toEqual(OBSERVATION);
    expect(request.downloadOut).toBe(undefined);
  });

  it("sends --out to the after-picture on an ordinary action", () => {
    const request = actionRequest({
      aimMark: "highlight",
      nowIso: NOW,
      observation: OBSERVATION,
      options: options({ out: "/o/after.png" }),
      session: SESSION,
    });
    expect([request.screenshotPath, request.downloadOut]).toEqual(["/o/after.png", undefined]);
  });

  it("sends --out to the downloaded file on a download, keeping the picture in the session directory", () => {
    const request = actionRequest({
      aimMark: "highlight",
      nowIso: NOW,
      observation: OBSERVATION,
      options: options({ kind: "download", out: "/o/export.csv" }),
      session: SESSION,
    });
    expect([request.screenshotPath, request.downloadOut, request.downloadDir]).toEqual([
      "/w/s-1/act-2026-09-16T00-05-00.000Z.png",
      "/o/export.csv",
      "/d",
    ]);
  });

  it("hands the executor no observation when the action cites none", () => {
    const request = actionRequest({
      aimMark: "highlight",
      nowIso: NOW,
      observation: OBSERVATION,
      options: { ...options(), observationId: undefined },
      session: SESSION,
    });
    expect(request.observation).toBe(undefined);
  });
});

describe("actLedgerArtifact", () => {
  it("records the kind, the page last read and the element aimed at", () => {
    expect(actLedgerArtifact({ observation: OBSERVATION, options: options() })).toEqual({
      do: "click",
      page: "https://app.acme.example/settings",
      target: "e7",
    });
  });

  it("writes null for a page never read and an element never named", () => {
    expect(
      actLedgerArtifact({ observation: null, options: { ...options({ kind: "reload" }), target: undefined } }),
    ).toEqual({ do: "reload", page: null, target: null });
  });
});
