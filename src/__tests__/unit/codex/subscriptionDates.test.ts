import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeCodexSubscriptionDates, readCodexSubscriptionDates } from "../../../codex/subscriptionDates.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PATH = "/fixture/codex-1/auth.json";
const NAMESPACE = "https://api.openai.com/auth";
const ACCESS_SECRET = "FIXTURE-ACCESS-SECRET-VALUE";
const REFRESH_SECRET = "FIXTURE-REFRESH-SECRET-VALUE";
const ACCOUNT_SECRET = "FIXTURE-ACCOUNT-ID-VALUE";

/** A synthetic, unsigned JWT segment, built at runtime so no token-shaped literal sits in the source. */
const segment = ({ value }: { value: unknown }): string => Buffer.from(JSON.stringify(value)).toString("base64url");

const idTokenOf = ({ payloadSegment }: { payloadSegment: string }): string =>
  [segment({ value: { alg: "none" } }), payloadSegment, Buffer.from("fixture-signature").toString("base64url")].join(
    ".",
  );

const authTextOf = ({ idToken }: { idToken: unknown }): string =>
  JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: ACCESS_SECRET,
      account_id: ACCOUNT_SECRET,
      id_token: idToken,
      refresh_token: REFRESH_SECRET,
    },
  });

const STATED_CLAIMS = {
  chatgpt_account_id: ACCOUNT_SECRET,
  chatgpt_plan_type: "pro",
  chatgpt_subscription_active_start: "2026-01-02T03:04:05+00:00",
  chatgpt_subscription_active_until: "2026-02-02T03:04:05.123456+00:00",
  chatgpt_subscription_last_checked: "2026-01-20T10:11:12.654321+00:00",
};

const authTextWithClaims = ({ claims }: { claims: unknown }): string =>
  authTextOf({
    idToken: idTokenOf({ payloadSegment: segment({ value: { email: "fixture@acme.example", [NAMESPACE]: claims } }) }),
  });

describe("decodeCodexSubscriptionDates", () => {
  it("reads the paid-through and last-checked dates as stated, six fractional digits and a +00:00 offset included", () => {
    const result = decodeCodexSubscriptionDates({
      authText: authTextWithClaims({ claims: STATED_CLAIMS }),
      path: PATH,
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      lastCheckedIso: "2026-01-20T10:11:12.654321+00:00",
      paidThroughIso: "2026-02-02T03:04:05.123456+00:00",
    });
  });

  it("returns the dates and nothing else: no token, no other claim", () => {
    const result = decodeCodexSubscriptionDates({
      authText: authTextWithClaims({ claims: STATED_CLAIMS }),
      path: PATH,
    });
    const shown = JSON.stringify(unwrap(result));

    expect(Object.keys(unwrap(result)).toSorted()).toEqual(["lastCheckedIso", "paidThroughIso"]);
    // The witness: the input carries every value the output is said to lack.
    expect(authTextWithClaims({ claims: STATED_CLAIMS })).toContain(ACCOUNT_SECRET);
    expect(authTextWithClaims({ claims: STATED_CLAIMS })).toContain(ACCESS_SECRET);
    expect(JSON.stringify(STATED_CLAIMS)).toContain(STATED_CLAIMS.chatgpt_subscription_active_start);
    expect(shown).not.toContain(ACCOUNT_SECRET);
    expect(shown).not.toContain(ACCESS_SECRET);
    expect(shown).not.toContain(STATED_CLAIMS.chatgpt_subscription_active_start);
    expect(shown).not.toContain("pro");
  });

  it("accepts a Z offset", () => {
    const claims = {
      chatgpt_subscription_active_start: "2026-01-02T03:04:05Z",
      chatgpt_subscription_active_until: "2026-02-02T03:04:05Z",
      chatgpt_subscription_last_checked: "2026-01-20T10:11:12Z",
    };

    expect(
      unwrap(decodeCodexSubscriptionDates({ authText: authTextWithClaims({ claims }), path: PATH })).paidThroughIso,
    ).toBe("2026-02-02T03:04:05Z");
  });

  it("refuses text that is not JSON, naming the path and none of the text", () => {
    const authText = `{"tokens": ${ACCESS_SECRET}`;
    const error = unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH }));

    expect(error.code).toBe("CODEX_SUBSCRIPTION_AUTH_INVALID");
    expect(error.path).toBe(PATH);
    expect(JSON.stringify(error)).not.toContain(ACCESS_SECRET);
  });

  it("refuses a document with no id_token string", () => {
    const authText = JSON.stringify({ tokens: { access_token: ACCESS_SECRET } });

    expect(unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH })).code).toBe(
      "CODEX_SUBSCRIPTION_AUTH_INVALID",
    );
  });

  it("refuses an id_token that is not three segments", () => {
    const authText = authTextOf({ idToken: `${segment({ value: { alg: "none" } })}.${segment({ value: {} })}` });

    expect(unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH })).code).toBe(
      "CODEX_SUBSCRIPTION_ID_TOKEN_INVALID",
    );
  });

  it("refuses a payload segment that is not canonical base64url, which Node alone would decode by skipping", () => {
    const canonical = segment({ value: { [NAMESPACE]: STATED_CLAIMS } });
    const authText = authTextOf({
      idToken: idTokenOf({ payloadSegment: `${canonical.slice(0, 4)}!${canonical.slice(4)}` }),
    });

    expect(unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH })).code).toBe(
      "CODEX_SUBSCRIPTION_ID_TOKEN_INVALID",
    );
  });

  it("refuses a payload that decodes to bytes that are not JSON", () => {
    const authText = authTextOf({
      idToken: idTokenOf({ payloadSegment: Buffer.from(`{"${NAMESPACE}": ${ACCOUNT_SECRET}`).toString("base64url") }),
    });
    const error = unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH }));

    expect(error.code).toBe("CODEX_SUBSCRIPTION_ID_TOKEN_INVALID");
    expect(JSON.stringify(error)).not.toContain(ACCOUNT_SECRET);
  });

  it("refuses a namespace that is not an object", () => {
    const authText = authTextOf({ idToken: idTokenOf({ payloadSegment: segment({ value: { [NAMESPACE]: "pro" } }) }) });

    expect(unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH })).code).toBe(
      "CODEX_SUBSCRIPTION_ID_TOKEN_INVALID",
    );
  });

  it("names a payload with no ChatGPT namespace as stating no date", () => {
    const authText = authTextOf({ idToken: idTokenOf({ payloadSegment: segment({ value: { email: "x" } }) }) });

    expect(unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH })).code).toBe(
      "CODEX_SUBSCRIPTION_CLAIMS_ABSENT",
    );
  });

  it("names a namespace without the paid-through claim as stating no date", () => {
    const authText = authTextWithClaims({ claims: { chatgpt_plan_type: "free" } });

    expect(unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH })).code).toBe(
      "CODEX_SUBSCRIPTION_CLAIMS_ABSENT",
    );
  });

  it("names a null paid-through claim as stating no date", () => {
    const authText = authTextWithClaims({ claims: { ...STATED_CLAIMS, chatgpt_subscription_active_until: null } });

    expect(unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH })).code).toBe(
      "CODEX_SUBSCRIPTION_CLAIMS_ABSENT",
    );
  });

  it("refuses a date that carries no offset", () => {
    const authText = authTextWithClaims({
      claims: { ...STATED_CLAIMS, chatgpt_subscription_active_until: "2026-02-02T03:04:05" },
    });

    expect(unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH })).code).toBe(
      "CODEX_SUBSCRIPTION_CLAIMS_INVALID",
    );
  });

  it("refuses a date claim of the wrong type, quoting none of it", () => {
    const authText = authTextWithClaims({
      claims: { ...STATED_CLAIMS, chatgpt_subscription_last_checked: ACCOUNT_SECRET },
    });
    const error = unwrapErr(decodeCodexSubscriptionDates({ authText, path: PATH }));

    expect(error.code).toBe("CODEX_SUBSCRIPTION_CLAIMS_INVALID");
    expect(JSON.stringify(error)).not.toContain(ACCOUNT_SECRET);
  });

  it("reads a paid-through date whose start-date claim is missing, since nothing prints the start", () => {
    const { chatgpt_subscription_active_start: _dropped, ...claims } = STATED_CLAIMS;

    expect(unwrap(decodeCodexSubscriptionDates({ authText: authTextWithClaims({ claims }), path: PATH }))).toEqual({
      lastCheckedIso: "2026-01-20T10:11:12.654321+00:00",
      paidThroughIso: "2026-02-02T03:04:05.123456+00:00",
    });
  });
});

describe("readCodexSubscriptionDates", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("reads auth.json from the store directory", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-dates-"));
    homes.push(codexHome);
    writeFileSync(join(codexHome, "auth.json"), authTextWithClaims({ claims: STATED_CLAIMS }));

    expect(unwrap(readCodexSubscriptionDates({ codexHome })).paidThroughIso).toBe("2026-02-02T03:04:05.123456+00:00");
  });

  it("names a store with no auth.json as unreadable, at its path", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-dates-"));
    homes.push(codexHome);
    const error = unwrapErr(readCodexSubscriptionDates({ codexHome }));

    expect(error.code).toBe("CODEX_SUBSCRIPTION_AUTH_UNREADABLE");
    expect(error.path).toBe(join(codexHome, "auth.json"));
  });
});
