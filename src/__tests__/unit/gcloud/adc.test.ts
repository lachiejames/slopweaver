import { describe, expect, it } from "vitest";

import {
  type AdcReading,
  adcSource,
  classifyAdcFailure,
  readingLine,
  shouldProbe,
  signInFixes,
} from "../../../gcloud/adc.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The body Google answers a session-control refusal with, as oauth2client.js rewrites it into the message. */
const RAPT_BODY = {
  error: "invalid_grant",
  error_description: "reauth related error (invalid_rapt)",
  error_subtype: "invalid_rapt",
  error_uri: "https://support.google.com/a/answer/9368756",
};

/** A thrown value shaped like the GaxiosError a refused refresh raises: message rewritten, body on `response`. */
function refusedRefresh({ data }: { data: Record<string, unknown> }): Error {
  return Object.assign(new Error(JSON.stringify(data)), { response: { data, status: 400 } });
}

const WELL_KNOWN = { kind: "well-known", path: "/h/.config/gcloud/application_default_credentials.json" } as const;

describe("classifyAdcFailure", () => {
  it("reads session control's invalid_rapt from the response body, never the rewritten message", () => {
    expect(classifyAdcFailure({ error: refusedRefresh({ data: RAPT_BODY }) })).toEqual({
      detail: "reauth related error (invalid_rapt)",
      state: "reauth",
      subtype: "invalid_rapt",
    });
  });

  it("reads a plain expired refresh token as reauth with no subtype", () => {
    const error = refusedRefresh({
      data: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
    });
    expect(classifyAdcFailure({ error })).toEqual({ detail: "Token has been expired or revoked.", state: "reauth" });
  });

  it("reads the SDK's no-credential message as absent", () => {
    const error = new Error(
      "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.",
    );
    expect(classifyAdcFailure({ error }).state).toBe("absent");
  });

  it("reads a network failure with no response as failed, carrying its code", () => {
    const error = Object.assign(new Error("getaddrinfo ENOTFOUND oauth2.googleapis.com"), { code: "ENOTFOUND" });
    expect(classifyAdcFailure({ error })).toEqual({
      detail: "getaddrinfo ENOTFOUND oauth2.googleapis.com (ENOTFOUND)",
      state: "failed",
    });
  });

  it("reads another HTTP refusal as failed, because a sign-in does not fix it", () => {
    const error = refusedRefresh({ data: { error: "internal_failure" } });
    expect(classifyAdcFailure({ error }).state).toBe("failed");
  });

  it("reads an unreadable GOOGLE_APPLICATION_CREDENTIALS file as failed", () => {
    const error = new Error(
      "Unable to read the credential file specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable: ENOENT",
    );
    expect(classifyAdcFailure({ error }).state).toBe("failed");
  });

  it("reads a thrown non-Error as failed", () => {
    expect(classifyAdcFailure({ error: "boom" })).toEqual({
      detail: "the token read threw something that is not an Error",
      state: "failed",
    });
  });

  it("caps a long provider detail", () => {
    const error = new Error("x".repeat(500));
    expect(classifyAdcFailure({ error }).detail).toHaveLength(200);
  });
});

describe("adcSource", () => {
  it("names GOOGLE_APPLICATION_CREDENTIALS first", () => {
    const env = { CLOUDSDK_CONFIG: "/c", GOOGLE_APPLICATION_CREDENTIALS: "/k.json", HOME: "/h" };
    expect(unwrap(adcSource({ env }))).toEqual({ kind: "env", path: "/k.json" });
  });

  it("names the CLOUDSDK_CONFIG file next", () => {
    expect(unwrap(adcSource({ env: { CLOUDSDK_CONFIG: "/c", HOME: "/h" } }))).toEqual({
      kind: "well-known",
      path: "/c/application_default_credentials.json",
    });
  });

  it("names the gcloud file under HOME otherwise, ignoring a blank variable", () => {
    expect(unwrap(adcSource({ env: { GOOGLE_APPLICATION_CREDENTIALS: "  ", HOME: "/h" } }))).toEqual(WELL_KNOWN);
  });

  it("refuses when there is no HOME to look under", () => {
    expect(unwrapErr(adcSource({ env: {} }))).toEqual([
      "HOME is not set, so the gcloud credential file has no directory to be found in",
    ]);
  });
});

describe("signInFixes", () => {
  const reading = (over: Partial<AdcReading>): AdcReading => ({
    detail: "d",
    source: WELL_KNOWN,
    state: "absent",
    ...over,
  });

  it("is true for an absent or refused gcloud-file credential", () => {
    expect([signInFixes({ reading: reading({}) }), signInFixes({ reading: reading({ state: "reauth" }) })]).toEqual([
      true,
      true,
    ]);
  });

  it("is false for a failure, a valid read, or an explicit key file", () => {
    expect([
      signInFixes({ reading: reading({ state: "failed" }) }),
      signInFixes({ reading: reading({ state: "valid" }) }),
      signInFixes({ reading: reading({ source: { kind: "env", path: "/k.json" } }) }),
    ]).toEqual([false, false, false]);
  });
});

describe("shouldProbe", () => {
  const memo = {
    fingerprint: "10:20",
    probedAtMs: 1_000,
    reading: { detail: "d", source: WELL_KNOWN, state: "absent" },
  } as const;

  it("probes on the first read and whenever the file changed", () => {
    expect([
      shouldProbe({ fingerprint: "10:20", memo: undefined, minIntervalMs: 60_000, nowMs: 1_000 }),
      shouldProbe({ fingerprint: "11:20", memo, minIntervalMs: 60_000, nowMs: 2_000 }),
    ]).toEqual([true, true]);
  });

  it("answers from memory for an unchanged file until the interval passes", () => {
    expect([
      shouldProbe({ fingerprint: "10:20", memo, minIntervalMs: 60_000, nowMs: 60_999 }),
      shouldProbe({ fingerprint: "10:20", memo, minIntervalMs: 60_000, nowMs: 61_000 }),
    ]).toEqual([false, true]);
  });
});

describe("readingLine", () => {
  it("names the state, subtype, detail and file", () => {
    const reading: AdcReading = {
      detail: "reauth related error",
      source: WELL_KNOWN,
      state: "reauth",
      subtype: "invalid_rapt",
    };
    expect(readingLine({ reading })).toBe(
      "google adc: reauth (invalid_rapt) — reauth related error [/h/.config/gcloud/application_default_credentials.json]",
    );
  });
});
