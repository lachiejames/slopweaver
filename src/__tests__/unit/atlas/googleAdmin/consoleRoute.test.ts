/**
 * The one rule that keeps a person out of the browser surface.
 *
 * One page of this console renders a link per member of the directory, so a walk that stored routes
 * verbatim would put the staff list in the atlas by accident. These pin the normaliser against the exact
 * id shapes the first real walk found, and against the ones a hand-written list of families missed.
 */
import { describe, expect, it } from "vitest";

import { isOpaqueSegment, normaliseConsoleRoute } from "../../../../atlas/googleAdmin/consoleRoute.js";

describe("normaliseConsoleRoute", () => {
  it("keeps a route made only of words somebody chose", () => {
    expect(normaliseConsoleRoute({ path: "/ac/reporting/report/apps/accounts" })).toBe(
      "/ac/reporting/report/apps/accounts",
    );
    expect(normaliseConsoleRoute({ path: "/ac/apps/gmail/marketplace/allowlistaccess" })).toBe(
      "/ac/apps/gmail/marketplace/allowlistaccess",
    );
  });

  it("replaces every id shape the first walk actually produced", () => {
    // MEASURED. The first reduction named four families by hand and missed the last three.
    expect(normaliseConsoleRoute({ path: "/ac/users/0gjdgxs3ioynh9" })).toBe("/ac/users/{id}");
    expect(normaliseConsoleRoute({ path: "/ac/managedsettings/352555445522" })).toBe("/ac/managedsettings/{id}");
    expect(normaliseConsoleRoute({ path: "/ac/chrome/browsers/047e2edd-d913-4db2-87a9-0c5486c9cb6e" })).toBe(
      "/ac/chrome/browsers/{id}",
    );
    expect(normaliseConsoleRoute({ path: "/ac/billing/subscriptions/2GSizLjpBXR9QvduZL1NqQ" })).toBe(
      "/ac/billing/subscriptions/{id}",
    );
    expect(normaliseConsoleRoute({ path: "/ac/billing/accounts/C8MIHvWpfg7haNmzKk9amw/transactions" })).toBe(
      "/ac/billing/accounts/{id}/transactions",
    );
  });

  it("drops a trailing slash, so a redirect that adds one is the same route", () => {
    expect(normaliseConsoleRoute({ path: "/ac/chrome/browsers/" })).toBe("/ac/chrome/browsers");
  });

  it("leaves an already-normalised route alone, so re-normalising is safe", () => {
    expect(normaliseConsoleRoute({ path: "/ac/users/{id}" })).toBe("/ac/users/{id}");
  });

  it("keeps a version segment, which is the one lowercase-plus-digit shape that is not an id", () => {
    expect(isOpaqueSegment({ segment: "v1" })).toBe(false);
    expect(isOpaqueSegment({ segment: "v1beta1" })).toBe(true);
  });

  it("errs toward replacing, because the two failure directions are not comparable", () => {
    // A route that reads `{id}` where a word stood costs a reader one lookup. A person's identifier on
    // disk costs something this repository's whole hygiene rule exists to prevent.
    expect(isOpaqueSegment({ segment: "Reporting" })).toBe(true);
    expect(isOpaqueSegment({ segment: "reporting" })).toBe(false);
  });
});
