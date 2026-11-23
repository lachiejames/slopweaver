/*
 * How the frontier walk grows and what it keeps: the declared routes first, then what each landed page rendered,
 * bounded by the platform's rounds, crediting a page only with the picture actually written, and keeping only the
 * first-party calls it saw.
 */
import { describe, expect, it } from "vitest";

import { err, unwrap } from "#lib/result.js";
import { screenshotArtifact } from "../../../../../atlas/kit/browserWalk.js";
import { runFrontierWalk } from "../../../../../atlas/kit/frontierWalk.js";
import type { PageCapture } from "../../../../../browser/pageTransport.js";
import { renderedPng } from "../../../../pngFixture.js";
import { fakeTransport, recordingWriter } from "../../../../walkTransportFake.js";

import { BASE, never, rendering, spec, visits } from "./harness.js";

describe("runFrontierWalk", () => {
  it("walks the declared routes, then what the landed pages rendered, each naming the page that found it", async () => {
    const fake = fakeTransport({
      visits: visits({
        byRoute: {
          "/billing": rendering({ routes: ["/home"] }),
          "/home": rendering({ routes: ["/settings", "/billing", "/team"] }),
          "/settings": rendering({ routes: ["/billing", "/audit"] }),
        },
      }),
    });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/home", "/settings", "/home"] }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.pages.map((page) => [page.route, page.discoveredFrom, page.outcome])).toEqual([
      ["/home", null, "landed"],
      ["/settings", null, "landed"],
      ["/billing", "/home", "landed"],
      ["/team", "/home", "landed"],
      ["/audit", "/settings", "landed"],
    ]);
    expect(fake.visited).toEqual(
      ["/home", "/settings", "/billing", "/team", "/audit"].map((route) => `${BASE}${route}`),
    );
    expect(walk.roundsRun).toBe(2);
    expect(walk.notAttempted).toEqual([]);
    expect(walk.sessionEndedAt).toBe(null);
    expect(fake.releases()).toBe(1);
  });

  it("stops expanding at maxRounds, leaving what the last round rendered on its pages but unvisited", async () => {
    const fake = fakeTransport({ visits: visits({ byRoute: { "/home": rendering({ routes: ["/team"] }) } }) });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/home"], maxRounds: 1 }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.roundsRun).toBe(1);
    expect(walk.pages.map((page) => page.route)).toEqual(["/home"]);
    expect(walk.pages[0]!.linksRendered).toEqual(["/team"]);
    expect(walk.notAttempted).toEqual([]);
  });

  it("credits a landed page only with its picture, and counts only the screenshots written", async () => {
    const fake = fakeTransport({
      visits: visits({
        byRoute: {
          "/a": { capture: { screenshotPng: renderedPng({ seed: 1 }) } },
          "/b": { capture: { screenshotPng: null } },
          "/c": { capture: { finalUrl: `${BASE}/elsewhere`, screenshotPng: null } },
        },
      }),
    });
    const writer = recordingWriter();

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a", "/b", "/c"] }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: writer.write,
      }),
    );

    const shot = screenshotArtifact({ bytes: renderedPng({ seed: 1 }), directory: "shots" });
    expect(walk.pages.map((page) => [page.route, page.outcome])).toEqual([
      ["/a", "landed"],
      ["/b", "unphotographed"],
      ["/c", "redirected"],
    ]);
    expect(walk.pages[0]!.artifacts).toEqual([shot]);
    expect(walk.artifactsWritten).toBe(1);
    expect(writer.written).toEqual([shot.relativePath]);
  });

  it("grades a landed page unphotographed when the verified write refuses its screenshot", async () => {
    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a"] }),
        stopAfter: never,
        transport: fakeTransport().transport,
        writeArtifact: () => err(["digest mismatch on read-back"]),
      }),
    );

    expect(walk.pages[0]!.outcome).toBe("unphotographed");
    expect(walk.pages[0]!.artifacts).toEqual([]);
    expect(walk.artifactsWritten).toBe(0);
  });

  it("keeps only first-party calls, and names a page whose response bodies were not all read", async () => {
    const accounting = { bodyFailed: 1, bodySucceeded: 1, eligible: 2, seen: 4 };
    const response = ({ url }: { url: string }): PageCapture["responses"][number] => ({
      body: {},
      method: "GET",
      statusCode: 200,
      url,
    });
    const fake = fakeTransport({
      visits: visits({
        byRoute: {
          "/a": {
            capture: {
              responseAccounting: accounting,
              responses: [
                response({ url: "https://api.example.com/v1/users" }),
                response({ url: "https://analytics.example.net/track" }),
                response({ url: "https://api.example.com/v1/teams" }),
              ],
            },
          },
        },
      }),
    });

    const walk = unwrap(
      await runFrontierWalk({
        spec: spec({ declaredRoutes: ["/a", "/b"] }),
        stopAfter: never,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );

    expect(walk.calls).toEqual([
      "/a → GET https://api.example.com/v1/users",
      "/a → GET https://api.example.com/v1/teams",
    ]);
    expect(walk.incompletePages).toEqual(["/a"]);
    expect(walk.pages[0]!.responseAccounting).toEqual(accounting);
  });
});
