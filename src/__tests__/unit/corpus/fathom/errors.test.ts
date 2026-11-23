/**
 * The Fathom lane's three failures, one per next action: a missing key, a refused key, and a wire failure
 * that keeps its cause and takes an Error's own message.
 */
import { describe, expect, it } from "vitest";

import { FathomErrors } from "../../../../corpus/fathom/errors.js";

describe("FathomErrors", () => {
  it("keyMissing is KEY_MISSING, telling the owner where to mint a key and how to store it", () => {
    const error = FathomErrors.keyMissing();

    expect(error.code).toBe("KEY_MISSING");
    expect(error.message).toBe(
      "no Fathom API key is configured — mint one at https://fathom.video/customize#api-access-header " +
        "(User Settings → API Access) and store it with `slopweaver secrets set fathom-api-key`",
    );
  });

  it("unauthorised is UNAUTHORISED, naming revocation and deactivation and how to replace the key", () => {
    const error = FathomErrors.unauthorised();

    expect(error.code).toBe("UNAUTHORISED");
    expect(error.message).toBe(
      "Fathom refused the stored API key — it was revoked, or the user it belongs to was deactivated " +
        "(a deactivated user's key returns 4xx). Mint a fresh one at " +
        "https://fathom.video/customize#api-access-header and re-run `slopweaver secrets set fathom-api-key`",
    );
  });

  it("fetchFailed is FETCH_FAILED, taking an Error's own message and keeping the Error as its cause", () => {
    const cause = new Error("wire down");
    const error = FathomErrors.fetchFailed({ cause });

    expect(error.code).toBe("FETCH_FAILED");
    expect(error.message).toBe("wire down");
    expect(error.cause).toBe(cause);
  });

  it("fetchFailed is FETCH_FAILED with the fixed message when the cause is not an Error, keeping that cause", () => {
    const cause = { status: 502 };
    const error = FathomErrors.fetchFailed({ cause });

    expect(error.code).toBe("FETCH_FAILED");
    expect(error.message).toBe("fathom fetch failed");
    expect(error.cause).toBe(cause);
  });
});
