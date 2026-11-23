import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { KNOCK_BROWSER_PAGES, KNOCK_ROOT_PROBE_PATH } from "../../../../atlas/knock/browserPages.js";
import {
  decodeRoot,
  encodeRoot,
  KNOCK_PAGE_SETTLE_MS,
  knockPageOutcome,
  knockPageWalkSpec,
  walkKnockDashboard,
} from "../../../../atlas/knock/browserWalk.js";
import { KNOCK_DASHBOARD_ORIGIN } from "../../../../atlas/knock/surfaceNaming.js";
import type { PageCapture } from "../../../../browser/pageTransport.js";

import { renderedPng } from "../../../pngFixture.js";
import { fakeTransport, recordingWriter, capture as sharedCapture } from "../../../walkTransportFake.js";

const REQUESTED = "https://dashboard.knock.app/acme/production/workflows";
const PROBE_URL = `${KNOCK_DASHBOARD_ORIGIN}${KNOCK_ROOT_PROBE_PATH}`;

/**
 * What is KNOCK's about a capture, over the shared fake's own defaults: this dashboard photographs nothing
 * by default in these tests and titles nothing, so grading is judged on the address alone.
 */
const KNOCK_PAGE: Partial<PageCapture> = { screenshotPng: null, title: "" };

/** One capture, with every field the transport really returns, so the grading is judged on the real shape. */
const capture = (over: { finalUrl: string; statusCode?: number }): PageCapture =>
  sharedCapture({ over: { ...KNOCK_PAGE, ...over }, url: REQUESTED });

describe("knockPageOutcome", () => {
  const requestedUrl = REQUESTED;

  it("holds a page the client kept", () => {
    expect(knockPageOutcome({ capture: capture({ finalUrl: requestedUrl }), requestedUrl })).toStrictEqual({
      redirected: false,
      unreachableBecause: null,
    });
  });

  it("tolerates a query string, because the client restores its own view state", () => {
    const settled = capture({ finalUrl: `${requestedUrl}?tab=steps` });
    expect(knockPageOutcome({ capture: settled, requestedUrl }).redirected).toBe(false);
  });

  it("refuses a 200 the client rewrote to another page — the failure a status code cannot see", () => {
    const settled = capture({ finalUrl: "https://dashboard.knock.app/acme/production/overview" });
    const outcome = knockPageOutcome({ capture: settled, requestedUrl });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toContain("did not keep this address");
  });

  it("never quotes the settled path, which carries the account slug", () => {
    const settled = capture({ finalUrl: "https://dashboard.knock.app/acme/production/overview" });
    expect(knockPageOutcome({ capture: settled, requestedUrl }).unreachableBecause).not.toContain("acme");
  });

  it("names a sign-in wall as a lost session rather than as a moved page", () => {
    const settled = capture({ finalUrl: "https://dashboard.knock.app/login" });
    expect(knockPageOutcome({ capture: settled, requestedUrl }).unreachableBecause).toContain("no longer signed in");
  });

  it("refuses a settle on another origin", () => {
    const settled = capture({ finalUrl: "https://knock.app/pricing" });
    expect(knockPageOutcome({ capture: settled, requestedUrl }).unreachableBecause).toContain("another origin");
  });

  it("refuses a page whose identity parameter the client answered with a SIBLING's value", () => {
    const asked = `${REQUESTED}?controlId=alpha`;
    const settled = capture({ finalUrl: `${REQUESTED}?controlId=beta` });
    const outcome = knockPageOutcome({ capture: settled, requestedUrl: asked });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toContain("did not keep this address");
  });

  it("still holds a page whose declared parameter the client kept and added its own beside", () => {
    const asked = `${REQUESTED}?controlId=alpha`;
    const settled = capture({ finalUrl: `${REQUESTED}?controlId=alpha&tab=steps` });
    expect(knockPageOutcome({ capture: settled, requestedUrl: asked })).toStrictEqual({
      redirected: false,
      unreachableBecause: null,
    });
  });
});

describe("the root the walk engine carries", () => {
  it("round-trips both slugs", () => {
    const root = { account: "acme", environment: "production" };
    expect(decodeRoot({ root: encodeRoot({ root }) })).toStrictEqual(root);
  });

  it("round-trips an account with no environment", () => {
    const root = { account: "acme", environment: null };
    expect(decodeRoot({ root: encodeRoot({ root }) })).toStrictEqual(root);
  });

  it("carries no root at all through as null", () => {
    expect(encodeRoot({ root: null })).toBe(null);
    expect(decodeRoot({ root: null })).toBe(null);
  });
});

describe("the walk spec", () => {
  const spec = knockPageWalkSpec({ seed: { from: "probe" } });

  it("declares the 57 pages the route table says a session can address", () => {
    expect(spec.pages.length).toBe(57);
  });

  it("addresses an environment page only once both slugs are known", () => {
    const page = spec.pages.find((candidate) => candidate.surface === "/[slug]/[environment]/workflows")!;
    expect(spec.urlFor({ page, root: "acme/" })).toBe(null);
    expect(spec.urlFor({ page, root: "acme/production" })).toBe(
      "https://dashboard.knock.app/acme/production/workflows",
    );
  });

  it("names the fix in the reason a rootless page carries", () => {
    expect(spec.rootMissingBecause).toContain("--root <account>/<environment>");
  });

  it("treats a sign-in wall as the end of the session", () => {
    expect(spec.sessionLostOn({ capture: capture({ finalUrl: "https://dashboard.knock.app/login" }) })).toBe(true);
    expect(spec.sessionLostOn({ capture: capture({ finalUrl: "https://dashboard.knock.app/acme/settings" }) })).toBe(
      false,
    );
  });
});

describe("walkKnockDashboard learns the two slugs, or is given them", () => {
  const ACCOUNT_ROOT = `${KNOCK_DASHBOARD_ORIGIN}/acme/production/overview`;

  it("asks the bare origin first when no root was supplied", async () => {
    const fake = fakeTransport({ visits: { [PROBE_URL]: { capture: { finalUrl: ACCOUNT_ROOT } } } });
    await walkKnockDashboard({
      seed: { from: "probe" },
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited[0]).toBe(PROBE_URL);
  });

  // A supplied root is the whole point of `--root <account>/<environment>`: it makes the walk independent
  // of where the owner's browser was last pointed. The bare origin is ALSO a declared page, so the falsifiable
  // form is how many times it was asked for: once as that page when seeded, twice when probing as well.
  it("does not probe at all when the invocation supplied a root", async () => {
    const seededFake = fakeTransport({ defaultCapture: KNOCK_PAGE });
    await walkKnockDashboard({
      seed: { from: "flag", root: { account: "acme", environment: "production" } },
      transport: seededFake.transport,
      writeArtifact: recordingWriter().write,
    });
    const probingFake = fakeTransport({ visits: { [PROBE_URL]: { capture: { finalUrl: ACCOUNT_ROOT } } } });
    await walkKnockDashboard({
      seed: { from: "probe" },
      transport: probingFake.transport,
      writeArtifact: recordingWriter().write,
    });
    const asked = ({ visited }: { visited: readonly string[] }) => visited.filter((url) => url === PROBE_URL).length;
    expect(asked({ visited: probingFake.visited }) - asked({ visited: seededFake.visited })).toBe(1);
  });

  it("reports a root found when the landing named an account", async () => {
    const fake = fakeTransport({ visits: { [PROBE_URL]: { capture: { finalUrl: ACCOUNT_ROOT } } } });
    const walked = unwrap(
      await walkKnockDashboard({
        seed: { from: "probe" },
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.rootFound).toBe(true);
  });

  it("reports no root when the landing named no account at all", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${KNOCK_DASHBOARD_ORIGIN}/` } } },
    });
    const walked = unwrap(
      await walkKnockDashboard({
        seed: { from: "probe" },
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.rootFound).toBe(false);
  });

  it("names the --root correction on a page it could not address", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${KNOCK_DASHBOARD_ORIGIN}/` } } },
    });
    const walked = unwrap(
      await walkKnockDashboard({
        seed: { from: "probe" },
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages[0]!.unreachableBecause).toContain("slopweaver atlas knock walk --root");
  });

  it("returns exactly one observation per declared page", async () => {
    const fake = fakeTransport({ visits: { [PROBE_URL]: { capture: { finalUrl: ACCOUNT_ROOT } } } });
    const walked = unwrap(
      await walkKnockDashboard({
        seed: { from: "probe" },
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages).toHaveLength(KNOCK_BROWSER_PAGES.length);
  });

  it("asks for every page at the settle this atlas chose", async () => {
    const fake = fakeTransport({ visits: { [PROBE_URL]: { capture: { finalUrl: ACCOUNT_ROOT } } } });
    await walkKnockDashboard({
      seed: { from: "probe" },
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.asked.filter((visit) => visit.settleMs !== KNOCK_PAGE_SETTLE_MS)).toEqual([]);
  });

  it("writes a screenshot for every page it reached and photographed", async () => {
    const fake = fakeTransport({
      answer: ({ url, visitIndex }) => {
        if (url === PROBE_URL) {
          return { capture: { finalUrl: ACCOUNT_ROOT } };
        }
        return { capture: { screenshotPng: renderedPng({ seed: visitIndex + 1 }) } };
      },
    });
    const writer = recordingWriter();
    await walkKnockDashboard({ seed: { from: "probe" }, transport: fake.transport, writeArtifact: writer.write });
    const photographed = fake.asked.filter((visit) => visit.url !== PROBE_URL && visit.photographed);
    expect(writer.written).toHaveLength(photographed.length);
  });

  it("refuses to start when the probe lands on a sign-in wall", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${KNOCK_DASHBOARD_ORIGIN}/login` } } },
    });
    const walked = await walkKnockDashboard({
      seed: { from: "probe" },
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[0]).toContain("no page could be walked");
  });

  it("refuses when the dashboard could not be reached at all", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } } },
    });
    const walked = await walkKnockDashboard({
      seed: { from: "probe" },
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[0]).toContain("the relay stopped answering");
  });

  it("prints the sign-in refusal as exactly two lines", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${KNOCK_DASHBOARD_ORIGIN}/login` } } },
    });
    const walked = await walkKnockDashboard({
      seed: { from: "probe" },
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual([
      "the Knock dashboard sent this browser to a sign-in wall, so no page could be walked",
      "sign in to the Knock dashboard in your own Chrome and run the walk again",
    ]);
  });

  it("quotes the transport's reason for an unreachable dashboard, having asked for the probe and nothing else", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } } },
    });
    const walked = await walkKnockDashboard({
      seed: { from: "probe" },
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual([
      "could not reach the Knock dashboard to learn its account root: the relay stopped answering",
    ]);
    expect(fake.visited).toEqual(["https://dashboard.knock.app/"]);
  });

  it("stops the whole walk when the session is lost mid-way", async () => {
    const fake = fakeTransport({
      answer: ({ url }) => {
        if (url === PROBE_URL) {
          return { capture: { finalUrl: ACCOUNT_ROOT } };
        }
        return { capture: { finalUrl: `${KNOCK_DASHBOARD_ORIGIN}/login` } };
      },
    });
    const walked = unwrap(
      await walkKnockDashboard({
        seed: { from: "probe" },
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.sessionLost).toBe(true);
  });

  it("hands each page's progress line to a caller that supplied one", async () => {
    const lines: string[] = [];
    const fake = fakeTransport({ visits: { [PROBE_URL]: { capture: { finalUrl: ACCOUNT_ROOT } } } });
    await walkKnockDashboard({
      progress: ({ line }) => lines.push(line),
      seed: { from: "probe" },
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(lines.length).toBeGreaterThan(0);
  });
});
