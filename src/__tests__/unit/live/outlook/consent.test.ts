/**
 * Unit: the Outlook consent round trip over plain fake effects — the callback's checks, the account address, and
 * the ORDER of the flow: the URL is built only after the listener announces itself, presented only once built,
 * and a URL that cannot be built aborts the listener rather than leaving a socket open until its deadline.
 */
import { describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { type LoopbackError, LoopbackErrors } from "../../../../live/oauth/loopback.js";
import {
  accountAddress,
  type OutlookConsentDeps,
  parseOutlookCallback,
  runOutlookConsent,
} from "../../../../live/outlook/consent.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";

const STATE = "state-synthetic";
const REDIRECT = "http://localhost:53682";

/** The effects of one consent, recording each step in order; `fail` names the one step that refuses. */
function fakeConsent({
  callback = `/?code=code-1&state=${STATE}&client_info=ci-1`,
  fail,
  announce = true,
}: {
  callback?: string;
  fail?: "url" | "redeem";
  announce?: boolean;
}): { deps: OutlookConsentDeps; steps: string[]; signals: AbortSignal[] } {
  const steps: string[] = [];
  const signals: AbortSignal[] = [];
  const deps: OutlookConsentDeps = {
    awaitCallback: ({ onListening, signal }) => {
      signals.push(signal);
      steps.push("listen");
      if (!announce) {
        return Promise.resolve(
          err<{ requestUrl: string }, LoopbackError>(
            LoopbackErrors.listenerFailed({ cause: new Error("port in use") }),
          ),
        );
      }
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          steps.push("aborted");
          resolve(err({ code: "CONSENT_ABANDONED", message: "abandoned" }));
        });
        onListening({ redirectUri: REDIRECT });
        setImmediate(() => {
          if (!signal.aborted) {
            steps.push("callback");
            resolve(ok({ requestUrl: callback }));
          }
        });
      });
    },
    consentUrl: async ({ redirectUri }) => {
      steps.push(`url ${redirectUri}`);
      return fail === "url"
        ? err(OutlookErrors.consentFailed({ message: "no url" }))
        : ok("https://login.example.test/x");
    },
    identify: async () => {
      steps.push("identify");
      return ok({ id: "me-1", mail: null, userPrincipalName: "owner@example.test" });
    },
    makeSecrets: async () => ({ challenge: "challenge-1", state: STATE, verifier: "verifier-1" }),
    present: ({ url }) => {
      steps.push(`present ${url}`);
    },
    redeem: async ({ code, clientInfo, verifier }) => {
      steps.push(`redeem ${code} ${String(clientInfo)} ${verifier}`);
      if (fail === "redeem") {
        return err(OutlookErrors.consentFailed({ message: "invalid_grant" }));
      }
      return ok({
        accessToken: "token-synthetic",
        expiryMs: 1_000,
        homeAccountId: "home-1",
        msalCache: "{}",
        scopes: ["https://graph.microsoft.com/Mail.Read", "openid", "profile", "offline_access", "User.Read"],
      });
    },
  };
  return { deps, signals, steps };
}

describe("parseOutlookCallback", () => {
  it("takes the code and client info when the state matches", () => {
    const parsed = parseOutlookCallback({
      expectedState: STATE,
      requestUrl: `/?code=c-1&state=${STATE}&client_info=ci`,
    });
    expect(unwrap(parsed)).toEqual({ clientInfo: "ci", code: "c-1" });
  });

  it.each([
    ["/?error=access_denied&error_description=declined", "Microsoft refused the consent (access_denied): declined"],
    [`/?code=c-1&state=foreign`, "the browser came back with a state this consent did not issue"],
    [`/?state=${STATE}`, "the browser came back with no authorization code"],
  ])("refuses %s", (requestUrl, message) => {
    const error = unwrapErr(parseOutlookCallback({ expectedState: STATE, requestUrl }));
    expect(error.code).toBe("CONSENT_FAILED");
    expect(error.message).toContain(message);
  });
});

describe("accountAddress", () => {
  it("prefers mail, then the user principal name", () => {
    expect(
      unwrap(accountAddress({ identity: { id: "1", mail: "a@example.test", userPrincipalName: "b@example.test" } })),
    ).toBe("a@example.test");
    expect(unwrap(accountAddress({ identity: { id: "1", mail: "", userPrincipalName: "b@example.test" } }))).toBe(
      "b@example.test",
    );
  });

  it("refuses an identity naming neither", () => {
    const error = unwrapErr(accountAddress({ identity: { id: "1", mail: null, userPrincipalName: undefined } }));
    expect(error.code).toBe("RESPONSE_FIELD_MISSING");
  });
});

describe("runOutlookConsent", () => {
  it("listens, builds the URL, presents it, then redeems and identifies — recording only resource scopes", async () => {
    const { deps, steps } = fakeConsent({});
    const outcome = await runOutlookConsent({ deps, scopes: ["Mail.Read", "offline_access"] });
    expect(unwrap(outcome)).toEqual({
      account: "owner@example.test",
      expiryMs: 1_000,
      homeAccountId: "home-1",
      msalCache: "{}",
      scopes: ["Mail.Read", "User.Read"],
    });
    expect(steps).toEqual([
      "listen",
      `url ${REDIRECT}`,
      "present https://login.example.test/x",
      "callback",
      "redeem code-1 ci-1 verifier-1",
      "identify",
    ]);
  });

  it("aborts the listener and presents nothing when the URL cannot be built", async () => {
    const { deps, steps, signals } = fakeConsent({ fail: "url" });
    const error = unwrapErr(await runOutlookConsent({ deps, scopes: ["Mail.Read"] }));
    expect(error.message).toBe("no url");
    expect(signals[0]!.aborted).toBe(true);
    expect(steps).toEqual(["listen", `url ${REDIRECT}`, "aborted"]);
  });

  it("reports a listener that ends before announcing itself", async () => {
    const { deps, steps } = fakeConsent({ announce: false });
    const error = unwrapErr(await runOutlookConsent({ deps, scopes: ["Mail.Read"] }));
    expect(error.code).toBe("CONSENT_FAILED");
    expect(error.message).toBe("could not open the loopback listener: port in use");
    expect(steps).toEqual(["listen"]);
  });

  it("never redeems a code that came back under a foreign state", async () => {
    const { deps, steps } = fakeConsent({ callback: "/?code=code-1&state=foreign" });
    const error = unwrapErr(await runOutlookConsent({ deps, scopes: ["Mail.Read"] }));
    expect(error.code).toBe("CONSENT_FAILED");
    expect(steps.some((step) => step.startsWith("redeem"))).toBe(false);
  });

  it("stops at a refused redemption without asking Graph who the account is", async () => {
    const { deps, steps } = fakeConsent({ fail: "redeem" });
    const error = unwrapErr(await runOutlookConsent({ deps, scopes: ["Mail.Read"] }));
    expect(error.message).toBe("invalid_grant");
    expect(steps.includes("identify")).toBe(false);
  });
});
