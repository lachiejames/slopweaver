import { describe, expect, it } from "vitest";

import { isPageHeld } from "../../../../atlas/kit/pageWalk.js";
import { VANTA_BROWSER_PAGES, vantaControlPage } from "../../../../atlas/vanta/browserPages.js";
import { vantaPageOutcome, walkVantaBrowser } from "../../../../atlas/vanta/browserWalk.js";
import type { PageCapture } from "../../../../browser/pageTransport.js";
import { unwrap } from "../../../../lib/result.js";
import { renderedPng } from "../../../pngFixture.js";

import { capture, type FakeVisit, fakeTransport, recordingWriter } from "../../../walkTransportFake.js";

const TENANT_ROOT = "https://app.vanta.com/c/acme";
const PROBE = "https://app.vanta.com/tests";

/** Every URL answering as itself, with the bare probe landing on a tenanted address. */
function signedIn({ visits = {} }: { visits?: Readonly<Record<string, FakeVisit>> } = {}) {
  return fakeTransport({
    visits: { [PROBE]: { capture: { finalUrl: `${TENANT_ROOT}/tests` } }, ...visits },
  });
}

/**
 * One distinct picture per declared page, which is what a real client rendering twelve different pages
 * produces. Stated rather than defaulted: the fake answers ONE picture for every URL, and twelve identical
 * shots are the case the kit deliberately withdraws every claim for.
 */
function distinctShots(): Readonly<Record<string, FakeVisit>> {
  return Object.fromEntries(
    VANTA_BROWSER_PAGES.map((page, index): [string, FakeVisit] => [
      urlOf({ surface: page.surface }),
      { capture: { screenshotPng: renderedPng({ seed: index + 1 }) } },
    ]),
  );
}

/** Walk the declared list over one fake, with a writer that records what it was asked to store. */
async function walk({ visits = {} }: { visits?: Readonly<Record<string, FakeVisit>> } = {}) {
  const fake = signedIn({ visits: { ...distinctShots(), ...visits } });
  const writer = recordingWriter();
  const walked = await walkVantaBrowser({
    transport: fake.transport,
    writeArtifact: writer.write,
  });
  return { fake, result: unwrap(walked), writer };
}

/** The absolute address one declared surface is asked for at. */
function urlOf({ surface }: { surface: string }): string {
  const page = VANTA_BROWSER_PAGES.find((candidate) => candidate.surface === surface)!;
  const url = new URL(`${TENANT_ROOT}/${page.path}`);
  for (const [key, value] of Object.entries(page.query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

describe("walkVantaBrowser", () => {
  it("learns the tenant root from where the bare probe landed, and never from a constant", async () => {
    const { fake, result } = await walk();
    expect(result.rootFound).toBe(true);
    expect(fake.visited[0]).toBe(PROBE);
    expect(fake.visited[1]).toBe(urlOf({ surface: "tests-collection" }));
  });

  it("visits every declared page", async () => {
    const { result } = await walk();
    expect(result.pages.map((page) => page.surface)).toEqual(VANTA_BROWSER_PAGES.map((page) => page.surface));
  });

  it("photographs every page it reaches and hands the bytes to the writer — the whole point of the rewrite", async () => {
    const { result, writer } = await walk();
    expect(result.pages.filter((page) => isPageHeld({ page })).length).toBe(VANTA_BROWSER_PAGES.length);
    expect(writer.written.length).toBe(VANTA_BROWSER_PAGES.length);
    expect(result.pages[0]!.artifacts[0]!.relativePath.startsWith("artifacts/pages/")).toBe(true);
    expect(result.pages[0]!.artifacts[0]!.mediaType).toBe("image/png");
  });

  it("addresses each page with its own digest, so two pages never share one artifact path", async () => {
    const { result } = await walk();
    const paths = result.pages.flatMap((page) => page.artifacts.map((artifact) => artifact.relativePath));
    expect(new Set(paths).size).toBe(VANTA_BROWSER_PAGES.length);
  });

  it("withdraws the screenshot claim from pages that photographed the same bytes, and names the others", async () => {
    // Every page answers ONE picture, which is what a client rendering the same shell for every route does.
    const fake = signedIn();
    const result = unwrap(
      await walkVantaBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    const tests = result.pages.find((page) => page.surface === "tests-collection")!;
    expect(tests.artifacts).toEqual([]);
    expect(tests.screenshotMissingBecause).toContain("byte-identical to 11 other declared page(s)");
    expect(isPageHeld({ page: tests })).toBe(false);
  });

  it("records a page the client has no route for as UNREACHABLE, and keeps none of its chrome calls", async () => {
    const { result } = await walk({
      visits: {
        [urlOf({ surface: "audits-collection" })]: {
          capture: {
            responses: [
              { body: {}, method: "POST", statusCode: 200, url: `${TENANT_ROOT}/graphql?operation=userContext` },
            ] as PageCapture["responses"],
            title: "Page not found - Vanta",
          },
        },
      },
    });
    const audits = result.pages.find((page) => page.surface === "audits-collection")!;
    expect(audits.unreachableBecause).toContain("no such route");
    // The row keeps what the client asked for — that is a fact — while `operationEntities` refuses to
    // credit a not-found page's chrome as corroboration. See `browserEntities.ts`.
    expect(audits.calls.map((call) => call.operation)).toEqual(["userContext"]);
    // The page still answered 200, which is exactly why reachability is not judged on the status.
    expect(audits.statusCode).toBe(200);
    expect(audits.artifacts).toEqual([]);
  });

  it("still photographs a page whose own filters the client restored, because that is the page that was asked for", async () => {
    // MEASURED on the first live run: the client appends the view state the owner last left. Grading on the
    // whole URL called every page wearing restored filters redirected and threw away every one of their pictures.
    const { result } = await walk({
      visits: {
        [urlOf({ surface: "tests-collection" })]: {
          capture: {
            finalUrl: `${TENANT_ROOT}/tests?search=Password+policy`,
            screenshotPng: renderedPng({ seed: 42 }),
          },
        },
      },
    });
    const tests = result.pages.find((page) => page.surface === "tests-collection")!;
    expect(tests.redirected).toBe(false);
    expect(tests.finalUrl).toBe(`${TENANT_ROOT}/tests?search=Password+policy`);
    expect(isPageHeld({ page: tests })).toBe(true);
  });

  it("refuses to photograph a page the client sent to a different PATH, so no picture is filed under a name it does not show", async () => {
    const { result } = await walk({
      visits: {
        [urlOf({ surface: "tests-collection" })]: {
          capture: { finalUrl: `${TENANT_ROOT}/vendors`, screenshotPng: renderedPng({ seed: 42 }) },
        },
      },
    });
    const tests = result.pages.find((page) => page.surface === "tests-collection")!;
    expect(tests.redirected).toBe(true);
    expect(tests.artifacts).toEqual([]);
    expect(tests.screenshotMissingBecause).toContain("settled somewhere other than this declared page");
  });

  it("refuses to photograph a page whose own asked-for query the client overrode", async () => {
    // `policies-collection` is the one declared page that states a query, and the reason it does is that the
    // client had restored page 2 of the list. A run where that override wins again must not be photographed.
    const { result } = await walk({
      visits: {
        [urlOf({ surface: "policies-collection" })]: {
          capture: {
            finalUrl: `${TENANT_ROOT}/policies?page=2&afterCursor=abc`,
            screenshotPng: renderedPng({ seed: 42 }),
          },
        },
      },
    });
    const policies = result.pages.find((page) => page.surface === "policies-collection")!;
    expect(policies.redirected).toBe(true);
    expect(policies.artifacts).toEqual([]);
  });

  it("refuses to photograph a control page the client swapped for a DIFFERENT control", async () => {
    // Every control lives at one path, identified only by `controlId`, so a path-only comparison would file
    // the control the owner last had open under the id of the one that was asked for.
    const asked = `${TENANT_ROOT}/controls?controlId=data-encrypted-gdpr`;
    const fake = signedIn({
      visits: { [asked]: { capture: { finalUrl: `${TENANT_ROOT}/controls?controlId=something-else` } } },
    });
    const walked = unwrap(
      await walkVantaBrowser({
        pages: [vantaControlPage({ providerId: "data-encrypted-gdpr" })],
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages[0]!.redirected).toBe(true);
    expect(isPageHeld({ page: walked.pages[0]! })).toBe(false);
  });

  it("holds a control page the client merely added a status filter to, which is what it actually does", async () => {
    const asked = `${TENANT_ROOT}/controls?controlId=policies-password-complexity-gdpr`;
    const fake = signedIn({
      visits: { [asked]: { capture: { finalUrl: `${asked}&status=NEEDS_ATTENTION` } } },
    });
    const walked = unwrap(
      await walkVantaBrowser({
        pages: [vantaControlPage({ providerId: "policies-password-complexity-gdpr" })],
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages[0]!.redirected).toBe(false);
    expect(isPageHeld({ page: walked.pages[0]! })).toBe(true);
  });

  it("carries the capture accounting, so a lost body is a number rather than a silence", async () => {
    const { result } = await walk({
      visits: {
        [urlOf({ surface: "tests-collection" })]: {
          capture: { responseAccounting: { bodyFailed: 4, bodySucceeded: 0, eligible: 4, seen: 900 } },
        },
      },
    });
    const tests = result.pages.find((page) => page.surface === "tests-collection")!;
    expect(tests.captureComplete).toBe(false);
    expect(tests.responseAccounting.bodyFailed).toBe(4);
  });

  it("addresses no page at all when the probe never reaches a tenanted URL, which is what a sign-in wall does", async () => {
    const fake = fakeTransport({ visits: { [PROBE]: { capture: { finalUrl: "https://app.vanta.com/login" } } } });
    const walked = unwrap(
      await walkVantaBrowser({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.rootFound).toBe(false);
    expect(walked.pages.length).toBe(VANTA_BROWSER_PAGES.length);
    expect(walked.pages.every((page) => !page.attempted)).toBe(true);
    expect(walked.pages[0]!.unreachableBecause).toContain("browser cookies --origin https://app.vanta.com");
    // Exactly one navigation: the probe. A signed-out walk must not spend twelve page loads finding out.
    expect(fake.visited).toEqual([PROBE]);
  });

  it("stops the walk when the session is lost part-way, rather than manufacturing a gap per remaining route", async () => {
    const { result } = await walk({
      visits: {
        [urlOf({ surface: "tests-collection" })]: {
          failWith: { code: "SESSION_LOST", message: "the relay stopped answering" },
        },
      },
    });
    expect(result.sessionLost).toBe(true);
    expect(result.pages[0]!.unreachableBecause).toContain("sign in to Vanta in your own Chrome");
    expect(result.pages[1]!.attempted).toBe(false);
    expect(result.pages[1]!.unreachableBecause).toContain("the browser session was lost part-way through");
    expect(result.pages.length).toBe(VANTA_BROWSER_PAGES.length);
  });

  it("walks a page list of its own when one is given, which is what a control shot is", async () => {
    const control = vantaControlPage({ providerId: "data-encrypted-gdpr" });
    const url = `${TENANT_ROOT}/controls?controlId=data-encrypted-gdpr`;
    const fake = signedIn({ visits: { [url]: { capture: { title: "Controls - Vanta" } } } });
    const walked = unwrap(
      await walkVantaBrowser({
        pages: [control],
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages.map((page) => page.surface)).toEqual(["control:data-encrypted-gdpr"]);
    expect(walked.pages[0]!.requestedUrl).toBe(url);
    expect(isPageHeld({ page: walked.pages[0]! })).toBe(true);
  });

  it("skips the tenant probe entirely when the caller already knows the root", async () => {
    // MEASURED: a retry of ONE control spent its whole budget on the discovery navigation and never reached
    // the control. A seeded root makes a one-id retry one page load rather than two.
    const url = `${TENANT_ROOT}/controls?controlId=0syn0001`;
    const fake = fakeTransport({ visits: { [url]: { capture: {} } } });
    const walked = unwrap(
      await walkVantaBrowser({
        pages: [vantaControlPage({ providerId: "0syn0001" })],
        seededRoot: TENANT_ROOT,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(fake.visited).toEqual([url]);
    expect(walked.rootFound).toBe(true);
    expect(isPageHeld({ page: walked.pages[0]! })).toBe(true);
  });

  it("still probes when no root was seeded, so the fallback is exercised rather than assumed", async () => {
    const { fake } = await walk();
    expect(fake.visited[0]).toBe(PROBE);
  });
});

describe("vantaPageOutcome", () => {
  it("reads the client's not-found page as unreachable even on a 200", () => {
    const outcome = vantaPageOutcome({
      capture: capture({ over: { title: "Page not found - Vanta" }, url: `${TENANT_ROOT}/contracts` }),
      requestedUrl: `${TENANT_ROOT}/contracts`,
    });
    expect(outcome.unreachableBecause).toContain("no such route");
  });

  it("tolerates a query the client ADDED, because that is view state rather than a different page", () => {
    const outcome = vantaPageOutcome({
      capture: capture({ over: { finalUrl: `${TENANT_ROOT}/tests?status=OVERDUE` }, url: `${TENANT_ROOT}/tests` }),
      requestedUrl: `${TENANT_ROOT}/tests`,
    });
    expect(outcome.redirected).toBe(false);
    expect(outcome.unreachableBecause).toBe(null);
  });

  it("treats an address neither side can parse as not where it was asked", () => {
    const outcome = vantaPageOutcome({
      capture: capture({ over: { finalUrl: "about:blank#" }, url: `${TENANT_ROOT}/tests` }),
      requestedUrl: "not a url at all",
    });
    expect(outcome.redirected).toBe(true);
  });
});
