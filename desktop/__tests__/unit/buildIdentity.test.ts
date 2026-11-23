/**
 * Every window names Slopweaver, and a run from source always says it is a dev build and of which checkout.
 */
import { describe, expect, it } from "vitest";

import { buildIdentity, trayIdentityLine, windowTitle } from "../../src/buildIdentity";

const PACKAGED = buildIdentity({ checkout: "/Users/x/dev/personal/slopweaver", packaged: true });
const DEV = buildIdentity({ checkout: "/Users/x/slopweaver/.claude/worktrees.noindex/fix-the-orb", packaged: false });
const DEV_NO_CHECKOUT = buildIdentity({ checkout: undefined, packaged: false });

describe("buildIdentity", () => {
  it("calls the packaged app plain Slopweaver", () => {
    expect(PACKAGED).toEqual({ checkout: "/Users/x/dev/personal/slopweaver", dev: false, label: "Slopweaver" });
  });

  it("names a dev run's checkout by its folder", () => {
    expect(DEV.dev).toBe(true);
    expect(DEV.label).toBe("Slopweaver (dev build · fix-the-orb)");
  });

  it("still says dev build when no checkout validated", () => {
    expect(DEV_NO_CHECKOUT.label).toBe("Slopweaver (dev build)");
  });
});

describe("windowTitle", () => {
  it("is the label alone for an empty or blank page", () => {
    expect(windowTitle({ identity: PACKAGED, page: "" })).toBe("Slopweaver");
    expect(windowTitle({ identity: DEV, page: "   " })).toBe("Slopweaver (dev build · fix-the-orb)");
  });

  it("follows a page that does not name Slopweaver with the label", () => {
    expect(windowTitle({ identity: PACKAGED, page: "Queue · the bot" })).toBe("Queue · the bot · Slopweaver");
    expect(windowTitle({ identity: DEV, page: "Sessions" })).toBe("Sessions · Slopweaver (dev build · fix-the-orb)");
  });

  it("leaves a page naming Slopweaver alone in the packaged app", () => {
    expect(windowTitle({ identity: PACKAGED, page: "Slopweaver needs you" })).toBe("Slopweaver needs you");
  });

  it("turns Slopweaver into the dev label in a dev run", () => {
    expect(windowTitle({ identity: DEV, page: "Slopweaver voice" })).toBe("Slopweaver (dev build · fix-the-orb) voice");
  });
});

describe("trayIdentityLine", () => {
  it("adds nothing to the packaged app's menu", () => {
    expect(trayIdentityLine({ identity: PACKAGED })).toBe(undefined);
  });

  it("names the checkout a dev build serves", () => {
    expect(trayIdentityLine({ identity: DEV })).toBe(
      "Dev build of /Users/x/slopweaver/.claude/worktrees.noindex/fix-the-orb",
    );
    expect(trayIdentityLine({ identity: DEV_NO_CHECKOUT })).toBe("Dev build: no checkout set");
  });
});
