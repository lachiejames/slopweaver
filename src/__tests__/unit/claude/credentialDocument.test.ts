import { describe, expect, it } from "vitest";

import {
  alreadyHolds,
  credentialExpiryIso,
  credentialHasAccessToken,
  credentialHasRefreshToken,
  credentialRefreshExpiryIso,
  readClaudeCredential,
} from "../../../claude/credentialDocument.js";

/** The document shape measured on this machine: the account credential beside a live MCP token map. */
const DOCUMENT = {
  claudeAiOauth: { accessToken: "A", scopes: ["user:inference"], subscriptionType: "max" },
  mcpOAuth: {
    "hex|c2f4": { accessToken: "H", serverName: "hex" },
    "slack|3880": { accessToken: "S", serverName: "slack" },
  },
};

describe("readClaudeCredential", () => {
  it("takes the account credential out of a real-shaped document", () => {
    expect(readClaudeCredential({ document: DOCUMENT })!.credential).toStrictEqual(DOCUMENT.claudeAiOauth);
  });

  it("returns undefined for a store that has never been signed in", () => {
    expect(readClaudeCredential({ document: { mcpOAuth: {} } })).toBe(undefined);
  });

  it("returns undefined for an absent item rather than throwing mid-swap", () => {
    expect(readClaudeCredential({ document: undefined })).toBe(undefined);
  });

  it("treats an explicit null credential as absent", () => {
    expect(readClaudeCredential({ document: { claudeAiOauth: null } })).toBe(undefined);
  });
});

describe("alreadyHolds", () => {
  it("is true when the target already holds this exact credential, so the swap is skipped", () => {
    expect(alreadyHolds({ document: DOCUMENT, slice: { credential: DOCUMENT.claudeAiOauth } })).toBe(true);
  });

  it("compares by value, because the two documents are decoded from two separate keychain items", () => {
    const copy = JSON.parse(JSON.stringify(DOCUMENT.claudeAiOauth)) as unknown;
    expect(alreadyHolds({ document: DOCUMENT, slice: { credential: copy } })).toBe(true);
  });

  it("is false for a different account", () => {
    expect(alreadyHolds({ document: DOCUMENT, slice: { credential: { accessToken: "B" } } })).toBe(false);
  });

  it("is false when the target holds nothing yet", () => {
    expect(alreadyHolds({ document: {}, slice: { credential: { accessToken: "B" } } })).toBe(false);
  });
});

describe("credentialExpiryIso", () => {
  it("reads the expiry as epoch MILLISECONDS, not seconds", () => {
    // The value plan-two's store actually carried. Scaled as seconds it would land in
    // the year 58,600 instead, which is the failure this assertion exists to catch.
    expect(credentialExpiryIso({ slice: { credential: { expiresAt: 1788565019054 } } })).toBe(
      "2026-09-04T23:36:59.054Z",
    );
  });

  it("returns nothing when the credential carries no expiry at all", () => {
    expect(credentialExpiryIso({ slice: { credential: { accessToken: "opaque" } } })).toBeUndefined();
  });

  it("returns nothing for a non-numeric expiry rather than inventing an instant", () => {
    expect(credentialExpiryIso({ slice: { credential: { expiresAt: "soon" } } })).toBeUndefined();
  });

  it("returns nothing for a credential that is not an object at all", () => {
    expect(credentialExpiryIso({ slice: { credential: "opaque" } })).toBeUndefined();
  });
});

describe("credentialHasAccessToken", () => {
  it("says yes for a store holding a real login", () => {
    expect(credentialHasAccessToken({ slice: readClaudeCredential({ document: DOCUMENT }) })).toBe(true);
  });

  it("says NO for the emptied credential `claude doctor` writes over a superseded refresh token", () => {
    // MEASURED: `claude doctor` exited 0 under plan-two and plan-three, moved each keychain
    // item's modification date, and left this exact shape behind. An empty string is still a string, so the
    // type-only guard this replaced presented `Bearer ` and spent a request to be told 401.
    const emptied = { claudeAiOauth: { accessToken: "", expiresAt: 0, refreshToken: "" } };
    expect(credentialHasAccessToken({ slice: readClaudeCredential({ document: emptied }) })).toBe(false);
  });

  it("says no when the credential carries no access token field at all", () => {
    const shapeless = { claudeAiOauth: { scopes: ["user:inference"] } };
    expect(credentialHasAccessToken({ slice: readClaudeCredential({ document: shapeless }) })).toBe(false);
  });

  it("says no when the credential is not an object this build recognises", () => {
    expect(credentialHasAccessToken({ slice: readClaudeCredential({ document: { claudeAiOauth: "x" } }) })).toBe(false);
  });

  it("says no for a store that has never been signed in", () => {
    expect(credentialHasAccessToken({ slice: readClaudeCredential({ document: undefined }) })).toBe(false);
  });
});

describe("credentialRefreshExpiryIso", () => {
  it("reads the refresh grant's own expiry, which is the owner's real next-sign-in deadline", () => {
    // MEASURED on this machine: plan-three's grant ran a month past the day its access token died.
    // `git grep refreshTokenExpiresAt` returned nothing before this reader existed, so every fix was
    // designed against the eight-hour number instead.
    const slice = { credential: { refreshTokenExpiresAt: 1_791_720_012_373 } };
    expect(credentialRefreshExpiryIso({ slice })).toBe("2026-10-11T12:00:12.373Z");
  });

  it("returns undefined for an absent field, which callers must read as UNKNOWN and never as alive", () => {
    expect(credentialRefreshExpiryIso({ slice: { credential: { accessToken: "A" } } })).toBe(undefined);
  });

  it("refuses a string rather than coercing one, so a future build's shape change reads as unknown", () => {
    expect(credentialRefreshExpiryIso({ slice: { credential: { refreshTokenExpiresAt: "1791720012373" } } })).toBe(
      undefined,
    );
  });

  it("returns undefined for an absent slice", () => {
    expect(credentialRefreshExpiryIso({ slice: undefined })).toBe(undefined);
  });
});

describe("both expiry readers are range-safe, not merely finiteness-checked", () => {
  // `Number.isFinite(8.64e15 + 1)` is true and `new Date(8.64e15 + 1).toISOString()` throws `RangeError` —
  // verified by running it. A reader whose whole contract is "an instant or undefined" must not
  // throw, so the check is on the constructed Date rather than on the number.
  const OUT_OF_RANGE = 8.64e15 + 1;

  it("answers undefined rather than throwing for a finite but unrepresentable access expiry", () => {
    expect(credentialExpiryIso({ slice: { credential: { accessToken: "A", expiresAt: OUT_OF_RANGE } } })).toBe(
      undefined,
    );
  });

  it("answers undefined for its negative counterpart", () => {
    expect(credentialExpiryIso({ slice: { credential: { accessToken: "A", expiresAt: -OUT_OF_RANGE } } })).toBe(
      undefined,
    );
  });

  it("answers undefined rather than throwing for an unrepresentable refresh expiry", () => {
    expect(credentialRefreshExpiryIso({ slice: { credential: { refreshTokenExpiresAt: OUT_OF_RANGE } } })).toBe(
      undefined,
    );
  });

  it("round-trips the representable endpoint", () => {
    expect(credentialExpiryIso({ slice: { credential: { accessToken: "A", expiresAt: 8.64e15 } } })).toBe(
      "+275760-09-13T00:00:00.000Z",
    );
  });

  it("answers undefined for NaN and both infinities", () => {
    expect(credentialExpiryIso({ slice: { credential: { accessToken: "A", expiresAt: Number.NaN } } })).toBe(undefined);
    expect(credentialRefreshExpiryIso({ slice: { credential: { refreshTokenExpiresAt: Infinity } } })).toBe(undefined);
    expect(credentialRefreshExpiryIso({ slice: { credential: { refreshTokenExpiresAt: -Infinity } } })).toBe(undefined);
  });
});

describe("credentialHasRefreshToken", () => {
  it("answers true for a non-empty refresh token, without exposing it", () => {
    expect(credentialHasRefreshToken({ slice: { credential: { refreshToken: "r" } } })).toBe(true);
  });

  it("answers false for the EMPTY string, which is the shape a cleared credential is left in", () => {
    // The same state `credentialHasAccessToken` exists for. MEASURED: `claude doctor` exited 0 and
    // wrote back a credential whose tokens were the empty string. An empty string is still a `string`, so a
    // type-only guard would present nothing to the provider and spend a request to be told so.
    expect(credentialHasRefreshToken({ slice: { credential: { refreshToken: "" } } })).toBe(false);
  });

  it("answers false for an absent field, a non-string, and an absent slice", () => {
    expect(credentialHasRefreshToken({ slice: { credential: { accessToken: "A" } } })).toBe(false);
    expect(credentialHasRefreshToken({ slice: { credential: { refreshToken: 7 } } })).toBe(false);
    expect(credentialHasRefreshToken({ slice: undefined })).toBe(false);
  });
});
