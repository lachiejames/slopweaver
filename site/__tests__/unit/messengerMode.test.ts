/*
 * The orb's messenger: the composer is never shut by a call — it sends into the call instead — the header's one row of
 * icon controls matches the stage's, and the header and orb say what is up and what a press does.
 */
import { describe, expect, it } from "vitest";

import {
  MESSENGER_PLACEHOLDER,
  messengerComposerMode,
  messengerHeaderControls,
  messengerHeaderStatus,
  messengerOrbLabel,
  messengerStatusWords,
} from "../../lib/messengerMode";

describe("messengerComposerMode", () => {
  it("sends to the typed conversation with no call up and none open yet", () => {
    expect(messengerComposerMode({ callUp: false, phase: "idle", sendingToCall: false })).toEqual({
      button: "send",
      kind: "send",
      target: "typed",
    });
  });

  it("sends onto an open typed conversation", () => {
    expect(messengerComposerMode({ callUp: false, phase: "open", sendingToCall: false })).toEqual({
      button: "send",
      kind: "send",
      target: "typed",
    });
  });

  // A pasted Slack thread link and no send button.
  it("sends into the call while one is up, rather than shutting the box or ending the call", () => {
    expect(messengerComposerMode({ callUp: true, phase: "idle", sendingToCall: false })).toEqual({
      button: "send to the call",
      kind: "send",
      target: "call",
    });
  });

  it("is busy sending while the owner's message is on its way into the call", () => {
    expect(messengerComposerMode({ callUp: true, phase: "idle", sendingToCall: true })).toEqual({
      button: "sending…",
      kind: "busy",
    });
  });

  it("is busy while the typed conversation opens", () => {
    expect(messengerComposerMode({ callUp: false, phase: "opening", sendingToCall: false })).toEqual({
      button: "opening…",
      kind: "busy",
    });
  });

  it("is busy while a message is sent", () => {
    expect(messengerComposerMode({ callUp: false, phase: "sending", sendingToCall: false })).toEqual({
      button: "sending…",
      kind: "busy",
    });
  });

  it("asks for a message in the owner's ruled word", () => {
    expect(MESSENGER_PLACEHOLDER).toBe("Message");
  });

  it("is busy while the answer is written", () => {
    expect(messengerComposerMode({ callUp: false, phase: "replying", sendingToCall: false })).toEqual({
      button: "answering…",
      kind: "busy",
    });
  });
});

describe("messengerHeaderControls", () => {
  const idle = {
    callActive: false,
    callActiveAnywhere: false,
    hasLive: false,
    muted: false,
    openTray: undefined,
    screenSight: "share",
    sharing: undefined,
  } as const;

  it("offers talk, the running list and session details with no call up, and no microphone tray", () => {
    expect(messengerHeaderControls(idle)).toEqual([
      { disabled: false, id: "talk", pressed: undefined, word: "talk" },
      { disabled: false, id: "list", pressed: false, word: "running list" },
      { disabled: false, id: "details", pressed: false, word: "session details" },
    ]);
  });

  it("keeps talk drawn but unable to act while a call is up in the other window", () => {
    expect(messengerHeaderControls({ ...idle, callActiveAnywhere: true })[0]).toEqual({
      disabled: true,
      id: "talk",
      pressed: undefined,
      word: "talk",
    });
  });

  it("swaps talk for hang up in the same place during a call", () => {
    expect(
      messengerHeaderControls({ ...idle, callActive: true, callActiveAnywhere: true }).map((control) => control.id),
    ).toEqual(["end", "audio", "screen", "list", "details"]);
  });

  it("names an open tray's button as the way to close it", () => {
    expect(messengerHeaderControls({ ...idle, openTray: "list" })[1]).toEqual({
      disabled: false,
      id: "list",
      pressed: true,
      word: "close running list",
    });
  });

  it("adds the open microphone tray's own close with no call up, as after a hang-up", () => {
    expect(messengerHeaderControls({ ...idle, openTray: "audio" })[3]).toEqual({
      disabled: false,
      id: "audio",
      pressed: true,
      word: "close microphone and speaker",
    });
  });

  it("draws the microphone tray's button once during a call, in the call's controls", () => {
    expect(
      messengerHeaderControls({ ...idle, callActive: true, hasLive: true, openTray: "audio" }).map(
        (control) => control.id,
      ),
    ).toEqual(["end", "audio", "mute", "screen", "list", "details"]);
  });
});

describe("messengerHeaderControls during a call", () => {
  const live = {
    callActive: true,
    callActiveAnywhere: true,
    hasLive: true,
    muted: false,
    openTray: undefined,
    screenSight: "share",
    sharing: undefined,
  } as const;

  it("draws every call control on one row: hang up, the chevron, mute after it, screen, then the trays", () => {
    expect(messengerHeaderControls(live)).toEqual([
      { disabled: false, id: "end", pressed: undefined, word: "hang up" },
      { disabled: false, id: "audio", pressed: false, word: "microphone and speaker" },
      { disabled: false, id: "mute", pressed: false, word: "mute" },
      { disabled: false, id: "screen", pressed: false, word: "look at my screen" },
      { disabled: false, id: "list", pressed: false, word: "running list" },
      { disabled: false, id: "details", pressed: false, word: "session details" },
    ]);
  });

  it("names mute and screen by their state, as the stage does", () => {
    const words = messengerHeaderControls({ ...live, muted: true, sharing: "Entire Screen" })
      .filter((control) => control.id === "mute" || control.id === "screen")
      .map((control) => [control.word, control.pressed]);
    expect(words).toEqual([
      ["unmute", true],
      ["stop showing screen", true],
    ]);
  });

  it("draws no screen control where the desktop app looks for itself and nothing is shared", () => {
    expect(messengerHeaderControls({ ...live, screenSight: "native" }).map((control) => control.id)).toEqual([
      "end",
      "audio",
      "mute",
      "list",
      "details",
    ]);
  });

  it("draws no mute before the call has its live session, leaving the chevron alone", () => {
    expect(messengerHeaderControls({ ...live, hasLive: false }).map((control) => control.id)).toEqual([
      "end",
      "audio",
      "screen",
      "list",
      "details",
    ]);
  });

  it("never draws talk or the stage's collapse", () => {
    expect(messengerHeaderControls(live).filter((control) => control.id === "talk")).toEqual([]);
  });

  it("presses the microphone tray's button while it is open", () => {
    expect(messengerHeaderControls({ ...live, openTray: "audio" })[1]).toEqual({
      disabled: false,
      id: "audio",
      pressed: true,
      word: "close microphone and speaker",
    });
  });
});

describe("messengerHeaderStatus", () => {
  it("says the voice's live state with its age in place of a bare 'on a call'", () => {
    expect(
      messengerHeaderStatus({ callActiveAnywhere: true, headline: "hearing you", phase: "listening", seconds: 4 }),
    ).toBe("hearing you · 4s");
  });

  it("says no call is up", () => {
    expect(
      messengerHeaderStatus({ callActiveAnywhere: false, headline: "talk", phase: "off", seconds: undefined }),
    ).toBe("no call up");
  });

  it("says the call is in the other window when this one's own phase is off", () => {
    expect(
      messengerHeaderStatus({ callActiveAnywhere: true, headline: "talk", phase: "off", seconds: undefined }),
    ).toBe("on a call in the other window");
  });
});

describe("messengerStatusWords", () => {
  it("adds the age when the state is counted", () => {
    expect(messengerStatusWords({ headline: "reasoning", phase: "working", seconds: 18 })).toBe("reasoning · 18s");
  });

  it("adds a zero age", () => {
    expect(messengerStatusWords({ headline: "hearing you", phase: "listening", seconds: 0 })).toBe("hearing you · 0s");
  });

  it("is the headline alone when the state is not counted", () => {
    expect(messengerStatusWords({ headline: "listening", phase: "listening", seconds: undefined })).toBe("listening");
  });

  it("says there is no call rather than echoing the talk chip", () => {
    expect(messengerStatusWords({ headline: "talk", phase: "off", seconds: undefined })).toBe("no call up");
  });
});

describe("messengerOrbLabel", () => {
  it("names a closed orb's press as opening the voice, with no call up", () => {
    expect(messengerOrbLabel({ callActive: false, headline: "off", open: false })).toBe(
      "open the voice, then type or talk",
    );
  });

  it("names an open orb's press as closing it", () => {
    expect(messengerOrbLabel({ callActive: false, headline: "off", open: true })).toBe("close the voice");
  });

  it("leads with the state during a call", () => {
    expect(messengerOrbLabel({ callActive: true, headline: "listening", open: false })).toBe(
      "listening: open the voice, then type or talk",
    );
  });
});
