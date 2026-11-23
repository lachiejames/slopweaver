/**
 * The projection, which is the one boundary anything crosses to reach disk.
 *
 * Two properties are asserted rather than reviewed: the compiled and browser channels of one operation land
 * on the SAME entity id when they agree on its key — without which the corroboration is a comparison of two
 * disjoint lists — and no dashboard URL carrying the application or instance identifier is ever stored.
 */
import { describe, expect, it } from "vitest";

import { CLERK_BROWSER_PAGES } from "../../../../atlas/clerk/browserPages.js";
import type { ClerkObservedCall } from "../../../../atlas/clerk/browserReduction.js";
import {
  clerkPageForWirePath,
  projectClerkCompiledOperation,
  projectClerkObservedOperation,
  projectClerkPage,
  projectClerkWebhookEvent,
} from "../../../../atlas/clerk/projection.js";
import type { ClerkOperationRow } from "../../../../atlas/clerk/specRead.js";
import type { PageObservation } from "../../../../atlas/kit/pageWalk.js";

const AT = "2026-09-05T11:00:00.000Z";

/** One compiled row, as `specRead.ts` hands it over. */
const ROW: ClerkOperationRow = {
  api: "bapi",
  declaredPath: "/users",
  disposition: "excluded",
  dispositionReason: "the rows are the product's own end users",
  dispositionRuleId: "end-user-directory",
  document: "bapi",
  method: "GET",
  operationId: "GetUserList",
  pagination: "limit-offset",
  pathParams: [],
  providerId: "GET bapi:/v1/users",
  queryParams: ["limit", "offset"],
  responseFields: ["id"],
  responseSchema: "User",
  security: ["bearerAuth"],
  summary: "List all users",
  tags: ["Users"],
  wirePath: "/v1/users",
};

/** The same operation, as the walk observed it. */
const CALL: ClerkObservedCall = {
  api: "bapi",
  host: "api.clerk.com",
  method: "GET",
  responseFields: ["email_addresses", "id"],
  statusCode: 200,
  wirePath: "/v1/users",
};

describe("projectClerkCompiledOperation", () => {
  const entity = projectClerkCompiledOperation({ at: AT, row: ROW });

  it("carries only the compiled channel, because neither other has looked", () => {
    expect(entity.channels.compiled).not.toBe(null);
    expect(entity.channels.browser).toBe(null);
    expect(entity.channels.api).toBe(null);
  });

  it("keeps the disposition and the reason that decided it", () => {
    expect(entity.channels.compiled?.detail).toMatchObject({
      disposition: "excluded",
      dispositionReason: "the rows are the product's own end users",
    });
  });

  it("records the wire path as the endpoint, not a URL, because the Frontend API host is per application", () => {
    expect(entity.channels.compiled?.source?.endpoint).toBe("GET bapi:/v1/users");
  });

  it("says its deep link is UNAVAILABLE rather than constructing one Clerk does not publish", () => {
    expect(entity.channels.compiled?.source?.deepLink).toBe(null);
    expect(entity.channels.compiled?.source?.deepLinkStatus).toBe("unavailable");
  });
});

describe("projectClerkObservedOperation", () => {
  const walked = {
    call: CALL,
    callCount: 3,
    deepLink: "https://dashboard.clerk.com/apps/app_x/instances/ins_y/users",
    responseFields: ["email_addresses", "id"],
    seenOn: ["instance-users"],
  };
  const observed = projectClerkObservedOperation({ at: AT, observed: walked });

  it("lands on the SAME entity id as the compiled row for the same operation", () => {
    expect(observed.id).toBe(projectClerkCompiledOperation({ at: AT, row: ROW }).id);
    expect(observed.providerId).toBe("GET bapi:/v1/users");
  });

  it("carries only the browser channel, so a merge fills the others from what is stored", () => {
    expect(observed.channels.browser).not.toBe(null);
    expect(observed.channels.compiled).toBe(null);
  });

  it("names the declared PAGE surfaces that caused the call, never a URL", () => {
    expect(observed.channels.browser?.detail).toMatchObject({ callCount: 3, seenOn: ["instance-users"] });
  });

  it("stores no instance-scoped dashboard URL, even when the walk settled on one", () => {
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(walked)).toContain("instances/ins_y");
    expect(JSON.stringify(observed)).not.toContain("instances/ins_y");
  });
});

describe("projectClerkPage", () => {
  const page = CLERK_BROWSER_PAGES.find((declared) => declared.surface === "instance-domains")!;
  const observation: PageObservation<ClerkObservedCall> = {
    artifacts: [],
    attempted: true,
    calls: [CALL],
    captureComplete: true,
    finalUrl: "https://dashboard.clerk.com/apps/app_x/instances/ins_y/domains",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://dashboard.clerk.com/apps/app_x/instances/ins_y/domains",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "instance-domains",
    title: "Domains",
    unreachableBecause: null,
  };

  it("keys on the declared surface name rather than the address", () => {
    expect(projectClerkPage({ at: AT, observation, page }).providerId).toBe("instance-domains");
  });

  it("stores an instance page's address as a placeholder, never the identifiers it carries", () => {
    const entity = projectClerkPage({ at: AT, observation, page });
    expect(entity.channels.browser?.source?.endpoint).toBe("<instance>/domains");
    expect(entity.channels.browser?.source?.deepLink).toBe(null);
    expect(entity.channels.browser?.source?.deepLinkStatus).toBe("unverified");
  });

  it("gives an ACCOUNT page a real, openable deep link, because it carries no identifier", () => {
    const account = CLERK_BROWSER_PAGES.find((declared) => declared.surface === "account-applications")!;
    const entity = projectClerkPage({
      at: AT,
      observation: { ...observation, surface: "account-applications" },
      page: account,
    });
    expect(entity.channels.browser?.source?.deepLink).toBe("https://dashboard.clerk.com/apps");
    expect(entity.channels.browser?.source?.deepLinkStatus).toBe("browser-discovered");
  });

  it("still projects a page the walk could not reach, carrying why", () => {
    const entity = projectClerkPage({
      at: AT,
      observation: { ...observation, unreachableBecause: "this account's plan does not open it" },
      page,
    });
    expect(entity.channels.browser?.detail).toMatchObject({
      unreachableBecause: "this account's plan does not open it",
    });
  });
});

describe("projectClerkWebhookEvent", () => {
  it("keys on the event type, which is Clerk's own name for it", () => {
    const entity = projectClerkWebhookEvent({
      at: AT,
      row: { description: "User created", event: "user.created", payloadFields: ["id"], payloadSchema: "User" },
    });
    expect(entity.providerId).toBe("user.created");
    expect(entity.kind).toBe("webhook-event");
  });
});

describe("clerkPageForWirePath", () => {
  it("picks the LONGEST matching declared prefix, so the more specific page wins", () => {
    expect(clerkPageForWirePath({ wirePath: "/v1/billing/plans" })?.surface).toBe("instance-billing-plans");
  });

  it("falls back to the shorter prefix when no longer one matches", () => {
    expect(clerkPageForWirePath({ wirePath: "/v1/billing/statements" })?.surface).toBe(
      "instance-billing-subscriptions",
    );
  });

  it("answers null when no declared page claims the prefix", () => {
    expect(clerkPageForWirePath({ wirePath: "/v1/nothing_declares_this" })).toBe(null);
  });
});
