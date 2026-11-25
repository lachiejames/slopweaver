/**
 * The CLI's copy of the credential route a Claude launch carries: each arm names only its own paths, and a token or
 * any other field never rides it.
 */
import { describe, expect, it } from "vitest";

import { isClaudeCredentialRoute } from "../../../sessionHarness/credentialRouteWire.js";

const STORE = { kind: "store", secureStorageDir: "/fixture/store" };
const SETUP_TOKEN = { kind: "setup-token", secureStorageDir: "/fixture/store", tokenFilePath: "/fixture/token" };

describe("a Claude credential route", () => {
  it("accepts a store route and a setup-token route naming its token file", () => {
    expect([STORE, SETUP_TOKEN].map((route) => isClaudeCredentialRoute(route))).toEqual([true, true]);
  });

  it("refuses a token, a stray field, a missing path, a path that is not a string and an unknown kind", () => {
    expect(
      [
        { ...STORE, token: "FIXTURE-TOKEN" },
        { ...STORE, tokenFilePath: "/fixture/token" },
        { ...SETUP_TOKEN, token: "FIXTURE-TOKEN" },
        { kind: "setup-token", secureStorageDir: "/fixture/store" },
        { kind: "store" },
        { ...STORE, secureStorageDir: 7 },
        { ...STORE, kind: "keychain" },
        [STORE],
        null,
        "store",
      ].map((route) => isClaudeCredentialRoute(route)),
    ).toEqual([false, false, false, false, false, false, false, false, false, false]);
  });
});
