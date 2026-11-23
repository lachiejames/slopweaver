/*
 * The one option that shows a run: foreground only for exactly 1, background otherwise, under a name that is
 * not an ALLOW_ hatch.
 */
import { describe, expect, it } from "vitest";

import { BROWSER_FOREGROUND_ENV, placementFromEnv } from "../../../../browser/foreground.js";

describe("placementFromEnv — the one option that shows a run", () => {
  it("is foreground only for exactly 1", () => {
    expect(placementFromEnv({ env: { [BROWSER_FOREGROUND_ENV]: "1" } })).toBe("foreground");
  });

  it("is background when unset, 0, or any other spelling", () => {
    expect(placementFromEnv({ env: {} })).toBe("background");
    expect(placementFromEnv({ env: { [BROWSER_FOREGROUND_ENV]: "0" } })).toBe("background");
    expect(placementFromEnv({ env: { [BROWSER_FOREGROUND_ENV]: "true" } })).toBe("background");
  });

  it("is named SLOPWEAVER_BROWSER_FOREGROUND, not an ALLOW_ hatch", () => {
    expect(BROWSER_FOREGROUND_ENV).toBe("SLOPWEAVER_BROWSER_FOREGROUND");
  });
});
