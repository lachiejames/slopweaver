import { describe, expect, it } from "vitest";

import {
  BrowserTransportErrors,
  isCaptureComplete,
  isWalkStoppingError,
  type PageCapture,
  type ResponseAccounting,
} from "../../../browser/pageTransport.js";

const capture = ({ accounting }: { accounting: ResponseAccounting }): PageCapture => ({
  finalUrl: "https://console.example.invalid/hosts",
  links: [],
  linksBlockedBecause: null,
  observedAt: "2026-09-05T01:00:00.000Z",
  requestedUrl: "https://console.example.invalid/hosts",
  responseAccounting: accounting,
  responses: [],
  screenshotBlockedBecause: null,
  screenshotPng: null,
  statusCode: 200,
  title: "Hosts",
});

describe("isCaptureComplete", () => {
  it("is complete when every eligible body was read", () => {
    const accounting = { bodyFailed: 0, bodySucceeded: 21, eligible: 21, seen: 866 };
    expect(isCaptureComplete({ capture: capture({ accounting }) })).toBe(true);
  });

  it("is complete when no body was eligible at all", () => {
    const accounting = { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 12 };
    expect(isCaptureComplete({ capture: capture({ accounting }) })).toBe(true);
  });

  it("is incomplete when a body was wanted and not obtained", () => {
    const accounting = { bodyFailed: 1, bodySucceeded: 70, eligible: 71, seen: 866 };
    expect(isCaptureComplete({ capture: capture({ accounting }) })).toBe(false);
  });

  it("is incomplete when an eligible body was neither read nor failed", () => {
    // The regression this function exists to catch: a fire-and-forget response handler leaves a body
    // counted eligible while its read is still in flight, and `bodyFailed === 0` alone calls that complete.
    const accounting = { bodyFailed: 0, bodySucceeded: 18, eligible: 21, seen: 866 };
    expect(isCaptureComplete({ capture: capture({ accounting }) })).toBe(false);
  });
});

describe("isWalkStoppingError", () => {
  it("stops the walk when the session is gone", () => {
    const error = BrowserTransportErrors.sessionLost({ reason: "the tab was closed" });
    expect(isWalkStoppingError({ error })).toBe(true);
  });

  it("stops the walk when no transport is attached", () => {
    const error = BrowserTransportErrors.unavailable({ reason: "the extension is not installed" });
    expect(isWalkStoppingError({ error })).toBe(true);
  });

  it("costs one page and no more when a single address would not load", () => {
    const error = BrowserTransportErrors.navigationFailed({
      because: "the client was killed at its own process bound",
      reason: "timed out",
      url: "https://console.example.invalid/hosts",
    });
    expect(isWalkStoppingError({ error })).toBe(false);
  });
});
