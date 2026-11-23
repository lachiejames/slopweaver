/**
 * The admin walk, over a deterministic fake transport.
 *
 * The whole point of the seam is that a redirect, a 404, a lost session, an off-origin landing and a
 * missing screenshot are settled here rather than by luck against a live account. Every one of those has a
 * case below, because each produces a DIFFERENT coverage claim and confusing two of them is how a walk
 * reports coverage it never earned.
 */
import { describe, expect, it } from "vitest";

import { outcomeOf, settledOnOrigin, walkGithubAdmin } from "../../../../atlas/github/webWalk.js";
import type { BrowserPageTransport, PageCapture } from "../../../../browser/pageTransport.js";
import { BrowserTransportErrors } from "../../../../browser/pageTransport.js";
import { err, ok, type Result, unwrapErr } from "../../../../lib/result.js";
import { renderedPng } from "../../../pngFixture.js";
import { capture as sharedCapture, fakeTransport as sharedFakeTransport } from "../../../walkTransportFake.js";

const ORIGIN = "https://github.example.test";
const AT = "2026-09-05T00:00:00.000Z";
const PNG = renderedPng();

/** A capture with everything a landed page has, overridable field by field. */
function capture({
  requestedUrl,
  finalUrl,
  statusCode = 200,
  links = [],
  screenshotPng = PNG,
  responses = [],
  bodyFailed = 0,
}: {
  requestedUrl: string;
  finalUrl?: string;
  statusCode?: number | null;
  links?: readonly string[];
  screenshotPng?: Uint8Array | null;
  responses?: PageCapture["responses"];
  bodyFailed?: number;
}): PageCapture {
  return sharedCapture({
    over: {
      ...(finalUrl === undefined ? {} : { finalUrl }),
      links,
      observedAt: AT,
      responseAccounting: {
        bodyFailed,
        bodySucceeded: responses.length,
        eligible: responses.length + bodyFailed,
        seen: responses.length + bodyFailed,
      },
      responses,
      screenshotPng,
      statusCode,
      title: "Settings",
    },
    url: requestedUrl,
  });
}

/** A transport answering from a fixed table, and recording what it was asked for. */
function fakeTransport({
  answers,
}: {
  answers: ReadonlyMap<string, Result<PageCapture, ReturnType<typeof BrowserTransportErrors.sessionLost>>>;
}): BrowserPageTransport & { visited: readonly string[]; released: number } {
  const fake = sharedFakeTransport({
    answer: ({ url }) => {
      const scripted = answers.get(url);
      if (scripted === undefined) {
        return { capture: capture({ requestedUrl: url }) };
      }
      if (scripted.isErr()) {
        return { failWith: scripted.error };
      }
      return { capture: scripted.value };
    },
  });
  return {
    ...fake.transport,
    get released() {
      return fake.releases();
    },
    visited: fake.visited,
  };
}

/** Collect every artifact the walk asked to write. */
function collectingWriter(): {
  write: (input: { relativePath: string; bytes: Uint8Array }) => Result<null>;
  paths: string[];
} {
  const paths: string[] = [];
  return {
    paths,
    write: ({ relativePath }) => {
      paths.push(relativePath);
      return ok(null);
    },
  };
}

describe("settledOnOrigin", () => {
  it("accepts a page that stayed on the origin", () => {
    expect(settledOnOrigin({ capture: capture({ requestedUrl: `${ORIGIN}/settings` }), origin: ORIGIN })).toBe(true);
  });

  it("rejects a page that landed on a different origin answering 200", () => {
    expect(
      settledOnOrigin({
        capture: capture({ finalUrl: "https://marketing.example.test/", requestedUrl: `${ORIGIN}/settings` }),
        origin: ORIGIN,
      }),
    ).toBe(false);
  });
});

describe("outcomeOf", () => {
  it("grades a page that rendered and was photographed as landed", () => {
    expect(outcomeOf({ capture: capture({ requestedUrl: `${ORIGIN}/settings` }), origin: ORIGIN })).toBe("landed");
  });

  it("grades a 404 as unavailable", () => {
    expect(
      outcomeOf({ capture: capture({ requestedUrl: `${ORIGIN}/settings`, statusCode: 404 }), origin: ORIGIN }),
    ).toBe("unavailable");
  });

  it("grades a redirect as redirected rather than as a success elsewhere", () => {
    expect(
      outcomeOf({
        capture: capture({ finalUrl: `${ORIGIN}/login`, requestedUrl: `${ORIGIN}/settings` }),
        origin: ORIGIN,
      }),
    ).toBe("redirected");
  });

  it("grades a page that rendered without a screenshot as unphotographed, never as landed", () => {
    expect(
      outcomeOf({ capture: capture({ requestedUrl: `${ORIGIN}/settings`, screenshotPng: null }), origin: ORIGIN }),
    ).toBe("unphotographed");
  });
});

describe("walkGithubAdmin", () => {
  it("refuses a walk with no seeds rather than reporting coverage over nothing", async () => {
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: [],
      transport: fakeTransport({ answers: new Map() }),
      writeArtifact: collectingWriter().write,
    });
    expect(walked.isErr()).toBe(true);
    expect(walked._unsafeUnwrapErr()[0]).toContain("no settings seeds");
  });

  it("prints the no-seeds refusal as one exact line", async () => {
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: [],
      transport: fakeTransport({ answers: new Map() }),
      writeArtifact: collectingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual([
      "no settings seeds were supplied, so a walk would report full coverage over nothing",
    ]);
  });

  it("expands the frontier from the links a landed page rendered, and closes when nothing is new", async () => {
    const answers = new Map([
      [
        `${ORIGIN}/settings/profile`,
        ok(capture({ links: [`${ORIGIN}/settings/security`], requestedUrl: `${ORIGIN}/settings/profile` })),
      ],
      [
        `${ORIGIN}/settings/security`,
        ok(capture({ links: [`${ORIGIN}/settings/profile`], requestedUrl: `${ORIGIN}/settings/security` })),
      ],
    ]);
    const writer = collectingWriter();
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: ["/settings/profile"],
      transport: fakeTransport({ answers }),
      writeArtifact: writer.write,
    });
    const result = walked._unsafeUnwrap();
    expect(result.pages.map((page) => page.path)).toEqual(["/settings/profile", "/settings/security"]);
    expect(result.frontierRemaining).toEqual([]);
    expect(result.roundsRun).toBe(2);
    expect(result.artifactsWritten).toBe(2);
  });

  it("records which page a discovered link came from", async () => {
    const answers = new Map([
      [
        `${ORIGIN}/settings/profile`,
        ok(capture({ links: [`${ORIGIN}/settings/security`], requestedUrl: `${ORIGIN}/settings/profile` })),
      ],
    ]);
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: ["/settings/profile"],
      transport: fakeTransport({ answers }),
      writeArtifact: collectingWriter().write,
    });
    const discovered = walked._unsafeUnwrap().pages.find((page) => page.path === "/settings/security")!;
    expect(discovered.discoveredFrom).toBe("/settings/profile");
  });

  it("stops the whole walk on a lost session and reports the rest as not-attempted", async () => {
    const answers = new Map([
      [`${ORIGIN}/settings/a`, err(BrowserTransportErrors.sessionLost({ reason: "signed out" }))],
    ]);
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: ["/settings/a", "/settings/b"],
      transport: fakeTransport({ answers }),
      writeArtifact: collectingWriter().write,
    });
    const result = walked._unsafeUnwrap();
    expect(result.notAttempted).toEqual(["/settings/a", "/settings/b"]);
    expect(result.artifactsWritten).toBe(0);
  });

  it("keeps walking past one page that failed to navigate", async () => {
    const answers = new Map([
      [
        `${ORIGIN}/settings/a`,
        err(
          BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "timeout",
            url: `${ORIGIN}/settings/a`,
          }),
        ),
      ],
    ]);
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: ["/settings/a", "/settings/b"],
      transport: fakeTransport({ answers }),
      writeArtifact: collectingWriter().write,
    });
    const result = walked._unsafeUnwrap();
    expect(result.pages.map((page) => page.outcome)).toEqual(["failed", "landed"]);
  });

  it("leaves the frontier non-empty when the round cap cuts expansion off", async () => {
    const answers = new Map([
      [
        `${ORIGIN}/settings/profile`,
        ok(capture({ links: [`${ORIGIN}/settings/security`], requestedUrl: `${ORIGIN}/settings/profile` })),
      ],
    ]);
    const walked = await walkGithubAdmin({
      maxRounds: 1,
      origin: ORIGIN,
      seeds: ["/settings/profile"],
      transport: fakeTransport({ answers }),
      writeArtifact: collectingWriter().write,
    });
    const result = walked._unsafeUnwrap();
    expect(result.frontierRemaining).toEqual(["/settings/security"]);
    expect(result.roundsRun).toBe(1);
  });

  it("does not credit a page whose screenshot could not be written", async () => {
    const answers = new Map([
      [`${ORIGIN}/settings/profile`, ok(capture({ requestedUrl: `${ORIGIN}/settings/profile` }))],
    ]);
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: ["/settings/profile"],
      transport: fakeTransport({ answers }),
      writeArtifact: () => err(["disk full"]),
    });
    const result = walked._unsafeUnwrap();
    expect(result.pages[0]!.outcome).toBe("unphotographed");
    expect(result.artifactsWritten).toBe(0);
  });

  it("names a page that lost a response body", async () => {
    const answers = new Map([
      [`${ORIGIN}/settings/profile`, ok(capture({ bodyFailed: 2, requestedUrl: `${ORIGIN}/settings/profile` }))],
    ]);
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: ["/settings/profile"],
      transport: fakeTransport({ answers }),
      writeArtifact: collectingWriter().write,
    });
    expect(walked._unsafeUnwrap().incompletePages).toEqual(["/settings/profile"]);
  });

  it("releases the transport so the next session can take the shared relay", async () => {
    const transport = fakeTransport({ answers: new Map() });
    await walkGithubAdmin({
      origin: ORIGIN,
      seeds: ["/settings/profile"],
      transport,
      writeArtifact: collectingWriter().write,
    });
    expect(transport.released).toBe(1);
  });

  it("does not follow a link off the admin surface", async () => {
    const answers = new Map([
      [
        `${ORIGIN}/settings/profile`,
        ok(
          capture({ links: [`${ORIGIN}/example-org/example-repo/pulls`], requestedUrl: `${ORIGIN}/settings/profile` }),
        ),
      ],
    ]);
    const walked = await walkGithubAdmin({
      origin: ORIGIN,
      seeds: ["/settings/profile"],
      transport: fakeTransport({ answers }),
      writeArtifact: collectingWriter().write,
    });
    expect(walked._unsafeUnwrap().pages.map((page) => page.path)).toEqual(["/settings/profile"]);
  });
});
