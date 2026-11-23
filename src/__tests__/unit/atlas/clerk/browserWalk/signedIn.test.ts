/**
 * A Clerk dashboard walk over a signed-in session: one observation per declared page, every page asked for at
 * this atlas's settle and photographed, a screenshot written for each, and a session lost mid-way stopping
 * the whole walk rather than recording forty page gaps.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { CLERK_BROWSER_PAGES } from "../../../../../atlas/clerk/browserPages.js";
import { CLERK_PAGE_SETTLE_MS, walkClerkDashboard } from "../../../../../atlas/clerk/browserWalk.js";
import { CLERK_DASHBOARD_ORIGIN } from "../../../../../atlas/clerk/dashboardAddress.js";

import { renderedPng } from "../../../../pngFixture.js";
import { fakeTransport, recordingWriter } from "../../../../walkTransportFake.js";
import { INSTANCE_ROOT, PROBE_URL } from "./harness.js";

describe("walkClerkDashboard over a signed-in session", () => {
  /** A transport whose root probe lands on an instance, and whose every page renders its own picture. */
  function signedIn(): ReturnType<typeof fakeTransport> {
    return fakeTransport({
      answer: ({ url, visitIndex }) => {
        if (url === PROBE_URL) {
          return { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}` } };
        }
        // A distinct picture per page: identical bytes are graded a duplicate, which is a different finding.
        return { capture: { screenshotPng: renderedPng({ seed: visitIndex + 1 }) } };
      },
    });
  }

  it("returns exactly one observation per declared page", async () => {
    const walked = unwrap(
      await walkClerkDashboard({
        remembered: null,
        rememberRoot: () => undefined,
        transport: signedIn().transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages).toHaveLength(CLERK_BROWSER_PAGES.length);
  });

  it("asks for every page at the settle this atlas chose", async () => {
    const fake = signedIn();
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    const wrongSettle = fake.asked.filter((visit) => visit.settleMs !== CLERK_PAGE_SETTLE_MS);
    expect(wrongSettle).toEqual([]);
  });

  it("photographs every page, including the root probe", async () => {
    const fake = signedIn();
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.asked.filter((visit) => visit.photographed === false)).toEqual([]);
  });

  it("writes a screenshot for every page it reached", async () => {
    const writer = recordingWriter();
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: signedIn().transport,
      writeArtifact: writer.write,
    });
    expect(writer.written).toHaveLength(CLERK_BROWSER_PAGES.length);
  });

  it("stops the whole walk when the session is lost mid-way, rather than recording forty page gaps", async () => {
    const fake = fakeTransport({
      answer: ({ url, visitIndex }) => {
        if (url === PROBE_URL) {
          return { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}` } };
        }
        if (visitIndex >= 3) {
          return { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } };
        }
        return { capture: { screenshotPng: renderedPng({ seed: visitIndex + 1 }) } };
      },
    });
    const walked = unwrap(
      await walkClerkDashboard({
        remembered: null,
        rememberRoot: () => undefined,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.sessionLost).toBe(true);
  });

  it("still returns one observation per declared page after a lost session", async () => {
    const fake = fakeTransport({
      answer: ({ url, visitIndex }) => {
        if (url === PROBE_URL) {
          return { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}` } };
        }
        if (visitIndex >= 3) {
          return { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } };
        }
        return { capture: { screenshotPng: renderedPng({ seed: visitIndex + 1 }) } };
      },
    });
    const walked = unwrap(
      await walkClerkDashboard({
        remembered: null,
        rememberRoot: () => undefined,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages).toHaveLength(CLERK_BROWSER_PAGES.length);
  });

  it("hands each page's own progress line to a caller that supplied one", async () => {
    const lines: string[] = [];
    await walkClerkDashboard({
      progress: ({ line }) => lines.push(line),
      remembered: null,
      rememberRoot: () => undefined,
      transport: signedIn().transport,
      writeArtifact: recordingWriter().write,
    });
    expect(lines.length).toBeGreaterThan(0);
  });
});
