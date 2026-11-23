/**
 * The two halves of the at-most-once delete client, each carrying the witness the other cannot give.
 *
 * `WebClient` keeps `retryConfig` private, so nothing can ask a BUILT client how many attempts it will
 * make. The number is therefore asserted at the last point it is readable — the options constant — and the
 * binding from that constant to the one destructive call site is held by the compiler, which is why the
 * second block asserts on a TYPE. Both run in CI: this file in the unit lane, the type in `yarn typecheck`.
 */
import { WebClient } from "@slack/web-api";
import { describe, expect, it } from "vitest";

import { AT_MOST_ONCE_OPTIONS, postingClient } from "../../../../corpus/slack/atMostOnceClient.js";
import type { deleteMessageCall, deleteMessageOnceCall } from "../../../../corpus/slack/writeApiRead.js";
import { NO_TERMS_SLACK_PRIVACY } from "../../../slackWritePrivacyFixture.js";

/**
 * `true` only while `T` is NARROWER than a plain `WebClient`.
 *
 * Declared here rather than inline so the conditional stays out of the assertion, per `testing.md`. It is
 * the falsifiable half: widen `deleteMessageOnceCall`'s `client` back to `WebClient` and this resolves to
 * `false`, so the `= true` below stops compiling.
 */
type BrandIsRequired<T> = WebClient extends T ? false : true;

/** The `client` field each delete actually declares, read off the shipped signature rather than restated. */
type DeleteOnceClient = Parameters<typeof deleteMessageOnceCall>[0]["client"];
type RepeatableDeleteClient = Parameters<typeof deleteMessageCall>[0]["client"];

describe("AT_MOST_ONCE_OPTIONS", () => {
  it("asks the SDK for zero retries — the number no built client will answer", () => {
    expect(AT_MOST_ONCE_OPTIONS.retryConfig.retries).toBe(0);
  });

  it("carries the retry budget and nothing else, so it cannot quietly acquire a second policy", () => {
    expect(Object.keys(AT_MOST_ONCE_OPTIONS)).toEqual(["retryConfig"]);
  });
});

describe("the brand on the destructive delete", () => {
  it("is minted by postingClient, which is the whole supply of it", () => {
    const minted = postingClient({ privacy: NO_TERMS_SLACK_PRIVACY, token: "xoxb-not-a-real-token" });
    expect(minted instanceof WebClient).toBe(true);
  });

  it("is REQUIRED by deleteMessageOnceCall, so the repeatable client cannot reach it", () => {
    // MEASURED: rebinding the live wiring's `{ client: posting }` to `{ client }` — one word —
    // survived every test in this repository. This is what refuses it now, and it refuses at compile time.
    const brandRequired: BrandIsRequired<DeleteOnceClient> = true;
    expect(brandRequired).toBe(true);
  });

  it("stops at that one call: the REPEATABLE delete still takes any client, and should", () => {
    const brandRequired: BrandIsRequired<RepeatableDeleteClient> = false;
    expect(brandRequired).toBe(false);
  });
});
