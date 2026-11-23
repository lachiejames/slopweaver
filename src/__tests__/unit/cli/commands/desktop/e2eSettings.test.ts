import { describe, expect, it } from "vitest";

import { settingsTabToPress } from "../../../../../cli/commands/desktop/e2eSettings.js";

describe("settingsTabToPress", () => {
  it("presses no tab for the opening step, which the dialog lands on itself", () => {
    expect(settingsTabToPress({ step: { id: "settings", kind: "settings", tab: "opening" } })).toBeUndefined();
  });

  it("presses the Presence tab inside the Settings dialog's own nav for the presence step", () => {
    expect(settingsTabToPress({ step: { id: "settings-presence", kind: "settings", tab: "presence" } })).toBe(
      '[role="dialog"] nav[aria-label="settings"] button[data-section="presence"]',
    );
  });
});
