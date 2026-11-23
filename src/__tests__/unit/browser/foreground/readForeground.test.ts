/*
 * Reading what is in front: the app and, for Chrome only, its front window, and null where the platform or the
 * app gives nothing to read.
 */
import { describe, expect, it } from "vitest";

import { CHROME_BUNDLE_ID, readForeground } from "../../../../browser/foreground.js";
import { BUNDLE_OF, CHROME_IN_FRONT, CHROME_WINDOW, FRONT_ASN, recorder, SLACK_IN_FRONT } from "./harness.js";

describe("readForeground", () => {
  it("reads the app and, for Chrome, its front window", () => {
    const rec = recorder({ replies: CHROME_IN_FRONT });
    expect(readForeground({ run: rec.run })).toEqual({ bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW]);
  });

  it("does not ask Chrome about windows when another app is in front", () => {
    const rec = recorder({ replies: SLACK_IN_FRONT });
    expect(readForeground({ run: rec.run })).toEqual({ bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF]);
  });

  it("answers a Chrome with no window as Chrome, window unknown", () => {
    const rec = recorder({
      replies: { [BUNDLE_OF]: CHROME_IN_FRONT[BUNDLE_OF]!, [FRONT_ASN]: CHROME_IN_FRONT[FRONT_ASN]! },
    });
    expect(readForeground({ run: rec.run })).toEqual({ bundleId: CHROME_BUNDLE_ID, chromeWindowId: null });
  });

  it("answers null when the platform has no lsappinfo, and when the front app has no bundle", () => {
    expect(readForeground({ run: recorder({ replies: {} }).run })).toBe(null);
    expect(readForeground({ run: recorder({ replies: { [FRONT_ASN]: "" } }).run })).toBe(null);
    const unbundled = recorder({
      replies: { [BUNDLE_OF]: "bundleID=[ NULL ]", [FRONT_ASN]: CHROME_IN_FRONT[FRONT_ASN]! },
    });
    expect(readForeground({ run: unbundled.run })).toBe(null);
  });
});
