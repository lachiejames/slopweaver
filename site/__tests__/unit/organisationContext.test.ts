/*
 * The organisation row's answer, as the console's one read per document takes it: a document, or the store's typed
 * "none written yet" — never a generic word standing in for the missing `org set`. The live runner's expected-empty
 * exit is tested here too, because it is the half that turns `ORG_NOT_CONFIGURED` into an answer.
 */

import { describe, expect, it } from "vitest";

import { liveResultOf } from "../../lib/liveVerbRun";
import { type LiveVerb, liveVerbFor } from "../../lib/liveVerbs";
import { organisationNotConfiguredWhy } from "../../lib/organisationContext";

const ROW: LiveVerb = liveVerbFor({ slug: "organisation" })!;
const AT = "2026-10-30T18:00:00.000Z";
const NOT_CONFIGURED_SENTENCE =
  "slopweaver org show --json exited 3: no organisation is configured in the store — write it once with `slopweaver org set`";

describe("the organisation allowlist row", () => {
  it("reads org show on the slow lane, and declares exit 3 as ORG_NOT_CONFIGURED", () => {
    expect(ROW).toEqual({
      argv: ["org", "show", "--json"],
      expectedEmpty: { code: "ORG_NOT_CONFIGURED", exitCode: 3 },
      format: "json",
      lane: "slow",
      slug: "organisation",
      stampsItsOwnTime: false,
      timeoutMs: 90_000,
      title: "slopweaver org show --json",
    });
  });
});

describe("liveResultOf", () => {
  it("answers the declared exit 3 with a typed expected-empty payload carrying the verb's sentence", () => {
    const result = liveResultOf({
      outcome: { err: "", exitCode: 3, notMeasured: NOT_CONFIGURED_SENTENCE, ok: false, out: "", tookMs: 1920 },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({
      observedAtIso: AT,
      ok: true,
      payload: { code: "ORG_NOT_CONFIGURED", kind: "expected-empty", why: NOT_CONFIGURED_SENTENCE },
      stampedByRoute: true,
    });
  });

  it("keeps exit 1 a failure: ORG_INVALID or ORG_QUERY_FAILED is a fault, not an empty store", () => {
    const result = liveResultOf({
      outcome: {
        err: "",
        exitCode: 1,
        notMeasured: "slopweaver org show --json exited 1: boom",
        ok: false,
        out: "",
        tookMs: 5,
      },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({ notMeasured: "slopweaver org show --json exited 1: boom", observedAtIso: AT, ok: false });
  });

  it("keeps a timeout a failure, since a killed child has no exit code to match", () => {
    const result = liveResultOf({
      outcome: {
        err: "",
        exitCode: undefined,
        notMeasured: "did not answer within 90s",
        ok: false,
        out: "",
        tookMs: 90_000,
      },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({ notMeasured: "did not answer within 90s", observedAtIso: AT, ok: false });
  });

  it("keeps exit 3 a failure on a row that declares no expected-empty exit", () => {
    const { expectedEmpty: _dropped, ...undeclared } = ROW;
    const result = liveResultOf({
      outcome: { err: "", exitCode: 3, notMeasured: "exited 3", ok: false, out: "", tookMs: 5 },
      receivedAtIso: AT,
      verb: undeclared,
    });
    expect(result).toEqual({ notMeasured: "exited 3", observedAtIso: AT, ok: false });
  });

  it("parses a clean exit's document and stamps it with the receipt", () => {
    const result = liveResultOf({
      outcome: { err: "", ok: true, out: '{"displayName":"Acme"}\n', tookMs: 5 },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({ observedAtIso: AT, ok: true, payload: { displayName: "Acme" }, stampedByRoute: true });
  });

  it("names what a clean exit printed when it is not the declared format", () => {
    const result = liveResultOf({
      outcome: { err: "", ok: true, out: "organisation Acme", tookMs: 7 },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({
      notMeasured: "slopweaver org show --json printed something beginning `organisation Acme`, not json, after 7ms",
      observedAtIso: AT,
      ok: false,
    });
  });
});

describe("organisationNotConfiguredWhy", () => {
  it("answers the runner's ORG_NOT_CONFIGURED payload with the verb's own sentence", () => {
    expect(
      organisationNotConfiguredWhy({
        payload: { code: "ORG_NOT_CONFIGURED", kind: "expected-empty", why: NOT_CONFIGURED_SENTENCE },
      }),
    ).toBe(NOT_CONFIGURED_SENTENCE);
  });

  it("leaves a configured document to the placement schema", () => {
    expect(organisationNotConfiguredWhy({ payload: { displayName: "Acme", githubOwner: "acme" } })).toBe(undefined);
  });

  it("leaves an expected-empty payload naming another code, or carrying no sentence, to the schema", () => {
    expect(organisationNotConfiguredWhy({ payload: { code: "NO_ROWS", kind: "expected-empty", why: "x" } })).toBe(
      undefined,
    );
    expect(organisationNotConfiguredWhy({ payload: { code: "ORG_NOT_CONFIGURED", kind: "expected-empty" } })).toBe(
      undefined,
    );
  });

  it("leaves a payload that is not an object to the schema", () => {
    expect(organisationNotConfiguredWhy({ payload: null })).toBe(undefined);
    expect(organisationNotConfiguredWhy({ payload: "Acme" })).toBe(undefined);
  });
});
