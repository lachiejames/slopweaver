/*
 * The sidebar's one Update button: what a press does from the two build standings and whether a call is up, the words
 * it says when it ends a call, what the menu bar is told — and the console's side of the shell's update half.
 */
import { describe, expect, it } from "vitest";

import type { BuildStanding } from "../../lib/buildStanding";
import { desktopBridgeOf, updateBridgeOf } from "../../lib/desktopShell";
import { overlayCommandOf } from "../../lib/desktopShellOverlay";
import { updateRefusalOf, updateStateOf } from "../../lib/desktopShellUpdate";
import type { ShellStanding } from "../../lib/shellStandingWords";
import {
  lineIntent,
  outcomeLine,
  refusalSentence,
  sidebarAction,
  trayOfferOf,
  UPDATE_WITH_CALL,
  updateAction,
  updateIntent,
} from "../../lib/updateAction";

const SHA = "461e873ed0f301ebbd167766265eea51f8db26be";
const FINISHED = "2026-10-10T03:34:00.000Z";

/** A page standing of one kind; only the kind is read. */
function page({ kind }: { kind: BuildStanding["kind"] }): BuildStanding {
  return {
    build: undefined,
    checked: undefined,
    glance: "",
    headline: "",
    kind,
    missing: [],
    step: undefined,
    tone: "ok",
  };
}

/** An app standing whose fix is `fix`; only the fix is read. */
function app({ fix }: { fix: ShellStanding["fix"] }): ShellStanding {
  return { build: undefined, changing: [], fix, glance: "", headline: "", step: undefined, tone: "ok" };
}

const QUIET = {
  app: app({ fix: "none" }),
  callLive: false,
  canUpdate: true,
  page: page({ kind: "current" }),
  running: false,
};

describe("updateAction", () => {
  it("offers the full update for an app behind, in other apps' words, and names the call when it ends one", () => {
    expect(updateAction({ ...QUIET, app: app({ fix: "install" }) })).toEqual({
      endsCall: false,
      kind: "install",
      label: "Update now",
    });
    expect(updateAction({ ...QUIET, app: app({ fix: "install" }), callLive: true })).toEqual({
      endsCall: true,
      kind: "install",
      label: "End call, update & restart call",
    });
  });

  it("offers a restart onto the app already installed, in the same words as every other update", () => {
    expect(updateAction({ ...QUIET, app: app({ fix: "relaunch" }) })).toEqual({
      endsCall: false,
      kind: "relaunch",
      label: "Update now",
    });
    expect(updateAction({ ...QUIET, app: app({ fix: "relaunch" }), callLive: true })).toEqual({
      endsCall: true,
      kind: "relaunch",
      label: "End call, update & restart call",
    });
  });

  it("puts the app's update ahead of the page's, since the app's rebuilds the page too", () => {
    expect(updateAction({ ...QUIET, app: app({ fix: "install" }), page: page({ kind: "reload" }) }).kind).toBe(
      "install",
    );
  });

  it("offers a reload for a page whose build has swapped in, in the same words as every other update", () => {
    expect(updateAction({ ...QUIET, page: page({ kind: "reload" }) })).toEqual({
      endsCall: false,
      kind: "reload",
      label: "Update now",
    });
    expect(updateAction({ ...QUIET, callLive: true, page: page({ kind: "reload" }) })).toEqual({
      endsCall: true,
      kind: "reload",
      label: "End call, update & restart call",
    });
  });

  it("offers the full update for a checkout that has not pulled what landed", () => {
    expect(updateAction({ ...QUIET, page: page({ kind: "unsynced" }) })).toEqual({
      endsCall: false,
      kind: "install",
      label: "Update now",
    });
  });

  it("offers to end the call a page build is held for, and shows one held for a call elsewhere as under way", () => {
    expect(updateAction({ ...QUIET, callLive: true, page: page({ kind: "waiting" }) })).toEqual({
      endsCall: true,
      kind: "swap",
      label: "End call, update & restart call",
    });
    expect(updateAction({ ...QUIET, page: page({ kind: "waiting" }) })).toEqual({
      kind: "busy",
      label: "Update waiting on a call",
    });
  });

  it("never draws a button for a console that will not rebuild, a dev server or an unknown build", () => {
    expect(updateAction({ ...QUIET, page: page({ kind: "stuck" }) })).toEqual({ kind: "none" });
    expect(updateAction({ ...QUIET, page: page({ kind: "dev" }) })).toEqual({ kind: "none" });
    expect(updateAction({ ...QUIET, page: page({ kind: "unknown" }) })).toEqual({ kind: "none" });
  });

  it("shows a build under way, an update running, and nothing when the shell cannot update", () => {
    expect(updateAction({ ...QUIET, page: page({ kind: "rebuilding" }) })).toEqual({
      kind: "busy",
      label: "Building update…",
    });
    expect(updateAction({ ...QUIET, app: app({ fix: "install" }), running: true })).toEqual({
      kind: "busy",
      label: "Updating…",
    });
    expect(updateAction({ ...QUIET, app: app({ fix: "install" }), canUpdate: false })).toEqual({ kind: "none" });
  });

  it("draws nothing when both builds are current, or nothing is known yet", () => {
    expect(updateAction(QUIET)).toEqual({ kind: "none" });
    expect(updateAction({ ...QUIET, app: undefined, page: undefined })).toEqual({ kind: "none" });
  });
});

describe("updateIntent", () => {
  it("names the step with no button to press it, so a browser's line still says an update is there", () => {
    expect(updateIntent({ app: undefined, callLive: false, page: page({ kind: "reload" }), running: false })).toEqual({
      endsCall: false,
      kind: "reload",
    });
    expect(updateIntent({ app: undefined, callLive: false, page: page({ kind: "current" }), running: false })).toEqual({
      kind: "none",
    });
  });
});

describe("lineIntent and sidebarAction", () => {
  // A held build under a call in the voice's window read "Update waiting
  // on a call" on the line AND on a disabled button beneath it.
  const held = { ...QUIET, page: page({ kind: "waiting" }) };

  it("says something under way once: on the line, with no sidebar button repeating it", () => {
    const action = updateAction(held);
    expect(lineIntent({ action, intent: updateIntent(held) })).toEqual({
      kind: "busy",
      label: "Update waiting on a call",
    });
    expect(sidebarAction({ action })).toEqual({ kind: "none" });
  });

  it("puts the controller's own swap on the line over an intent that still offers one", () => {
    const intent = updateIntent({ ...held, callLive: true });
    expect(lineIntent({ action: { kind: "busy", label: "Updating…" }, intent })).toEqual({
      kind: "busy",
      label: "Updating…",
    });
  });

  it("keeps a pressable action on the sidebar, and the standings' intent on the line", () => {
    const live = { ...held, callLive: true };
    const action = updateAction(live);
    expect(sidebarAction({ action })).toEqual({ endsCall: true, kind: "swap", label: UPDATE_WITH_CALL });
    expect(lineIntent({ action, intent: updateIntent(live) })).toEqual({ endsCall: true, kind: "swap" });
  });
});

describe("trayOfferOf", () => {
  it("tells the menu bar the button's words, a busy one disabled, and no button as null", () => {
    expect(trayOfferOf({ action: { endsCall: false, kind: "install", label: "Update now" } })).toEqual({
      enabled: true,
      label: "Update now",
    });
    expect(trayOfferOf({ action: { kind: "busy", label: "Updating…" } })).toEqual({
      enabled: false,
      label: "Updating…",
    });
    expect(trayOfferOf({ action: { kind: "none" } })).toBe(null);
  });
});

describe("refusalSentence", () => {
  it("says what to do for a refusal it knows, and names the code of one it does not", () => {
    expect(refusalSentence({ code: "CALL_IN_CONSOLE_WINDOW" })).toBe(
      "The call is in this window, not the voice's. End it here, then press update again.",
    );
    // The end-call refuses with it too, so no call is ended while an update is already being waited on.
    expect(refusalSentence({ code: "RUNNING" })).toBe("An update is already running.");
    expect(refusalSentence({ code: "INSTALL_DISABLED" })).toBe(
      "This copy of the app is a test instance, which never installs an update.",
    );
    expect(refusalSentence({ code: "UNKNOWN" })).toBe(
      "The app refused the update for a reason this page does not know yet.",
    );
  });
});

describe("outcomeLine", () => {
  it("says nothing of an update that landed, and leads a failure with which way it left the app, its message apart", () => {
    const stack = "TypeError: boom\n    at swap (/app/update.js:12:3)";

    expect(outcomeLine({ outcome: { kind: "updated", sha: SHA } })).toBe(undefined);
    expect(outcomeLine({ outcome: { kind: "failed", message: stack, rolledBack: true } })).toEqual({
      lead: "Update failed, and the previous app was put back.",
      why: stack,
    });
    expect(outcomeLine({ outcome: { kind: "failed", message: "a call was up", rolledBack: false } })).toEqual({
      lead: "Update failed, and this app kept running.",
      why: "a call was up",
    });
    expect(outcomeLine({ outcome: undefined })).toBe(undefined);
  });
});

/** A stand-in method; never called here. */
const noop = (): undefined => undefined;

/** Every method the console calls, present, in the console window. */
const WHOLE = {
  onOverlayCommand: noop,
  onPageIdentity: noop,
  publishPageIdentity: noop,
  reportOverlayStatus: noop,
  requestOverlay: noop,
  role: "main",
};

/** The update half's nine methods. */
const UPDATE = {
  endCallForUpdate: noop,
  onUpdateCheck: noop,
  onUpdateRun: noop,
  onUpdateState: noop,
  publishUpdateOffer: noop,
  relaunchForUpdate: noop,
  reloadForUpdate: noop,
  startUpdate: noop,
  updateState: noop,
};

describe("updateBridgeOf", () => {
  it("takes the update half when every method is there, and none from a shell missing one", () => {
    expect(updateBridgeOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, ...UPDATE } })! })).toEqual(UPDATE);
    const { startUpdate: _missing, ...partial } = UPDATE;
    expect(updateBridgeOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, ...partial } })! })).toBe(undefined);
    expect(updateBridgeOf({ bridge: desktopBridgeOf({ value: WHOLE })! })).toBe(undefined);
  });

  it("carries the swap's shell deadline when the shell has it, and still updates under one from before it", () => {
    const withSwap = { ...UPDATE, beginSwapForUpdate: noop };
    expect(updateBridgeOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, ...withSwap } })! })).toEqual(withSwap);
    expect(
      Object.keys(updateBridgeOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, ...UPDATE } })! })!),
    ).not.toContain("beginSwapForUpdate");
  });

  it("refuses a shell whose update method is there but not a function", () => {
    expect(desktopBridgeOf({ value: { ...WHOLE, ...UPDATE, startUpdate: "go" } })).toBe(undefined);
  });
});

describe("updateStateOf", () => {
  it("reads the standing before any update, and with a landed or a failed one", () => {
    expect(updateStateOf({ value: { outcome: null, running: true } })).toEqual({ outcome: undefined, running: true });
    expect(
      updateStateOf({ value: { outcome: { finishedIso: FINISHED, kind: "updated", sha: SHA }, running: false } }),
    ).toEqual({ outcome: { finishedIso: FINISHED, kind: "updated", logPath: undefined, sha: SHA }, running: false });
    const failed = {
      code: "ROLLED_BACK",
      finishedIso: FINISHED,
      kind: "failed",
      logPath: "/u/1.log",
      message: "m",
      rolledBack: true,
    };
    expect(updateStateOf({ value: { outcome: failed, running: false } })).toEqual({ outcome: failed, running: false });
  });

  it("refuses a stray key, a missing outcome, a non-boolean running and an outcome that is not one", () => {
    expect(updateStateOf({ value: { extra: 1, outcome: null, running: false } })).toBe(undefined);
    expect(updateStateOf({ value: { running: false } })).toBe(undefined);
    expect(updateStateOf({ value: { outcome: null, running: "no" } })).toBe(undefined);
    expect(updateStateOf({ value: { outcome: { kind: "updated", sha: SHA }, running: false } })).toBe(undefined);
  });
});

describe("updateRefusalOf", () => {
  it("reads null as gone ahead, a code as itself, and anything else as UNKNOWN", () => {
    expect(updateRefusalOf({ value: null })).toBe(undefined);
    expect(updateRefusalOf({ value: "CALL_LIVE" })).toBe("CALL_LIVE");
    expect(updateRefusalOf({ value: "call live" })).toBe("UNKNOWN");
    expect(updateRefusalOf({ value: undefined })).toBe("UNKNOWN");
  });
});

describe("overlayCommandOf", () => {
  it("takes the shell's hang-up, which ends the call for an update", () => {
    expect(overlayCommandOf({ value: "hang-up" })).toBe("hang-up");
    expect(overlayCommandOf({ value: "hangup" })).toBe(undefined);
  });
});
