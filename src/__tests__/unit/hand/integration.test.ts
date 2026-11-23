/*
 * The integration a hand step names, read off the credential register (a tag reads like
 * Google Admin or Google SecOps, an integration equal to Google SecOps). The register's platform strings are prose, so
 * the cases pin each shape it holds.
 */
import { describe, expect, it } from "vitest";

import { integrationName, integrationOfStep } from "../../../hand/integration.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { CREDENTIALS } from "../../../secrets/registry.js";

/** A step built by the real builder, its literal the one thing a case varies. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "store-the-client",
        postedBy: "workspace:1",
        postedIso: "2026-10-02T06:55:34.641Z",
        unblocks: "The SecOps atlas",
        what: "Store the OAuth client id",
        witness: "slopweaver hand done store-the-client --did stored",
        ...over,
      },
    }),
  );
}

describe("integrationName", () => {
  it("joins a Google door to its product", () => {
    expect(integrationName({ platform: "Google (SecOps door)" })).toBe("Google SecOps");
    expect(integrationName({ platform: "Google (Admin door)" })).toBe("Google Admin");
  });

  it("drops a parenthetical that is prose about the row", () => {
    expect(integrationName({ platform: "Supabase (the local store)" })).toBe("Supabase");
    expect(integrationName({ platform: "Vaultvendor (the operator's own vault) — slopweaver never reads it" })).toBe(
      "Vaultvendor",
    );
    expect(
      integrationName({ platform: "the operator's password manager — slopweaver never reads it from there" }),
    ).toBe("the operator's password manager");
  });

  it("leaves a bare platform as it is", () => {
    expect(integrationName({ platform: "Vanta" })).toBe("Vanta");
  });

  it("never returns an empty name for any platform the register holds", () => {
    expect(CREDENTIALS.length).toBeGreaterThan(0);
    expect(CREDENTIALS.filter((entry) => integrationName({ platform: entry.platform }) === "")).toEqual([]);
  });
});

describe("integrationOfStep", () => {
  it("names the platform of the secret the step has the owner store", () => {
    expect(integrationOfStep({ step: step({ literal: "slopweaver secrets set google-secops-client-id" }) })).toBe(
      "Google SecOps",
    );
    expect(integrationOfStep({ step: step({ literal: "slopweaver secrets set vanta-client-id" }) })).toBe("Vanta");
  });

  it("is absent when the step stores no registered secret", () => {
    expect(integrationOfStep({ step: step() })).toBe(undefined);
  });
});
