/**
 * How a Clerk dashboard walk learns the root every instance page hangs off: three probes in a fixed order —
 * the bare origin, then the application list's own traffic, then a root an earlier walk remembered — and what
 * a walk with no root at all records for the pages it cannot address.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { CLERK_BROWSER_PAGES } from "../../../../../atlas/clerk/browserPages.js";
import { walkClerkDashboard } from "../../../../../atlas/clerk/browserWalk.js";
import { CLERK_DASHBOARD_ORIGIN } from "../../../../../atlas/clerk/dashboardAddress.js";

import { fakeTransport, recordingWriter } from "../../../../walkTransportFake.js";
import { APPLICATIONS_URL, INSTANCE_ROOT, PROBE_URL, recordingSink } from "./harness.js";

describe("walkClerkDashboard learns the instance root in three steps, in order", () => {
  it("asks the bare origin FIRST, purely to learn the root", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}` } } },
    });
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited[0]).toBe(PROBE_URL);
  });

  it("remembers a root the bare origin handed it", async () => {
    const sink = recordingSink();
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}/overview` } } },
    });
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: sink.remember,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(sink.roots).toEqual([INSTANCE_ROOT]);
  });

  // `/apps` is also a DECLARED account page, so the falsifiable form is how MANY times it was asked for:
  // once as that page when the origin answered, twice when the fallback probe had to run as well.
  it("does not probe the application list when the bare origin already answered", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}${INSTANCE_ROOT}` } } },
    });
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited.filter((url) => url === APPLICATIONS_URL)).toHaveLength(1);
  });

  // MEASURED on the first real walk: a session last left on the application list was sent
  // straight back to it, and the declared pages hanging off the instance root were recorded rootless.
  it("falls back to the application list when the bare origin carries no instance", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } } },
    });
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited.filter((url) => url === APPLICATIONS_URL)).toHaveLength(2);
  });

  it("recovers the root from the application list's own traffic", async () => {
    const sink = recordingSink();
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
        [APPLICATIONS_URL]: {
          capture: {
            finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps`,
            responses: [
              {
                body: { data: [{ id: "app_2abcdefghijklmnop", instances: [{ id: "ins_2abcdefghijklmnop" }] }] },
                method: "GET",
                statusCode: 200,
                url: `${CLERK_DASHBOARD_ORIGIN}/v1/applications`,
              },
            ],
          },
        },
      },
    });
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: sink.remember,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(sink.roots).toEqual([INSTANCE_ROOT]);
  });

  // The application list is SERVER-RENDERED, so its own traffic carries neither identifier — measured on the
  // same walk. The remembered root is what makes a walk independent of where the owner's browser was last pointed.
  it("uses the root an earlier walk remembered when both live probes come up empty", async () => {
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
        [APPLICATIONS_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps`, responses: [] } },
      },
    });
    const walked = unwrap(
      await walkClerkDashboard({
        remembered: INSTANCE_ROOT,
        rememberRoot: () => undefined,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.rootFound).toBe(true);
  });

  it("does not re-remember a root it only read back out of storage", async () => {
    const sink = recordingSink();
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
        [APPLICATIONS_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps`, responses: [] } },
      },
    });
    await walkClerkDashboard({
      remembered: INSTANCE_ROOT,
      rememberRoot: sink.remember,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(sink.roots).toEqual([]);
  });

  it("reports no root when all three probes come up empty", async () => {
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
        [APPLICATIONS_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps`, responses: [] } },
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
    expect(walked.rootFound).toBe(false);
  });

  it("records every instance page as never attempted when there is no root to address it with", async () => {
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
        [APPLICATIONS_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps`, responses: [] } },
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
    const instanceSurfaces = new Set(
      CLERK_BROWSER_PAGES.filter((page) => page.root === "instance").map((page) => page.surface),
    );
    const attempted = walked.pages.filter((page) => instanceSurfaces.has(page.surface) && page.attempted);
    expect(attempted).toEqual([]);
  });

  it("names the run-it-with-a-root correction on every page it could not address", async () => {
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
        [APPLICATIONS_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps`, responses: [] } },
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
    const rootless = walked.pages.find((page) => page.attempted === false)!;
    expect(rootless.unreachableBecause).toContain("slopweaver atlas clerk walk --root");
  });
});
