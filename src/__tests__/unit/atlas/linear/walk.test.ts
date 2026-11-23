import { describe, expect, it } from "vitest";

import type { LinearPlannedPage } from "../../../../atlas/linear/routes.js";
import { screenshotArtifact, walkLinearSettings } from "../../../../atlas/linear/walk.js";
import type { BrowserPageTransport, PageCapture } from "../../../../browser/pageTransport.js";
import { BrowserTransportErrors } from "../../../../browser/pageTransport.js";
import { ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { renderedPng, unrenderedPng } from "../../../pngFixture.js";
import { capture as sharedCapture, fakeTransport as sharedFakeTransport } from "../../../walkTransportFake.js";

const PNG = renderedPng();

const page = ({ path }: { path: string }): LinearPlannedPage => ({
  area: "workspace",
  pageScope: "workspace",
  providerId: path,
  url: `https://linear.app/acme${path}`,
});

/** A deterministic fake transport. Not a mock: a plain object satisfying the seam, injected by the caller. */
function fakeTransport({
  answers,
}: {
  answers: ReadonlyMap<string, Result<PageCapture, ReturnType<typeof BrowserTransportErrors.sessionLost>>>;
}): BrowserPageTransport {
  return sharedFakeTransport({
    answer: ({ url }) => {
      const scripted = answers.get(url);
      if (scripted === undefined) {
        return { capture: LINEAR_PAGE };
      }
      if (scripted.isErr()) {
        return { failWith: scripted.error };
      }
      return { capture: scripted.value };
    },
  }).transport;
}

/** What is LINEAR's about a capture, over the shared fake's own defaults. */
const LINEAR_PAGE: Partial<PageCapture> = { screenshotPng: PNG, title: "Settings" };

const capture = (over: Partial<PageCapture>): PageCapture =>
  sharedCapture({
    over: { screenshotPng: PNG, title: "Members", ...over },
    url: "https://linear.app/acme/settings/members",
  });

describe("walkLinearSettings", () => {
  it("refuses a walk over no pages rather than reporting full coverage of nothing", async () => {
    const walked = await walkLinearSettings({
      pages: [],
      transport: fakeTransport({ answers: new Map() }),
      writeArtifact: () => ok(null),
    });
    expect(unwrapErr(walked)).toEqual([
      "no settings page was planned, so a walk would report full coverage over nothing",
    ]);
  });

  it("records a photographed page as reached", async () => {
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/members" })],
      transport: fakeTransport({ answers: new Map() }),
      writeArtifact: () => ok(null),
    });
    expect(walked.isOk()).toBe(true);
    expect(walked._unsafeUnwrap().pages[0]!.outcome).toBe("reached");
    expect(walked._unsafeUnwrap().artifactsWritten).toBe(1);
  });

  it("records a page it could not photograph as unphotographed, never as reached", async () => {
    const url = "https://linear.app/acme/settings/members";
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/members" })],
      transport: fakeTransport({ answers: new Map([[url, ok(capture({ screenshotPng: null }))]]) }),
      writeArtifact: () => ok(null),
    });
    expect(walked._unsafeUnwrap().pages[0]!.outcome).toBe("unphotographed");
    expect(walked._unsafeUnwrap().artifactsWritten).toBe(0);
  });

  it("records a page still loading in both looks as unphotographed, never as reached", async () => {
    const url = "https://linear.app/acme/settings/members";
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/members" })],
      transport: fakeTransport({ answers: new Map([[url, ok(capture({ screenshotPng: unrenderedPng() }))]]) }),
      writeArtifact: () => ok(null),
    });
    expect(unwrap(walked).pages[0]!.outcome).toBe("unphotographed");
    expect(unwrap(walked).artifactsWritten).toBe(0);
  });

  it("records a page that settled on a different ORIGIN as redirected", async () => {
    const url = "https://linear.app/acme/settings/billing";
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/billing" })],
      transport: fakeTransport({
        answers: new Map([
          [url, ok(capture({ finalUrl: "https://www.linear-marketing.test/pricing", requestedUrl: url }))],
        ]),
      }),
      writeArtifact: () => ok(null),
    });
    expect(walked._unsafeUnwrap().pages[0]!.outcome).toBe("redirected");
  });

  it("records a page that settled on a different PATH as redirected", async () => {
    const url = "https://linear.app/acme/settings/security";
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/security" })],
      transport: fakeTransport({
        answers: new Map([
          [url, ok(capture({ finalUrl: "https://linear.app/acme/settings/account/preferences", requestedUrl: url }))],
        ]),
      }),
      writeArtifact: () => ok(null),
    });
    expect(walked._unsafeUnwrap().pages[0]!.outcome).toBe("redirected");
  });

  it("treats a trailing slash as the same path rather than as a redirect", async () => {
    const url = "https://linear.app/acme/settings/labels";
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/labels" })],
      transport: fakeTransport({
        answers: new Map([[url, ok(capture({ finalUrl: `${url}/`, requestedUrl: url }))]]),
      }),
      writeArtifact: () => ok(null),
    });
    expect(walked._unsafeUnwrap().pages[0]!.outcome).toBe("reached");
  });

  it("stops the walk on a lost session and reports the rest as not attempted", async () => {
    const first = "https://linear.app/acme/settings/members";
    const transport: BrowserPageTransport = {
      release: async () => ok(null),
      visit: async ({ url }) =>
        url === first
          ? ({
              isErr: () => true,
              isOk: () => false,
              error: BrowserTransportErrors.sessionLost({ reason: "gone" }),
            } as never)
          : ok(capture({ finalUrl: url, requestedUrl: url })),
    };
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/members" }), page({ path: "/settings/labels" })],
      transport,
      writeArtifact: () => ok(null),
    });
    expect(walked._unsafeUnwrap().notAttempted).toEqual(["/settings/members", "/settings/labels"]);
  });

  it("names a page whose capture lost a response body", async () => {
    const url = "https://linear.app/acme/settings/members";
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/members" })],
      transport: fakeTransport({
        answers: new Map([
          [url, ok(capture({ responseAccounting: { bodyFailed: 2, bodySucceeded: 3, eligible: 5, seen: 9 } }))],
        ]),
      }),
      writeArtifact: () => ok(null),
    });
    expect(walked._unsafeUnwrap().incompletePages).toEqual(["/settings/members"]);
  });

  it("carries the captured request body through, so a document can be parsed later", async () => {
    const url = "https://linear.app/acme/settings/members";
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/members" })],
      transport: fakeTransport({
        answers: new Map([
          [
            url,
            ok(
              capture({
                responses: [
                  {
                    body: { data: {} },
                    method: "POST",
                    requestBody: '{"query":"query { teams { id } }"}',
                    statusCode: 200,
                    url: "https://client-api.linear.app/graphql",
                  },
                ],
              }),
            ),
          ],
        ]),
      }),
      writeArtifact: () => ok(null),
    });
    expect(walked._unsafeUnwrap().responses[0]!.requestBody).toBe('{"query":"query { teams { id } }"}');
  });

  it("keeps the page when its screenshot cannot be written, but does not call it reached", async () => {
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/members" })],
      transport: fakeTransport({ answers: new Map() }),
      writeArtifact: () => ({ isErr: () => true, isOk: () => false, error: ["disk full"] }) as never,
    });
    expect(walked._unsafeUnwrap().pages[0]!.outcome).toBe("unphotographed");
  });
});

describe("screenshotArtifact", () => {
  it("addresses a screenshot by the digest of its own bytes", () => {
    // Three literal bytes rather than the walk's own fixture: this asserts the addressing, which is a
    // property of the digest and the length alone, and a fixture sized to pass the render grade would put
    // 95,000 in an assertion about naming.
    const ref = screenshotArtifact({ bytes: new Uint8Array([1, 2, 3]) });
    expect(ref.sha256).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    expect(ref.relativePath).toBe(`artifacts/settings/${ref.sha256}.png`);
    expect(ref.byteLength).toBe(3);
    expect(ref.kind).toBe("page-png");
  });
});

describe("walkLinearSettings under --limit", () => {
  it("records every route past the limit as not-attempted, so the denominator survives", async () => {
    const walked = await walkLinearSettings({
      limit: 1,
      pages: [
        page({ path: "/settings/members" }),
        page({ path: "/settings/labels" }),
        page({ path: "/settings/teams" }),
      ],
      transport: fakeTransport({ answers: new Map() }),
      writeArtifact: () => ok(null),
    });
    const result = walked._unsafeUnwrap();
    expect(result.pages.map((observed) => observed.outcome)).toEqual(["reached", "not-attempted", "not-attempted"]);
    expect(result.notAttempted).toEqual(["/settings/labels", "/settings/teams"]);
  });

  it("visits every page when no limit is given", async () => {
    const walked = await walkLinearSettings({
      pages: [page({ path: "/settings/members" }), page({ path: "/settings/labels" })],
      transport: fakeTransport({ answers: new Map() }),
      writeArtifact: () => ok(null),
    });
    expect(walked._unsafeUnwrap().notAttempted).toEqual([]);
  });
});
