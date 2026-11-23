/**
 * The route oracle, which is the whole basis of this atlas's credential-free route surface.
 *
 * Every case here is one the real hosts actually produced — see `routeProbe.ts` for the
 * reproduction commands — so a change that broke the distinction between the two 404s would fail here
 * rather than quietly fill the atlas with routes that do not exist.
 */
import { describe, expect, it } from "vitest";

import { JAM_CONTROL_PATH, jamRouteVerdictBecause, jamRouteVerdictFor } from "../../../../atlas/jam/routeProbe.js";

describe("jamRouteVerdictFor", () => {
  it("grades a non-404 as answered, whatever it answered with", () => {
    expect(jamRouteVerdictFor({ contentType: "application/json; charset=utf-8", statusCode: 401 })).toBe("answered");
    expect(jamRouteVerdictFor({ contentType: "text/plain", statusCode: 200 })).toBe("answered");
    expect(jamRouteVerdictFor({ contentType: "application/json; charset=utf-8", statusCode: 400 })).toBe("answered");
    expect(jamRouteVerdictFor({ contentType: "application/json; charset=utf-8", statusCode: 500 })).toBe("answered");
  });

  it("grades the application router's own JSON not-found as routed-no-leaf", () => {
    expect(jamRouteVerdictFor({ contentType: "application/json; charset=utf-8", statusCode: 404 })).toBe(
      "routed-no-leaf",
    );
  });

  it("grades the edge's flat text not-found as not-routed", () => {
    expect(jamRouteVerdictFor({ contentType: "text/plain; charset=utf-8", statusCode: 404 })).toBe("not-routed");
  });

  it("refuses to grade a 404 whose content type it cannot read, rather than guessing either way", () => {
    expect(jamRouteVerdictFor({ contentType: "", statusCode: 404 })).toBe("indeterminate");
    expect(jamRouteVerdictFor({ contentType: "text/html; charset=utf-8", statusCode: 404 })).toBe("indeterminate");
  });

  it("gives each verdict a rule a reader can check, and three different ones", () => {
    const answered = jamRouteVerdictBecause({ verdict: "answered" });
    const routed = jamRouteVerdictBecause({ verdict: "routed-no-leaf" });
    const absent = jamRouteVerdictBecause({ verdict: "not-routed" });
    expect(answered).toContain("other than 404");
    expect(routed).toContain("application router's own");
    const unknown = jamRouteVerdictBecause({ verdict: "indeterminate" });
    expect(absent).toContain("not routed at all");
    expect(unknown).toContain("nothing was established");
    expect(new Set([answered, routed, absent, unknown]).size).toBe(4);
  });
});

describe("JAM_CONTROL_PATH", () => {
  it("is a path no product could plausibly serve", () => {
    expect(JAM_CONTROL_PATH).toBe("/zzz-control-must-not-exist");
  });
});
