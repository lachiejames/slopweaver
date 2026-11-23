import { describe, expect, it } from "vitest";

import {
  type ArtifactWriter,
  isRecordableResponse,
  outcomeOf,
  walkFalconConsole,
} from "../../../../atlas/crowdstrike/consoleWalk.js";
import type { FalconRouteDeclaration } from "../../../../atlas/crowdstrike/sitemap.js";
import { screenshotArtifact } from "../../../../atlas/kit/browserWalk.js";
import type { BrowserPageTransport, BrowserTransportError, PageCapture } from "../../../../browser/pageTransport.js";
import { BrowserTransportErrors } from "../../../../browser/pageTransport.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { unrenderedPng } from "../../../pngFixture.js";
import { capture as sharedCapture, fakeTransport as sharedFakeTransport } from "../../../walkTransportFake.js";

/** One scripted answer, typed at the union so a map may mix a capture and a failure. */
type ScriptedVisit = Result<PageCapture, BrowserTransportError>;

const ORIGIN = "https://falcon.example-cloud.test";
const AT = "2026-09-04T00:00:00.000Z";

function route({ href }: { href: string }): FalconRouteDeclaration {
  return { appName: "example", featureFlags: [], href, permissions: [] };
}

function capture({
  requestedUrl,
  finalUrl,
  statusCode = 200,
  bodyFailed = 0,
  responses = [],
}: {
  requestedUrl: string;
  finalUrl?: string;
  statusCode?: number | null;
  bodyFailed?: number;
  responses?: PageCapture["responses"];
}): PageCapture {
  return sharedCapture({
    over: {
      ...(finalUrl === undefined ? {} : { finalUrl }),
      observedAt: AT,
      responseAccounting: {
        bodyFailed,
        bodySucceeded: responses.length,
        eligible: responses.length + bodyFailed,
        seen: 9,
      },
      responses,
      statusCode,
      title: "Example",
    },
    url: requestedUrl,
  });
}

/** A deterministic transport: one scripted answer per URL, and a record of what was asked for. */
function fakeTransport({ answers }: { answers: Map<string, ScriptedVisit> }): {
  transport: BrowserPageTransport;
  visited: readonly string[];
  released: { count: number };
} {
  const fake = sharedFakeTransport({
    answer: ({ url }) => {
      const scripted = answers.get(url);
      if (scripted === undefined) {
        return {
          failWith: BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "no scripted answer",
            url,
          }),
        };
      }
      if (scripted.isErr()) {
        return { failWith: scripted.error };
      }
      return { capture: scripted.value };
    },
  });
  return {
    released: {
      get count() {
        return fake.releases();
      },
    },
    transport: fake.transport,
    visited: fake.visited,
  };
}

const collectingWriter = (): { writer: ArtifactWriter; written: string[] } => {
  const written: string[] = [];
  return {
    writer: ({ relativePath }) => {
      written.push(relativePath);
      return ok(null);
    },
    written,
  };
};

describe("screenshotArtifact", () => {
  it("addresses a screenshot by the digest of its own bytes", () => {
    const ref = screenshotArtifact({ directory: "artifacts/console", bytes: new Uint8Array([1, 2, 3]) });
    expect(ref.kind).toBe("page-png");
    expect(ref.byteLength).toBe(3);
    expect(ref.relativePath).toBe(`artifacts/console/${ref.sha256}.png`);
    expect(ref.sha256).toHaveLength(64);
  });

  it("gives the same bytes the same address", () => {
    const first = screenshotArtifact({ directory: "artifacts/console", bytes: new Uint8Array([9, 9]) });
    const second = screenshotArtifact({ directory: "artifacts/console", bytes: new Uint8Array([9, 9]) });
    expect(first.sha256).toBe(second.sha256);
  });
});

describe("outcomeOf", () => {
  it("calls a settled page landed", () => {
    expect(outcomeOf({ capture: capture({ requestedUrl: `${ORIGIN}/a` }) })).toBe("landed");
  });

  it("calls a page that settled elsewhere redirected, never landed", () => {
    expect(outcomeOf({ capture: capture({ finalUrl: `${ORIGIN}/hub`, requestedUrl: `${ORIGIN}/a` }) })).toBe(
      "redirected",
    );
  });

  it("calls a 404 unavailable", () => {
    expect(outcomeOf({ capture: capture({ requestedUrl: `${ORIGIN}/a`, statusCode: 404 }) })).toBe("unavailable");
  });
});

describe("isRecordableResponse", () => {
  it("keeps a same-origin JSON response", () => {
    expect(isRecordableResponse({ origin: ORIGIN, response: { body: { a: 1 }, url: `${ORIGIN}/api2/x` } })).toBe(true);
  });

  it("drops a third-party beacon", () => {
    expect(
      isRecordableResponse({ origin: ORIGIN, response: { body: { a: 1 }, url: "https://analytics.example.test/x" } }),
    ).toBe(false);
  });

  it("drops a response with no parsed body", () => {
    expect(isRecordableResponse({ origin: ORIGIN, response: { body: null, url: `${ORIGIN}/api2/x` } })).toBe(false);
  });
});

describe("walkFalconConsole", () => {
  it("REFUSES to walk an empty route list rather than reporting full coverage over nothing", async () => {
    const { transport } = fakeTransport({ answers: new Map() });
    const { writer } = collectingWriter();
    const problems = unwrapErr(
      await walkFalconConsole({ origin: ORIGIN, routes: [], transport, writeArtifact: writer }),
    );
    expect(problems[0]).toContain("declared no routes");
  });

  it("records a redirect as a completed attempt, not a walk failure", async () => {
    const answers = new Map<string, ScriptedVisit>([
      [`${ORIGIN}/a`, ok(capture({ finalUrl: `${ORIGIN}/hub`, requestedUrl: `${ORIGIN}/a` }))],
    ]);
    const { transport } = fakeTransport({ answers });
    const { writer } = collectingWriter();
    const walk = unwrap(
      await walkFalconConsole({ origin: ORIGIN, routes: [route({ href: "/a" })], transport, writeArtifact: writer }),
    );
    expect(walk.pages.map((page) => page.outcome)).toEqual(["redirected"]);
    expect(walk.notAttempted).toEqual([]);
  });

  it("keeps walking past one page that failed", async () => {
    const answers = new Map<string, ScriptedVisit>([
      [
        `${ORIGIN}/a`,
        err(
          BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "gated",
            url: `${ORIGIN}/a`,
          }),
        ),
      ],
      [`${ORIGIN}/b`, ok(capture({ requestedUrl: `${ORIGIN}/b` }))],
    ]);
    const { transport, visited } = fakeTransport({ answers });
    const { writer } = collectingWriter();
    const walk = unwrap(
      await walkFalconConsole({
        origin: ORIGIN,
        routes: [route({ href: "/a" }), route({ href: "/b" })],
        transport,
        writeArtifact: writer,
      }),
    );
    expect(visited).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`]);
    expect(walk.pages.map((page) => page.outcome)).toEqual(["failed", "landed"]);
  });

  it("STOPS on a lost session and marks the rest not-attempted rather than failed", async () => {
    const answers = new Map<string, ScriptedVisit>([
      [`${ORIGIN}/a`, ok(capture({ requestedUrl: `${ORIGIN}/a` }))],
      [`${ORIGIN}/b`, err(BrowserTransportErrors.sessionLost({ reason: "signed out" }))],
    ]);
    const { transport, visited } = fakeTransport({ answers });
    const { writer } = collectingWriter();
    const walk = unwrap(
      await walkFalconConsole({
        origin: ORIGIN,
        routes: [route({ href: "/a" }), route({ href: "/b" }), route({ href: "/c" })],
        transport,
        writeArtifact: writer,
      }),
    );
    expect(visited).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`]);
    expect(walk.pages.map((page) => page.outcome)).toEqual(["landed", "not-attempted", "not-attempted"]);
    expect(walk.notAttempted).toEqual(["/b", "/c"]);
  });

  it("names a page whose response bodies were not all captured", async () => {
    const answers = new Map<string, ScriptedVisit>([
      [`${ORIGIN}/a`, ok(capture({ bodyFailed: 2, requestedUrl: `${ORIGIN}/a` }))],
    ]);
    const { transport } = fakeTransport({ answers });
    const { writer } = collectingWriter();
    const walk = unwrap(
      await walkFalconConsole({ origin: ORIGIN, routes: [route({ href: "/a" })], transport, writeArtifact: writer }),
    );
    expect(walk.incompletePages).toEqual(["/a"]);
  });

  it("writes one artifact per photographed page and releases the transport", async () => {
    const answers = new Map<string, ScriptedVisit>([
      [`${ORIGIN}/a`, ok(capture({ requestedUrl: `${ORIGIN}/a` }))],
      [`${ORIGIN}/b`, ok(capture({ requestedUrl: `${ORIGIN}/b` }))],
    ]);
    const { transport, released } = fakeTransport({ answers });
    const { writer, written } = collectingWriter();
    const walk = unwrap(
      await walkFalconConsole({
        origin: ORIGIN,
        routes: [route({ href: "/a" }), route({ href: "/b" })],
        transport,
        writeArtifact: writer,
      }),
    );
    expect(walk.artifactsWritten).toBe(2);
    expect(written).toHaveLength(2);
    expect(released.count).toBe(1);
  });

  it("writes NOTHING for a page photographed mid-load, and names it as a gap instead", async () => {
    const answers = new Map<string, ScriptedVisit>([
      [`${ORIGIN}/a`, ok(capture({ requestedUrl: `${ORIGIN}/a` }))],
      [`${ORIGIN}/b`, ok({ ...capture({ requestedUrl: `${ORIGIN}/b` }), screenshotPng: unrenderedPng() })],
    ]);
    const { transport } = fakeTransport({ answers });
    const { writer, written } = collectingWriter();
    const walk = unwrap(
      await walkFalconConsole({
        origin: ORIGIN,
        routes: [route({ href: "/a" }), route({ href: "/b" })],
        transport,
        writeArtifact: writer,
      }),
    );
    expect(walk.artifactsWritten).toBe(1);
    expect(written).toHaveLength(1);
    expect(walk.unrenderedPages).toEqual(["/b"]);
    // The page itself still landed — it was reached, it just was not photographed.
    expect(walk.pages.map((page) => page.outcome)).toEqual(["landed", "landed"]);
    expect(walk.pages[1]!.artifacts).toEqual([]);
  });

  it("reports no unrendered pages when every capture is a picture of something", async () => {
    const answers = new Map<string, ScriptedVisit>([[`${ORIGIN}/a`, ok(capture({ requestedUrl: `${ORIGIN}/a` }))]]);
    const { transport } = fakeTransport({ answers });
    const walk = unwrap(
      await walkFalconConsole({
        origin: ORIGIN,
        routes: [route({ href: "/a" })],
        transport,
        writeArtifact: collectingWriter().writer,
      }),
    );
    expect(walk.unrenderedPages).toEqual([]);
  });

  it("does not blame the grade for a write that simply failed", async () => {
    const answers = new Map<string, ScriptedVisit>([[`${ORIGIN}/a`, ok(capture({ requestedUrl: `${ORIGIN}/a` }))]]);
    const { transport } = fakeTransport({ answers });
    const walk = unwrap(
      await walkFalconConsole({
        origin: ORIGIN,
        routes: [route({ href: "/a" })],
        transport,
        writeArtifact: () => err(["disk full"]),
      }),
    );
    expect(walk.artifactsWritten).toBe(0);
    expect(walk.unrenderedPages).toEqual([]);
  });

  it("accumulates one endpoint row across the pages that called it", async () => {
    const response = {
      body: { resources: [{ id: "x" }] },
      method: "GET",
      statusCode: 200,
      url: `${ORIGIN}/api2/devices/queries/devices/v2?limit=20`,
    };
    const answers = new Map<string, ScriptedVisit>([
      [`${ORIGIN}/a`, ok(capture({ requestedUrl: `${ORIGIN}/a`, responses: [response] }))],
      [`${ORIGIN}/b`, ok(capture({ requestedUrl: `${ORIGIN}/b`, responses: [response] }))],
    ]);
    const { transport } = fakeTransport({ answers });
    const { writer } = collectingWriter();
    const walk = unwrap(
      await walkFalconConsole({
        origin: ORIGIN,
        routes: [route({ href: "/a" }), route({ href: "/b" })],
        transport,
        writeArtifact: writer,
      }),
    );
    expect(walk.requests).toHaveLength(1);
    expect(walk.requests[0]!.observedOnPages).toEqual(["/a", "/b"]);
    expect(walk.requests[0]!.paramNames).toEqual(["limit"]);
  });
});

describe("walkFalconConsole's empty-route refusal, line for line", () => {
  it("refuses with exactly one line before visiting, writing or releasing anything", async () => {
    const { transport, visited, released } = fakeTransport({ answers: new Map() });
    const { writer, written } = collectingWriter();
    const problems = unwrapErr(
      await walkFalconConsole({ origin: ORIGIN, routes: [], transport, writeArtifact: writer }),
    );
    expect(problems).toEqual([
      "the Falcon sitemap declared no routes, so a walk would report full coverage over nothing",
    ]);
    expect(visited).toEqual([]);
    expect(written).toEqual([]);
    expect(released.count).toBe(0);
  });
});
