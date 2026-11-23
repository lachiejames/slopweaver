/**
 * The menu bar's reducer and view: quiet while the console runs or recovers by itself, the attention mark only
 * once a recovery has failed (as Docker Desktop's does), and a live share drawn as its own icon.
 */
import { describe, expect, it } from "vitest";

import {
  INITIAL_SHELL_STATE,
  menuView,
  QUEUE_PATH,
  reduceShellState,
  type ShellEvent,
  type ShellState,
} from "../../src/shellState";

/** Apply events in order from the initial state. */
function after({ events }: { events: readonly ShellEvent[] }): ShellState {
  return events.reduce((state, event) => reduceShellState({ event, state }), INITIAL_SHELL_STATE);
}

describe("menuView icon", () => {
  it("draws the recovering ring while booting, so a cold start asks nothing of you", () => {
    expect(menuView({ state: INITIAL_SHELL_STATE }).icon).toBe("recovering");
  });

  it("draws the recovering ring while a recovery is running", () => {
    const state = after({ events: [{ kind: "recovery-started" }] });
    expect(menuView({ state }).icon).toBe("recovering");
    expect(menuView({ state }).retry).toBe(false);
  });

  it("draws the plain orb once the console serves", () => {
    const state = after({ events: [{ endpoint: "http://localhost:3000", kind: "recovery-succeeded" }] });
    const view = menuView({ state });
    expect(view.icon).toBe("ready");
    expect(view.lines).toEqual(["Slopweaver: running on localhost:3000"]);
  });

  it("draws the attention mark and offers Retry only after recovery failed", () => {
    const state = after({
      events: [{ kind: "recovery-started" }, { kind: "recovery-failed", problem: "docs-site.sh --serve failed: boom" }],
    });
    const view = menuView({ state });
    expect(view.icon).toBe("attention");
    expect(view.retry).toBe(true);
    expect(view.lines[0]).toBe("Needs attention: docs-site.sh --serve failed: boom");
  });

  it("ranks attention over sharing, and sharing over recovering", () => {
    const sharing: ShellEvent = { audioTracks: 1, displayTracks: 1, kind: "media-counted" };
    const failed = after({ events: [sharing, { kind: "recovery-failed", problem: "down" }] });
    const recovering = after({ events: [sharing, { kind: "recovery-started" }] });
    expect(menuView({ state: failed }).icon).toBe("attention");
    expect(menuView({ state: recovering }).icon).toBe("sharing");
  });

  it("stays quiet while an update's restart is held: the recovering ring, its own line, no Retry", () => {
    const state = after({
      events: [{ kind: "recovery-started" }, { kind: "restart-held", problem: "http://localhost:3000 did not answer" }],
    });
    const view = menuView({ state });
    expect(state.service).toEqual({ kind: "restarting", problem: "http://localhost:3000 did not answer" });
    expect(view.icon).toBe("recovering");
    expect(view.retry).toBe(false);
    expect(view.lines).toEqual(["Slopweaver: the console is restarting onto a new build…"]);
    expect(view.tooltip).toBe("Slopweaver: the console is restarting onto a new build…");
  });

  it("ranks sharing over a held restart, and leaves a held restart for ready or attention", () => {
    const sharing: ShellEvent = { audioTracks: 0, displayTracks: 1, kind: "media-counted" };
    const held: ShellEvent = { kind: "restart-held", problem: "down" };
    expect(menuView({ state: after({ events: [sharing, held] }) }).icon).toBe("sharing");
    const back = after({ events: [held, { endpoint: "http://localhost:3000", kind: "recovery-succeeded" }] });
    expect(menuView({ state: back }).icon).toBe("ready");
    const raised = after({ events: [held, { kind: "recovery-failed", problem: "down" }] });
    expect(menuView({ state: raised }).icon).toBe("attention");
    expect(menuView({ state: raised }).retry).toBe(true);
  });

  it("clears the attention mark when a later recovery succeeds", () => {
    const state = after({
      events: [
        { kind: "recovery-failed", problem: "down" },
        { endpoint: "http://localhost:3000", kind: "recovery-succeeded" },
      ],
    });
    expect(menuView({ state }).icon).toBe("ready");
    expect(menuView({ state }).retry).toBe(false);
  });
});

describe("menuView lines", () => {
  it("says a share and a call are live, and puts the share in the tooltip", () => {
    const state = after({
      events: [
        { endpoint: "http://localhost:3000", kind: "recovery-succeeded" },
        { audioTracks: 1, displayTracks: 1, kind: "media-counted" },
      ],
    });
    const view = menuView({ state });
    expect(view.icon).toBe("sharing");
    expect(view.lines).toEqual([
      "Slopweaver: running on localhost:3000",
      "● Sharing your screen with the voice",
      "Voice call open",
    ]);
    expect(view.tooltip).toBe("Slopweaver: running on localhost:3000 · sharing your screen");
  });

  it("names an interrupted call, a permission problem and a state problem in that order", () => {
    const state = after({
      events: [
        { kind: "interrupted-call-read", present: true },
        { kind: "permission-problem", problem: "Microphone is off" },
        { kind: "state-problem", problem: "could not save" },
      ],
    });
    expect(menuView({ state }).lines).toEqual([
      "Slopweaver: starting the console…",
      "The last session closed during a call; press the orb, then talk, to start again",
      "Microphone is off",
      "could not save",
    ]);
  });

  it("drops a problem once it is reported cleared", () => {
    const state = after({
      events: [
        { kind: "state-problem", problem: "could not save" },
        { kind: "state-problem", problem: undefined },
      ],
    });
    expect(menuView({ state }).lines).toEqual(["Slopweaver: starting the console…"]);
  });
});

describe("reduceShellState", () => {
  it("clears an interrupted call once a new call opens", () => {
    const state = after({
      events: [
        { kind: "interrupted-call-read", present: true },
        { audioTracks: 1, displayTracks: 0, kind: "media-counted" },
      ],
    });
    expect(state.interruptedCall).toBe(false);
  });

  it("keeps an interrupted call while only a share opens", () => {
    const state = after({
      events: [
        { kind: "interrupted-call-read", present: true },
        { audioTracks: 0, displayTracks: 1, kind: "media-counted" },
      ],
    });
    expect(state.interruptedCall).toBe(true);
  });

  it("floors a negative count at zero", () => {
    const state = after({ events: [{ audioTracks: -2, displayTracks: -1, kind: "media-counted" }] });
    expect(state.audioTracks).toBe(0);
    expect(state.displayTracks).toBe(0);
  });

  it("offers Reopen for a page that is not the Queue, and forgets it on the Queue", () => {
    const away = after({ events: [{ kind: "page-visited", path: "/automations?tab=health" }] });
    const back = after({
      events: [
        { kind: "page-visited", path: "/automations" },
        { kind: "page-visited", path: QUEUE_PATH },
      ],
    });
    expect(menuView({ state: away }).reopenPath).toBe("/automations?tab=health");
    expect(menuView({ state: back }).reopenPath).toBe(undefined);
  });
});

describe("menuView voice item", () => {
  it("offers no voice item before the voice's window has reported, so the tray never sends into nothing", () => {
    expect(menuView({ state: INITIAL_SHELL_STATE }).voice).toBe(undefined);
  });

  it("starts a call when none is up", () => {
    const state = after({ events: [{ kind: "overlay-reported", status: { callActive: false, mode: "collapsed" } }] });
    expect(menuView({ state }).voice).toEqual({ command: "activate", label: "Start voice" });
  });

  it("offers no start while the console window holds a call of its own, so two calls can never be live", () => {
    const state = after({
      events: [
        { kind: "overlay-reported", status: { callActive: false, mode: "collapsed" } },
        { audioTracks: 1, displayTracks: 0, kind: "media-counted" },
      ],
    });
    expect(menuView({ state }).voice).toBe(undefined);
  });

  it("brings a cornered call up to the stage", () => {
    const state = after({ events: [{ kind: "overlay-reported", status: { callActive: true, mode: "collapsed" } }] });
    expect(menuView({ state }).voice).toEqual({ command: "expand", label: "Expand voice" });
  });

  it("moves a staged call to the corner", () => {
    const state = after({ events: [{ kind: "overlay-reported", status: { callActive: true, mode: "expanded" } }] });
    expect(menuView({ state }).voice).toEqual({ command: "collapse", label: "Move voice to corner" });
  });

  it("drops the item again when the voice's window goes away", () => {
    const state = after({
      events: [
        { kind: "overlay-reported", status: { callActive: true, mode: "expanded" } },
        { kind: "overlay-reported", status: undefined },
      ],
    });
    expect(menuView({ state }).voice).toBe(undefined);
  });
});

// An X on the orb takes the overlay off your screen while the call runs on, and
// the menu bar brings it back.
describe("hiding the voice with the X on its orb", () => {
  const idle: ShellEvent = { kind: "overlay-reported", status: { callActive: false, mode: "collapsed" } };
  const cornered: ShellEvent = { kind: "overlay-reported", status: { callActive: true, mode: "collapsed" } };
  const staged: ShellEvent = { kind: "overlay-reported", status: { callActive: true, mode: "expanded" } };
  const hide: ShellEvent = { kind: "overlay-hidden" };
  const show: ShellEvent = { kind: "overlay-shown" };

  it("starts shown", () => {
    expect(INITIAL_SHELL_STATE.overlayHidden).toBe(false);
  });

  it("offers Show voice once hidden, during a call and with none up", () => {
    expect(menuView({ state: after({ events: [cornered, hide] }) }).voice).toEqual({
      command: "show",
      label: "Show voice",
    });
    expect(menuView({ state: after({ events: [idle, hide] }) }).voice).toEqual({
      command: "show",
      label: "Show voice",
    });
  });

  it("goes back to the item the call wants once Show voice is pressed", () => {
    expect(menuView({ state: after({ events: [cornered, hide, show] }) }).voice).toEqual({
      command: "expand",
      label: "Expand voice",
    });
    expect(menuView({ state: after({ events: [idle, hide, show] }) }).voice).toEqual({
      command: "activate",
      label: "Start voice",
    });
  });

  it("refuses a hide that lands after the stage has said it is up, and keeps the stage's own item", () => {
    const state = after({ events: [cornered, staged, hide] });
    expect(state.overlayHidden).toBe(false);
    expect(menuView({ state }).voice).toEqual({ command: "collapse", label: "Move voice to corner" });
  });

  it("stays hidden while the same call reports again, and as that call ends", () => {
    expect(after({ events: [cornered, hide, cornered] }).overlayHidden).toBe(true);
    expect(after({ events: [cornered, hide, idle] }).overlayHidden).toBe(true);
  });

  it("comes back by itself when the next call starts", () => {
    const state = after({ events: [cornered, hide, idle, cornered] });
    expect(state.overlayHidden).toBe(false);
    expect(menuView({ state }).voice).toEqual({ command: "expand", label: "Expand voice" });
    expect(after({ events: [idle, hide, cornered] }).overlayHidden).toBe(false);
  });

  it("comes back for the stage, which never sits in a window you cannot see", () => {
    const state = after({ events: [cornered, hide, staged] });
    expect(state.overlayHidden).toBe(false);
    expect(menuView({ state }).voice).toEqual({ command: "collapse", label: "Move voice to corner" });
  });

  it("keeps the hide across the voice's page going away, offering no item until it reports", () => {
    const gone = after({ events: [cornered, hide, { kind: "overlay-reported", status: undefined }] });
    expect(gone.overlayHidden).toBe(true);
    expect(menuView({ state: gone }).voice).toBe(undefined);
  });
});
