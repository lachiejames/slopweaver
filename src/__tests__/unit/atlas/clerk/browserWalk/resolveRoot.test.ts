/**
 * The Clerk walk spec's own root resolution, run once per case: an origin probe whose navigation failed falls
 * through to the application list, an origin that landed without a root is judged as before the fallthrough
 * existed, and every other origin failure refuses outright, even with a root remembered.
 */
import { describe, expect, it } from "vitest";

import { type Result, unwrap, unwrapErr } from "#lib/result.js";
import { clerkPageWalkSpec } from "../../../../../atlas/clerk/browserWalk.js";
import { CLERK_DASHBOARD_ORIGIN } from "../../../../../atlas/clerk/dashboardAddress.js";
import { type BrowserTransportError, BrowserTransportErrors } from "../../../../../browser/pageTransport.js";

import { type FakeVisit, fakeTransport } from "../../../../walkTransportFake.js";
import { APPLICATIONS_URL, INSTANCE_ROOT, PROBE_URL, recordingSink } from "./harness.js";

/**
 * The shape of a past incident: the origin probe's navigation timed out, and the message carries
 * the address it was given. The `because` is this fake's own recordable sentence.
 */
const ORIGIN_TIMED_OUT = BrowserTransportErrors.navigationFailed({
  because: "the browser client timed out before the page settled",
  reason: "spawnSync node ETIMEDOUT",
  url: PROBE_URL,
});

/** The one line a recovered origin failure prints, exactly. */
const FALLTHROUGH_LINE =
  "clerk dashboard: bare-origin instance-root probe failed — the browser client timed out before the page settled; trying the application-list probe";

/** An application list whose own traffic carries one application and its instance. */
const APPLICATIONS_WITH_ROOT: FakeVisit = {
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
};

/** An application list that completed and carried no identifier, as the server-rendered one does. */
const APPLICATIONS_EMPTY: FakeVisit = { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps`, responses: [] } };

/** Run the spec's own root resolution once, recording every root remembered and every line printed. */
async function resolveOver({
  visits,
  remembered,
}: {
  visits: Readonly<Record<string, FakeVisit>>;
  remembered: string | null;
}): Promise<{
  root: Result<string | null>;
  lines: readonly string[];
  roots: readonly string[];
  visited: readonly string[];
}> {
  const sink = recordingSink();
  const lines: string[] = [];
  const fake = fakeTransport({ visits });
  const root = await clerkPageWalkSpec({ remembered, rememberRoot: sink.remember }).resolveRoot({
    progress: ({ line }) => lines.push(line),
    transport: fake.transport,
  });
  return { lines, root, roots: sink.roots, visited: fake.visited };
}

describe("clerkPageWalkSpec.resolveRoot when the origin probe's navigation fails", () => {
  it("falls through to the application list and resolves the root from its traffic", async () => {
    const resolved = await resolveOver({
      remembered: null,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_WITH_ROOT, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(unwrap(resolved.root)).toBe(INSTANCE_ROOT);
  });

  it("asks for the origin and then the application list, in that order and nothing else", async () => {
    const resolved = await resolveOver({
      remembered: null,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_WITH_ROOT, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(resolved.visited).toEqual([PROBE_URL, APPLICATIONS_URL]);
  });

  it("remembers the root the application list handed it, once", async () => {
    const resolved = await resolveOver({
      remembered: null,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_WITH_ROOT, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(resolved.roots).toEqual([INSTANCE_ROOT]);
  });

  it("prints exactly one line saying so, from the failure's `because`", async () => {
    const resolved = await resolveOver({
      remembered: null,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_WITH_ROOT, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(resolved.lines).toEqual([FALLTHROUGH_LINE]);
  });

  // Falsifiable: the failure the probe was handed DOES carry the address, so this reddens if `message` is quoted.
  it("never quotes the transport's message, which carries the address it was given", async () => {
    const resolved = await resolveOver({
      remembered: null,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_WITH_ROOT, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(ORIGIN_TIMED_OUT.message).toContain(PROBE_URL);
    expect(resolved.lines.join("\n")).not.toContain(CLERK_DASHBOARD_ORIGIN);
  });

  it("uses the remembered root when the application list completes with none", async () => {
    const resolved = await resolveOver({
      remembered: INSTANCE_ROOT,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_EMPTY, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(unwrap(resolved.root)).toBe(INSTANCE_ROOT);
  });

  it("tries both live probes, in order, before reading the remembered root", async () => {
    const resolved = await resolveOver({
      remembered: INSTANCE_ROOT,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_EMPTY, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(resolved.visited).toEqual([PROBE_URL, APPLICATIONS_URL]);
  });

  it("does not re-remember a root it only read back out of storage", async () => {
    const resolved = await resolveOver({
      remembered: INSTANCE_ROOT,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_EMPTY, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(resolved.roots).toEqual([]);
  });

  // A rootless walk PUBLISHES, so a probe that never answered must not be able to become one: the deferred
  // refusal is the exact line the origin failure printed before the fallthrough existed.
  it("refuses with the origin's own failure, rather than answering no root, when nothing is remembered", async () => {
    const resolved = await resolveOver({
      remembered: null,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_EMPTY, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(unwrapErr(resolved.root)).toEqual([
      "could not reach the Clerk dashboard to learn its instance root: could not navigate to https://dashboard.clerk.com/: spawnSync node ETIMEDOUT",
    ]);
  });

  it("refuses on a sign-in wall at the application list, even with a root remembered", async () => {
    const resolved = await resolveOver({
      remembered: INSTANCE_ROOT,
      visits: {
        [APPLICATIONS_URL]: { capture: { finalUrl: "https://acme.accounts.dev/sign-in" } },
        [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT },
      },
    });
    expect(unwrapErr(resolved.root)).toEqual([
      "the Clerk dashboard sent this browser to a sign-in wall, so no page could be walked",
      "sign in to the Clerk dashboard in your own Chrome and run the walk again",
    ]);
  });

  it("still prints the line when no step found a root", async () => {
    const resolved = await resolveOver({
      remembered: null,
      visits: { [APPLICATIONS_URL]: APPLICATIONS_EMPTY, [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT } },
    });
    expect(resolved.lines).toEqual([FALLTHROUGH_LINE]);
  });

  // Two live visits failing is not the one-page failure the fallthrough exists for, so a remembered root
  // does not paper over it.
  it("still refuses when the application list fails as well, even with a root remembered", async () => {
    const resolved = await resolveOver({
      remembered: INSTANCE_ROOT,
      visits: {
        [APPLICATIONS_URL]: {
          failWith: BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "timed out",
            url: APPLICATIONS_URL,
          }),
        },
        [PROBE_URL]: { failWith: ORIGIN_TIMED_OUT },
      },
    });
    expect(unwrapErr(resolved.root)).toEqual([
      `the Clerk dashboard did not send the bare origin to an instance, and the application list could not be reached either: could not navigate to ${APPLICATIONS_URL}: timed out`,
    ]);
  });
});

describe("clerkPageWalkSpec.resolveRoot when the origin LANDED without a root", () => {
  // The same fact on the path that existed before the fallthrough: a sign-in landing is a signed-out session
  // whichever probe met it.
  it("refuses on a sign-in wall at the application list, even with a root remembered", async () => {
    const resolved = await resolveOver({
      remembered: INSTANCE_ROOT,
      visits: {
        [APPLICATIONS_URL]: { capture: { finalUrl: "https://acme.accounts.dev/sign-in" } },
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
      },
    });
    expect(unwrapErr(resolved.root)).toEqual([
      "the Clerk dashboard sent this browser to a sign-in wall, so no page could be walked",
      "sign in to the Clerk dashboard in your own Chrome and run the walk again",
    ]);
  });

  it("still answers no root, rather than refusing, when nothing is remembered", async () => {
    const resolved = await resolveOver({
      remembered: null,
      visits: {
        [APPLICATIONS_URL]: APPLICATIONS_EMPTY,
        [PROBE_URL]: { capture: { finalUrl: `${CLERK_DASHBOARD_ORIGIN}/apps` } },
      },
    });
    expect(unwrap(resolved.root)).toBe(null);
  });
});

describe("clerkPageWalkSpec.resolveRoot refuses on every other origin failure, even with a root remembered", () => {
  // A Record over every code but the one that falls through, so a code added to the transport's union fails
  // to compile here until somebody decides which side of the line it is on.
  const BY_CODE: Record<Exclude<BrowserTransportError["code"], "NAVIGATION_FAILED">, BrowserTransportError> = {
    OFF_LEASE_ORIGIN: BrowserTransportErrors.offLeaseOrigin({
      reason: "the lease binds another origin",
      url: PROBE_URL,
    }),
    SESSION_LOST: BrowserTransportErrors.sessionLost({ reason: "the relay stopped answering" }),
    TRANSPORT_UNAVAILABLE: BrowserTransportErrors.unavailable({ reason: "no browser" }),
  };
  const RUN_STOPPING = Object.entries(BY_CODE).map(([code, error]) => ({ code, error }));

  it("holds a row for every run-stopping code", () => {
    expect(RUN_STOPPING.map((row) => row.error.code)).toEqual([
      "OFF_LEASE_ORIGIN",
      "SESSION_LOST",
      "TRANSPORT_UNAVAILABLE",
    ]);
  });

  it.each(RUN_STOPPING)("refuses $code with the dashboard-unreachable line", async ({ error }) => {
    const resolved = await resolveOver({ remembered: INSTANCE_ROOT, visits: { [PROBE_URL]: { failWith: error } } });
    expect(unwrapErr(resolved.root)).toEqual([
      `could not reach the Clerk dashboard to learn its instance root: ${error.message}`,
    ]);
  });

  it.each(RUN_STOPPING)("asks for nothing after the origin on $code", async ({ error }) => {
    const resolved = await resolveOver({ remembered: INSTANCE_ROOT, visits: { [PROBE_URL]: { failWith: error } } });
    expect(resolved.visited).toEqual([PROBE_URL]);
  });

  it.each(RUN_STOPPING)("prints no fallthrough line on $code", async ({ error }) => {
    const resolved = await resolveOver({ remembered: INSTANCE_ROOT, visits: { [PROBE_URL]: { failWith: error } } });
    expect(resolved.lines).toEqual([]);
  });
});
