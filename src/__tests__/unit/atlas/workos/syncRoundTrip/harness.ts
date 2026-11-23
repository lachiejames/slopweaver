/*
 * What the WorkOS sync round-trip test files share: the throwaway state homes each case syncs into, removed after
 * every case by the `afterEach` that `useTempHomes()` registers, the probe-only transport, the typed "no key
 * configured", and the content transport that answers the list endpoints and the membership walk the way the
 * server does.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import type { WorkosFetch } from "../../../../../atlas/workos/client.js";
import { type WorkosApiError, WorkosApiErrors } from "../../../../../atlas/workos/errors.js";
import { WORKOS_ORACLE_CONTROL_PATH } from "../../../../../atlas/workos/routeCandidates.js";
import { err, type Result } from "../../../../../lib/result.js";

const homes: string[] = [];

/**
 * A throwaway state home, removed after each test.
 *
 * @returns the new home's absolute path
 */
export function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-workos-sync-"));
  homes.push(home);
  return home;
}

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useTempHomes(): void {
  afterEach(() => {
    homes.splice(0).forEach((home) => {
      rmSync(home, { force: true, recursive: true });
    });
  });
}

/**
 * A transport that answers the control absent, one named path absent, and everything else `401`.
 *
 * @param absentPath the one candidate path to answer not-routed for
 * @returns the fake transport
 */
export function probeOnlyFetch({ absentPath }: { absentPath: string }): WorkosFetch {
  return ({ url, method }) => {
    if (url.endsWith(WORKOS_ORACLE_CONTROL_PATH)) {
      return Promise.resolve({ status: 404, text: '{"message":"The requested resource was not found"}' });
    }
    if (url.endsWith(absentPath)) {
      return Promise.resolve({ status: 404, text: JSON.stringify({ message: `Cannot ${method} ${absentPath}` }) });
    }
    return Promise.resolve({ status: 401, text: '{"message":"Unauthorized"}' });
  };
}

/**
 * The typed "no key configured" the CLI hands the sync on an install with none.
 *
 * @returns the credential-missing failure naming the variable that was checked
 */
export function noKey(): Result<string, WorkosApiError> {
  return err(WorkosApiErrors.credentialMissing({ checked: ["$WORKOS_API_KEY"] }));
}

/**
 * The bodies the four list endpoints answer for a one-of-everything tenant.
 *
 * The membership listing is deliberately NOT here: it cannot be listed whole, so the fake below answers it
 * from the filter it was called with, and refuses it outright when it was called without one.
 */
const CONTENT_BODIES: Readonly<Record<string, string>> = {
  "/connections": pageText({
    data: [{ connection_type: "OktaSAML", id: "conn_1", organization_id: "org_1", state: "active" }],
  }),
  "/directories": pageText({
    data: [{ id: "directory_1", organization_id: "org_1", state: "linked", type: "scim" }],
  }),
  "/organizations": pageText({ data: [{ domains: [], id: "org_1", name: "One" }] }),
  "/user_management/users": pageText({ data: [{ email_verified: true, id: "user_1" }] }),
};

/**
 * One last list page as WorkOS sends it.
 *
 * @returns the page's JSON text, with no cursor either way
 */
export function pageText({ data }: { data: readonly unknown[] }): string {
  return JSON.stringify({ data, list_metadata: { after: null, before: null }, object: "list" });
}

/**
 * A transport that probes as usual and answers the content reads THE WAY THE SERVER DOES.
 *
 * The one property that matters here is the refusal: `GET /user_management/organization_memberships` with
 * no `organization_id` or `user_id` answers HTTP 400, exactly as WorkOS does. The fake this replaced
 * answered 200 to any authenticated path, so it was strictly more permissive than the server and a sync
 * that could never work in production passed against it.
 *
 * @param refusePath one content path to answer HTTP 500 for, or `null` to answer them all
 * @returns the fake transport
 */
export function contentFetch({ refusePath = null }: { refusePath?: string | null } = {}): WorkosFetch {
  return ({ url, headers, method }) => {
    if (headers["authorization"] === undefined) {
      return probeOnlyFetch({ absentPath: "/webhooks" })({ headers, method, url });
    }
    const parsed = new URL(url);
    if (parsed.pathname === refusePath) {
      return Promise.resolve({ status: 500, text: '{"message":"Internal Server Error"}' });
    }
    if (parsed.pathname === "/user_management/organization_memberships") {
      return Promise.resolve(membershipAnswer({ query: parsed.searchParams }));
    }
    const body = CONTENT_BODIES[parsed.pathname];
    if (body === undefined) {
      return Promise.resolve({ status: 200, text: pageText({ data: [] }) });
    }
    return Promise.resolve({ status: 200, text: body });
  };
}

/**
 * What the membership listing answers, given the query it was called with.
 *
 * @param query the call's query parameters
 * @returns the 400 an unfiltered call earns, or the one membership org_1 holds
 */
function membershipAnswer({ query }: { query: URLSearchParams }): { status: number; text: string } {
  if (query.get("organization_id") === null && query.get("user_id") === null) {
    return {
      status: 400,
      text: JSON.stringify({ code: "invalid_request", message: "Either organization_id or user_id is required." }),
    };
  }
  if (query.get("organization_id") === "org_1") {
    return { status: 200, text: pageText({ data: [{ organization_id: "org_1", user_id: "user_1" }] }) };
  }
  return { status: 200, text: pageText({ data: [] }) };
}
