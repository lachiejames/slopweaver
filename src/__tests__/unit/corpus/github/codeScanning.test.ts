/**
 * The code-scanning lane through a real Octokit whose transport is a plain fake `fetch` recording each
 * request: the alert projection (nullable rule, location and dismissal fields included), the optional
 * `ref`/`state` query forwarding, the five-page walk and its truncation flag, and the single unretried
 * dismissal PATCH.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  codeScanningAlertsVia,
  codeScanningAlertVia,
  dismissCodeScanningAlertVia,
} from "../../../../corpus/github/codeScanning.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request as the fake transport saw it. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** What the fake transport answers one request with. */
interface FakeReply {
  readonly status: number;
  readonly data: unknown;
}

/** Decides the fake transport's reply to one recorded request. */
type Responder = (request: SentRequest) => FakeReply;

/** Contexts minted so far — each gets its own rate scope, so one test's paced write never delays the next. */
let contextsMinted = 0;

/** A write context whose transport records every request and answers it through `respond`. */
function routedCtx({ sent, respond }: { sent: SentRequest[]; respond: Responder }): WriteCtx {
  contextsMinted += 1;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body = init?.body;
    const request: SentRequest = {
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      method: String(init?.method),
      url: url instanceof Request ? url.url : url.toString(),
    };
    sent.push(request);
    const reply = respond(request);
    return new Response(JSON.stringify(reply.data), {
      headers: { "content-type": "application/json" },
      status: reply.status,
    });
  };
  return {
    client: new Octokit({ auth: "test-token", request: { fetch } }),
    scopeId: `code-scanning-${String(contextsMinted)}`,
  };
}

/** The page number a list request asked for. */
function pageOf({ request }: { request: SentRequest }): number {
  return Number(new URL(request.url).searchParams.get("page"));
}

/** A raw alert carrying every field the projection reads. */
function rawAlert({ number }: { number: number }): Record<string, unknown> {
  return {
    dismissed_comment: "only reachable from tests",
    dismissed_reason: "used in tests",
    html_url: `https://github.com/acme/widgets/security/code-scanning/${String(number)}`,
    most_recent_instance: { location: { end_line: 14, path: "src/a.ts", start_line: 12 } },
    number,
    rule: { id: "js/sql-injection", name: "SQL injection", security_severity_level: "high", severity: "error" },
    state: "dismissed",
  };
}

/** `count` raw alerts numbered from `first`. */
function rawAlerts({ first, count }: { first: number; count: number }): Record<string, unknown>[] {
  return Array.from({ length: count }, (_unused, index) => rawAlert({ number: first + index }));
}

const REPO = { owner: "acme", repo: "widgets" };
const ALERTS_URL = "https://api.github.com/repos/acme/widgets/code-scanning/alerts";

describe("codeScanningAlertsVia", () => {
  it("projects a full alert and a null-laden one, forwarding ref and state as query parameters", async () => {
    const sent: SentRequest[] = [];
    const sparse = {
      dismissed_comment: null,
      dismissed_reason: null,
      html_url: "https://github.com/acme/widgets/security/code-scanning/2",
      most_recent_instance: {},
      number: 2,
      rule: { id: null, name: "Unnamed rule", security_severity_level: null, severity: null },
      state: null,
    };
    const ctx = routedCtx({ respond: () => ({ data: [rawAlert({ number: 1 }), sparse], status: 200 }), sent });

    const page = unwrap(
      await codeScanningAlertsVia({ ctx, input: { ...REPO, ref: "refs/pull/7/head", state: "open" } }),
    );

    expect(page).toEqual({
      alerts: [
        {
          dismissedComment: "only reachable from tests",
          dismissedReason: "used in tests",
          htmlUrl: "https://github.com/acme/widgets/security/code-scanning/1",
          location: { endLine: 14, path: "src/a.ts", startLine: 12 },
          number: 1,
          rule: { id: "js/sql-injection", name: "SQL injection", securitySeverityLevel: "high", severity: "error" },
          state: "dismissed",
        },
        {
          dismissedComment: undefined,
          dismissedReason: undefined,
          htmlUrl: "https://github.com/acme/widgets/security/code-scanning/2",
          location: { endLine: undefined, path: undefined, startLine: undefined },
          number: 2,
          rule: { id: undefined, name: "Unnamed rule", securitySeverityLevel: undefined, severity: undefined },
          state: undefined,
        },
      ],
      truncated: false,
    });
    expect(sent).toEqual([
      {
        body: undefined,
        method: "GET",
        url: `${ALERTS_URL}?page=1&per_page=100&ref=refs%2Fpull%2F7%2Fhead&state=open`,
      },
    ]);
  });

  it("sends neither ref nor state when the caller gives neither", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: () => ({ data: [], status: 200 }), sent });

    expect(unwrap(await codeScanningAlertsVia({ ctx, input: REPO }))).toEqual({ alerts: [], truncated: false });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: `${ALERTS_URL}?page=1&per_page=100` }]);
  });

  it("stops after a short first page of 99 and reports the read complete", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: () => ({ data: rawAlerts({ count: 99, first: 1 }), status: 200 }), sent });

    const page = unwrap(await codeScanningAlertsVia({ ctx, input: REPO }));

    expect(page.alerts.length).toBe(99);
    expect(page.truncated).toBe(false);
    expect(sent.map((request) => pageOf({ request }))).toEqual([1]);
  });

  it("reads a full page then an empty one as complete, beside five full pages reported truncated at 500", async () => {
    const twoSent: SentRequest[] = [];
    const twoPages = routedCtx({
      respond: (request) => ({
        data: pageOf({ request }) === 1 ? rawAlerts({ count: 100, first: 1 }) : [],
        status: 200,
      }),
      sent: twoSent,
    });
    const fiveSent: SentRequest[] = [];
    const fivePages = routedCtx({
      respond: (request) => ({
        data: rawAlerts({ count: 100, first: (pageOf({ request }) - 1) * 100 + 1 }),
        status: 200,
      }),
      sent: fiveSent,
    });

    const complete = unwrap(await codeScanningAlertsVia({ ctx: twoPages, input: REPO }));
    const capped = unwrap(await codeScanningAlertsVia({ ctx: fivePages, input: REPO }));

    expect(complete.alerts.length).toBe(100);
    expect(complete.truncated).toBe(false);
    expect(twoSent.map((request) => pageOf({ request }))).toEqual([1, 2]);
    expect(capped.alerts.map((alert) => alert.number)).toEqual(Array.from({ length: 500 }, (_u, index) => index + 1));
    expect(capped.truncated).toBe(true);
    expect(fiveSent.map((request) => pageOf({ request }))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("codeScanningAlertVia", () => {
  it("GETs one alert by number and projects it", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: () => ({ data: rawAlert({ number: 7 }), status: 200 }), sent });

    const alert = unwrap(await codeScanningAlertVia({ ctx, input: { ...REPO, alertNumber: 7 } }));

    expect(alert.number).toBe(7);
    expect(alert.rule).toEqual({
      id: "js/sql-injection",
      name: "SQL injection",
      securitySeverityLevel: "high",
      severity: "error",
    });
    expect(sent).toEqual([{ body: undefined, method: "GET", url: `${ALERTS_URL}/7` }]);
  });
});

describe("dismissCodeScanningAlertVia", () => {
  const DISMISS = { ...REPO, alertNumber: 7, comment: "only reachable from tests", reason: "used in tests" } as const;

  it("sends one PATCH with the literal dismissed state, reason and comment, and projects the answer", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: () => ({ data: rawAlert({ number: 7 }), status: 200 }), sent });

    const alert = unwrap(await dismissCodeScanningAlertVia({ ctx, input: DISMISS }));

    expect(alert.state).toBe("dismissed");
    expect(alert.dismissedReason).toBe("used in tests");
    expect(sent).toEqual([
      {
        body: { dismissed_comment: "only reachable from tests", dismissed_reason: "used in tests", state: "dismissed" },
        method: "PATCH",
        url: `${ALERTS_URL}/7`,
      },
    ]);
  });

  it("does not retry a 500 — one request, then the failure naming the update operation", async () => {
    const sent: SentRequest[] = [];
    const ctx = routedCtx({ respond: () => ({ data: { message: "Server Error" }, status: 500 }), sent });

    const error = unwrapErr(await dismissCodeScanningAlertVia({ ctx, input: DISMISS }));

    expect(error.status).toBe(500);
    expect(error.operation).toBe("github.codeScanning.updateAlert");
    expect(sent.length).toBe(1);
  });
});
