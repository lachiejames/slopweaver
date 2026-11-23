/**
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */

import { describe, expect, it } from "vitest";
import { landingCiFailure } from "../../../review/landingCiFailure.js";
import type { FailingCheckDetail } from "../../../review/prStateDetail.js";
import type { PrReviewState } from "../../../review/reviewState.js";

type CiFields = Pick<PrReviewState, "ci" | "failingChecks" | "checksRead" | "checksTruncated" | "requiredContexts">;

const check = ({ name, required }: { name: string; required: boolean | undefined }): FailingCheckDetail => ({
  kind: "check-run",
  name,
  required,
  state: "failed",
  url: undefined,
});

/** A red rollup read whole, over a required set that was read and is fully present. */
const red = (over: Partial<CiFields> = {}): CiFields => ({
  checksRead: { kind: "read" },
  checksTruncated: false,
  ci: "red",
  failingChecks: [],
  requiredContexts: {
    branch: "staging",
    kind: "read",
    mergeable: undefined,
    missing: [],
    required: ["build"],
    unproven: [],
  },
  ...over,
});

const ADVISORY = check({ name: "Advisory local browser E2E (billing)", required: false });
const REQUIRED = check({ name: "build", required: true });
const UNKNOWN = check({ name: "e2e", required: undefined });

describe("landingCiFailure", () => {
  it("is not-red on a green rollup, whatever the checks list carries", () => {
    expect(landingCiFailure({ state: red({ ci: "green", failingChecks: [REQUIRED] }) })).toStrictEqual({
      kind: "not-red",
    });
  });

  it("is required on one required failure", () => {
    expect(landingCiFailure({ state: red({ failingChecks: [REQUIRED] }) })).toStrictEqual({
      kind: "red",
      required: true,
    });
  });

  it("is advisory when every failure is known advisory", () => {
    expect(landingCiFailure({ state: red({ failingChecks: [ADVISORY] }) })).toStrictEqual({
      kind: "red",
      required: false,
    });
  });

  it("is required on a required failure beside an unknown one", () => {
    expect(landingCiFailure({ state: red({ failingChecks: [UNKNOWN, REQUIRED] }) })).toStrictEqual({
      kind: "red",
      required: true,
    });
  });

  it("is unknown on an advisory failure beside an unknown one, never advisory", () => {
    expect(landingCiFailure({ state: red({ failingChecks: [ADVISORY, UNKNOWN] }) })).toStrictEqual({
      kind: "red",
      required: undefined,
    });
  });

  it("is unknown on a red rollup with no failure details, where every() is vacuously true", () => {
    expect(landingCiFailure({ state: red({ failingChecks: [] }) })).toStrictEqual({ kind: "red", required: undefined });
  });

  it("is unknown when the checks page was truncated, which can only lose a failing required context", () => {
    expect(landingCiFailure({ state: red({ checksTruncated: true, failingChecks: [ADVISORY] }) })).toStrictEqual({
      kind: "red",
      required: undefined,
    });
  });

  it("is unknown when the required set could not be read", () => {
    const state = red({ failingChecks: [ADVISORY], requiredContexts: { kind: "unreadable", reason: "403" } });
    expect(landingCiFailure({ state })).toStrictEqual({ kind: "red", required: undefined });
  });

  it("is required when a context the base requires never ran, even beside advisory failures only", () => {
    const state = red({
      failingChecks: [ADVISORY],
      requiredContexts: {
        branch: "staging",
        kind: "read",
        mergeable: undefined,
        missing: ["build"],
        required: ["build"],
        unproven: [],
      },
    });
    expect(landingCiFailure({ state })).toStrictEqual({ kind: "red", required: true });
  });
});
