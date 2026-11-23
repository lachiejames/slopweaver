import { describe, expect, it } from "vitest";

import { exitCodeForShotError } from "../../../../cli/commands/datadog/shotRun.js";
import { DatadogShotErrors } from "../../../../datadog/shot/errors.js";

describe("exitCodeForShotError", () => {
  it("grades a refused address as a caller-args error", () => {
    expect(exitCodeForShotError({ error: DatadogShotErrors.urlRefused({ reason: "r", url: "u" }) })).toBe(2);
  });

  it("grades a wrong evaluation window as a real failure rather than an empty", () => {
    expect(
      exitCodeForShotError({
        error: DatadogShotErrors.previewWindowWrong({ expectedSeconds: 604800, observedSeconds: 3600 }),
      }),
    ).toBe(1);
  });

  it("grades an unconfirmed view state as a real failure", () => {
    expect(
      exitCodeForShotError({ error: DatadogShotErrors.viewStateUnconfirmed({ missing: ["m"], rendered: "r" }) }),
    ).toBe(1);
  });

  it("grades an unusable image as a real failure, so a bad proof never exits clean", () => {
    expect(exitCodeForShotError({ error: DatadogShotErrors.imageUnusable({ detail: "d", path: "/p" }) })).toBe(1);
  });

  it("grades an unreadable panel as a real failure", () => {
    expect(
      exitCodeForShotError({ error: DatadogShotErrors.panelUnreadable({ missing: ["Alert"], panelText: "t" }) }),
    ).toBe(1);
  });

  it("grades an unwritable output as a real failure", () => {
    expect(exitCodeForShotError({ error: DatadogShotErrors.outputUnwritable({ detail: "d", path: "/p" }) })).toBe(1);
  });
});
