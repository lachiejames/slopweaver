/*
 * How the frontier walk ends: on a lost session past the platform's streak, on an unattached transport, or where
 * the platform says to stop; refusing a walk that visited nothing, and reporting a failed release as progress.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { AtlasCaptureErrors, atlasCaptureErrorLines } from "../../../../../atlas/kit/captureErrors.js";
import { runFrontierWalk } from "../../../../../atlas/kit/frontierWalk.js";
import { BrowserTransportErrors } from "../../../../../browser/pageTransport.js";
import { fakeTransport, recordingWriter } from "../../../../walkTransportFake.js";

import { BASE, never, rendering, spec, visits } from "./harness.js";

describe("runFrontierWalk", () => {
  it("ends the walk on the first lost session by default, naming where, and lists the rest as not attempted", async () => {
    const lost = BrowserTransportErrors.sessionLost({ reason: "the relay dropped" });
    const lines: string[] = [];
    const fake = fakeTransport({
      visits: visits({ byRoute: { "/a": { failWith: lost }, "/home": rendering({ routes: ["/later"] }) } }),
    });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/home", "/a", "/b", "/c"], lines }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.pages.map((page) => [page.route, page.outcome])).toEqual([
      ["/home", "landed"],
      ["/a", "failed"],
    ]);
    expect(walk.sessionEndedAt).toBe("/a");
    expect(walk.notAttempted).toEqual(["/b", "/c", "/later"]);
    expect(lines).toContain(`  /a — failed: ${lost.message}`);
    expect(fake.releases()).toBe(1);
  });

  it("tolerates lost sessions up to the platform's streak, resetting it on a page that loads", async () => {
    const lost = BrowserTransportErrors.sessionLost({ reason: "the tab closed itself" });
    const fake = fakeTransport({
      visits: visits({ byRoute: { "/a": { failWith: lost }, "/c": { failWith: lost }, "/d": { failWith: lost } } }),
    });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a", "/b", "/c", "/d", "/e"], maxConsecutiveSessionLosses: 2 }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.pages.map((page) => [page.route, page.outcome])).toEqual([
      ["/a", "failed"],
      ["/b", "landed"],
      ["/c", "failed"],
      ["/d", "failed"],
    ]);
    expect(walk.sessionEndedAt).toBe("/c");
    expect(walk.notAttempted).toEqual(["/e"]);
  });

  it("names no ended session when a page after the loss loaded, so a finished walk reports none", async () => {
    const lost = BrowserTransportErrors.sessionLost({ reason: "the tab closed itself" });
    const fake = fakeTransport({ visits: visits({ byRoute: { "/a": { failWith: lost } } }) });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a", "/b"], maxConsecutiveSessionLosses: 2 }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.pages.map((page) => [page.route, page.outcome])).toEqual([
      ["/a", "failed"],
      ["/b", "landed"],
    ]);
    expect(walk.sessionEndedAt).toBe(null);
    expect(walk.notAttempted).toEqual([]);
  });

  it("ends the walk on the first unattached transport whatever the loss streak allows, so the attach runs once", async () => {
    const unattached = BrowserTransportErrors.unavailable({ reason: "extension did not connect within 30s" });
    const lines: string[] = [];
    const fake = fakeTransport({
      visits: visits({ byRoute: { "/b": { failWith: unattached }, "/c": { failWith: unattached } } }),
    });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a", "/b", "/c", "/d"], lines, maxConsecutiveSessionLosses: 2 }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.pages.map((page) => [page.route, page.outcome])).toEqual([
      ["/a", "landed"],
      ["/b", "failed"],
    ]);
    expect(fake.visited).toEqual([`${BASE}/a`, `${BASE}/b`]);
    expect(walk.sessionEndedAt).toBe(null);
    expect(walk.notAttempted).toEqual(["/c", "/d"]);
    expect(lines).toContain(`  /b — failed: ${unattached.message}`);
    expect(fake.releases()).toBe(1);
  });

  it("keeps a run of losses standing across a different failure, since only a page that loads proves the session back", async () => {
    const lost = BrowserTransportErrors.sessionLost({ reason: "the relay dropped" });
    const missed = BrowserTransportErrors.navigationFailed({ because: "timeout", reason: "timed out", url: "/b" });
    const fake = fakeTransport({
      visits: visits({ byRoute: { "/a": { failWith: lost }, "/b": { failWith: missed }, "/c": { failWith: lost } } }),
    });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a", "/b", "/c", "/d"], maxConsecutiveSessionLosses: 2 }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.pages.map((page) => [page.route, page.outcome])).toEqual([
      ["/a", "failed"],
      ["/b", "failed"],
      ["/c", "failed"],
    ]);
    expect(walk.sessionEndedAt).toBe("/a");
    expect(walk.notAttempted).toEqual(["/d"]);
  });

  it("lets the platform end the walk on a graded page, so a sign-in wall is visited once", async () => {
    const fake = fakeTransport({
      visits: visits({
        byRoute: { "/a": { capture: { finalUrl: `${BASE}/login`, links: [`${BASE}/x`] } } },
      }),
    });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a", "/b"] }),
        stopAfter: ({ page }) => page.outcome === "signed-out",
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.pages.map((page) => [page.route, page.outcome])).toEqual([["/a", "signed-out"]]);
    expect(walk.notAttempted).toEqual(["/b", "/x"]);
    expect(walk.sessionEndedAt).toBe(null);
  });

  it("refuses a walk that visited nothing, and still releases the browser", async () => {
    const fake = fakeTransport();

    const result = await runFrontierWalk({
      spec: spec({ declaredRoutes: [] }),
      stopAfter: never,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });

    expect(unwrapErr(result)).toEqual(atlasCaptureErrorLines({ error: AtlasCaptureErrors.walkVisitedNothing() }));
    expect(fake.releases()).toBe(1);
  });

  it("reports a release that failed as progress rather than discarding what the walk saw", async () => {
    const lines: string[] = [];
    const refused = BrowserTransportErrors.sessionLost({ reason: "the relay was already gone" });
    const fake = fakeTransport({ releaseFails: refused });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a"], lines }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.pages.map((page) => page.route)).toEqual(["/a"]);
    expect(lines).toEqual(["  /a — landed (0 call(s))", `  release: ${refused.message}`]);
  });
});
