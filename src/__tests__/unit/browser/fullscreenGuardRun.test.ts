/**
 * The guard's shell over a scripted client: which commands it sends, with which `mayAct`, and that every failure
 * is said on the injected reporter while the act goes ahead.
 */
import { describe, expect, it } from "vitest";

import { type BrowserActionError, BrowserActionErrors } from "../../../browser/actionErrors.js";
import type { FullscreenGuardPreparation } from "../../../browser/fullscreenGuard.js";
import { FULLSCREEN_GUARD_INSTALL_SOURCE, FULLSCREEN_GUARD_READ_SOURCE } from "../../../browser/fullscreenGuard.js";
import {
  armFullscreenGuardAtOpen,
  type FullscreenGuardCommand,
  observeFullscreenGuard,
  prepareFullscreenGuard,
} from "../../../browser/fullscreenGuardRun.js";
import type { TerminalClientDeps, TerminalReply } from "../../../browser/terminalClient.js";
import { err, ok, type Result } from "../../../lib/result.js";

const BACKGROUND: TerminalClientDeps = {
  chromePinPath: "/fake/chrome-pin",
  clientSession: "fullscreen-test",
  extensionToken: "not-a-real-token",
  placement: "background",
  workspace: "/fake/workspace",
};

const FOREGROUND: TerminalClientDeps = { ...BACKGROUND, placement: "foreground" };

const ARMED: FullscreenGuardPreparation = {
  installation: {
    attemptedFrames: 2,
    failedFrames: 0,
    installedFrames: 2,
    mainListenerInstalled: true,
    newDocumentsGuarded: true,
  },
  kind: "armed",
};

/** A reply carrying one `run-code` result. */
function resultReply({ value }: { value: unknown }): Result<TerminalReply, BrowserActionError> {
  return ok({
    modalState: null,
    pageTitle: null,
    pageUrl: null,
    snapshotPath: null,
    snapshotYaml: null,
    stdout: `### Ran Playwright code\n### Result\n${JSON.stringify(value)}\n`,
  });
}

/** One sent command, as the fake saw it. */
interface Sent {
  readonly args: readonly string[];
  readonly mayAct: boolean | undefined;
}

/** A client that answers every command with `answer`, recording what was sent and what was reported. */
function scripted({ answer }: { answer: Result<TerminalReply, BrowserActionError> }): {
  sent: Sent[];
  reported: string[];
  runCommand: FullscreenGuardCommand;
  report: (line: string) => void;
} {
  const sent: Sent[] = [];
  const reported: string[] = [];
  return {
    report: (line) => {
      reported.push(line);
    },
    reported,
    runCommand: ({ args, mayAct }) => {
      sent.push({ args, mayAct });
      return answer;
    },
    sent,
  };
}

const CLIENT_DIED = err(BrowserActionErrors.clientFailed({ detail: "the client exited 1" }));

describe("prepareFullscreenGuard", () => {
  it("sends nothing for a foreground session", () => {
    const client = scripted({ answer: CLIENT_DIED });
    const prepared = prepareFullscreenGuard({ deps: FOREGROUND, kind: "click", ...client });
    expect(prepared).toEqual({ kind: "not-required" });
    expect(client.sent).toEqual([]);
  });

  it("sends nothing for a kind that cannot write", () => {
    const client = scripted({ answer: CLIENT_DIED });
    const prepared = prepareFullscreenGuard({ deps: BACKGROUND, kind: "navigate", ...client });
    expect(prepared).toEqual({ kind: "not-required" });
    expect(client.sent).toEqual([]);
  });

  it("arms a background click with the fixed install source, as a command that may act", () => {
    const client = scripted({
      answer: resultReply({
        value: {
          attemptedFrames: 2,
          failedFrames: 0,
          installedFrames: 2,
          mainListenerInstalled: true,
          newDocumentsGuarded: true,
        },
      }),
    });
    const prepared = prepareFullscreenGuard({ deps: BACKGROUND, kind: "click", ...client });
    expect(prepared).toEqual(ARMED);
    expect(client.sent).toEqual([{ args: ["run-code", FULLSCREEN_GUARD_INSTALL_SOURCE], mayAct: true }]);
    expect(client.reported).toEqual([]);
  });

  it("says a partial installation and still reports the guard armed", () => {
    const client = scripted({
      answer: resultReply({
        value: {
          attemptedFrames: 3,
          failedFrames: 1,
          installedFrames: 2,
          mainListenerInstalled: true,
          newDocumentsGuarded: true,
        },
      }),
    });
    const prepared = prepareFullscreenGuard({ deps: BACKGROUND, kind: "press", ...client });
    expect(prepared.kind).toBe("armed");
    expect(client.reported).toEqual([
      "browser: the background full-screen guard could not be armed in 1 of 3 frames; the press goes ahead, and whether those frames can take full screen is unknown",
    ]);
  });

  it("says a guard that new documents will not get, and still reports it armed", () => {
    const client = scripted({
      answer: resultReply({
        value: {
          attemptedFrames: 1,
          failedFrames: 0,
          installedFrames: 1,
          mainListenerInstalled: true,
          newDocumentsGuarded: false,
        },
      }),
    });
    const prepared = prepareFullscreenGuard({ deps: BACKGROUND, kind: "click", ...client });
    expect(prepared.kind).toBe("armed");
    expect(client.reported).toEqual([
      "browser: the background full-screen guard could not be registered for new documents; the click goes ahead, and a page that reloads or navigates before it can take full screen",
    ]);
  });

  it("says a client failure and lets the act go ahead as unknown", () => {
    const client = scripted({ answer: CLIENT_DIED });
    const prepared = prepareFullscreenGuard({ deps: BACKGROUND, kind: "click", ...client });
    expect(prepared).toEqual({ kind: "unknown" });
    expect(client.reported.length).toBe(1);
    expect(client.reported[0]).toContain("could not be armed");
  });

  it("says an unreadable reply and lets the act go ahead as unknown", () => {
    const client = scripted({ answer: resultReply({ value: "nonsense" }) });
    const prepared = prepareFullscreenGuard({ deps: BACKGROUND, kind: "click", ...client });
    expect(prepared).toEqual({ kind: "unknown" });
    expect(client.reported).toEqual([
      "browser: the background full-screen guard's reply could not be read; the click goes ahead, and whether the page can take full screen is unknown",
    ]);
  });
});

describe("armFullscreenGuardAtOpen", () => {
  it("sends nothing for a foreground session", () => {
    const client = scripted({ answer: CLIENT_DIED });
    expect(armFullscreenGuardAtOpen({ deps: FOREGROUND, ...client })).toEqual({ kind: "not-required" });
    expect(client.sent).toEqual([]);
  });

  it("arms a background tab with the fixed install source, as a command that may act", () => {
    const client = scripted({
      answer: resultReply({
        value: {
          attemptedFrames: 2,
          failedFrames: 0,
          installedFrames: 2,
          mainListenerInstalled: true,
          newDocumentsGuarded: true,
        },
      }),
    });
    expect(armFullscreenGuardAtOpen({ deps: BACKGROUND, ...client })).toEqual(ARMED);
    expect(client.sent).toEqual([{ args: ["run-code", FULLSCREEN_GUARD_INSTALL_SOURCE], mayAct: true }]);
    expect(client.reported).toEqual([]);
  });

  it("says a client failure and lets the open go ahead as unknown", () => {
    const client = scripted({ answer: CLIENT_DIED });
    expect(armFullscreenGuardAtOpen({ deps: BACKGROUND, ...client })).toEqual({ kind: "unknown" });
    expect(client.reported.length).toBe(1);
    expect(client.reported[0]).toContain("; the open goes ahead");
  });
});

describe("observeFullscreenGuard", () => {
  it("reads nothing back when nothing was armed", () => {
    const client = scripted({ answer: CLIENT_DIED });
    expect(observeFullscreenGuard({ deps: BACKGROUND, preparation: { kind: "not-required" }, ...client })).toBe(null);
    expect(observeFullscreenGuard({ deps: BACKGROUND, preparation: { kind: "unknown" }, ...client })).toBe(null);
    expect(client.sent).toEqual([]);
  });

  it("reads the counters back with the fixed read source, as a command that does not act", () => {
    const client = scripted({
      answer: resultReply({ value: { emergencyExits: 0, refusedRequests: 1, unreadableFrames: 0 } }),
    });
    const observed = observeFullscreenGuard({ deps: BACKGROUND, preparation: ARMED, ...client });
    expect(observed).toEqual({ emergencyExits: 0, refusedRequests: 1, unreadableFrames: 0 });
    expect(client.sent).toEqual([{ args: ["run-code", FULLSCREEN_GUARD_READ_SOURCE], mayAct: undefined }]);
    expect(client.reported).toEqual([]);
  });

  it("keeps the counts it could read and says they are a lower bound", () => {
    const client = scripted({
      answer: resultReply({ value: { emergencyExits: 0, refusedRequests: 2, unreadableFrames: 1 } }),
    });
    const observed = observeFullscreenGuard({ deps: BACKGROUND, preparation: ARMED, ...client });
    expect(observed).toEqual({ emergencyExits: 0, refusedRequests: 2, unreadableFrames: 1 });
    expect(client.reported).toEqual([
      "browser: 1 frame(s) could not be read back, so the full-screen counts are a lower bound",
    ]);
  });

  it("says a failed read-back and returns no reading", () => {
    const client = scripted({ answer: CLIENT_DIED });
    expect(observeFullscreenGuard({ deps: BACKGROUND, preparation: ARMED, ...client })).toBe(null);
    expect(client.reported.length).toBe(1);
    expect(client.reported[0]).toContain("could not be read back");
  });

  it("says an unparseable read-back and returns no reading", () => {
    const client = scripted({ answer: resultReply({ value: null }) });
    expect(observeFullscreenGuard({ deps: BACKGROUND, preparation: ARMED, ...client })).toBe(null);
    expect(client.reported).toEqual(["browser: the background full-screen guard's read-back could not be parsed"]);
  });
});
