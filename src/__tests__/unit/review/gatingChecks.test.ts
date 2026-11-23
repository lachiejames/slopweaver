import { describe, expect, it } from "vitest";

import { advisoryOnlyNames, DEV_GATE_CHECK, isGatingUnrequired } from "../../../review/gatingChecks.js";

/** A pull request's head: both required contexts green, three advisory lanes red. */
const PR_18226_CHECKS = [
  { name: "Required CI", state: "passed" },
  { name: "Semgrep (TS/React/Fastify)", state: "passed" },
  { name: "Advisory local browser E2E (1)", state: "failed" },
  { name: "Advisory local browser E2E (2)", state: "failed" },
  { name: "Advisory local browser E2E (3)", state: "failed" },
];

const STAGING_REQUIRED = ["Required CI", "Semgrep (TS/React/Fastify)"];

describe("advisoryOnlyNames", () => {
  it("names every red on the head as advisory, because staging requires none of them", () => {
    expect(
      advisoryOnlyNames({ checks: PR_18226_CHECKS, requiredContexts: STAGING_REQUIRED, truncated: false }),
    ).toEqual(["Advisory local browser E2E (1)", "Advisory local browser E2E (2)", "Advisory local browser E2E (3)"]);
  });

  it("proves nothing on a base that requires nothing, where every red would otherwise read advisory", () => {
    expect(advisoryOnlyNames({ checks: PR_18226_CHECKS, requiredContexts: [], truncated: false })).toBe(undefined);
  });

  it("proves nothing over a truncated page, which can only lose a failing required context", () => {
    expect(advisoryOnlyNames({ checks: PR_18226_CHECKS, requiredContexts: STAGING_REQUIRED, truncated: true })).toBe(
      undefined,
    );
  });

  it("proves nothing when every check passed, since there is no red to call advisory", () => {
    const checks = [{ name: "Required CI", state: "passed" }];
    expect(advisoryOnlyNames({ checks, requiredContexts: ["Required CI"], truncated: false })).toBe(undefined);
  });

  it("is not advisory while a required context is still running beside the advisory red", () => {
    const checks = [
      { name: "Required CI", state: "running" },
      { name: "Advisory local browser E2E (1)", state: "failed" },
    ];
    expect(advisoryOnlyNames({ checks, requiredContexts: ["Required CI"], truncated: false })).toBe(undefined);
  });

  it("is not advisory when a required context failed", () => {
    const checks = [
      { name: "Required CI", state: "failed" },
      { name: "Advisory local browser E2E (1)", state: "failed" },
    ];
    expect(advisoryOnlyNames({ checks, requiredContexts: ["Required CI"], truncated: false })).toBe(undefined);
  });

  it("holds a red dev-gate though no branch rule requires it", () => {
    const checks = [
      { name: "build", state: "passed" },
      { name: DEV_GATE_CHECK, state: "failed" },
    ];
    expect(advisoryOnlyNames({ checks, requiredContexts: ["build"], truncated: false })).toBe(undefined);
  });
});

describe("isGatingUnrequired", () => {
  it("names dev-gate and nothing else", () => {
    expect(isGatingUnrequired({ name: "dev-gate" })).toBe(true);
    expect(isGatingUnrequired({ name: "Advisory local browser E2E (1)" })).toBe(false);
  });
});
