/**
 * Unit: the consent ORCHESTRATION, over plain fake seams. The socket and the browser are injected, so what
 * is under test here is the ordering and the refusals — including the CSRF check, which is the only thing
 * standing between a loopback listener and any page on the machine's browser handing it a code.
 *
 * The flow is generic over the door's error type, so it is driven here with the mail door's real union and
 * its real factory rather than a stand-in: the `provider` argument is what prefixes both operation labels,
 * and the assertion on those labels is what would catch a door paced or recorded against the wrong entry.
 */
import { describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { type GmailError, GmailErrors } from "../../../../live/gmail/errors.js";
import { type ConsentDeps, runGoogleConsentFlow } from "../../../../live/google/consent.js";
import { LoopbackErrors } from "../../../../live/oauth/loopback.js";

const SECRETS = { codeChallenge: "chal", codeVerifier: "ver", state: "st8" };

/** Captured seam traffic: the consent URL presented, and the bodies each endpoint was called with. */
interface Captured {
  readonly deps: ConsentDeps<GmailError>;
  readonly presented: string[];
  readonly operations: string[];
  readonly bodies: string[];
}

function fakeDeps({
  callbackQuery = "/?code=the-code&state=st8",
  callbackFails = false,
  tokenBody = JSON.stringify({ access_token: "at", expires_in: 3599, refresh_token: "rt", scope: "a b" }),
  userinfoBody = JSON.stringify({ email: "me@example.test" }),
  tokenFails = false,
}: {
  callbackQuery?: string;
  callbackFails?: boolean;
  tokenBody?: string;
  userinfoBody?: string;
  tokenFails?: boolean;
} = {}): Captured {
  const presented: string[] = [];
  const operations: string[] = [];
  const bodies: string[] = [];
  return {
    bodies,
    deps: {
      awaitCallback: async ({ onListening }) => {
        onListening({ redirectUri: "http://127.0.0.1:5555" });
        return callbackFails ? err(LoopbackErrors.windowClosed()) : ok({ requestUrl: callbackQuery });
      },
      getWithToken: async ({ operation }) => {
        operations.push(operation);
        return ok(userinfoBody);
      },
      postForm: async ({ operation, body }) => {
        operations.push(operation);
        bodies.push(body);
        return tokenFails ? err(GmailErrors.consentFailed({ message: "the endpoint refused" })) : ok(tokenBody);
      },
      present: ({ url }) => presented.push(url),
    },
    operations,
    presented,
  };
}

async function run({ captured }: { captured: Captured }) {
  return runGoogleConsentFlow({
    clientId: "cid",
    clientSecret: "csec",
    deps: captured.deps,
    errors: { consentFailed: ({ message, cause }) => GmailErrors.consentFailed({ cause, message }) },
    provider: "gmail",
    scopes: ["scope-a"],
    secrets: SECRETS,
  });
}

describe("runGoogleConsentFlow", () => {
  it("presents a consent URL carrying the loopback the listener actually bound", async () => {
    const captured = fakeDeps();
    await run({ captured });
    const url = new URL(captured.presented[0]!);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5555");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toBe("scope-a");
  });

  it("exchanges the code with the PKCE verifier and the same redirect, then reads the identity", async () => {
    const captured = fakeDeps();
    const result = await run({ captured });
    expect(result.isOk()).toBe(true);
    expect(captured.operations).toStrictEqual(["gmail.oauth.tokenExchange", "gmail.oauth.userinfo"]);
    const body = new URLSearchParams(captured.bodies[0]);
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("ver");
    expect(body.get("redirect_uri")).toBe("http://127.0.0.1:5555");
  });

  it("returns the granted tokens and the bound mailbox", async () => {
    const result = await run({ captured: fakeDeps() });
    expect(unwrap(result).account).toBe("me@example.test");
    expect(unwrap(result).tokens.refreshToken).toBe("rt");
    expect(unwrap(result).tokens.scope).toBe("a b");
  });

  it("REFUSES a callback whose state does not match, without exchanging anything", async () => {
    const captured = fakeDeps({ callbackQuery: "/?code=the-code&state=forged" });
    const result = await run({ captured });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("CONSENT_FAILED");
    expect(captured.operations).toStrictEqual([]);
  });

  it("refuses when the browser never came back, without exchanging anything", async () => {
    const captured = fakeDeps({ callbackFails: true });
    const result = await run({ captured });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe("the consent window closed before the browser came back");
    expect(captured.operations).toStrictEqual([]);
  });

  it("surfaces a refused exchange and never calls userinfo", async () => {
    const captured = fakeDeps({ tokenFails: true });
    const result = await run({ captured });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("the endpoint refused");
    expect(captured.operations).toStrictEqual(["gmail.oauth.tokenExchange"]);
  });

  it("refuses a userinfo response with no email rather than storing an unattributable grant", async () => {
    const captured = fakeDeps({ userinfoBody: JSON.stringify({ sub: "1" }) });
    const result = await run({ captured });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("userinfo.email");
  });
});
