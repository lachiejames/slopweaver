/**
 * When a Clerk dashboard walk refuses to start rather than walking a signed-out or unreachable dashboard: a
 * sign-in wall at the root probe, a dashboard that cannot be reached, and an application list that cannot be
 * reached either — then each refusal line exactly as the CLI prints it.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";
import { walkClerkDashboard } from "../../../../../atlas/clerk/browserWalk.js";
import { CLERK_DASHBOARD_ORIGIN } from "../../../../../atlas/clerk/dashboardAddress.js";

import { fakeTransport, recordingWriter } from "../../../../walkTransportFake.js";
import { APPLICATIONS_URL, PROBE_URL } from "./harness.js";

describe("walkClerkDashboard refuses to start rather than walking a signed-out session", () => {
  it("refuses when the root probe lands on a sign-in wall", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: "https://acme.accounts.dev/sign-in" } } },
    });
    const walked = await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[0]).toContain("sign-in wall");
  });

  it("tells the owner where to sign in, because that is the only correction that works", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: "https://acme.accounts.dev/sign-in" } } },
    });
    const walked = await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[1]).toContain("sign in to the Clerk dashboard in your own Chrome");
  });

  it("visits nothing else after a sign-in landing", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: "https://acme.accounts.dev/sign-in" } } },
    });
    await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited).toEqual([PROBE_URL]);
  });

  it("refuses when the dashboard cannot be reached at all", async () => {
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } },
      },
    });
    const walked = await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[0]).toContain("the relay stopped answering");
  });

  it("refuses when the bare origin answered but the application list could not be reached", async () => {
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
        [APPLICATIONS_URL]: {
          failWith: {
            because: "the fake reported this page unreachable",
            code: "NAVIGATION_FAILED",
            message: "timed out",
            url: APPLICATIONS_URL,
          },
        },
      },
    });
    const walked = await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[0]).toContain("the application list could not be reached either");
  });
});

describe("walkClerkDashboard's refusals, each line exactly as the CLI prints it", () => {
  it("prints one line quoting the transport's message when the dashboard cannot be reached", async () => {
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } },
      },
    });
    const walked = await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual([
      "could not reach the Clerk dashboard to learn its instance root: the relay stopped answering",
    ]);
  });

  it("prints the sign-in wall and the correction as two lines", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: "https://acme.accounts.dev/sign-in" } } },
    });
    const walked = await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual([
      "the Clerk dashboard sent this browser to a sign-in wall, so no page could be walked",
      "sign in to the Clerk dashboard in your own Chrome and run the walk again",
    ]);
  });

  it("prints one line when the application list could not be reached either", async () => {
    const fake = fakeTransport({
      visits: {
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
        [APPLICATIONS_URL]: {
          failWith: {
            because: "the fake reported this page unreachable",
            code: "NAVIGATION_FAILED",
            message: "timed out",
            url: APPLICATIONS_URL,
          },
        },
      },
    });
    const walked = await walkClerkDashboard({
      remembered: null,
      rememberRoot: () => undefined,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual([
      "the Clerk dashboard did not send the bare origin to an instance, and the application list could not be reached either: timed out",
    ]);
  });
});
