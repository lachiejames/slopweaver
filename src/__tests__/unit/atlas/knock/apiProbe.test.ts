/**
 * The measured facts of Knock's unauthenticated probe, as literals: the closed evidence vocabulary with no
 * validation-first member, the per-origin refusal codes, the two deliberately different 404 details that
 * prove which service answered, and the whole census a `--verify` run reproduces.
 */
import { describe, expect, it } from "vitest";

import {
  KNOCK_AUTH_REFUSAL_CODES,
  KNOCK_NOT_FOUND_DETAILS,
  KNOCK_PROBE_CENSUS,
  KNOCK_PROBE_EVIDENCE,
} from "../../../../atlas/knock/apiProbe.js";

describe("Knock probe facts", () => {
  it("names exactly three evidence classes, with no validation-first member", () => {
    expect(KNOCK_PROBE_EVIDENCE).toEqual(["exists-auth-required", "absent-404", "unprobed-mutating"]);
  });

  it("records a different credential-missing code per origin", () => {
    expect(KNOCK_AUTH_REFUSAL_CODES).toEqual({ data: "api_key_missing", management: "bearer_token_missing" });
  });

  it("records the two 404 details, differing only by the data API's literal prefix", () => {
    expect(KNOCK_NOT_FOUND_DETAILS).toEqual({ data: "404 Not Found", management: "Not Found" });
  });

  it("records the whole census: 39 data and 47 management GETs exist, none absent, 130 unprobed", () => {
    expect(KNOCK_PROBE_CENSUS).toEqual({
      absent: 0,
      controlsPerOrigin: 3,
      dataExists: 39,
      managementExists: 47,
      unprobedMutating: 130,
    });
  });
});
