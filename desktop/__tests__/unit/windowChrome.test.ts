import { describe, expect, it } from "vitest";

import {
  consoleWindowChrome,
  TRAFFIC_LIGHT_POSITION,
  windowControlsArgument,
  windowControlsState,
} from "../../src/windowChrome";

describe("consoleWindowChrome", () => {
  it("hides the macOS title strip and places the buttons in the tab strip", () => {
    expect(consoleWindowChrome({ platform: "darwin" })).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 12 },
    });
    expect(TRAFFIC_LIGHT_POSITION).toEqual({ x: 14, y: 12 });
  });

  it("changes nothing on a platform with no title strip to fold in", () => {
    expect(consoleWindowChrome({ platform: "linux" })).toEqual({});
  });
});

describe("windowControlsState", () => {
  it("insets the tab strip while the window is windowed (a tab bar at the top)", () => {
    expect(windowControlsState({ fullscreen: false, platform: "darwin", role: "strip" })).toBe("inset");
  });

  it("never insets a console page now the strip holds the buttons, so the sidebar reserves no room", () => {
    expect(windowControlsState({ fullscreen: false, platform: "darwin", role: "main" })).toBe("none");
  });

  it("makes no room in full-screen, where macOS hides the buttons", () => {
    expect(windowControlsState({ fullscreen: true, platform: "darwin", role: "strip" })).toBe("none");
  });

  it("never insets the voice overlay, windowed or not", () => {
    expect(windowControlsState({ fullscreen: false, platform: "darwin", role: "overlay" })).toBe("none");
    expect(windowControlsState({ fullscreen: true, platform: "darwin", role: "overlay" })).toBe("none");
  });

  it("never insets off macOS, where the frame keeps its own title bar", () => {
    expect(windowControlsState({ fullscreen: false, platform: "win32", role: "strip" })).toBe("none");
  });
});

describe("windowControlsArgument", () => {
  it("spells the argument the preload reads", () => {
    expect(windowControlsArgument({ state: "inset" })).toBe("--slopweaver-window-controls=inset");
    expect(windowControlsArgument({ state: "none" })).toBe("--slopweaver-window-controls=none");
  });
});
