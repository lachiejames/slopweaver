/*
 * The call card's trays over Messenger: one open at most, none by default, each button toggling its own and swapping
 * another's; and how tall the card they sit in is.
 */
import { describe, expect, it } from "vitest";

import {
  CALL_TRAYS,
  CORNER_CARD_HEIGHT_REM,
  cardHeightCss,
  cardWidthCss,
  nextTray,
  trayButtonsOf,
  trayWordOf,
} from "../../lib/callTrays";

describe("nextTray", () => {
  it("opens the pressed tray when none is open", () => {
    expect(nextTray({ open: undefined, pressed: "list" })).toBe("list");
  });

  it("closes the open tray when its own button is pressed again, leaving none", () => {
    expect(nextTray({ open: "audio", pressed: "audio" })).toBe(undefined);
  });

  it("swaps the open tray for the pressed one, so two are never open", () => {
    expect(nextTray({ open: "list", pressed: "details" })).toBe("details");
  });

  it("toggles one button open, closed, open, closed", () => {
    const first = nextTray({ open: undefined, pressed: "details" });
    const second = nextTray({ open: first, pressed: "details" });
    const third = nextTray({ open: second, pressed: "details" });
    const fourth = nextTray({ open: third, pressed: "details" });
    expect([first, second, third, fourth]).toEqual(["details", undefined, "details", undefined]);
  });

  it("keeps a tray open through presses on each tray in turn", () => {
    const seen: (string | undefined)[] = [];
    let open: ReturnType<typeof nextTray> = undefined;
    for (const pressed of [...CALL_TRAYS, ...CALL_TRAYS]) {
      open = nextTray({ open, pressed });
      seen.push(open);
    }
    expect(seen).toEqual(["list", "details", "audio", "list", "details", "audio"]);
  });
});

describe("trayButtonsOf", () => {
  it("draws one unpressed button per tray, in order, with none open, and none for Messenger", () => {
    expect(trayButtonsOf({ open: undefined })).toEqual([
      { pressed: false, tray: "list", word: "running list" },
      { pressed: false, tray: "details", word: "session details" },
      { pressed: false, tray: "audio", word: "microphone and speaker" },
    ]);
  });

  it("presses only the open tray's button, whose word says a press closes it", () => {
    expect(trayButtonsOf({ open: "list" })).toEqual([
      { pressed: true, tray: "list", word: "close running list" },
      { pressed: false, tray: "details", word: "session details" },
      { pressed: false, tray: "audio", word: "microphone and speaker" },
    ]);
  });
});

describe("cardHeightCss", () => {
  it("is the card's 34.2rem, or the screen less the orb and the margins where shorter, never under its controls' floor", () => {
    expect(cardHeightCss({ heightRem: CORNER_CARD_HEIGHT_REM })).toBe(
      "max(11rem, min(34.2rem, calc(var(--sw-screen-height, 100vh) - 9.8rem - var(--sw-orb-floor, 0px))))",
    );
  });

  it("takes the height the owner chose, still bounded by the screen", () => {
    expect(cardHeightCss({ heightRem: 41.04 })).toBe(
      "max(11rem, min(41.04rem, calc(var(--sw-screen-height, 100vh) - 9.8rem - var(--sw-orb-floor, 0px))))",
    );
  });
});

describe("cardWidthCss", () => {
  it("is the owner's width, or the window less the margins and insets where narrower", () => {
    expect(cardWidthCss({ widthRem: 40.5 })).toBe(
      "min(40.5rem, calc(100vw - 2.5rem - var(--sw-inset-left, 0px) - var(--sw-inset-right, 0px)))",
    );
  });
});

describe("trayWordOf", () => {
  it("names each tray's region as its closed button does", () => {
    expect(CALL_TRAYS.map((tray) => trayWordOf({ tray }))).toEqual([
      "running list",
      "session details",
      "microphone and speaker",
    ]);
  });
});
