/**
 * The walk lane's placement: a deps value a caller names wins, and otherwise the run's own environment decides —
 * so one `SLOPWEAVER_BROWSER_FOREGROUND=1` prefix on a resync reaches every walk it drives.
 */
import { describe, expect, it } from "vitest";

import { BROWSER_FOREGROUND_ENV } from "../../../browser/foreground.js";
import { walkPlacement } from "../../../browser/relaySession.js";

describe("walkPlacement", () => {
  it("is background for a run that said nothing", () => {
    expect(walkPlacement({ deps: {}, env: {} })).toBe("background");
  });

  it("is foreground for a run started with the option", () => {
    expect(walkPlacement({ deps: {}, env: { [BROWSER_FOREGROUND_ENV]: "1" } })).toBe("foreground");
  });

  it("lets the deps' own placement win over the environment, in both directions", () => {
    expect(walkPlacement({ deps: { placement: "background" }, env: { [BROWSER_FOREGROUND_ENV]: "1" } })).toBe(
      "background",
    );
    expect(walkPlacement({ deps: { placement: "foreground" }, env: {} })).toBe("foreground");
  });
});
